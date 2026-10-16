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
 *
 * Since M0 Step 2B.4B.2 the index is also the VERSION ROOT of the physical artifacts:
 * `globalSceneUrl` and every `chunks[key].dataUrl` are opaque delivery URLs of CONTENT-ADDRESSED
 * files (`global-scene.<digest>.json`, `chunks/<key>.<digest>.json`) so the server can mark them
 * immutable. The runtime passes them to `fetch` untouched — nothing here or downstream parses,
 * derives or reconstructs a file name or digest, and they never appear in a navigation URL (that
 * contract is `?destination=<stable-id>` only).
 */
export const SPATIAL_SCHEMA_VERSION = 1;

export interface SpatialIndexChunk {
  /**
   * Public URL of the generated chunk payload, exactly as the pipeline emitted it (a
   * content-addressed path). Step 2B.2 fetches it — never before a gate passes. Opaque: not parsed.
   */
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

/** A visibility effect: component ids to show and / or hide (each list sorted by the generator). */
export interface ExperienceEffect {
  show?: readonly string[];
  hide?: readonly string[];
}

/** A sensor zone of one chunk: the player entering / leaving the sensor applies the effects. */
export interface SpatialIndexZone {
  chunkKey: string;
  /** The authored sensor component (never a portal sensor; validated by the pipeline). */
  sensorId: string;
  enter?: ExperienceEffect;
  exit?: ExperienceEffect;
}

/** One timed beat of an arrival sequence (`afterSeconds` from the committed arrival, non-decreasing). */
export interface ExperienceBeat extends ExperienceEffect {
  afterSeconds: number;
}

/** Arrival beats for a placed destination; with `fromChunkKey`, only when the visitor arrives from that chunk. */
export interface SpatialIndexArrival {
  destinationId: string;
  fromChunkKey?: string;
  beats: readonly ExperienceBeat[];
}

/**
 * Experience bindings (M1 experience campaign; additive): visibility effects over authored chunk
 * component ids. `hidden[chunkKey]` lists the components that start hidden when the chunk is
 * staged; zones and arrivals are keyed by their authored ids. No coordinates, gates or metadata.
 */
export interface SpatialIndexExperience {
  hidden: Record<string, readonly string[]>;
  zones: Record<string, SpatialIndexZone>;
  arrivals: Record<string, SpatialIndexArrival>;
}

export const EMPTY_EXPERIENCE: SpatialIndexExperience = Object.freeze({ hidden: {}, zones: {}, arrivals: {} });

/**
 * WEB↔SPATIAL threshold (M1 experience campaign, D-020): a physical sensor → the stable id whose
 * canonical web context is surfaced while the visitor stands in it. Same shape as a portal binding;
 * a threshold never travels and the pipeline refuses a portal sensor here.
 */
export interface SpatialIndexThreshold {
  chunkKey: string;
  destinationId: string;
}

/** A far-field layer (M2): an opaque content-addressed data file the application renders itself. */
export interface SpatialIndexLayer {
  dataUrl: string;
}

/**
 * The streaming grid (M2): walkable cells of `cellSize` metres centred on multiples of it, each
 * mapped to the chunk that holds it. `releases`: falling below `belowY` while `fromChunkKey` is
 * active hands the visitor to the cell underneath. `catchBelowY`: a visitor below this height is
 * returned to safety. Gated chunks are never cells (validated by the pipeline; re-checked at runtime).
 */
export interface SpatialIndexStreaming {
  cellSize: number;
  margin: number;
  /** "i,j" → chunk key. */
  cells: Record<string, string>;
  releases: ReadonlyArray<{ fromChunkKey: string; belowY: number }>;
  catchBelowY?: number;
}

export interface SpatialIndexFile {
  schemaVersion: typeof SPATIAL_SCHEMA_VERSION;
  worldId: string;
  globalSceneUrl: string;
  chunks: Record<string, SpatialIndexChunk>;
  destinations: Record<string, SpatialIndexDestination>;
  /** Keyed by physical sensor component id. Empty when the index declares none. */
  portals: Record<string, SpatialIndexPortal>;
  /** Experience bindings. Empty sets when the index declares none. */
  experience: SpatialIndexExperience;
  /** Keyed by physical sensor component id. Empty when the index declares none. */
  thresholds: Record<string, SpatialIndexThreshold>;
  /** Far-field layers by key (M2). Empty when the index declares none. */
  layers: Record<string, SpatialIndexLayer>;
  /** The streaming grid (M2), or null when the index declares none. */
  streaming: SpatialIndexStreaming | null;
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

  // Additive since the M1 experience campaign: a missing `experience` field is an empty binding set.
  const experience = parseExperience(input.experience, chunks, destinations, portals);

