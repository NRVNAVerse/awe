// @ts-check
/**
 * NRVNAVerse spatial data pipeline — pure validation + deterministic generation (M0 Step 2B.1).
 *
 *   authoritative physical source (spatial/source/*)  ──▶ validate ──▶ generate ──▶
 *     public/data/static-scene.json            (compatibility full scene; validation/debugging only since 2B.2)
 *     public/data/spatial/global-scene.<v>.json     (components that exist independent of any chunk; content-addressed)
 *     public/data/spatial/chunks/<key>.<v>.json     (one file per logical M0 chunk; content-addressed)
 *     public/data/spatial/spatial-index.json        (derived physical lookup: destinationId → chunkKey → spawn,
 *                                                    physical portal sensor → destinationId bindings since 2B.3,
 *                                                    and the VERSION ROOT for the two lines above since 2B.4B.2)
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
 * - Portals (M0 Step 2B.3) are an OPTIONAL, additive part of schema v1: `portals[]` binds a
 *   physical sensor component (owned by exactly one chunk) to the stable destination id it
 *   navigates to. A binding is a reference only — no coordinates, spawn, URL, gate or metadata;
 *   the validator checks that the referenced component, chunk and destination exist and that the
 *   component is an enabled sensor, and never copies gate truth. A source without `portals` is
 *   still valid and yields an empty portal set.
 * - Versioned delivery (M0 Step 2B.4B.2): the index is the VERSION ROOT. Its own URL never
 *   changes and it is served short-lived / revalidated; the `globalSceneUrl` and every
 *   `chunks[key].dataUrl` it points at are CONTENT-ADDRESSED FILE PATHS: the file name itself
 *   carries `<v>`, the first 32 lowercase hex chars of SHA-256 over the exact serialized artifact,
 *   so the physical artifacts can be served `immutable` (see `next.config.ts`). The hash in a
 *   requested file name therefore always corresponds to the bytes stored in THAT file: after a
 *   deployment an old URL either still finds its old bytes or is a 404 — it can never be answered
 *   with new content (a query-only token, rejected in review, could not guarantee this because the
 *   query never selects bytes on the server). Changing a chunk's content changes its file name, so
 *   a browser cache entry for the old URL can never satisfy the new one, and the previous file is
 *   removed by `cli.mjs` (the generator owns every file matching {@link CONTENT_ADDRESSED_OUTPUT}).
 *   The token is opaque to the runtime (nothing parses it) and is not identity (D-004): chunk
 *   keys, destination ids and the schema version are untouched.
 * - Runtime assets (M1.0): an OPTIONAL, additive `assetRegistry` names the asset registry file
 *   next to the config (`assets.mjs`, docs/NRVNAVERSE_ASSET_PIPELINE.md). A scene component names a
 *   logical asset (`assetRef: "ast_…"`), never a binary URL; validation runs the NRVNAVerse rights /
 *   provenance gate and generation replaces `assetRef` with the current revision's content-addressed
 *   runtime URL in every generated artifact — so a new asset revision is a new chunk digest.
 *
 * This module has no I/O and no third-party dependencies (`node:crypto` only, for the content
 * digest). `cli.mjs` wires it to the file system; the vitest suite imports it directly.
 * Determinism: no timestamps, no random values, no machine paths, fixed key order (authored
 * envelopes are built in a fixed order; pass-through component objects keep the committed source
 * order), fixed 2-space JSON with a trailing newline; content versions depend on the serialized
 * artifact bytes alone.
 */

import { createHash } from "node:crypto";
import { assetExperimentalWarnings, assetGate, resolveAssetRefs, validateAssetRegistry, validateAssetStorageConfig } from "./assets.mjs";

export const SPATIAL_SCHEMA_VERSION = 1;

/**
 * Content version token: the first 32 lowercase hexadecimal characters (128 bits) of the SHA-256
 * digest of the exact UTF-8 artifact text written to disk. It is embedded in the artifact's FILE
 * NAME (`<base>.<token>.json`); `next.config.ts` keys the immutable cache policy on this exact shape.
 */
export const CONTENT_VERSION_LENGTH = 32;
export const CONTENT_VERSION_PATTERN = /^[0-9a-f]{32}$/;

/** Chunk keys double as file names: lowercase kebab-case, no path characters, bounded length. */
export const CHUNK_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHUNK_KEY_MAX_LENGTH = 64;

/** Mirrors `DESTINATION_ID_PATTERN` in `@nrvnaverse/manifest` (kept local so this file stays dependency-free). */
export const DESTINATION_ID_PATTERN = /^dst_[0-9abcdefghjkmnpqrstvwxyz]{16}$/;

/** The platform value a manifest must carry for a destination to be placeable in THE NRVNAVerse. */
export const THE_NRVNAVERSE_PLATFORM = "the-nrvnaverse";

/** Public URL prefix under which the generated artifacts are served (Next.js `public/data`). */
export const DATA_URL_PREFIX = "/data";

/**
 * Output locations, relative to `public/data/`. The compatibility scene and the index have fixed
 * names; the global scene and every chunk are content-addressed (`<base>.<token>.json`, see
 * {@link contentAddressedFileName}).
 */
export const OUTPUT = Object.freeze({
  compatibilityScene: "static-scene.json",
  spatialIndex: "spatial/spatial-index.json",
  /** `spatial/global-scene.<token>.json` */
  globalSceneBase: "spatial/global-scene",
  /** `spatial/chunks/<key>.<token>.json` */
  chunksDir: "spatial/chunks",
});

