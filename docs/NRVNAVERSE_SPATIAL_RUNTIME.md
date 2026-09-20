# NRVNAVerse Spatial Runtime — M0 Step 2A + 2B.2 + 2B.3

| Field | Value |
|---|---|
| **Status** | VERIFIED (2026-09-19) — official AWE runtime booted from the generated **global scene**, stable-id → placement adapter, **one selectively loaded chunk** with safe transitions / rollback / latest-request-wins, gate-before-fetch, **physical portal sensors → stable-id travel (2B.3)**, tests, browser validation incl. the real avatar entering real sensor colliders |
| **App** | `apps/the-nrvnaverse` (THE NRVNAVerse, spatial interface) |
| **Builds on** | [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) (M0 Step 2B.1) · [`NRVNAVERSE_DESTINATION_MANIFEST.md`](./NRVNAVERSE_DESTINATION_MANIFEST.md) (M0 Step 1) |
| **Governing decisions** | D-002, D-004, D-006, D-010, D-013, D-014, D-016; Landmark §3, §6, §7, §9 |
| **Not in scope (M0 Step 2B.4+)** | prefetch / chunk cache / neighbour warming, budgets, mobile/adaptive quality, async mutation-queue shutdown hardening (2B.4); age verification / compliance policy; hosting-level protection of gated chunk URLs; portal art |

M0 is **not** complete after Step 2B.3; the Landmark stays at v0.1. No new architectural decision was needed — D-004, D-006, D-013 and D-016 govern this work.

History: Step 2A (branch `feat/m0-spatial-runtime`) mounted the official runtime on the full compatibility scene with same-scene teleports. Step 2B.1 generated the global scene, chunk files and spatial index. Step 2B.2 (branch `feat/m0-chunk-runtime`) replaced the full-scene runtime with global scene + one active chunk. **Step 2B.3 (branch `feat/m0-portals`) added physical portal sensors that route a stable destination id into the same `travelToDestination()` path** (§13). Sections marked *(2A, unchanged)* still describe the current code.

---

## 1. What runs (2B.2)

```
boot ─ load destinations.json ─▶ resolvingDestination ─ parse ?destination= ─▶ loadingGlobals
   ─ load spatial-index.json ─ mount official AWE from spatialIndex.globalSceneUrl (hidden)
   ─▶ adapter.travelTo(requested): manifest gate → placement → chunk orchestrator
   ─▶ loadingChunk(initial): fetch + validate + stage the ONE required chunk → teleport
   ─▶ reveal ─▶ ready | gateRequired(at Hub) | error

ready | arrived | gateRequired ─ directory click / back-forward / PHYSICAL PORTAL ENTER ─▶ traveling
   ─ same chunk ────────────────────────────────────────────────▶ arrived
   ─ other chunk ─▶ loadingChunk(travel) ─ stage target while old chunk lives ─ teleport ─ retire old ─▶ arrived
   ─ gate / failure / unavailable ──────────────────────────────▶ gateRequired | ready(+notice)
   ─ newer request ─▶ superseded (state untouched; the newer request owns the outcome)

committed arrival (initial, directory, history, portal) ─▶ PortalController.activate(activeChunkKey)
   ─ same chunk ─▶ no-op            ─ other chunk ─▶ unbind old sensors, bind the new chunk's portals
player enters a bound sensor (official Component3D.onSensorEnter, other === avatar)
   ─▶ componentId → destinationId ─▶ travelToDestination(destinationId)   (the very same path as above)
```

The runtime **never requests `/data/static-scene.json`** any more (tested by source scan and by a fake-runtime boot test); that file remains a generated artifact for validation/debugging only.

