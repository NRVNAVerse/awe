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
| 1 | **Experience layer**: `experience` bindings in the spatial config / pipeline / index (hidden-on-stage sets, zones, arrival beats), runtime seams (`onPlayerExitSensor`, `hideOnStage`, `setComponentVisible`, `schedule`), `ExperienceController`, store wiring + diagnostics, 11 zones + 6 arrival rules composed into Hub / Music / Fashion (33 state-B components), docs (pipeline §17, runtime §17, world §12) | `1157b64` | pushed · tests 466 ✓ · typecheck ✓ · spatial check ✓ · headless zone proof ✓ · SIC design + verify pass ✓ · browser: 8 real-input shots ✓ (see §4) |
| 2 | **Music venue complex**: the concourse (Club door + tonight's marquee, config-driven `TONIGHT`), **The Club** — first independently loadable venue room (own chunk `music-club`, own `venue` destination `dst_gqq90k2404cy9nf0`, two new portals, its own wake / dance-floor / stage reactions), visual tuning from browser evidence (stage blades as stripes, smaller wash, dormant rings dark, Hub wake retimed past the reveal fade), vault venue audition (8 candidates, SIC `inspect_asset`), world doc §13 | `213b038` | pushed · manifests 61 ✓ · app 466 ✓ · typecheck ✓ · spatial check ✓ · headless ✓ · SIC verify ✓ |
| 2b | Club room tuned from browser evidence (20 m deep, off-centre door so the camera stays inside, stage ramp, drum lamps + floor pools, label over the stage); WEB↔SPATIAL scaffolding (index parser, `ThresholdController`, store, `/web-context/[id]` page) | `534c8a8` | pushed · `browser:perf` PASSED · `browser:touch` PASSED (gate: zero cannabis requests) · Club door / arrival / dance floor / stage shots ✓ |
| 3 | **WEB↔SPATIAL thresholds wired end to end**: `thresholds[]` in the spatial config (portal-shaped, validated, never a portal sensor) → index → `ThresholdController` → web-context store → `WebWindow` (same-origin frame of the manifest-derived page, canonical link in a new tab); three thresholds (Club door front, gallery frames, Club bar); docs (pipeline §18, runtime §18, world §14, venues note) | `7d54c26` | pushed · app 477 ✓ · typecheck ✓ · spatial check ✓ · headless (16 sensors enter/exit, 46 events, 0 stray) ✓ · SIC (thresholds vs portals / zones / walls separated) ✓ · browser (production build): web-context page renders with canonical link `target=_blank`; Club door strip opens the window with the frame loaded, dismiss closes, leaving keeps it closed, re-entry reopens, portal travel closes it; gallery-frames strip opens the Brand window (frame `complete`, canonical href correct); 0 console errors |
| 4 | **Discovery memory**: sigils in the three hidden places (dim / lit), finds remembered in `localStorage` (`nrvnaverse.discovery.v1`), the Hub's dormant frames wake per remembered count and a line appears at three; `DiscoveryMemory` module over `ExperienceController.applyEffect`; debug panel shows zones / thresholds / remembered / last effect; docs (world §15, runtime §19) | `4ba9bb6` | app 484 ✓ · typecheck ✓ · spatial check ✓ (hub 117 KiB / 92, music 102 KiB / 93, fashion-culture 123 KiB / 93 — all within 128 KiB / 96, little headroom left) · SIC (sigils inside their zones, clear of seat / desk / pedestals; lit frames 63 % / 22 % visible from the Hub spawn) ✓ · browser (production build, real input): walking up the booth ramp finds the booth sigil (`arrival:sigil:booth`, memory `{"v":1,"found":["booth"]}`), the Hub then reports 1 remembered and lights frame 1; a seeded three-sigil memory shows both frames lit and the inscription (`remembered 3`); 0 console errors |

| 5 | **Convergence**: Eddie artist-room design notes (world §16, nothing copied), final checks (compose --check, spatial check, manifests check + 61 tests, app 484 tests, strict typecheck), official probes on the final build (`browser:perf` PASSED — desktop 163 calls / 23.9 k tris / 56 fps vsync / heap ≈ 30 MB, mobile-emulated 154 calls / 25.9 k tris; `browser:touch` PASSED incl. Hub → Cannabis `gateRequired`, zero cannabis requests), destination arrival shots, handoff (`handoffs/current/reviewer.md`, `handoffs/STATUS.md` → ChatGPT) | this commit | pushed |

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

Venue complex (checkpoint 2): a venue room = a chunk + a `venue` manifest + a placement + two portal bindings + a composer; adding The Club touched no runtime code — only data, the composer and count-pinned tests. `TONIGHT` / `VENUE_ROOMS` / `CLUB_TEMPLATE` are authoring-level scaffolding (D-018 vocabulary kept distinct), not an event backend.

## 4. Evidence already run

| Check | Result |
|---|---|
| App tests | 466 passed (28 files) after checkpoint 2 (count-pinned expectations updated: 5 chunks, 8 destinations, 9 portals, 13 zones, 7 arrivals) |
| Manifest tests | 61 passed (8 destinations; The Club listed under the Music District after the artist, id order) |
| Typecheck (app incl. strict, manifest) | pass |
| `spatial:validate` / `generate` / `check` | pass, within budget — hub 110 KiB / 87, music 98 KiB / 90 (at the 96-component warning line), fashion-culture 119 KiB / 90, music-club 76 KiB / 62, cannabis-21 unchanged |
| `compose --check` | source up to date |
| Headless (`pnpm run-space`, real engine + Rapier) | all 13 zone sensors fire ENTER and EXIT for the player (32 events, 0 stray); Club walk: spawn → dance floor (zone fires) → onto the stage (zone fires, avatar on the riser at y 1.1) |
| SIC design pass | `bounds` of the 12 zone anchors (OBB tier) — zone volumes sized from them |
| SIC verify pass (checkpoint 1, 258 entities) | `in_region` anchors fully inside their zones; `intersects` zones vs portals / ramps / beam ring separated or touching; `survey_visibility` lit rings 38–58 % from the Hub spawn, gateway glows 97 %, stacks 75–100 % from the Music eyes, frames 100 % from the Brand threshold, roof lamp 90 % |
| SIC verify pass (checkpoint 2, 328 entities, 22 regions, 0 unsupported) | Club tiles / console fully inside their zones; stage zone vs floor zone, portal vs floor zone, bar vs tile, booth vs tile, ring vs wall, passage vs booth deck, marquee vs booth deck / rail, ramp vs booths / tiles / wall — all separated; from the Club door: stage 93 %, rings 83–100 %, bar light 100 %; from the Music spawn (turning round): marquee 88 %, door glow 97 % |
| SIC vault audition | 8 candidates inspected (`inspect_asset`, glTF validator + SIC bounds/topology/texture estimate); table in world doc §13; strongest: Nightclub1 (2.5 k tris, 6.6 MB, 187 MB GPU textures) and 80s warehouse (75 k tris, 4.3 MB) as optimize/derive candidates; Airplane Hanger's concert-stage sub-tree as the hall/festival inspiration; everything UNKNOWN rights, nothing placed |
| Browser (production build, checkpoint 1 world, real trusted WASD input via CDP, 1280×800) | Hub arrival + spire wake; Music path → stacks lit; artist arrival → crescendo + wash; Music → Hub portal → return glow on the Music gateway; Fashion runway → pylons lit; Brand arrival → frames lit. Destination ids / phases confirmed in the DOM; only console errors are headless pointer-lock refusals from the probe's canvas clicks |
| Dev-server diagnostic (real engine, `__nrvnaverse` handle) | at placement the 9 Hub state-B components are `visible: false` (hidden on stage), zones bound, beats pending; after 2.5 s the wake had applied — the mechanism works in the real engine; the "already lit" first screenshots were the reveal fade outlasting a 0.6 s beat (hence the retiming to 1.5 / 2.0 / 2.5 s) |
| Browser (checkpoint 2 bundle) | pending — rebuild running; then Club shots + `browser:perf` + `browser:touch` |

## 5. Findings worth keeping

- SIC `survey_visibility` takes `from_point` / `from_viewpoint` (not `eye`); the AWE adapter maps hidden `isSensor` meshes to `region` entities, so zones are directly queryable with `in_region`.
- SIC consumer limitation (hand back to the SIC thread): visibility surveys model every authored mesh as present; there is no way to declare runtime-hidden state (state-B geometry) so "visible when lit" and "occluded by a hidden cone" need two scene variants. A `hidden: [ids]` option on `load_scene` / `adapt_awe_scene` (or honouring `display:false` as non-occluding for visual queries) would make reactive worlds first-class.
- SIC consumer limitation: `passable` needs an entity with role `opening`; the AWE adapter has no way to mark a door gap as an opening, so door passability was proven headless instead.
- Engine: sensor EXIT after a straight vertical teleport out of a zone was flaky headless (fired after lateral teleports and more ticks); real walking is lateral, so no product impact. The character controller shoulders straight up a 0.6 m riser but jams when sliding along its face diagonally — ramps remain the rule.
- Engine: the upstream reveal fade lasts ≈1 s after placement; arrival beats under ≈1.2 s on an initial placement finish behind the fade.
- Strict typecheck programs grow through imports: excluding a file is not enough if an included test imports its importer.
- Engine `iframe` component: any URL without a protocol is prefixed `https://`, so static chunk data cannot point an in-world frame at a deployment-relative page (local / staging / production differ). The canonical site (`www.nrvnaverse.com`, Cloudflare) sends no frame directive today — observed, not relied on.
- A threshold strip inside a transit passage is crossed in ≈0.2 s at walking speed; thresholds belong where visitors stand (door fronts, bars, in front of frames). Placing the shell window inside the `!panelOpen` branch hid it on desktop (directory open by default) — now `(!panelOpen || !mode.mobile)`.
- Music chunk is at the 96-component warning line; the next Music addition must raise the warning budget (pipeline doc §16) or move geometry into a room chunk.

## 6. Continuation queue (ranked)

1. ~~Browser evidence on the checkpoint-2 bundle~~ done (`browser:perf` / `browser:touch` PASSED, Club shots).
2. ~~WEB↔SPATIAL threshold~~ done (checkpoint 3). Open: a deployment-aware URL seam so the same page can also become an in-world CSS3D surface; Eddie design notes (song → object / state; vault-as-archive) as the artist-room pattern on top of the venue template.
3. ~~Second-pass discovery~~ done (checkpoint 4). Open: a web counterpart that reads / shares the same memory shape (D-021), and the Core / atelier finds walked in a browser (the booth find is the browser-proven one; the other two share the exact same zone path).
4. Audio-reactive ambience without assets (WebAudio synthesis at app layer) if time.
5. Fashion parity, transitions, mobile comfort for new interactions, performance consolidation if measured; raise the music / fashion-culture budgets before adding geometry there.

## 7. Exact next action

Campaign complete and handed to ChatGPT for review (`handoffs/current/reviewer.md`). If resumed by an implementer before review: start from the continuation queue above (audio layer, per-song arrival states, budget raise before more geometry); do not merge or deploy.
