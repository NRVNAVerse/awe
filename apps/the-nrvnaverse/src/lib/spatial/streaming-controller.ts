import type { SpatialIndexStreaming } from "@/lib/spatial/spatial-index";

/**
 * Streaming controller (M2, application layer — D-016 boundary kept).
 *
 * Watches the visitor's position and asks for a POSITION-PRESERVING handoff when they walk from one
 * city cell into the next, or fall off the Hub into the cell underneath. It never moves anyone and
 * never fetches anything itself: it only decides WHICH chunk should be active and calls `handoff`,
 * which goes through the same chunk orchestrator as every travel (stage-before-retire, latest request
 * wins). One active chunk remains the invariant.
 *
 * Rules:
 * - A cell is `cellSize` metres square, centred on multiples of `cellSize`; "i,j" → chunk key.
 * - Hysteresis: while a cell chunk is active, the neighbour is requested only once the visitor is at
 *   least `margin` metres inside it, so pacing along a cell edge never ping-pongs.
 * - Releases: while `fromChunkKey` (the Hub) is active and the visitor is below `belowY`, the cell
 *   under them is requested (no margin: they are falling into it).
 * - Gated chunks are never streamed: `isStreamable` is re-checked here even though the pipeline
 *   already refuses gated cells (defence in depth, D-006).
 * - Nothing happens while `isBusy()` (a travel or another transition is in flight): a portal or
 *   directory travel always wins over proximity.
 * - Safety: below `catchBelowY` the visitor is handed to `rescue()` (returned to a known place).
 */

export interface StreamingPosition {
  x: number;
  y: number;
  z: number;
}

export interface StreamingControllerOptions {
  streaming: SpatialIndexStreaming;
  /** The visitor's current world position, or null when unknown (not placed / runtime gone). */
  position: () => StreamingPosition | null;
  /** The chunk the orchestrator has committed as active. */
  activeChunk: () => string | null;
  /** True while a travel or a chunk transition is in flight. */
  isBusy: () => boolean;
  /** False for any chunk that serves a gated destination (never streamed). */
  isStreamable: (chunkKey: string) => boolean;
  /** Request a position-preserving handoff to `chunkKey`. */
  handoff: (chunkKey: string, reason: "walk" | "release") => void;
  /** The visitor fell below `catchBelowY`: return them somewhere safe. */
  rescue: () => void;
  /**
   * Optional descent glide (the Drop): engaged once the visitor is falling within 10 m above a
   * release height of the active release chunk, released when they are grounded again.
   */
  descent?: { speed: number; set: (metresPerSecond: number | null) => void; grounded: () => boolean };
}

export type StreamingDecision =
  | { kind: "none" }
  | { kind: "handoff"; chunkKey: string; reason: "walk" | "release" }
  | { kind: "rescue" };

export class StreamingController {
  private readonly options: StreamingControllerOptions;
  private readonly cellChunks: ReadonlySet<string>;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The last handoff requested (diagnostics; also suppresses repeating the same request). */
  private pending: string | null = null;
  private lastDecision: StreamingDecision = { kind: "none" };
  private descending = false;

  constructor(options: StreamingControllerOptions) {
    this.options = options;
    this.cellChunks = new Set(Object.values(options.streaming.cells));
  }

  /** The chunk key of the cell containing (x, z), or null outside the grid. */
  cellChunkAt(x: number, z: number): string | null {
    const s = this.options.streaming.cellSize;
    return this.options.streaming.cells[`${Math.round(x / s)},${Math.round(z / s)}`] ?? null;
  }

  /** True when (x, z) is at least `margin` inside its cell on both axes. */
  private wellInside(x: number, z: number): boolean {
    const { cellSize: s, margin } = this.options.streaming;
    const dx = Math.abs(x - Math.round(x / s) * s);
    const dz = Math.abs(z - Math.round(z / s) * s);
    return dx <= s / 2 - margin && dz <= s / 2 - margin;
  }

  /** Pure decision for the current inputs (exposed for tests and diagnostics). */
  decide(): StreamingDecision {
    const o = this.options;
    if (o.isBusy()) return { kind: "none" };
    const p = o.position();
    const active = o.activeChunk();
    if (!p || !active) return { kind: "none" };
    if (o.streaming.catchBelowY !== undefined && p.y < o.streaming.catchBelowY) return { kind: "rescue" };
    const under = this.cellChunkAt(p.x, p.z);
    if (this.cellChunks.has(active)) {
      if (!under || under === active || !this.wellInside(p.x, p.z) || !o.isStreamable(under)) return { kind: "none" };
      return { kind: "handoff", chunkKey: under, reason: "walk" };
    }
    const release = o.streaming.releases.find((r) => r.fromChunkKey === active);
    if (release && p.y < release.belowY && under && o.isStreamable(under)) return { kind: "handoff", chunkKey: under, reason: "release" };
    return { kind: "none" };
  }

  /** One evaluation step: decide and act. Returns what it did. */
  tick(): StreamingDecision {
    this.updateDescent();
    const decision = this.decide();
    this.lastDecision = decision;
    if (decision.kind === "handoff") {
      // Do not re-request the same target while it is still being staged.
      if (this.pending === decision.chunkKey && this.options.isBusy()) return decision;
      this.pending = decision.chunkKey;
      this.options.handoff(decision.chunkKey, decision.reason);
    } else if (decision.kind === "rescue") {
      this.options.rescue();
    } else if (this.pending && this.options.activeChunk() === this.pending) {
      this.pending = null;
    }
    return decision;
  }

  /** Engage / release the descent glide (see `descent`). */
  private updateDescent(): void {
    const d = this.options.descent;
    if (!d) return;
    const p = this.options.position();
    const active = this.options.activeChunk();
    const release = active ? this.options.streaming.releases.find((r) => r.fromChunkKey === active) : undefined;
    const shouldStart = !!p && !!release && p.y < release.belowY + 10 && !d.grounded();
    if (!this.descending && shouldStart) {
      this.descending = true;
      d.set(d.speed);
    } else if (this.descending && !shouldStart && d.grounded()) {
      this.descending = false;
      d.set(null);
    }
  }

  /** True while the descent glide is engaged (diagnostics). */
  get isDescending(): boolean {
    return this.descending;
  }

  /** Poll on a timer (browser). Idempotent. */
  start(intervalMs = 120): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.pending = null;
    if (this.descending) this.options.descent?.set(null);
    this.descending = false;
  }

  /** Diagnostics. */
  get last(): StreamingDecision {
    return this.lastDecision;
  }

  /** True when `chunkKey` is a streaming cell. */
  isCellChunk(chunkKey: string | null): boolean {
    return chunkKey !== null && this.cellChunks.has(chunkKey);
  }
}
