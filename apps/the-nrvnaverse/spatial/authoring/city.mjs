// @ts-check
/**
 * THE NRVNAVerse — the city composition (M2: a floating Hub over a megacity).
 *
 * Owns three things, all deterministic (docs/NRVNAVERSE_HUB_WORLD.md §17, campaign record §3):
 *
 * 1. WHERE every composed chunk sits in the one world frame (`CHUNK_ORIGINS`): composers keep
 *    authoring in their M1 local coordinates; `compose.mjs` translates their output (and the
 *    destinations' spawns) by the chunk origin. The Hub floats at HUB_ELEVATION over Skyfall Plaza;
 *    Music and Fashion / Culture are city cells west and east of it; The Club is a walled room on
 *    the Music cell; the gated 21+ compound sits outside the Ring.
 * 2. The walkable CITY CELLS: one chunk per 200 m cell of the 3 × 3 region inside the Ring. A cell
 *    chunk carries an invisible ground collider, one invisible collider per building tier in the
 *    cell, the Ring wall on its outer edges and a few authored details. District cells (Music,
 *    Fashion) receive the same kit on top of their district composition.
 * 3. The FAR-FIELD LAYER (`buildCityLayer`): roads, blocks, plots, every building of the city,
 *    lamps, beacons, the Ring viaduct, the Hub's keel and a merged low-detail PROXY of every
 *    ungated chunk (shown by the app while that chunk is not active). Gated chunks are never
 *    proxied: the 21+ compound is a neutral authored shell. The app renders it in a few draw calls.
 *
 * Nothing here knows about gates or manifest metadata beyond the stable ids it binds to.
 */

import { box, slab, column, label, glow, pulse, collect, v, deg, zone } from "./lib.mjs";
import { CITY, FACADE_COLORS, planCity, r1, inWalkable } from "./city-plan.mjs";
import { PALETTE, HUB_DESTINATION_ID } from "./hub.mjs";

/** Hub elevation (metres above the city ground) — measured choice, campaign record §4. */
export const HUB_ELEVATION = 140;

/** World translation applied to each composed chunk (composers author in local M1 coordinates). */
export const CHUNK_ORIGINS = Object.freeze({
  hub: { x: 0, y: HUB_ELEVATION, z: -20 },
  // District floors were authored with their top at y = 0.5; −0.5 makes them flush with the street.
  music: { x: -130, y: -0.5, z: 0 },
  "music-club": { x: -130, y: -0.5, z: -35 },
  "fashion-culture": { x: 130, y: -0.5, z: 0 },
  // The gated compound moves outside the Ring (north); its payload is still never fetched pre-gate.
  "cannabis-21": { x: 0, y: 0, z: -300 },
});

/** Stable id of "The City" (Skyfall Plaza) — identity lives in the manifest. */
export const CITY_DESTINATION_ID = "dst_8w1j39h5e0ezrsjh";

/** Reserved rectangles (world x0, z0, x1, z1): no lot may intersect them. */
export const PLOTS = Object.freeze({
  plaza: /** @type {[number, number, number, number]} */ ([-62, -62, 62, 62]),
  music: /** @type {[number, number, number, number]} */ ([-226, -70, -174, 30]),
  club: /** @type {[number, number, number, number]} */ ([-214, 22, -186, 49]),
  fashion: /** @type {[number, number, number, number]} */ ([174, -78, 226, 26]),
  compound: /** @type {[number, number, number, number]} */ ([-30, -475, 30, -392]),
});

/** Plot paving colours (the far-field draws the plot ground; district floors sit on top). */
const PLOT_COLORS = Object.freeze({ plaza: "#4a463f", music: "#23262d", club: "#1b1d23", fashion: "#8f8676", compound: "#1d1a14" });

/** Walkable cells → chunk keys (the streaming grid). Cell (i, j) is centred on (i·CELL, j·CELL). */
export const CITY_CELLS = Object.freeze([
  { cell: [0, 0], chunkKey: "city-plaza", label: "Skyfall Plaza" },
  { cell: [0, -1], chunkKey: "city-north", label: "North Row" },
  { cell: [0, 1], chunkKey: "city-south", label: "South Row" },
  { cell: [-1, -1], chunkKey: "city-northwest", label: "Northwest Blocks" },
  { cell: [1, -1], chunkKey: "city-northeast", label: "Northeast Blocks" },
  { cell: [-1, 1], chunkKey: "city-southwest", label: "Southwest Blocks" },
  { cell: [1, 1], chunkKey: "city-southeast", label: "Southeast Blocks" },
  { cell: [-1, 0], chunkKey: "music", label: "Music District" },
  { cell: [1, 0], chunkKey: "fashion-culture", label: "Fashion / Culture District" },
]);