| Layer | File | Knows coordinates? | Knows engine objects? |
|---|---|---|---|
| Engine mount + low-level component ops (official upstream lifecycle) | `src/lib/spatial/awe-spatial-runtime.ts` (`AweSpatialRuntime`) | receives spawns to teleport to | **yes — the only file** that imports `@oncyberio/engine`; `Component3D` handles never leave it |
| Runtime seam | `src/lib/spatial/spatial-runtime.ts` (`SpatialRuntime`, `ChunkRuntime`, opaque `ChunkBatch`) | — | — |
| Pure batch instantiation helper | `src/lib/spatial/component-batch.ts` (`createComponentBatch`) | no | generic `T` |
| Chunk payload validation | `src/lib/spatial/chunk-payload.ts` (`parseChunkPayload`) | scene geometry passes through | no |
| Chunk data source | `src/lib/spatial/chunk-data-source.ts` (`ChunkDataSource`, `FetchChunkDataSource`, `StaticChunkDataSource`) | no | no |
| **Chunk orchestrator** | `src/lib/spatial/chunk-orchestrator.ts` (`ChunkOrchestrator`) | chunk keys + spawns | opaque batches only |
| Pure player-enters-sensor helper (2B.3) | `src/lib/spatial/sensor-subscription.ts` (`subscribePlayerEnterSensor`) | no | generic `C` |
| **Portal controller** (2B.3) | `src/lib/spatial/portal-controller.ts` (`PortalController`) | no — `componentId → { chunkKey, destinationId }` only | no (`SensorRuntime` seam) |
| **Spatial adapter** (gates, destination → placement) | `src/lib/spatial/awe-spatial-adapter.ts` (`AweSpatialAdapter`) | reads the registry; exposes only `{ worldId, placementRef }` outward | no |
| Placement registry (from the generated index) | `src/lib/spatial/placement-registry.ts`, `spatial-index.ts`, `spatial-index-source.ts` | **yes** | no |
| Application state (pure) | `src/lib/app-state.ts` | no | no |
| Orchestration / URL / boot | `src/lib/app-store.ts` | no | no (holds the runtime behind `BootableRuntime`) |
| Instrumentation | `src/lib/perf.ts` | no | no |

UI components receive `AppState` only; nothing above the runtime file sees a `Space` or a `Component3D`.

## 2. Official AWE runtime mount *(2A, unchanged except where noted)*

`AweSpatialRuntime` is adapted from `examples/starter` (`game-script.ts` + `utils.ts` + `game-canvas.tsx`, plus the official `touch-joystick.tsx` / `jump-button.tsx` copied verbatim). Upstream lifecycle is preserved: `Engine.getInstance().createSpace()` → player lookup → `createInputs` / `ThirdPersonCameraRig` / `Mover` / `createMoverAnimStateMachine` → `reveal()` → `space.start()` → `dispose()`; `onFixedUpdate` drives input, mover and animation exactly as the starter does. One engine instance, one space; React Strict Mode is handled with the starter's "dispose only after load" guard.

Deliberate deviations from the starter (documented in the file header):

1. **(2B.2)** `init({ sceneUrl })` loads the **global scene** (`spatialIndex.globalSceneUrl` → `/data/spatial/global-scene.json`: avatar, VRM animations, lighting, background, envmap, fog, ground). `sceneUrl` is required; there is no default scene URL in the runtime any more.
2. `init()` does **not** reveal. The application reveals only after the initial chunk and placement (or gate refusal + Hub fallback) are settled, so the world is never shown at the wrong place or without ground geometry.
3. No "click to start" screen and no pause toggle; the space starts on reveal. Pointer lock still engages on the first canvas click through the upstream Mediator; Esc releases it.
4. `placeVisitor(spawn)` — teleport through `Mover.teleport()` (official rigid-body teleport, velocity cleared) followed by `ThirdPersonCameraRig.reset()`.
5. **(2B.2)** `stageChunk(payload, signal)` / `retireChunk(batch)` — thin wrappers over the official `space.components.create(data, { abort })` and `space.components.destroy(component)`. Staging is all-or-nothing through `createComponentBatch`; the runtime keeps a private `Map<ChunkBatch, Component3D[]>` and callers only ever hold the opaque `ChunkBatch { chunkKey, componentIds }`. `retireChunk` is idempotent per batch and throws only after attempting every component. `dispose()` drops the batch handles (the space destroys the components).
6. Canvas resize also listens to a `ResizeObserver` on the container.
7. `tsconfig.json` keeps the starter's `strict: false`; NRVNAVerse-owned pure modules are strict via `tsconfig.strict.json` (part of `pnpm --filter the-nrvnaverse check`). `awe-spatial-runtime.ts`, `app-store.ts` and `test/app-store.test.ts` are excluded from the strict pass because they (transitively) pull engine sources in; the base `tsc --noEmit` still checks them.
8. **(2B.3)** `onPlayerEnterSensor(componentId, cb)` — resolves the staged component through the official `ComponentManager.byInternalId`, requires `component.collider.isSensor === true`, subscribes with the official `Component3D.onSensorEnter`, and invokes `cb` only when `event.other` is the player's `AvatarComponent`. Returns an idempotent unsubscribe that is safe after the component was destroyed with its chunk. Portal-neutral: it knows component ids, never destination ids.

Assets: the 17 starter animation clips (`public/assets/anims/*.json`) and upstream CDN assets. No new binaries, no Ghost assets.

Movement suppression during a transition was **not** needed: staging happens while the old chunk is alive, and teleport → commit → retire run synchronously in one task, so there is no frame in which the visitor stands in a half-built world.

## 3. Chunk payload source and validation (2B.2)