  // Additive (M1 experience campaign, D-020): thresholds share the portal shape; a missing field is an empty set.
  const thresholds: Record<string, SpatialIndexThreshold> = {};
  if (input.thresholds !== undefined) {
    if (!isRecord(input.thresholds)) throw new Error("spatial index is malformed: thresholds must be an object keyed by component id");
    for (const [componentId, entry] of Object.entries(input.thresholds)) {
      if (componentId.length === 0 || !isRecord(entry)) throw new Error(`spatial index is malformed: threshold "${componentId}"`);
      if (componentId in portals) throw new Error(`spatial index is malformed: threshold "${componentId}" is a portal sensor`);
      if (typeof entry.chunkKey !== "string" || !(entry.chunkKey in chunks)) {
        throw new Error(`spatial index is malformed: threshold "${componentId}" references unknown chunk "${String(entry.chunkKey)}"`);
      }
      if (typeof entry.destinationId !== "string" || !isDestinationId(entry.destinationId)) {
        throw new Error(`spatial index is malformed: threshold "${componentId}" destinationId is not a stable destination id`);
      }
      thresholds[componentId] = { chunkKey: entry.chunkKey, destinationId: entry.destinationId };
    }
  }

  // Additive (M2): far-field layers and the streaming grid.
  const layers: Record<string, SpatialIndexLayer> = {};
  if (input.layers !== undefined) {
    if (!isRecord(input.layers)) throw new Error("spatial index is malformed: layers must be an object keyed by layer key");
    for (const [key, entry] of Object.entries(input.layers)) {
      if (!CHUNK_KEY_PATTERN.test(key) || !isRecord(entry) || typeof entry.dataUrl !== "string" || entry.dataUrl.length === 0) throw new Error(`spatial index is malformed: layer "${key}"`);
      layers[key] = { dataUrl: entry.dataUrl };
    }
  }
  const streaming = parseStreaming(input.streaming, chunks);

  return { schemaVersion: SPATIAL_SCHEMA_VERSION, worldId: input.worldId, globalSceneUrl: input.globalSceneUrl, chunks, destinations, portals, experience, thresholds, layers, streaming };
}

function parseStreaming(input: unknown, chunks: Record<string, SpatialIndexChunk>): SpatialIndexStreaming | null {
  if (input === undefined) return null;
  if (!isRecord(input) || !isRecord(input.cells)) throw new Error("spatial index is malformed: streaming");
  const cellSize = finite(input.cellSize, "streaming.cellSize");
  const margin = finite(input.margin, "streaming.margin");
  if (cellSize <= 0 || margin < 0 || margin >= cellSize / 2) throw new Error("spatial index is malformed: streaming cellSize / margin");
  const cells: Record<string, string> = {};
  for (const [cell, chunkKey] of Object.entries(input.cells)) {
    if (!/^-?\d+,-?\d+$/.test(cell)) throw new Error(`spatial index is malformed: streaming cell "${cell}"`);
    if (typeof chunkKey !== "string" || !(chunkKey in chunks)) throw new Error(`spatial index is malformed: streaming cell "${cell}" references unknown chunk "${String(chunkKey)}"`);
    cells[cell] = chunkKey;
  }
  const releases: Array<{ fromChunkKey: string; belowY: number }> = [];
  if (input.releases !== undefined) {
    if (!Array.isArray(input.releases)) throw new Error("spatial index is malformed: streaming.releases");
    for (const r of input.releases) {
      if (!isRecord(r) || typeof r.fromChunkKey !== "string" || !(r.fromChunkKey in chunks)) throw new Error("spatial index is malformed: streaming release");
      releases.push({ fromChunkKey: r.fromChunkKey, belowY: finite(r.belowY, "streaming release belowY") });
    }
  }
  const out: SpatialIndexStreaming = { cellSize, margin, cells, releases };
  if (input.catchBelowY !== undefined) out.catchBelowY = finite(input.catchBelowY, "streaming.catchBelowY");
  return out;
}

const EXPERIENCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseIdList(value: unknown, what: string, portals: Record<string, SpatialIndexPortal>): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`spatial index is malformed: ${what} must be an array of component ids`);
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || id.length === 0) throw new Error(`spatial index is malformed: ${what} contains a non-id entry`);
    if (id in portals) throw new Error(`spatial index is malformed: ${what} targets the portal sensor "${id}"`);
    ids.push(id);
  }
  return ids;
}

function parseEffect(value: unknown, what: string, portals: Record<string, SpatialIndexPortal>): ExperienceEffect {
  if (!isRecord(value)) throw new Error(`spatial index is malformed: ${what} must be an effect object`);
  const effect: ExperienceEffect = {};
  if (value.show !== undefined) effect.show = parseIdList(value.show, `${what}.show`, portals);
  if (value.hide !== undefined) effect.hide = parseIdList(value.hide, `${what}.hide`, portals);
  if (effect.show === undefined && effect.hide === undefined) throw new Error(`spatial index is malformed: ${what} shows and hides nothing`);
  return effect;
}