/** Chunks that are new city cells (composed entirely here). */
export const CITY_CELL_CHUNKS = CITY_CELLS.filter((c) => c.chunkKey.startsWith("city-"));

/** Streaming hysteresis: a handoff happens only once the visitor is this far inside the new cell. */
export const STREAMING_MARGIN = 4;

/** Ground collider overlap into each neighbouring cell (metres). */
export const GROUND_OVERLAP = 20;

/** The Hub releases a falling visitor into the city below this height (world y). */
export const HUB_RELEASE_BELOW = HUB_ELEVATION - 12;

const TAGS = Object.freeze({ ground: "m2-city-ground", collider: "m2-city-collider", ring: "m2-city-ring", detail: "m2-city-detail", portal: "m0-portal", zone: "m2-city-zone", reactive: "m2-city-reactive" });

let planCache = /** @type {ReturnType<typeof planCity> | null} */ (null);
/** The deterministic city plan (memoised; pure). */
export function cityPlan() {
  if (!planCache) planCache = planCity({ plots: { ...PLOTS } });
  return planCache;
}

/** @param {number} i @param {number} j */
const cellName = (i, j) => CITY_CELLS.find((c) => c.cell[0] === i && c.cell[1] === j)?.chunkKey ?? null;

/**
 * Invisible collider box (official mesh, `display: false`, solid FIXED collider).
 * @param {string} id @param {{x:number;y:number;z:number}} center @param {[number,number,number]} size @param {string} tag
 */
function solid(id, center, size, tag) {
  const data = box(id, center, size, { name: id, color: "#000000", castShadow: false, receiveShadow: false, tag });
  data.display = false;
  return data;
}

/**
 * The city kit of one cell: ground, building colliders, Ring walls. Ids are prefixed by the
 * chunk key so two cells never collide.
 * @param {string} chunkKey @param {[number, number]} cell
 */
export function cellKit(chunkKey, cell) {
  const [i, j] = cell;
  const cx = i * CITY.cell;
  const cz = j * CITY.cell;
  const half = CITY.cell / 2;
  /** @type {Array<Record<string, unknown> & { id: string }>} */
  const items = [];
  // Ground: 20 m overlap into each neighbour. The handoff fires STREAMING_MARGIN inside the next cell
  // and staging takes a few hundred ms (a sprinting visitor covers ≈ 10 m meanwhile), so the old cell
  // must still be under their feet until the new one exists (browser-verified: 2 m was not enough).
  items.push(solid(`${chunkKey}-ground`, v(cx, -1, cz), [CITY.cell + 2 * GROUND_OVERLAP, 2, CITY.cell + 2 * GROUND_OVERLAP], TAGS.ground));
  for (const b of cityPlan().buildings) {
    if (b.cell[0] !== i || b.cell[1] !== j) continue;
    b.tiers.forEach((t, k) => {
      const [x0, z0, x1, z1] = t.rect;
      items.push(solid(`${chunkKey}-${b.id}-t${k}`, v((x0 + x1) / 2, (t.y0 + t.y1) / 2, (z0 + z1) / 2), [x1 - x0, t.y1 - t.y0, z1 - z0], TAGS.collider));
    });
  }
  // The Ring: a wall on every outer edge of the walkable region (the viaduct is far-field art).
  const ringH = 9;
  if (i === 1) items.push(solid(`${chunkKey}-ring-e`, v(CITY.ring, ringH / 2, cz), [2, ringH, CITY.cell + 4], TAGS.ring));
  if (i === -1) items.push(solid(`${chunkKey}-ring-w`, v(-CITY.ring, ringH / 2, cz), [2, ringH, CITY.cell + 4], TAGS.ring));
  if (j === 1) items.push(solid(`${chunkKey}-ring-s`, v(cx, ringH / 2, CITY.ring), [CITY.cell + 4, ringH, 2], TAGS.ring));
  if (j === -1) items.push(solid(`${chunkKey}-ring-n`, v(cx, ringH / 2, -CITY.ring), [CITY.cell + 4, ringH, 2], TAGS.ring));
  if (chunkKey === "music") {
    // The Club is a building on the Music cell: solid from the street, entered through the passage door.
    const [x0, z0, x1, z1] = PLOTS.club;
    items.push(solid("music-club-massing", v((x0 + x1) / 2, 3, (z0 + z1) / 2), [x1 - x0 - 4, 6, z1 - z0 - 4], TAGS.collider));
  }
  return items;
}

