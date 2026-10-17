# NRVNAVerse M3 — camera controls, Blender authoring contract, permanent gallery — campaign record

Compact, restartable record for the M3 run on `feat/m3-blender-camera-foundation`. Read this first after a compaction or restart; then `handoffs/current/reviewer.md`, the owner guide [`NRVNAVERSE_BLENDER_AUTHORING.md`](./NRVNAVERSE_BLENDER_AUTHORING.md), runtime §21, pipeline §20, world §18. Not a transcript.

| Field | Value |
|---|---|
| **Objective** | A: first / third-person camera + sensitivity settings (first). B: a versioned Blender → NRVNAVerse authoring contract with a safe, SIC-backed dry run and a synthetic fixture proof. C: one permanent gallery whose exhibitions change without moving the building. D: SIC verification, owner documentation, tests and browser probes |
| **Branch** | `feat/m3-blender-camera-foundation`, from `7a93c08` (M2 close). Not merged, not deployed |
| **Session** | Claude Code, Opus 5.5, Auto, 2026-10-16 evening (PDT) |
| **Guidance read** | Operating Guide, Governance, Landmark, DECISIONS (D-004, D-006, D-016–D-021), M2 campaign record + handoff; `TheCannaMan/Key@c68ca0f` (`OVERNIGHT_RUNS.md`, `CLAUDE_MODEL_ROUTING.md`, `AI_REPOSITORY_HANDOFF_STRATEGY.md`, `GITHUB_BILLING_AND_CI_GUARDRAILS.md`) |
| **Boundaries kept** | no merge / deploy / DNS / budget change; SIC used read-only (only read-only MCP tools, client allowlist); no vault file, `.blend`, texture or third-party model committed; 21+ gate untouched; no engine / editor / studio file modified; no dependency or lockfile change |

## 1. Checkpoints

| # | What | Commit |
|---|---|---|
| A | Camera: `CameraViewController` over the official third- and first-person rigs (one live), `V` + HUD toggle, settings panel (view, mouse slider, touch slider, reset), per-source look scaling, `localStorage` `nrvnaverse.camera.v1`, read-only camera snapshot, `pnpm browser:camera` | `5e2ce44` |
| B | Authoring contract v1: contract / importer (pure) / SIC checks / dry-run CLI, Blender fixture builder, portable fixture exports, 17 tests | `ae56a44` |
| C | Gallery One (`dst_3kacg0rqgyfnp7fm`): shell from the Blender fixture, two fixture exhibitions, separate assignment, `pnpm gallery:assign`, plot reservation, 11 tests | `0afd9e5` |
| D1 | SIC on the composed world → floor anchors staggered off the entrance axis + sightline regression test | `eb6d758` |
| D2 | `pnpm browser:gallery` (desktop + phone) | `cb800c3` |
| D3 | Walk-in naming fix (a venue never renames its city cell) + docs | `51df79a` |
| D4 | Final production probes; pre-existing Hub-arrival fall measured on M3 and the M2 baseline; record / Landmark / handoff | this commit |

## 2. Findings worth keeping

1. **The engine's `FirstPersonCameraRig.reset()` faces the avatar's +Z** — the opposite of the orbit rig's framing (the orbit sits on +Z looking back). A first-person reload or teleport faced backwards until the controller re-aimed the eye to the orbit's framing yaw. Found only in the browser probe.
2. **Returning to third person** has to start the orbit from behind the eye *at the orbit pivot height* (the rig re-syncs its orbit from the camera position on activation); otherwise the view tilts up (pitch +0.25 rad measured) or the zoom collapses to ~0.
3. **Keys in HUD controls reach the engine** (`sharedControlState` listens on `window` with no focus filter): arrow keys on a slider walked the avatar; a focused HUD button is also "clicked" by Space (= jump). The panel stops key propagation; pointer clicks drop focus.
4. **SIC's Blender bridge works on Blender 5.1.2** (documented for 4.4): ≈ 4.4 s per export, `.blend` hash unchanged. SIC refuses a scene with a zero-scale object, so the dry run hands SIC a copy without the objects the importer already refused.
5. **Float32**: Blender stores 33.8 as 33.79999924; lengths are rounded to 0.1 mm (float32 resolves ≈ 10 µm at city scale).
6. **XYZ Euler of a pure yaw beyond ±90°** is (π, π − θ, π); upright objects are emitted as `{ 0, yaw, 0 }`.
7. **SIC caught a composition flaw tests could not**: the centre east-wall work 0 % visible from the arrival eye behind a floor column on the entrance axis. Fixed at the authored anchors; a pure-geometry test keeps it fixed.
8. **A venue placed in a streaming cell renamed the cell** (`homeDestinations` used the cell's first placement): fixed and covered by a unit test and the browser walk-in check.
9. Navmesh `reachable` over the whole city needs `cell_size_m` ≥ 0.4 (SIC: 6,975 tiles at the default cell size > 4,096).
10. **Pre-existing (M2) intermittent Hub-arrival fall**: on a fresh load the avatar sometimes drops through the 0.5 m deck slab within ≈ 0.3 s of `ready` and the release hands it to The City. Fresh-load repro (production, phone profile): M3 1 / 12 and 2 / 16; **M2 baseline `7a93c08` 2 / 12** — so not caused by M3. Frame dt is clamped to 0.1 s (not one huge step). Scratch repro: `D:\AWE-Scratch\m3	ools\hub-fall-repro.mjs`. Root cause open.

## 3. Verification (final numbers in `handoffs/current/reviewer.md` §4)

App tests (vitest), manifests (vitest), `tsc` + strict, `compose --check`, `spatial:check`, manifest `generate:check`; production `browser:camera`, `browser:gallery`, `browser:touch`, `browser:perf`; SIC dry runs of both fixtures; SIC pass over the composed world (scratch: `D:\AWE-Scratch\m3\sic\gallery-world.json`). Hosted CI not run (Key guardrails).

## 4. Continuation queue (owner / reviewer may re-rank)

0. **Root-cause the intermittent Hub-arrival fall** (finding 10) in its own bounded task: per-frame trace of avatar y / grounded / colliders around reveal; candidates — collider availability vs the first Mover steps after `space.start()`, deck slab thickness vs per-step displacement. Make `browser:touch` check C start from a verified grounded avatar either way.
1. **Owner playtest** of the camera (feel of mouse / touch sensitivity, first-person eye height 0.92 × avatar height, `V`), and of Gallery One.
2. **Run the dry run on the owner's real Blender city** (read-only) and review the report together before anything is composed from it.
3. Decide: should walking through a gallery's entrance mark the location as the gallery (an entrance zone), or should only directory travel / deep links do so (current)?
4. Wire the recorded-but-unused marker kinds (`portal`, `skylift`, `drop`, `interact`, `chunk`) to runtime behaviour once real scenes use them.
5. Real exhibition content through the asset contract (human `reviewedBy`) — images on canvases, sculptures as reviewed GLBs.
6. Third-person near-wall comfort: when the orbit is pressed inside ~0.5 m of the head the camera can enter the avatar (the rig's `visible`-based look-at path makes hiding the avatar there unsafe; needs an engine-level option or an opacity approach).

## 5. Exact next action

Handed to ChatGPT for review (`handoffs/STATUS.md`). If resumed by an implementer before review: queue item 2 needs the owner's file path; otherwise stop at this review boundary.
