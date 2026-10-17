// @ts-check
/**
 * Compose authored destinations into the authoritative spatial source.
 *
 *   node spatial/authoring/compose.mjs [--check]
 *
 * For every chunk that has a composer here, the chunk's component set in `scene.m0.json` is
 * REPLACED by the composer's output (old components removed, new ones inserted at the position of
 * the first old one so the file diff stays local) and the chunk's `componentIds` in
 * `spatial-config.m0.json` is rewritten. A composer may also return an `experience` block
 * (`{ hidden, zones, arrivals }`, see `lib.mjs` `experienceOf`): its entries replace the config's
 * `experience` entries that belong to that chunk (hidden set by chunk key, zones by chunk key,
 * arrivals by their `destinationId`'s placement chunk). Nothing else in either file changes:
 * global components, other chunks, placements and portal bindings are untouched (portal
 * component ids must therefore be preserved by the composer — `spatial:validate` fails otherwise).
 *
 * Deterministic: same inputs → byte-identical outputs; `--check` exits 1 if the committed source
 * is not what composition would produce. Run `pnpm --filter the-nrvnaverse spatial:generate`
 * afterwards to regenerate the runtime artifacts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeHub } from "./hub.mjs";
import { composeMusic } from "./music.mjs";
import { composeFashion } from "./fashion.mjs";
import { composeClub } from "./club.mjs";
import { composeCannabis } from "./cannabis.mjs";
import { CHUNK_ORIGINS, CITY_CELLS, CITY_CELL_CHUNKS, CITY_DESTINATION_ID, buildCityLayer, cellKit, composeCityCell, proxyOf, streamingConfig } from "./city.mjs";
import { GALLERY_SPAWNS, galleryItemsFor, withoutExhibitions } from "./gallery.mjs";
import { collect } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "..", "source");
const scenePath = join(sourceDir, "scene.m0.json");
const configPath = join(sourceDir, "spatial-config.m0.json");
/** The far-field city layer source (composed; the pipeline content-addresses it). */
export const CITY_LAYER_SOURCE = "city-layer.m2.json";
const layerPath = join(sourceDir, CITY_LAYER_SOURCE);

/** chunk key → composer */
const COMPOSERS = {
  hub: composeHub,
  music: composeMusic,
  "fashion-culture": composeFashion,
  "music-club": composeClub,
  "cannabis-21": composeCannabis,
  ...Object.fromEntries(CITY_CELL_CHUNKS.map((c) => [c.chunkKey, () => withGalleries(c.chunkKey, composeCityCell(c.chunkKey))])),
};

/**
 * M3: a city cell plus the permanent galleries standing in it (shell + assigned exhibition), before
 * any portal (portals stay last in every chunk).
 * @param {string} chunkKey @param {{ components: Record<string, any> } & Record<string, any>} cell
 */
function withGalleries(chunkKey, cell) {
  const gallery = collect(galleryItemsFor(chunkKey));
  if (Object.keys(gallery).length === 0) return cell;
  const entries = Object.entries(cell.components);
  const firstPortal = entries.findIndex(([id]) => id.startsWith("portal-"));
  const at = firstPortal < 0 ? entries.length : firstPortal;
  for (const id of Object.keys(gallery)) if (id in cell.components) throw new Error(`gallery component "${id}" collides with the cell`);
  const components = Object.fromEntries([...entries.slice(0, at), ...Object.entries(gallery), ...entries.slice(at)]);
  return { ...cell, components, componentIds: Object.keys(components) };
}

/**
 * Spawns in each chunk's LOCAL authoring frame (M1 coordinates); `compose` writes the world spawn
 * (local + chunk origin) into the placements. Yaw 0 faces -Z.
 */
