# @nrvnaverse/manifest

Canonical, versioned destination manifest contract for the NRVNAVerse ecosystem (schema v1), the seven M0 placeholder manifests, validation, deterministic generated views, the deep-link contract and the spatial adapter boundary.

Full documentation: [`docs/NRVNAVERSE_DESTINATION_MANIFEST.md`](../../docs/NRVNAVERSE_DESTINATION_MANIFEST.md).

## Layout

```
manifests/    source manifests — authoritative, one JSON per destination
generated/    destinations.json, directory.json, web-destinations.json — derived, never hand-edit
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

### WEB handoff export — `generated/web-destinations.json`

The machine-readable input for the www.nrvnaverse.com Explore pages (e.g. a Wix CMS import; nothing here touches Wix). One entry per **active** destination with web-facing fields only: `id`, `slug`, `name`, `kind`, `description`, `primaryDistrict`, `categories`, public `tags` (milestone markers `m0` / `placeholder` removed; `placeholder: true` says "label as coming soon"), `webUrl`, `spatial.deepLink` (`https://worlds.nrvnaverse.com/?destination=<id>&from=web&return=web`), `commerceRefs`, `media`, `updatedAt`. No auth, owner org ids, jurisdiction policy, capabilities or analytics fields.

**Gate policy is preserved:** a gated destination (Cannabis 21, NRVNA Farms) is `listing: "age-gated"` with its `gate` (`age21`, minimum age 21) and **no** spatial link (`spatial: { enterable: false, deepLink: null }`) — the web applies its own age gate before showing it, and nothing offers a way into the world that the world itself refuses. Regenerate with `generate`; `generate:check` fails when it is stale.

## Rules in one breath

- `id` is identity, generated once and committed; slugs/URLs/coordinates resolve *to* it.
- `auth` = roles; `gates` = visitor entry requirements; never mixed.
- Districts are navigation (`primaryDistrictId`), not taxonomy (`categories`, `tags`, `relatedDestinationIds`).
- Only `active` destinations are entered as public destinations.
- No runtime dependencies.
