# NRVNAVerse M2 — Hub over Megacity — overnight campaign record

Compact, restartable record for the unattended M2 campaign on `feat/m2-megacity-foundation`.
Read this first after a compaction, model fallback or restart; then `handoffs/current/reviewer.md`
(M1 handoff, still the reviewer brief) and `docs/NRVNAVERSE_HUB_WORLD.md` (world truth incl. secrets).
Not a transcript: findings, decisions, checkpoints, queue, next action.

| Field | Value |
|---|---|
| **Campaign objective** | Turn the three small, teleport-linked M1 areas into one coherent world: a medium **floating Central Hub** over a distinctly larger, explorable **megacity**, with physical Hub→city descent, walkable streets that connect the districts, expansion seams, and measured performance — while preserving every working M1 system (stable ids, Music + The Club, Fashion, WEB↔SPATIAL windows, reactive scenes, discovery memory, mobile controls, 21+ gate) |
| **Branch** | `feat/m2-megacity-foundation` (from `ecda29f`, the M1 experience campaign close) |
| **Start SHA** | `ecda29f` · start 2026-10-15 22:40 PDT |
| **Working clone** | `D:\AWE\awe` (Node 24.19, pnpm 10.10 via Corepack; `http.sslBackend=schannel`) |
| **Session** | Claude Code, Opus 5.5, Auto; owner asleep (overnight) |
| **Boundaries** | No merge / deploy / DNS / R2 / budget changes; no change to SIC, vault originals, reference repos or collaborator assets; the 21+ gate unchanged; no event / map backend; no unlicensed (or unreviewed) binary committed — the asset contract forbids automation from attesting a review (`reviewedBy`) anyway |
| **Guidance read** | `TheCannaMan/Key@c68ca0f` (main): `OVERNIGHT_RUNS.md`, `CLAUDE_MODEL_ROUTING.md`, `AI_REPOSITORY_HANDOFF_STRATEGY.md`, `GITHUB_BILLING_AND_CI_GUARDRAILS.md`. Key has **no top-level README.md** at that SHA. Key PR #9 is unmerged and not treated as adopted guidance |

## 1. Recovery facts (VERIFIED 2026-10-15)

