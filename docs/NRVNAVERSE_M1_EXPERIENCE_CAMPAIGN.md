# NRVNAVerse M1 spatial experience — overnight campaign record

Compact, restartable progress record for the unattended campaign on `feat/m1-spatial-experience-overnight`.
Read this first after a compaction, model fallback or restart; then `handoffs/current/reviewer.md`
(the brief) and `docs/NRVNAVERSE_HUB_WORLD.md` (world truth incl. secrets).

| Field | Value |
|---|---|
| **Campaign objective** | Move THE NRVNAVerse from spatial *composition* to spatial *experience*: reactive districts, a reusable Music venue/concourse proof, a WEB↔SPATIAL seam proof, vault venue evaluation with SIC, second-pass discovery, Eddie Anthony as the artist-pilot design test |
| **Branch** | `feat/m1-spatial-experience-overnight` (from the creative checkpoint `1ac1740` = `feat/m1-spatial-creative-overnight`, base `nrvna/integration@19562bc`) |
| **Start SHA** | `26e6030` (docs-only handoff commits on top of the creative checkpoint) |
| **Working clone** | `D:\NRVNAVerse\awe` (the only installed checkout; `http.sslBackend=schannel` is required on this machine) |
| **Session** | 2026-10-14 → 2026-10-15, unattended, Claude Code (Fable 5.1), desktop PC1 |
| **Boundaries** | No merge to `nrvna/integration` or `main`; no deploy / DNS / R2; no change to SIC, the vault originals or reference repos; no uncleared collaborator assets; the 21+ gate unchanged; no generalized event backend; hosted CI is quota-blocked and is NOT a completion dependency |

## 1. Recovery facts (VERIFIED 2026-10-14)

- Campaign branch had no implementation checkpoints when this run started: three docs commits on the creative checkpoint.
- Tooling: Node 24.19, pnpm 10.10 (Corepack), Chrome installed, SIC 0.4.0 at `C:\Dev\spatial-intelligence-core` (`sic doctor`: READY; MCP server 21 tools; AWE renderer verified; Blender 5.1 untested), vault at `D:\AWE-Vault` (258 GLBs), Vault Organizer catalog `D:\AWE-Vault-Organizer\reports\glb_catalog_2026-09-23_224603.csv` (303 rows) + `data/inventory.db`.
- SIC is used from this campaign through a dependency-free stdio MCP client kept in the session scratchpad (`sic-batch.mjs`: a JSON plan of tool calls with `$id.path` result substitution). The SIC MCP server is not registered in this Claude session; nothing in SIC is modified. `adapt_awe_scene` accepts the app's `public/data/static-scene.json` directly; only `visual_evidence` needs the scene under an approved render root.
- Eddie Anthony: the private web/store repository is NOT reachable from this machine (no `gh`, no stored credentials). Local brand folders exist (`D:\Business\Clients\Eddie Anthony`, OneDrive) — logos, merch mockups, audio, song/drop names. Read-only; nothing copied. Design context comes from the handoff's documented findings.
- Engine capabilities relevant to experience work (VERIFIED in `packages/engine/src`): `Component3D.onSensorEnter / onSensorExit / onSensorStay` (payload `other`), `space.schedule(delaySeconds, cb)` (handle `.cancel()`), `Component3D` is an `Object3D` (so `component.visible` hides its subtree; mesh `display:false` keeps the collider), visual plugins `FresnelGlowPlugin / PulsePlugin / HologramPlugin / RainbowPlugin / DissolveEdgePlugin / DamagePlugin`, components `audio` (ambient/spatial, URL-based), `iframe` (CSS3D overlay + GL blocking plane), `interaction` (proximity key prompt — keyboard only), `dialog`. There is no public data-mutation API on a component (`_applyData` is internal) — visibility is the official-API reactive primitive.
- The strict typecheck (`tsconfig.strict.json`) excludes the engine-importing files; a test that imports `@/lib/app-store` pulls the engine runtime into the strict program and must be excluded the same way (`test/experience-store.test.ts` is).

## 2. Checkpoints

| # | Checkpoint | SHA | State |
|---|---|---|---|
| 0 | Recovery + campaign record + SIC client | `0798e71` | pushed |
| 1 | **Experience layer**: `experience` bindings in the spatial config / pipeline / index (hidden-on-stage sets, zones, arrival beats), runtime seams (`onPlayerExitSensor`, `hideOnStage`, `setComponentVisible`, `schedule`), `ExperienceController`, store wiring + diagnostics, 11 zones + 6 arrival rules composed into Hub / Music / Fashion (33 state-B components), docs (pipeline §17, runtime §17, world §12) | this commit | tests 466 ✓ · typecheck ✓ · spatial validate/generate/check ✓ · headless zone proof ✓ · SIC design + verify pass ✓ · browser evidence: see §4 |