const LOCAL_SPAWNS = Object.freeze({
  dst_7g19n1vm9ackw8a0: { chunkKey: "hub", position: { x: 0, y: 1, z: 6 } },
  dst_gm3xs4a3tws7bgh3: { chunkKey: "music", position: { x: -70, y: 1, z: 6 } },
  dst_1qtfn9qjg9kf6jyd: { chunkKey: "music", position: { x: -70, y: 1, z: -34 } },
  dst_9c4wxtpec8awsx1q: { chunkKey: "fashion-culture", position: { x: 70, y: 1, z: 6 } },
  dst_tgfh5h5jvm3wj0w7: { chunkKey: "fashion-culture", position: { x: 70, y: 2, z: -36 } },
  dst_441dtdafq3e3ehjn: { chunkKey: "cannabis-21", position: { x: 0, y: 1, z: -114 } },
  dst_vfkz626za0vra89j: { chunkKey: "cannabis-21", position: { x: 0, y: 1, z: -154 } },
  dst_gqq90k2404cy9nf0: { chunkKey: "music-club", position: { x: -70, y: 1, z: 75.5 } },
  // The City lands on Skyfall Plaza, south of the landing ring, facing the sky lift and the Hub.
  [CITY_DESTINATION_ID]: { chunkKey: "city-plaza", position: { x: 0, y: 1, z: 40 } },
  // M3: permanent galleries arrive at their Blender spawn marker (world frame, authored yaw).
  ...GALLERY_SPAWNS,
});

/** M2 global atmosphere: the city needs a deeper fog and a safety ground below the streets. */
const GLOBAL_OVERRIDES = Object.freeze({
  // Late twilight: the sun just under the horizon so the city's window light carries the scene.
  background: { options: { type: "sky", skyOpts: { turbidity: 9, rayleigh: 2.6, mieCoefficient: 0.006, mieDirectionalG: 0.86, azimuth: 205, elevation: -0.6 } } },
  fog: { fadeColor: "#1d1c2c", near: 240, far: 2300 },
  // The terrain is a safety net only (the far-field layer draws the streets at y = 0).
  ground: { position: { x: 0, y: -3, z: 0 }, scale: { x: 760, y: 1, z: 760 } },
  lighting: { lightPosition: { x: -60, y: 260, z: 140 }, size: 420, far: 900 },
});

/** @param {number} n */
const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Translate every component of a composed chunk by its world origin (positions only; sizes and
 * rotations are frame-independent).
 * @param {Record<string, any>} components @param {{ x: number; y: number; z: number } | undefined} origin
 */
function translate(components, origin) {
  if (!origin) return components;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [id, c] of Object.entries(components)) {
    out[id] = c.position ? { ...c, position: { x: r3(c.position.x + origin.x), y: r3(c.position.y + origin.y), z: r3(c.position.z + origin.z) } } : c;
  }
  return out;
}

/** @param {Record<string, unknown>} obj */
const serialize = (obj) => JSON.stringify(obj, null, 2) + "\n";

