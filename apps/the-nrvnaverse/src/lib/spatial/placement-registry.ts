/**
 * Physical placement registry — NRVNAVerse-owned, application/spatial-layer data.
 *
 * Maps a stable destination id (D-004) to where that destination physically lives in the
 * current AWE prototype scene. It is deliberately SEPARATE from the destination manifests
 * (`packages/nrvna-manifest/manifests/*.json`), which never gain coordinates, chunk keys or
 * spawn positions. Everything in here is a replaceable implementation detail: re-laying-out
 * the world changes this file and nothing else.
 *
 * Since M0 Step 2B.1 the registry is BUILT FROM GENERATED DATA (`registryFromSpatialIndex` in
 * `spatial-index.ts`, fed by `public/data/spatial/spatial-index.json`), which the spatial
 * pipeline derives from the authoritative source in `spatial/source/`. Nothing in `src/` holds a
 * hand-kept coordinate table any more: `destinationId → chunkKey → spawn`, never the reverse.
 */

import type { SpatialPlacement } from "@nrvnaverse/manifest";

export interface SpawnPoint {
  /** World-space position the avatar is placed at (metres). */
  position: { x: number; y: number; z: number };
  /** Facing around the world Y axis in radians. `0` faces −Z (the engine's avatar forward). */
  yaw: number;
}

export interface PhysicalPlacement {
  /** Which AWE world/scene this placement belongs to (matches `spatialDestination.worldId`). */
  worldId: string;
  /**
   * Logical physical chunk that owns this destination's geometry (generated spatial index). A
   * replaceable implementation detail: it is NOT identity and is never written to a URL. Step
   * 2B.2 uses it to fetch the chunk payload — after gate evaluation, never before.
   */
  chunkKey: string;
  /** Adapter-private diagnostics handle derived from `chunkKey` (`chunk:<key>`). Never identity. */
  placementRef: string;
  spawn: SpawnPoint;
}

/** Registry keyed by stable destination id. */
export type PlacementRegistry = Readonly<Record<string, PhysicalPlacement>>;

export type PlacementLookup =
  | { status: "found"; destinationId: string; placement: PhysicalPlacement }
  | { status: "missing"; destinationId: string; reason: string };

export function lookupPlacement(registry: PlacementRegistry, destinationId: string): PlacementLookup {
  const placement = Object.prototype.hasOwnProperty.call(registry, destinationId) ? registry[destinationId] : undefined;
  if (!placement) {
    return { status: "missing", destinationId, reason: `no physical placement is registered for destination "${destinationId}"` };
  }
  return { status: "found", destinationId, placement };
}

/** Public, coordinate-free view of a placement — the only form the application layer sees. */
export function toSpatialPlacement(destinationId: string, placement: PhysicalPlacement): SpatialPlacement {
  return {
    destinationId,
    platform: "the-nrvnaverse",
    worldId: placement.worldId,
    placementRef: placement.placementRef,
  };
}
