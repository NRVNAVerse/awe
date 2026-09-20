// @ts-check
/**
 * NRVNAVerse spatial data pipeline — pure validation + deterministic generation (M0 Step 2B.1).
 *
 *   authoritative physical source (spatial/source/*)  ──▶ validate ──▶ generate ──▶
 *     public/data/static-scene.json            (compatibility full scene, what Step 2A loads today)
 *     public/data/spatial/global-scene.json    (components that exist independent of any chunk)
 *     public/data/spatial/chunks/<key>.json    (one file per logical M0 chunk)
 *     public/data/spatial/spatial-index.json   (derived physical lookup: destinationId → chunkKey → spawn)
 *
 * Ownership rules (D-004, D-006, D-016):
 * - The destination manifest (`packages/nrvna-manifest`) is canonical for destination IDENTITY
 *   and metadata (names, URLs, categories, gates, age policy…). This pipeline only READS the
 *   generated destination set to verify that placements reference real destinations.
 * - The spatial source is authoritative only for PHYSICAL organisation: which authored
 *   components are global, which belong to which chunk, and where each destination spawns.
 * - `destinationId → chunkKey → spawn` is the only direction. A chunk key is a replaceable
 *   implementation detail and never identifies a destination.
 * - Gates are deliberately NOT representable here (`unexpected-field` rejects any extra key), so
 *   gate truth can only come from the manifest.
 *
 * This module has no I/O and no dependencies. `cli.mjs` wires it to the file system; the vitest
 * suite imports it directly. Determinism: no timestamps, no random values, no machine paths,
 * fixed key order (authored envelopes are built in a fixed order; pass-through component objects
 * keep the committed source order), fixed 2-space JSON with a trailing newline.
 */

export const SPATIAL_SCHEMA_VERSION = 1;

/** Chunk keys double as file names: lowercase kebab-case, no path characters, bounded length. */
export const CHUNK_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHUNK_KEY_MAX_LENGTH = 64;

/** Mirrors `DESTINATION_ID_PATTERN` in `@nrvnaverse/manifest` (kept local so this file stays dependency-free). */
export const DESTINATION_ID_PATTERN = /^dst_[0-9abcdefghjkmnpqrstvwxyz]{16}$/;

/** The platform value a manifest must carry for a destination to be placeable in THE NRVNAVerse. */
export const THE_NRVNAVERSE_PLATFORM = "the-nrvnaverse";

/** Public URL prefix under which the generated artifacts are served (Next.js `public/data`). */
export const DATA_URL_PREFIX = "/data";

/** Output file names, relative to `public/data/`. */
export const OUTPUT = Object.freeze({
  compatibilityScene: "static-scene.json",
  globalScene: "spatial/global-scene.json",
  spatialIndex: "spatial/spatial-index.json",
  chunksDir: "spatial/chunks",
});

const CONFIG_KEYS = ["schemaVersion", "worldId", "scene", "global", "chunks", "placements"];
const GLOBAL_KEYS = ["componentIds"];
const CHUNK_KEYS = ["key", "label", "componentIds"];
const PLACEMENT_KEYS = ["destinationId", "chunkKey", "spawn"];
const SPAWN_KEYS = ["position", "yaw"];
const POSITION_KEYS = ["x", "y", "z"];

/**
 * @typedef {{ x: number; y: number; z: number }} Position
 * @typedef {{ position: Position; yaw: number }} Spawn
 * @typedef {{ key: string; label: string; componentIds: string[] }} ChunkConfig
 * @typedef {{ destinationId: string; chunkKey: string; spawn: Spawn }} PlacementConfig
 * @typedef {{
 *   schemaVersion: number;
 *   worldId: string;
 *   scene: string;
 *   global: { componentIds: string[] };
 *   chunks: ChunkConfig[];
 *   placements: PlacementConfig[];
 * }} SpatialConfig
 * @typedef {{ components: Record<string, Record<string, unknown>>; [key: string]: unknown }} SceneFile
 * @typedef {{ id: string; status: string; spatialDestination: { platform: string; worldId?: string } | null }} DestinationRecord
 * @typedef {{ destinations: DestinationRecord[] }} DestinationsFile
 * @typedef {{ config: unknown; scene: unknown; destinations: unknown }} SpatialSourceInput
 * @typedef {{ code: string; path: string; message: string }} SpatialValidationError
 * @typedef {{ ok: true; errors: [] } | { ok: false; errors: SpatialValidationError[] }} SpatialValidationResult
 * @typedef {{ files: Record<string, string>; chunkKeys: string[]; destinationIds: string[] }} SpatialArtifacts
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Relative file name with no directory component and no traversal. */
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9._-]*\.json$/;

