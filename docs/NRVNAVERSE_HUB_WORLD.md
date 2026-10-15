# THE NRVNAVerse Central Hub — World Composition (M1 creative build)

| Field | Value |
|---|---|
| **Status** | **VERIFIED in `feat/m1-spatial-creative-overnight`** (2026-10-13/14): composed, generated, headless-walked; browser evidence in the overnight progress record. Not yet integrated into `nrvna/integration`; not production art |
| **Destination** | THE NRVNAVerse Hub — `dst_7g19n1vm9ackw8a0` (ungated), chunk `hub` |
| **Source of truth** | `apps/the-nrvnaverse/spatial/authoring/hub.mjs` (composer) → `spatial/source/scene.m0.json` + `spatial-config.m0.json` (committed output) → generated runtime artifacts |
| **Art status** | Every object is replaceable primitive geometry (box / cylinder / sphere / text / reflector). No vault asset, no `assetRef`, no binary. Real art replaces objects **by id** (§6) |
| **Contains spoilers** | Yes — this is the complete developer truth, including the hidden places. Visitor-facing copy stays spoiler-light |

---

## 1. Thesis

The Hub is **a sunken stone basin under a dusk sky with a lantern spire at its focal point**. The arrival statement is architectural, not a label on a box: straight ahead of the spawn a slender 31 m spire rises out of a square, open-roofed pavilion (the **Core house**) whose south face carries the inscription *THE NRVNAVerse / CENTRAL HUB*. The basin is ringed on the north by a raised **rim terrace** reached by two gentle ramps; an **overlook deck** climbs one more level above the terrace's west end and shelters a quiet lounge beneath it. The Music and Fashion / Culture gateways frame the west and east exits at ground level, each with its name over the lintel. The gated 21+ gate stands off-axis in the north-east corner between two dark posts.

Design laws applied (Glasshollow lessons, see §8): obvious route + secondary route + hidden route; something above and something inside; the best thing is not visible from the door; light as orientation; benches where the view is; nothing punitive; no quest text.

## 2. Plan (metres, +Y up, forward is −Z; spawn (0, 1, 6) faces −Z)

```
                 z = -39   dormant frames (on the overlook deck's north edge)
   overlook deck  x -20..-6, z -39..-28, top 8.5      overlook ramp  z -39..-36, x 18 → -6, 4.5 → 8.5
   rim terrace    x -20..20, z -36..-28, top 4.5      (solid block; benches at x ±4, z -29.5)
   west ramp  x -17..-12 ──────── forecourt x -12..12, z -28..-12 ──────── east ramp  x 12..17
   z -10 → -28, 0.5 → 4.5        Core house centre (0, -19), walls 10×9, 5 m high,       z -10 → -28
                                  entrance gap 3.5 m wide on the NORTH side
                                  spire at (0, -19): fins to y 31, cap at y 31.9
   ───────────────────────────── basin  x -12..12, z -12..12, top 0.5 ─────────────────────────────
   Music gateway x = -9 (posts z ±7.9, lintel y 5–5.7)        Fashion gateway x = +9
   21+ gate: slab centre (8.5, 2, -9.5), yaw 45°, posts (10.62, -11.62) and (6.38, -7.38)
   spawn (0, 1, 6)
   path-west x -58..-12, z -2..2, top 0.5                      path-east x 12..58
```

Datums: basin / forecourt / paths top **0.5**; terrace top **4.5**; overlook deck top **8.5**; Core house wall top 5.5, beam ring top 6.5; spire cap centre 31.9.

## 3. Components by role (ids are stable; `script.tag` groups them)