/**
 * Skyfall Plaza details (cell (0, 0)): the sky lift back to the Hub, the landing ring under the Drop,
 * wayfinding toward the districts. World coordinates.
 */
function plazaDetails() {
  /** @type {Array<Record<string, unknown> & { id: string }>} */
  const items = [];
  const LZ = -37; // lift under the Hub's keel
  items.push(column("plaza-lift-pad", 0, 0.0, LZ, 4.2, 0.04, { name: "Sky lift pad", color: "#2a2a2e", segments: 40, collider: "none", castShadow: false, tag: TAGS.detail }));
  items.push(column("plaza-lift-ring", 0, 0.05, LZ, 4.6, 0.04, { name: "Sky lift ring", color: PALETTE.warmLight, opacity: 0.8, segments: 48, collider: "none", castShadow: false, receiveShadow: false, plugins: [pulse(PALETTE.ember, { intensity: 0.5, speed: 0.5 })], tag: TAGS.detail }));
  for (const [k, a] of [["n", 0], ["e", 90], ["s", 180], ["w", 270]]) {
    const r = 5.6;
    const x = Math.sin(deg(Number(a))) * r;
    const z = LZ - Math.cos(deg(Number(a))) * r;
    items.push(column(`plaza-lift-post-${k}`, x, 0, z, 0.25, 4.2, { name: `Sky lift post ${k}`, color: PALETTE.charcoal, segments: 10, tag: TAGS.detail }));
    items.push(column(`plaza-lift-post-${k}-cap`, x, 4.2, z, 0.32, 0.3, { name: `Sky lift post ${k} cap`, color: PALETTE.warmLight, segments: 10, collider: "none", plugins: [glow(PALETTE.ember, { intensity: 1.8, power: 1.4, speed: 0.6, pulse: 1 })], tag: TAGS.detail }));
  }
  items.push(label("plaza-lift-label", "SKY LIFT · HUB", v(0, 6.2, LZ + 5.8), { scale: 1.1, name: "Label sky lift", color: PALETTE.warmLight, width: 1400 }));
  // Landing ring under the Drop (the Hub's south edge is at world z ≈ 12).
  items.push(column("plaza-landing-ring", 0, 0.0, 14, 11, 0.03, { name: "Drop landing ring", color: "#6b5a3a", opacity: 0.9, segments: 64, collider: "none", castShadow: false, tag: TAGS.detail }));
  items.push(column("plaza-landing-ring-lit", 0, 0.035, 14, 11.4, 0.03, { name: "Drop landing ring (lit)", color: PALETTE.warmLight, opacity: 0.55, segments: 64, collider: "none", castShadow: false, receiveShadow: false, plugins: [glow(PALETTE.ember, { intensity: 1.6, power: 1.4, speed: 0.8, pulse: 1 })], tag: TAGS.reactive }));
  items.push(zone("plaza-zone-landing", v(0, 2.5, 14), [24, 5, 24], { name: "Zone Drop landing", tag: TAGS.zone }));
  // Wayfinding at the four plaza exits, readable from the plaza centre.
  items.push(label("plaza-sign-music", "MUSIC DISTRICT", v(-58, 5.5, 0), { scale: 1.2, color: PALETTE.music, rotation: { x: 0, y: deg(90), z: 0 }, width: 1400, name: "Sign Music District" }));
  items.push(label("plaza-sign-fashion", "FASHION / CULTURE", v(58, 5.5, 0), { scale: 1.2, color: PALETTE.fashion, rotation: { x: 0, y: deg(-90), z: 0 }, width: 1600, name: "Sign Fashion / Culture" }));
  items.push(label("plaza-sign-name", "SKYFALL PLAZA", v(0, 7.5, 58), { scale: 1.6, color: PALETTE.warmLight, rotation: { x: 0, y: deg(180), z: 0 }, width: 1600, name: "Sign Skyfall Plaza" }));
  items.push(slab("plaza-sign-name-wall", 0, 0, 59.5, [20, 6, 1], { name: "Plaza name wall", color: PALETTE.stoneDark, tag: TAGS.detail }));
  // Benches around the landing ring (pause spots facing the lift and the Hub above).
  for (const [k, x, z] of [["w", -16, 14], ["e", 16, 14], ["sw", -11, 27], ["se", 11, 27]]) {
    items.push(slab(`plaza-bench-${k}`, Number(x), 0, Number(z), [3.2, 0.45, 0.9], { name: `Plaza bench ${k}`, color: PALETTE.stoneLight, rotation: { x: 0, y: deg(Number(x) < 0 ? 90 : -90), z: 0 }, tag: TAGS.detail }));
  }
  // Portal last: the lift is vertical travel to the Hub (a meaningful loading boundary).
  items.push(box("portal-plaza-hub", v(0, 1.5, LZ), [5, 3, 5], { name: "Portal Skyfall Plaza → Hub (sky lift)", color: PALETTE.warmLight, opacity: 0.18, collider: "sensor", castShadow: false, receiveShadow: false, tag: TAGS.portal }));
  return {
    items,
    experience: {
      hidden: ["plaza-landing-ring-lit"],
      zones: [{ id: "plaza-landing", chunkKey: "city-plaza", sensorId: "plaza-zone-landing", enter: { show: ["plaza-landing-ring-lit"] }, exit: { hide: ["plaza-landing-ring-lit"] } }],
      arrivals: [],
    },
    portals: [{ componentId: "portal-plaza-hub", destinationId: HUB_DESTINATION_ID }],
  };
}