- `ChunkDataSource.load({ chunkKey, dataUrl, signal })` returns raw JSON. `FetchChunkDataSource` fetches `dataUrl` with the `AbortSignal`; `StaticChunkDataSource` (tests/tooling) serves in-memory entries, models a 404 for a missing key, lets an entry throw / reject / observe the signal, and records every request.
- The URL always comes from `spatialIndex.chunks[chunkKey].dataUrl`. No chunk path is hard-coded in runtime logic (tested by source scan).
- `parseChunkPayload(raw, { worldId, chunkKey })` rejects with a stable `ChunkPayloadError.code`: `not-an-object`, `unsupported-schema-version`, `world-id-mismatch`, `chunk-key-mismatch` (a mis-served file, or a payload for another chunk), `invalid-components` (not an object), `invalid-component` (record not an object / missing or empty `type`), `component-id-mismatch` (record `id` ≠ key). It looks for no identity or gate data (chunk files carry none). Component-specific fields are left to the engine factories.
- Validation runs **before** any engine mutation, while the previous chunk is still alive — a malformed target never costs the current world.
- No third-party validator was added.

## 4. Chunk orchestrator (2B.2)

`ChunkOrchestrator({ runtime, chunkSource, worldId, chunks })` owns exactly one active chunk (`activeChunkKey`) and every transition. `transitionTo({ chunkKey, spawn, destinationId, onLoadingChunk })` never throws; it resolves to

| Result | Meaning |
|---|---|
| `{ status: "arrived", kind: "same-chunk" }` | teleport only |
| `{ status: "arrived", kind: "cross-chunk", cleanupError? }` | target staged, visitor placed, target committed; `cleanupError` set only when the old chunk could not be fully retired (target stays active) |
| `{ status: "superseded" }` | a newer request replaced this one; nothing was moved, committed or destroyed for it (any components it had created were retired) |
| `{ status: "failed", step: "fetch" \| "validate" \| "stage" \| "place", reason }` | the active chunk and the visitor are exactly where they were |

**Exact cross-chunk order** (the adapter has already passed the manifest gate before calling):

1. bump the request generation, abort the previous request's `AbortController`
2. `onLoadingChunk()` (adapter emits `loadingChunk`; store enters the `loadingChunk` phase)
3. **fetch** `chunks[chunkKey].dataUrl` with the signal — old chunk untouched
4. confirm current
5. **validate** (`parseChunkPayload`) — old chunk untouched
6. confirm current
7. acquire the **mutation lock** (promise-chain mutex: stage / commit / rollback are single-writer; fetches may overlap and cancel freely)
8. confirm current
9. **stage**: `runtime.stageChunk(payload, signal)` creates every target component **while the old chunk remains alive** (all-or-nothing)
10. confirm current — if stale, retire the just-created batch and return `superseded`
11. **teleport** `runtime.placeVisitor(spawn)` — both chunks alive; on throw: retire the target, keep the old chunk and position, return `failed(place)`
12. **commit**: target becomes `active`
13. **retire** the old batch (`runtime.retireChunk`); on throw: warn, report `cleanupError`, keep the target active — the visitor is never rolled back after a successful placement
14. release the lock → `arrived`; the adapter emits `arrived`, the store settles state, then writes the URL

**Same-chunk travel** (target `chunkKey === activeChunkKey`): the generation is still bumped (it supersedes any in-flight cross-chunk work), then `placeVisitor(spawn)` only — no fetch, no create/destroy, no `loadingChunk`, no lock. Music District → Placeholder Artist and Fashion / Culture District → Placeholder Brand are same-chunk.

**Latest request wins.** A monotonically increasing `generation` plus one `AbortController` per request. The signal cancels the fetch and is passed into `ComponentManager.create` (which resolves `null` when aborted), but it is not relied upon alone: `isCurrent()` is re-checked after every `await` and before every teleport / commit / destroy. A stale request can therefore never teleport, replace `activeChunkKey`, destroy the current chunk, or (via the store) update the URL or application state. An aborted fetch / creation is reported as `superseded`, never as a user-facing failure.

**Disposal** (`dispose()`): mark disposed, bump the generation, abort the controller, retire the active chunk. A transition still inside `stageChunk` observes the abort / bumped generation when it settles and retires its own batch; further `transitionTo` calls fail structurally. The store calls this **before** `runtime.dispose()`.

**No prefetch, no cache.** The only reuse is the already-active-chunk check; rapid A→B→A re-fetches A (see performance). Neighbour/predictive prefetch and cache infrastructure are Step 2B.4.

## 5. Component batch helper (2B.2)

