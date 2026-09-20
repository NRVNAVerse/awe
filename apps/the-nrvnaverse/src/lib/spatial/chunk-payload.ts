import { SPATIAL_SCHEMA_VERSION } from "@/lib/spatial/spatial-index";

/**
 * Runtime validation of a generated chunk payload (`public/data/spatial/chunks/<key>.json`,
 * produced by `scripts/spatial/pipeline.mjs`). See docs/NRVNAVERSE_SPATIAL_DATA_PIPELINE.md §6.
 *
 * Shape: `{ schemaVersion, worldId, chunkKey, components: { <componentId>: <ComponentData> } }`.
 *
 * The parser is deliberately strict about the envelope and structural about the components: it
 * checks that every component record is an object whose `id` matches its key and whose `type` is
 * a non-empty string, and leaves component-specific fields to the engine factories. It never
 * looks for destination ids, gates or metadata — chunk files carry none (tested in 2B.1).
 *
 * A payload that fails here is rejected BEFORE any engine mutation: the orchestrator validates
 * while the previously active chunk is still alive (rollback state).
 */

/** One authored component record as the engine's `ComponentManager.create` consumes it. */
export type ChunkComponentRecord = { id: string; type: string } & Record<string, unknown>;

export interface ChunkPayload {
  schemaVersion: typeof SPATIAL_SCHEMA_VERSION;
  worldId: string;
  chunkKey: string;
  /** Insertion order is the authored order (the generator preserves it). */
  components: Record<string, ChunkComponentRecord>;
}

export interface ExpectedChunk {
  worldId: string;
  chunkKey: string;
}

export class ChunkPayloadError extends Error {
  readonly code: ChunkPayloadErrorCode;
  constructor(code: ChunkPayloadErrorCode, message: string) {
    super(message);
    this.name = "ChunkPayloadError";
    this.code = code;
  }
}

export type ChunkPayloadErrorCode =
  | "not-an-object"
  | "unsupported-schema-version"
  | "world-id-mismatch"
  | "chunk-key-mismatch"
  | "invalid-components"
  | "invalid-component"
  | "component-id-mismatch";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a raw chunk payload against what the caller asked for. Throws `ChunkPayloadError`
 * with a stable code; returns a fresh, plain copy on success.
 */
export function parseChunkPayload(input: unknown, expected: ExpectedChunk): ChunkPayload {
  if (!isRecord(input)) throw new ChunkPayloadError("not-an-object", "chunk payload is not an object");
  if (input.schemaVersion !== SPATIAL_SCHEMA_VERSION) {
    throw new ChunkPayloadError(
      "unsupported-schema-version",
      `unsupported chunk schema version ${String(input.schemaVersion)} (expected ${SPATIAL_SCHEMA_VERSION})`,
    );
  }
  if (input.worldId !== expected.worldId) {
    throw new ChunkPayloadError("world-id-mismatch", `chunk payload belongs to world "${String(input.worldId)}" (expected "${expected.worldId}")`);
  }
  if (input.chunkKey !== expected.chunkKey) {
    throw new ChunkPayloadError("chunk-key-mismatch", `chunk payload is "${String(input.chunkKey)}" (expected "${expected.chunkKey}")`);
  }
  if (!isRecord(input.components)) throw new ChunkPayloadError("invalid-components", "chunk payload components must be an object");

  const components: Record<string, ChunkComponentRecord> = {};
  for (const [id, record] of Object.entries(input.components)) {
    if (!isRecord(record) || typeof record.type !== "string" || record.type.length === 0) {
      throw new ChunkPayloadError("invalid-component", `chunk component "${id}" is malformed`);
    }
    if (record.id !== id) {
      throw new ChunkPayloadError("component-id-mismatch", `chunk component "${id}" declares id "${String(record.id)}"`);
    }
    components[id] = { ...record, id, type: record.type };
  }

  return { schemaVersion: SPATIAL_SCHEMA_VERSION, worldId: expected.worldId, chunkKey: expected.chunkKey, components };
}