| Group (`script.tag`) | Ids | Role |
|---|---|---|
| `m1-hub-structure` | `platform-hub`, `hub-basin-inlay`, `hub-forecourt`, `hub-gate-{music,fashion}-{post-n,post-s,lintel,label}`, `hub-gate-cannabis-{post-a,post-b,label}`, `hub-dormant-{1,2}-{post-w,post-e,inset}` | floors, gateway frames, the two dormant frames |
| `m1-hub-landmark` | `hub-core-wall-{s,w,e}`, `hub-core-beam-{s,n,w,e}`, `hub-core-pillar-{sw,se,nw,ne}`, `hub-spire-plinth`, `hub-spire-fin-{w,e,n,s}`, `hub-spire-core`, `hub-spire-ring-{1,2,3}`, `hub-spire-cap` | the Core house and the spire |
| `m1-hub-route` | `path-west`, `path-east`, `hub-terrace`, `hub-landing-{w,e}`, `hub-ramp-{w,e}`, `hub-bench-rim-{w,e}`, `hub-overlook-ramp`, `hub-overlook-ramp-foot`, `hub-overlook-ramp-post`, `hub-overlook-deck`, `hub-overlook-post-{s,n}`, `hub-bench-lounge`, `hub-overlook-lamp-post`, `hub-overlook-lamp` | walkable routes and pause spots |
| `m1-hub-clue` | `hub-stud-1` … `hub-stud-7` | the stud trail (§5) |
| `m1-hub-secret` | `hub-core-wall-{nw,ne}`, `hub-core-seat`, `hub-core-mirror`, `hub-core-line` | the hidden interior (§5) |
| `m1-hub-copy` / text | `label-hub` ("THE NRVNAVerse"), `hub-label-sub` ("CENTRAL HUB") | identity inscription on the Core house's south face |
| `m0-portal` | `portal-hub-music`, `portal-hub-fashion`, `portal-hub-cannabis` | the three M0 sensor portals: **ids, sensor colliders and index bindings unchanged**; only position / tint changed. They are the last three ids of the `hub` chunk (`asset:place` appends after `portal-hub-cannabis`) |

Totals: 77 components, ≈95 KiB LF (budget 128 KiB / 96 components, §16 of the pipeline doc).

Materials: engine `mesh` (Lambert, flat colour). Palette in `hub.mjs` (`PALETTE`): basin `#2b2e35`, stone `#a79d8a` / light `#c9bfae` / dark `#6b6559`, charcoal `#1c1f26`, spire bone `#e9e3d6`, ember `#f5b24a`, warm light `#ffd98a`, Music teal `#2fb8a6`, Fashion rose `#d98c7a`, gated amber `#8a6a2a`. Glow is the engine's `FresnelGlowPlugin` (spire core, cap, overlook lamp) and `PulsePlugin` (rings, studs, dormant insets).

Global atmosphere (hand-authored global components, not the composer): `background` is a **sky** (turbidity 6, rayleigh 1.2, sun azimuth 205°, elevation 1.5°), `fog` `#1a1826` 160–760 m, `lighting` direction (0.35, −0.55, 0.75) from the south-west, intensity 1.15.

## 4. Routes

| Route | Kind | Proof |
|---|---|---|
| Spawn → west or east ramp landing → ramp (12.5°) → rim terrace → benches | obvious | headless Mover walk, reached |
| Terrace east end → overlook ramp (outboard, 9.3°) → overlook deck → lamp, dormant frames; lounge bench beneath the deck | obvious once on the terrace | headless, reached |
| Spawn → Music / Fashion gateway (sensor → `travelToDestination`) | primary navigation | unchanged M0 contract; walked through headless |
| Spawn → 21+ gate (north-east corner) | gated | refused at the manifest gate before fetch, as in M0; sensor id unchanged |
| Terrace south edge → **jump** 2 m up / 2.5 m across onto the Core house beam ring (2 m wide) → walk the ring → drop into the light well | secondary | headless, reached (double jump available; falling in is safe) |
| Stud trail (§5) → north entrance → Core house interior | hidden | headless, reached |

Known: a visitor who walks off the basin onto the bare ground (0.5 m drop) must **jump** back (the character controller cannot step 0.3 m or more; ramps only). Harmless; documented, not fixed.

## 5. Optional discovery — the Core house interior  [technical truth; keep out of visitor copy]