`createComponentBatch(records, { create, destroy }, signal)` is engine-agnostic: the real runtime binds it to the official create/destroy, tests bind fakes. It creates all records in parallel (`Promise.allSettled`), and if **any** creation rejects, resolves `null` (the official aborted answer) or the signal is aborted, it destroys every component that was created and rejects (`AbortError` when aborted, otherwise `ComponentBatchError` listing the failures, including cleanup failures — cleanup itself never throws). Success returns the components in record order.

## 6. Adapter behaviour (`AweSpatialAdapter`, `name: "awe-spatial-adapter"`)

| Call | Behaviour |
|---|---|
| `canTravel(id)` → `TravelEligibility` | unknown id → `unknown-destination`; non-public status → `not-public`; **`gates.length > 0` → `gate-required` (evaluated before placement, before readiness and before any fetch)**; no registry entry → `unplaced`; orchestrator missing or runtime not ready → `unavailable`; otherwise `allowed`. Never throws. |
| `resolvePlacement(id)` | registry lookup → `resolved { worldId, placementRef }` or `unplaced`. Moves nobody, fetches nothing. |
| `travelTo(id)` | emits `traveling`; re-runs `canTravel`; on `allowed` resolves `{ chunkKey, spawn }` and calls `orchestrator.transitionTo` (emitting `loadingChunk` only when real cross-chunk work starts) → `arrived` / `failed` / **`superseded`** (no further phase: the newer request owns the stream); gate → `gateRequired` + `gate-required { gates }`. Records a `travel` perf measurement with the outcome. |
| `onPhase(listener)` | subscription with unsubscribe; `dispose()` clears listeners and detaches the orchestrator (further travel → `unavailable`). |
| `activeChunkKey` | diagnostics only. |

Interface change in 2B.2 (`packages/nrvna-manifest/src/spatial-adapter.ts`, NRVNAVerse-owned): `TravelResult` gained `{ status: "superseded"; destinationId }`; `SpatialTravelPhase.loadingChunk` is now reported. `PlannedSpatialAdapter` is unchanged.

## 7. Gate-before-fetch (D-006, Landmark §9)

For the 21+ Cannabis District and NRVNA Farms Placeholder (manifest `gates: [{ kind: "age21", … }]`):

- `canTravel` → `gate-required` **before** the orchestrator is consulted, so `chunks/cannabis-21.json` is never requested: not on an initial gated deep link, not on a directory click, not on back/forward to a gated URL. Tested at adapter level (source request log empty, no cannabis component in the fake world), at store level for all three paths, and in the browser (network resource list).
- Initial gated deep link: engine boots from the global scene → gate refused → **Hub chunk** fetched as the fallback → visitor placed at the Hub → reveal → app `gateRequired` for the requested destination; the URL still names the gated destination (reload reproduces the refusal).
- In-app click / history navigation: `gateRequired`, visitor and active chunk unchanged, URL unchanged.
- The manifest's placeholder `enforced: false` is deliberately **not** consulted (tested): declaring a gate is enough to stop spatial entry. No age verification, jurisdiction logic, "I am 21" bypass or fake gate pass exists.
- Known non-M0 limitation: `public/data/spatial/chunks/cannabis-21.json` is a statically served file. "Never fetched before the gate" is an **application-layer** guarantee; hosting/server-side enforcement of gated chunk URLs is a later decision.

## 8. Application state and URL contract

Implemented phases: `boot`, `resolvingDestination`, `loadingGlobals`, **`loadingChunk`**, `ready`, `traveling`, `arrived`, `gateRequired`, `error`. `PLANNED_PHASES` is now empty. `loadingChunk` has two stages: `initial` (boot: engine up, first chunk loading, still hidden) and `travel` (`traveling` → `loadingChunk` when the adapter reports real cross-chunk work for the current target; carries `current`/`placement` because the visitor has not moved). Same-chunk travel and gate refusals never enter it. A stale `loadingChunk` report (destination ≠ current target) changes nothing.

Travel may start from `ready | arrived | gateRequired` **and** from `traveling | loadingChunk(travel)` — the new request supersedes the old one (`canBeginTravel`). The store keeps its own request sequence: only the newest request may apply a result or write the URL, independent of what the adapter returns; a `superseded` result leaves the state untouched by construction (`withTravelResult`). Cross-chunk failure returns to `ready` at the unchanged `current` with a `travel-failed` notice. Initial chunk failure falls back to the Hub chunk with a notice; if the Hub cannot load either, the app enters `error` and does **not** reveal a half-loaded world.

URL: on committed arrival the store writes `?destination=<stable-id>&from=spatial[&ref=…]` via `buildDeepLinkQuery`; failed, gated or superseded travel writes nothing; browser back/forward travels through the same orchestrated path without adding history and obeys latest-request-wins; `?chunk=` is ignored on input and never written; no chunk key, placement ref or coordinate ever appears in a URL (tested at URL-contract and store level).

