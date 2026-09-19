# THE NRVNAVerse — spatial interface (M0 Step 2A)

The spatial interface of the NRVNAVerse ecosystem (`worlds.nrvnaverse.com`). Adapted from `examples/starter`.

**This build mounts the official upstream AWE engine** in a single minimal prototype scene and proves that stable destination ids resolve, through the `SpatialTravelAdapter`, to physical placements: deep links place the visitor, the directory travels between ungated destinations by same-scene teleport, the URL stays `?destination=<stable-id>`, and gated (21+) destinations are refused at the boundary. It is a technical prototype, not world design. See [`docs/NRVNAVERSE_SPATIAL_RUNTIME.md`](../../docs/NRVNAVERSE_SPATIAL_RUNTIME.md) and [`docs/NRVNAVERSE_DESTINATION_MANIFEST.md`](../../docs/NRVNAVERSE_DESTINATION_MANIFEST.md).

Not in this build: chunk streaming, 3D portals, age verification / compliance policy, commerce, auth, the web interface (M0 Step 2B and later).

## Run

From the monorepo root (after `pnpm install --frozen-lockfile`):

```bash
pnpm --filter the-nrvnaverse dev     # http://localhost:3000/?destination=dst_gm3xs4a3tws7bgh3
pnpm --filter the-nrvnaverse check   # tsc --noEmit (upstream strictness, engine sources included)
pnpm --filter the-nrvnaverse exec tsc --noEmit -p tsconfig.strict.json   # strict check of NRVNAVerse-owned pure modules
pnpm --filter the-nrvnaverse test    # vitest run (pure adapter / state / URL tests)
pnpm --filter the-nrvnaverse build   # next build --turbopack
```

Keep the tab in the foreground while it loads: a background tab has no `requestAnimationFrame`, the upstream intro stalls and the engine's 60 s load timeout puts the app in the error phase (reload to recover).

## Where to look

- `src/lib/app-state.ts` — pure state model: `boot → resolvingDestination → loadingGlobals → ready | gateRequired`, `traveling → arrived | gateRequired`; `loadingChunk` reserved.
- `src/lib/app-store.ts` — boot sequence, engine mount, initial placement before reveal, travel, URL updates, back/forward, disposal.
- `src/lib/spatial/awe-spatial-runtime.ts` — the official AWE runtime mount (only file importing `@oncyberio/engine`).
- `src/lib/spatial/placement-registry.ts` + `placements.m0.ts` — **the only place that knows coordinates**; keyed by stable destination id.
- `src/lib/spatial/awe-spatial-adapter.ts` — `SpatialTravelAdapter` implementation (`canTravel`, `resolvePlacement`, `travelTo`, `onPhase`), gate boundary.
- `src/lib/perf.ts` — `performance.mark/measure` instrumentation (no telemetry).
- `src/components/*` — canvas mount, plain HUD, directory (travel control), travel/gate banner, official touch controls.
- `public/data/static-scene.json` — minimal M0 scene; `public/assets/anims` — starter animation clips.

## Deep links

`/?destination=<stable-id>&from=<token>&ref=<code>&return=<id|web>` — only these parameters are read; `return` resolves through manifest data and is never a URL. Unknown or non-public destinations fall back to the Hub with a notice; gated destinations load the world at the Hub with a gate-required state. The app never writes `?chunk=` or coordinates.
