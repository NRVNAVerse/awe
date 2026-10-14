# NRVNAVerse M1 creative build — overnight progress record

| Field | Value |
|---|---|
| **Branch** | `feat/m1-spatial-creative-overnight` (from `nrvna/integration` @ `19562bc`) |
| **Session** | 2026-10-13 → 2026-10-14, unattended, Claude Code (Fable 5.1), desktop PC1 |
| **Status** | **VERIFIED on the feature branch; not integrated; no deploy, no external change.** Landmark version unchanged (0.2) |
| **What changed** | The Central Hub, the Music District and the Fashion / Culture District are composed places instead of M0 diagrams; a deterministic authoring layer owns their chunks; global atmosphere is a dusk sky. Everything is replaceable primitive geometry. The 21+ district and its gate are untouched |
| **Developer truth (incl. secrets)** | [`NRVNAVERSE_HUB_WORLD.md`](./NRVNAVERSE_HUB_WORLD.md) |

## 1. Creative thesis

THE NRVNAVerse should feel like a designed place before it has production art. The Hub is a sunken stone basin under a dusk sky with a lantern spire rising from an open-roofed pavilion that carries the identity inscription; a rim terrace and an overlook deck give height and a view; the pavilion's interior is the first optional discovery. Each public district gets one strong spatial idea (a soundstage with a processional walk and a stage of fins; a runway leading to a gallery loggia with a roof terrace) and one quiet place that is not visible from its arrival (the sound booth; the atelier). Nothing fabricates a partner, artist or brand; the empty plinths and frames are the point.

## 2. Authoring layer (new)

