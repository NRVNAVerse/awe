// @ts-check
/**
 * THE NRVNAVerse — Music District venue room "The Club" (M1 experience campaign, D-017 / D-018).
 *
 * The first INDEPENDENTLY LOADABLE venue room of the Music complex: its own chunk (`music-club`),
 * its own stable destination (`The Club`, kind `venue`, primary district Music), entered from a
 * door on the concourse (portal → stable id → cross-chunk travel) and left through the same door.
 *
 * Thesis (developer truth): an intimate room, not a hall. A dark 22 × 16 m floor walled on three
 * sides and open to the dusk sky above a ring of hanging light bars; a low stage at the north end
 * with a console; a bar counter along the east wall with a back-lit shelf; three booth benches
 * along the west wall; a nine-tile dance floor in the middle. The room WAKES on arrival (bar
 * light, then the three light rings), the dance floor lights while someone is on it, and stepping
 * onto the stage brings the console live and a spot down on it — the same experience system as the
 * rest of the world, reused unchanged. No artist, event or brand is named: the room is a template.
 *
 * Template metadata (product-layer scaffolding for D-018 "Select Your Stage"; documentation, not a
 * contract): see CLUB_TEMPLATE below.
 *
 * Datum: floor top y = 0.5. Spawn (spatial-config placement): (-70, 1, 73.5) facing -Z (north).
 */

import { box, slab, column, rampX, label, glow, pulse, collect, v, deg, zone, experienceOf } from "./lib.mjs";
import { PALETTE } from "./hub.mjs";

/** Stable destination id of The Club (a reference; identity lives in the manifest). */
export const CLUB_ID = "dst_gqq90k2404cy9nf0";
/** Stable destination id of the Music District (the concourse this room belongs to). */
export const MUSIC_DISTRICT_ID = "dst_gm3xs4a3tws7bgh3";

/** Venue-template facts (measured from this composition; informs a future curated stage library). */
export const CLUB_TEMPLATE = Object.freeze({
  templateId: "venue-template.club-intimate",
  room: "22 × 16 m, walls 5.5 m, open roof with light rings at 6.5 m",
  stage: "low riser 10 × 4 × 0.6 m at the north end, one console",
  audience: "nine-tile dance floor (6 × 6 m) + three booths; ≈ 40 avatars comfortably",
  sightlines: "single room, stage visible from the door",
  media: "none yet (console surface is the first media slot)",
  mobile: "small room, no interior ceiling below the camera rig",
});

export const CLUB_TAGS = Object.freeze({
  structure: "m1-club-structure",
  stage: "m1-club-stage",
  route: "m1-club-route",
  reactive: "m1-club-reactive",
  zone: "m1-club-zone",
  portal: "m0-portal",
});

const CX = -70;
const CZ = 68; // room centre z (room spans z 60..76)
const DATUM = 0.5;
const WALL_H = 5.5;
const TEAL = PALETTE.music;
const INK = "#15171d";
const PLUM = "#3a2434";
const BAR_WOOD = "#5a3f2e";

function portal(id, name, position, size, color, rotY = 0) {
  return box(id, position, size, { name, color, opacity: 0.22, collider: "sensor", castShadow: false, receiveShadow: false, tag: CLUB_TAGS.portal, rotation: { x: 0, y: deg(rotY), z: 0 } });
}

