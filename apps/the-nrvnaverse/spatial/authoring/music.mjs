// @ts-check
/**
 * THE NRVNAVerse — Music District composition ("the Soundstage", M1 creative build).
 *
 * Thesis (developer truth; see docs/NRVNAVERSE_HUB_WORLD.md §9 for the district notes):
 *   A dark floor of concentric lit rings under the dusk sky. The arrival faces north along a
 *   processional path flanked by speaker stacks toward the Placeholder Artist stage: a riser with
 *   side ramps in front of a crescendo of five charcoal fins, each carrying a teal ribbon of
 *   light. Behind the arrival, on the district's west edge, a long ramp climbs to a sound booth —
 *   an overlook over the whole floor that is not visible from the spawn.
 *
 * Preserved ids (pipeline, tests, portal bindings): `platform-music`, `label-music`,
 * `platform-music-artist`, `label-music-artist`, `path-music-north`, `portal-music-hub`,
 * `portal-music-artist`. Spawns (spatial-config placements) are unchanged: district (-70, 1, 6)
 * facing -Z, artist (-70, 1, -34).
 */

import { box, slab, column, sphere, rampZ, label, glow, pulse, collect, v, deg, zone, experienceOf } from "./lib.mjs";
import { PALETTE } from "./hub.mjs";

/** Stable destination ids the Music arrival beats bind to (references; identity lives in the manifest). */
export const MUSIC_DISTRICT_ID = "dst_gm3xs4a3tws7bgh3";
export const PLACEHOLDER_ARTIST_ID = "dst_1qtfn9qjg9kf6jyd";
export const CLUB_DESTINATION_ID = "dst_gqq90k2404cy9nf0";

/**
 * Venue complex (D-017 / D-018): the Music District floor is the CONCOURSE; each venue room is a
 * door off it. The Soundstage (processional path + stage, this chunk) and The Club (its own chunk,
 * `club.mjs`) are the first two rooms. `TONIGHT` is the config-driven "select your stage" proof:
 * the marquee names the assigned room and only that room's door is lit — changing one value here
 * re-composes the concourse (no backend, no manifest change, fully reversible). The manifests stay
 * canonical for identity; this is product-layer authoring scaffolding, not an event system.
 */
export const VENUE_ROOMS = Object.freeze({
  soundstage: { label: "THE SOUNDSTAGE", templateId: "venue-template.soundstage-open", room: "open-air stage with five fins, processional approach, booth overlook" },
  club: { label: "THE CLUB", templateId: "venue-template.club-intimate", room: "intimate walled room, low stage, bar, booths, dance floor (separate chunk)" },
});
/** Tonight's assignment (placeholder programme; no real event or artist is named). */
export const TONIGHT = Object.freeze({ room: /** @type {keyof typeof VENUE_ROOMS} */ ("club"), line: "placeholder listening session" });

const CX = -70; // district centre x
const DATUM = 0.5;

export const MUSIC_TAGS = Object.freeze({
  structure: "m1-music-structure",
  stage: "m1-music-stage",
  route: "m1-music-route",
  clue: "m1-music-clue",
  secret: "m1-music-secret",
  portal: "m0-portal",
  reactive: "m1-music-reactive",
  zone: "m1-music-zone",
});

const TEAL = PALETTE.music;
const TEAL_DEEP = "#176f66";
const FLOOR = "#1f2229";

function portal(id, name, position, size, color, rotY = 0) {
  return box(id, position, size, { name, color, opacity: 0.22, collider: "sensor", castShadow: false, receiveShadow: false, tag: MUSIC_TAGS.portal, rotation: { x: 0, y: deg(rotY), z: 0 } });
}