`apps/the-nrvnaverse/spatial/authoring/`: `lib.mjs` (builders: box, slab, column, sphere, rampZ, rampX, label, glow, pulse; rotations emitted in **radians** — the engine applies mesh rotation as radians although its data docs say degrees), `hub.mjs`, `music.mjs`, `fashion.mjs` (compositions), `compose.mjs` (replaces each composed chunk's component set in `scene.m0.json` / `spatial-config.m0.json`; `--check` exits 1 when the committed source is stale). Workflow: edit a composer → `node spatial/authoring/compose.mjs` → `pnpm spatial:generate` → `pnpm spatial:check`. The pipeline, portal bindings, placements, manifests and runtime are unchanged; the M0 ids that tests and bindings rely on are preserved.

## 3. Verification performed

| Check | Result |
|---|---|
| `spatial:validate` / `generate` / `check` | pass, within budget (budgets raised to 128 KiB / 96 components per runtime artifact, warning-only; pipeline doc §16) |
| `compose --check` | source up to date |
| App tests (`pnpm --filter the-nrvnaverse test`) | 424 passed (budget test rewritten for composed chunks) |
| App typecheck (`check`, incl. strict) | pass |
| Production build (`pnpm --filter the-nrvnaverse build`, includes `release:check`) | pass |
| `browser:perf` (production build, headless Chrome GTX 1050, desktop 1280×800 + phone emulation 390×844@3) | PASSED: world placed, no HTTP/failed requests, immutable caching intact, travel Hub → Music → Hub arrives, no unexpected console errors. Desktop: 157 draw calls, 19.9 k triangles drawn, 56 fps (vsync-capped), JS heap 29.7 → 40.8 MB after travel, cold wire 3.80 MB (spatial JSON 8.8 KB of it). Phone emulation: 148 calls, 21.9 k triangles. M0 baseline was 15 calls / 6.9 k triangles — the primitives cost one draw call each plus the shadow pass; no optimisation attempted yet (measure with real art first) |
| Headless Mover route proofs (`pnpm run-space`, real Rapier) | every authored route reached: Hub (landing → ramp → terrace → overlook ramp → deck; stud trail → Core house; terrace → beam-ring jump; flush paths; Music gateway), Music (processional, stage ramps, booth), Fashion (runway, loggia, roof ramp → landing → terrace, atelier) |
| SIC | `adapt_awe_scene` (149 entities, 95 exact physical shapes), `survey_visibility` from the arrival eye (identity wall 100 % visible, spire fin 74 %, three portals 87–100 %; the hidden interior, its north wall and the last stud **0 %**), `verify_scene` contact/resting checks, `visual_evidence` renders of five viewpoints |
| Age gate | the cannabis sensor keeps its id and binding; `browser:touch` check D (directory → Cannabis → `gateRequired`, zero cannabis requests) is part of the final run below |

## 4. Reference repositories (read-only; nothing edited, no branches)

- `TheCannaMan/awe` @ `1777252` — `docs/CAPABILITY_MATRIX.md`, `PLATFORM-OPERATING-MODEL.md`.
- `TheCannaMan/awe-creature-lab` (branch `feat/keepers-table-v1`) — `GLASSHOLLOW_DESIGN_LAWS.md`, `CREATURE_LAB_SOURCE_OF_TRUTH.md` (Moon Wing, eyrie, benches, routes).
- `TheCannaMan/awe-game-lab` (`feat/v1-game` @ `89b9803`) — `GAME_SOURCE_OF_TRUTH.md` (Lantern Rock level rules and the 18 upstream findings), `headless-playthrough.ts` (the Mover pattern reused by the route proofs).
- `TheCannaMan/nrvna-knowledge-core` — private, not readable from this machine (`gh` absent, raw 404); brand facts taken from the task brief only.

## 5. AWE capability classification

| Class | Capabilities |
|---|---|
| **USE** (upstream engine in this repo) | mesh primitives, text, sensors (`onSensorEnter` seam), visual plugins (FresnelGlow, Pulse, Hologram), sky background, fog, directional sun + shadows, reflector, `space.schedule`, instancing/batching (not needed yet) |
| **ADAPT** (pattern rebuilt at the app layer) | trigger zones → existing `onPlayerEnterSensor`; stud trails / light-as-wayfinding; headless gameplay proofs; the touch HUD |
| **INFORM** | space-kit moods and lighting presets; Glasshollow route/eyrie/bench patterns; Lantern Rock's generated audio |
| **KEEP SEPARATE** | teleporter / link-portal behaviours (stable-id navigation stays NRVNAVerse-owned), multiplayer, world/plots |
| **HANDOFF DEPENDENCY** (generic AWE work, separate thread) | point / spot lights (fork-only), `@oncyberio/behaviors` (doors, keys, notify, switch), water + fog shader fix, bloom excluding UI, a slimmer mesh data envelope |

## 6. Vault (D:\AWE-Vault, read-only; nothing moved, renamed, uploaded or committed)

Method: Vault Organizer GLB catalog (303 rows) scanned by name for the roles the thesis needed; five candidates inspected with SIC `inspect_asset`. None placed tonight — production placement is blocked anyway (no live store), and each had a technical or rights reason:

| Candidate | Facts | Rights | Verdict |
|---|---|---|---|
| `Sketchfab/Greek Modular Environment/greek_modular_environment.glb` | 42 × 36 × 46 m whole environment, 70 k tris, 33 draw calls, 5.6 MB, 256–512 px textures, valid | UNKNOWN (Sketchfab) | colonnade language for a future Fashion loggia; needs rights review and separation into pieces |
| `Older 3D Files/Copper Art 1.glb` | 0.45 × 3.6 × 5.4 m animated copper tori, 86 k tris, 3 × 2048 textures (≈134 MB GPU est.) | UNKNOWN (likely self-authored, unproven) | Hub sculpture candidate after texture downsizing; animated → known retire log |
| `backup glb/glass dome v1.0.glb` | 2.1 m dome, 1 k tris, 0.6 MB | UNKNOWN | too small; primitives do the same |
| `Older 3D Files/Record v1.003.glb` | 1.9 m vinyl record, 309 k tris (!), 21 MB, untextured | UNKNOWN | Music landmark after decimation |
| `GLB/NRVNAVerse 3.0 v1.9.glb` | 483 × 103 × 480 m previous whole-world build, 413 k tris, 129 draw calls, 56 MB, cannabis decals, NRVNA logo | owner's own | INFORM only (previous vision); not for the ungated Hub |

Also seen by name, not inspected: `NRVNA 3d Logo v1.0.glb` (historical mark — not an approved current mark per the brief), Treeple Dreamers set (palace spires, Archesdei, Levento…), Metallic Showroom, Art Gallery 1.x, Palm Tree 1.5.

## 7. SIC consumer findings (handoff to the SIC thread; not repaired here)

1. The AWE adapter (v0.5.0) marks the `terrain` component unsupported, so `resting_gap` on ground-level blocks answers `no_surface_below`; ground support must be checked another way. Reproduction: adapt `apps/the-nrvnaverse/public/data/static-scene.json`, `resting_gap` on `hub-terrace`.
2. `visual_evidence` for an AWE scene requires the scene to live under SIC's approved render roots; the app's `public/data` is outside them, so a copy into `C:/Dev/spatial-intelligence-core/scratch/awe-work/` was needed (acceptable, but a per-call root would be more convenient).
3. The AWE render reconstruction does not draw plugins or the sky background, so glow and dusk lighting could only be judged in the engine's own screenshots.
4. `survey_visibility` has no field of view: a target behind the viewer counts as visible, so "hidden from the arrival" could only be proven for occluded targets (the Core house interior), not for the booth behind the Music spawn.

## 8. Generic AWE findings worth a handoff (observed, not fixed)

- Mesh `rotation` is applied as radians by the runtime while `mesh-data.ts` documents degrees.
- The character controller cannot step onto a 0.3 m lip (Lantern Rock finding 6 reproduced with the THE NRVNAVerse Mover profile); ramps up to 16.7° were fine.
- `@oncyberio/engine/controls` cannot be imported with named ESM imports from a `run-space` program under tsx (CommonJS interop); `await import()` + `module.exports` works.
- Each primitive mesh is its own draw call; a composed district costs ≈150 calls. Batching / instancing exists upstream but needs a data-driven path to be usable from scene JSON.

## 9. Not done / next

- Real art: the Hub spire and Core house shell, the Music stage fins and the Fashion loggia are the first replacement slots (ids in the world doc).
- Audio: none yet (generated ambience as in Lantern Rock is the obvious route; a committed WAV needs a policy decision).
- Visitor copy: the directory still shows "M0 placeholder…" descriptions (manifests untouched — a human copy decision).
- Mobile: emulated only; the composed districts have not been walked on a real device.
- Performance: no instancing; measure with real art before optimising.
- The 21+ district remains the M0 placeholder by design.