## 3. Architecture chosen for the experience layer (reversible, product-layer)

```
spatial-config  experience: { hidden[], zones[], arrivals[] }   authored by the composers (component ids only)
      │ validate (references: sensor exists, owned by its chunk, enabled sensor, never a portal; targets exist in the same chunk)
      ▼ generate
spatial-index   "experience": { hidden, zones, arrivals }       additive, schema v1 unchanged, sorted
      │
ExperienceController (app)  ── binds the ACTIVE chunk's zones (enter/exit) and arrival beats ──▶ runtime seams:
      onPlayerEnterSensor / onPlayerExitSensor / hideOnStage / setComponentVisible / schedule
```

Rules: effects are visibility toggles over authored component ids (state A / state B geometry, both authored; state B hidden inside `stageChunk` so nothing flashes); no coordinates, no gates, no HUD quests; a chunk retire resets everything (components are recreated). Mirrors the portal precedent (M0 2B.3) so review sees one pattern. Zone sensors sit before the portals in every chunk so `asset:place` still appends after the last portal.

## 4. Evidence already run

| Check | Result |
|---|---|
| App tests | 466 passed (28 files; +42 new: `experience-bindings`, `experience-controller`, `experience-store`) |
| Typecheck (incl. strict) | pass |
| `spatial:validate` / `generate` / `check` | pass, within budget (hub 110 KiB / 87, music 86 KiB / 65, fashion-culture 119 KiB / 90 — close to the 128 KiB warning) |
| `compose --check` | source up to date |
| Headless (`pnpm run-space`, real engine + Rapier, official Mover teleports) | all 11 zone sensors fire ENTER and EXIT for the player, 0 stray events, 0 missing; `Component3D.visible` toggles on state components |
| SIC design pass (before authoring) | `bounds` of the 12 zone anchors (OBB tier) — zone volumes sized from them |
| SIC verify pass (after composing, 258 entities, 18 regions, 0 unsupported) | `in_region`: lamp / seat / halo / desk / plinth / roof bench / pedestal fully inside their zones (conclusive); `intersects`: zones vs portals, ramps, beam ring — separated or touching, 0 penetration; `survey_visibility`: lit rings 38–58 % from the Hub spawn, gateway glows 97 %, stacks 75–100 % and wash 76 % from the Music eyes, frames 100 % from the Brand threshold, roof lamp 90 % from the Fashion spawn |
| SIC finding kept | `music-fin-3-blade` is fully occluded from the Artist spawn by `music-booth-spot` when both are shown; by design they are never shown together for one visitor (booth-only spot). Revisit with presence |
| Browser (production build) | pending at this checkpoint — build running; `browser:shots`, `browser:perf`, `browser:touch` next |

## 5. Findings worth keeping

- SIC `survey_visibility` takes `from_point` / `from_viewpoint` (not `eye`); the AWE adapter maps hidden `isSensor` meshes to `region` entities, so zones are directly queryable with `in_region`.
- SIC consumer limitation (hand back to the SIC thread): visibility surveys model every authored mesh as present; there is no way to declare runtime-hidden state (state-B geometry) so "visible when lit" and "occluded by a hidden cone" need two scene variants. A `hidden: [ids]` option on `load_scene` / `adapt_awe_scene` (or honouring `display:false` as non-occluding for visual queries) would make reactive worlds first-class.
- Engine: sensor EXIT after a straight vertical teleport out of a zone was flaky headless (fired after lateral teleports and more ticks); real walking is lateral, so no product impact, noted for the AWE thread.
- Strict typecheck programs grow through imports: excluding a file is not enough if an included test imports its importer.

## 6. Continuation queue (ranked)

1. Browser evidence for checkpoint 1 (shots incl. a reactive state, perf, touch/gate regression) → record in §4.
2. Music concourse + one independently loadable venue room (new `venue` destination) + config-driven "tonight's room"; vault venue audition with SIC `inspect_asset` on a bounded candidate set (Airplane Hanger concert stage ×4 versions, Elysium, Nightclub1 ×2, 80s warehouse, Scifi Hall, cinema interior, Warehouse FBX).
3. WEB↔SPATIAL threshold: contextual web-context surface driven by the manifest; in-world `iframe` feasibility against an app-served page; document CSP/frame limits honestly.
4. Second-pass discovery: hidden-place sigils remembered across visits (localStorage, harmless), Hub dormant frame reacts.
5. Audio-reactive ambience without assets (WebAudio synthesis at app layer) if time; Eddie design notes.
6. Fashion parity, transitions, mobile comfort for new interactions, performance consolidation if measured; raise the fashion-culture budget before adding geometry there.

## 7. Exact next action

Wait for the production build, run `browser:shots` (plus a CDP probe that teleports into a zone and screenshots the lit state), `browser:perf` and `browser:touch`; record results in §4; then start queue item 2 (Music concourse / venue room).