| Item | Value |
|---|---|
| Identifier | `hub-secret-core` (components tagged `m1-hub-secret` + `m1-hub-clue`) |
| Location | inside the Core house, (0, 0.5, −19), interior 8 × 9 m, open to the sky through the beam ring |
| Entrance | the only gap is on the **north** side (z −24.5, x −1.75..1.75, 3.5 m wide), i.e. facing away from the arrival; from the spawn eye the north wall, the interior and the studs are 0 % visible (SIC `visible_from`, exact, conclusive) |
| Clues | (1) seven pulsing floor studs (`hub-stud-1..7`) lead from the east ramp landing (8.5, −13.5) round the east side of the pavilion to the gap; (2) from the rim terrace the open roof shows the mirror floor and the lit core from above before the route is obvious; (3) the beam-ring jump drops into it |
| Inside | `hub-core-mirror` (reflector floor 8 × 9), `hub-core-seat` (ring bench r 2 around the spire plinth), the spire's ember core overhead, and one line in Playfair italic on the inner south wall: *you are at the centre* |
| State / interaction | none; purely spatial. No HUD, no counter, no quest |
| Optional | yes; blocks nothing; no gate involved; nothing links to the 21+ district |
| Mobile | 3.5 m gap and 8 m interior; the third-person rig (5 m) will pull in against the walls but the open roof keeps the view; no pixel-precision needed |
| Regression | `test/spatial-pipeline` keeps `label-hub` as its non-sensor example; the headless walk program (`scratch`, see progress record) checks `studRoute` and `insideCore`; SIC `visible_from` from (0, 2.4, 6) must stay 0 for `hub-core-wall-nw`, `hub-core-mirror`, `hub-stud-7` |

A second, lighter discovery: the **beam-ring walk** (§4) and the **overlook lamp** are not announced anywhere.

## 6. Real-art replacement points

| Slot | Replace by id | Footprint / notes |
|---|---|---|
| Spire | `hub-spire-fin-*`, `hub-spire-core`, `hub-spire-ring-*`, `hub-spire-cap`, `hub-spire-plinth` | ≤ 3 m footprint at (0, 1.1, −19), 30 m tall; keep the light well (6 × 7 m opening) clear |
| Core house shell | `hub-core-wall-*`, `hub-core-beam-*`, `hub-core-pillar-*` | 10 × 10 m, 5–6.5 m high, north gap ≥ 3 m, open roof |
| Gateways | `hub-gate-music-*`, `hub-gate-fashion-*` | sensor slabs stay as they are; frames are 17 m long, 5.7 m high |
| 21+ gate | `hub-gate-cannabis-*` | dark, closed, off-axis; never a welcoming frame |
| Dormant frames | `hub-dormant-*` | future district thresholds; no names |
| Benches / lamp | `hub-bench-*`, `hub-overlook-lamp*` | props |

The vault candidates inspected for these slots (none placed: rights unknown or too heavy) are listed in the overnight progress record.

## 7. Verification performed

- `spatial:validate` / `generate` / `check` (within budget), `compose --check`, 424 app tests.
- SIC (`adapt_awe_scene`, 108 entities, 71 exact physical shapes): arrival visibility survey from (0, 2.4, 6); ramp / terrace contact and resting checks; the terrain is **unsupported by SIC's AWE adapter v0.5.0** so "no surface below" for ground-level blocks is an adapter limitation (SIC consumer finding), not a floating object.
- Headless Mover route proof (above). The engine applies mesh `rotation` as **radians** although its data docs say degrees — the composer emits radians.
- Browser: `pnpm --filter the-nrvnaverse browser:perf` (production build, headless Chrome, desktop + phone emulation): see the progress record for the numbers and screenshots.

## 8. Lessons carried in (reference repos, read-only)

Glasshollow: hub + optional wings, vertical volume over footprint, hidden eyrie not visible from the door, benches/perches where the view is, lighting as orientation, no punitive discovery. Lantern Rock: ramps not stairs (the controller cannot climb even 10–30 cm), rooms ≥ 8 m for a 5 m camera rig, water breaks under fog (avoided), bloom blooms white UI (avoided), generated rather than sourced audio (not yet used here).

---

## 9. Music District — "the Soundstage"  [VERIFIED headless, same branch]

Composer `spatial/authoring/music.mjs`; chunk `music`; destinations Music District `dst_gm3xs4a3tws7bgh3` (spawn (−70, 1, 6) facing −Z) and Placeholder Artist `dst_1qtfn9qjg9kf6jyd` (spawn (−70, 1, −34)).

