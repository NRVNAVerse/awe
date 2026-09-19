import type { SpawnPoint } from "@/lib/spatial/placement-registry";

/**
 * The engine-facing surface the spatial adapter needs. Kept tiny so the adapter can be
 * unit-tested with a fake runtime and so the real runtime (`awe-spatial-runtime.ts`) stays the
 * only file that imports the AWE engine.
 */
export interface SpatialRuntime {
  /** True once the space is loaded and the player body exists. */
  readonly isReady: boolean;
  /** Same-scene teleport of the visitor's avatar using the official Mover/rigid-body API. */
  placeVisitor(spawn: SpawnPoint): void;
}
