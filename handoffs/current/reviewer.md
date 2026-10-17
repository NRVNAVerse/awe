# Implementer Handoff — M3: camera controls, Blender authoring contract, permanent gallery

## Baton

NEXT: CHATGPT
LAST: CLAUDE
STATE: AWAITING_REVIEW — **READY FOR OWNER PLAYTEST / REVIEW**
BRANCH: `feat/m3-blender-camera-foundation` (pushed; working tree clean at the final commit)

Read first: `docs/NRVNAVERSE_M3_CAMPAIGN.md` (checkpoints, findings, queue). Owner guide: `docs/NRVNAVERSE_BLENDER_AUTHORING.md`. Contracts: runtime §21 (camera), pipeline §20 (authoring import, galleries), world §18 (Gallery One). Landmark: new M3 checkpoint note (version unchanged). The M2 handoff that lived in this file is in Git history (`7a93c08`).

## 1. Commits

From `7a93c08` (M2 close): `5e2ce44` camera · `ae56a44` authoring contract + importer + dry run · `0afd9e5` Gallery One + exhibitions · `eb6d758` SIC-driven anchor fix · `cb800c3` gallery probe · `51df79a` walk-in naming fix + docs · `f0f9bf3` record, Landmark, handoff · second session: `13113c0` `compose --check` CRLF fix · final: this commit (re-verification evidence, corrected limits). `main`, `nrvna/integration` untouched; nothing merged or deployed.

## 2. Camera controls — ready for owner testing

| What | How |
|---|---|
| Default | **Third person**, exactly the M2 rig (distance 5, collision on) and feel (sensitivity 1.0×) |
| Switch | **`V`** (desktop) or the HUD button **"View: Third / First person"** (all devices). First person: eye at 0.92 × avatar height, avatar hidden, no zoom. Switching keeps the view direction; going back to third person eases out to your previous orbit distance |
| Settings | HUD **"Camera settings"**: view radios; **Mouse look sensitivity** (shown when a mouse / trackpad exists) and **Touch look sensitivity** (touch screens), 0.2–3.0×; **Reset to defaults**; Escape or Done closes. While open: joystick / Jump are hidden and keys never move the avatar |
| Persistence | browser `localStorage` (`nrvnaverse.camera.v1`): view and both sensitivities survive reloads and travel |
| Unchanged | movement physics and speeds, jump, pointer lock (click canvas, Esc), joystick, Jump, directory, 21+ gate |

Known limits: mouse sensitivity is unit-tested but cannot be measured headless (no pointer lock). Near walls the third-person camera never shows the inside of the avatar: the engine's avatar shader dissolves the avatar within ≈ 1.5–2 m of the camera (verified in the second session; the earlier "camera can enter the avatar" note was wrong).

## 3. Blender importer — what it actually supports

