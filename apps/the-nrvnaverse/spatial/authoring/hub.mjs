// @ts-check
/**
 * THE NRVNAVerse — Central Hub composition ("the Basin and the Spire", M1 creative build).
 *
 * Creative thesis (developer truth; see docs/NRVNAVERSE_HUB_WORLD.md):
 *   The Hub is a sunken stone basin under a dusk sky. Straight ahead of the arrival point a
 *   slender lantern spire rises out of a square, open-roofed pavilion (the Core house) whose
 *   south face carries the identity inscription. Two gentle ramps climb from the basin to a
 *   raised rim terrace that overlooks the pavilion's open roof; an overlook deck climbs one more
 *   level above the terrace's west end and shelters a quiet lounge beneath it. The Music and
 *   Fashion / Culture gateways frame the west and east exits at ground level; the gated 21+ gate
 *   sits off-axis in the north-east corner behind two dark posts. The pavilion's interior is the
 *   optional discovery: its only entrance faces away from the arrival, led to by a line of pulsing
 *   floor studs, and from the terrace its mirror floor is visible before the route is obvious.
 *
 * Everything is replaceable primitive geometry (no assets, no asset refs). Component ids are stable
 * and prefixed `hub-` except the pre-existing ids the pipeline, tests and portal bindings rely on:
 * `platform-hub`, `label-hub`, `path-west`, `path-east`, `portal-hub-music`, `portal-hub-fashion`,
 * `portal-hub-cannabis`.
 *
 * Datum: the basin floor top is y = 0.5 (`platform-hub`), the terrace top is y = 4.5, the overlook
 * deck top is y = 8.5. The spawn is (0, 1, 6) facing -Z (spatial-config placement, unchanged).
 */

import { box, slab, column, sphere, rampZ, rampX, label, glow, pulse, collect, v, deg, zone, experienceOf } from "./lib.mjs";

/** Stable destination ids the Hub's arrival beats bind to (identity lives in the manifest; these are references). */
export const HUB_DESTINATION_ID = "dst_7g19n1vm9ackw8a0";

export const PALETTE = Object.freeze({
  basinFloor: "#2b2e35",
  basinInlay: "#4d4740",
  stone: "#a79d8a",
  stoneLight: "#c9bfae",
  stoneDark: "#6b6559",
  charcoal: "#1c1f26",
  spire: "#e9e3d6",
  ember: "#f5b24a",
  warmLight: "#ffd98a",
  music: "#2fb8a6",
  fashion: "#d98c7a",
  gated: "#8a6a2a",
  night: "#0b1020",
});

export const HUB_TAGS = Object.freeze({
  structure: "m1-hub-structure",
  landmark: "m1-hub-landmark",
  route: "m1-hub-route",
  portal: "m0-portal",
  clue: "m1-hub-clue",
  secret: "m1-hub-secret",
  copy: "m1-hub-copy",
  /** State-B geometry and trigger volumes of the experience layer (M1 experience campaign). */
  reactive: "m1-hub-reactive",
  zone: "m1-hub-zone",
});

const DATUM = 0.5; // basin floor top
const TERRACE_TOP = 4.5;
const OVERLOOK_TOP = 8.5;
const PAVILION_Z = -19; // pavilion / spire centre
const SPIRE_TOP = 31;

/**
 * Sensor portal slab (official mesh + sensor collider). Ids and sensor semantics unchanged from M0.
 * @param {string} id @param {string} name @param {{x:number;y:number;z:number}} position @param {[number,number,number]} size @param {string} color @param {number} rotY
 */
function portal(id, name, position, size, color, rotY) {
  return box(id, position, size, {
    name,
    color,
    opacity: 0.22,
    collider: "sensor",
    castShadow: false,
    receiveShadow: false,
    tag: HUB_TAGS.portal,
    rotation: { x: 0, y: deg(rotY), z: 0 },
  });
}

