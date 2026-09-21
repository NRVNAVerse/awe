# THE NRVNAVerse — spatial interface (M0 Foundation, architecture prototype complete)

The spatial interface of the NRVNAVerse ecosystem (`worlds.nrvnaverse.com`). A Next.js 16 app adapted from `examples/starter` that mounts the **official upstream AWE engine** and proves the M0 Foundation architecture over placeholder content. It is a technical prototype, not world design; nothing here is deployed.

Authoritative descriptions: [`docs/NRVNAVERSE_LANDMARK.md`](../../docs/NRVNAVERSE_LANDMARK.md) (M0 completion gate, risks), [`docs/NRVNAVERSE_DESTINATION_MANIFEST.md`](../../docs/NRVNAVERSE_DESTINATION_MANIFEST.md) (identity contract), [`docs/NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](../../docs/NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) (physical data, delivery, budgets), [`docs/NRVNAVERSE_SPATIAL_RUNTIME.md`](../../docs/NRVNAVERSE_SPATIAL_RUNTIME.md) (runtime, portals, lifecycle, mobile shell).

## What the app proves

- **Official AWE runtime** — `createSpace` / `ComponentManager.create` / `destroy` and the starter's controls, camera rig and mover; `packages/engine` is unmodified.
- **Stable destination ids** — every destination is a committed `dst_…` id from `@nrvnaverse/manifest`; slugs, URLs, chunk keys and coordinates are derived and never identity. Deep links are `?destination=<id>` only (`?chunk=` is ignored, never written).
- **Generated physical spatial index** — one authoritative source (`spatial/source/`) generates the global scene, four chunk files and `public/data/spatial/spatial-index.json` (`destinationId → chunkKey → spawn`, portal bindings) deterministically; `spatial:check` fails on stale, missing or unexpected artifacts.
- **Global scene + selective chunk loading** — the engine boots from the global scene (avatar, lighting, ground …) and exactly one chunk is instantiated at a time.
- **Stage-before-retire cross-chunk travel** — fetch → validate → stage the target while the current chunk stays alive → teleport → commit → retire; any failure leaves the current chunk and position intact; latest request wins, stale work can never commit or write the URL.
- **Same-chunk teleport** — travel inside the active chunk moves the visitor without any fetch or rebuild.
- **Stable-id portals** — authored sensor components bound (in the generated index) to destination ids route a sensor enter into the very same `travelToDestination(id)` path.
- **Gate-before-fetch** — manifest `gates[]` are evaluated before any gated chunk fetch; Hub → 21+ Cannabis yields `gateRequired` with zero cannabis chunk requests. This is an application-layer rule, not server-side authorization, and no verification or bypass exists.
- **Content-addressed runtime artifacts** — global scene and chunks are `<name>.<sha256[0:32]>.json` served `immutable` behind the revalidated index; revisits are disk-cache hits with no conditional round trip.
- **Lifecycle hardening** — asynchronous orchestrator / runtime disposal, boot / dispose coordination, boot-failure recovery, stale-portal protection; boot → dispose → re-boot works on one page.
- **Mobile-aware prototype shell** — shared touch / narrow-viewport interaction mode; directory closed by default on phones with a top-right opener and an in-panel close control; touch controls hidden while the directory is open; status banners visible in both states; touch-aware instructions; `viewport-fit=cover` + safe-area offsets; `touch-action` / `overscroll-behavior` on the world surface. Verified on **emulated** mobile only.
- **Warning-only spatial budgets** — `spatial:check` warns (never fails) when a runtime global-scene / chunk artifact exceeds 64 KiB or 64 components.

## Run

From the monorepo root (after `pnpm install --frozen-lockfile`):

```bash
pnpm --filter the-nrvnaverse dev              # http://localhost:3000/?destination=dst_gm3xs4a3tws7bgh3
pnpm --filter the-nrvnaverse check            # tsc --noEmit + strict pass over NRVNAVerse-owned modules and pipeline scripts
pnpm --filter the-nrvnaverse test             # vitest (pure state / adapter / orchestrator / pipeline / shell tests, no DOM)
pnpm --filter the-nrvnaverse spatial:validate # validate spatial/source against the scene and the canonical destination set
pnpm --filter the-nrvnaverse spatial:generate # regenerate public/data (content-addressed names; removes stale versions)
pnpm --filter the-nrvnaverse spatial:check    # fail on stale / missing / unexpected artifacts; print budget warnings
pnpm --filter the-nrvnaverse build            # next build --turbopack
```

Keep the tab in the foreground while it loads: a background tab has no `requestAnimationFrame`, the upstream intro stalls and the engine's 60 s load timeout puts the app in the error phase (reload to recover).

## Where to look

- `src/lib/app-state.ts` — pure state model: `boot → resolvingDestination → loadingGlobals → loadingChunk(initial) → ready | gateRequired | error`; `ready | arrived | gateRequired → traveling → [loadingChunk(travel)] → arrived | gateRequired`.
- `src/lib/app-store.ts` — boot sequence (destinations → spatial index → runtime → initial chunk → reveal), travel, URL / history, run lifecycle (`booting → running → disposing`), disposal.
- `src/lib/spatial/awe-spatial-runtime.ts` — the official AWE runtime mount (the only file importing `@oncyberio/engine`): controls, chunk stage / retire wrappers, sensor seam, asynchronous disposal.
- `src/lib/spatial/awe-spatial-adapter.ts` — `SpatialTravelAdapter`: eligibility (gates first), placement resolution from the generated index, travel through the orchestrator.
- `src/lib/spatial/chunk-orchestrator.ts` — one active chunk; fetch → validate → stage → teleport → commit → retire; latest-request-wins; asynchronous shutdown.
- `src/lib/spatial/chunk-data-source.ts`, `chunk-payload.ts`, `component-batch.ts` — chunk fetch, envelope validation, all-or-nothing component creation.
- `src/lib/spatial/portal-controller.ts`, `sensor-subscription.ts` — active-chunk portal bindings → `travelToDestination(id)`.
- `src/lib/spatial/spatial-index.ts`, `spatial-index-source.ts`, `placement-registry.ts` — the generated index is the only source of chunk URLs and spawns (`src/` contains no coordinates or ids — tested).
- `spatial/source/` (authoritative) → `scripts/spatial/{pipeline,cli,budgets}.mjs` → `public/data/` (generated, never hand-edited).
- `src/lib/interaction-mode.ts` — touch / narrow / mobile mode shared by the shell and the touch controls.
- `src/components/*` — canvas mount, HUD shell (`app-shell.tsx`), directory (the travel control), travel / gate banner, notices, spatial diagnostics panel, official touch joystick and jump button.
- `src/lib/perf.ts` — `performance.mark/measure` + in-memory records (`boot→*`, `travel`, `chunk-*`), no telemetry.
- `public/assets/anims` — starter animation clips; `public/data/static-scene.json` — compatibility full scene for headless validation only (not requested by the runtime).

## Deep links

`/?destination=<stable-id>&from=<token>&ref=<code>&return=<id|web>` — only these parameters are read; `return` resolves through manifest data and is never a URL. Unknown or non-public destinations fall back to the Hub with a notice; gated destinations load the world at the Hub with a gate-required state. The app never writes `?chunk=`, coordinates, chunk keys, component ids or content digests to the URL.

## Not yet (post-M0)

- Real age verification / cannabis compliance policy, and server-authorized delivery of gated chunk files (today they are statically served; "never fetched before the gate" is an application-layer rule).
- Final visual world, real art and its optimization; adaptive quality (deferred until representative art exists).
- Real iOS / Android device validation of the mobile shell (emulated only so far).
- Multiplayer / presence / social, partner authoring, worlds / plots, analytics, commerce, the web interface.
- Production deployment and hosting of `worlds.nrvnaverse.com`.
