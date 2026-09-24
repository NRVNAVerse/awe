# NRVNAVerse Spatial Runtime — M0 Step 2A + 2B.2 + 2B.3 + 2B.4A + 2B.4B + 2B.4C (+ post-M0 input hardening, §16.7)

| Field | Value |
|---|---|
| **Status** | VERIFIED (2026-09-19) — global-scene boot, stable-id → placement adapter, one selectively loaded chunk with safe transitions / rollback / latest-request-wins, gate-before-fetch, physical portal sensors → stable-id travel (2B.3), **hardened lifecycle / asynchronous shutdown (2B.4A, §14)**, **content-addressed immutable delivery of the global scene and chunks (digest in the file name) behind a revalidated spatial-index version root (2B.4B, §15; the query-only form was rejected in review and corrected)**; tests + browser validation incl. the real avatar entering real sensor colliders, a real teardown / re-boot cycle and a production-server cache check |
| **App** | `apps/the-nrvnaverse` (THE NRVNAVerse, spatial interface) |
| **Builds on** | [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) (M0 Step 2B.1) · [`NRVNAVERSE_DESTINATION_MANIFEST.md`](./NRVNAVERSE_DESTINATION_MANIFEST.md) (M0 Step 1) |
| **Governing decisions** | D-002, D-004, D-006, D-010, D-013, D-014, D-016; Landmark §3, §6, §7, §9 |
| **Not in scope** | age verification / compliance policy; hosting-level protection of gated chunk URLs; portal art; adaptive quality (**deferred to the first representative art slice, §16.5**); real-device validation (§16.1). **Correctness / lifecycle / shutdown hardening is done (2B.4A, §14); the performance step is done as HTTP delivery only (2B.4B, §15) — an application chunk cache, prefetch and neighbour warming were measured and rejected for M0; the mobile shell correction and warning-only budgets are done (2B.4C, §16)** |

M0 Foundation is complete at Landmark v0.2 (`nrvna/integration@3fe4f78`). The input work documented in §16.7 is post-M0 hardening; it does not reopen M0 or define M1. No new architectural decision was needed — D-004, D-006, D-009, D-013 and D-016 govern this work.

History: Step 2A (branch `feat/m0-spatial-runtime`) mounted the official runtime on the full compatibility scene with same-scene teleports. Step 2B.1 generated the global scene, chunk files and spatial index. Step 2B.2 (branch `feat/m0-chunk-runtime`) replaced the full-scene runtime with global scene + one active chunk. Step 2B.3 (branch `feat/m0-portals`) added physical portal sensors that route a stable destination id into the same `travelToDestination()` path (§13). **Step 2B.4A (branch `feat/m0-hardening-correctness`) hardened the lifecycle: an asynchronous orchestrator shutdown contract, boot/dispose coordination with an explicit run state, boot-failure recovery, and stale-portal-microtask protection (§14).** **Step 2B.4B (read-only audit 2B.4B.1, then branch `feat/m0-http-cache-delivery` for 2B.4B.2) made the physical artifacts content-addressed and immutable behind the revalidated spatial index (§15; a first query-token version was corrected after independent review) — no runtime module changed behaviour.** Sections marked *(2A, unchanged)* still describe the current code.

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

`AweSpatialRuntime` is adapted from `examples/starter` (`game-script.ts` + `utils.ts` + `game-canvas.tsx`, plus the official `touch-joystick.tsx` / `jump-button.tsx` copied verbatim; both now delegate pointer ownership as described in §16.7). Upstream lifecycle is preserved: `Engine.getInstance().createSpace()` → player lookup → `createInputs` / `ThirdPersonCameraRig` / `Mover` / `createMoverAnimStateMachine` → `reveal()` → `space.start()` → `dispose()`; `onFixedUpdate` drives input, mover and animation exactly as the starter does. One engine instance, one space; React Strict Mode is handled with the starter's "dispose only after load" guard.

Deliberate deviations from the starter (documented in the file header):

1. **(2B.2)** `init({ sceneUrl })` loads the **global scene** (`spatialIndex.globalSceneUrl` → `/data/spatial/global-scene.<digest>.json` since 2B.4B: avatar, VRM animations, lighting, background, envmap, fog, ground). `sceneUrl` is required; there is no default scene URL in the runtime any more.
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
- The URL always comes from `spatialIndex.chunks[chunkKey].dataUrl`. No chunk path is hard-coded in runtime logic (tested by source scan). Since 2B.4B the URL is the path of a content-addressed file (`chunks/<key>.<digest>.json`, §15); the source passes the whole string to `fetch` and never parses, derives or rebuilds a name or digest (tested with a stubbed `fetch` and by source scan).
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

**Disposal** (`dispose(): Promise<void>`, 2B.4A — see §14 for the full contract): synchronously marks disposed, bumps the generation and aborts the controller (so `transitionTo` fails structurally and in-flight fetch/creation is cancelled), then **awaits the mutation queue** and retires the active chunk **as the last mutation** — exactly once. A transition still inside `stageChunk` finishes, observes it is stale and retires its own batch *before* shutdown resolves; the promise never rejects (retire failures are reported through `warn`). Idempotent. The store awaits this **before** `runtime.dispose()`.

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