function parseExperience(
  input: unknown,
  chunks: Record<string, SpatialIndexChunk>,
  destinations: Record<string, SpatialIndexDestination>,
  portals: Record<string, SpatialIndexPortal>,
): SpatialIndexExperience {
  if (input === undefined) return { hidden: {}, zones: {}, arrivals: {} };
  if (!isRecord(input)) throw new Error("spatial index is malformed: experience must be an object");
  const hidden: Record<string, readonly string[]> = {};
  if (input.hidden !== undefined) {
    if (!isRecord(input.hidden)) throw new Error("spatial index is malformed: experience.hidden must be an object keyed by chunk key");
    for (const [chunkKey, ids] of Object.entries(input.hidden)) {
      if (!(chunkKey in chunks)) throw new Error(`spatial index is malformed: experience.hidden references unknown chunk "${chunkKey}"`);
      hidden[chunkKey] = parseIdList(ids, `experience.hidden.${chunkKey}`, portals);
    }
  }
  const zones: Record<string, SpatialIndexZone> = {};
  if (input.zones !== undefined) {
    if (!isRecord(input.zones)) throw new Error("spatial index is malformed: experience.zones must be an object keyed by zone id");
    for (const [zoneId, entry] of Object.entries(input.zones)) {
      if (!EXPERIENCE_ID_PATTERN.test(zoneId) || !isRecord(entry)) throw new Error(`spatial index is malformed: zone "${zoneId}"`);
      if (typeof entry.chunkKey !== "string" || !(entry.chunkKey in chunks)) {
        throw new Error(`spatial index is malformed: zone "${zoneId}" references unknown chunk "${String(entry.chunkKey)}"`);
      }
      if (typeof entry.sensorId !== "string" || entry.sensorId.length === 0) throw new Error(`spatial index is malformed: zone "${zoneId}" has no sensorId`);
      if (entry.sensorId in portals) throw new Error(`spatial index is malformed: zone "${zoneId}" binds the portal sensor "${entry.sensorId}"`);
      const zone: SpatialIndexZone = { chunkKey: entry.chunkKey, sensorId: entry.sensorId };
      if (entry.enter !== undefined) zone.enter = parseEffect(entry.enter, `zone "${zoneId}".enter`, portals);
      if (entry.exit !== undefined) zone.exit = parseEffect(entry.exit, `zone "${zoneId}".exit`, portals);
      if (zone.enter === undefined && zone.exit === undefined) throw new Error(`spatial index is malformed: zone "${zoneId}" has no effect`);
      zones[zoneId] = zone;
    }
  }
  const arrivals: Record<string, SpatialIndexArrival> = {};
  if (input.arrivals !== undefined) {
    if (!isRecord(input.arrivals)) throw new Error("spatial index is malformed: experience.arrivals must be an object keyed by arrival id");
    for (const [arrivalId, entry] of Object.entries(input.arrivals)) {
      if (!EXPERIENCE_ID_PATTERN.test(arrivalId) || !isRecord(entry)) throw new Error(`spatial index is malformed: arrival "${arrivalId}"`);
      if (typeof entry.destinationId !== "string" || !isDestinationId(entry.destinationId) || !(entry.destinationId in destinations)) {
        throw new Error(`spatial index is malformed: arrival "${arrivalId}" references an unplaced destination`);
      }
      if (entry.fromChunkKey !== undefined && (typeof entry.fromChunkKey !== "string" || !(entry.fromChunkKey in chunks))) {
        throw new Error(`spatial index is malformed: arrival "${arrivalId}" references unknown chunk "${String(entry.fromChunkKey)}"`);
      }
      if (!Array.isArray(entry.beats) || entry.beats.length === 0) throw new Error(`spatial index is malformed: arrival "${arrivalId}" has no beats`);
      const beats: ExperienceBeat[] = [];
      let previous = -1;
      for (const [i, beat] of entry.beats.entries()) {
        if (!isRecord(beat)) throw new Error(`spatial index is malformed: arrival "${arrivalId}" beat ${i}`);
        const afterSeconds = finite(beat.afterSeconds, `arrival "${arrivalId}" beat ${i} afterSeconds`);
        if (afterSeconds < previous || afterSeconds < 0) throw new Error(`spatial index is malformed: arrival "${arrivalId}" beats are out of order`);
        previous = afterSeconds;
        beats.push({ afterSeconds, ...parseEffect({ show: beat.show, hide: beat.hide }, `arrival "${arrivalId}" beat ${i}`, portals) });
      }
      const arrival: SpatialIndexArrival = { destinationId: entry.destinationId, beats };
      if (entry.fromChunkKey !== undefined) arrival.fromChunkKey = entry.fromChunkKey as string;
      arrivals[arrivalId] = arrival;
    }
  }
  return { hidden, zones, arrivals };
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
