import { isAbortError, type ChunkDataSource } from "@/lib/spatial/chunk-data-source";
import { parseChunkPayload, type ChunkPayload } from "@/lib/spatial/chunk-payload";
import type { SpawnPoint } from "@/lib/spatial/placement-registry";
import type { ChunkBatch, ChunkRuntime } from "@/lib/spatial/spatial-runtime";
import type { SpatialIndexChunk } from "@/lib/spatial/spatial-index";
import { now, perfRecord } from "@/lib/perf";

/**
 * NRVNAVerse chunk orchestrator (M0 Step 2B.2, D-016) — application-layer, over official AWE
 * runtime APIs only. Owns exactly ONE active chunk plus the transition between chunks:
 *
 *   fetch → validate → [lock] stage target WHILE the old chunk stays alive → teleport
 *   → commit target as active → retire old chunk [unlock]
 *
 * Safety rules implemented here (see docs/NRVNAVERSE_SPATIAL_RUNTIME.md):
 *
 * - Never unload-before-fetch. The active chunk is the rollback state until the target is
 *   staged AND the visitor has been placed in it. A network / validation / creation / teleport
 *   failure leaves the active chunk and the visitor exactly where they were.
 * - Latest request wins. Every `transitionTo` bumps a monotonically increasing generation and
 *   aborts the previous request's `AbortController`. The signal cancels the fetch and is passed
 *   to component creation (official `ComponentManager.create` supports it), but it is NOT the
 *   only guard: every async boundary re-checks `generation` before doing anything that matters
 *   (teleport, commit, destroy). Stale work that already created components retires them.
 * - Single writer for engine mutations. Fetch/validation may overlap and cancel freely, but
 *   staging / commit / rollback run under a tiny promise-chain mutex so two transitions can
 *   never mutate the component set concurrently.
 * - Same-chunk travel (target chunk == active chunk) is a teleport only: no fetch, no create,
 *   no destroy, no `loadingChunk`.
 * - No prefetch, no cache, no neighbour warming (Step 2B.4). The "already active" check is the
 *   only reuse.
 * - Asynchronous shutdown (2B.4A). `dispose()` immediately refuses new transitions, bumps the
 *   generation and aborts the active controller, then WAITS for the mutation queue to settle
 *   (a stage that was already creating components finishes, observes that it is stale and
 *   retires its own batch) and only then retires the active chunk — exactly once, as the last
 *   entry of the mutation queue. The promise never rejects: cleanup failures are reported
 *   through `warn`. Callers destroy the engine runtime only after this promise resolves.
 *
 * The orchestrator knows chunk keys and spawns, never destination ids as identity (the
 * `destinationId` it receives is diagnostics for perf/log detail only) and never gates: the
 * adapter evaluates the manifest gate BEFORE asking for a transition (D-006), so this class is
 * never even called for a gated destination.
 */

export interface ChunkTransitionRequest {
  chunkKey: string;
  spawn: SpawnPoint;
  /** Diagnostics only (perf detail / log). Not used for any decision here. */
  destinationId: string;
  /** Invoked once when (and only when) this request starts real cross-chunk work and is current. */
  onLoadingChunk?: () => void;
}

export type ChunkTransitionStep = "fetch" | "validate" | "stage" | "place";

export type ChunkTransitionResult =
  | {
      status: "arrived";
      chunkKey: string;
      kind: "same-chunk" | "cross-chunk";
      /** Set when the old chunk could not be fully retired after a successful placement (target stays active). */
      cleanupError?: string;
    }
  | { status: "superseded"; chunkKey: string }
  | { status: "failed"; chunkKey: string; step: ChunkTransitionStep; reason: string };

export interface ChunkOrchestratorOptions {
  runtime: ChunkRuntime;
  chunkSource: ChunkDataSource;
  /** From the generated spatial index: which world the chunks belong to and where each payload lives. */
  worldId: string;
  chunks: Readonly<Record<string, SpatialIndexChunk>>;
  /** Non-fatal problems (e.g. old-chunk cleanup failures). Defaults to `console.warn` outside tests. */
  warn?: (message: string, detail?: unknown) => void;
}

interface ActiveChunk {
  chunkKey: string;
  batch: ChunkBatch;
}

export class ChunkOrchestrator {
  private readonly runtime: ChunkRuntime;
  private readonly chunkSource: ChunkDataSource;
  private readonly worldId: string;
  private readonly chunks: Readonly<Record<string, SpatialIndexChunk>>;
  private readonly warn: (message: string, detail?: unknown) => void;

