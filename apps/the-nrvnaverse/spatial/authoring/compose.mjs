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

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "..", "source");
const scenePath = join(sourceDir, "scene.m0.json");
const configPath = join(sourceDir, "spatial-config.m0.json");

/** chunk key → composer */
const COMPOSERS = { hub: composeHub, music: composeMusic, "fashion-culture": composeFashion, "music-club": composeClub };

/** @param {Record<string, unknown>} obj */
const serialize = (obj) => JSON.stringify(obj, null, 2) + "\n";

export function compose() {
  const scene = JSON.parse(readFileSync(scenePath, "utf8"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const sceneText = readFileSync(scenePath, "utf8");
  const configText = readFileSync(configPath, "utf8");

  /** destinationId → chunkKey, for assigning composed arrivals to their chunk. */
  const placementChunk = new Map(config.placements.map((p) => [p.destinationId, p.chunkKey]));
  /** @type {{ hidden: Array<{ chunkKey: string; componentIds: string[] }>; zones: Array<Record<string, unknown> & { chunkKey: string }>; arrivals: Array<Record<string, unknown> & { destinationId: string }> }} */
  const experience = { hidden: [...(config.experience?.hidden ?? [])], zones: [...(config.experience?.zones ?? [])], arrivals: [...(config.experience?.arrivals ?? [])] };
  let experienceTouched = false;

  for (const chunk of config.chunks) {
    const composer = COMPOSERS[chunk.key];
    if (!composer) continue;
    const { components, componentIds, experience: composed } = composer();
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

  if (experienceTouched) {
    const byChunk = (/** @type {{ chunkKey: string }} */ a, /** @type {{ chunkKey: string }} */ b) => (a.chunkKey < b.chunkKey ? -1 : a.chunkKey > b.chunkKey ? 1 : 0);
    const byId = (/** @type {{ id?: unknown }} */ a, /** @type {{ id?: unknown }} */ b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    config.experience = {
      hidden: experience.hidden.sort(byChunk),
      zones: experience.zones.sort(byId),
      arrivals: experience.arrivals.sort(byId),
    };
  }

  const nextSceneText = serialize(scene);
  const nextConfigText = serialize(config);
  return {
    changed: nextSceneText !== sceneText || nextConfigText !== configText,
    write() {
      writeFileSync(scenePath, nextSceneText);
      writeFileSync(configPath, nextConfigText);
    },
  };
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
