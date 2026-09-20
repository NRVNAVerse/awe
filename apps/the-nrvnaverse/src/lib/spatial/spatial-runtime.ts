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