- `canTravel` → `gate-required` **before** the orchestrator is consulted, so the cannabis chunk payload (`chunks/cannabis-21.<digest>.json`) is never requested: not on an initial gated deep link, not on a directory click, not on back/forward to a gated URL. Tested at adapter level (source request log empty, no cannabis component in the fake world), at store level for all three paths, and in the browser (network resource list).
- Initial gated deep link: engine boots from the global scene → gate refused → **Hub chunk** fetched as the fallback → visitor placed at the Hub → reveal → app `gateRequired` for the requested destination; the URL still names the gated destination (reload reproduces the refusal).
- In-app click / history navigation: `gateRequired`, visitor and active chunk unchanged, URL unchanged.
- The manifest's placeholder `enforced: false` is deliberately **not** consulted (tested): declaring a gate is enough to stop spatial entry. No age verification, jurisdiction logic, "I am 21" bypass or fake gate pass exists.
- Known non-M0 limitation: `public/data/spatial/chunks/cannabis-21.<digest>.json` is a statically served file (a content-addressed name is not authorisation). "Never fetched before the gate" is an **application-layer** guarantee; hosting/server-side enforcement of gated chunk URLs is a later decision.

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
| A Hub direct load | `/api/destinations`, `/data/spatial/spatial-index.json`, `/data/spatial/global-scene.json`, `/data/spatial/chunks/hub.json` (2B.2 names; content-addressed `…<digest>.json` since 2B.4B) — **no** `static-scene`, no music/fashion/cannabis chunk; Hub platform/marker/label rendered on the global ground; active chunk `hub` |
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

- **2B.4A — correctness / lifecycle / shutdown hardening: DONE** (§14). The carried shutdown risk is **closed**: `disposeApp` now awaits the orchestrator's settled mutation queue *and* the runtime's asynchronous disposal (engine session settled) before the run is cleared, so the Space is never destroyed while `stageChunk` / `ComponentManager.create` is still resolving.
- **2B.4B — performance: DONE as HTTP delivery only** (§15). The 2B.4B.1 audit measured that repeat chunk fetches were conditional revalidations of `max-age=0` responses; 2B.4B.2 made the artifacts content-addressed (digest in the file name) and `immutable` behind a revalidated index — after an independent review rejected the first, query-only version. Application cache, prefetch and neighbour warming were **rejected for M0** on the measurements (§15). Browser-verified: repeat visits are disk-cache hits with 0 wire bytes and no conditional request.
- **2B.4C — mobile: DONE as a shell correction + warning-only budgets** (§16; pipeline doc §16). Adaptive quality deferred to the first representative art slice; real-device validation still required.
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

## 14. Correctness / lifecycle / shutdown hardening (M0 Step 2B.4A)

Branch `feat/m0-hardening-correctness` (from `nrvna/integration`). This step added **no** new travel architecture, prefetch, cache, budget, mobile tier or gate flow — only correctness around teardown, boot/dispose lifecycle, repeated mount cycles, stale asynchronous work and cleanup-failure containment. The successful travel path (gate → placement → fetch → validate → stage-while-old-alive → teleport → commit → retire → arrived), stable-id URLs, latest-request-wins, same-chunk teleport and portal → `travelToDestination` are unchanged.

### 14.1 Orchestrator asynchronous shutdown contract

`ChunkOrchestrator.dispose()` returns `Promise<void>` (was `void`). Semantics:

