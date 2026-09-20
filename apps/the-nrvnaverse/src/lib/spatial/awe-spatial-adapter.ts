import {
  isDestinationId,
  isPublicStatus,
  type Destination,
  type PlacementResult,
  type SpatialTravelAdapter,
  type SpatialTravelPhase,
  type TravelEligibility,
  type TravelResult,
} from "@nrvnaverse/manifest";
import type { ChunkOrchestrator } from "@/lib/spatial/chunk-orchestrator";
import { lookupPlacement, toSpatialPlacement, type PlacementRegistry } from "@/lib/spatial/placement-registry";
import { now, perfRecord } from "@/lib/perf";

export const RUNTIME_NOT_READY_REASON = "The spatial runtime is not ready yet.";

export interface AweSpatialAdapterOptions {
  registry: PlacementRegistry;
  /** Manifest lookup (from the runtime destination index). Gates are read from here, never from the registry. */
  getDestination: (destinationId: string) => Destination | undefined;
  /** Chunk orchestrator over the engine runtime; may be bound later with `bindOrchestrator`. */
  orchestrator?: ChunkOrchestrator | null;
}

type PhaseListener = (phase: SpatialTravelPhase, destinationId: string | null) => void;

/**
 * Stable destination id → physical placement (`chunkKey` + spawn) → chunk orchestrator.
 *
 * Only this adapter (and its registry) knows coordinates. Application and UI code call
 * `travelTo(id)`; they never receive or pass positions. The adapter never touches engine
 * components itself: it asks the `ChunkOrchestrator` to make the placement's chunk active and to
 * place the visitor (M0 Step 2B.2, D-016).
 *
 * Gate boundary (D-006, Landmark §9): any destination whose manifest carries `gates[]` is
 * refused with a structured `gate-required` result BEFORE the orchestrator is asked for anything,
 * so no gated chunk payload is ever requested. No age verification, no jurisdiction policy and
 * no bypass exist in this build; the placeholder `enforced: false` flag in the manifest is
 * deliberately NOT consulted — declaring a gate is enough to stop spatial entry.
 *
 * Builds only on official upstream AWE code plus NRVNAVerse-owned code (D-013: no Ghost code).
 */
export class AweSpatialAdapter implements SpatialTravelAdapter {
  readonly name = "awe-spatial-adapter";

  private readonly registry: PlacementRegistry;
  private readonly getDestination: (destinationId: string) => Destination | undefined;
  private orchestrator: ChunkOrchestrator | null;
  private listeners = new Set<PhaseListener>();
  private phase: SpatialTravelPhase = "idle";
  private disposed = false;

  constructor(options: AweSpatialAdapterOptions) {
    this.registry = options.registry;
    this.getDestination = options.getDestination;
    this.orchestrator = options.orchestrator ?? null;
  }

  /** Attach (or detach with `null`) the orchestrator once the engine space exists. */
  bindOrchestrator(orchestrator: ChunkOrchestrator | null): void {
    this.orchestrator = orchestrator;
  }

  get currentPhase(): SpatialTravelPhase {
    return this.phase;
  }

  /** Diagnostics: the chunk currently instantiated (never identity, never written to a URL). */
  get activeChunkKey(): string | null {
    return this.orchestrator?.activeChunkKey ?? null;
  }

  canTravel(destinationId: string): TravelEligibility {
    const destination = isDestinationId(destinationId) ? this.getDestination(destinationId) : undefined;
    if (!destination) {
      return { allowed: false, destinationId, reason: "unknown-destination", message: `Destination "${destinationId}" is unknown.` };
    }
    if (!isPublicStatus(destination.status)) {
      return { allowed: false, destinationId, reason: "not-public", message: "That destination is not open to the public." };
    }
    if (destination.gates.length > 0) {
      return { allowed: false, destinationId, reason: "gate-required", gates: destination.gates.map((g) => g.kind) };
    }
    const lookup = lookupPlacement(this.registry, destinationId);
    if (lookup.status === "missing") {
      return { allowed: false, destinationId, reason: "unplaced", message: lookup.reason };
    }
    if (!this.orchestrator || !this.orchestrator.isReady) {
      return { allowed: false, destinationId, reason: "unavailable", message: RUNTIME_NOT_READY_REASON };
    }
    return { allowed: true, destinationId };
  }

  async resolvePlacement(destinationId: string): Promise<PlacementResult> {
    const lookup = lookupPlacement(this.registry, destinationId);
    if (lookup.status === "missing") {
      return { status: "unplaced", destinationId, reason: lookup.reason };
    }
    return { status: "resolved", placement: toSpatialPlacement(destinationId, lookup.placement) };
  }

  /**
   * Gate → placement → chunk transition → arrived. Phases: `traveling`, then `loadingChunk` only
   * if the orchestrator has to fetch a different chunk, then `arrived` / `gateRequired` / `failed`.
   * A superseded request emits nothing further (the newer request owns the phase stream).
   */
  async travelTo(destinationId: string): Promise<TravelResult> {
    const started = now();
    this.emit("traveling", destinationId);

    const eligibility = this.canTravel(destinationId);
    if (eligibility.allowed === false) {
      if (eligibility.reason === "gate-required") {
        this.emit("gateRequired", destinationId);
        perfRecord("travel", now() - started, { destinationId, outcome: "gate-required" });
        return { status: "gate-required", destinationId, gates: eligibility.gates };
      }
      this.emit("failed", destinationId);
      perfRecord("travel", now() - started, { destinationId, outcome: eligibility.reason });
      if (eligibility.reason === "unavailable") {
        return { status: "unavailable", reason: eligibility.message };
      }
      return { status: "failed", destinationId, reason: eligibility.message };
    }

    // Eligible: the registry entry and orchestrator are guaranteed by canTravel.
    const lookup = lookupPlacement(this.registry, destinationId);
    const orchestrator = this.orchestrator;
    if (lookup.status !== "found" || !orchestrator) {
      this.emit("failed", destinationId);
      return { status: "failed", destinationId, reason: "placement disappeared during travel" };
    }

    const { chunkKey, spawn } = lookup.placement;
    const result = await orchestrator.transitionTo({
      chunkKey,
      spawn,
      destinationId,
      onLoadingChunk: () => this.emit("loadingChunk", destinationId),
    });

    switch (result.status) {
      case "arrived":
        this.emit("arrived", destinationId);
        perfRecord("travel", now() - started, { destinationId, outcome: "arrived", kind: result.kind });
        return { status: "arrived", placement: toSpatialPlacement(destinationId, lookup.placement) };
      case "superseded":
        perfRecord("travel", now() - started, { destinationId, outcome: "superseded" });
        return { status: "superseded", destinationId };
      case "failed":
        this.emit("failed", destinationId);
        perfRecord("travel", now() - started, { destinationId, outcome: "failed", step: result.step });
        return { status: "failed", destinationId, reason: result.reason };
    }
  }

  onPhase(listener: PhaseListener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Number of live phase subscriptions (diagnostics/tests). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Drop every subscription and detach the orchestrator. Further travel reports `unavailable`. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.orchestrator = null;
    this.phase = "idle";
  }

  private emit(phase: SpatialTravelPhase, destinationId: string | null) {
    if (this.disposed) return;
    this.phase = phase;
    for (const listener of this.listeners) listener(phase, destinationId);
  }
}
