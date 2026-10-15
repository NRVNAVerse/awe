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
- SIC is used from this campaign through a dependency-free stdio MCP client kept in the session scratchpad (`sic-batch.mjs`: a JSON plan of tool calls with `$id.path` result substitution). The SIC MCP server is not registered in this Claude session; nothing in SIC is modified.
- Eddie Anthony: the private web/store repository is NOT reachable from this machine (no `gh`, no stored credentials). Local brand folders exist (`D:\Business\Clients\Eddie Anthony`, OneDrive) — logos, merch mockups, audio, song/drop names. Read-only; nothing copied. Design context comes from the handoff's documented findings.
- Engine capabilities relevant to experience work (VERIFIED in `packages/engine/src`): `Component3D.onSensorEnter / onSensorExit / onSensorStay` (payload `other`), `space.schedule(delaySeconds, cb)`, `Component3D` is an `Object3D` (so `component.visible` hides its subtree; mesh `display:false` keeps the collider), visual plugins `FresnelGlowPlugin / PulsePlugin / HologramPlugin / RainbowPlugin / DissolveEdgePlugin / DamagePlugin`, components `audio` (ambient/spatial, URL-based), `iframe` (CSS3D overlay + GL blocking plane), `interaction` (proximity key prompt — keyboard only), `dialog`.
- The production build in the clone predates the creative checkpoint (BUILD_ID 2026-09-25): rebuild before any browser evidence.

## 2. Checkpoints

| # | Checkpoint | SHA | State |
|---|---|---|---|
| 0 | Recovery + campaign record + SIC client | — | in progress |

## 3. Architecture chosen for the experience layer (reversible, product-layer)

```
spatial-config  experience: { zones[], arrivals[], hidden[] }   authored by the composers (component ids only)
      │ validate (references: sensor exists, owned by its chunk, enabled sensor; targets exist in the same chunk)
      ▼ generate
spatial-index   "experience": { zones, arrivals, hidden }       additive, schema v1 unchanged, sorted
      │
ExperienceController (app)  ── binds the ACTIVE chunk's zones (enter/exit) and arrival beats ──▶ runtime seams:
      onPlayerEnterSensor / onPlayerExitSensor / setComponentVisible / schedule
```

Rules: effects are visibility toggles over authored component ids (state A / state B geometry, both authored; state B hidden on staging so nothing flashes); no coordinates, no gates, no HUD quests; a chunk retire resets everything (components are recreated). Mirrors the portal precedent (M0 2B.3) so review sees one pattern.

## 4. Evidence already run

- SIC `adapt_awe_scene` on the committed `static-scene.json`: 214 entities (133 solid, 56 visual, 7 regions = the sensors, 18 markers), 0 unsupported geometry, 0 agents (the avatar is not a PLAYER-body mesh — a `sic.agents/0` overlay is needed for navigation/clearance questions).
- App test baseline: see checkpoint 1.

## 5. Findings worth keeping

- SIC: the MCP `adapt_awe_scene` accepts the app's `public/data/static-scene.json` directly (no copy needed); only `visual_evidence` requires the scene under an approved render root.

## 6. Continuation queue (ranked)

1. Experience layer (zones + arrival beats) for Hub, Music, Fashion — checkpoint.
2. Music concourse + one independently loadable venue room (new `venue` destination) + config-driven "tonight's room"; vault venue audition with SIC `inspect_asset` on a bounded candidate set.
3. WEB↔SPATIAL threshold: contextual web-context surface driven by the manifest; in-world `iframe` feasibility against an app-served page; document CSP/frame limits honestly.
4. Second-pass discovery: hidden-place sigils remembered across visits (localStorage, harmless), Hub dormant frame reacts.
5. Audio-reactive ambience without assets (WebAudio synthesis at app layer) if time; Eddie design notes.
6. Fashion parity, transitions, mobile comfort for new interactions, performance consolidation if measured.

## 7. Exact next action

Implement the `experience` section in the pipeline + index parser + runtime seams + controller + composer helpers; verify with unit tests and a headless walk; checkpoint.