/**
 * Validate the authoritative spatial source against the scene it references and the canonical
 * destination set. Collects every error it can find (no early exit) with stable codes.
 *
 * @param {SpatialSourceInput} input
 * @returns {SpatialValidationResult}
 */
export function validateSpatialSource(input) {
  /** @type {SpatialValidationError[]} */
  const errors = [];
  /** @param {string} code @param {string} path @param {string} message */
  const fail = (code, path, message) => {
    errors.push({ code, path, message });
  };

  const { config, scene, destinations } = input;

  if (!isRecord(config)) {
    fail("invalid-config", "config", "spatial config must be a JSON object");
    return { ok: false, errors };
  }

  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) fail("unexpected-field", `config.${key}`, `unexpected field "${key}" — destination metadata and gates belong to the manifest, not the spatial config`);
  }

  if (config.schemaVersion !== SPATIAL_SCHEMA_VERSION) {
    fail("unsupported-schema-version", "config.schemaVersion", `unsupported spatial schema version ${JSON.stringify(config.schemaVersion)} (expected ${SPATIAL_SCHEMA_VERSION})`);
    return { ok: false, errors };
  }

  if (!isNonEmptyString(config.worldId)) fail("invalid-world-id", "config.worldId", "worldId must be a non-empty string");
  if (!isNonEmptyString(config.scene) || !SAFE_FILE_NAME.test(config.scene)) {
    fail("invalid-scene-ref", "config.scene", "scene must be a plain .json file name next to the config");
  }

  // --- scene ---
  /** @type {Record<string, Record<string, unknown>>} */
  let sceneComponents = {};
  if (!isRecord(scene) || !isRecord(scene.components)) {
    fail("invalid-scene", "scene", "scene must be a JSON object with a `components` object keyed by component id");
  } else {
    for (const [componentId, component] of Object.entries(scene.components)) {
      if (!isRecord(component)) {
        fail("invalid-scene", `scene.components.${componentId}`, "component must be an object");
        continue;
      }
      if (component.id !== componentId) fail("component-id-mismatch", `scene.components.${componentId}`, `component key "${componentId}" does not match its id ${JSON.stringify(component.id)}`);
      if (!isNonEmptyString(component.type)) fail("invalid-scene", `scene.components.${componentId}`, "component must declare a type");
      sceneComponents[componentId] = component;
    }
  }

  // --- destinations (canonical, read-only) ---
  /** @type {Map<string, DestinationRecord>} */
  const destinationById = new Map();
  if (!isRecord(destinations) || !Array.isArray(destinations.destinations)) {
    fail("invalid-destinations", "destinations", "canonical destination set must be a generated destinations.json object");
  } else {
    for (const d of destinations.destinations) {
      if (isRecord(d) && isNonEmptyString(d.id)) destinationById.set(d.id, /** @type {DestinationRecord} */ (d));
    }
  }

  // --- global membership ---
  /** @type {Map<string, string>} componentId → owner ("global" or "chunk:<key>") */
  const owners = new Map();
  /** @type {Set<string>} */
  const globalIds = new Set();
  if (!isRecord(config.global) || !Array.isArray(config.global.componentIds)) {
    fail("invalid-global", "config.global", "global.componentIds must be an array of component ids");
  } else {
    for (const key of Object.keys(config.global)) {
      if (!GLOBAL_KEYS.includes(key)) fail("unexpected-field", `config.global.${key}`, `unexpected field "${key}"`);
    }
    config.global.componentIds.forEach((componentId, i) => {
      const path = `config.global.componentIds[${i}]`;
      if (!isNonEmptyString(componentId)) return fail("invalid-component-ref", path, "component id must be a non-empty string");
      if (globalIds.has(componentId)) return fail("duplicate-component-ref", path, `component "${componentId}" is listed twice in global`);
      globalIds.add(componentId);
      if (!(componentId in sceneComponents)) return fail("unknown-component", path, `global component "${componentId}" does not exist in the scene`);
      owners.set(componentId, "global");
    });
  }

  // --- chunks ---
  /** @type {Set<string>} */
  const chunkKeys = new Set();
  if (!Array.isArray(config.chunks)) {
    fail("invalid-chunks", "config.chunks", "chunks must be an array");
  } else {
    config.chunks.forEach((chunk, i) => {
      const path = `config.chunks[${i}]`;
      if (!isRecord(chunk)) return fail("invalid-chunk", path, "chunk must be an object");
      for (const key of Object.keys(chunk)) {
        if (!CHUNK_KEYS.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}" — chunks carry physical membership only`);
      }
      const { key, label, componentIds } = chunk;
      if (!isNonEmptyString(key) || !CHUNK_KEY_PATTERN.test(key) || key.length > CHUNK_KEY_MAX_LENGTH) {
        fail("invalid-chunk-key", `${path}.key`, `chunk key ${JSON.stringify(key)} must be lowercase kebab-case (${CHUNK_KEY_PATTERN}) and at most ${CHUNK_KEY_MAX_LENGTH} characters`);
      } else if (chunkKeys.has(key)) {
        fail("duplicate-chunk-key", `${path}.key`, `duplicate chunk key "${key}"`);
      } else {
        chunkKeys.add(key);
      }
      if (!isNonEmptyString(label)) fail("invalid-chunk-label", `${path}.label`, "chunk label must be a non-empty string");
      if (!Array.isArray(componentIds)) return fail("invalid-chunk", `${path}.componentIds`, "componentIds must be an array");
      if (componentIds.length === 0) fail("empty-chunk", `${path}.componentIds`, `chunk "${String(key)}" owns no components`);
      const ownerLabel = `chunk:${String(key)}`;
      /** @type {Set<string>} */
      const seen = new Set();
      componentIds.forEach((componentId, j) => {
        const refPath = `${path}.componentIds[${j}]`;
        if (!isNonEmptyString(componentId)) return fail("invalid-component-ref", refPath, "component id must be a non-empty string");
        if (seen.has(componentId)) return fail("duplicate-component-ref", refPath, `component "${componentId}" is listed twice in chunk "${String(key)}"`);
        seen.add(componentId);
        if (!(componentId in sceneComponents)) return fail("unknown-component", refPath, `component "${componentId}" does not exist in the scene`);
        const owner = owners.get(componentId);
        if (owner === "global") return fail("global-component-in-chunk", refPath, `component "${componentId}" is global and cannot also belong to chunk "${String(key)}"`);
        if (owner !== undefined) return fail("component-in-multiple-chunks", refPath, `component "${componentId}" is already owned by ${owner}`);
        owners.set(componentId, ownerLabel);
      });
    });
  }

  for (const componentId of Object.keys(sceneComponents)) {
    if (!owners.has(componentId)) fail("unassigned-component", `scene.components.${componentId}`, `authored component "${componentId}" is neither global nor owned by a chunk`);
  }

  // --- placements ---
  const worldId = isNonEmptyString(config.worldId) ? config.worldId : null;
  /** @type {Set<string>} */
  const placedIds = new Set();
  if (!Array.isArray(config.placements)) {
    fail("invalid-placements", "config.placements", "placements must be an array");
  } else {
    config.placements.forEach((placement, i) => {
      const path = `config.placements[${i}]`;
      if (!isRecord(placement)) return fail("invalid-placement", path, "placement must be an object");
      for (const key of Object.keys(placement)) {
        if (!PLACEMENT_KEYS.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}" — a placement is destinationId → chunkKey → spawn only (no gates, names or URLs)`);
      }
      const { destinationId, chunkKey, spawn } = placement;
      if (!isNonEmptyString(destinationId) || !DESTINATION_ID_PATTERN.test(destinationId)) {
        fail("invalid-destination-id", `${path}.destinationId`, `destinationId ${JSON.stringify(destinationId)} is not a stable destination id`);
      } else if (placedIds.has(destinationId)) {
        fail("duplicate-placement", `${path}.destinationId`, `destination "${destinationId}" is placed more than once`);
      } else {
        placedIds.add(destinationId);
        const destination = destinationById.get(destinationId);
        if (!destination) {
          fail("unknown-destination", `${path}.destinationId`, `destination "${destinationId}" does not exist in the canonical destination set`);
        } else if (!destination.spatialDestination || destination.spatialDestination.platform !== THE_NRVNAVERSE_PLATFORM) {
          fail("placement-not-the-nrvnaverse", `${path}.destinationId`, `destination "${destinationId}" is not a THE NRVNAVerse spatial destination and cannot be placed here`);
        } else if (worldId !== null && destination.spatialDestination.worldId !== worldId) {
          fail("world-id-mismatch", `${path}.destinationId`, `destination "${destinationId}" belongs to world ${JSON.stringify(destination.spatialDestination.worldId)}, config world is "${worldId}"`);
        }
      }
      if (!isNonEmptyString(chunkKey) || !chunkKeys.has(chunkKey)) {
        fail("unknown-chunk", `${path}.chunkKey`, `chunk ${JSON.stringify(chunkKey)} is not declared in config.chunks`);
      }
      validateSpawn(spawn, `${path}.spawn`, fail);
    });
  }

  // Every active THE NRVNAVerse destination in this world must have exactly one placement.
  let worldDestinations = 0;
  for (const destination of destinationById.values()) {
    const spatial = destination.spatialDestination;
    if (!spatial || spatial.platform !== THE_NRVNAVERSE_PLATFORM) continue;
    if (worldId !== null && spatial.worldId !== worldId) continue;
    worldDestinations += 1;
    if (destination.status === "active" && !placedIds.has(destination.id)) {
      fail("missing-placement", `config.placements`, `active destination "${destination.id}" has no placement`);
    }
  }
  if (worldId !== null && destinationById.size > 0 && worldDestinations === 0) {
    fail("world-id-mismatch", "config.worldId", `no THE NRVNAVerse destination declares worldId "${worldId}"`);
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/**
 * @param {unknown} spawn
 * @param {string} path
 * @param {(code: string, path: string, message: string) => void} fail
 */
function validateSpawn(spawn, path, fail) {
  if (!isRecord(spawn)) return fail("invalid-spawn", path, "spawn must be an object { position, yaw }");
  for (const key of Object.keys(spawn)) {
    if (!SPAWN_KEYS.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}"`);
  }
  const { position, yaw } = spawn;
  if (!isRecord(position)) {
    fail("invalid-spawn", `${path}.position`, "spawn.position must be an object { x, y, z }");
  } else {
    for (const key of Object.keys(position)) {
      if (!POSITION_KEYS.includes(key)) fail("unexpected-field", `${path}.position.${key}`, `unexpected field "${key}"`);
    }
    for (const axis of POSITION_KEYS) {
      if (!isFiniteNumber(position[axis])) fail("invalid-spawn", `${path}.position.${axis}`, `spawn.position.${axis} must be a finite number`);
    }
  }
  if (!isFiniteNumber(yaw)) fail("invalid-orientation", `${path}.yaw`, "spawn.yaw (orientation around Y, radians) must be a finite number");
}

/**
 * Human-readable error list, one per line, stable order.
 * @param {SpatialValidationError[]} errors
 */
export function formatSpatialErrors(errors) {
  return errors.map((e) => `[${e.code}] ${e.path}: ${e.message}`).join("\n");
}

/**
 * Deterministic JSON: 2-space indentation, trailing newline, LF only.
 * @param {unknown} value
 */
export function serializeArtifact(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Validate, then build every generated artifact in memory. Throws on invalid input so a stale or
 * broken source can never produce partial output.
 *
 * @param {SpatialSourceInput} input
 * @returns {SpatialArtifacts}
 */
export function generateSpatialArtifacts(input) {
  const result = validateSpatialSource(input);
  if (!result.ok) {
    throw new Error(`spatial source is invalid:\n${formatSpatialErrors(result.errors)}`);
  }
  const config = /** @type {SpatialConfig} */ (input.config);
  const scene = /** @type {SceneFile} */ (input.scene);

  /** @type {Record<string, string>} */
  const files = {};

  // A. Compatibility full scene — exactly the authored scene. Step 2A keeps loading this until
  //    Step 2B.2 switches the runtime to global scene + chunks.
  files[OUTPUT.compatibilityScene] = serializeArtifact(scene);

  // B. Global scene — the same envelope, only the components that exist independent of chunks.
  const globalIds = new Set(config.global.componentIds);
  files[OUTPUT.globalScene] = serializeArtifact(withComponents(scene, (id) => globalIds.has(id)));

  // C. Chunk files — sorted by key; components keep the authored scene order.
  const chunks = [...config.chunks].sort((a, b) => compareStrings(a.key, b.key));
  /** @type {Record<string, { dataUrl: string }>} */
  const chunkIndex = {};
  for (const chunk of chunks) {
    const memberIds = new Set(chunk.componentIds);
    const fileName = `${OUTPUT.chunksDir}/${chunk.key}.json`;
    files[fileName] = serializeArtifact({
      schemaVersion: SPATIAL_SCHEMA_VERSION,
      worldId: config.worldId,
      chunkKey: chunk.key,
      components: pickComponents(scene.components, (id) => memberIds.has(id)),
    });
    chunkIndex[chunk.key] = { dataUrl: `${DATA_URL_PREFIX}/${fileName}` };
  }

  // D. Spatial index — derived physical lookup. Not identity: the manifest stays canonical.
  const placements = [...config.placements].sort((a, b) => compareStrings(a.destinationId, b.destinationId));
  /** @type {Record<string, { chunkKey: string; spawn: Spawn }>} */
  const destinationIndex = {};
  for (const p of placements) {
    destinationIndex[p.destinationId] = {
      chunkKey: p.chunkKey,
      spawn: { position: { x: p.spawn.position.x, y: p.spawn.position.y, z: p.spawn.position.z }, yaw: p.spawn.yaw },
    };
  }
  files[OUTPUT.spatialIndex] = serializeArtifact({
    schemaVersion: SPATIAL_SCHEMA_VERSION,
    worldId: config.worldId,
    globalSceneUrl: `${DATA_URL_PREFIX}/${OUTPUT.globalScene}`,
    chunks: chunkIndex,
    destinations: destinationIndex,
  });

  return { files, chunkKeys: chunks.map((c) => c.key), destinationIds: placements.map((p) => p.destinationId) };
}

/**
 * Same scene envelope (id, creatorId, editors, params, timestamps — all authored, none generated)
 * with a filtered component set.
 * @param {SceneFile} scene
 * @param {(componentId: string) => boolean} keep
 */
function withComponents(scene, keep) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(scene)) {
    out[key] = key === "components" ? pickComponents(scene.components, keep) : value;
  }
  return out;
}

/**
 * @param {Record<string, Record<string, unknown>>} components
 * @param {(componentId: string) => boolean} keep
 */
function pickComponents(components, keep) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const [id, component] of Object.entries(components)) {
    if (keep(id)) out[id] = component;
  }
  return out;
}

/**
 * Locale-independent ordering (code-unit order), so generation does not depend on the machine.
 * @param {string} a
 * @param {string} b
 */
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
