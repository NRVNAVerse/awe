import type { PlacementResult, SpatialTravelAdapter, SpatialTravelPhase, TravelResult } from "@nrvnaverse/manifest";

export const SPATIAL_UNAVAILABLE_REASON = "Spatial travel is planned for M0 Step 2 and is not implemented in this build.";

/**
 * The only spatial adapter in M0 Step 1. It implements the boundary honestly: nothing can be
 * placed or travelled to. M0 Step 2 replaces it with an adapter backed by the AWE engine.
 * It does not, and must not, depend on Ghost's experimental chunk manager (D-013).
 */
export class PlannedSpatialAdapter implements SpatialTravelAdapter {
  readonly name = "planned-spatial-adapter";
  readonly canTravel = false;

  async resolvePlacement(_destinationId: string): Promise<PlacementResult> {
    return { status: "unavailable", reason: SPATIAL_UNAVAILABLE_REASON };
  }

  async travelTo(_destinationId: string): Promise<TravelResult> {
    return { status: "unavailable", reason: SPATIAL_UNAVAILABLE_REASON };
  }

  onPhase(_listener: (phase: SpatialTravelPhase, destinationId: string | null) => void): () => void {
    return () => {};
  }
}
