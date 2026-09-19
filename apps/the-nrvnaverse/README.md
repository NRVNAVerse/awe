# THE NRVNAVerse — application shell (M0 Step 1)

The spatial interface of the NRVNAVerse ecosystem (`worlds.nrvnaverse.com`). Adapted from `examples/starter`.

**This build has no 3D runtime.** It establishes application identity, runtime loading of the generated destination data, the `?destination=<id>` deep-link contract, destination resolution with hub fallback, the application state boundary, loading/error/notice UI, and the spatial travel adapter boundary that M0 Step 2 fills in. See [`docs/NRVNAVERSE_DESTINATION_MANIFEST.md`](../../docs/NRVNAVERSE_DESTINATION_MANIFEST.md).

## Run

From the monorepo root (after the workspace has been installed):

```bash
pnpm --filter the-nrvnaverse dev     # http://localhost:3000/?destination=dst_441dtdafq3e3ehjn
pnpm --filter the-nrvnaverse check   # tsc --noEmit
pnpm --filter the-nrvnaverse test    # vitest run
pnpm --filter the-nrvnaverse build   # next build --turbopack
```

## Where to look

- `src/lib/app-identity.ts` — product identity constants.
- `src/lib/app-state.ts` — pure state model (`boot → resolvingDestination → ready | error`; planned phases reserved).
- `src/lib/app-store.ts` — boot sequence, URL re-resolution, in-app navigation.
- `src/lib/destination-source.ts` — runtime data source interface (`/api/destinations` by default).
- `src/lib/spatial/planned-spatial-adapter.ts` — the M0 Step 1 adapter; reports travel as unavailable.
- `src/app/api/destinations/route.ts` — serves `packages/nrvna-manifest/generated/destinations.json`.
- `src/components/*` — deliberately plain prototype UI.

## Deep links

`/?destination=<stable-id>&from=<token>&ref=<code>&return=<id|web>` — only these parameters are read; `return` resolves through manifest data and is never a URL. Unknown or non-public destinations fall back to the Hub with a notice.