The directory no longer disables links while a travel is in flight; clicking during a transition is the intended way to supersede it.

## 9. Instrumentation

`perf.ts` (`performance.mark/measure`, `nrvna:` prefix, in-memory list + dev console, nothing POSTed). Measured now: `boot→engine-ready`, `boot→revealed`, `travel` (per attempt: `destinationId`, `outcome` ∈ arrived / gate-required / failed / unavailable / **superseded**, `kind`), and per chunk transition `chunk-fetch`, `chunk-validate`, `chunk-stage` (`chunkKey`, `outcome` ok / failed / superseded, staged component count), `cross-chunk-travel` (outcome arrived / superseded / `failed:<step>`) and `same-chunk-travel`. Detail never contains a coordinate; chunk keys appear as diagnostics only.

**Baseline (2026-09-19, Windows 10, Next dev server, Turbopack, warm, foreground tab, 7-component chunks of 5–8 KB):**

| Measurement | Warm dev-server value |
|---|---|
| `boot→engine-ready` / `boot→revealed` | first load after the code change was a cold Turbopack recompile (27.2 s / 30.0 s); Step 2A's warm figures (≈2 s / ≈4.7 s incl. the upstream intro) are the expected steady state — re-measure in a warm session |
| initial Hub chunk (fetch / validate / stage / total) | 40 ms / 1 ms / 52 ms / 99 ms (first chunk also warms the mesh/text factories) |
| Hub → Music cross-chunk | fetch 78 ms · validate 0.1 ms · stage 12 ms · total 95 ms |
| Music → Fashion, Fashion → Brand (history), Music (history) | fetch 10–66 ms · validate ≈0 ms · stage 8–14 ms · total 21–31 ms |
| same-chunk travel (Music District → Artist, Fashion → Brand) | 0.1 ms orchestrator, 15–21 ms end-to-end `travel` |
| superseded requests during rapid A→B→C→D | fetches aborted after ≈20 ms; superseded `travel` 16–40 ms; winner arrived normally |
| gate refusal | 0 ms |

## 10. Tests (`pnpm --filter the-nrvnaverse test` — 126 tests, was 69)

- `test/chunk-payload.test.ts` — every generated chunk parses; fresh copy in authored order; rejection of non-object, unsupported schema, wrong world, wrong/mis-served chunk key, malformed components (array, null, string record, missing/empty type, id mismatch); chunk files carry no identity/gate data.
- `test/component-batch.test.ts` — order preserved; partial failure destroys what was created and reports which record failed; `null` treated as failure; pre-aborted signal creates nothing; mid-flight abort rolls back with `AbortError`; cleanup failures are reported, never thrown.
- `test/chunk-orchestrator.test.ts` (fake `ChunkRuntime` + `StaticChunkDataSource`) — Music first loads Music only; same-chunk travel neither fetches nor rebuilds; same-chunk teleport failure; undeclared chunk key; **order**: stage while old alive → place → retire (no destroy before the teleport); cleanup failure after arrival keeps the target; 404 / network error / malformed payload (5 variants) leave the old chunk and log untouched; partial creation cleaned (6 created, 6 destroyed, old intact, no teleport); teleport failure retires the target and keeps the old; stale request cannot teleport/commit/destroy and the single-writer lock delays B's staging until A settles; stale fully-created batch retired; rapid A→B→C ends at C with one batch and one teleport; aborted fetch → `superseded`; same-chunk request supersedes an in-flight cross-chunk one; disposal aborts, retires and refuses.
- `test/spatial-adapter.test.ts` — registry/eligibility as before, now through an orchestrator; first travel `traveling → loadingChunk → arrived`; same-chunk phases without `loadingChunk`; **gate before fetch** (no request, no teleport, no cannabis component, `enforced:false` not a permission); failures/unavailable; superseded phase stream; disposal.
- `test/app-store.test.ts` (fake bootable runtime + fake `window`) — boot from `globalSceneUrl`; no source references `static-scene` or a chunk path; Hub direct / Music / Artist / Fashion / Brand deep links request exactly one chunk; unknown → Hub; gated deep links → no cannabis request, Hub fallback, `gateRequired`, URL untouched, revealed; both-fail → `error` without reveal; requested-fails → Hub with notice; Hub → Music retires Hub then writes the URL; `loadingChunk` only for cross-chunk; Fashion → Cannabis gate; failed travel keeps current usable, no URL; rapid A→B→C latest wins with one URL write; late superseded result cannot overwrite; back/forward (incl. gated history entry) and rapid back/forward; no chunk/coordinate in URLs; disposal aborts pending work, retires, unsubscribes, destroys.
- `test/app-state.test.ts` — phases incl. `loadingChunk(initial|travel)`, supersession from in-flight travel, stale `loadingChunk` ignored, `superseded` result leaves state.
- Existing `spatial-pipeline`, `spatial-index`, `url-contract` suites unchanged.