- **Synchronous, before the first await:** mark disposed (`isReady` → false, `transitionTo` fails structurally with `"chunk orchestrator is disposed"`), bump the generation, abort the active `AbortController`. So every in-flight request is immediately stale: its fetch is cancelled and a stage inside `ComponentManager.create` sees the aborted signal.
- **Then it waits for the mutation queue to settle.** The active chunk is retired **inside** the same promise-chain mutex used by stage/commit/rollback, appended as the **last** entry. Because `transitionTo` refuses once disposed, nothing can be queued after it. A request that was already inside the lock finishes its `stageChunk`, observes it is stale, and retires the batch it created (or the batch helper already rolled it back on abort) **before** the disposal's own mutation runs — so the active chunk is retired only when no stale transition can still be mutating the component set.
- **Idempotent:** every call returns the same promise.
- **Never rejects:** retire failures are caught and reported through `warn`; the internal `mutationTail` is `.catch()`-guarded, so no cleanup failure leaks as an unhandled rejection or can leave shutdown hanging.
- **Resolves** only once no batch this orchestrator created can still exist, so the caller may then destroy the engine runtime. (Settlement depends on the runtime's `stageChunk` settling; the official `ComponentManager.create` bounds each creation with its own 120 s timeout.)

**Active-chunk retire order.** The active chunk is retired **as the last mutation on the queue**, not eagerly at the top of `dispose()`. This removes the race where an eager retire runs while a still-settling stale transition references runtime state: by the time the retire runs, every earlier mutation has drained. Double-retire is prevented by clearing `this.active` before the retire and by `retireChunk` being idempotent per batch; a leftover staged batch cannot survive because a stale transition always retires its own batch when it discovers it is not current.

### 14.2 Runtime disposal (`AweSpatialRuntime.dispose(): Promise<void>`)

Now asynchronous and idempotent (was synchronous `void`). Synchronously it removes the space hooks, drops the batch handles, disposes controls/inputs/camera/animation and calls `space.destroy()` **exactly once** (guarded by a single disposal promise). It then awaits `settleEngineSession()`, which resolves when `Engine.sessionState` returns to `"void"` after the upstream async destroy handler runs (microtask polling, then a bounded macrotask fallback that warns rather than hangs). This is what lets a replacement `init()` on the same page never hit the engine's `"Destroy the current space before creating a new one."` guard. Repeated calls return the same promise; after it resolves, further calls resolve immediately. The engine, `ComponentManager`, `LOAD_TIMEOUT` and animation scheduling were **not** modified.

### 14.3 Application boot/dispose coordination (`app-store.ts`)

The incremental boolean globals (`started`, `engineLoaded`, `runtime`, `orchestrator`, `portals`, `adapter`, `unsubscribePhase`) were replaced by **one explicit `AppRun`** with a `status` of `booting → running → disposing → (idle)`, its owned handles, a `disposeRequested` flag and `booted` / `settled` promises. The module holds at most one run. This makes the eight required cases correct:

1. **First boot** — creates the run, executes the boot, becomes `running`.
2. **Duplicate boot while booting** — returns the same `booted` promise; exactly one runtime is ever created.
3. **Normal dispose after boot** — `teardown` runs, `settled` resolves, run cleared.
4. **Repeated dispose** — concurrent calls share the one teardown promise; later calls resolve immediately.
5. **Boot after completed dispose** — a fresh run; the old runtime was already destroyed (and its engine session settled) before the new `createSpace`.
6. **Boot failure before running** — the boot's `finally` unwinds every allocated resource (adapter/portals/orchestrator/runtime disposed, listeners removed) and clears the run; the `error` app state stays on screen; a later boot works.
7. **Dispose while booting** — the request is **recorded** (`disposeRequested`) and honoured at the boot's next await boundary, where the boot returns and its `finally` unwinds. `disposeApp()` returns the run's `settled`.
8. **Boot while an earlier dispose is still finishing** — `bootApp` awaits the disposing run's `settled` before creating anything, so a new Space is never created while the old one is shutting down.

**Hardened `teardown` order** (best-effort — each step is wrapped so a failure is reported and the next steps still run; the lifecycle can never stay `disposing`):

1. status `disposing` + travel sequence bumped → no new travel; a pending travel result can no longer settle state or write the URL; `popstate` listener removed;
2. adapter phase listener removed → no late `loadingChunk` / `arrived` / portal re-sync;
3. **portals disposed** (references nulled synchronously) → sensor subscriptions released while their components still exist; deferred portal triggers invalidated;
4. adapter disposed → further travel `unavailable`;
5. **orchestrator disposed and awaited** (§14.1);
6. **runtime disposed and awaited** (§14.2) → Space destroyed once, engine session settled;
7. references dropped, dev handle removed, run cleared, stores reset (a failed boot keeps its `error` state instead).

`travelToDestination` re-checks the live run (`run === current && status === "running"`) after its `await`, so a portal callback or history event that fires during teardown cannot start travel, change state or write the URL. `disposeApp()` returns a `Promise<void>`; `AppShell`'s effect cleanup calls `void disposeApp()`.

### 14.4 React Strict Mode

Preserved the reason Step 2A guarded teardown during the development Strict Mode simulated unmount, **without** the blunt "abort on any cleanup" that would destroy a valid initial boot. The mechanism is the run's `disposeRequested` flag: Strict Mode's `setup → simulated cleanup → setup` becomes `bootApp() (booting) → disposeApp() (records the request) → bootApp() (rescinds it and adopts the in-flight boot)`. One runtime is created, it is never destroyed by the simulated cleanup, and the world reveals normally. A **real** unmount (cleanup with no immediately following setup) leaves `disposeRequested` set, so the boot unwinds at its next boundary. Strict Mode is not disabled and runtime safety is not weakened.

### 14.5 Stale portal microtask protection

`PortalController.trigger()` still defers the travel to a microtask, but the deferred callback now carries the **binding epoch** it was recorded under. The epoch is bumped whenever the bound set changes (activation to another chunk, release, dispose). When the microtask runs it routes **only** if the controller is not disposed, the epoch is unchanged, and the portal is still bound — otherwise the trigger is dropped (`droppedTriggerCount`), never turned into a travel request. This closes the window where a portal became unbound between SENSOR ENTER and the microtask (a chunk switch committed by an earlier-queued continuation, or `dispose()`). A legitimate entry still routes exactly once; there is no debounce or cooldown. `release()` also now attempts every unsubscribe even if one throws (reported), as a second line of defence behind the sensor seam's own disposed-emitter guard.

### 14.6 Tests

App test count 213 (was 177). New/changed deterministic tests, all with explicit deferred promises / holds and no timing sleeps:

- **`chunk-orchestrator.test.ts`** — new "asynchronous shutdown contract" suite (13 tests): dispose during in-flight fetch (fetch aborted, nothing staged, active retired once); dispose while a request waits for the lock (never stages; shutdown waits for the lock holder); dispose while `stageChunk` is resolving (waits, stale batch cleaned before the active chunk, active retired once, stale batch retired before active); a batch created just before the abort is cleaned; dispose with no work in flight; idempotent (same promise, one retire); transitions refused before and after settlement; retire failure of the stale target reported without hanging; retire failure of the active chunk reported, shutdown resolves; interrupted staging that rejects with a real error → superseded; **no unhandled rejection from `mutationTail`**.
- **`app-store.test.ts`** — new "lifecycle hardening" suite (24 tests): boot → dispose → boot again (old runtime destroyed before the replacement is created, proved by a shared event log); repeated boot while booting → one runtime; repeated dispose safe; dispose during a cross-chunk transition (no state/URL/history write, world empty, runtime destroyed last); nothing after dispose (portal/history/direct travel cannot fetch or write); listener/subscription counts return to zero; boot-failure recovery for five failure points (destination source, spatial index, malformed index, runtime init, both chunks fail) each followed by a clean later boot; dispose while booting unwinds; dispose while init is still resolving; Strict Mode setup → cleanup → setup adopts the boot; boot waits for a still-finishing async dispose; two boots during a dispose share one replacement; failure during shutdown contained (runtime.dispose throws, retireChunk throws, stale cleanup + interrupted staging throw, portal unsubscribe throws) — each returns to `idle` and the next boot succeeds. The existing disposal test now asserts the async settle order (portals released synchronously before any component is destroyed; the Space is destroyed only after the mutation queue settles).
- **`portal-controller.test.ts`** — new "stale deferred triggers" suite (4 tests): binding unchanged → callback once; different chunk activated before the microtask → old callback does not run and the new chunk works; dispose before the microtask → callback does not run; two entries in one frame both route (no debounce), no duplicate on a same-chunk rebind. Plus a throwing-unsubscribe containment test.

### 14.7 Browser validation (2026-09-19, headless Chrome `--headless=new` + SwiftShader over raw CDP against `next dev`)

The real avatar was driven with trusted WASD into the real sensor colliders; teardown/re-boot used a dev-only `window.__nrvnaverseLifecycle` handle (guarded by `NODE_ENV`, never used by application code) to exercise the real engine without unmounting React.

| Check | Result |
|---|---|
| A normal Hub boot | ready at the Hub, 15 components (7 global + 8 hub), 3 Hub portals bound, active `hub` |
| B Hub → Music portal | walked west; `music.json` fetched, Hub retired, active `music`, URL `?destination=<music>`, bound 2 |
| C Music → Artist portal | same-chunk (music fetch count still 1), avatar at the Artist spawn, URL names the Artist |
| D Music → Hub portal | Hub loaded, Music retired |
| E cross-chunk travel + **real teardown mid-travel, then re-boot** | on `disposeApp()`: orchestrator disposed synchronously, portals unbound (0), then await → active chunk null, batches 0, runtime not ready, Space `_wasDisposed`, `__nrvnaverse` handle gone, **no URL write**, app returns to `boot`; the immediate `bootApp()` created a **fresh Space** (`$space !== old`, runtime !== old), reached `ready`, global scene re-fetched — **no "engine already has a session"**; portals worked again afterward |
| F page reload after teardown | `?destination=<hub>` reload created a fresh Space, ready at the Hub |
| G Hub → Cannabis portal | `gateRequired`, **cannabis fetch count 0**, visitor stays in the Hub, URL unchanged, portals stay bound |
| H repeated navigation (directory ×4) | arrived each time, bindings followed, no stale trigger, `droppedTriggerCount` 0 during normal navigation |
| I duplicate-binding check | each bound portal holds exactly one controller sensor-enter listener; bound set = live sensors |
| K console | only pre-existing upstream items (VRM `LookAtDegreeMap`, THREE `plugins`/`copyTextureToTexture` deprecations, headless-only `WrongDocumentError` pointer-lock, and a SwiftShader-only cross-origin `texSubImage2D` texture error from a CDN asset in the render loop) — **none attributable to the hardening** |

A **repeat boot→dispose→boot cycle run twice in one page** both created fresh Spaces (dispose ≈4–10 s, cold SwiftShader re-boot ≈51–54 s) with no session error and no new console error introduced by the lifecycle changes.

### 14.8 Background-tab load timeout

The upstream hidden/background-tab `requestAnimationFrame` / `LOAD_TIMEOUT` behaviour was **not** the target of 2B.4A and was **not** modified (engine timing, `LOAD_TIMEOUT` and animation scheduling are untouched). It remains recorded as an upstream/runtime risk; validation used a visible headless tab where rAF runs.

## 15. Content-addressed delivery and HTTP cache policy (M0 Step 2B.4B)

Data-pipeline side (digest algorithm, content-addressed names, generation order, stale-file policy, cache rules, cross-deployment proof, full production and browser measurements): [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) §15. This section records what the *runtime* side of the step is — and, mostly, what it deliberately is not.

### 15.1 The 2B.4B.1 audit and decision B

The read-only audit (2026-09-20) measured the running system rather than assuming where time went: cross-chunk travel ≈45 ms median locally, validation ≈0 ms, staging ≈10 ms for the current placeholder chunks — and **every repeat chunk fetch was a conditional HTTP revalidation** (`next dev` and `next start` both answer `Cache-Control: public, max-age=0` with a weak `ETag` / `Last-Modified`), i.e. one round trip per revisit (≈243 B, 304). Under a bounded 150 ms-latency profile a repeat travel cost ≈175 ms; with a long-lived cache policy simulated in the browser it cost ≈36 ms with 0 body bytes from disk cache. Decision **B — HTTP delivery follow-up only**:

| Rejected for M0 | Why |
|---|---|
| Application raw-payload / validated-payload cache (`Map` of chunk JSON) | The browser HTTP cache already holds the bytes once the delivery contract allows it; a second copy adds memory, invalidation logic and a stale-data surface for no measured gain. |
| Predictive / neighbour prefetch, neighbour warming | Fetches chunks the visitor may never enter; for a gated neighbour it would violate gate-before-fetch (D-006). Not justified by the measured cost. |
| Instantiated-chunk retention | Changes the one-active-chunk model and its memory profile; no measured need. |
| Service Worker / CacheStorage / IndexedDB / localStorage | Another cache layer with its own lifecycle; the HTTP cache is the cache. |
| **Query-only content versioning (`file.json?v=<digest>`)** — the first 2B.4B.2 implementation, `4c64efd` | **Rejected in independent review, corrected on the same branch.** A query changes the cache key but not the bytes the server selects: after a deployment, an old index's `music.json?v=HASH_A` is answered with the *new* `music.json` under `immutable`, caching content B under HASH_A and mixing old placement data with new geometry. The 2B.4B.1 table had listed hashed file names as "needs an output-lifecycle design" — that design (deterministic ownership, stale-file removal, `check` on unexpected files) was done as part of the correction. |

### 15.2 What changed for the runtime: nothing behavioural

- `FetchChunkDataSource`, `ChunkOrchestrator`, `AweSpatialAdapter`, `PortalController`, `AweSpatialRuntime` are **structurally unchanged** across both the query-token version and the content-addressed correction. They already consumed `spatialIndex.globalSceneUrl` and `spatialIndex.chunks[key].dataUrl` as opaque strings; those strings are now `/data/spatial/global-scene.<digest>.json` and `/data/spatial/chunks/<key>.<digest>.json` (path only, no query) and are handed to `fetch` exactly as before. No runtime hashing, no file-name construction, no digest parsing (comment-stripped source scan).
- `parseSpatialIndex` has no new field and no digest validation (`globalSceneUrl` / `dataUrl` remain plain strings); a doc comment records the opacity contract. Schema version stays 1; index keys and `chunkKey` in each payload are the logical chunk keys, never file names.
- Gate-before-fetch (§7) is untouched: Cannabis → adapter gate → `gateRequired` → zero chunk requests. The content-addressed cannabis URL exists in the index like every other artifact and is served `immutable` — delivery metadata that neither authorises nor prefetches it. The known non-M0 limitation (the static chunk file is not server-authorised content) is unchanged and not solved by content addressing.
- URL contract (§8) unchanged: `?destination=<stable-id>&from=spatial` only; a digest never appears in a navigation URL (tested at URL-contract, store and browser level).

### 15.3 Tests

`test/spatial-delivery.test.ts` — the committed index carries content-addressed artifact URLs (path only) and a fixed index URL; `FetchChunkDataSource` fetches exactly the `dataUrl` (digest included) with the request's `AbortSignal` and surfaces a 404 without retrying another name; `FetchSpatialIndexSource` requests the fixed index URL; `parseSpatialIndex` passes URLs through verbatim with or without a digest; no `src/` file parses / derives / rebuilds a digest, a hashed name or a chunk path, hashes anything, or contains a 32-hex literal (comment-stripped source scan) and both real consumers pass the URL straight to `fetch`; the digest never appears in `buildDeepLinkQuery` output. `test/cache-policy.test.ts` evaluates the `next.config.ts` path rules with Next's own `path-to-regexp` / `matchHas`. `test/spatial-cli.test.ts` covers the generated-output lifecycle (pipeline doc §12, §15). Tests that used to static-import `chunks/<key>.json` (store, orchestrator, payload, portal-controller, adapter) now read the payloads through the committed index via `test/support/generated-spatial.ts` — the runtime's own resolution path. Existing assertions tightened to the content-addressed shape: orchestrator request URL, store `sceneUrl`, index `globalSceneUrl`; store and URL-contract suites still assert no `v=` / 32-hex token in navigation URLs. 244 app tests (235 at `4c64efd`, 213 before 2B.4B), 56 manifest tests, `check` (strict pass incl. `checkJs` over pipeline and CLI), `spatial:check`, `generate:check`, `next build` pass.

### 15.4 Browser validation (2026-09-20, fresh headless-Chrome profile, GPU-backed, raw CDP, against `next build` + `next start --port 3211`; focused Hub → Music → Hub → Music after the correction — the full 2B.4B.2 audit flow was not rerun)

| Check | Result |
|---|---|
| Boot (fresh profile) | index `200` 1 029 B (`public, max-age=0, must-revalidate`); `global-scene.<digest>.json` `200` 2 834 B and `hub.<digest>.json` `200` 1 375 B (`public, max-age=31536000, immutable`); arrived at the Hub in 10.5 s wall incl. engine boot |
| Hub → Music (first visit) | network `200`, **1 387 B on the wire**, `chunk-fetch` 27.8 ms, `cross-chunk-travel` 47.7 ms |
| Music → Hub, Hub → Music, Music → Hub, Hub → Music (revisits of the exact hashed URLs) | **`fromDiskCache: true`, 0 wire bytes, Resource Timing `transferSize 0` / `deliveryType "cache"`, no `If-None-Match` sent** — no conditional round trip; `chunk-fetch` 3.2–25.6 ms, `cross-chunk-travel` 14–36 ms (the later revisits 14–16 ms, matching the 8–14 ms of the query-form run; the earlier ones include cold-JIT staging) |
| Hub → Cannabis | `gateRequired`, **zero** network requests, URL unchanged; cannabis chunk requests over the whole run: 0 |
| URLs | only `?destination=<id>&from=spatial` ever written |
| Console | no error; only pre-existing upstream Three/VRM warnings |
| Production headers (same server, GET + HEAD) | index revalidated; hashed global scene / Music / Cannabis `immutable` and the served bytes hash to their name token; **fabricated old-digest Music paths `404` with `private, no-cache, no-store` and a body that is not the current Music**; legacy unversioned names and the `?v=` form `404`, never immutable; `static-scene.json` `public, max-age=0` |

Success criterion still met after the correction: repeat visits do not pay the measured conditional-revalidation round trip, and a stale URL can no longer be answered with new bytes. No application cache was added to compensate for anything.

## 16. Mobile / touch shell (M0 Step 2B.4C)

**What 2B.4C is.** A read-only audit (2B.4C.1, 2026-09-20) of the prototype shell on **emulated** mobile, then a bounded correction (2B.4C.2, branch `feat/m0-mobile-guardrails`) of the phone HUD plus warning-only spatial budgets (pipeline doc §16). Nothing in this step touches the engine, the orchestrator, the adapter, the portal controller, the gate rule, the URL contract or `packages/*`; D-009 (mobile is first-class, adaptive quality inside one product) is unchanged and adaptive quality is **deferred** (§16.5).

### 16.1 Test environment and its limits

EMULATED MOBILE only — **not a physical device test**: HEAD-parity `next build` served by `next start`; headless Chrome (GPU-backed, NVIDIA GTX 1050 via ANGLE) driven over raw CDP; per page a mobile UA (`IS_TOUCH` in the engine is ua-parser-derived at module load, `packages/engine/src/internal/constants.ts:43-51`, so the UA must be set before navigation), `Emulation.setTouchEmulationEnabled` (5 points → `(pointer: coarse)`, `(hover: none)`, `navigator.maxTouchPoints`), `Emulation.setDeviceMetricsOverride` (mobile, DPR 2/3, orientation), real `Input.dispatchTouchEvent`s (Blink synthesises the pointer events the joystick / jump use), one profile with `Emulation.setCPUThrottlingRate 4`. Viewports: 375×667 @2, 390×844 @3, 844×390 @3, 768×1024 @2; one 1280×800 desktop regression. Not covered and **still required later**: iOS Safari, physical notch / home-indicator safe areas, pull-to-refresh and browser chrome, software keyboard, thermal / GPU behaviour of real phones (the desktop GPU renders the placeholder world at 60 fps, which says nothing about a phone).

### 16.2 Touch interaction path (post-M0 input hardening, §16.7; VERIFIED emulated)

**Current post-M0 input path:** `touchstart/move/end/cancel` on the canvas → `BrowserInputCapture` (`packages/engine/src/input/input-capture.ts`, target `CANVAS`; only `changedTouches`, never the document-wide `TouchEvent.touches`) → `TouchState` (`control-state.ts`): touch count = the canvas contacts it actually tracks, and camera look is owned by one explicit contact (`lookTouchId`), claimed on touch start and emptied on end / cancel **without promoting another contact** → raw `Touch.delta()` binding (`src/lib/input/gameplay-inputs.ts`, no processor) → `cameraRig.rotate()` every fixed update → `ThirdPersonCameraRig.rotate` → `applyAxisDampening` (`base-camera-rig.ts`), which scales by the UA-derived `IS_TOUCH` factors but **never changes a sign**: +x looks right, +y looks down on every device class. The joystick and jump button write `sharedControlState.touch.setJoystick` / `custom.pressButton("jump")` from their own DOM elements (siblings of the canvas, pointer capture), so their touches never reach the canvas listener, never become look and — now — are not counted by the canvas either.

**Previous path (M0, 2B.4C):** `TouchState` took `event.touches.length` (which also counts fingers on the joystick / jump overlay) as its count and promoted the next tracked contact when the look contact lifted; the app's `Look` binding was `withProcessors(Touch.delta(), Processors.scaleVector2(-1))`, compensating an `IS_MOBILE` sign flip inside the engine rigs, so the two flips cancelled only on devices the UA parser classed as mobile.

Measured (390×844, warm): first avatar displacement 125–175 ms after touch, 8.7–10.2 m per 700 ms push (`SPEED` 15 through the response curve), stationary ≤ ≈0.5 s after release and after `touchcancel`; jump to y ≈4.85–5.3 and back; joystick + jump on two pointers (12–13 m horizontal while jumping); a 120 px canvas drag rotates the camera −2.25 rad without moving the avatar, a vertical drag pitches it; joystick + drag-look on two fingers concurrently. Under 4× CPU slowdown: identical geometry, first movement 140 ms, boot 7.0–7.7 s, cross-chunk travel 79–190 ms (chunk stage 28–48 ms), no error.

Caveats for a desktop-UA touch device (Windows touch laptop, iPadOS Safari in its default desktop mode):

- **Axis inversion — CLOSED** by the post-M0 input hardening (§16.7): touch look turns the same way under a desktop UA as under a mobile UA (emulated check B of `pnpm browser:touch`).
- **Weaker touch-look magnitude — STILL OPEN.** The rig's touch magnitude factors (`applyAxisDampening`, `calculateRotationConversion`) are keyed on the UA-derived `IS_TOUCH`, so the same drag turns less under a desktop UA (emulated: 60 px → 0.375 rad vs 1.125 rad).
- **Mediator gating — STILL OPEN.** No touch `preventDefault` from the Mediator (its touch handlers are `IS_TOUCH`-gated) and a pointer-lock request on tap (`mediator.ts`, `base-camera-rig.ts`); mitigated at the app level by `touch-action: none` / `overscroll-behavior: none` (§16.4) and now the engine canvas's own `touch-action: none`, not fixed in the engine.

The two open items are generic AWE concerns (device classification by UA instead of by input type). They are handed to the AWE-library effort (`TheCannaMan/awe`) as a non-blocking task and are deliberately **not** patched in NRVNAVerse.

### 16.3 What the audit found (2B.4C.1, EMULATED, pre-correction)

| Finding | Evidence |
|---|---|
| Directory open by default covered the world on phones and its own toggle | 375×667 / 390×844: aside full width; "Hide directory" 0 % tappable (aside + joystick over it); 36 % on landscape / tablet (joystick over it); "Show directory" 39–41 % when closed |
| Travel / gate / notice banners painted under the aside | `ok` 0 % tappable on all four viewports with the panel open; on phone portrait the gate refusal was invisible except as diagnostics text |
| Last directory links under the `z-40` joystick | at Music District "Music District" and "Placeholder Artist" sat under the joystick; three real taps hit the joystick thumb (screenshots) |
| Desktop-only instruction line on touch | "WASD / arrows move …" always shown |
| No `viewport-fit=cover`, no safe-area offsets, no `touch-action` / `overscroll-behavior` on the world surface | Next default viewport only; `env(safe-area-inset-*)` unused |
| Canvas / orientation / gate | all correct: canvas CSS, backing store (DPR 3 capped to renderer pixel ratio 2) and camera aspect exact through portrait → landscape → portrait; Hub → Cannabis by touch → `gateRequired`, 0 cannabis requests |

### 16.4 The correction (2B.4C.2, `apps/the-nrvnaverse` only)

| Change | Where |
|---|---|
| One canonical interaction mode: `touch` (the starter's `maxTouchPoints` / `(pointer: coarse)` / `ontouchstart` detection, unchanged semantics), `narrow` (`(max-width: 639px)`, Tailwind `sm`), `mobile = touch || narrow`; `useInteractionMode()` re-evaluates on pointer-type change, viewport-class change and resize; server / first render report `false` | `src/lib/interaction-mode.ts`; used by `app-shell.tsx`, `touch-joystick.tsx`, `jump-button.tsx` (their duplicated detection removed; joystick / jump semantics untouched) |
| Directory starts closed when `mobile`, open otherwise; the visitor's explicit choice wins afterwards | `app-shell.tsx` (`panelChoice ?? !mode.mobile`) |
| Opener "Show directory" is a fixed top-right, safe-area-aware button (`z-40`); the open directory carries its own "Hide directory" control in a sticky header; neither is in the joystick / jump footprint | `app-shell.tsx` (`data-panel-toggle="open" / "close"`) |
| Touch controls are not rendered while the directory is open, so they can never intercept a link; they return on close (unmount releases joystick / jump through their existing cleanup) | `app-shell.tsx` (`settled && !panelOpen`) |
| `TravelBanner` + `Notices` mount inside the open directory (sticky top, `data-status-layer="panel"`) and in the overlay when closed (`data-status-layer="overlay"`) — the same components, same state; only the mount point moves | `app-shell.tsx` |
| Touch-aware instruction line ("Joystick to move · drag the world to look · Jump button to jump"); desktop line unchanged | `app-shell.tsx` (`data-instructions`) |
| `export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" }` through the Next Viewport API (emits `width=device-width, initial-scale=1, viewport-fit=cover`); `env(safe-area-inset-*)` offsets on the joystick, the jump button, the opener and the aside padding (top / right / bottom); no device-specific numbers | `src/app/layout.tsx`, `touch-joystick.tsx`, `jump-button.tsx`, `app-shell.tsx` |
| `#canvas-container { touch-action: none }` and `html, body { overscroll-behavior: none }`; `touch-action: manipulation` on HUD buttons and directory links; the aside keeps its own scrolling (`overflow-y-auto overscroll-contain`) | `src/app/globals.css`, `travel-banner.tsx`, `directory-nav.tsx` |
| Error overlay scrollable, message `break-words`; long destination URLs wrap inside the destination card (`min-w-0 break-words`, `minmax(0,1fr)` column) and the diagnostics JSON in the spatial panel wraps (`break-all`) so the open directory never scrolls horizontally | `app-shell.tsx`, `destination-view.tsx`, `spatial-panel.tsx` |

Tests (`test/mobile-shell.test.ts`, 13): interaction-mode predicates against a fake `window` / `navigator` (server → all false; the three touch signals; narrow / mobile union) and source-scan pins of the shell contract (panel default from the mode, controls not rendered while open, both toggles with safe-area placement, status mounted in both layers, touch-aware instructions, aside bottom padding, joystick / jump on the shared mode with safe-area offsets and their cleanup kept, the `viewport` export, the CSS rules). The vitest environment is node (no DOM), so the real layout is proved in the browser matrix below, not in unit tests.

**Browser re-run (EMULATED, production build, all four viewports; `?destination=<unknown id>` deep link so a non-fatal notice is present):** directory closed by default with the world visible; opener 100 % tappable and overlapping neither joystick (82 % own hit area) nor jump (84 %); touch instruction line shown; notice visible in the overlay. Open by tap: aside scrollable where taller than the viewport, no horizontal overflow, close control 100 % tappable, all 7 destination links tappable — also at Music District after arrival —, joystick / jump not rendered, notice visible inside the panel. Hub → Cannabis by tap: `gateRequired` banner inside the open panel, in viewport, `ok` 100 % tappable and dismissed by touch, 0 cannabis requests; Hub → Music: arrival banner likewise (travel 29–39 ms, `music.<digest>.json` from disk cache, 0 wire bytes); close by tap → joystick and jump return, opener 100 % tappable. Touch phase (390×844): joystick / jump / simultaneous / drag-look / joystick + look pass with the 2B.4C.1 figures; portrait → landscape (finger held on the joystick across the rotation; drift after release 0.04 m) → open panel → portrait → close: canvas CSS / backing / aspect exact at every step, close and open controls 100 % tappable, safe-area CSS present on every fixed control, joystick works after each rotation. Performance smoke after the HUD change: six tap-driven travels 24–30 ms cross-chunk / ≈1 ms same-chunk, every chunk fetch `fromDiskCache` with 0 wire bytes, no new request from the HUD, heap 49.6 → 44.3 MB, 15–16 components, no console error. Desktop 1280×800 (no touch emulation): directory open by default, desktop instruction line, no joystick / jump, W moves the avatar 10.4 m in 600 ms, close / reopen by click work.

### 16.5 Adaptive quality — deferred

2B.4C.1 measured no rendering problem to adapt to: 13–15 draw calls, ≈6.9 k triangles, 22–23 geometries, 10 textures, 15–16 live components, JS heap ≈44–52 MB flat across a ten-step travel loop, and the engine already caps the pixel ratio at 2 (`constants.ts:87`, `renderer.js:103`) while its `QUALITY` is hard-coded `HIGH` (`constants.ts:102-103`, upstream). Dynamic pixel ratio, quality tiers, LOD / shadow / effects policy and runtime performance auto-detection are therefore **not** built in M0. Cold boot (3.77 MB, 76 requests on a fresh profile) is dominated by placeholder / upstream scene assets — the `studio` HDR envmap 1.61 MB (43 %), Next JS 0.87 MB, Rapier WASM 0.51 MB, avatar VRMs 0.34 MB — while the spatial JSON is 0.14 %; that is a scene-data choice for the art step, not a runtime problem. The decision is re-taken at the first representative art vertical slice, when real GLB / material / texture / render costs exist; the absence of problems on placeholder boxes proves nothing about final art. D-009 stands; no `DECISIONS.md` entry.

### 16.6 Remaining work

Broader real-device validation (cross-device / cross-browser coverage on iOS Safari and Android Chrome: safe areas and browser chrome, pull-to-refresh, double-tap zoom on HUD text, software keyboard, thermal / GPU / fps) — **REQUIRED LATER**, not claimed here. The specific post-M0 two-finger input test of §16.7 is done: **REAL-PHONE INPUT SIGNOFF — PASS** (one phone, device / browser not recorded). Also open: adaptive quality with representative art; camera-speed tuning with representative art; the still-open desktop-UA touch magnitude / Mediator caveats (§16.2), handed to the AWE library; visual design of the HUD (a product decision, Governance rule 9).

### 16.7 Post-M0 input hardening

**What it is.** Post-M0 hardening of mobile multitouch, not an M0 reopening and not M1. A real-phone report in the sibling capability repository (hold the joystick with one finger, repeatedly lift and re-place the camera finger → movement and look interfere) was audited against this fork read-only and all engine-level causes were found here too. The generic fixes were built as the upstream-candidate branch `contrib/touch-input-ownership` (D-015; four commits adapted from `TheCannaMan/awe@3827bab` / `@069d3d8`, provenance in each message; no upstream PR) and merged with an explicit merge commit, with the NRVNAVerse adaptation on top (historical implementation record: feature branch `feat/touch-input-sync`, merge `6ef2cae`, adaptation `cd51d76`).

| Change | Where | Layer |
|---|---|---|
| Canvas touch count = tracked canvas contacts, not the document-wide `TouchEvent.touches` (a joystick / jump finger can no longer leave the canvas logically pressed) | `packages/engine/src/input/control-state.ts`, `input-capture.ts` | generic (contrib) |
| Explicit camera-look owner (`TouchState.lookTouchId`): claimed on touch start, emptied on end / cancel, never inherited by another tracked contact; `reset()` clears it | `control-state.ts` | generic (contrib) |
| `VirtualJoystick`: first pointer owns the stick until release / cancel; every other pointer's press / move / release / cancel is refused and changes nothing; deadzone 0.26, response exponent 1.75, cardinal assist 0.35 above 0.3 (the values the joystick already shipped); caller-supplied geometry; no UI coupling | `packages/engine/src/input/virtual-joystick.ts` | generic (contrib) |
| One look-axis convention: the UA-derived sign flips are gone from `applyAxisDampening`, the legacy `CameraRig` and `calculateRotationConversion` (magnitude unchanged); the examples' compensating `scaleVector2(-1)` removed | `packages/engine/src/controls/…`, `examples/{starter,football-demo,multiplayer}` | generic (contrib) |
| Render canvas created with `touch-action: none` (a claimed pinch would otherwise `pointercancel` the joystick's captured pointer) | `packages/engine/src/internal/constants.ts` | generic (contrib) |
| Raw `Touch.delta()` look binding (the compensation removed in the same feature that adopts the engine change); input map moved out of the runtime file | `src/lib/input/gameplay-inputs.ts`, `awe-spatial-runtime.ts` | app |
| Joystick delegates ownership and response to `VirtualJoystick` through `JoystickSurface`; a refused `pointerdown` is not captured and changes neither movement nor the thumb; only the owner's up / cancel resets; unmount resets and zeroes. Responsive sizes, safe-area offsets, interaction mode and styling unchanged; no app copy of the response constants remains | `src/components/touch-joystick.tsx`, `src/lib/input/touch-controls.ts` | app |
| Jump button owned by the pointer that pressed it (`PointerOwner`): another pointer can neither re-press nor release it; the unguarded `onPointerLeave` release is gone (pointer capture owns the lifecycle); unmount always releases `jump` | `src/components/jump-button.tsx`, `touch-controls.ts` | app |
| Read-only input snapshot for browser regressions: `window.__nrvnaverseInput.touch()` → `{ touchCount, isTouching, lookTouchId, joystick, jumpHeld }` (plain values; writes nothing) | `src/lib/input/input-diagnostics.ts` | app |

**Tests.** Engine (from contrib): `multitouch-ownership` (10), `virtual-joystick` (16), `look-axis-mapping` (23; every rig × desktop / mobile device class), `canvas-touch-action` (1). App: `test/touch-input.test.ts` (13) — a canvas drag through the real `BrowserInputCapture` and the real `GAMEPLAY_INPUTS` reads raw (+40, +12), no processor on any `Look` binding, `JoystickSurface` ownership (steal refused with nothing published, five look replacements with one cancel, owner-only cancel, dispose), its output identical to `VirtualJoystick` along a pointer path and every decision delegated, no second copy of the response constants in the app, and jump release owner-only.

**Browser regression (`pnpm --filter the-nrvnaverse browser:touch`, EMULATED).** `scripts/browser/touch-regression.mjs` — dependency-free raw CDP against the production bundle (`next build` then the script starts `next start` and a throw-away headless Chrome; JSON results go to the OS temp dir; exit 1 on any failed assertion). 390×844 @3:

- **A — joystick owner survives look replacement (mobile UA).** Finger A holds the stick fully (backward — the Hub spawn faces the gated Cannabis portal 11 m ahead); finger B lands, drags and lifts on the canvas six times, one cycle ending in a `touchcancel` delivered to the canvas; a third finger presses the stick rim, drags away and lifts; finally a real `touchCancel` of every finger. Result: thumb offset 28 px (full) throughout, movement vector (0, −1) throughout, avatar 10.3–12.2 m per cycle (two runs), every new B claims look and turns the camera (±0.9 rad), canvas `touchCount 0 / lookTouchId null` after every lift and the cancel, the steal attempt changes neither vector nor thumb, zero joystick `pointercancel`; cancel-all recentres the stick, releases the canvas and stops the avatar (≤ 0.03 m in 0.5 s); no console error.
- **B — desktop-UA touch.** The same four drags under a mobile and a desktop Chrome UA: horizontal and vertical directions match (no double inversion). Magnitude differs (0.375 vs 1.125 rad per 60 px) — the open caveat of §16.2, not compared.
- **C — jump ownership.** With a canvas touch active: owner press holds `jump`; a second finger pressing and lifting on the button does not release it; the unrelated canvas touch ending does not release it; the owner lifting does; jump then still lifts the avatar (0.58 → 5.41 m) and lands; zero jump `pointercancel`.
- **D — existing contract.** Canvas fills the viewport with an exact camera aspect in portrait and landscape; canvas and container `touch-action: none`; directory closed by default with joystick / jump shown, opens / closes by tap hiding / restoring them; Hub → Cannabis → `gateRequired` with **zero** cannabis requests.

**REAL-PHONE INPUT SIGNOFF — PASS** (human test by Nic on the production build; REAL PHONE — device / browser not recorded).

- **Human verified:** held-joystick movement stayed continuous through repeated lifting and re-placing of the camera-look finger; a deliberate look-finger brush across the joystick did not steal or reset movement; camera look direction felt correct; nothing stayed stuck after the fingers were released; overall input / camera feel reported as smooth ("it all feels really good"), with only future camera-speed tuning mentioned.
- **Automated production-browser verified only:** owner-specific jump behaviour (check C above). The human tester could not directly observe jump ownership, and no separate human jump observation was recorded.

**Still not claimed.** This is one phone on one occasion, not iOS / Android certification. Still open: cross-device / cross-browser coverage; physical safe areas and browser chrome; pull-to-refresh and double-tap behaviour where applicable; thermal / GPU performance; the desktop-UA touch magnitude difference and the Mediator pointer-lock / `preventDefault` gating (§16.2, handed to the AWE library); camera-speed tuning with representative art. The emulated desktop-UA check proves direction only.