/**
 * Composer for one new city cell chunk.
 * @param {string} chunkKey
 */
export function composeCityCell(chunkKey) {
  const entry = CITY_CELLS.find((c) => c.chunkKey === chunkKey);
  if (!entry) throw new Error(`no city cell "${chunkKey}"`);
  const items = [...cellKit(chunkKey, /** @type {[number, number]} */ ([...entry.cell]))];
  /** @type {{ hidden: string[]; zones: any[]; arrivals: any[] } | undefined} */
  let experience;
  /** @type {Array<{ componentId: string; destinationId: string }>} */
  let portals = [];
  if (chunkKey === "city-plaza") {
    const p = plazaDetails();
    // Zones before portals (the portal stays last, like every chunk).
    const portalItems = p.items.filter((it) => String(it.id).startsWith("portal-"));
    items.push(...p.items.filter((it) => !String(it.id).startsWith("portal-")), ...portalItems);
    experience = p.experience;
    portals = p.portals;
  }
  const components = collect(items);
  return { components, componentIds: Object.keys(components), experience, portals };
}

// ---------------------------------------------------------------------------------------------
// Far-field layer
// ---------------------------------------------------------------------------------------------

/** Decimetre integer (compact layer encoding). @param {number} m */
const dm = (m) => Math.round(m * 10);
/** @param {number} n */
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Low-detail proxy primitives of one chunk's (already translated) components. Skips everything that
 * is not a solid, opaque, visible mesh or that starts hidden (state-B geometry), and small detail.
 * @param {Record<string, any>} components @param {Set<string>} hidden
 */