The real engine is exercised only in the browser; every concurrency/rollback test runs against the deterministic fakes in `test/support/`.

## 11. Browser validation (2026-09-19, Chrome, `next dev` on `localhost:3000`)

Requests were read from the page's own `performance.getEntriesByType("resource")` (the extension's network panel missed same-origin fetches); component liveness from `space.components.byId` via the dev-only `__nrvnaverse` handle.

| Check | Result |
|---|---|
| A Hub direct load | `/api/destinations`, `/data/spatial/spatial-index.json`, `/data/spatial/global-scene.json`, `/data/spatial/chunks/hub.json` — **no** `static-scene`, no music/fashion/cannabis chunk; Hub platform/marker/label rendered on the global ground; active chunk `hub` |
| D Hub → Music | `music.json` fetched, arrived, URL `?destination=<music>&from=spatial`, Hub components gone (`platform-hub`, `label-hub`, `path-west` absent; 14 components = 7 global + 7 music), 1 batch held |
| E Music District → Placeholder Artist | no second `music.json`, same components, avatar at (−70, 1, −34) |
| F Music → Fashion | `fashion-culture.json` fetched, Music retired, Fashion active |
| G Fashion → Cannabis | `gateRequired` banner, **no cannabis request**, Fashion components intact, URL unchanged |
| K rapid Hub→Music→Artist→Brand (same tick) | three `superseded` travels (fetches aborted ≈20 ms), Brand same-chunk arrival, world = 14 components, single batch; rapid Music→Hub→Music ended at Music with one arrival |
| J back / forward | back Music → Brand: cross-chunk, no history entry; forward and back+forward overlaps ended consistent with the final URL |
| M | no `?chunk=` ever written (all URLs `?destination=<id>&from=spatial`) |
| N | no request or source matching `ghost` |
| B Music deep link | (headless Chrome, see note) `/api/destinations`, index, global scene, **`music.json` only** — no Hub chunk; ready at Music District, active `music`, 14 components |
| C Artist deep link | `music.json` only; ready at Placeholder Artist, avatar at (−70, ·, −34) |
| H initial Cannabis deep link | **no cannabis request**; `hub.json` loaded as fallback; `gateRequired` banner for the 21+ Cannabis District; visitor at the Hub; 12 components (7 global + 5 hub); URL still names the gated destination |
| I reload at Placeholder Artist | reload requests exactly index, global scene, `music.json` again; ready at the Artist |
| L WASD after Hub → Music → Artist → Fashion → Hub | all four arrivals; W held 700 ms moved the avatar 1.25 m on −Z on the Hub platform (SwiftShader software rendering, ≈2 fps, hence the short distance); final world 12 components, only `hub.json` fetched twice (no cache by design) |