export function composeHub() {
  const S = HUB_TAGS;
  /** @type {Array<Record<string, unknown> & { id: string }>} */
  const items = [];

  // --- 1. Ground: basin floor, inlay, forecourt, the two district paths ---------------------------
  items.push(box("platform-hub", v(0, 0.25, 0), [24, 0.5, 24], { name: "Basin floor", color: PALETTE.basinFloor, tag: S.structure }));
  items.push(column("hub-basin-inlay", 0, 0, 0, 9, 0.51, { name: "Basin inlay ring", color: "#5c5447", segments: 48, collider: "none", castShadow: false, tag: S.structure }));
  items.push(box("hub-forecourt", v(0, 0.25, -20), [24, 0.5, 16], { name: "Forecourt", color: PALETTE.basinFloor, tag: S.structure }));
  // Paths are flush with the basin top (0.5): a 0.3 m lip is unclimbable for the character controller (headless-verified).
  items.push(box("path-west", v(-35, 0.25, 0), [46, 0.5, 4], { name: "Path Hub→Music", color: PALETTE.stoneDark, tag: S.route }));
  items.push(box("path-east", v(35, 0.25, 0), [46, 0.5, 4], { name: "Path Hub→Fashion", color: PALETTE.stoneDark, tag: S.route }));

  // --- 2. The Core house (pavilion): open-roofed, entrance on the north (hidden from arrival) ----
  const pz = PAVILION_Z;
  items.push(slab("hub-core-wall-s", 0, DATUM, pz + 5, [10, 5, 1], { name: "Core house south wall", color: PALETTE.stone, tag: S.landmark }));
  items.push(slab("hub-core-wall-w", -4.5, DATUM, pz, [1, 5, 9], { name: "Core house west wall", color: PALETTE.stone, tag: S.landmark }));
  items.push(slab("hub-core-wall-e", 4.5, DATUM, pz, [1, 5, 9], { name: "Core house east wall", color: PALETTE.stone, tag: S.landmark }));
  items.push(slab("hub-core-wall-nw", -3.375, DATUM, pz - 5, [3.25, 5, 1], { name: "Core house north wall (west stub)", color: PALETTE.stone, tag: S.secret }));
  items.push(slab("hub-core-wall-ne", 3.375, DATUM, pz - 5, [3.25, 5, 1], { name: "Core house north wall (east stub)", color: PALETTE.stone, tag: S.secret }));
  // Wall-top walk: a 2 m ring of beams around the light well (reachable from the terrace by a jump).
  items.push(slab("hub-core-beam-s", 0, DATUM + 5, pz + 4.5, [10, 1, 2], { name: "Core house beam south", color: PALETTE.stoneLight, tag: S.landmark }));
  items.push(slab("hub-core-beam-n", 0, DATUM + 5, pz - 4.5, [10, 1, 2], { name: "Core house beam north", color: PALETTE.stoneLight, tag: S.landmark }));
  items.push(slab("hub-core-beam-w", -4, DATUM + 5, pz, [2, 1, 7], { name: "Core house beam west", color: PALETTE.stoneLight, tag: S.landmark }));
  items.push(slab("hub-core-beam-e", 4, DATUM + 5, pz, [2, 1, 7], { name: "Core house beam east", color: PALETTE.stoneLight, tag: S.landmark }));
  for (const [sx, sz, k] of [[-1, 1, "sw"], [1, 1, "se"], [-1, -1, "nw"], [1, -1, "ne"]]) {
    items.push(column(`hub-core-pillar-${k}`, 5.3 * Number(sx), DATUM, pz + 5.3 * Number(sz), 0.65, 8, { name: `Core house pillar ${k}`, color: PALETTE.stoneLight, segments: 20, tag: S.landmark }));
  }

  // --- 3. The Spire: four bone fins around an ember core, three lit rings, a lantern cap ---------
  items.push(column("hub-core-seat", 0, DATUM, pz, 2.0, 0.45, { name: "Core seat ring", color: PALETTE.stoneDark, segments: 40, tag: S.secret }));
  items.push(column("hub-spire-plinth", 0, DATUM + 0.45, pz, 1.2, 0.6, { name: "Spire plinth", color: PALETTE.stoneLight, segments: 32, tag: S.landmark }));
  const finBase = DATUM + 1.05;
  const finH = SPIRE_TOP - finBase;
  items.push(slab("hub-spire-fin-w", -0.85, finBase, pz, [0.35, finH, 1.5], { name: "Spire fin west", color: PALETTE.spire, tag: S.landmark }));
  items.push(slab("hub-spire-fin-e", 0.85, finBase, pz, [0.35, finH, 1.5], { name: "Spire fin east", color: PALETTE.spire, tag: S.landmark }));
  items.push(slab("hub-spire-fin-n", 0, finBase, pz - 0.85, [1.5, finH, 0.35], { name: "Spire fin north", color: PALETTE.spire, tag: S.landmark }));
  items.push(slab("hub-spire-fin-s", 0, finBase, pz + 0.85, [1.5, finH, 0.35], { name: "Spire fin south", color: PALETTE.spire, tag: S.landmark }));
  items.push(
    column("hub-spire-core", 0, finBase, pz, 0.42, finH, {
      name: "Spire ember core",
      color: PALETTE.ember,
      segments: 16,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [glow(PALETTE.warmLight, { intensity: 1.6, power: 1.6, speed: 0.6, pulse: 1 })],
      tag: S.landmark,
    }),
  );
  for (const [i, y] of [9, 17, 25].entries()) {
    items.push(
      // Dormant state: a dark bronze ring with a faint ember pulse (browser-tuned 2026-10-15 so the
      // wake from this state to the lit ring below reads at the arrival).
      column(`hub-spire-ring-${i + 1}`, 0, y, pz, 1.25, 0.25, {
        name: `Spire ring ${i + 1} (dormant)`,
        color: "#5a4a30",
        segments: 24,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [pulse(PALETTE.ember, { intensity: 0.2, speed: 0.5 })],
        tag: S.landmark,
      }),
    );
    // Lit state (hidden until the arrival beat "wakes" the spire from the bottom ring up).
    items.push(
      column(`hub-spire-ring-${i + 1}-lit`, 0, y - 0.1, pz, 1.45, 0.45, {
        name: `Spire ring ${i + 1} (lit)`,
        color: "#fff1cf",
        segments: 24,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(PALETTE.ember, { intensity: 2.0, power: 1.3, speed: 0.5, pulse: 1 })],
        tag: S.reactive,
      }),
    );
  }
  items.push(
    sphere("hub-spire-cap", v(0, SPIRE_TOP + 0.9, pz), 1.1, {
      name: "Spire lantern cap",
      color: "#fff1cf",
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [glow(PALETTE.ember, { intensity: 2.2, power: 1.4, speed: 0.4, pulse: 1 })],
      tag: S.landmark,
    }),
  );

  // --- 4. Identity copy (arrival statement on the Core house's south face) -----------------------
  items.push(label("label-hub", "THE NRVNAVerse", v(0, 4.05, pz + 5.52), { scale: 2.0, name: "Label THE NRVNAVerse", color: "#f3ead8" }));
  items.push(label("hub-label-sub", "CENTRAL HUB", v(0, 2.7, pz + 5.52), { scale: 0.7, name: "Label Central Hub", color: PALETTE.warmLight, font: "aeonik-medium" }));

  // --- 5. The Rim: solid terrace block, two ramps with landings, benches ------------------------
  items.push(box("hub-terrace", v(0, TERRACE_TOP / 2, -32), [40, TERRACE_TOP, 8], { name: "Rim terrace", color: PALETTE.stoneDark, tag: S.route }));
  for (const side of [-1, 1]) {
    const k = side < 0 ? "w" : "e";
    const x = 14.5 * side;
    items.push(box(`hub-landing-${k}`, v(x, 0.25, -8), [5, 0.5, 4], { name: `Ramp landing ${k}`, color: PALETTE.basinFloor, tag: S.route }));
    items.push(rampZ(`hub-ramp-${k}`, x, -10, DATUM, -28, TERRACE_TOP, 5, { name: `Rim ramp ${k}`, color: PALETTE.stone, tag: S.route }));
  }
  items.push(slab("hub-bench-rim-w", -4, TERRACE_TOP, -29.5, [3, 0.45, 0.9], { name: "Rim bench west", color: PALETTE.stoneLight, tag: S.route }));
  items.push(slab("hub-bench-rim-e", 4, TERRACE_TOP, -29.5, [3, 0.45, 0.9], { name: "Rim bench east", color: PALETTE.stoneLight, tag: S.route }));

  // --- 6. The Overlook: a deck one level up over the terrace's west end, with its lounge beneath --
  // The ramp runs OUTBOARD of the terrace (z -39..-36, north of its edge) so the terrace walk never
  // passes under it (a 2 m headroom trap otherwise; headless-verified). Foot at x = 18 on the terrace
  // level, top meets the deck's east face at x = -6 (0.3 m overlap). 9.3°.
  items.push(rampX("hub-overlook-ramp", -37.5, 18, TERRACE_TOP, -6.3, OVERLOOK_TOP, 3, { name: "Overlook ramp", color: PALETTE.stone, tag: S.route }));
  items.push(box("hub-overlook-ramp-foot", v(19, TERRACE_TOP - 0.25, -37.5), [2, 0.5, 3], { name: "Overlook ramp foot", color: PALETTE.stone, tag: S.route }));
  items.push(column("hub-overlook-ramp-post", 6, 0, -37.5, 0.45, TERRACE_TOP + 2.0, { name: "Overlook ramp post", color: PALETTE.stoneDark, segments: 16, tag: S.route }));
  items.push(box("hub-overlook-deck", v(-13, OVERLOOK_TOP - 0.25, -33.5), [14, 0.5, 11], { name: "Overlook deck", color: PALETTE.stoneLight, tag: S.route }));
  items.push(column("hub-overlook-post-s", -19.3, TERRACE_TOP, -28.7, 0.45, OVERLOOK_TOP - 0.5 - TERRACE_TOP, { name: "Overlook post south", color: PALETTE.stoneDark, segments: 16, tag: S.route }));
  items.push(column("hub-overlook-post-n", -19.3, 0, -38.3, 0.45, OVERLOOK_TOP - 0.5, { name: "Overlook post north", color: PALETTE.stoneDark, segments: 16, tag: S.route }));
  items.push(slab("hub-bench-lounge", -14, TERRACE_TOP, -33.5, [3, 0.45, 0.9], { name: "Lounge bench", color: PALETTE.stoneLight, tag: S.route }));
  items.push(column("hub-overlook-lamp-post", -16.5, OVERLOOK_TOP, -30, 0.1, 1.3, { name: "Overlook lamp post", color: PALETTE.charcoal, segments: 8, collider: "none", tag: S.route }));
  // The lamp is dim until someone reaches the deck; it lights while the deck is occupied.
  items.push(
    sphere("hub-overlook-lamp", v(-16.5, OVERLOOK_TOP + 1.6, -30), 0.4, {
      name: "Overlook lamp (dim)",
      color: "#6b5a3a",
      collider: "none",
      castShadow: false,
      plugins: [pulse(PALETTE.ember, { intensity: 0.25, speed: 0.4 })],
      tag: S.route,
    }),
  );
  items.push(
    sphere("hub-overlook-lamp-lit", v(-16.5, OVERLOOK_TOP + 1.6, -30), 0.46, {
      name: "Overlook lamp (lit)",
      color: "#fff1cf",
      collider: "none",
      castShadow: false,
      plugins: [glow(PALETTE.ember, { intensity: 2.2, power: 1.4, speed: 0.5, pulse: 1 })],
      tag: S.reactive,
    }),
  );
  items.push(
    column("hub-overlook-lamp-pool", -16.5, OVERLOOK_TOP + 0.005, -30, 2.6, 0.02, {
      name: "Overlook lamp light pool",
      color: PALETTE.warmLight,
      opacity: 0.35,
      segments: 32,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      tag: S.reactive,
    }),
  );

  // --- 7. Dormant frames on the overlook deck's north edge: the world is larger than what is open --
  // (kept off the terrace's north strip, which is the overlook ramp's run; headless-verified)
  for (const [i, x] of [-16, -9.5].entries()) {
    const k = `hub-dormant-${i + 1}`;
    items.push(column(`${k}-post-w`, x - 1.6, OVERLOOK_TOP, -38.5, 0.3, 4.6, { name: `Dormant frame ${i + 1} post`, color: PALETTE.charcoal, segments: 12, tag: S.structure }));
    items.push(column(`${k}-post-e`, x + 1.6, OVERLOOK_TOP, -38.5, 0.3, 4.6, { name: `Dormant frame ${i + 1} post`, color: PALETTE.charcoal, segments: 12, tag: S.structure }));
    items.push(
      slab(`${k}-inset`, x, OVERLOOK_TOP + 0.2, -38.5, [2.6, 4.0, 0.2], {
        name: `Dormant frame ${i + 1} inset`,
        color: "#101319",
        opacity: 0.92,
        castShadow: false,
        plugins: [pulse(PALETTE.ember, { intensity: 0.12, speed: 0.25 })],
        tag: S.structure,
      }),
    );
    // Discovery memory (world doc §15): the frame wakes once enough hidden places have been found.
    items.push(
      slab(`${k}-inset-lit`, x, OVERLOOK_TOP + 0.25, -38.45, [2.5, 3.9, 0.12], {
        name: `Dormant frame ${i + 1} inset (remembering)`,
        color: PALETTE.ember,
        opacity: 0.7,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(PALETTE.warmLight, { intensity: 1.8, power: 1.3, speed: 0.5, pulse: 1 })],
        tag: S.reactive,
      }),
    );
  }
  items.push(label("hub-memory-line", "three places remembered — the frames are listening", v(-12.75, OVERLOOK_TOP + 5.1, -38.3), { scale: 0.5, name: "Memory inscription (overlook)", color: PALETTE.warmLight, font: "playfair-italic", width: 1800 }));

  // --- 8. District gateways (west: Music, east: Fashion / Culture) -----------------------------
  const gateways = [
    { k: "music", x: -9, color: PALETTE.music, text: "MUSIC", rotY: 90 },
    { k: "fashion", x: 9, color: PALETTE.fashion, text: "FASHION / CULTURE", rotY: -90 },
  ];
  for (const g of gateways) {
    items.push(column(`hub-gate-${g.k}-post-n`, g.x, DATUM, -7.9, 0.45, 5, { name: `Gateway ${g.k} post north`, color: PALETTE.stoneLight, segments: 16, tag: S.structure }));
    items.push(column(`hub-gate-${g.k}-post-s`, g.x, DATUM, 7.9, 0.45, 5, { name: `Gateway ${g.k} post south`, color: PALETTE.stoneLight, segments: 16, tag: S.structure }));
    items.push(slab(`hub-gate-${g.k}-lintel`, g.x, DATUM + 5, 0, [1.2, 0.7, 17], { name: `Gateway ${g.k} lintel`, color: PALETTE.stoneLight, tag: S.structure }));
    items.push(label(`hub-gate-${g.k}-label`, g.text, v(g.x + (g.x < 0 ? 0.7 : -0.7), DATUM + 6.6, 0), { scale: 0.95, name: `Label gateway ${g.k}`, color: g.color, rotation: { x: 0, y: deg(g.rotY), z: 0 }, width: 1200 }));
    // Return glow: the lintel of the gateway you just came back through lights for a few seconds.
    items.push(
      slab(`hub-return-${g.k}-glow`, g.x, DATUM + 4.95, 0, [1.3, 0.8, 17.2], {
        name: `Gateway ${g.k} return glow`,
        color: g.color,
        opacity: 0.55,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(g.color, { intensity: 1.8, power: 1.2, speed: 1.0, pulse: 1 })],
        tag: S.reactive,
      }),
    );
  }

  // --- 9. The gated 21+ gate: off the arrival axis, north-east corner, dark posts ----------------
  items.push(column("hub-gate-cannabis-post-a", 10.62, DATUM, -11.62, 0.4, 4.4, { name: "21+ gate post", color: PALETTE.charcoal, segments: 12, tag: S.structure }));
  items.push(column("hub-gate-cannabis-post-b", 6.38, DATUM, -7.38, 0.4, 4.4, { name: "21+ gate post", color: PALETTE.charcoal, segments: 12, tag: S.structure }));
  items.push(label("hub-gate-cannabis-label", "21+", v(8.0, DATUM + 4.5, -9.0), { scale: 0.8, name: "Label 21+ gate", color: PALETTE.gated, rotation: { x: 0, y: deg(-45), z: 0 } }));

  // --- 10. Clue: pulsing floor studs from the east ramp landing around the Core house -----------
  const studs = [
    [8.5, -13.5],
    [7.2, -16.5],
    [7.0, -19.5],
    [7.0, -22.5],
    [5.4, -25.8],
    [2.4, -26.2],
    [0, -25.1],
  ];
  for (const [i, [x, z]] of studs.entries()) {
    items.push(
      column(`hub-stud-${i + 1}`, x, DATUM - 0.01, z, 0.24, 0.03, {
        name: `Floor stud ${i + 1}`,
        color: PALETTE.warmLight,
        segments: 12,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [pulse(PALETTE.ember, { intensity: 0.5, speed: 0.45 })],
        tag: S.clue,
      }),
    );
  }

  // --- 11. Inside the Core house: mirror floor and one quiet line ------------------------------
  items.push({
    name: "Core mirror floor",
    id: "hub-core-mirror",
    type: "reflector",
    kit: "cyber",
    position: v(0, DATUM + 0.02, pz),
    scale: { x: 8, z: 9 },
    normalmap: { enabled: false },
    color: "#1a1d26",
    opacity: 1,
    blur: true,
    script: { identifier: "hub-core-mirror", tag: S.secret },
  });
  items.push(label("hub-core-line", "you are at the centre", v(0, 2.7, pz + 4.45), { scale: 0.7, name: "Core inscription", color: PALETTE.warmLight, font: "playfair-italic", rotation: { x: 0, y: deg(180), z: 0 }, width: 1200 }));
  // The Core sigil: a small ember glyph floating over the seat ring; dim until found, lit once remembered.
  items.push(sphere("hub-core-sigil", v(2.6, 1.6, pz - 2.4), 0.22, { name: "Core sigil (unfound)", color: "#5a4a30", collider: "none", castShadow: false, plugins: [pulse(PALETTE.ember, { intensity: 0.3, speed: 0.6 })], tag: S.secret }));
  items.push(sphere("hub-core-sigil-lit", v(2.6, 1.6, pz - 2.4), 0.26, { name: "Core sigil (remembered)", color: "#fff1cf", collider: "none", castShadow: false, plugins: [glow(PALETTE.ember, { intensity: 2.4, power: 1.2, speed: 1.0, pulse: 1 })], tag: S.reactive }));
  // The interior answers the visitor: a halo around the seat and a brighter well while someone is inside.
  items.push(
    column("hub-core-halo", 0, DATUM + 0.03, pz, 3.2, 0.02, {
      name: "Core halo (inside)",
      color: PALETTE.warmLight,
      opacity: 0.4,
      segments: 48,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [pulse(PALETTE.ember, { intensity: 0.6, speed: 0.8 })],
      tag: S.reactive,
    }),
  );
  items.push(
    column("hub-core-well", 0, finBase, pz, 0.7, 6, {
      name: "Core well (inside)",
      color: PALETTE.ember,
      opacity: 0.35,
      segments: 16,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [glow(PALETTE.warmLight, { intensity: 2.4, power: 1.2, speed: 0.9, pulse: 1 })],
      tag: S.reactive,
    }),
  );

  // --- 11b. Experience zones (invisible sensor volumes; ids are the zone sensors) ----------------
  // Sized from SIC `bounds` of the anchors (overlook deck x -20..-6 / z -39..-28 / top 8.5; Core
  // house interior x -4..4 / z -23.5..-14.5). Zones precede the portals so the portals stay last.
  items.push(zone("hub-zone-overlook", v(-13, OVERLOOK_TOP + 1.5, -33.5), [14, 3, 11], { name: "Zone overlook deck", tag: S.zone }));
  items.push(zone("hub-zone-core", v(0, DATUM + 2, pz), [8, 4, 9], { name: "Zone Core house interior", tag: S.zone }));

  // --- 12. Portal sensors last: asset:place appends after the final hub id (portal-hub-cannabis) ---
  items.push(portal("portal-hub-music", "Portal Hub → Music District", v(-9, 2, 0), [1, 3, 14], PALETTE.music, 0));
  items.push(portal("portal-hub-fashion", "Portal Hub → Fashion / Culture District", v(9, 2, 0), [1, 3, 14], PALETTE.fashion, 0));
  items.push(portal("portal-hub-cannabis", "Portal Hub → 21+ Cannabis District (gated)", v(8.5, 2, -9.5), [6, 3, 1], PALETTE.gated, 45));

  const components = collect(items);

  // --- 13. Experience bindings -------------------------------------------------------------------
  const x = experienceOf("hub");
  x.hide(
    "hub-spire-ring-1-lit",
    "hub-spire-ring-2-lit",
    "hub-spire-ring-3-lit",
    "hub-overlook-lamp-lit",
    "hub-overlook-lamp-pool",
    "hub-return-music-glow",
    "hub-return-fashion-glow",
    "hub-core-halo",
    "hub-core-well",
    "hub-core-sigil-lit",
    "hub-dormant-1-inset-lit",
    "hub-dormant-2-inset-lit",
    "hub-memory-line",
  );
  // Reaching the overlook lights its lamp; leaving dims it again.
  x.zone("hub-overlook", "hub-zone-overlook", {
    enter: { show: ["hub-overlook-lamp-lit", "hub-overlook-lamp-pool"], hide: ["hub-overlook-lamp"] },
    exit: { show: ["hub-overlook-lamp"], hide: ["hub-overlook-lamp-lit", "hub-overlook-lamp-pool"] },
  });
  // Inside the Core house the well brightens and the halo appears; the inscription stays.
  x.zone("hub-core", "hub-zone-core", {
    enter: { show: ["hub-core-halo", "hub-core-well"] },
    exit: { hide: ["hub-core-halo", "hub-core-well"] },
  });
  // Every arrival at the Hub wakes the spire from the bottom ring up (initial placement and returns).
  // First beat at 1.5 s: on the initial placement the engine's reveal fade lasts about a second, so
  // an earlier wake finishes behind the fade (browser-verified 2026-10-15); a return still reads.
  x.arrival("hub-wake", HUB_DESTINATION_ID, [
    { afterSeconds: 1.5, show: ["hub-spire-ring-1-lit"], hide: ["hub-spire-ring-1"] },
    { afterSeconds: 2.0, show: ["hub-spire-ring-2-lit"], hide: ["hub-spire-ring-2"] },
    { afterSeconds: 2.5, show: ["hub-spire-ring-3-lit"], hide: ["hub-spire-ring-3"] },
  ]);
  // Coming back from a district: the gateway you returned through glows, then settles.
  x.arrival("hub-return-music", HUB_DESTINATION_ID, [{ afterSeconds: 0, show: ["hub-return-music-glow"] }, { afterSeconds: 6, hide: ["hub-return-music-glow"] }], { fromChunkKey: "music" });
  x.arrival("hub-return-fashion", HUB_DESTINATION_ID, [{ afterSeconds: 0, show: ["hub-return-fashion-glow"] }, { afterSeconds: 6, hide: ["hub-return-fashion-glow"] }], { fromChunkKey: "fashion-culture" });

  return { components, componentIds: Object.keys(components), experience: x.build() };
}