- **Input**: any `.blend`, read through Spatial Intelligence Core's read-only bridge (SIC 0.4.0, verified on Blender 5.1.2). The `.blend` is never saved; its SHA-256 is checked before / after.
- **Output** (dry run, outside the repo): `report.md` / `report.json` (findings), `manifest.json` (every object and marker as authored, in the NRVNAVerse frame), SIC's export.
- **Preserved**: object names (+ optional `nrvna_id`), collection, position, rotation (quaternion, XYZ Euler, yaw), signed scale, raw Blender matrix, exact boxes, bounds, every material slot with variant (`<base>--<variant>`) and image textures.
- **Detected**: missing textures, textures outside the project, Blender `.001` material copies, suspect units (cm / mm scale, absurd sizes), scene unit scale, zero / mirrored / sheared transforms, uncategorised objects, duplicate / malformed / non-Empty markers, unknown kinds, tilted markers, anchors outside or without their gallery — and with SIC: blocked spawns / doors / interaction points (capsule clearance), no ground under markers, anchor sightlines from the gallery spawn, interpenetrating geometry (exact).
- **Into the world today**: exact-box objects as blockout components coloured by material name (Gallery One). Any other mesh waits for the asset contract (human `reviewedBy`). Instances, armatures, animation, cameras, lights: not read.
- **Proof**: synthetic fixtures built by real Blender from committed specs (`gallery-one` round-trips to 0.1 mm; `contract-coverage`'s seeded defects are all reported). No owner scene, vault model or binary in Git.

## 4. Marker naming (exact)

Empties only, in `MARKERS`; facing = local +Y (green arrow), rotate about Z only; volumes = Cube empty (size = display size × scale).

`spawn:<slug>` · `entrance:<slug>` · `exit:<slug>` · `skylift:<slug>` · `drop:<slug>` · `portal:<slug>` (+ `nrvna_destination`) · `gallery:<gallery>` · `anchor:<gallery>:<anchor>` (+ `nrvna_max_width`, `nrvna_max_height`) · `interact:<slug>` (+ `nrvna_radius`) · `chunk:<chunk-key>`. Slugs lowercase kebab-case. Units Metric / Meters / scale 1.0; Blender origin = world origin (Skyfall Plaza centre, street level); Blender +Y = north; a Blender Z rotation θ = world yaw θ. Wired to runtime today: spawn, exit, gallery, anchor; the rest are parsed, validated and recorded (PLANNED wiring).

## 5. Gallery fixture — what it demonstrates

**Gallery One** (`dst_3kacg0rqgyfnp7fm`, venue in The City) on South Row, door on the west facade facing avenue x = 0. Shell = the Blender fixture placed as authored; exhibitions bind to anchor names; the assignment is a separate file. **Chromatic Fields** (default, ten anchors) ↔ **Night Signals** (six anchors). A switch regenerates exactly the `city-south` chunk — building, door, arrival point (37, 1, 150 facing east), destination id, far-field layer and every other chunk byte-identical (tested). SIC on the composed world: every work visible from the arrival eye, door → arrival reachable, clearances fit, works never intersect walls. Walking down South Row keeps the location "The City" (fixed in this run: the gallery used to rename its cell).

## 6. Test evidence

| Check | Result |
|---|---|
| App tests (vitest) | **572 passed** (38 files; 21 camera, 17 authoring importer, 13 gallery, 1 walk-in naming new) |
| Manifests (vitest) / `generate:check` | **61 passed** / up to date |
| `tsc` + strict typecheck | clean |
| `compose --check` / `spatial:check` | up to date / 16 files within the warning budgets |
| `browser:camera` (production) | **PASSED** — 41 checks, desktop 1280×800 + phone 390×844 (real CDP keys / touches; touch 2.0× turns 2.0× as far as 1.0×) |
| `browser:gallery` (production) | **PASSED** — 17 checks: directory travel Hub → Gallery One, authored arrival / facing, only the assigned exhibition present, out through the door and back in (keys + joystick), out → plaza cell → back into South Row stays The City |
| `browser:perf` (production) | **PASSED** — desktop **113 draw calls / 175 k triangles / 60 fps (p95 16.8 ms) / heap 46 MB**; mobile-emulated **105 / 173 k / 60 fps / 39 MB** (M2: 112 / 104 — +1 = South Row's new far-field proxy); Hub → Music → Hub arrives; warm reload served from cache |
| `browser:touch` (production) | first run **FAILED 1 check** (C: the avatar was already falling off the Hub when the page opened — see below), immediate rerun **PASSED** (Hub → 21+ `gateRequired`, zero cannabis requests in both runs) |
| SIC — authoring dry runs | Gallery One: 0 errors / 0 warnings, 18 SIC questions; coverage fixture: every seeded defect reported (incl. spawn-in-wall −0.6 m clearance, 4 m interpenetration) |
| SIC — composed world | every Gallery One work visible from the arrival eye; forecourt → door → arrival reachable (12.0 m); clearances fit; works 5–8 cm proud of their walls |
| Hosted CI | not run (Key guardrails) — not a pass, not a failure |
| **Second-session re-run** (2026-10-16 late, production build of `f0f9bf3`) | `tsc` + strict clean · **572** app / **61** manifest tests · `spatial:check` up to date · `compose --check` up to date (after `13113c0`; before it, a false "stale" on this autocrlf checkout) · `browser:camera` **PASSED** 41 · `browser:gallery` **PASSED** 17 · `browser:touch` **PASSED** 82 on the first run · `browser:perf` **PASSED** (desktop 113 calls / 175 k tris / 60 fps, p95 16.8 ms; mobile 105 / 173 k / 60 fps) · Hub-arrival fall **0 / 96** fresh loads |

**Pre-existing intermittent defect found (not caused by M3):** on a fresh Hub load the avatar sometimes drops through the deck right after the world is revealed and the M2 release hands it to The City (lands on Skyfall Plaza). Measured with 12–16 fresh phone-profile loads of the production build: **M3 1 / 12 and 2 / 16, M2 baseline `7a93c08` 2 / 12**. The avatar holds the spawn height (y 141) through chunk loading and starts falling within ≈ 0.3 s of `ready`; frame dt is clamped to 0.1 s by the engine, so it is not one huge step. Root cause not established — queue item 1. It explains the touch probe's check-C failure above and M2's earlier "marginal" touch failures may share it.

## 7. Limitations and owner decisions

0. **Hub arrival can (rarely) drop the visitor to the plaza** — pre-existing since M2, see §6; if it happens in a playtest, it is this, not the camera. Not reproduced in 96 fresh loads on a quiet machine (second session), so it probably needs a heavily loaded PC; note what else was running if you see it.
1. New stable id **Gallery One** `dst_3kacg0rqgyfnp7fm` and its placement on South Row, its 28 × 20 m size and west door are autonomous, reversible layout choices (Governance rule 9) — owner review.
2. Exhibitions are procedural placeholders; real art must go through the asset contract.
3. Walking into Gallery One from the street does not set the location to Gallery One (only directory travel / deep links do) — a product choice for the owner (queue 3).
4. The importer has not yet seen the owner's real city; expect new findings on a large scene (instancing, modifiers, materials without palette entries).
5. `skylift`, `drop`, `portal`, `interact`, `chunk` markers are recorded, not wired.
6. Hosted CI not run (Key guardrails); local verification above is the evidence.

## 8. Playtest (Windows PowerShell 5.1)

```powershell
D:
Set-Location D:\AWE\awe
git status
git fetch origin
git checkout feat/m3-blender-camera-foundation
git pull --ff-only origin feat/m3-blender-camera-foundation
pnpm install --frozen-lockfile
pnpm --filter the-nrvnaverse build
pnpm --filter the-nrvnaverse start
# browser: http://localhost:3000/                                         Hub — press V, open "Camera settings"
#          http://localhost:3000/?destination=dst_3kacg0rqgyfnp7fm        Gallery One (Chromatic Fields)
```

Switch the exhibition (then rebuild, or use `pnpm --filter the-nrvnaverse dev` and just reload):

```powershell
Set-Location D:\AWE\awe
pnpm --filter the-nrvnaverse gallery:assign gallery-one night-signals
pnpm --filter the-nrvnaverse build
pnpm --filter the-nrvnaverse start
# back to the committed default:
pnpm --filter the-nrvnaverse gallery:assign gallery-one chromatic-fields
git status   # should be clean again
```

Dry-run your own Blender scene (read-only; report goes to %TEMP%\nrvnaverse-authoring\<name>):

```powershell
Set-Location D:\AWE\awe
pnpm --filter the-nrvnaverse authoring:inspect "D:\path\to\your-city.blend"
```

Probes: `pnpm --filter the-nrvnaverse browser:camera`, `browser:gallery`, `browser:touch`, `browser:perf` (after a build).

## 9. Next

Recommended: owner playtest (camera feel, Gallery One); then a dry run of the owner's real Blender city reviewed together before anything is composed from it. Do not merge; do not deploy.