/**
 * The generator's ownership boundary for content-addressed outputs: a file whose name matches one
 * of these (relative to `public/data/`) was produced by a generation of this pipeline and nothing
 * else, so a stale one (a previous content version) may be removed by `cli.mjs`. Nothing outside
 * these two shapes is ever deleted. `[0-9a-f]{32}` is {@link CONTENT_VERSION_PATTERN};
 * `[a-z0-9]+(?:-[a-z0-9]+)*` is {@link CHUNK_KEY_PATTERN}.
 */
export const CONTENT_ADDRESSED_OUTPUT = Object.freeze({
  globalScene: /^spatial\/global-scene\.([0-9a-f]{32})\.json$/,
  chunk: /^spatial\/chunks\/([a-z0-9]+(?:-[a-z0-9]+)*)\.([0-9a-f]{32})\.json$/,
});

const CONFIG_KEYS = ["schemaVersion", "worldId", "scene", "assetRegistry", "assetStorage", "global", "chunks", "placements", "portals", "experience"];
const GLOBAL_KEYS = ["componentIds"];
const CHUNK_KEYS = ["key", "label", "componentIds"];
const PLACEMENT_KEYS = ["destinationId", "chunkKey", "spawn"];
const PORTAL_KEYS = ["componentId", "chunkKey", "destinationId"];
const SPAWN_KEYS = ["position", "yaw"];
const POSITION_KEYS = ["x", "y", "z"];
// Experience bindings (M1 experience campaign): visibility effects over authored component ids,
// triggered by sensor zones and by arrivals. References only — no coordinates, gates or metadata.
const EXPERIENCE_KEYS = ["hidden", "zones", "arrivals"];
const EXPERIENCE_HIDDEN_KEYS = ["chunkKey", "componentIds"];
const EXPERIENCE_ZONE_KEYS = ["id", "chunkKey", "sensorId", "enter", "exit"];
const EXPERIENCE_ARRIVAL_KEYS = ["id", "destinationId", "fromChunkKey", "beats"];
const EXPERIENCE_EFFECT_KEYS = ["show", "hide"];
const EXPERIENCE_BEAT_KEYS = ["afterSeconds", "show", "hide"];
const EXPERIENCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Longest arrival beat delay accepted (seconds): beats are arrival moments, not schedules. */
const EXPERIENCE_BEAT_MAX_SECONDS = 30;

