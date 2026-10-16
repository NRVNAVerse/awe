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

### 2.3 Megacity city levels (audition step)

_pending_

## 3. Spatial architecture decided (reversible, product layer; D-016 boundary kept)

**Problem from the owner playtest:** spaces too small, placeholder art, awkward short-range teleports.

**Thesis:** one continuous world in global coordinates. The city ground is y = 0; the Hub floats above the city centre; districts are city cells; walking between neighbouring cells is seamless; portals are kept only where a loading boundary or meaningful travel justifies them (vertical Hub ↔ city lifts, the Club interior door, the gated 21+ compound).

1. **Far-field city layer (always present, app-rendered).** A deterministic, composer-generated city plan (roads, blocks, lots, tiered buildings, the Ring boundary, landmarks, district beacons, the Hub keel) is emitted as a content-addressed generated artifact (`/data/spatial/layers/city.<token>.json`) and rendered by the application as a few merged three.js meshes attached with the upstream pattern `space.add(object3D)` (as in `examples/zombie-survival`). Window light comes from a runtime `CanvasTexture` — **no binary art**. Reason: engine `mesh` components cannot GPU-instance (only `model`, which needs a human-reviewed asset), so a 1,000+ building city as components would be 1,000+ draw calls.
2. **Chunk proxies.** For every ungated chunk the composer derives a merged low-detail proxy from its own mesh components; the layer shows it while that chunk is not active, so districts and the Hub stay visible from everywhere (no pop-in, no empty lots). **Gated chunks are never proxied** — the 21+ compound is a neutral authored shell (gated payloads are still never fetched before the gate).
3. **Streaming grid + position-preserving handoff.** The city is a grid of 200 m cells; the first walkable region is 3 × 3 cells (600 × 600 m) enclosed by the Ring. Each walkable cell is a chunk (ground collider + building colliders + street details; districts are cells too). The application polls the visitor position and, with hysteresis, asks the existing orchestrator to stage the neighbour cell **without teleporting** (new `handoff` mode: stage → commit → retire; the visitor never moves). Gated chunks are refused by the streaming controller before any fetch. One active chunk remains the invariant.
4. **Hub ↔ city.** The Hub chunk is lifted to a measured elevation (§4). Walking off the Hub (the Drop) releases the visitor into the cell below by the same handoff; the return is a vertical **sky lift** portal (meaningful travel). The Hub's Music / Fashion gateways become lifts down to those districts.
5. **Expansion seams.** New cells = new chunks keyed in the streaming grid; the Ring has gates to future cells; the far-field already shows the whole city.

## 4. Hub elevation / orientation evaluation

_pending (measured step)_

## 5. Checkpoints

| # | Checkpoint | SHA | State |
|---|---|---|---|
| 0 | Recovery, asset + rights assessment, architecture, this record | — | in progress |

## 6. Continuation queue (ranked)

1. Hub elevation evaluation (numbers + SIC) → city composer + layer artifact + pipeline support.
2. Runtime: city layer renderer, streaming controller + orchestrator handoff, fall catcher; relocate Hub / Music / Club / Fashion / 21+ into the city plan; new cell chunks.
3. Tests, typecheck, spatial check, headless walk (cell handoffs, the Drop), browser traversal, `browser:perf` / `browser:touch`.
4. Local-only audition of real models (scratch, gitignored, never committed).
5. Tier 2: atmosphere / lighting, routes and rooftops, discovery details, transitions, mobile comfort, measured optimisation.

## 7. Exact next action

Implement step 1 of the queue.
