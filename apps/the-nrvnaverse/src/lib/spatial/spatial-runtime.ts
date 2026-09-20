import type { ChunkPayload } from "@/lib/spatial/chunk-payload";
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

/**
 * Opaque handle to one instantiated chunk. The application never sees engine component objects:
 * the runtime keeps the mapping from this handle to its `Component3D`s privately (M0 Step 2B.2).
 */
export interface ChunkBatch {
  readonly chunkKey: string;
  /** Exactly the component ids that were created for this batch (record order). */
  readonly componentIds: readonly string[];
}

/**
 * Chunk-level operations the orchestrator needs (M0 Step 2B.2). Both are wrappers over the
 * official `space.components.create(data, { abort })` / `space.components.destroy(component)`.
 */
export interface ChunkRuntime extends SpatialRuntime {
  /**
   * Instantiate every component of a validated payload. All-or-nothing: on any creation failure
   * or abort, every component that was created is destroyed again and the promise rejects
   * (an `AbortError` when the signal fired). The previously loaded chunk is untouched.
   */
  stageChunk(payload: ChunkPayload, signal: AbortSignal): Promise<ChunkBatch>;
  /** Destroy every component of a previously staged batch. Idempotent per batch. */
  retireChunk(batch: ChunkBatch): void;
}

/**
 * Generic physical-sensor seam (M0 Step 2B.3). Portal-neutral: the runtime knows component ids
 * and the player, never destination ids. Implemented over the official `Component3D.onSensorEnter`
 * (see `awe-spatial-runtime.ts`); the `PortalController` is its only consumer.
 */
export interface SensorRuntime {
  /**
   * Invoke `callback` each time the player's avatar ENTERS the sensor collider of the currently
   * staged component `componentId` (sensor enter only — never stay). Non-player intersections
   * are ignored. Throws if the component is not staged or is not configured as a sensor.
   * Returns an idempotent unsubscribe that is safe to call after the component was disposed.
   */
  onPlayerEnterSensor(componentId: string, callback: () => void): () => void;
}
