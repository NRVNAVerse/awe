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
import { lookupPlacement, toSpatialPlacement, type PlacementRegistry } from "@/lib/spatial/placement-registry";
import type { SpatialRuntime } from "@/lib/spatial/spatial-runtime";
import { now, perfRecord } from "@/lib/perf";

export const RUNTIME_NOT_READY_REASON = "The spatial runtime is not ready yet.";

export interface AweSpatialAdapterOptions {
  registry: PlacementRegistry;
  /** Manifest lookup (from the runtime destination index). Gates are read from here, never from the registry. */
  getDestination: (destinationId: string) => Destination | undefined;
  /** Engine runtime; may be bound later with `bindRuntime` once the space is loaded. */
  runtime?: SpatialRuntime | null;
}

type PhaseListener = (phase: SpatialTravelPhase, destinationId: string | null) => void;

/**
 * M0 Step 2A adapter: stable destination id → physical placement in the single prototype AWE
 * scene → same-scene teleport through the official Mover/rigid-body API.
 *
 * Only this adapter (and its registry) knows coordinates. Application and UI code call
 * `travelTo(id)`; they never receive or pass positions.
 *
 * Gate boundary (D-006, Landmark §9): any destination whose manifest carries `gates[]` is
 * refused with a structured `gate-required` result. No age verification, no jurisdiction policy
 * and no bypass exist in this build; the placeholder `enforced: false` flag in the manifest is
 * deliberately NOT consulted here — declaring a gate is enough to stop spatial entry.
 *
 * Builds only on official upstream AWE code plus NRVNAVerse-owned code (D-013: no Ghost code).
 */
export class AweSpatialAdapter implements SpatialTravelAdapter {
  readonly name = "awe-spatial-adapter";

  private readonly registry: PlacementRegistry;
  private readonly getDestination: (destinationId: string) => Destination | undefined;
  private runtime: SpatialRuntime | null;
  private listeners = new Set<PhaseListener>();
  private phase: SpatialTravelPhase = "idle";
  private disposed = false;

  constructor(options: AweSpatialAdapterOptions) {
    this.registry = options.registry;
    this.getDestination = options.getDestination;
    this.runtime = options.runtime ?? null;
  }

  /** Attach (or detach with `null`) the engine runtime once the space exists. */
  bindRuntime(runtime: SpatialRuntime | null): void {
    this.runtime = runtime;
  }

  get currentPhase(): SpatialTravelPhase {
    return this.phase;
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
    if (!this.runtime || !this.runtime.isReady) {
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

    // Eligible: the registry entry and runtime are guaranteed by canTravel.
    const lookup = lookupPlacement(this.registry, destinationId);
    if (lookup.status !== "found" || !this.runtime) {
      this.emit("failed", destinationId);
      return { status: "failed", destinationId, reason: "placement disappeared during travel" };
    }

    try {
      this.runtime.placeVisitor(lookup.placement.spawn);
    } catch (err) {
      this.emit("failed", destinationId);
      perfRecord("travel", now() - started, { destinationId, outcome: "failed" });
      return { status: "failed", destinationId, reason: err instanceof Error ? err.message : String(err) };
    }

    this.emit("arrived", destinationId);
    perfRecord("travel", now() - started, { destinationId, outcome: "arrived" });
    return { status: "arrived", placement: toSpatialPlacement(destinationId, lookup.placement) };
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

  /** Drop every subscription and detach the runtime. Further travel reports `unavailable`. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.runtime = null;
    this.phase = "idle";
  }

  private emit(phase: SpatialTravelPhase, destinationId: string | null) {
    this.phase = phase;
    for (const listener of this.listeners) listener(phase, destinationId);
  }
}
