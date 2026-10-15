// @ts-check
/**
 * THE NRVNAVerse — Fashion / Culture District composition ("the Runway and the Loggia").
 *
 * Thesis (developer truth): a pale travertine court. The processional path is a raised RUNWAY
 * (1 m up, flush ramps at both ends) lined by slender pylons with rose light bands, leading to a
 * roofed gallery loggia at the Placeholder Brand destination: two rows of columns, three empty
 * display plinths and three empty wall frames (future brand slots, no brand invented). The loggia's
 * roof is a terrace reached by an outboard ramp on the east side; from it you look down into the
 * open-roofed ATELIER behind the loggia's north wall — a quiet room entered only from its west side,
 * led to by a line of rose studs, with a ring of mannequin pedestals wearing holograms.
 *
 * Preserved ids: `platform-fashion-culture`, `label-fashion-culture`, `platform-fashion-culture-brand`,
 * `label-fashion-culture-brand`, `path-fashion-north`, `portal-fashion-hub`, `portal-fashion-brand`.
 * Spawns: district (70, 1, 6) facing -Z; brand spawn moved onto the runway's north end (70, 2, -36)
 * (spatial-config placement) so the brand threshold sensor at the end of the runway reads as a
 * seamless step into the loggia.
 */

import { box, slab, column, sphere, rampZ, label, glow, pulse, collect, v, deg, zone, experienceOf } from "./lib.mjs";
import { PALETTE } from "./hub.mjs";

/** Stable destination id the Fashion arrival beats bind to (a reference; identity lives in the manifest). */
export const PLACEHOLDER_BRAND_ID = "dst_tgfh5h5jvm3wj0w7";

const CX = 70;
const DATUM = 0.5;
const RUNWAY_TOP = 1.5;
const ROOF_TOP = 7.1;
const ROSE = PALETTE.fashion;
const TRAVERTINE = "#cfc6b4";
const TRAVERTINE_DARK = "#b3a995";

export const FASHION_TAGS = Object.freeze({
  structure: "m1-fashion-structure",
  runway: "m1-fashion-runway",
  loggia: "m1-fashion-loggia",
  route: "m1-fashion-route",
  clue: "m1-fashion-clue",
  secret: "m1-fashion-secret",
  portal: "m0-portal",
  reactive: "m1-fashion-reactive",
  zone: "m1-fashion-zone",
});

function portal(id, name, position, size, color, rotY = 0) {
  return box(id, position, size, { name, color, opacity: 0.22, collider: "sensor", castShadow: false, receiveShadow: false, tag: FASHION_TAGS.portal, rotation: { x: 0, y: deg(rotY), z: 0 } });
}