export function composeMusic() {
  const T = MUSIC_TAGS;
  /** @type {Array<Record<string, unknown> & { id: string }>} */
  const items = [];

  // --- 1. Floors -------------------------------------------------------------------------------
  items.push(box("platform-music", v(CX, 0.25, 0), [24, 0.5, 24], { name: "Soundstage floor", color: FLOOR, tag: T.structure }));
  for (const [i, [r, c]] of [[10, "#23313a"], [7, "#1d3b3b"], [4, TEAL_DEEP]].entries()) {
    items.push(column(`music-ring-${i + 1}`, CX, 0, 0, r, 0.505 + i * 0.004, { name: `Floor ring ${i + 1}`, color: c, segments: 48, collider: "none", castShadow: false, tag: T.structure }));
  }
  items.push(box("path-music-north", v(CX, 0.25, -20), [6, 0.5, 16], { name: "Processional path", color: FLOOR, tag: T.route }));
  items.push(box("platform-music-artist", v(CX, 0.25, -40), [24, 0.5, 24], { name: "Stage floor", color: FLOOR, tag: T.structure }));

  // --- 2. Speaker stacks along the processional path --------------------------------------------
  for (const [i, [dx, z]] of [[-4.5, -16], [4.5, -16], [-4.5, -24], [4.5, -24]].entries()) {
    const x = CX + dx;
    items.push(slab(`music-stack-${i + 1}`, x, DATUM, z, [1.4, 4.2, 1.4], { name: `Speaker stack ${i + 1}`, color: PALETTE.charcoal, tag: T.structure }));
    items.push(
      slab(`music-stack-${i + 1}-band`, x, DATUM + 2.0, z, [1.5, 0.3, 1.5], {
        name: `Speaker stack ${i + 1} band`,
        color: TEAL,
        collider: "none",
        castShadow: false,
        plugins: [pulse(TEAL, { intensity: 0.6, speed: 1.1 })],
        tag: T.structure,
      }),
    );
    // Soundcheck: the stack lights fully as the visitor walks past it (hidden until then).
    items.push(
      slab(`music-stack-${i + 1}-band-lit`, x, DATUM + 1.9, z, [1.6, 0.5, 1.6], {
        name: `Speaker stack ${i + 1} band (lit)`,
        color: "#8ff2e4",
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(TEAL, { intensity: 2.2, power: 1.2, speed: 1.4, pulse: 1 })],
        tag: T.reactive,
      }),
    );
  }

  // --- 3. The stage: riser, side ramps, fin shell -----------------------------------------------
  // Riser 20 m wide so both side ramps land ON it (ramp top 1 m inside the riser's south edge; headless-verified).
  items.push(box("music-stage-riser", v(CX, DATUM + 0.5, -46), [20, 1, 6], { name: "Stage riser", color: PALETTE.stoneDark, tag: T.stage }));
  items.push(rampZ("music-stage-ramp-w", CX - 8.5, -37, DATUM, -44, DATUM + 1, 3, { name: "Stage ramp west", color: PALETTE.stoneDark, tag: T.route }));
  items.push(rampZ("music-stage-ramp-e", CX + 8.5, -37, DATUM, -44, DATUM + 1, 3, { name: "Stage ramp east", color: PALETTE.stoneDark, tag: T.route }));
  const finHeights = [8, 11, 13, 11, 8];
  for (const [i, a] of [-50, -25, 0, 25, 50].entries()) {
    const rad = (a * Math.PI) / 180;
    const R = 8.5;
    const x = CX + R * Math.sin(rad);
    const z = -47 - R * Math.cos(rad);
    const h = finHeights[i];
    items.push(slab(`music-fin-${i + 1}`, x, DATUM, z, [2.6, h, 0.6], { name: `Stage fin ${i + 1}`, color: PALETTE.charcoal, rotation: { x: 0, y: deg(-a), z: 0 }, tag: T.stage }));
    items.push(
      slab(`music-fin-${i + 1}-ribbon`, x, DATUM + h * 0.55, z, [2.7, 0.35, 0.7], {
        name: `Stage fin ${i + 1} ribbon`,
        color: TEAL,
        rotation: { x: 0, y: deg(-a), z: 0 },
        collider: "none",
        castShadow: false,
        plugins: [glow(TEAL, { intensity: 1.4, power: 1.5, speed: 0.8, pulse: 1 })],
        tag: T.stage,
      }),
    );
    // Crescendo state: a lit blade up the face of each fin (a stripe, not a flood), revealed
    // centre-out when the stage is reached. Browser-tuned 2026-10-15: a full-face 0.85 slab read as
    // a cyan billboard; the stripe keeps the charcoal fin and adds the light.
    items.push(
      slab(`music-fin-${i + 1}-blade`, x, DATUM + h * 0.12, z, [0.9, h * 0.76, 0.72], {
        name: `Stage fin ${i + 1} blade (lit)`,
        color: "#bffbf2",
        rotation: { x: 0, y: deg(-a), z: 0 },
        opacity: 0.7,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [glow(TEAL, { intensity: 2.2, power: 1.1, speed: 1.2, pulse: 1 })],
        tag: T.reactive,
      }),
    );
  }
  // Stage wash: a lit disc on the riser that completes the crescendo (kept inside the riser's
  // 20 × 6 footprint so it never reaches the audience floor; browser-tuned 2026-10-15).
  items.push(
    column("music-stage-wash", CX, DATUM + 1.005, -46.6, 2.6, 0.02, {
      name: "Stage wash (lit)",
      color: TEAL,
      opacity: 0.32,
      segments: 48,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [pulse("#9ff5e8", { intensity: 0.7, speed: 1.6 })],
      tag: T.reactive,
    }),
  );
  // Spotlight thrown from the booth onto the stage centre (the booth controls the room).
  items.push(
    column("music-booth-spot", CX, DATUM + 1.0, -46, 3.2, 14, {
      name: "Booth spotlight (lit)",
      color: "#cffcf4",
      opacity: 0.16,
      segments: 32,
      radiusTop: 0.6,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      tag: T.reactive,
    }),
  );
  items.push(label("label-music-artist", "Placeholder Artist", v(CX, 7.2, -54.2), { scale: 1.3, name: "Label Placeholder Artist", color: "#f3ead8" }));
  items.push(slab("music-bench-w", CX - 9, DATUM, -36, [0.9, 0.45, 3], { name: "Audience bench west", color: PALETTE.stoneLight, tag: T.route }));
  items.push(slab("music-bench-e", CX + 9, DATUM, -36, [0.9, 0.45, 3], { name: "Audience bench east", color: PALETTE.stoneLight, tag: T.route }));

  // --- 4. Arrival copy and the Hub gateway (east edge) -----------------------------------------
  items.push(label("label-music", "MUSIC DISTRICT", v(CX, 7.0, -12.3), { scale: 1.5, name: "Label Music District", color: TEAL, width: 1400 }));
  items.push(column("music-gate-hub-post-n", CX + 9, DATUM, -7.9, 0.45, 5, { name: "Hub gateway post north", color: PALETTE.stoneLight, segments: 16, tag: T.structure }));
  items.push(column("music-gate-hub-post-s", CX + 9, DATUM, 7.9, 0.45, 5, { name: "Hub gateway post south", color: PALETTE.stoneLight, segments: 16, tag: T.structure }));
  items.push(slab("music-gate-hub-lintel", CX + 9, DATUM + 5, 0, [1.2, 0.7, 17], { name: "Hub gateway lintel", color: PALETTE.stoneLight, tag: T.structure }));
  items.push(label("music-gate-hub-label", "HUB", v(CX + 8.3, DATUM + 6.6, 0), { scale: 0.95, name: "Label Hub gateway", color: PALETTE.warmLight, rotation: { x: 0, y: deg(-90), z: 0 } }));
  items.push(column("music-gate-artist-post-w", CX - 3.5, DATUM, -30, 0.3, 3.6, { name: "Stage threshold post west", color: PALETTE.charcoal, segments: 12, tag: T.structure }));
  items.push(column("music-gate-artist-post-e", CX + 3.5, DATUM, -30, 0.3, 3.6, { name: "Stage threshold post east", color: PALETTE.charcoal, segments: 12, tag: T.structure }));

  // --- 4b. The concourse: the Club door (south-east, behind the arrival) and tonight's marquee --
  // The door is a short dark passage off the floor's south edge; its sensor is the portal to The
  // Club (a separate chunk — the passage is a threshold, the room is elsewhere). The marquee over
  // the passage mouth names tonight's room; the assigned room's door glows (config-driven).
  const DOOR_X = CX + 5; // east of the booth ramp foot (x -83..-76), clear of the spawn (x -70, z 6)
  items.push(box("music-club-passage", v(DOOR_X, 0.25, 15), [6, 0.5, 6], { name: "Club passage floor", color: "#141720", tag: T.route }));
  items.push(slab("music-club-passage-wall-w", DOOR_X - 3.25, DATUM, 15, [0.5, 4.2, 6], { name: "Club passage wall west", color: PALETTE.charcoal, tag: T.structure }));
  items.push(slab("music-club-passage-wall-e", DOOR_X + 3.25, DATUM, 15, [0.5, 4.2, 6], { name: "Club passage wall east", color: PALETTE.charcoal, tag: T.structure }));
  items.push(slab("music-club-passage-end", DOOR_X, DATUM, 18.25, [7, 4.2, 0.5], { name: "Club passage end wall", color: "#0f1116", tag: T.structure }));
  items.push(slab("music-club-lintel", DOOR_X, DATUM + 4.2, 12.3, [7, 0.8, 1.0], { name: "Club door lintel", color: PALETTE.charcoal, tag: T.structure }));
  items.push(label("music-club-label", VENUE_ROOMS.club.label, v(DOOR_X, DATUM + 3.3, 12.0), { scale: 0.85, name: "Label The Club door", color: TEAL, width: 1200, rotation: { x: 0, y: deg(180), z: 0 } }));
  items.push(
    slab("music-club-door-glow", DOOR_X, DATUM + 4.15, 12.3, [7.1, 0.9, 1.1], {
      name: "Club door glow (tonight's room)",
      color: TEAL,
      opacity: 0.5,
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [glow(TEAL, { intensity: 1.8, power: 1.2, speed: 0.9, pulse: 1 })],
      tag: T.structure,
    }),
  );
  // Tonight's marquee: a dark board over the Club door, facing the arrival (which faces north,
  // so the visitor finds it by turning round — the same "turn around after you arrive" move as the booth).
  items.push(slab("music-marquee-board", DOOR_X, DATUM + 5.0, 12.2, [9, 2.2, 0.3], { name: "Marquee board", color: "#0f1116", collider: "none", castShadow: false, tag: T.structure }));
  items.push(label("music-marquee-title", "TONIGHT", v(DOOR_X, DATUM + 6.35, 11.95), { scale: 0.7, name: "Marquee title", color: PALETTE.warmLight, width: 1200, rotation: { x: 0, y: deg(180), z: 0 } }));
  items.push(label("music-marquee-room", `${VENUE_ROOMS[TONIGHT.room].label} — ${TONIGHT.line}`, v(DOOR_X, DATUM + 5.45, 11.95), { scale: 0.55, name: "Marquee room line", color: TEAL, width: 1800, rotation: { x: 0, y: deg(180), z: 0 } }));

  // --- 5. The sound booth: an overlook behind the arrival, west edge (hidden from the spawn) ----
  items.push(rampZ("music-booth-ramp", CX - 9.5, -11, DATUM, 6, DATUM + 5, 3, { name: "Booth ramp", color: PALETTE.stoneDark, tag: T.secret }));
  items.push(box("music-booth-ramp-foot", v(CX - 9.5, 0.25, -12.5), [3, 0.5, 3], { name: "Booth ramp foot", color: FLOOR, tag: T.secret }));
  items.push(box("music-booth-deck", v(CX - 9.5, DATUM + 4.75, 9), [7, 0.5, 6], { name: "Sound booth deck", color: PALETTE.charcoal, tag: T.secret }));
  items.push(column("music-booth-post", CX - 12, 0, 11.5, 0.4, DATUM + 4.5, { name: "Sound booth post", color: PALETTE.charcoal, segments: 12, tag: T.secret }));
  items.push(slab("music-booth-desk", CX - 9.5, DATUM + 5, 10.6, [4, 0.9, 1.0], { name: "Mixing desk", color: PALETTE.stoneDark, tag: T.secret }));
  items.push(
    slab("music-booth-console", CX - 9.5, DATUM + 5.9, 10.6, [3.6, 0.12, 0.8], {
      name: "Console surface",
      color: TEAL,
      collider: "none",
      castShadow: false,
      plugins: [{ id: "HologramPlugin", color: TEAL, scanDensity: 30, scanSpeed: 2, flickerStrength: 0.04 }],
      tag: T.secret,
    }),
  );
  items.push(
    slab("music-booth-console-lit", CX - 9.5, DATUM + 5.92, 10.6, [3.7, 0.16, 0.9], {
      name: "Console surface (live)",
      color: "#9ff5e8",
      collider: "none",
      castShadow: false,
      receiveShadow: false,
      plugins: [glow(TEAL, { intensity: 2.0, power: 1.2, speed: 2.0, pulse: 1 })],
      tag: T.reactive,
    }),
  );
  items.push(slab("music-booth-rail", CX - 9.5, DATUM + 5, 12, [7, 1.0, 0.15], { name: "Booth rail", color: PALETTE.stoneDark, tag: T.secret }));
  // The booth sigil (discovery memory, world doc §15): a small glyph on the desk's far end.
  items.push(sphere("music-booth-sigil", v(CX - 11.2, DATUM + 6.3, 10.6), 0.2, { name: "Booth sigil (unfound)", color: "#2a4a46", collider: "none", castShadow: false, plugins: [pulse(TEAL, { intensity: 0.3, speed: 0.6 })], tag: T.secret }));
  items.push(sphere("music-booth-sigil-lit", v(CX - 11.2, DATUM + 6.3, 10.6), 0.24, { name: "Booth sigil (remembered)", color: "#bffbf2", collider: "none", castShadow: false, plugins: [glow(TEAL, { intensity: 2.4, power: 1.2, speed: 1.0, pulse: 1 })], tag: T.reactive }));
  // Studs run beside the ramp (never under it) to its north foot.
  for (const [i, [x, z]] of [[CX - 6, -2], [CX - 6.5, -6], [CX - 7.5, -10], [CX - 9.5, -12.6]].entries()) {
    items.push(
      column(`music-stud-${i + 1}`, x, DATUM - 0.01, z, 0.24, 0.03, {
        name: `Floor stud ${i + 1}`,
        color: TEAL,
        segments: 12,
        collider: "none",
        castShadow: false,
        receiveShadow: false,
        plugins: [pulse(TEAL, { intensity: 0.5, speed: 0.45 })],
        tag: T.clue,
      }),
    );
  }

  // --- 5b. Experience zones (invisible sensor volumes; SIC-measured anchors: path x -73..-67,
  //         stacks at z -16 / -24, booth deck x -83..-76 / z 6..12 / top 5.5) ---------------------
  items.push(zone("music-zone-walk-south", v(CX, DATUM + 1.5, -16), [6, 3, 6], { name: "Zone processional south pair", tag: T.zone }));
  items.push(zone("music-zone-walk-north", v(CX, DATUM + 1.5, -24), [6, 3, 6], { name: "Zone processional north pair", tag: T.zone }));
  items.push(zone("music-zone-booth", v(CX - 9.5, DATUM + 6.5, 9), [7, 3, 6], { name: "Zone sound booth deck", tag: T.zone }));
  // WEB↔SPATIAL threshold (D-020): the concourse floor in front of the Club door and under the
  // marquee — where a visitor stops to read what is on tonight — surfaces The Club's canonical web
  // context ("see what's on before you go in"). Browser-tuned 2026-10-15: inside the passage the
  // strip was crossed in 0.2 s on the way to the portal; the door-front strip is where people stand.
  items.push(zone("music-threshold-club", v(DOOR_X, DATUM + 1.5, 10.5), [8, 3, 7], { name: "Threshold: The Club on the web", tag: T.zone }));

  // --- 6. Portal sensors last (ids and sensor semantics unchanged from M0; the Club door is new) ----
  items.push(portal("portal-music-hub", "Portal Music District → Hub", v(CX + 9, 2, 0), [1, 3, 14], PALETTE.warmLight));
  items.push(portal("portal-music-club", "Portal Music District → The Club", v(DOOR_X, 2, 16), [5, 3, 1], TEAL));
  // Artist threshold at the END of the processional path (z -30): the walk past the speaker stacks is real,
  // and the artist spawn (-70, 1, -34) is four metres beyond the sensor, facing the stage.
  items.push(portal("portal-music-artist", "Portal Music District → Placeholder Artist", v(CX, 2, -30), [6, 3, 1], TEAL));

  const components = collect(items);

  // --- 7. Experience bindings -------------------------------------------------------------------
  const x = experienceOf("music");
  x.hide(
    "music-stack-1-band-lit",
    "music-stack-2-band-lit",
    "music-stack-3-band-lit",
    "music-stack-4-band-lit",
    "music-fin-1-blade",
    "music-fin-2-blade",
    "music-fin-3-blade",
    "music-fin-4-blade",
    "music-fin-5-blade",
    "music-stage-wash",
    "music-booth-spot",
    "music-booth-console-lit",
    "music-booth-sigil-lit",
  );
  // Soundcheck trail: each pair of stacks lights as the visitor walks past it and stays lit.
  x.zone("music-walk-south", "music-zone-walk-south", { enter: { show: ["music-stack-1-band-lit", "music-stack-2-band-lit"], hide: ["music-stack-1-band", "music-stack-2-band"] } });
  x.zone("music-walk-north", "music-zone-walk-north", { enter: { show: ["music-stack-3-band-lit", "music-stack-4-band-lit"], hide: ["music-stack-3-band", "music-stack-4-band"] } });
  // The booth controls the room: the console goes live and a spotlight lands on the stage while someone is up there.
  x.zone("music-booth", "music-zone-booth", {
    enter: { show: ["music-booth-console-lit", "music-booth-spot"] },
    exit: { hide: ["music-booth-spot"] },
  });
  // Reaching the stage: the fins light centre-out, then the wash completes the crescendo.
  x.arrival("music-stage-crescendo", PLACEHOLDER_ARTIST_ID, [
    { afterSeconds: 0.3, show: ["music-fin-3-blade"] },
    { afterSeconds: 0.7, show: ["music-fin-2-blade", "music-fin-4-blade"] },
    { afterSeconds: 1.1, show: ["music-fin-1-blade", "music-fin-5-blade"] },
    { afterSeconds: 1.6, show: ["music-stage-wash"] },
  ]);
  // Arriving at the district floor from elsewhere resets the stage to its idle state.
  x.arrival("music-floor-reset", MUSIC_DISTRICT_ID, [
    { afterSeconds: 0, hide: ["music-fin-1-blade", "music-fin-2-blade", "music-fin-3-blade", "music-fin-4-blade", "music-fin-5-blade", "music-stage-wash"] },
  ]);

  return {
    components,
    componentIds: Object.keys(components),
    experience: x.build(),
    thresholds: [{ sensorId: "music-threshold-club", destinationId: CLUB_DESTINATION_ID }],
  };
}