export function compose() {
  const scene = JSON.parse(readFileSync(scenePath, "utf8"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  // Line endings are normalised so a Git `core.autocrlf` checkout on Windows is not reported as
  // stale (as in `spatial:check`); composition always writes LF.
  const sceneText = normalizeEol(readFileSync(scenePath, "utf8"));
  const configText = normalizeEol(readFileSync(configPath, "utf8"));

  /** destinationId → chunkKey, for assigning composed arrivals to their chunk. */
  const placementChunk = new Map(config.placements.map((p) => [p.destinationId, p.chunkKey]));
  /** @type {{ hidden: Array<{ chunkKey: string; componentIds: string[] }>; zones: Array<Record<string, unknown> & { chunkKey: string }>; arrivals: Array<Record<string, unknown> & { destinationId: string }> }} */
  const experience = { hidden: [...(config.experience?.hidden ?? [])], zones: [...(config.experience?.zones ?? [])], arrivals: [...(config.experience?.arrivals ?? [])] };
  let experienceTouched = false;
  /** @type {Array<{ componentId: string; chunkKey: string; destinationId: string }>} */
  let thresholds = [...(config.thresholds ?? [])];
  let thresholdsTouched = false;

  // M2: the walkable city cells are chunks too (appended once, in cell order).
  for (const cell of CITY_CELL_CHUNKS) {
    if (!config.chunks.some((/** @type {{ key: string }} */ c) => c.key === cell.chunkKey)) config.chunks.push({ key: cell.chunkKey, label: `City — ${cell.label}`, componentIds: [] });
  }
  /** @type {Record<string, Record<string, any>>} chunk key → final (world) components, for the proxies */
  const composedByChunk = {};
  /** @type {Array<{ componentId: string; chunkKey: string; destinationId: string }>} */
  const composedPortals = [];

  for (const chunk of config.chunks) {
    const composer = /** @type {Record<string, () => any>} */ (COMPOSERS)[chunk.key];
    if (!composer) continue;
    const raw = composer();
    const { experience: composed, thresholds: composedThresholds } = raw;
    for (const p of raw.portals ?? []) composedPortals.push({ componentId: p.componentId, chunkKey: chunk.key, destinationId: p.destinationId });
    // Into the world frame, then the city kit of district cells (before their portals, which stay last).
    let components = translate(raw.components, /** @type {Record<string, { x: number; y: number; z: number }>} */ (CHUNK_ORIGINS)[chunk.key]);
    const districtCell = CITY_CELLS.find((c) => c.chunkKey === chunk.key && !c.chunkKey.startsWith("city-"));
    if (districtCell) {
      const kit = Object.fromEntries(cellKit(chunk.key, /** @type {[number, number]} */ ([...districtCell.cell])).map((it) => [String(it.id), it]));
      const entries = Object.entries(components);
      const firstPortal = entries.findIndex(([id]) => id.startsWith("portal-"));
      const at = firstPortal < 0 ? entries.length : firstPortal;
      components = Object.fromEntries([...entries.slice(0, at), ...Object.entries(kit), ...entries.slice(at)]);
    }
    const componentIds = Object.keys(components);
    composedByChunk[chunk.key] = components;
    if (composedThresholds) {
      thresholdsTouched = true;
      thresholds = thresholds.filter((t) => t.chunkKey !== chunk.key).concat(composedThresholds.map((t) => ({ componentId: t.sensorId, chunkKey: chunk.key, destinationId: t.destinationId })));
    }
    if (composed) {
      experienceTouched = true;
      const chunkOf = (/** @type {string} */ destinationId) => placementChunk.get(destinationId);
      experience.hidden = experience.hidden.filter((h) => h.chunkKey !== chunk.key);
      if (composed.hidden.length > 0) experience.hidden.push({ chunkKey: chunk.key, componentIds: composed.hidden });
      experience.zones = experience.zones.filter((z) => z.chunkKey !== chunk.key).concat(composed.zones);
      experience.arrivals = experience.arrivals.filter((a) => chunkOf(a.destinationId) !== chunk.key).concat(composed.arrivals);
      for (const a of composed.arrivals) {
        if (chunkOf(a.destinationId) !== chunk.key) throw new Error(`composer "${chunk.key}" declares an arrival for "${a.destinationId}", which is not placed in that chunk`);
      }
    }
    const oldIds = new Set(chunk.componentIds);
    /** @type {Record<string, unknown>} */
    const next = {};
    let inserted = false;
    for (const [id, data] of Object.entries(scene.components)) {
      if (oldIds.has(id)) {
        if (!inserted) {
          Object.assign(next, components);
          inserted = true;
        }
        continue;
      }
      if (id in components) throw new Error(`composer "${chunk.key}" produced id "${id}" that already exists outside the chunk`);
      next[id] = data;
    }
    if (!inserted) Object.assign(next, components);
    scene.components = next;
    chunk.componentIds = componentIds;
  }

  // Spawns: local authoring frame + chunk origin (the composers own the geometry, so they own the spawns).
  /** @type {Map<string, any>} */
  const placements = new Map(config.placements.map((/** @type {any} */ p) => [p.destinationId, p]));
  for (const [destinationId, local] of Object.entries(LOCAL_SPAWNS)) {
    const o = /** @type {Record<string, { x: number; y: number; z: number }>} */ (CHUNK_ORIGINS)[local.chunkKey] ?? { x: 0, y: 0, z: 0 };
    const prev = placements.get(destinationId);
    placements.set(destinationId, {
      destinationId,
      chunkKey: local.chunkKey,
      spawn: { position: { x: r3(local.position.x + o.x), y: r3(local.position.y + o.y), z: r3(local.position.z + o.z) }, yaw: "yaw" in local ? r3(/** @type {number} */ (local.yaw)) : prev?.spawn.yaw ?? 0 },
    });
  }
  config.placements = [...placements.values()];

  // Portal bindings declared by composers (M2: the plaza's sky lift) join the hand-kept ones.
  for (const p of composedPortals) {
    config.portals = config.portals.filter((/** @type {{ componentId: string }} */ q) => q.componentId !== p.componentId).concat([p]);
  }

  // Global atmosphere for the city (deterministic overrides of the hand-authored globals).
  for (const [id, patch] of Object.entries(GLOBAL_OVERRIDES)) {
    if (scene.components[id]) scene.components[id] = { ...scene.components[id], ...patch };
  }

  // Far-field layer: proxies of every UNGATED composed chunk (state-B geometry excluded); the gated
  // compound is a neutral shell inside the layer, never derived from its payload.
  const hiddenByChunk = new Map(experience.hidden.map((h) => [h.chunkKey, new Set(h.componentIds)]));
  /** @type {Record<string, Array<Array<number | string>>>} */
  const proxies = {};
  for (const key of Object.keys(composedByChunk).sort()) {
    if (key === "cannabis-21") continue;
    const proxy = proxyOf(withoutExhibitions(composedByChunk[key]), hiddenByChunk.get(key) ?? new Set());
    if (proxy.length > 0) proxies[key] = proxy;
  }
  const layerText = JSON.stringify(buildCityLayer({ proxies })) + "\n";
  config.layers = [{ key: "city", source: CITY_LAYER_SOURCE }];
  config.streaming = streamingConfig();
  let layerPrev = "";
  try {
    layerPrev = normalizeEol(readFileSync(layerPath, "utf8"));
  } catch {
    layerPrev = "";
  }

  if (experienceTouched) {
    const byChunk = (/** @type {{ chunkKey: string }} */ a, /** @type {{ chunkKey: string }} */ b) => (a.chunkKey < b.chunkKey ? -1 : a.chunkKey > b.chunkKey ? 1 : 0);
    const byId = (/** @type {{ id?: unknown }} */ a, /** @type {{ id?: unknown }} */ b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    config.experience = {
      hidden: experience.hidden.sort(byChunk),
      zones: experience.zones.sort(byId),
      arrivals: experience.arrivals.sort(byId),
    };
  }

  if (thresholdsTouched) {
    config.thresholds = thresholds.sort((a, b) => (a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0));
  }

  const nextSceneText = serialize(scene);
  const nextConfigText = serialize(config);
  return {
    changed: nextSceneText !== sceneText || nextConfigText !== configText || layerText !== layerPrev,
    write() {
      writeFileSync(scenePath, nextSceneText);
      writeFileSync(configPath, nextConfigText);
      writeFileSync(layerPath, layerText);
    },
  };
}

/** @param {string} text */
function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const result = compose();
  if (check) {
    if (result.changed) {
      console.error("compose --check: the committed spatial source differs from the composed output; run `node spatial/authoring/compose.mjs`");
      process.exit(1);
    }
    console.log("compose --check: source is up to date");
  } else {
    result.write();
    console.log(result.changed ? "compose: spatial source updated" : "compose: no change");
  }
}