export function composeFashion() {
  const T = FASHION_TAGS;
  /** @type {Array<Record<string, unknown> & { id: string }>} */
  const items = [];

  // --- 1. Floors ------------------------------------------------------------------------------
  items.push(box("platform-fashion-culture", v(CX, 0.25, 0), [24, 0.5, 24], { name: "Court floor", color: TRAVERTINE, tag: T.structure }));
  items.push(box("path-fashion-north", v(CX, 0.25, -20), [8, 0.5, 16], { name: "Runway apron", color: TRAVERTINE_DARK, tag: T.route }));
  items.push(box("platform-fashion-culture-brand", v(CX, 0.25, -40), [24, 0.5, 24], { name: "Loggia floor", color: TRAVERTINE, tag: T.structure }));

  // --- 2. The runway: raised spine with flush ramps at both ends ------------------------------
  items.push(box("fashion-runway", v(CX, DATUM + 0.5, -22), [4, 1, 20], { name: "Runway", color: "#e8e1d2", tag: T.runway }));
  items.push(rampZ("fashion-runway-ramp-s", CX, -6, DATUM, -12, RUNWAY_TOP, 4, { name: "Runway ramp south", color: "#e8e1d2", tag: T.runway }));
  items.push(rampZ("fashion-runway-ramp-n", CX, -38, DATUM, -32, RUNWAY_TOP, 4, { name: "Runway ramp north", color: "#e8e1d2", tag: T.runway }));
  for (const [i, [dx, z]] of [[-5, -14], [5, -14], [-5, -22], [5, -22], [-5, -30], [5, -30]].entries()) {
    const x = CX + dx;
    items.push(column(`fashion-pylon-${i + 1}`, x, DATUM, z, 0.4, 8, { name: `Pylon ${i + 1}`, color: TRAVERTINE_DARK, segments: 16, tag: T.runway }));
    items.push(
      column(`fashion-pylon-${i + 1}-band`, x, DATUM + 5.2, z, 0.48, 0.35, {
        name: `Pylon ${i + 1} band`,
        color: ROSE,
        segments: 16,
        collider: "none",
        castShadow: false,
        plugins: [pulse(ROSE, { intensity: 0.5, speed: 0.7 })],
        tag: T.runway,
      }),
    );
    // The walk: each pair of pylons lights as the visitor passes it on the runway (hidden until then).
    items.push(
      column(`fashion-pylon-${i + 1}-band-lit`, x, DATUM + 5.0, z, 0.56, 0.75, {
        name: `Pylon ${i + 1} band (lit)`,
        color: "#ffd2c4",
        segments: 16,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(ROSE, { intensity: 2.2, power: 1.2, speed: 1.2, pulse: 1 })],
        tag: T.reactive,
      }),
    );
  }
  items.push(slab("fashion-bench-w", CX - 9, DATUM, -22, [0.9, 0.45, 3], { name: "Runway bench west", color: TRAVERTINE_DARK, tag: T.route }));
  items.push(slab("fashion-bench-e", CX + 9, DATUM, -22, [0.9, 0.45, 3], { name: "Runway bench east", color: TRAVERTINE_DARK, tag: T.route }));

  // --- 3. The loggia: columns, roof terrace, plinths, north wall with empty frames -------------
  for (const [i, dx] of [-8, 8].entries()) {
    for (const [j, z] of [-42.5, -46, -49.5, -53].entries()) {
      items.push(column(`fashion-col-${i === 0 ? "w" : "e"}${j + 1}`, CX + dx, DATUM, z, 0.5, 6, { name: `Loggia column ${i === 0 ? "west" : "east"} ${j + 1}`, color: TRAVERTINE, segments: 20, tag: T.loggia }));
    }
  }
  items.push(box("fashion-roof", v(CX, ROOF_TOP - 0.3, -47.5), [24, 0.6, 13], { name: "Loggia roof / terrace", color: TRAVERTINE, tag: T.loggia }));
  items.push(slab("fashion-north-wall", CX, DATUM, -53.75, [20, 6, 0.5], { name: "Loggia north wall", color: TRAVERTINE_DARK, tag: T.loggia }));
  for (const [i, dx] of [-6, 0, 6].entries()) {
    items.push(slab(`fashion-plinth-${i + 1}`, CX + dx, DATUM, -47.5, [1.2, 1, 1.2], { name: `Display plinth ${i + 1} (empty)`, color: "#e8e1d2", tag: T.loggia }));
    items.push(
      slab(`fashion-frame-${i + 1}`, CX + dx, DATUM + 1.4, -53.4, [2.4, 3.2, 0.1], {
        name: `Wall frame ${i + 1} (empty)`,
        color: "#1c1a20",
        opacity: 0.9,
        castShadow: false,
        plugins: [pulse(ROSE, { intensity: 0.1, speed: 0.3 })],
        tag: T.loggia,
      }),
    );
    // Gallery light: the frame's rim lights while the loggia is occupied (hidden otherwise).
    items.push(
      slab(`fashion-frame-${i + 1}-lit`, CX + dx, DATUM + 1.3, -53.33, [2.6, 3.4, 0.06], {
        name: `Wall frame ${i + 1} rim (lit)`,
        color: "#ffd2c4",
        opacity: 0.8,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(ROSE, { intensity: 2.0, power: 1.3, speed: 0.9, pulse: 1 })],
        tag: T.reactive,
      }),
    );
  }
  // Roof terrace: outboard ramp on the east side (15.4°), bench and lamp on the roof.
  // Outboard of the loggia floor's east edge (x 82) with NO lateral overlap with the roof slab (its edge
  // would be a chest-high lip beside the ramp; headless-verified): foot block flush with the floor
  // corner, 15.4° ramp x 82.5..85.5 from z -28 to -52, and a landing at the roof's north-east corner.
  items.push(box("fashion-roof-ramp-foot", v(CX + 12.5, 0.25, -27), [4, 0.5, 6], { name: "Roof ramp foot", color: TRAVERTINE_DARK, tag: T.route }));
  items.push(rampZ("fashion-roof-ramp", CX + 14, -28, DATUM, -52, ROOF_TOP, 3, { name: "Roof terrace ramp", color: TRAVERTINE_DARK, tag: T.route }));
  items.push(box("fashion-roof-landing", v(CX + 13.25, ROOF_TOP - 0.3, -53), [4.5, 0.6, 2], { name: "Roof ramp landing", color: TRAVERTINE_DARK, tag: T.route }));
  items.push(column("fashion-roof-ramp-post", CX + 14, 0, -40, 0.4, 3.4, { name: "Roof ramp post", color: TRAVERTINE_DARK, segments: 12, tag: T.route }));
  items.push(slab("fashion-roof-bench", CX - 4, ROOF_TOP, -46, [3, 0.45, 0.9], { name: "Roof bench", color: TRAVERTINE_DARK, tag: T.route }));
  items.push(column("fashion-roof-lamp-post", CX + 6, ROOF_TOP, -44, 0.1, 1.3, { name: "Roof lamp post", color: PALETTE.charcoal, segments: 8, collider: "none", tag: T.route }));
  // The roof lamp is dim until someone reaches the terrace; it lights while the roof is occupied.
  items.push(
    sphere("fashion-roof-lamp", v(CX + 6, ROOF_TOP + 1.6, -44), 0.4, {
      name: "Roof lamp (dim)",
      color: "#6b4a44",
      collider: "none",
      castShadow: false,
      plugins: [pulse(ROSE, { intensity: 0.25, speed: 0.4 })],
      tag: T.route,
    }),
  );
  items.push(
    sphere("fashion-roof-lamp-lit", v(CX + 6, ROOF_TOP + 1.6, -44), 0.46, {
      name: "Roof lamp (lit)",
      color: "#fff1cf",
      collider: "none",
      castShadow: false,
      plugins: [glow(ROSE, { intensity: 2.2, power: 1.4, speed: 0.5, pulse: 1 })],
      tag: T.reactive,
    }),
  );
  items.push(
    column("fashion-roof-lamp-pool", CX + 6, ROOF_TOP + 0.005, -44, 2.6, 0.02, {
      name: "Roof lamp light pool",
      color: ROSE,
      opacity: 0.3,
      segments: 32,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      tag: T.reactive,
    }),
  );

  // --- 4. The atelier: open-roofed room behind the north wall, entrance on its west side -------
  // Flush with the loggia floor (which ends at z -52) and wide enough to walk round the north wall's west end.
  items.push(box("fashion-atelier-floor", v(CX, 0.25, -58), [24, 0.5, 12], { name: "Atelier floor", color: TRAVERTINE_DARK, tag: T.secret }));
  items.push(slab("fashion-atelier-wall-n", CX, DATUM, -63.75, [14, 5, 0.5], { name: "Atelier north wall", color: TRAVERTINE_DARK, tag: T.secret }));
  items.push(slab("fashion-atelier-wall-e", CX + 6.75, DATUM, -59, [0.5, 5, 10], { name: "Atelier east wall", color: TRAVERTINE_DARK, tag: T.secret }));
  items.push(slab("fashion-atelier-wall-w", CX - 6.75, DATUM, -61.25, [0.5, 5, 5], { name: "Atelier west wall (north half; the gap is the entrance)", color: TRAVERTINE_DARK, tag: T.secret }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = CX + 2.8 * Math.sin(a);
    const z = -59 + 2.8 * Math.cos(a);
    items.push(column(`fashion-mannequin-${i + 1}`, x, DATUM, z, 0.35, 1.2, { name: `Mannequin pedestal ${i + 1}`, color: "#e8e1d2", segments: 16, tag: T.secret }));
    items.push(
      sphere(`fashion-mannequin-${i + 1}-holo`, v(x, DATUM + 2.0, z), 0.38, {
        name: `Mannequin hologram ${i + 1}`,
        color: ROSE,
        opacity: 0.85,
        collider: "none",
        castShadow: false,
        plugins: [{ id: "HologramPlugin", color: ROSE, scanDensity: 36, scanSpeed: 2, flickerStrength: 0.05 }],
        tag: T.secret,
      }),
    );
  }
  items.push(label("fashion-atelier-line", "the atelier is quiet — nothing is hung yet", v(CX, 2.6, -63.45), { scale: 0.6, name: "Atelier inscription", color: ROSE, font: "playfair-italic", width: 1600 }));
  // The atelier wakes when entered: a rose ring under the pedestals.
  items.push(
    column("fashion-atelier-ring", CX, DATUM + 0.03, -59, 3.6, 0.02, {
      name: "Atelier ring (inside)",
      color: ROSE,
      opacity: 0.4,
      segments: 48,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [pulse("#ffd2c4", { intensity: 0.6, speed: 0.9 })],
      tag: T.reactive,
    }),
  );
  for (const [i, [x, z]] of [[CX - 10.5, -49], [CX - 11.2, -53], [CX - 10.5, -56.5], [CX - 8, -56.5]].entries()) {
    items.push(
      column(`fashion-stud-${i + 1}`, x, DATUM - 0.01, z, 0.24, 0.03, {
        name: `Floor stud ${i + 1}`,
        color: ROSE,
        segments: 12,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [pulse(ROSE, { intensity: 0.5, speed: 0.45 })],
        tag: T.clue,
      }),
    );
  }

  // --- 5. Copy and gateways ------------------------------------------------------------------
  items.push(label("label-fashion-culture", "FASHION / CULTURE", v(CX, 9.2, -13.5), { scale: 1.5, name: "Label Fashion / Culture District", color: ROSE, width: 1600 }));
  items.push(label("label-fashion-culture-brand", "Placeholder Fashion / Culture Brand", v(CX, ROOF_TOP - 1.0, -40.8), { scale: 0.9, name: "Label Placeholder Brand", color: "#3a3330", width: 1800 }));
  items.push(column("fashion-gate-hub-post-n", CX - 9, DATUM, -7.9, 0.45, 5, { name: "Hub gateway post north", color: TRAVERTINE_DARK, segments: 16, tag: T.structure }));
  items.push(column("fashion-gate-hub-post-s", CX - 9, DATUM, 7.9, 0.45, 5, { name: "Hub gateway post south", color: TRAVERTINE_DARK, segments: 16, tag: T.structure }));
  items.push(slab("fashion-gate-hub-lintel", CX - 9, DATUM + 5, 0, [1.2, 0.7, 17], { name: "Hub gateway lintel", color: TRAVERTINE_DARK, tag: T.structure }));
  items.push(label("fashion-gate-hub-label", "HUB", v(CX - 8.3, DATUM + 6.6, 0), { scale: 0.95, name: "Label Hub gateway", color: PALETTE.warmLight, rotation: { x: 0, y: deg(90), z: 0 } }));
  items.push(column("fashion-gate-brand-post-w", CX - 3, DATUM, -33, 0.3, 3.6, { name: "Brand threshold post west", color: TRAVERTINE_DARK, segments: 12, tag: T.structure }));
  items.push(column("fashion-gate-brand-post-e", CX + 3, DATUM, -33, 0.3, 3.6, { name: "Brand threshold post east", color: TRAVERTINE_DARK, segments: 12, tag: T.structure }));

  // --- 5b. Experience zones (invisible sensor volumes; SIC-measured anchors: runway x 68..72 /
  //         top 1.5, roof x 58..82 / z -54..-41 / top 7.1 (+ landing to x 85.5), atelier interior
  //         x 63.5..76.5 / z -63.5..-54) ---------------------------------------------------------
  items.push(zone("fashion-zone-walk-1", v(CX, RUNWAY_TOP + 1.5, -14), [4, 3, 6], { name: "Zone runway pair 1", tag: T.zone }));
  items.push(zone("fashion-zone-walk-2", v(CX, RUNWAY_TOP + 1.5, -22), [4, 3, 6], { name: "Zone runway pair 2", tag: T.zone }));
  items.push(zone("fashion-zone-walk-3", v(CX, RUNWAY_TOP + 1.5, -30), [4, 3, 5], { name: "Zone runway pair 3", tag: T.zone }));
  items.push(zone("fashion-zone-loggia", v(CX, DATUM + 2, -47.5), [16, 4, 11], { name: "Zone loggia", tag: T.zone }));
  items.push(zone("fashion-zone-roof", v(CX + 2, ROOF_TOP + 1.5, -47.5), [28, 3, 13], { name: "Zone roof terrace", tag: T.zone }));
  items.push(zone("fashion-zone-atelier", v(CX, DATUM + 2, -58.75), [13, 4, 9.5], { name: "Zone atelier", tag: T.zone }));

  // --- 6. Portal sensors last (ids and sensor semantics unchanged from M0) --------------------
  items.push(portal("portal-fashion-hub", "Portal Fashion / Culture District → Hub", v(CX - 9, 2, 0), [1, 3, 14], PALETTE.warmLight));
  // Brand threshold: at the runway's north end (deck top 1.5, slab spans y 0.5..3.5), so the brand
  // destination is entered by walking the runway, not by stepping off the spawn.
  items.push(portal("portal-fashion-brand", "Portal Fashion / Culture District → Placeholder Brand", v(CX, 2, -33), [6, 3, 1], ROSE));

  const components = collect(items);

  // --- 7. Experience bindings -------------------------------------------------------------------
  const x = experienceOf("fashion-culture");
  x.hide(
    ...[1, 2, 3, 4, 5, 6].map((i) => `fashion-pylon-${i}-band-lit`),
    ...[1, 2, 3].map((i) => `fashion-frame-${i}-lit`),
    "fashion-roof-lamp-lit",
    "fashion-roof-lamp-pool",
    "fashion-atelier-ring",
  );
  // The walk: pylon pairs light as the visitor passes and stay lit.
  for (const [k, pair] of [[1, [1, 2]], [2, [3, 4]], [3, [5, 6]]]) {
    const ids = /** @type {number[]} */ (pair);
    x.zone(`fashion-walk-${k}`, `fashion-zone-walk-${k}`, { enter: { show: ids.map((i) => `fashion-pylon-${i}-band-lit`), hide: ids.map((i) => `fashion-pylon-${i}-band`) } });
  }
  // The gallery lights while occupied.
  x.zone("fashion-loggia", "fashion-zone-loggia", {
    enter: { show: ["fashion-frame-1-lit", "fashion-frame-2-lit", "fashion-frame-3-lit"] },
    exit: { hide: ["fashion-frame-1-lit", "fashion-frame-2-lit", "fashion-frame-3-lit"] },
  });
  // Reaching the roof lights its lamp; leaving dims it.
  x.zone("fashion-roof", "fashion-zone-roof", {
    enter: { show: ["fashion-roof-lamp-lit", "fashion-roof-lamp-pool"], hide: ["fashion-roof-lamp"] },
    exit: { show: ["fashion-roof-lamp"], hide: ["fashion-roof-lamp-lit", "fashion-roof-lamp-pool"] },
  });
  // The atelier wakes when entered.
  x.zone("fashion-atelier", "fashion-zone-atelier", { enter: { show: ["fashion-atelier-ring"] }, exit: { hide: ["fashion-atelier-ring"] } });
  // Arriving at the brand threshold (end of the runway): the frames light one after another.
  x.arrival("fashion-brand-welcome", PLACEHOLDER_BRAND_ID, [
    { afterSeconds: 0.3, show: ["fashion-frame-1-lit"] },
    { afterSeconds: 0.6, show: ["fashion-frame-2-lit"] },
    { afterSeconds: 0.9, show: ["fashion-frame-3-lit"] },
  ]);

  return { components, componentIds: Object.keys(components), experience: x.build() };
}