export function composeClub() {
  const T = CLUB_TAGS;
  /** @type {Array<Record<string, unknown> & { id: string }>} */
  const items = [];

  // --- 1. Floor and walls (south wall has the door gap, 4 m wide, centred) ---------------------
  items.push(box("platform-music-club", v(CX, 0.25, CZ), [22, 0.5, 16], { name: "Club floor", color: INK, tag: T.structure }));
  items.push(slab("club-wall-n", CX, DATUM, CZ - 8.25, [22.5, WALL_H, 0.5], { name: "Club north wall", color: PLUM, tag: T.structure }));
  items.push(slab("club-wall-w", CX - 11.25, DATUM, CZ, [0.5, WALL_H, 16], { name: "Club west wall", color: PLUM, tag: T.structure }));
  items.push(slab("club-wall-e", CX + 11.25, DATUM, CZ, [0.5, WALL_H, 16], { name: "Club east wall", color: PLUM, tag: T.structure }));
  items.push(slab("club-wall-sw", CX - 6.75, DATUM, CZ + 8.25, [9.5, WALL_H, 0.5], { name: "Club south wall (west of the door)", color: PLUM, tag: T.structure }));
  items.push(slab("club-wall-se", CX + 6.75, DATUM, CZ + 8.25, [9.5, WALL_H, 0.5], { name: "Club south wall (east of the door)", color: PLUM, tag: T.structure }));
  items.push(slab("club-door-lintel", CX, DATUM + 4.2, CZ + 8.25, [4.6, 1.3, 0.6], { name: "Club door lintel", color: PLUM, tag: T.structure }));
  items.push(label("label-music-club", "THE CLUB", v(CX, DATUM + 3.3, CZ + 7.9), { scale: 0.9, name: "Label The Club (inside the door)", color: TEAL, width: 1200 }));

  // --- 2. Light rings hanging over the floor (dormant / lit) ---------------------------------
  for (const [i, dz] of [-4, 0, 4].entries()) {
    items.push(
      column(`club-ring-${i + 1}`, CX, DATUM + 6.3, CZ + dz, 3.6, 0.12, {
        name: `Light ring ${i + 1} (dormant)`,
        color: "#2a2d36",
        segments: 40,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [pulse(TEAL, { intensity: 0.15, speed: 0.4 })],
        tag: T.structure,
      }),
    );
    items.push(
      column(`club-ring-${i + 1}-lit`, CX, DATUM + 6.25, CZ + dz, 3.8, 0.2, {
        name: `Light ring ${i + 1} (lit)`,
        color: "#bffbf2",
        segments: 40,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(TEAL, { intensity: 2.0, power: 1.2, speed: 0.9, pulse: 1 })],
        tag: T.reactive,
      }),
    );
  }
  for (const [i, dz] of [-4, 0, 4].entries()) {
    items.push(column(`club-ring-${i + 1}-drop`, CX, DATUM + 6.4, CZ + dz, 0.06, 2.0, { name: `Light ring ${i + 1} drop`, color: PALETTE.charcoal, segments: 6, collider: "none", castShadow: false, tag: T.structure }));
  }

  // --- 3. Stage (north end), console, spot ---------------------------------------------------
  items.push(box("club-stage", v(CX, DATUM + 0.3, CZ - 6), [10, 0.6, 4], { name: "Club stage riser", color: PALETTE.charcoal, tag: T.stage }));
  // The riser is 0.6 m: a step the character controller cannot climb, so a 16.7° ramp joins the
  // floor to the riser's west end (clear of the booths; SIC-checked).
  items.push(rampX("club-stage-ramp", CZ - 6, CX - 7, DATUM, CX - 5, DATUM + 0.6, 3, { name: "Club stage ramp", color: PALETTE.charcoal, tag: T.route }));
  items.push(slab("club-console", CX, DATUM + 0.6, CZ - 6.6, [2.6, 0.9, 0.8], { name: "Club console", color: PALETTE.stoneDark, tag: T.stage }));
  items.push(
    slab("club-console-top", CX, DATUM + 1.5, CZ - 6.6, [2.4, 0.1, 0.7], {
      name: "Club console surface",
      color: TEAL,
      collider: "none",
      castShadow: false,
      plugins: [{ id: "HologramPlugin", color: TEAL, scanDensity: 28, scanSpeed: 2, flickerStrength: 0.04 }],
      tag: T.stage,
    }),
  );
  items.push(
    slab("club-console-live", CX, DATUM + 1.52, CZ - 6.6, [2.5, 0.14, 0.8], {
      name: "Club console surface (live)",
      color: "#9ff5e8",
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [glow(TEAL, { intensity: 2.0, power: 1.2, speed: 2.0, pulse: 1 })],
      tag: T.reactive,
    }),
  );
  items.push(
    column("club-stage-spot", CX, DATUM + 0.6, CZ - 6, 1.6, 6.6, {
      name: "Club stage spot (lit)",
      color: "#cffcf4",
      opacity: 0.16,
      segments: 24,
      radiusTop: 0.4,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      tag: T.reactive,
    }),
  );
  items.push(
    slab("club-stage-back", CX, DATUM + 0.6, CZ - 7.9, [10, 4.4, 0.2], {
      name: "Club stage back wall (dark)",
      color: "#0f1116",
      collider: "none",
      castShadow: false,
      plugins: [pulse(TEAL, { intensity: 0.12, speed: 0.3 })],
      tag: T.stage,
    }),
  );

  // --- 4. Dance floor: nine tiles (dark / lit) -------------------------------------------------
  let t = 0;
  for (const dz of [-2, 0, 2]) {
    for (const dx of [-2, 0, 2]) {
      t += 1;
      items.push(box(`club-tile-${t}`, v(CX + dx, DATUM + 0.01, CZ + dz), [1.9, 0.02, 1.9], { name: `Dance tile ${t} (dark)`, color: "#20242c", collider: "none", castShadow: false, receiveShadow: false, tag: T.structure }));
      items.push(
        box(`club-tile-${t}-lit`, v(CX + dx, DATUM + 0.015, CZ + dz), [1.9, 0.02, 1.9], {
          name: `Dance tile ${t} (lit)`,
          color: t % 2 === 0 ? "#8ff2e4" : "#ffd98a",
          opacity: 0.85,
          collider: "none",
          castShadow: false,
          receiveShadow: false,
          plugins: [pulse(t % 2 === 0 ? TEAL : PALETTE.ember, { intensity: 0.6, speed: 1.4 })],
          tag: T.reactive,
        }),
      );
    }
  }

  // --- 5. Bar (east wall) and booths (west wall) ---------------------------------------------
  items.push(slab("club-bar", CX + 9.6, DATUM, CZ + 1, [1.2, 1.1, 9], { name: "Bar counter", color: BAR_WOOD, tag: T.structure }));
  items.push(slab("club-bar-top", CX + 9.6, DATUM + 1.1, CZ + 1, [1.4, 0.08, 9.2], { name: "Bar top", color: PALETTE.stoneLight, collider: "none", castShadow: false, tag: T.structure }));
  items.push(slab("club-bar-shelf", CX + 10.9, DATUM + 1.6, CZ + 1, [0.2, 1.8, 9], { name: "Bar back shelf", color: "#2a1d18", collider: "none", castShadow: false, tag: T.structure }));
  items.push(
    slab("club-bar-light", CX + 10.75, DATUM + 1.7, CZ + 1, [0.1, 1.6, 8.8], {
      name: "Bar back light (lit)",
      color: PALETTE.warmLight,
      opacity: 0.7,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [glow(PALETTE.ember, { intensity: 1.8, power: 1.2, speed: 0.7, pulse: 1 })],
      tag: T.reactive,
    }),
  );
  for (const [i, dz] of [-4, 0, 4].entries()) {
    items.push(slab(`club-booth-${i + 1}`, CX - 9.8, DATUM, CZ + dz, [1.2, 0.45, 2.6], { name: `Booth bench ${i + 1}`, color: PLUM, tag: T.route }));
    items.push(slab(`club-booth-${i + 1}-back`, CX - 10.6, DATUM, CZ + dz, [0.3, 1.2, 2.6], { name: `Booth back ${i + 1}`, color: PLUM, tag: T.route }));
    items.push(slab(`club-booth-${i + 1}-table`, CX - 8.3, DATUM, CZ + dz, [0.9, 0.75, 1.2], { name: `Booth table ${i + 1}`, color: BAR_WOOD, tag: T.route }));
  }

  // --- 6. Experience zones (dance floor; stage) ------------------------------------------------
  items.push(zone("club-zone-floor", v(CX, DATUM + 1.5, CZ), [6, 3, 6], { name: "Zone dance floor", tag: T.zone }));
  items.push(zone("club-zone-stage", v(CX, DATUM + 2.1, CZ - 6), [10, 3, 4], { name: "Zone stage", tag: T.zone }));

  // --- 7. Portal sensor last: the door back to the concourse (Music District) -----------------
  items.push(portal("portal-club-music", "Portal The Club → Music District", v(CX, 2, CZ + 8.9), [4, 3, 1], PALETTE.warmLight));

  const components = collect(items);

  // --- 8. Experience bindings -------------------------------------------------------------------
  const x = experienceOf("music-club");
  const tilesLit = Array.from({ length: 9 }, (_, i) => `club-tile-${i + 1}-lit`);
  x.hide("club-ring-1-lit", "club-ring-2-lit", "club-ring-3-lit", "club-console-live", "club-stage-spot", "club-bar-light", ...tilesLit);
  // The room wakes when you arrive: the bar light first, then the rings from the door inward.
  x.arrival("club-wake", CLUB_ID, [
    { afterSeconds: 0.3, show: ["club-bar-light"] },
    { afterSeconds: 0.8, show: ["club-ring-3-lit"], hide: ["club-ring-3"] },
    { afterSeconds: 1.2, show: ["club-ring-2-lit"], hide: ["club-ring-2"] },
    { afterSeconds: 1.6, show: ["club-ring-1-lit"], hide: ["club-ring-1"] },
  ]);
  // The dance floor lights while someone is on it.
  x.zone("club-floor", "club-zone-floor", { enter: { show: tilesLit }, exit: { hide: tilesLit } });
  // Stepping onto the stage brings the console live and a spot down; the spot lifts when you step off.
  x.zone("club-stage", "club-zone-stage", { enter: { show: ["club-console-live", "club-stage-spot"] }, exit: { hide: ["club-stage-spot"] } });

  return { components, componentIds: Object.keys(components), experience: x.build() };
}
