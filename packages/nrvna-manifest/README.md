# @nrvnaverse/manifest

Canonical, versioned destination manifest contract for the NRVNAVerse ecosystem (schema v1), the seven M0 placeholder manifests, validation, deterministic generated views, the deep-link contract and the spatial adapter boundary.

Full documentation: [`docs/NRVNAVERSE_DESTINATION_MANIFEST.md`](../../docs/NRVNAVERSE_DESTINATION_MANIFEST.md).

## Layout

```
manifests/    source manifests — authoritative, one JSON per destination
generated/    destinations.json, directory.json — derived, never hand-edit
src/          schema, validate, resolve, deep-link, generate, spatial-adapter (browser-safe)
src/node/     filesystem tooling + CLI (Node only, exported as @nrvnaverse/manifest/node)
test/         vitest
```

## Scripts

```bash
pnpm --filter @nrvnaverse/manifest validate        # validate source manifests
pnpm --filter @nrvnaverse/manifest generate        # (re)write generated views
pnpm --filter @nrvnaverse/manifest generate:check  # fail if generated views are stale
pnpm --filter @nrvnaverse/manifest check           # tsc --noEmit
pnpm --filter @nrvnaverse/manifest test            # vitest run
```

Running `generate` twice without source changes produces no diff.

## Rules in one breath

- `id` is identity, generated once and committed; slugs/URLs/coordinates resolve *to* it.
- `auth` = roles; `gates` = visitor entry requirements; never mixed.
- Districts are navigation (`primaryDistrictId`), not taxonomy (`categories`, `tags`, `relatedDestinationIds`).
- Only `active` destinations are entered as public destinations.
- No runtime dependencies.
