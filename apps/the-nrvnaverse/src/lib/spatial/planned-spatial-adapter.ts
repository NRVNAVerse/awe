import type {
  PlacementResult,
  SpatialTravelAdapter,
  SpatialTravelPhase,
  TravelEligibility,
  TravelResult,
} from "@nrvnaverse/manifest";

export const SPATIAL_UNAVAILABLE_REASON = "Spatial travel is not available in this context.";

/**
 * Null adapter. It was the only adapter in M0 Step 1; since M0 Step 2A the app runs
 * `AweSpatialAdapter` and this one remains as the honest fallback for contexts without an
 * engine (tests, tooling). It does not, and must not, depend on Ghost's experimental
 * chunk manager (D-013).
 */
export class PlannedSpatialAdapter implements SpatialTravelAdapter {
  readonly name = "planned-spatial-adapter";

  canTravel(destinationId: string): TravelEligibility {
    return { allowed: false, destinationId, reason: "unavailable", message: SPATIAL_UNAVAILABLE_REASON };
  }

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