  private active: ActiveChunk | null = null;
  /** Monotonic request generation; only the newest generation may mutate anything. */
  private generation = 0;
  private controller: AbortController | null = null;
  /** Promise-chain mutex serialising stage / commit / rollback. */
  private mutationTail: Promise<unknown> = Promise.resolve();
  private crossChunkInFlight = 0;
  private disposed = false;
  /** The one shutdown promise (`dispose()` is idempotent). */
  private disposal: Promise<void> | null = null;

  constructor(options: ChunkOrchestratorOptions) {
    this.runtime = options.runtime;
    this.chunkSource = options.chunkSource;
    this.worldId = options.worldId;
    this.chunks = options.chunks;
    this.warn = options.warn ?? ((message, detail) => console.warn(`[chunk-orchestrator] ${message}`, detail ?? ""));
  }

  /** True once the engine runtime can place a visitor. */
  get isReady(): boolean {
    return !this.disposed && this.runtime.isReady;
  }

  /** Key of the one chunk currently instantiated, or null before the first chunk is committed. */
  get activeChunkKey(): string | null {
    return this.active?.chunkKey ?? null;
  }

  /** True while at least one cross-chunk transition has not settled (diagnostics/tests). */
  get isTransitioning(): boolean {
    return this.crossChunkInFlight > 0;
  }

  /** Current request generation (diagnostics/tests). */
  get currentGeneration(): number {
    return this.generation;
  }

  /**
   * Make `request.chunkKey` the active chunk and place the visitor at `request.spawn`.
   * Supersedes any unfinished transition. Never throws; every outcome is a structured result.
   */
  async transitionTo(request: ChunkTransitionRequest): Promise<ChunkTransitionResult> {
    const { chunkKey, spawn, destinationId } = request;
    if (this.disposed) return { status: "failed", chunkKey, step: "place", reason: "chunk orchestrator is disposed" };

    // Latest request wins: bump the generation and cancel whatever the previous request was doing.
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const isCurrent = () => generation === this.generation && !this.disposed;
    const started = now();

    // ---- Same-chunk travel: teleport only. Nothing is fetched, created or destroyed.
    if (this.active && this.active.chunkKey === chunkKey) {
      try {
        this.runtime.placeVisitor(spawn);
      } catch (err) {
        perfRecord("same-chunk-travel", now() - started, { chunkKey, destinationId, outcome: "failed" });
        return { status: "failed", chunkKey, step: "place", reason: errorMessage(err) };
      }
      perfRecord("same-chunk-travel", now() - started, { chunkKey, destinationId, outcome: "arrived" });
      return { status: "arrived", chunkKey, kind: "same-chunk" };
    }

    // ---- Cross-chunk transition.
    this.crossChunkInFlight++;
    try {
      const result = await this.crossChunk(request, signal, isCurrent);
      perfRecord("cross-chunk-travel", now() - started, { chunkKey, destinationId, outcome: result.status === "failed" ? `failed:${result.step}` : result.status });
      return result;
    } finally {
      this.crossChunkInFlight--;
    }
  }