- Branch clean at `ecda29f`; `origin` = `NRVNAVerse/awe`.
- Machine: Windows 10, 16 GB RAM, **GTX 1050**, `C:` has only ~4 GB free → all extraction / audition scratch lives in **`D:\AWE-Scratch\m2`** (outside the repo and the vault). Blender 3.1–5.1 installed under `C:\Program Files\Blender Foundation`.
- SIC 0.4.0 at `C:\Dev\spatial-intelligence-core` (read-only use). Driven through the dependency-free stdio MCP client from the M1 campaign (`sic-batch.mjs`, copied into the session scratchpad).
- Curated vault: `D:\AWE-Vault\NRVNAVerse-Curated` — numbered category folders are **empty**; real content is `SketchFab\` (nine collections) and `3DRT-Megacity-urban-construction-kit-ver_1_7-uGH716X.zip` (2,448,684,485 bytes). The brief's "p01_stage" is actually **`tv01_stage`**; `art-gallery2` ships no top-level GLB (only `source/sott4t.glb` inside its zip).

## 2. Asset assessment

### 2.1 Rights (evidence per asset — nothing here is a legal opinion; the owner decides)

| Asset | Evidence found | Classification for this campaign |
|---|---|---|
| Nine Sketchfab collections | Each folder has a Sketchfab-generated `CC.txt`: "… by <author> is licensed under Creative Commons Attribution (CC BY 4.0)" with the model's `skfb.ly` link | **CC BY 4.0 per download notice — NOT YET CLEARED**: attribution required; the uploader's own right to license (e.g. a real building, embedded artworks/photos, TV/brand imagery) is unverified; the asset contract (§2 of the pipeline doc) needs a human review (`reviewedBy`). Treated as UNKNOWN for Git / builds / deploys |
| 3DRT Megacity kit v1.7 | ZIP contains only `3DRT-license-agreement.url` → `3drt.com/license.htm` → `store/terms-of-use-license.html`: per-purchaser, non-transferable licence; royalty-free use in commercial games / websites; **no redistribution "in any form" except a compiled application**; no purchase receipt / licence key in the vault; the `-uGH716X` filename suffix is not a 3DRT naming pattern | **UNKNOWN** (entitlement unproven; web delivery of GLBs is arguably distribution). Local isolated audition only |

### 2.2 Measurements (SIC `inspect_asset`, read-only; full table `D:\AWE-Scratch\m2\sic-out\sketchfab-table.md`)

| Asset | MB | Triangles | Draw calls | Tex GPU (est.) | Size (m) | Verdict |
|---|---|---|---|---|---|---|
| 80s_warehouse.glb | 10.8 | 74.7 k | 86 | 119 MB | 33 × 6 × 21 | **best interior candidate** (club / warehouse room); merge materials → < 20 calls; 1024² textures |
| art_gallery (1).glb | 42.6 | 284 k | 20 | 112 MB | 18 × 5.5 × 18 | gallery room candidate; decimate (284 k tris for an 18 m room) |
| art_gallery.glb | 148.7 | 284 k | 20 | 1.55 GB | same | reject (4096² textures) — use the (1) variant |
| brutalist_venue (Vilnius) | 1.2 | 18.5 k | 18 | 0 | 6.4 × 1.6 × 10.7 | a scale model, not a walkable venue — landmark-prop / inspiration only |
| concert_hall_1.glb | 57.0 | 1.08 M | **19,394** | 8 MB | 1299 × 675 × 1057 (cm export) | reject as-is (draw calls); inspiration |
| metallic_showroom (1).glb | 13.6 | 107 k | 12 | 59 MB | 2416 × 125 × 1768 (cm → ≈ 24 × 1.3 × 18 m) | Fashion showroom candidate after ×0.01 |
| tv01_stage.glb | 3.9 | 60.8 k | 25 | 3 MB | no bounds (4,993 validator warnings) | small stage prop; re-export needed |
| venue_stage_for_great_events.glb | 35.1 | 565 k | 30 | 320 MB | 74 × 10.7 × 60 | Grand-hall candidate; decimate + 1024² |
| vr_gallery_house_baked (any) | 12–77 | 26.9 k | 24 | 128 MB–1.1 GB | invalid (128 errors) | reject until repaired |

Megacity ZIP (manifest inspected before extraction): 2,637 entries, **3.13 GB uncompressed** (1.69 GB is `megacityHD.unitypackage`, skipped). Extracted to scratch: `levels/` (three prebuilt cities — big / medium / simple — as `.blend` / FBX / OBJ, 2006–2011 era, plus their textures), `objects/FBX/` (≈290 single objects: skyscrapers 43, residential 51, commercial 31, historical 29, industrial 15, highways, props), two skyboxes, licence links. City-level measurements: §2.3 (filled in by the audition step).

### 2.3 Megacity city levels and the local-only audition  [MEASURED 2026-10-15]

**Megacity "big" level** (`levels/urban-level-01-big-night`): the 2011 `.blend` opens in Blender 5.1 (`--disable-autoexec`) but its legacy Blender-Internal materials lose their textures (0 textures, 1,487 draw calls, 0.1 × scale). The OBJ + MTL export of the same level is the usable source: **1,447 objects → one GLB of 39,239 triangles, 15 materials / draw calls, 17 textures ≤ 1024² (≈ 70 MB GPU estimate), 12.7 MB**, and **4.2 MB after the repo's AWE optimiser** (dedup / prune / weld / WebP 1024). In this kit `-n.jpg` is the *night* diffuse (lit windows), not a normal map. Scale: a kit lamppost is 8.8 units and a residential block 14 units tall → **metres**; the level is a **2.0 × 2.0 km city with towers to 235 m**. No colliders exist (1,447 separate objects could become box colliders). In-world (dev audition, `?audition=city`): loads in 228 ms; reads very well from the Hub; **but its central towers rise through the Hub's airspace (to 235 m at the centre)** — the level cannot be dropped in under the Hub as-is; a kit-based city would need its own layout (the procedural plan's height envelope already keeps the Ring human-scale) or per-building placement from `objects/` (≈ 290 single buildings / props).

**Owner claim "largest textured city model can be optimized below 30 MB"**: verified — 4.2 MB optimised (geometry is light; the cost is textures).

**Sketchfab candidates in-world** (dev audition, `?audition=lineup`, optimised with the repo's optimiser, WebP ≤ 1024²; visual only, no colliders):

| Model | Optimised | In-world finding |
|---|---|---|
| 80s Warehouse | 10.8 → 4.8 MB, 74.7 k tris, 86 meshes | **strongest venue room** (club / warehouse night) — but embeds third-party artwork and a song lyric on its walls: rights review must cover embedded content, not only the CC BY model |
| Venue stage for great events | 35.1 → 16.2 MB, 565 k tris, 30 meshes | **Grand Hall** quality (seating, screen, truss); decimation needed for mobile (565 k tris) |
| Art Gallery (1) | 42.6 → 28.9 MB, 284 k tris | clean white gallery room with empty frames; heavy geometry for its size |
| Metallic Showroom (1) | 13.6 → 9.8 MB at × 0.01 | the bounds are 24 × 1.3 × 18 m — a ceiling-grid "backrooms" tile, not a showroom shell; needs axis / content inspection before any use |
| Brutalist venue (Vilnius) | 1.2 → 1.1 MB | a scale model (6 × 1.6 × 11 m) — works only as a sculpture / landmark prop |

Audition files live in `D:\AWE-Scratch\m2\audition\serve` (`optimize-report.json`, two overlays); evidence shots `D:\AWE-Scratch\m2\shots\2x-aud-*.png`. Nothing from the vault entered the repository.

## 3. Spatial architecture decided (reversible, product layer; D-016 boundary kept)

**Problem from the owner playtest:** spaces too small, placeholder art, awkward short-range teleports.

**Thesis:** one continuous world in global coordinates. The city ground is y = 0; the Hub floats above the city centre; districts are city cells; walking between neighbouring cells is seamless; portals are kept only where a loading boundary or meaningful travel justifies them (vertical Hub ↔ city lifts, the Club interior door, the gated 21+ compound).

1. **Far-field city layer (always present, app-rendered).** A deterministic, composer-generated city plan (roads, blocks, lots, tiered buildings, the Ring boundary, landmarks, district beacons, the Hub keel) is emitted as a content-addressed generated artifact (`/data/spatial/layers/city.<token>.json`) and rendered by the application as a few merged three.js meshes attached with the upstream pattern `space.add(object3D)` (as in `examples/zombie-survival`). Window light comes from a runtime `CanvasTexture` — **no binary art**. Reason: engine `mesh` components cannot GPU-instance (only `model`, which needs a human-reviewed asset), so a 1,000+ building city as components would be 1,000+ draw calls.
2. **Chunk proxies.** For every ungated chunk the composer derives a merged low-detail proxy from its own mesh components; the layer shows it while that chunk is not active, so districts and the Hub stay visible from everywhere (no pop-in, no empty lots). **Gated chunks are never proxied** — the 21+ compound is a neutral authored shell (gated payloads are still never fetched before the gate).
3. **Streaming grid + position-preserving handoff.** The city is a grid of 200 m cells; the first walkable region is 3 × 3 cells (600 × 600 m) enclosed by the Ring. Each walkable cell is a chunk (ground collider + building colliders + street details; districts are cells too). The application polls the visitor position and, with hysteresis, asks the existing orchestrator to stage the neighbour cell **without teleporting** (new `handoff` mode: stage → commit → retire; the visitor never moves). Gated chunks are refused by the streaming controller before any fetch. One active chunk remains the invariant.
4. **Hub ↔ city.** The Hub chunk is lifted to a measured elevation (§4). Walking off the Hub (the Drop) releases the visitor into the cell below by the same handoff; the return is a vertical **sky lift** portal (meaningful travel). The Hub's Music / Fashion gateways become lifts down to those districts.
5. **Expansion seams.** New cells = new chunks keyed in the streaming grid; the Ring has gates to future cells; the far-field already shows the whole city.

## 4. Hub elevation / orientation evaluation  [MEASURED 2026-10-15]

Method: one SIC scene per candidate elevation (the generated city's 1,032 building tiers within 650 m + target floors / beacons + an island keel box 116 × 12 × 96 m), `survey_visibility` (12 samples) from four Hub edge eyes and six street eyes. Scripts: `D:\AWE-Scratch\m2\elev\make2.mjs`, results `out2.json`.

| Visible fraction (%) | 80 m | 110 m | **140 m** | 180 m | 220 m |
|---|---|---|---|---|---|
| west edge → Music floor / beacon | 85 / 100 | 97 / 100 | **100 / 100** | 100 / 100 | 100 / 100 |
| east edge → Fashion floor / beacon | 89 / 100 | 97 / 100 | **99 / 100** | 100 / 100 | 100 / 100 |
| south edge (the Drop) → plaza | 40 | 43 | **41** | 41 | 50 |
| plaza / Music / Fashion spawns / north avenue → keel | 100 | 100 | **100** | 100 | 100 |
| mid-block street SE / NW → keel | 0 / 0 | 0 / 0 | **8 / 0** | 32 / 0 | 66 / 0 |

Decision: **140 m**. Districts fully readable from the gateway edges; the keel is a landmark from every plaza and avenue; mid-block streets keep the sky open but enclosed (the Hub appears as you reach an avenue — a reveal, not wallpaper); the downtown skyline (to 204 m) still rises behind the spire, so the Hub sits *inside* the city rather than above a map. Lower elevations lose district floors behind buildings; higher ones make the descent long and the street detail illegible from the deck. Orientation kept from M1 (spawn faces −Z: the Core house and spire with downtown behind; Music west, Fashion east; the Drop behind the arrival, over the plaza).

The Drop's physics (measured in the browser): the official Mover integrates `velocity.y` as a per-step displacement (effective gravity ≈ 108 m/s²; `maxFallSpeed` 20 per step is not a practical cap) — a 128 m fall took ≈1.5 s. A runtime descent cap (official `Mover.setVelocity`) holds 22 m/s from 10 m above the release height until the visitor is grounded: **≈ 6 s from the Hub to the plaza**, steerable, landing on the plaza (or a rooftop in the cell, which has colliders).

## 5. Checkpoints

| # | Checkpoint | SHA | State |
|---|---|---|---|
| 0 | Recovery, asset + rights assessment, architecture, this record | `98d74d0` | pushed |
| 1 | **Hub over megacity**: city plan + composer, chunk origins (Hub y 140; Music / Fashion as city cells; Club on the Music cell; 21+ compound outside the Ring), 7 city-cell chunks + city kit on district cells, pipeline `layers` / `streaming` (gated chunks refused), far-field `CityLayer`, orchestrator handoff (`spawn: null`), `StreamingController`, descent cap, The City destination (`dst_8w1j39h5e0ezrsjh`), sky-lift pads | `84d5472` | pushed · tests 484 · manifests 61 · strict typecheck · spatial check · browser (dev, real input): the Drop end to end, west walk plaza → Music cell |
| 1b | M2 tests: streaming controller (12), handoff / walked-into / streaming validation (9), world invariants (10) | `f788bde` | pushed · app tests **515** |
| 1c | Production verification: `browser:perf` **PASSED** (desktop 108 draw calls / 85 k tris / 56 fps vsync-capped / JS heap 22 MB; mobile-emulated 100 / 83 k / 46 MB; Hub → Music → Hub by directory arrives; warm reload 0 wire bytes), `browser:touch` **PASSED** (Hub → 21+ `gateRequired`, **zero** cannabis requests), SIC composition pass (§6.1) | — | evidence in `D:\AWE-Scratch\m2\perf`, `\touch`, `\sic` |
| 2 | **Local-only audition**: dev route over `NRVNA_AUDITION_DIR` (404 in production; tested), overlay loader, city-building toggle; Megacity level converted + measured + optimised (4.2 MB); five Sketchfab rooms in-world (§2.3) | `259468b` `619c8df` | pushed · nothing from the vault in Git |
| 3 | **Tier 2 visual / experience**: facade styles, storefront bays, street trees, zebra crossings, rooftop plant, aviation lights (`a8cb974`); sky-lift veil + lift posts on the diagonals (`f7064b6`); North Row roof garden + fourth sigil + Drop lintel memory (`166785b`); Hub edge signs + Drop return glow (`11bd0ee`); downtown behind the spire (`777fd5b`); traffic (`68c8eb7`); keel (`add4f15`); plaza dressing (`440484e`); docs world §17 / runtime §20 / pipeline §19 (`21c5595`) | see column | pushed · tests **520** · strict typecheck · spatial / compose check |
| 4 | **Convergence** (2026-10-16 ≈ 00:20): production build; `browser:perf` **PASSED** — desktop **112 draw calls / 175 k frame triangles / 56.4 fps (vsync-capped) / p95 18.1 ms / JS heap 43 MB**; mobile-emulated **104 / 173 k / 56.1 fps / 78 MB**; Hub → Music → Hub arrives; warm reload 0 wire bytes. `browser:touch`: first run **FAILED 1 check** (A, cycle 5: avatar moved 0.41 m < 0.5 m while pressed against the Core house ahead of the spawn), immediate rerun **PASSED** (0.91 m; cycles show the avatar sliding along that wall — a marginal probe threshold, M1 recorded 1.3 m there); Hub → 21+ `gateRequired`, **zero** cannabis requests in both runs | this commit | evidence `D:AWE-Scratchm2perf-final`, `touch-final`, `touch-final2` |

## 6. Findings worth keeping

1. **SIC composition pass** (`static-scene.json`, 737 entities: 541 exact, 156 approximate, 30 markers, 0 unsupported): lift pads separated from the runway ramp (2.3 m), pylons (8.5 m), booth ramp (11.8 m), processional path (3.5 m); the Music lift sensor rests 5.5 mm into a collider-less floor ring (benign, M1 portals do the same); lift rings 81 % visible from the district spawns; from the plaza spawn the Hub deck, the Drop tongue, the lift label and both district signs are 100 % visible; the Drop frame 100 % from the Hub spawn. SIC still models hidden state-B geometry as present (M1 finding) — the plaza's landing-ring visibility is masked by its own lit state.
2. **Ground overlap must exceed margin + staging walk.** First browser run: the cell ground overlapped 2 m, the handoff fires 4 m into the next cell and staging takes a few hundred ms, so a walker fell through to the safety terrain (y −3). Fixed with a 20 m overlap (`GROUND_OVERLAP`), pinned by a world-invariant test (≥ 16 m).
3. **Draw calls went DOWN** versus M1 (163 → 108 desktop) while triangles went up (24 k → 85 k): the whole far field is ~20 merged draw calls; shadows are off on the layer.
4. Engine `mesh` cannot GPU-instance; `batch` of meshes duplicates components. A city as components would be 1,000+ draw calls — the layer approach is the measured reason.
5. Headless CDP gets no pointer lock (console `WrongDocumentError`, harmless); the probes rotate the camera through the dev handle.

## 7. Continuation queue (ranked)

Done: elevation evaluation; composer / layer / pipeline; runtime (layer, streaming, handoff, descent, sky lifts); tests; production probes; local audition; Tier 2 visual pass, roof garden route, plaza dressing, traffic; docs.

Browser evidence (dev server, real key input, `D:AWE-Scratchm2rowserm2-probe.mjs`):

- **The Drop**: walk off the tongue → release at y ≈ 126 → `city-plaza` handoff (no teleport) → 22 m/s glide → landing at (0, 0.1, 28) in ≈ 6 s; location *The City*, URL replaced.
- **Seams**: all nine crossings of the 3 × 3 region (incl. the Fashion side and a corner) hand off with the visitor never below street level (min y 0); `D:AWE-Scratchm2shotsseams.json`.
- **Preserved M1 flows**: Hub gateway lift → Music; concourse door → The Club; Club → Music; Music sky lift → Hub; Hub gateway lift → Fashion; runway → Placeholder Brand — **6 / 6 OK**.
- **Plaza sky lift**: walk-in from the spawn reaches the Hub (after moving a post that blocked it); veil shown.
- **Roof garden**: both flights climbed, the sigil found by walking onto the roof from a cleared memory.
- **Mobile-emulated** (390 × 844, touch): Hub arrival shows downtown behind the spire; the fall framed between the joystick and Jump.

Remaining queue (all optional, owner / reviewer may re-rank):

1. District identity in the far field (teal / rose storefront and sign tints around the Music / Fashion plots).
2. Make the touch probe robust to geometry ahead of the spawn (start scenario A on open ground) — probe-only change, deliberately not made unreviewed.
3. Rights review for the Sketchfab candidates (owner) → if cleared, register through the asset contract (human `reviewedBy`) and replace district shells by id; the 80s Warehouse is the strongest Club skin, the venue stage the strongest Grand Hall.
4. A kit-based city needs its own layout (the 3DRT level’s towers pierce the Hub airspace) or per-object placement from `objects/` once entitlement is proven.
5. Real-device mobile pass (thermal, GPU memory for the layer textures); adaptive quality only if measured (D-009).
6. Audio ambience (city hum on the plaza, wind during the Drop) — needs cleared audio or WebAudio synthesis.

## 8. Exact next action

Converged and handed to ChatGPT for review (`handoffs/current/reviewer.md`, `handoffs/STATUS.md`). If resumed by an implementer before review: queue item 1, then re-run `browser:perf` / `browser:touch`; do not merge or deploy.