export function proxyOf(components, hidden) {
  /** @type {Array<Array<number | string>>} */
  const out = [];
  for (const c of Object.values(components)) {
    if (c.type !== "mesh" || c.display === false || hidden.has(c.id)) continue;
    if ((c.opacity ?? 1) < 0.5 || c.collider?.isSensor) continue;
    const g = c.geometry;
    const s = c.scale ?? { x: 1, y: 1, z: 1 };
    const emissive = Array.isArray(c.plugins) && c.plugins.some((p) => p.id === "FresnelGlowPlugin" || p.id === "PulsePlugin") ? 1 : 0;
    const rot = c.rotation ?? { x: 0, y: 0, z: 0 };
    const P = c.position;
    if (g.type === "box") {
      const { width, height, depth } = g.boxParams;
      if (Math.max(width * s.x, height * s.y, depth * s.z) < 0.6) continue;
      out.push([0, r2(P.x), r2(P.y), r2(P.z), r2(width * s.x), r2(height * s.y), r2(depth * s.z), r2(rot.x), r2(rot.y), r2(rot.z), c.color, emissive]);
    } else if (g.type === "cylinder") {
      const { radiusTop, radiusBottom, height } = g.cylinderParams;
      if (Math.max(radiusBottom * 2, height) < 0.6) continue;
      out.push([1, r2(P.x), r2(P.y), r2(P.z), r2(radiusTop * s.x), r2(height * s.y), r2(radiusBottom * s.x), r2(rot.x), r2(rot.y), r2(rot.z), c.color, emissive]);
    } else if (g.type === "sphere") {
      const r = g.sphereParams.radius * s.x;
      if (r * 2 < 0.6) continue;
      out.push([2, r2(P.x), r2(P.y), r2(P.z), r2(r), r2(r), r2(r), 0, 0, 0, c.color, emissive]);
    }
  }
  return out;
}

/**
 * The far-field city layer (generated artifact source).
 * @param {{ proxies: Record<string, Array<Array<number | string>>> }} input
 */
export function buildCityLayer(input) {
  const plan = cityPlan();
  const hub = CHUNK_ORIGINS.hub;
  return {
    schemaVersion: 1,
    key: "city",
    units: "decimetres for roads / grounds / buildings / lamps; metres for everything else",
    frame: { half: CITY.half, pitch: CITY.pitch, cell: CITY.cell, ring: CITY.ring },
    facadeColors: FACADE_COLORS,
    roads: plan.roads.map((r) => r.map(dm)),
    // kind: 0 block · 1 park
    grounds: plan.grounds.map((g) => [...g.rect.map(dm), g.kind === "park" ? 1 : 0]),
    plots: Object.entries(PLOTS).map(([key, rect]) => ({ key, rect: [...rect], color: PLOT_COLORS[/** @type {keyof typeof PLOT_COLORS} */ (key)] })),
    // [x0, z0, x1, z1, y0, y1, facadeColor, style, crown] per tier
    buildings: plan.buildings.flatMap((b) => b.tiers.map((t, k) => [...t.rect.map(dm), dm(t.y0), dm(t.y1), b.color, b.style, b.crown && k === b.tiers.length - 1 ? 1 : 0])),
    // [x, z, inWalkable]
    lamps: plan.lamps.map(([x, z, w]) => [dm(x), dm(z), w]),
    // Street trees [x, z, size 0..100] dm / percent; crosswalk intersections [x, z] m.
    trees: plan.trees.map(([x, z, s]) => [dm(x), dm(z), Math.round(s * 100)]),
    crossings: plan.crossings.map(([x, z]) => [x, z]),
    // Light columns: [x, z, y0, y1, radius, colour]
    beacons: [
      [-200, -40, 0, 70, 1.2, PALETTE.music],
      [200, -40, 0, 70, 1.2, PALETTE.fashion],
      [0, -433, 0, 40, 1.0, PALETTE.gated],
      // The sky lift: plaza → under the keel.
      [0, -37, 0, r1(hub.y - 46), 2.6, PALETTE.warmLight],
    ],
    // The gated compound: a neutral walled shell (never derived from gated chunk content).
    compounds: [{ rect: [...PLOTS.compound], height: 9, color: "#2a2620" }],
    ring: { half: CITY.ring, deckY: 9, width: 14 },
    // The Hub's island underside: a faceted inverted cone under the deck.
    keel: { x: hub.x, y: r1(hub.y - 1.1), z: r1(hub.z - 17), radiusX: 66, radiusZ: 52, depth: 46, color: "#3a3631", glow: PALETTE.ember },
    proxies: input.proxies,
  };
}

/** Streaming config block for spatial-config (cells → chunk keys, release rule from the Hub). */
export function streamingConfig() {
  return {
    cellSize: CITY.cell,
    margin: STREAMING_MARGIN,
    cells: CITY_CELLS.map((c) => ({ cell: [...c.cell], chunkKey: c.chunkKey })),
    releases: [{ fromChunkKey: "hub", belowY: HUB_RELEASE_BELOW }],
    catchBelowY: -30,
  };
}

/** Exposed for docs / tests. */
export { inWalkable };