  private async crossChunk(request: ChunkTransitionRequest, signal: AbortSignal, isCurrent: () => boolean): Promise<ChunkTransitionResult> {
    const { chunkKey, spawn, destinationId } = request;
    const chunk = Object.prototype.hasOwnProperty.call(this.chunks, chunkKey) ? this.chunks[chunkKey] : undefined;
    if (!chunk) return { status: "failed", chunkKey, step: "fetch", reason: `spatial index declares no chunk "${chunkKey}"` };

    request.onLoadingChunk?.();

    // 1. Fetch (cancellable). The active chunk is untouched whatever happens here.
    const fetchStarted = now();
    let raw: unknown;
    try {
      raw = await this.chunkSource.load({ chunkKey, dataUrl: chunk.dataUrl, signal });
    } catch (err) {
      if (isAbortError(err) || !isCurrent()) {
        perfRecord("chunk-fetch", now() - fetchStarted, { chunkKey, outcome: "superseded" });
        return { status: "superseded", chunkKey };
      }
      perfRecord("chunk-fetch", now() - fetchStarted, { chunkKey, outcome: "failed" });
      return { status: "failed", chunkKey, step: "fetch", reason: errorMessage(err) };
    }
    perfRecord("chunk-fetch", now() - fetchStarted, { chunkKey, outcome: "ok" });
    if (!isCurrent()) return { status: "superseded", chunkKey };

    // 2. Validate BEFORE any engine mutation — a malformed or mismatched payload never costs the current world.
    const validateStarted = now();
    let payload: ChunkPayload;
    try {
      payload = parseChunkPayload(raw, { worldId: this.worldId, chunkKey });
    } catch (err) {
      perfRecord("chunk-validate", now() - validateStarted, { chunkKey, outcome: "failed" });
      return { status: "failed", chunkKey, step: "validate", reason: errorMessage(err) };
    }
    perfRecord("chunk-validate", now() - validateStarted, { chunkKey, outcome: "ok" });
    if (!isCurrent()) return { status: "superseded", chunkKey };

    // 3–6. Stage / place / commit / retire under the single-writer lock.
    return this.withMutationLock(async () => {
      if (!isCurrent()) return { status: "superseded", chunkKey };

      // 3. Stage the target while the old chunk remains alive. All-or-nothing (runtime contract).
      const stageStarted = now();
      let batch: ChunkBatch;
      try {
        batch = await this.runtime.stageChunk(payload, signal);
      } catch (err) {
        if (isAbortError(err) || !isCurrent()) {
          perfRecord("chunk-stage", now() - stageStarted, { chunkKey, outcome: "superseded" });
          return { status: "superseded", chunkKey };
        }
        perfRecord("chunk-stage", now() - stageStarted, { chunkKey, outcome: "failed" });
        return { status: "failed", chunkKey, step: "stage", reason: errorMessage(err) };
      }
      perfRecord("chunk-stage", now() - stageStarted, { chunkKey, outcome: "ok", components: batch.componentIds.length });

      // A newer request arrived while we were creating components: discard OUR batch, touch nothing else.
      if (!isCurrent()) {
        this.retireQuietly(batch, "superseded target");
        return { status: "superseded", chunkKey };
      }

      // 4. Teleport with both chunks alive. Failure → discard the target, keep the old chunk and position.
      try {
        this.runtime.placeVisitor(spawn);
      } catch (err) {
        this.retireQuietly(batch, "target after placement failure");
        return { status: "failed", chunkKey, step: "place", reason: errorMessage(err) };
      }

      // 5. Commit: the visitor stands in the target, so the target is now the rollback state.
      const previous = this.active;
      this.active = { chunkKey, batch };

      // 6. Retire the old chunk. A failure here is reported, never rolled back: the visitor has
      //    already arrived and must not be yanked back to a chunk we are trying to remove.
      let cleanupError: string | undefined;
      if (previous) {
        try {
          this.runtime.retireChunk(previous.batch);
        } catch (err) {
          cleanupError = errorMessage(err);
          this.warn(`could not fully retire chunk "${previous.chunkKey}" after arriving in "${chunkKey}"`, err);
        }
      }
      return cleanupError ? { status: "arrived", chunkKey, kind: "cross-chunk", cleanupError } : { status: "arrived", chunkKey, kind: "cross-chunk" };
    });
  }

  /** True once `dispose()` has been called (the shutdown may still be settling). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Asynchronous shutdown contract (M0 Step 2B.4A). Synchronously, before the first await:
   *
   *   1. mark disposed — `transitionTo` now fails structurally, `isReady` is false;
   *   2. bump the generation and abort the active controller — every in-flight request is stale
   *      (its fetch is cancelled; a stage inside `ComponentManager.create` observes the signal).
   *
   * Then it waits for the mutation queue to SETTLE: a request that was already inside the lock
   * finishes its `stageChunk`, sees that it is stale and retires the batch it created (or the
   * batch helper rolled it back on abort); requests queued behind the lock return `superseded`
   * without touching the runtime; requests still fetching / validating never enter the lock
   * (`isCurrent()` is checked before it) and are simply abandoned. Finally the active chunk is
   * retired exactly once, as the LAST entry of the mutation queue, so no stale transition can
   * still be mutating the component set when it happens and none can commit after it.
   *
   * Idempotent: every call returns the same promise. Never rejects — retire failures are
   * reported through `warn` and shutdown continues. Resolves only once no batch this
   * orchestrator created can still exist, so the caller may then destroy the engine runtime.
   * (Settlement depends on the runtime's `stageChunk` settling; the official
   * `ComponentManager.create` bounds creation with its own timeout.)
   */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.disposal = this.withMutationLock(async () => {
      // Every earlier mutation has settled (stale batches retired by their own transitions);
      // nothing can be queued after this because `transitionTo` refuses once disposed.
      const active = this.active;
      this.active = null;
      if (active) this.retireQuietly(active.batch, "active chunk on dispose");
    }).catch((err) => {
      // `retireQuietly` never throws; this is defensive so shutdown can never hang or reject.
      this.warn("unexpected error while settling the mutation queue on dispose", err);
    });
    return this.disposal;
  }

  private retireQuietly(batch: ChunkBatch, what: string) {
    try {
      this.runtime.retireChunk(batch);
    } catch (err) {
      this.warn(`could not fully retire ${what} ("${batch.chunkKey}")`, err);
    }
  }

  private withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(fn, fn);
    this.mutationTail = run.catch(() => undefined);
    return run;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
