/**
 * Spatial adapter boundary — the seam between NRVNAVerse destination identity and AWE
 * physical placement / travel.
 *
 * STATUS: interface refined in M0 Step 2A (`superseded` added in 2B.2); the implementation lives in
 * `apps/the-nrvnaverse/src/lib/spatial/awe-spatial-adapter.ts`. The application layer talks
 * only in destination ids; how an id becomes a world, chunk, spawn or portal is the
 * adapter's private concern. Nothing here may leak coordinates into identity (D-004).
 *
 * Neither this file nor its implementations depend on Ghost's experimental
 * chunk-manager (D-013). An adapter may be backed by any engine-side mechanism.
 */

import type { SpatialPlatform } from "./schema";

/**
 * Resolved physical placement for a destination. Opaque to the application layer: fields are
 * for the adapter implementation and diagnostics, never for identity or deep links.
 */
export interface SpatialPlacement {
  destinationId: string;
  platform: SpatialPlatform;
  worldId: string;
  /** Adapter-private placement handle (e.g. a chunk key or spawn label). Never persisted as identity. */
  placementRef: string | null;
}

export type PlacementResult =
  | { status: "resolved"; placement: SpatialPlacement }
  | { status: "unplaced"; destinationId: string; reason: string }
  | { status: "unavailable"; reason: string };

/**
 * Per-destination travel eligibility. Evaluated before any content is fetched or any
 * movement happens (D-006): a destination that carries `gates[]` is never "allowed" merely
 * because a placement exists for it.
 */
export type TravelEligibility =
  | { allowed: true; destinationId: string }
  | { allowed: false; destinationId: string; reason: "gate-required"; gates: string[] }
  | { allowed: false; destinationId: string; reason: "unknown-destination" | "not-public" | "unplaced" | "unavailable"; message: string };

export type TravelResult =
  | { status: "arrived"; placement: SpatialPlacement }
  | { status: "gate-required"; destinationId: string; gates: string[] }
  | { status: "failed"; destinationId: string; reason: string }
  | { status: "unavailable"; reason: string }
  /**
   * A newer travel request replaced this one before it could complete (latest request wins).
   * Nothing was moved, loaded or unloaded on behalf of this request; it is not a user-facing
   * failure and callers must not change state or URLs because of it.
   */
  | { status: "superseded"; destinationId: string };

/**
 * Lifecycle states a spatial adapter may report. They map to the application state phases
 * (`loadingGlobals`, `loadingChunk`, `traveling`, `arrived`, `gateRequired`). `loadingChunk` is
 * reported only for real cross-chunk work (M0 Step 2B.2); same-chunk travel and gate refusals
 * never enter it.
 */
export type SpatialTravelPhase = "idle" | "loadingGlobals" | "loadingChunk" | "traveling" | "arrived" | "gateRequired" | "failed";

export interface SpatialTravelAdapter {
  /** Stable, human-readable adapter name for diagnostics (class names are minified in production). */
  readonly name: string;
  /**
   * Whether this adapter may move a visitor to the given destination right now. Gated
   * destinations yield `gate-required`; unknown, non-public or unplaced destinations yield a
   * structured refusal. Never throws.
   */
  canTravel(destinationId: string): TravelEligibility;
  /** Resolve where a destination lives without moving anyone. */
  resolvePlacement(destinationId: string): Promise<PlacementResult>;
  /** Move the visitor to a destination. Gate evaluation happens before content loads (D-006). */
  travelTo(destinationId: string): Promise<TravelResult>;
  /** Subscribe to phase changes. Returns an unsubscribe function. */
  onPhase(listener: (phase: SpatialTravelPhase, destinationId: string | null) => void): () => void;
}
