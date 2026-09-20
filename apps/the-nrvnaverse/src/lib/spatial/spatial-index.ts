import { isDestinationId } from "@nrvnaverse/manifest";
import type { PhysicalPlacement, PlacementRegistry, SpawnPoint } from "@/lib/spatial/placement-registry";

/**
 * Generated spatial index (`public/data/spatial/spatial-index.json`) — the derived physical
 * lookup produced by `scripts/spatial/cli.mjs` from the authoritative spatial source
 * (`spatial/source/*`). See docs/NRVNAVERSE_SPATIAL_DATA_PIPELINE.md.
 *
 *   destinationId → chunkKey → spawn        (allowed direction)
 *   chunkKey      → destination identity    (never; the manifest is canonical for identity, D-004)
 *
 * The index is generated, never hand-edited, and never coordinate-keyed. It carries no gates and
 * no destination metadata: gate truth stays in the manifest and is evaluated by the adapter
 * before any placement is used (D-006).
 *
 * Since M0 Step 2B.3 the index may carry an additive, optional `portals` section:
 *
 *   physical sensor componentId → { chunkKey (owner), destinationId (canonical target) }
 *
 * Keyed by the physical component id — a sensor handle, never identity. An index without
 * `portals` parses as an empty portal set (schema version unchanged).
 */
export const SPATIAL_SCHEMA_VERSION = 1;

export interface SpatialIndexChunk {
  /** Public URL of the generated chunk payload. Step 2B.2 fetches it — never before a gate passes. */
  dataUrl: string;
}

export interface SpatialIndexDestination {
  chunkKey: string;
  spawn: SpawnPoint;
}

/** Physical portal sensor → stable destination reference. No coordinates, no gates, no metadata. */
export interface SpatialIndexPortal {
  /** The chunk that owns the sensor component (it is staged and retired with that chunk). */
  chunkKey: string;
  /** Canonical navigation target; resolved through the manifest and the placement registry at travel time. */
  destinationId: string;
}

export interface SpatialIndexFile {
  schemaVersion: typeof SPATIAL_SCHEMA_VERSION;
  worldId: string;
  globalSceneUrl: string;
  chunks: Record<string, SpatialIndexChunk>;
  destinations: Record<string, SpatialIndexDestination>;
  /** Keyed by physical sensor component id. Empty when the index declares none. */
  portals: Record<string, SpatialIndexPortal>;
}

const CHUNK_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`spatial index is malformed: ${what} must be a finite number`);
  return value;
}

/**
 * Structural check of a loaded index. Throws with a clear message on anything unexpected so the
 * app fails at boot instead of teleporting to `NaN`. Returns a fresh, plain copy.
 */
export function parseSpatialIndex(input: unknown): SpatialIndexFile {
  if (!isRecord(input)) throw new Error("spatial index is malformed: not an object");
  if (input.schemaVersion !== SPATIAL_SCHEMA_VERSION) {
    throw new Error(`unsupported spatial schema version ${String(input.schemaVersion)} (expected ${SPATIAL_SCHEMA_VERSION})`);
  }
  if (typeof input.worldId !== "string" || input.worldId.length === 0) throw new Error("spatial index is malformed: worldId");
  if (typeof input.globalSceneUrl !== "string" || input.globalSceneUrl.length === 0) throw new Error("spatial index is malformed: globalSceneUrl");
  if (!isRecord(input.chunks) || !isRecord(input.destinations)) throw new Error("spatial index is malformed: chunks/destinations");

  const chunks: Record<string, SpatialIndexChunk> = {};
  for (const [chunkKey, chunk] of Object.entries(input.chunks)) {
    if (!CHUNK_KEY_PATTERN.test(chunkKey)) throw new Error(`spatial index is malformed: invalid chunk key "${chunkKey}"`);
    if (!isRecord(chunk) || typeof chunk.dataUrl !== "string") throw new Error(`spatial index is malformed: chunk "${chunkKey}"`);
    chunks[chunkKey] = { dataUrl: chunk.dataUrl };
  }

  const destinations: Record<string, SpatialIndexDestination> = {};
  for (const [destinationId, entry] of Object.entries(input.destinations)) {
    if (!isRecord(entry) || typeof entry.chunkKey !== "string") throw new Error(`spatial index is malformed: destination "${destinationId}"`);
    if (!(entry.chunkKey in chunks)) throw new Error(`spatial index is malformed: destination "${destinationId}" references unknown chunk "${entry.chunkKey}"`);
    if (!isRecord(entry.spawn) || !isRecord(entry.spawn.position)) throw new Error(`spatial index is malformed: destination "${destinationId}" spawn`);
    const p = entry.spawn.position;
    destinations[destinationId] = {
      chunkKey: entry.chunkKey,
      spawn: {
        position: { x: finite(p.x, `${destinationId} spawn.position.x`), y: finite(p.y, `${destinationId} spawn.position.y`), z: finite(p.z, `${destinationId} spawn.position.z`) },
        yaw: finite(entry.spawn.yaw, `${destinationId} spawn.yaw`),
      },
    };
  }

  // Additive since 2B.3: a missing `portals` field is an empty portal set.
  const portals: Record<string, SpatialIndexPortal> = {};
  if (input.portals !== undefined) {
    if (!isRecord(input.portals)) throw new Error("spatial index is malformed: portals must be an object keyed by component id");
    for (const [componentId, entry] of Object.entries(input.portals)) {
      if (componentId.length === 0 || !isRecord(entry)) throw new Error(`spatial index is malformed: portal "${componentId}"`);
      if (typeof entry.chunkKey !== "string" || !(entry.chunkKey in chunks)) {
        throw new Error(`spatial index is malformed: portal "${componentId}" references unknown chunk "${String(entry.chunkKey)}"`);
      }
      if (typeof entry.destinationId !== "string" || !isDestinationId(entry.destinationId)) {
        throw new Error(`spatial index is malformed: portal "${componentId}" destinationId is not a stable destination id`);
      }
      portals[componentId] = { chunkKey: entry.chunkKey, destinationId: entry.destinationId };
    }
  }

  return { schemaVersion: SPATIAL_SCHEMA_VERSION, worldId: input.worldId, globalSceneUrl: input.globalSceneUrl, chunks, destinations, portals };
}

/** Diagnostics handle derived from the chunk key. Not identity; never written to a URL. */
export function placementRefFor(chunkKey: string): string {
  return `chunk:${chunkKey}`;
}

/**
 * The placement registry the spatial adapter consumes, built from generated data only. There is
 * no hand-kept table of coordinates anywhere in the app: change a spawn in the spatial source,
 * regenerate, and this registry follows.
 */
export function registryFromSpatialIndex(index: SpatialIndexFile): PlacementRegistry {
  const registry: Record<string, PhysicalPlacement> = {};
  for (const [destinationId, entry] of Object.entries(index.destinations)) {
    registry[destinationId] = {
      worldId: index.worldId,
      chunkKey: entry.chunkKey,
      placementRef: placementRefFor(entry.chunkKey),
      spawn: entry.spawn,
    };
  }
  return registry;
}