/**
 * @typedef {{ x: number; y: number; z: number }} Position
 * @typedef {{ position: Position; yaw: number }} Spawn
 * @typedef {{ key: string; label: string; componentIds: string[] }} ChunkConfig
 * @typedef {{ destinationId: string; chunkKey: string; spawn: Spawn }} PlacementConfig
 * @typedef {{ componentId: string; chunkKey: string; destinationId: string }} PortalConfig
 * @typedef {{ show?: string[]; hide?: string[] }} ExperienceEffect
 * @typedef {{ afterSeconds: number; show?: string[]; hide?: string[] }} ExperienceBeat
 * @typedef {{ id: string; chunkKey: string; sensorId: string; enter?: ExperienceEffect; exit?: ExperienceEffect }} ExperienceZoneConfig
 * @typedef {{ id: string; destinationId: string; fromChunkKey?: string; beats: ExperienceBeat[] }} ExperienceArrivalConfig
 * @typedef {{ hidden?: Array<{ chunkKey: string; componentIds: string[] }>; zones?: ExperienceZoneConfig[]; arrivals?: ExperienceArrivalConfig[] }} ExperienceConfig
 * @typedef {{
 *   schemaVersion: number;
 *   worldId: string;
 *   scene: string;
 *   assetRegistry?: string;
 *   assetStorage?: import("./storage.mjs").AssetStorageConfig;
 *   global: { componentIds: string[] };
 *   chunks: ChunkConfig[];
 *   placements: PlacementConfig[];
 *   portals?: PortalConfig[];
 *   experience?: ExperienceConfig;
 * }} SpatialConfig
 * @typedef {{ components: Record<string, Record<string, unknown>>; [key: string]: unknown }} SceneFile
 * @typedef {{ id: string; status: string; gates?: unknown[]; spatialDestination: { platform: string; worldId?: string } | null }} DestinationRecord
 * @typedef {{ destinations: DestinationRecord[] }} DestinationsFile
 * @typedef {{ config: unknown; scene: unknown; destinations: unknown; assets?: unknown }} SpatialSourceInput
 *   `assets` is the parsed asset registry named by `config.assetRegistry` (null / absent when the
 *   config declares none or the file does not exist).
 * @typedef {{ code: string; path: string; message: string }} SpatialValidationError
 * @typedef {{ ok: true; errors: [] } | { ok: false; errors: SpatialValidationError[] }} SpatialValidationResult
 * @typedef {{
 *   files: Record<string, string>;
 *   versions: Record<string, string>;
 *   globalSceneFile: string;
 *   chunkFiles: Record<string, string>;
 *   chunkKeys: string[];
 *   destinationIds: string[];
 *   portalComponentIds: string[];
 *   experienceZoneIds: string[];
 *   experienceArrivalIds: string[];
 *   assetIds: string[];
 * }} SpatialArtifacts
 *   `files` is keyed by output file name relative to `public/data/` — the content-addressed names
 *   for the global scene and the chunks. `versions` maps each content-addressed file name to its
 *   token; `globalSceneFile` / `chunkFiles[key]` resolve the logical artifact to its current name.
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
  if (config.assetRegistry !== undefined && (!isNonEmptyString(config.assetRegistry) || !SAFE_FILE_NAME.test(config.assetRegistry))) {
    fail("invalid-asset-registry-ref", "config.assetRegistry", "assetRegistry must be a plain .json file name next to the config");
  }
  // Committed, non-secret storage backend configuration (public runtime origins; never credentials).
  if (config.assetStorage !== undefined) {
    for (const p of validateAssetStorageConfig(config.assetStorage)) fail("invalid-asset-storage", p.path, p.message);
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
  /** @type {Map<string, string>} destinationId → chunkKey (valid placements only; read by the experience validation) */
  const placementChunk = new Map();
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
      } else if (isNonEmptyString(destinationId) && placedIds.has(destinationId)) {
        placementChunk.set(destinationId, chunkKey);
      }
      validateSpawn(spawn, `${path}.spawn`, fail);
    });
  }
  /** @type {Set<string>} portal sensor component ids (valid or not; experience effects may never target them) */
  const portalComponentIds = new Set();

  // --- portals (optional, additive; M0 Step 2B.3) ---
  // physical sensor component → stable destination id. References only: the component must be
  // authored, owned by the declared chunk (never global) and configured as an enabled sensor; the
  // destination must be a THE NRVNAVerse destination of this world. Several portals may target
  // the same destination, a portal may target a destination in its own chunk, and a portal may
  // target a gated destination — the gate is the manifest's truth and is evaluated at travel time.
  if (config.portals !== undefined) {
    if (!Array.isArray(config.portals)) {
      fail("invalid-portals", "config.portals", "portals must be an array of { componentId, chunkKey, destinationId }");
    } else {
      /** @type {Set<string>} */
      const portalIds = new Set();
      config.portals.forEach((portal, i) => {
        const path = `config.portals[${i}]`;
        if (!isRecord(portal)) return fail("invalid-portal", path, "portal must be an object { componentId, chunkKey, destinationId }");
        for (const key of Object.keys(portal)) {
          if (!PORTAL_KEYS.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}" — a portal is componentId → chunkKey → destinationId only (no coordinates, spawns, URLs, gates or metadata)`);
        }
        const { componentId, chunkKey, destinationId } = portal;
        if (!isNonEmptyString(componentId)) {
          fail("invalid-component-ref", `${path}.componentId`, "portal componentId must be a non-empty string");
        } else if (portalIds.has(componentId)) {
          fail("duplicate-portal", `${path}.componentId`, `portal component "${componentId}" is bound more than once`);
        } else {
          portalIds.add(componentId);
          portalComponentIds.add(componentId);
          const component = sceneComponents[componentId];
          const owner = owners.get(componentId);
          if (!component) {
            fail("unknown-component", `${path}.componentId`, `portal component "${componentId}" does not exist in the scene`);
          } else {
            if (owner === "global") fail("global-portal-component", `${path}.componentId`, `portal component "${componentId}" is global; a portal must belong to the chunk in which it is encountered`);
            if (!isEnabledSensor(component)) fail("portal-not-sensor", `${path}.componentId`, `portal component "${componentId}" must have an enabled collider with isSensor: true`);
          }
          if (!isNonEmptyString(chunkKey) || !chunkKeys.has(chunkKey)) {
            fail("unknown-chunk", `${path}.chunkKey`, `chunk ${JSON.stringify(chunkKey)} is not declared in config.chunks`);
          } else if (component && owner !== undefined && owner !== "global" && owner !== `chunk:${chunkKey}`) {
            fail("portal-chunk-mismatch", `${path}.chunkKey`, `portal component "${componentId}" is owned by ${owner}, not by chunk "${chunkKey}"`);
          }
        }
        if (!isNonEmptyString(destinationId) || !DESTINATION_ID_PATTERN.test(destinationId)) {
          fail("invalid-destination-id", `${path}.destinationId`, `destinationId ${JSON.stringify(destinationId)} is not a stable destination id`);
        } else {
          const destination = destinationById.get(destinationId);
          if (!destination) {
            fail("unknown-destination", `${path}.destinationId`, `portal destination "${destinationId}" does not exist in the canonical destination set`);
          } else if (!destination.spatialDestination || destination.spatialDestination.platform !== THE_NRVNAVERSE_PLATFORM) {
            fail("portal-not-the-nrvnaverse", `${path}.destinationId`, `portal destination "${destinationId}" is not a THE NRVNAVerse spatial destination`);
          } else if (worldId !== null && destination.spatialDestination.worldId !== worldId) {
            fail("world-id-mismatch", `${path}.destinationId`, `portal destination "${destinationId}" belongs to world ${JSON.stringify(destination.spatialDestination.worldId)}, config world is "${worldId}"`);
          }
        }
      });
    }
  }

  // --- experience bindings (optional, additive; M1 experience campaign) ---
  // Visibility effects over authored component ids: `hidden` (state hidden when a chunk is
  // staged), `zones` (a sensor component → enter / exit effects) and `arrivals` (a destination →
  // timed beats, optionally only when arriving from another chunk). References only: every id
  // must be authored and owned by the chunk the binding belongs to (never global, never another
  // chunk), a zone sensor must be an enabled sensor, an arrival destination must be placed in
  // this world. No coordinates, spawns, gates, URLs or metadata — and no effect ever targets a
  // portal sensor, so navigation can never be hidden or revealed by an experience binding.
  // Every active THE NRVNAVerse destination in this world must have exactly one placement.
  let worldDestinations = 0;
  /** @type {Set<string>} active destinations of this world (a missing placement is reported once, here) */
  const activeWorldDestinationIds = new Set();
  for (const destination of destinationById.values()) {
    const spatial = destination.spatialDestination;
    if (!spatial || spatial.platform !== THE_NRVNAVERSE_PLATFORM) continue;
    if (worldId !== null && spatial.worldId !== worldId) continue;
    worldDestinations += 1;
    if (destination.status === "active") {
      activeWorldDestinationIds.add(destination.id);
      if (!placedIds.has(destination.id)) fail("missing-placement", `config.placements`, `active destination "${destination.id}" has no placement`);
    }
  }

  if (config.experience !== undefined) {
    validateExperience(config.experience, { sceneComponents, owners, chunkKeys, destinationById, placementChunk, placedIds, activeWorldDestinationIds, portalIds: portalComponentIds, worldId }, fail);
  }
  if (worldId !== null && destinationById.size > 0 && worldDestinations === 0) {
    fail("world-id-mismatch", "config.worldId", `no THE NRVNAVerse destination declares worldId "${worldId}"`);
  }

  // --- runtime assets (optional, additive; M1.0) ---
  // A declared registry that is missing or invalid is reported once, above the references: gating
  // each reference against it would only repeat the same problem as misleading follow-on errors.
  const registry = loadedRegistry(config, input.assets, fail);
  if (config.assetRegistry === undefined || registry !== null) {
    for (const e of assetGate({ components: sceneComponents, registry, storage: storageConfigOf(config) }).errors) fail(e.code, e.path, e.message);
  }

  // --- gated delivery (M1 asset-delivery architecture) ---
  // Chunk data and external-cas objects are publicly fetchable; nothing is access-controlled today.
  // A chunk that serves ANY gated destination (manifest `gates.length > 0`) therefore never carries
  // an `assetRef`. Gate truth comes from the manifest and chunk membership from the placements, so
  // the rule holds for every future gated destination. `asset:place` refuses the same case up front.
  /** @type {Map<string, string[]>} chunk key → gated destination ids it serves */
  const gatedChunks = new Map();
  if (Array.isArray(config.placements)) {
    for (const placement of config.placements) {
      if (!isRecord(placement) || !isNonEmptyString(placement.chunkKey) || !isNonEmptyString(placement.destinationId)) continue;
      const destination = destinationById.get(placement.destinationId);
      if (!destination || !Array.isArray(destination.gates) || destination.gates.length === 0) continue;
      gatedChunks.set(placement.chunkKey, [...(gatedChunks.get(placement.chunkKey) ?? []), destination.id]);
    }
  }
  for (const [componentId, component] of Object.entries(sceneComponents)) {
    if (!("assetRef" in component)) continue;
    const owner = owners.get(componentId);
    if (owner === undefined || !owner.startsWith("chunk:")) continue;
    const gatedIds = gatedChunks.get(owner.slice("chunk:".length));
    if (gatedIds) {
      fail("asset-in-gated-chunk", `scene.components.${componentId}.assetRef`, `"${componentId}" carries an assetRef in ${owner}, which serves gated destination(s) ${gatedIds.join(", ")}; gated chunk data is not access-controlled, so runtime assets are never delivered there`);
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/**
 * The committed storage backend configuration, or null.
 * @param {Record<string, unknown> | SpatialConfig} config
 * @returns {import("./storage.mjs").AssetStorageConfig | null}
 */
function storageConfigOf(config) {
  return isRecord(config.assetStorage) ? /** @type {import("./storage.mjs").AssetStorageConfig} */ (config.assetStorage) : null;
}

/**
 * The asset registry the config declares, structurally validated; null when none is declared or it
 * is invalid (the reasons are reported through `fail`).
 * @param {Record<string, unknown>} config
 * @param {unknown} assets
 * @param {(code: string, path: string, message: string) => void} fail
 * @returns {import("./assets.mjs").AssetRegistry | null}
 */
function loadedRegistry(config, assets, fail) {
  if (config.assetRegistry === undefined) return null;
  if (assets === null || assets === undefined) {
    fail("missing-asset-registry", "config.assetRegistry", `asset registry ${JSON.stringify(config.assetRegistry)} was declared but not found`);
    return null;
  }
  const registryErrors = validateAssetRegistry(assets);
  for (const e of registryErrors) fail(e.code, e.path, e.message);
  return registryErrors.length === 0 ? /** @type {import("./assets.mjs").AssetRegistry} */ (assets) : null;
}

/**
 * Non-fatal asset findings for a VALID source: internal-tracer notices and the M1 experimental
 * warning bands (`assets.mjs`). Never fails anything; `spatial:check` prints them.
 * @param {SpatialSourceInput} input
 * @returns {import("./assets.mjs").AssetIssue[]}
 */
export function spatialAssetWarnings(input) {
  const config = /** @type {SpatialConfig} */ (input.config);
  const scene = /** @type {SceneFile} */ (input.scene);
  if (config.assetRegistry === undefined || !isRecord(input.assets)) return [];
  const registry = /** @type {import("./assets.mjs").AssetRegistry} */ (input.assets);
  const gate = assetGate({ components: scene.components, registry, storage: storageConfigOf(config) });
  return [...gate.warnings, ...assetExperimentalWarnings(registry, gate.referencedAssetIds)];
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
 * Experience bindings validation (M1 experience campaign). Pure reference checks; see the comment
 * at the call site. `ctx.owners` maps component id → "global" | "chunk:<key>".
 * @param {unknown} experience
 * @param {{
 *   sceneComponents: Record<string, Record<string, unknown>>;
 *   owners: Map<string, string>;
 *   chunkKeys: Set<string>;
 *   destinationById: Map<string, DestinationRecord>;
 *   placementChunk: Map<string, string>;
 *   placedIds: Set<string>;
 *   activeWorldDestinationIds: Set<string>;
 *   portalIds: Set<string>;
 *   worldId: string | null;
 * }} ctx
 * @param {(code: string, path: string, message: string) => void} fail
 */
function validateExperience(experience, ctx, fail) {
  if (!isRecord(experience)) return fail("invalid-experience", "config.experience", "experience must be an object { hidden?, zones?, arrivals? }");
  for (const key of Object.keys(experience)) {
    if (!EXPERIENCE_KEYS.includes(key)) fail("unexpected-field", `config.experience.${key}`, `unexpected field "${key}" — experience carries hidden / zones / arrivals only`);
  }

  /**
   * Every id of an effect list must be an authored component owned by `chunkKey` and never a portal sensor.
   * @param {unknown} ids @param {string} path @param {string | null} chunkKey
   */
  const checkTargets = (ids, path, chunkKey) => {
    if (!Array.isArray(ids)) return fail("invalid-experience-targets", path, "must be an array of component ids");
    if (ids.length === 0) fail("invalid-experience-targets", path, "must name at least one component id");
    /** @type {Set<string>} */
    const seen = new Set();
    ids.forEach((id, i) => {
      const p = `${path}[${i}]`;
      if (!isNonEmptyString(id)) return fail("invalid-component-ref", p, "component id must be a non-empty string");
      if (seen.has(id)) return fail("duplicate-component-ref", p, `component "${id}" is listed twice`);
      seen.add(id);
      if (!(id in ctx.sceneComponents)) return fail("unknown-component", p, `component "${id}" does not exist in the scene`);
      if (ctx.portalIds.has(id)) return fail("experience-targets-portal", p, `component "${id}" is a portal sensor; navigation is never hidden or revealed by an experience effect`);
      const owner = ctx.owners.get(id);
      if (owner === "global") return fail("global-experience-target", p, `component "${id}" is global; experience effects act on chunk components only`);
      if (chunkKey !== null && owner !== undefined && owner !== `chunk:${chunkKey}`) {
        fail("experience-chunk-mismatch", p, `component "${id}" is owned by ${owner}, not by chunk "${chunkKey}"`);
      }
    });
  };
  /** @param {unknown} effect @param {string} path @param {string | null} chunkKey @param {string[]} allowedKeys */
  const checkEffect = (effect, path, chunkKey, allowedKeys) => {
    if (!isRecord(effect)) return fail("invalid-experience-effect", path, "effect must be an object { show?, hide? }");
    for (const key of Object.keys(effect)) {
      if (!allowedKeys.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}" — an effect is show / hide lists of component ids only`);
    }
    if (effect.show === undefined && effect.hide === undefined) fail("invalid-experience-effect", path, "effect must show or hide at least one component");
    if (effect.show !== undefined) checkTargets(effect.show, `${path}.show`, chunkKey);
    if (effect.hide !== undefined) checkTargets(effect.hide, `${path}.hide`, chunkKey);
    if (Array.isArray(effect.show) && Array.isArray(effect.hide)) {
      for (const id of effect.show) if (effect.hide.includes(id)) fail("experience-effect-conflict", path, `component "${String(id)}" is both shown and hidden by the same effect`);
    }
  };

  // hidden: per chunk, the components that start hidden when the chunk is staged.
  if (experience.hidden !== undefined) {
    if (!Array.isArray(experience.hidden)) {
      fail("invalid-experience-hidden", "config.experience.hidden", "hidden must be an array of { chunkKey, componentIds }");
    } else {
      /** @type {Set<string>} */
      const chunksSeen = new Set();
      experience.hidden.forEach((entry, i) => {
        const path = `config.experience.hidden[${i}]`;
        if (!isRecord(entry)) return fail("invalid-experience-hidden", path, "hidden entry must be an object { chunkKey, componentIds }");
        for (const key of Object.keys(entry)) {
          if (!EXPERIENCE_HIDDEN_KEYS.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}"`);
        }
        const chunkKey = isNonEmptyString(entry.chunkKey) && ctx.chunkKeys.has(entry.chunkKey) ? entry.chunkKey : null;
        if (chunkKey === null) fail("unknown-chunk", `${path}.chunkKey`, `chunk ${JSON.stringify(entry.chunkKey)} is not declared in config.chunks`);
        else if (chunksSeen.has(chunkKey)) fail("duplicate-experience-hidden", `${path}.chunkKey`, `chunk "${chunkKey}" has more than one hidden entry`);
        else chunksSeen.add(chunkKey);
        checkTargets(entry.componentIds, `${path}.componentIds`, chunkKey);
      });
    }
  }

  // zones: one sensor component → enter / exit effects within the sensor's chunk.
  if (experience.zones !== undefined) {
    if (!Array.isArray(experience.zones)) {
      fail("invalid-experience-zones", "config.experience.zones", "zones must be an array of { id, chunkKey, sensorId, enter?, exit? }");
    } else {
      /** @type {Set<string>} */
      const zoneIds = new Set();
      /** @type {Set<string>} */
      const sensorIds = new Set();
      experience.zones.forEach((zone, i) => {
        const path = `config.experience.zones[${i}]`;
        if (!isRecord(zone)) return fail("invalid-experience-zone", path, "zone must be an object { id, chunkKey, sensorId, enter?, exit? }");
        for (const key of Object.keys(zone)) {
          if (!EXPERIENCE_ZONE_KEYS.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}" — a zone is id, chunkKey, sensorId and enter / exit effects only`);
        }
        const { id, chunkKey, sensorId } = zone;
        if (!isNonEmptyString(id) || !EXPERIENCE_ID_PATTERN.test(id)) fail("invalid-experience-id", `${path}.id`, `zone id ${JSON.stringify(id)} must be lowercase kebab-case`);
        else if (zoneIds.has(id)) fail("duplicate-experience-id", `${path}.id`, `zone id "${id}" is declared more than once`);
        else zoneIds.add(id);
        const ownerChunk = isNonEmptyString(chunkKey) && ctx.chunkKeys.has(chunkKey) ? chunkKey : null;
        if (ownerChunk === null) fail("unknown-chunk", `${path}.chunkKey`, `chunk ${JSON.stringify(chunkKey)} is not declared in config.chunks`);
        if (!isNonEmptyString(sensorId)) {
          fail("invalid-component-ref", `${path}.sensorId`, "zone sensorId must be a non-empty string");
        } else if (sensorIds.has(sensorId)) {
          fail("duplicate-zone-sensor", `${path}.sensorId`, `sensor "${sensorId}" is bound by more than one zone`);
        } else {
          sensorIds.add(sensorId);
          const component = ctx.sceneComponents[sensorId];
          const owner = ctx.owners.get(sensorId);
          if (!component) {
            fail("unknown-component", `${path}.sensorId`, `zone sensor "${sensorId}" does not exist in the scene`);
          } else {
            if (ctx.portalIds.has(sensorId)) fail("zone-sensor-is-portal", `${path}.sensorId`, `zone sensor "${sensorId}" is a portal sensor; a portal routes travel and nothing else`);
            if (owner === "global") fail("global-zone-sensor", `${path}.sensorId`, `zone sensor "${sensorId}" is global; a zone belongs to the chunk in which it is encountered`);
            if (!isEnabledSensor(component)) fail("zone-not-sensor", `${path}.sensorId`, `zone sensor "${sensorId}" must have an enabled collider with isSensor: true`);
            if (ownerChunk !== null && owner !== undefined && owner !== "global" && owner !== `chunk:${ownerChunk}`) {
              fail("experience-chunk-mismatch", `${path}.chunkKey`, `zone sensor "${sensorId}" is owned by ${owner}, not by chunk "${ownerChunk}"`);
            }
          }
        }
        if (zone.enter === undefined && zone.exit === undefined) fail("invalid-experience-zone", path, "zone must declare an enter or an exit effect");
        if (zone.enter !== undefined) checkEffect(zone.enter, `${path}.enter`, ownerChunk, EXPERIENCE_EFFECT_KEYS);
        if (zone.exit !== undefined) checkEffect(zone.exit, `${path}.exit`, ownerChunk, EXPERIENCE_EFFECT_KEYS);
      });
    }
  }

  // arrivals: a placed destination → timed beats within the destination's chunk.
  if (experience.arrivals !== undefined) {
    if (!Array.isArray(experience.arrivals)) {
      fail("invalid-experience-arrivals", "config.experience.arrivals", "arrivals must be an array of { id, destinationId, fromChunkKey?, beats }");
    } else {
      /** @type {Set<string>} */
      const arrivalIds = new Set();
      experience.arrivals.forEach((arrival, i) => {
        const path = `config.experience.arrivals[${i}]`;
        if (!isRecord(arrival)) return fail("invalid-experience-arrival", path, "arrival must be an object { id, destinationId, fromChunkKey?, beats }");
        for (const key of Object.keys(arrival)) {
          if (!EXPERIENCE_ARRIVAL_KEYS.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}" — an arrival is id, destinationId, fromChunkKey and beats only`);
        }
        const { id, destinationId, fromChunkKey, beats } = arrival;
        if (!isNonEmptyString(id) || !EXPERIENCE_ID_PATTERN.test(id)) fail("invalid-experience-id", `${path}.id`, `arrival id ${JSON.stringify(id)} must be lowercase kebab-case`);
        else if (arrivalIds.has(id)) fail("duplicate-experience-id", `${path}.id`, `arrival id "${id}" is declared more than once`);
        else arrivalIds.add(id);
        /** @type {string | null} */
        let chunkKey = null;
        if (!isNonEmptyString(destinationId) || !DESTINATION_ID_PATTERN.test(destinationId)) {
          fail("invalid-destination-id", `${path}.destinationId`, `destinationId ${JSON.stringify(destinationId)} is not a stable destination id`);
        } else if (!ctx.destinationById.has(destinationId)) {
          fail("unknown-destination", `${path}.destinationId`, `arrival destination "${destinationId}" does not exist in the canonical destination set`);
        } else if (ctx.placementChunk.has(destinationId)) {
          chunkKey = /** @type {string} */ (ctx.placementChunk.get(destinationId));
        } else if (!ctx.placedIds.has(destinationId) && !ctx.activeWorldDestinationIds.has(destinationId)) {
          // An active destination of this world without a placement is already `missing-placement`; a
          // placement that exists but is invalid is already reported on the placement. Only a
          // destination that legitimately has no placement here (draft / hidden / other platform) is
          // an arrival error in its own right. Target chunk checks are skipped when the chunk is unknown.
          fail("arrival-not-placed", `${path}.destinationId`, `arrival destination "${destinationId}" has no placement in this world`);
        }
        if (fromChunkKey !== undefined) {
          if (!isNonEmptyString(fromChunkKey) || !ctx.chunkKeys.has(fromChunkKey)) fail("unknown-chunk", `${path}.fromChunkKey`, `chunk ${JSON.stringify(fromChunkKey)} is not declared in config.chunks`);
          else if (chunkKey !== null && fromChunkKey === chunkKey) fail("invalid-experience-arrival", `${path}.fromChunkKey`, `fromChunkKey "${fromChunkKey}" is the destination's own chunk; a cross-chunk arrival rule must name another chunk`);
        }
        if (!Array.isArray(beats) || beats.length === 0) {
          fail("invalid-experience-beats", `${path}.beats`, "beats must be a non-empty array of { afterSeconds, show?, hide? }");
        } else {
          let previous = -1;
          beats.forEach((beat, j) => {
            const p = `${path}.beats[${j}]`;
            if (!isRecord(beat)) return fail("invalid-experience-beat", p, "beat must be an object { afterSeconds, show?, hide? }");
            for (const key of Object.keys(beat)) {
              if (!EXPERIENCE_BEAT_KEYS.includes(key)) fail("unexpected-field", `${p}.${key}`, `unexpected field "${key}"`);
            }
            const after = beat.afterSeconds;
            if (!isFiniteNumber(after) || after < 0 || after > EXPERIENCE_BEAT_MAX_SECONDS) {
              fail("invalid-experience-beat", `${p}.afterSeconds`, `afterSeconds must be a finite number between 0 and ${EXPERIENCE_BEAT_MAX_SECONDS}`);
            } else if (after < previous) {
              fail("invalid-experience-beat", `${p}.afterSeconds`, "beats must be listed in non-decreasing time order");
            } else {
              previous = after;
            }
            checkEffect({ show: beat.show, hide: beat.hide }, p, chunkKey, EXPERIENCE_EFFECT_KEYS);
          });
        }
      });
    }
  }
}

/**
 * A portal trigger must be an official sensor collider: enabled, `isSensor: true`. The rigid body
 * type and collider shape are left to the engine factories (any enabled sensor shape works).
 * @param {Record<string, unknown>} component
 */
function isEnabledSensor(component) {
  const collider = component.collider;
  return isRecord(collider) && collider.enabled === true && collider.isSensor === true;
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
 * Deterministic content version of a serialized artifact: SHA-256 over the exact UTF-8 text,
 * truncated to the first 32 lowercase hex characters. Same text → same token; any byte change →
 * a different token. Nothing else (paths, times, source order) participates.
 * @param {string} serialized the exact artifact text as written to disk
 */
export function contentVersion(serialized) {
  return createHash("sha256").update(serialized, "utf8").digest("hex").slice(0, CONTENT_VERSION_LENGTH);
}

/**
 * Content-addressed output file name: `<base>.<token>.json`, relative to `public/data/`. The token
 * is part of the name, so the name identifies exactly one artifact content.
 * @param {string} base `OUTPUT.globalSceneBase` or `${OUTPUT.chunksDir}/<key>`
 * @param {string} version token from {@link contentVersion}
 */
export function contentAddressedFileName(base, version) {
  return `${base}.${version}.json`;
}

/**
 * Public delivery URL of an output file: the file path under `/data`, nothing else — no query, no
 * runtime construction. The runtime treats the whole string as an opaque URL.
 * @param {string} fileName output file name relative to `public/data/`
 */
export function dataUrl(fileName) {
  return `${DATA_URL_PREFIX}/${fileName}`;
}

/**
 * Whether a `public/data/`-relative file name is a content-addressed output of this pipeline
 * (any content version, current or stale). See {@link CONTENT_ADDRESSED_OUTPUT}.
 * @param {string} fileName
 */
export function isContentAddressedOutput(fileName) {
  return CONTENT_ADDRESSED_OUTPUT.globalScene.test(fileName) || CONTENT_ADDRESSED_OUTPUT.chunk.test(fileName);
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
  const authoredScene = /** @type {SceneFile} */ (input.scene);
  // Runtime assets: every `assetRef` becomes the current revision's content-addressed URL in EVERY
  // generated artifact (validation above guarantees each reference resolves).
  const registry = config.assetRegistry === undefined ? null : /** @type {import("./assets.mjs").AssetRegistry} */ (input.assets);
  const storage = storageConfigOf(config);
  const assetIds = assetGate({ components: authoredScene.components, registry, storage }).referencedAssetIds;
  const resolvedComponents = resolveAssetRefs(authoredScene.components, registry, storage);
  /** @type {SceneFile} */
  const scene = /** @type {SceneFile} */ ({});
  for (const [key, value] of Object.entries(authoredScene)) scene[key] = key === "components" ? resolvedComponents : value;

  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Record<string, string>} content-addressed output file → token (global scene + chunks) */
  const versions = {};

  // A. Compatibility full scene — the authored scene with asset references resolved (identical to
  //    the authored scene when it references no assets). Validation/debugging output only
  //    since Step 2B.2 (the runtime never requests it); fixed name, not content-addressed.
  files[OUTPUT.compatibilityScene] = serializeArtifact(scene);

  // B. Global scene — the same envelope, only the components that exist independent of chunks.
  //    The text is serialized first and its NAME is derived from that exact text; the text never
  //    contains its own name or token, so there is no circularity.
  const globalIds = new Set(config.global.componentIds);
  const globalSceneText = serializeArtifact(withComponents(scene, (id) => globalIds.has(id)));
  const globalSceneFile = contentAddressedFileName(OUTPUT.globalSceneBase, contentVersion(globalSceneText));
  files[globalSceneFile] = globalSceneText;
  versions[globalSceneFile] = contentVersion(globalSceneText);

  // C. Chunk files — sorted by key; components keep the authored scene order. Each file is named
  //    `<key>.<token>.json` from its own serialized text, so a content change is a new file name
  //    (and a new URL) while an unchanged chunk keeps exactly the same name.
  const chunks = [...config.chunks].sort((a, b) => compareStrings(a.key, b.key));
  /** @type {Record<string, string>} chunk key → content-addressed file name */
  const chunkFiles = {};
  /** @type {Record<string, { dataUrl: string }>} */
  const chunkIndex = {};
  for (const chunk of chunks) {
    const memberIds = new Set(chunk.componentIds);
    const text = serializeArtifact({
      schemaVersion: SPATIAL_SCHEMA_VERSION,
      worldId: config.worldId,
      chunkKey: chunk.key,
      components: pickComponents(scene.components, (id) => memberIds.has(id)),
    });
    const fileName = contentAddressedFileName(`${OUTPUT.chunksDir}/${chunk.key}`, contentVersion(text));
    files[fileName] = text;
    versions[fileName] = contentVersion(text);
    chunkFiles[chunk.key] = fileName;
    chunkIndex[chunk.key] = { dataUrl: dataUrl(fileName) };
  }

  // D. Spatial index — derived physical lookup and version root. Not identity: the manifest stays
  //    canonical. Served at a fixed, unversioned URL (short-lived / revalidated); it points at the
  //    immutable content-addressed artifact paths built above (the index depends on the artifacts,
  //    never the reverse).
  const placements = [...config.placements].sort((a, b) => compareStrings(a.destinationId, b.destinationId));
  /** @type {Record<string, { chunkKey: string; spawn: Spawn }>} */
  const destinationIndex = {};
  for (const p of placements) {
    destinationIndex[p.destinationId] = {
      chunkKey: p.chunkKey,
      spawn: { position: { x: p.spawn.position.x, y: p.spawn.position.y, z: p.spawn.position.z }, yaw: p.spawn.yaw },
    };
  }
  // E. Portal bindings — physical sensor component → stable destination id, keyed by the physical
  //    component id (never identity) and sorted for determinism. No coordinates, gates or metadata:
  //    the sensor geometry lives in the chunk payload, gate truth in the manifest.
  const portals = [...(config.portals ?? [])].sort((a, b) => compareStrings(a.componentId, b.componentId));
  /** @type {Record<string, { chunkKey: string; destinationId: string }>} */
  const portalIndex = {};
  for (const portal of portals) {
    portalIndex[portal.componentId] = { chunkKey: portal.chunkKey, destinationId: portal.destinationId };
  }

  // F. Experience bindings — hidden-on-stage sets per chunk, zones keyed by zone id and arrivals
  //    keyed by arrival id, every list sorted for determinism. Component ids only: no coordinates
  //    (the zone sensor geometry lives in the chunk payload), no gates, no metadata.
  const experienceIndex = experienceIndexOf(config.experience);

  files[OUTPUT.spatialIndex] = serializeArtifact({
    schemaVersion: SPATIAL_SCHEMA_VERSION,
    worldId: config.worldId,
    globalSceneUrl: dataUrl(globalSceneFile),
    chunks: chunkIndex,
    destinations: destinationIndex,
    portals: portalIndex,
    experience: experienceIndex,
  });

  return {
    files,
    versions,
    globalSceneFile,
    chunkFiles,
    chunkKeys: chunks.map((c) => c.key),
    destinationIds: placements.map((p) => p.destinationId),
    portalComponentIds: portals.map((p) => p.componentId),
    experienceZoneIds: Object.keys(experienceIndex.zones),
    experienceArrivalIds: Object.keys(experienceIndex.arrivals),
    assetIds,
  };
}

/**
 * Deterministic index form of the (validated) experience bindings. A source without `experience`
 * yields empty sets, so consumers never special-case its absence.
 * @param {ExperienceConfig | undefined} experience
 */
export function experienceIndexOf(experience) {
  const sortedIds = (/** @type {string[] | undefined} */ ids) => (ids === undefined ? undefined : [...ids].sort(compareStrings));
  /** @param {ExperienceEffect} effect */
  const effectOf = (effect) => {
    /** @type {{ show?: string[]; hide?: string[] }} */
    const out = {};
    const show = sortedIds(effect.show);
    const hide = sortedIds(effect.hide);
    if (show !== undefined) out.show = show;
    if (hide !== undefined) out.hide = hide;
    return out;
  };
  /** @type {Record<string, string[]>} */
  const hidden = {};
  for (const entry of [...(experience?.hidden ?? [])].sort((a, b) => compareStrings(a.chunkKey, b.chunkKey))) {
    hidden[entry.chunkKey] = [...entry.componentIds].sort(compareStrings);
  }
  /** @type {Record<string, { chunkKey: string; sensorId: string; enter?: { show?: string[]; hide?: string[] }; exit?: { show?: string[]; hide?: string[] } }>} */
  const zones = {};
  for (const zone of [...(experience?.zones ?? [])].sort((a, b) => compareStrings(a.id, b.id))) {
    /** @type {{ chunkKey: string; sensorId: string; enter?: { show?: string[]; hide?: string[] }; exit?: { show?: string[]; hide?: string[] } }} */
    const entry = { chunkKey: zone.chunkKey, sensorId: zone.sensorId };
    if (zone.enter !== undefined) entry.enter = effectOf(zone.enter);
    if (zone.exit !== undefined) entry.exit = effectOf(zone.exit);
    zones[zone.id] = entry;
  }
  /** @type {Record<string, { destinationId: string; fromChunkKey?: string; beats: Array<{ afterSeconds: number; show?: string[]; hide?: string[] }> }>} */
  const arrivals = {};
  for (const arrival of [...(experience?.arrivals ?? [])].sort((a, b) => compareStrings(a.id, b.id))) {
    /** @type {{ destinationId: string; fromChunkKey?: string; beats: Array<{ afterSeconds: number; show?: string[]; hide?: string[] }> }} */
    const entry = { destinationId: arrival.destinationId, beats: arrival.beats.map((b) => ({ afterSeconds: b.afterSeconds, ...effectOf(b) })) };
    if (arrival.fromChunkKey !== undefined) entry.fromChunkKey = arrival.fromChunkKey;
    arrivals[arrival.id] = entry;
  }
  return { hidden, zones, arrivals };
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