| Element | Ids | Notes |
|---|---|---|
| Floor of three lit rings | `platform-music`, `music-ring-1..3` | dark floor, concentric teal rings 10 / 7 / 4 m |
| Processional path + speaker stacks | `path-music-north`, `music-stack-1..4` (+ `-band`) | 6 m wide, 16 m long; stacks at z −16 / −24 with pulsing teal bands |
| Artist threshold | `portal-music-artist` (sensor, **moved to z −30**, end of the path), `music-gate-artist-post-{w,e}` | same-chunk teleport to the artist spawn 4 m beyond |
| Stage | `platform-music-artist`, `music-stage-riser` (20 × 6, top 1.5), `music-stage-ramp-{w,e}` (9.5°), `music-fin-1..5` (+ `-ribbon`) | five charcoal fins on an 8.5 m arc, heights 8 / 11 / 13 / 11 / 8, teal glow ribbons |
| Audience | `music-bench-{w,e}` | |
| Hub gateway (east edge) | `music-gate-hub-*`, `portal-music-hub` | framed, labelled HUB |
| Copy | `label-music` ("MUSIC DISTRICT" over the path mouth), `label-music-artist` ("Placeholder Artist" on the centre fin) | provisional names unchanged |
| **Sound booth (optional overlook)** | `music-booth-ramp` (16.4°, west edge z −11 → 6), `music-booth-ramp-foot`, `music-booth-deck` (top 5.5), `music-booth-post`, `music-booth-desk`, `music-booth-console` (hologram), `music-booth-rail`; clue `music-stud-1..4` | behind-left of the arrival (the spawn faces north); the studs run beside the ramp to its north foot, never under it |

Routes proven headless: processional walk; stage via the east ramp, down the west ramp; studs → booth ramp → deck; Hub gateway.

## 10. Fashion / Culture District — "the Runway and the Loggia"  [VERIFIED headless, same branch]