Note on the tool: the Claude-in-Chrome tab used for A–K went to the background mid-session (the user's Chrome window switched tabs), which stalls `requestAnimationFrame` and trips the upstream 60 s `LOAD_TIMEOUT` (known Step 2A behaviour). B, C, H, I and L were therefore executed in a throw-away **headless Chrome** (`--headless=new`, SwiftShader) driven over raw CDP from a dependency-free Node script (`Runtime.evaluate` probes, trusted `Input.dispatchKeyEvent` for WASD) against the same dev server; rAF runs there, so the engine boots normally (≈41–48 s cold in software rendering).

## 12. What remains for M0 Step 2B.4+

- **2B.4 — hardening / performance / mobile / disposal**: neighbour prefetch / cache policy over the orchestrator, budgets, mobile/adaptive quality, and the carried shutdown note: `disposeApp` still does not await the orchestrator's mutation queue before `runtime.dispose()` destroys the Space (a transition inside `stageChunk` at unmount observes the abort/bumped generation when it settles; not expanded here because portals exposed no new reproducible regression).
- Real gate flow design (verification provider seam, jurisdiction policy at the content layer, server-side protection of gated chunk URLs) — still no compliance claims.
- Decide how (or whether) Ghost's experimental chunk manager / portal component inform a later generic primitive — read-only until his review (D-013).
- Replace prototype geometry and portal visuals only when a world-layout decision is made (human review, governance rule 9).

## 13. Physical portals (M0 Step 2B.3)

**Architecture — one contract only:**

```
physical sensor component (mesh, collider { enabled, FIXED, CUBE, isSensor: true }, owned by ONE chunk)
   ─ official Component3D.onSensorEnter, other === player avatar ─▶ AweSpatialRuntime.onPlayerEnterSensor
   ─▶ PortalController: componentId ──generated index `portals`──▶ destinationId
   ─▶ travelToDestination(destinationId)          ← the existing entry point; nothing portal-specific after this
```

A portal never fetches a chunk, knows a spawn, teleports, mutates the URL, evaluates a gate or creates/destroys components — those responsibilities already exist downstream. Component ids, positions, chunk keys and colliders are not identity (D-004); the target is always the canonical stable id, resolved through the manifest (gates, D-006) and the placement registry at travel time. No engine-level `portal` component was needed; Ghost's experimental portal component, `PORTAL_OPEN` event, coordinate-keyed `portals-index.json` and portal directory were not read, copied or adapted (D-013). `packages/engine`, `engine-edit`, `studio` are untouched.

**The exact seven M0 portal bindings** (authoritative: `spatial/source/spatial-config.m0.json` `portals[]`; generated: `public/data/spatial/spatial-index.json` `portals`):

| Physical component id (owner chunk) | Trigger | Target stable id |
|---|---|---|
| `portal-hub-music` (hub) | Hub → Music District | `dst_gm3xs4a3tws7bgh3` |
| `portal-hub-fashion` (hub) | Hub → Fashion / Culture District | `dst_9c4wxtpec8awsx1q` |
| `portal-hub-cannabis` (hub) | Hub → 21+ Cannabis District (gated) | `dst_441dtdafq3e3ehjn` |
| `portal-music-hub` (music) | Music District → Hub | `dst_7g19n1vm9ackw8a0` |
| `portal-music-artist` (music) | Music District → Placeholder Artist (same chunk) | `dst_1qtfn9qjg9kf6jyd` |
| `portal-fashion-hub` (fashion-culture) | Fashion / Culture District → Hub | `dst_7g19n1vm9ackw8a0` |
| `portal-fashion-brand` (fashion-culture) | Fashion / Culture District → Placeholder Fashion / Culture Brand (same chunk) | `dst_tgfh5h5jvm3wj0w7` |

No eighth portal; `cannabis-21` owns none; NRVNA Farms stays reachable through the directory / deep link. The sensors are plain translucent cyan box meshes (`opacity 0.35`, `script.tag: "m0-portal"`, no shaders, particles, animation or assets): 1 × 3 × 14 panels on the platform edges facing the neighbouring district and 6 × 3 × 1 panels on the north side towards the sub-destination; none overlaps a spawn of its chunk (tested), so an arrival never re-triggers.

**Chunk ownership.** Each sensor is listed in its chunk's `componentIds`, so it is staged and retired with that chunk by the unchanged orchestrator; there are no globally persistent portals. The chunk payloads gained the sensor geometry only — no `destinationId`, target URL, gate or metadata (tested). The binding lives in the generated index; gate truth stays in the manifest.

**`PortalController` lifecycle** (`src/lib/spatial/portal-controller.ts`, constructed in `app-store.ts` after destination data, the spatial index, the runtime and the orchestrator exist, with `onPortalEntered: (id) => travelToDestination(id)` injected — no circular module):

| Moment | Action |
|---|---|
| initial ungated load | initial chunk committed → adapter emits `arrived` → `syncPortals()` → `activate(activeChunkKey)` → reveal |
| initial gated deep link | Cannabis refused (no fetch) → Hub fallback committed → `activate("hub")` → reveal; app stays `gateRequired` |
| cross-chunk arrival | previous bindings released (their components were already retired — unsubscribe is safe after disposal) → the new chunk's portals bound |
| same-chunk arrival | `activate` with the already active key → no-op (no duplicate listeners, no rebind) |
| failed / gated / superseded travel | no `arrived` → bindings untouched (still valid: the active chunk did not change) |
| `disposeApp()` | `portals.dispose()` runs **before** `orchestrator.dispose()` / `runtime.dispose()` |

A portal that cannot be bound (unknown / non-sensor component) is reported via `warn` and skipped; activation never influences a travel outcome and never throws into the travel path.

**Trigger semantics.** SENSOR ENTER only (never STAY, no timer): one physical entry → one `travelToDestination` call, deferred to a microtask so the request starts after the engine's frame update rather than inside the sensor emit. Non-player intersections are ignored. The gated Hub → Cannabis portal is not special-cased: it routes its stable id, the adapter answers `gate-required` before any fetch, the visitor stays in the Hub inside the sensor, the sensor stays bound, and only leaving and re-entering produces another request. No "I am 21" bypass exists. Concurrency is entirely the existing store/orchestrator machinery: a portal entered during an in-flight travel supersedes it (tested); there is no portal-specific cancellation, cooldown or reducer.

**URL / history.** Portal arrival writes exactly what directory travel writes (`buildDeepLinkQuery` → `?destination=<stable-id>&from=spatial`); gated refusal writes nothing; `?portal=`, `?chunk=`, component ids and coordinates never appear (tested at store level and observed in the browser).

**Diagnostics.** `spatialDiagnostics` gained `boundPortals` and `lastPortal { componentId, destinationId }` (dev panel: "bound portals: n · last portal: … → dst_…"); the dev-only `__nrvnaverse` handle exposes the controller. Sensor-enter → adapter `traveling` overhead measured in the browser: **≈ 9 ms** under SwiftShader at ≈2 fps (microtask + store `beginTravel`), negligible against the 20–450 ms chunk transition.

**Tests (177 app tests, was 126; 56 manifest tests unchanged).** `spatial-pipeline` (+16): seven bindings, deterministic index section, ownership by declared chunk, identity-free chunk payloads, no coordinates/gates in bindings, gated / same-chunk / shared targets allowed, no spawn overlap, optional-additive without `portals`, and rejection of non-array / malformed / unknown-field / missing-duplicate component / unknown component / global component / chunk mismatch / unknown chunk / non-sensor / malformed-unknown-non-NRVNAVerse-wrong-world destination. `spatial-index` (+4): parses seven bindings, missing field → empty set, malformed rejected, store wiring source scan. `sensor-subscription` (6): once per player entry, non-player ignored, unknown / non-sensor fail clearly, idempotent unsubscribe, safe after disposal, disposed runtime holds nothing. `portal-controller` (11): Hub 3 / Music 2 / Fashion 2 / cannabis 0, same-chunk no-op, chunk switch releases, bind failure warned, exact stable id routed once on a microtask, non-player ignored, gate not special-cased, async callback without spam, rejected/throwing callback reported, no coordinates, disposal. `app-store` (+13): bound before reveal; Hub → Music / Music → Artist / Music → Hub / Hub → Fashion / Fashion → Brand / Fashion → Hub through the real sensor seam of the fake runtime with the same state/URL as directory travel; Hub → Cannabis `gateRequired` with **no** cannabis request and no URL write; usable after refusal incl. re-entry; gated deep-link fallback binds Hub portals; directory + history still work and re-sync portals; portal during in-flight travel supersedes; failed portal travel keeps bindings; URLs never carry portal/chunk/component ids; disposal order. Two pre-existing assertions were made data-derived (Music chunk now has 9 components; the Hub is a portal target) — nothing was weakened.

**Browser validation (2026-09-19, headless Chrome `--headless=new` + SwiftShader over raw CDP against the running `next dev`; the avatar was driven with trusted `Input.dispatchKeyEvent` WASD into the real sensor colliders — no check called the portal callback directly):**

| Check | Result |
|---|---|
| A Hub direct load | `hub.json` only; 15 components (7 global + 8 hub); `byTag("m0-portal")` = the 3 Hub portals, each `collider.isSensor === true`; bound portals 3; screenshot shows the translucent panels |
| B walk west into `portal-hub-music` | sensor fired after ≈4 s of walking; `music.json` fetched; Hub retired (`platform-hub` gone, 16 = 7 + 9 music); active `music`; URL `?destination=<music>&from=spatial`; bound 2; last portal `portal-hub-music`; overhead 8.9 ms |
| C walk north into `portal-music-artist` | same Music chunk (music fetch count still 1); avatar at the Artist spawn; URL names the Artist |
| D `portal-music-hub` (after a directory click to the Music spawn) | Hub loaded, Music retired |
| E `portal-hub-fashion` | Fashion loaded |
| F `portal-fashion-brand` | same-chunk teleport, no refetch / rebuild of Fashion (fashion fetch count 1) |
| G `portal-fashion-hub` (after a directory click to the Fashion spawn) | Hub loaded |
| H `portal-hub-cannabis` | `gateRequired` banner; visitor inside the sensor in the Hub; active `hub`; URL still the Hub; **cannabis fetch count 0** throughout the whole session |
| I after refusal | walked out (momentum had carried the avatar to the far side, so walking back crossed the sensor once more → one more refusal, still no fetch), then west into `portal-hub-music` → Music |
| J directory after portal travel | three directory clicks arrived normally and re-synced the bindings |
| K back / forward after portal travel | back → Music, forward → Hub, bindings followed |
| L WASD / camera / canvas | every walk moved the avatar; rAF alive (2 frames / 500 ms under SwiftShader); canvas focus click works (headless cannot pointer-lock: the only non-upstream console item is that `WrongDocumentError`, pre-existing) |
| M | every URL observed: `?destination=dst_…&from=spatial` or empty; no `?chunk=`, `?portal=`, component id or coordinate |
| N | no request or source matching `ghost` |
