/**
 * Spatial adapter boundary — the seam between NRVNAVerse destination identity and AWE
 * physical placement / travel.
 *
 * STATUS: PLANNED interface, no implementation in M0 Step 1. The application layer talks
 * only in destination ids; how an id becomes a world, chunk, spawn or portal is the
 * adapter's private concern (M0 Step 2). Nothing here may leak coordinates into identity.
 *
 * Neither this file nor its future implementation depends on Ghost's experimental
 * chunk-manager (D-013). Step 2 may implement it over any engine-side mechanism.
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

export type TravelResult =
  | { status: "arrived"; placement: SpatialPlacement }
  | { status: "gate-required"; destinationId: string; gates: string[] }
  | { status: "failed"; destinationId: string; reason: string }
  | { status: "unavailable"; reason: string };

/**
 * Planned lifecycle states a spatial adapter may report. They map to the application
 * state extension points (`loadingGlobals`, `loadingChunk`, `traveling`, `arrived`, `gateRequired`).
 */
export type SpatialTravelPhase = "idle" | "loadingGlobals" | "loadingChunk" | "traveling" | "arrived" | "gateRequired" | "failed";

export interface SpatialTravelAdapter {
  /** Stable, human-readable adapter name for diagnostics (class names are minified in production). */
  readonly name: string;
  /** Whether this adapter can actually move a visitor. M0 Step 1 adapters return false. */
  readonly canTravel: boolean;
  /** Resolve where a destination lives without moving anyone. */
  resolvePlacement(destinationId: string): Promise<PlacementResult>;
  /** Move the visitor to a destination. Gate evaluation happens before content loads (D-006). */
  travelTo(destinationId: string): Promise<TravelResult>;
  /** Subscribe to phase changes. Returns an unsubscribe function. */
  onPhase(listener: (phase: SpatialTravelPhase, destinationId: string | null) => void): () => void;
}