Composer `spatial/authoring/fashion.mjs`; chunk `fashion-culture`; destinations Fashion / Culture District `dst_9c4wxtpec8awsx1q` (spawn (70, 1, 6)) and Placeholder Brand `dst_tgfh5h5jvm3wj0w7` (spawn **moved to (70, 2, −36)**, the runway's north end).

| Element | Ids | Notes |
|---|---|---|
| Court | `platform-fashion-culture`, `path-fashion-north` (apron), `platform-fashion-culture-brand` | travertine |
| Runway | `fashion-runway` (4 × 20, top 1.5), `fashion-runway-ramp-{s,n}` (9.5°), `fashion-pylon-1..6` (+ `-band`), `fashion-bench-{w,e}` | rose bands pulse |
| Brand threshold | `portal-fashion-brand` (sensor, **at z −33 on the runway**), `fashion-gate-brand-post-{w,e}` | seamless step into the loggia |
| Loggia | `fashion-col-{w,e}1..4`, `fashion-roof` (24 × 13, top 7.1), `fashion-north-wall` (20 wide), `fashion-plinth-1..3` (empty), `fashion-frame-1..3` (empty) | future brand slots; nothing invented |
| Roof terrace | `fashion-roof-ramp-foot`, `fashion-roof-ramp` (outboard, x 82.5..85.5, 15.4°), `fashion-roof-landing` (north-east corner), `fashion-roof-ramp-post`, `fashion-roof-bench`, `fashion-roof-lamp(-post)` | from the roof's north edge you look down into the atelier |
| **Atelier (optional discovery)** | `fashion-atelier-floor` (24 × 12, z −64..−52), `fashion-atelier-wall-{n,e,w}` (west wall covers only the north half: the gap z −58.75..−54 is the entrance), `fashion-mannequin-1..5` (+ `-holo`), `fashion-atelier-line`; clue `fashion-stud-1..4` | reached round the north wall's west end (2 m passage at x 58..60); hidden from the arrival by the loggia and its wall |
| Hub gateway (west edge) | `fashion-gate-hub-*`, `portal-fashion-hub` | |
| Copy | `label-fashion-culture`, `label-fashion-culture-brand` (on the roof fascia) | provisional |

Routes proven headless: runway up / down; loggia; roof ramp → landing → terrace; studs → atelier → between the pedestals; Hub gateway.

## 11. Spoiler-light hints for a playtest (what to tell a visitor)

- "Walk around the back of the thing with your name on it."
- "There is a way up on both sides. Go up."
- "In the Music District, turn around after you arrive."
- "In the Fashion District, the gallery has a roof."

---

## 12. The world reacts — experience layer  [VERIFIED headless + SIC, `feat/m1-spatial-experience-overnight`]

Every reaction is authored geometry in two states (state A idle, state B lit, both in the chunk; state B hidden on staging) plus an invisible sensor **zone** or an **arrival** rule (pipeline doc §17, runtime doc §17). Nothing here is a HUD, a counter or a quest; a chunk retire resets everything.

| Place | Trigger | What happens | Ids (zone · state B) |
|---|---|---|---|
| Hub arrival | arrival at the Hub (initial or return) | the spire wakes from the bottom ring up at 0.6 / 1.1 / 1.6 s | `hub-wake` · `hub-spire-ring-{1,2,3}-lit` |
| Hub return | arrival at the Hub from the `music` / `fashion-culture` chunk | the gateway you came back through glows for 6 s | `hub-return-music`, `hub-return-fashion` · `hub-return-{music,fashion}-glow` |
| Overlook deck | zone `hub-zone-overlook` (deck top, x −20..−6, z −39..−28) | the lamp lights and throws a pool on the deck; dims again when you leave | `hub-overlook` · `hub-overlook-lamp-lit`, `hub-overlook-lamp-pool` (dim: `hub-overlook-lamp`) |
| Core house interior | zone `hub-zone-core` (x −4..4, z −23.5..−14.5) | a halo appears round the seat and the ember well brightens while you are inside | `hub-core` · `hub-core-halo`, `hub-core-well` |
| Processional path | zones `music-zone-walk-south` / `-north` (z −19..−13 / −27..−21) | each pair of speaker stacks lights as you pass and stays lit — a soundcheck trail | `music-walk-south`, `music-walk-north` · `music-stack-{1..4}-band-lit` |
| The stage | arrival at Placeholder Artist | the fin blades light centre-out at 0.3 / 0.7 / 1.1 s, the stage wash at 1.6 s; arriving at the district floor resets it | `music-stage-crescendo`, `music-floor-reset` · `music-fin-{1..5}-blade`, `music-stage-wash` |
| Sound booth | zone `music-zone-booth` (deck top) | the console goes live and a spotlight lands on the stage; the spot lifts when you leave (the booth controls the room) | `music-booth` · `music-booth-console-lit`, `music-booth-spot` |
| Runway | zones `fashion-zone-walk-{1,2,3}` (on the runway, z −17..−11 / −25..−19 / −32.5..−27.5) | pylon pairs light as you walk and stay lit | `fashion-walk-{1,2,3}` · `fashion-pylon-{1..6}-band-lit` |
| Loggia | zone `fashion-zone-loggia` (between the columns) + arrival at the Brand threshold | the frame rims light while the gallery is occupied; on arrival at the threshold they light one after another (0.3 / 0.6 / 0.9 s) | `fashion-loggia`, `fashion-brand-welcome` · `fashion-frame-{1,2,3}-lit` |
| Roof terrace | zone `fashion-zone-roof` (roof + landing) | the roof lamp lights with a pool; dims when you leave | `fashion-roof` · `fashion-roof-lamp-lit`, `fashion-roof-lamp-pool` |
| Atelier | zone `fashion-zone-atelier` (interior) | a rose ring wakes under the pedestals while you are inside | `fashion-atelier` · `fashion-atelier-ring` |

Zone sensors are `zone()` meshes (`display: false`, enabled sensor collider) tagged `m1-<area>-zone`; state-B geometry is tagged `m1-<area>-reactive`. Zone volumes were sized from SIC `bounds` of their anchors and checked with `in_region` / `intersects` (anchors fully inside, no penetration of portals, ramps or the beam ring); the real engine fires enter and exit for the avatar in every zone (headless Mover proof). Component counts after the layer: hub 87, music 65, fashion-culture 90 (budget 96 / 128 KiB, warning-only; fashion-culture ≈ 119 KiB — raise the budget before adding more there). Visitor copy stays spoiler-light: "the Hub remembers where you came back from", "walk the path and listen", "the booth runs the room".

---

## 13. Music as a venue complex — the concourse and The Club  [VERIFIED headless + SIC, `feat/m1-spatial-experience-overnight`; D-017 / D-018 proof]

The Music District floor (the arrival, three lit rings) is now the **concourse**; each venue room is a door off it. Two rooms exist: **the Soundstage** (the processional path and the fin stage — this chunk, Placeholder Artist) and **The Club** — the first independently loadable venue room: its own chunk `music-club`, its own stable destination (`The Club`, `dst_gqq90k2404cy9nf0`, kind `venue`, primary district Music, slug `music-club`), entered through a door on the concourse and left through the same door. Nothing was invented about an artist, event or brand: the room is a template.

| Element | Ids | Notes |
|---|---|---|
| Club door (concourse, south-east, behind the arrival) | `music-club-passage`, `music-club-passage-wall-{w,e}`, `music-club-passage-end`, `music-club-lintel`, `music-club-label` ("THE CLUB"), `music-club-door-glow`, sensor `portal-music-club` | a short dark passage off the floor's south edge at x −65 (clear of the booth ramp foot and the spawn); the sensor at z 16 routes to The Club's stable id (cross-chunk travel); the glow marks tonight's room |
| Tonight's marquee | `music-marquee-board`, `music-marquee-title` ("TONIGHT"), `music-marquee-room` | over the Club door, facing the arrival — you find it by turning round, like the booth. Text and the lit door come from `TONIGHT` / `VENUE_ROOMS` in `music.mjs` (config-driven "select your stage" scaffolding: change one value, recompose; no backend, no manifest change) |
| The Club — room | `platform-music-club` (22 × 20, x −81..−59, z 60..80), `club-wall-{n,w,e,sw,se}` (5.5 m), `club-door-lintel`, `label-music-club` (north wall, above the stage) | walled on three sides, open to the sky; the only opening is the south door (4 m, off-centre at x −68..−64 so the third-person camera behind the spawn rests against solid wall inside the room — browser-tuned) |
| Light rings | `club-ring-{1,2,3}` (dormant) / `-lit` / `-drop` / `-pool` | hanging at 6.3 m over the floor; dormant until the room wakes; each lit ring throws a translucent pool on the floor (upstream AWE has no point lights, so light is authored geometry) |
| Stage (north end) | `club-stage` (10 × 4 × 0.6), `club-stage-ramp` (16.7°, west end), `club-console`, `club-console-top`, `club-console-live`, `club-stage-spot`, `club-stage-back` | low riser, one console (the first media slot), spot cone; the ramp is the clean route up (headless: the controller also shoulders straight up the 0.6 m face, but jams when sliding along it diagonally) |
| Dance floor | `club-tile-{1..9}` (dark) / `-lit` | nine 1.9 m tiles, 6 × 6 m, alternating teal / ember when lit |
| Bar (east) · booths (west) | `club-bar`, `club-bar-top`, `club-bar-shelf`, `club-bar-light`; `club-booth-{1,2,3}`, `-back`, `-table` | the bar back-light is the first thing to wake |
| Door back | sensor `portal-club-music` (x −64, z 80.9) → Music District spawn | |
| Spawn | (−70, 1, 75.5) facing north (`spatial-config` placement) | the stage is visible from the spawn (SIC 93 %) and from the camera's resting point behind it (93 %) |

Experience (same system, reused unchanged — world doc §12): arrival `club-wake` (bar light 0.3 s, rings from the door inward 0.8 / 1.2 / 1.6 s); zone `club-floor` (dance floor lit while occupied); zone `club-stage` (console live + spot while someone is on the riser; the spot lifts when they step off).

Template metadata (documentation-level scaffolding for a future curated stage library, D-018): `CLUB_TEMPLATE` in `club.mjs` and `VENUE_ROOMS` in `music.mjs` record room size, stage, audience layout, sightlines, media slots and mobile notes. Keep `venue template` (reusable design) ≠ `venue / room` (stable destination) ≠ `event` ≠ `assignment` (`TONIGHT`) distinct — none of this is a manifest contract.

Proofs: manifests 61 tests (eight destinations), app 466 tests (five chunks, nine portals, 13 zones, 7 arrival rules), typecheck, `spatial:check` (music 98 KiB / 90 components — at the component budget; music-club 75 KiB / 61), SIC (`in_region`: tiles and console fully inside their zones; `intersects`: stage zone vs floor zone, portal vs floor zone, bar vs tile, booth table vs tile, ring vs wall, passage vs booth deck, marquee vs booth deck / rail — all separated; `survey_visibility` from the Club door: stage 93 %, rings 83–100 %, bar light 100 %; from the Music spawn (turning round): marquee 88 %, door glow 97 %, label 100 %), headless Mover proof (both Club zones fire enter and exit; 13 zones, 32 events, 0 stray). Booth sightline finding (pre-existing composition): the centre fin is self-occluded by fin 2 from the booth; the booth sees fins 1–2, the stacks and the spotlight cone.

Vault venue audition (SIC `inspect_asset`, read-only; rights per the Vault Organizer and file provenance — nothing placed, nothing copied into the repository):

| Candidate | Facts (measured) | Rights | Verdict for the venue library |
|---|---|---|---|
| `backup glb/Nightclub1 v1.1.glb` | 22 × 14 × 42 m shell, 2.5 k tris, 2 meshes, 4 draw calls, 6.6 MB, 11 textures (2048², ≈187 MB GPU estimate), valid (4 warnings) | UNKNOWN (Sketchfab origin) | **optimize / derive** — the cheapest intimate-room shell in the vault; a Club template skin candidate once rights are cleared |
| `backup glb/80s-warehouse v1.0.glb` | 33 × 6 × 21 m, 75 k tris, 85 meshes, 86 draw calls, 4.3 MB, 7 textures (≈67 MB GPU), valid | UNKNOWN (Sketchfab origin) | **optimize / derive** — a warehouse / electronic-room template; low ceiling (5.7 m) needs the camera rig check |
| `Blender/Airplane Hanger 1.3.glb` | 60 × 19 × 100 m with `concert-stage.main.final` nodes, 454 k tris, 363 meshes, 434 draw calls, 33 MB, 2 textures at 4096² (≈171 MB GPU), valid | UNKNOWN / LIKELY NEEDS REVIEW (Sketchfab stage inside an owner scene) | **inspiration + partial derive** — the concert stage sub-tree is the Grand Hall / festival candidate; too heavy whole |
| `cinema … interior.glb` | 5.7 × 5 × 11 m, 392 k tris, 510 meshes, 17 MB | UNKNOWN (Sketchfab) | **reject** for venues (small, very dense) |
| `backup glb/Elysium v1.20.glb` | 120 × 40 × 169 m, 1.04 M tris, 1 729 meshes, 1 756 draw calls, 63 MB, 70 textures (≈362 MB GPU), 29 animations, 27 warnings | owner's own build (contains dance platforms) | **inspiration only** — far beyond budget as one asset; its dance-platform ring informs the Club floor |
| `backup glb/Scifi Hall 1.0.glb` | 16 × 9 × 68 m, 292 k tris, 1 394 meshes, 63 MB, 1 015 validator warnings | UNKNOWN | **reject** (validator noise, corridor not room) |
| `backup glb/Warehouse FBX Model Free v1.3.glb` | 456 k tris, 58 meshes, 93 draw calls, 61 MB, 41 textures (≈411 MB GPU), 15 warnings, no bounds (unsupported accessor bounds) | UNKNOWN ("Free" FBX import) | **reject** until re-exported with bounds; heavy |
| `Blend Files/megacity night lounge v1.1.glb` | 29 × 56 × 52 m, 140 tris, 7 KB | owner's own | **reject** (a blocking shell, no detail) |

Rights labels follow the brief (CLEARED / LIKELY NEEDS REVIEW / UNKNOWN / RESTRICTED); nothing here is cleared for production, so every verdict is a library candidate, not a placement.
