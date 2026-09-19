# NRVNAVerse Destination Manifest Contract — M0 Step 1

| Field | Value |
|---|---|
| **Status** | VERIFIED (2026-09-19) — schema v1, seven placeholder manifests, generator, app shell, tests |
| **Owner package** | `packages/nrvna-manifest` (`@nrvnaverse/manifest`) |
| **Consumer app** | `apps/the-nrvnaverse` (THE NRVNAVerse, spatial interface) |
| **Governing decisions** | D-001, D-003, D-004, D-005, D-006, D-007, D-008, D-013, D-014 |

This document describes what M0 Step 1 built, the rules the data must follow, and the exact boundary where M0 Step 2 (spatial travel / chunk integration) plugs in. It does not change any locked principle in `NRVNAVERSE_LANDMARK.md`.

---

## 1. Where things live

| What | Path | Authoritative? |
|---|---|---|
| Schema (types, enums, constants) | `packages/nrvna-manifest/src/schema.ts` | yes — the contract |
| **Source manifests** (one JSON per destination) | `packages/nrvna-manifest/manifests/*.json` | **yes** — hand-edited, committed |
| Validation | `packages/nrvna-manifest/src/validate.ts` | — |
| Resolution + deep links | `packages/nrvna-manifest/src/resolve.ts`, `src/deep-link.ts` | — |
| Generator (pure) + Node tooling/CLI | `packages/nrvna-manifest/src/generate.ts`, `src/node/*` | — |
| **Generated views** | `packages/nrvna-manifest/generated/destinations.json`, `directory.json` | **no** — derived; never hand-edit |
| Spatial adapter boundary (interface only) | `packages/nrvna-manifest/src/spatial-adapter.ts` | — |
| Application shell | `apps/the-nrvnaverse/` | — |

File names under `manifests/` are the current slug for readability only. The file name is **not** identity; renaming a file changes nothing about the destination.

## 2. Schema version rule

- Every manifest carries `schemaVersion`. The current version is **1** (`DESTINATION_SCHEMA_VERSION`).
- The validator rejects any other value. Generated files carry the same `schemaVersion`; the app refuses data with a different version.
- Changing the contract in a way that existing manifests would not satisfy requires bumping the version, a migration for the committed manifests, and a `DECISIONS.md` entry if a locked principle is touched. Additive, backwards-compatible optional fields do not exist in v1 by design (all fields are required with explicit `null`/`[]`), so any shape change is a version bump.

## 3. Stable ID rule (D-004)

- `id` is the identity: `dst_` + 16 lowercase Crockford-base32 characters (`DESTINATION_ID_PATTERN`).
- IDs are generated **once** when a manifest is authored (`createDestinationId(randomBytes)`), committed, and never regenerated. The generator only reads ids; it never creates them.
- Coordinates, chunk keys, spawn positions, slugs, URLs and domains are derived attributes that resolve **to** an id. The validator rejects any extra field inside `spatialDestination` for platform `the-nrvnaverse` precisely so coordinates cannot creep into the manifest.
- `analyticsId` must equal `id` in v1 (`analytics-id-mismatch` otherwise). `destinations.json` still publishes an explicit `index.byAnalyticsId` map so consumers never assume the equality.
- Slugs are unique among non-archived destinations; renaming a slug means moving the old one into `previousSlugs` (redirect list). A previous slug may not be another destination's current slug.

The seven committed ids:

| Destination | kind | slug | id |
|---|---|---|---|
| THE NRVNAVerse Hub | hub | `hub` | `dst_7g19n1vm9ackw8a0` |
| Music District | district | `music` | `dst_gm3xs4a3tws7bgh3` |
| Fashion / Culture District | district | `fashion-culture` | `dst_9c4wxtpec8awsx1q` |
| 21+ Cannabis District | district | `cannabis-21` | `dst_441dtdafq3e3ehjn` |
| Placeholder Artist | artist | `placeholder-artist` | `dst_1qtfn9qjg9kf6jyd` |
| Placeholder Fashion / Culture Brand | brand | `placeholder-fashion-culture-brand` | `dst_tgfh5h5jvm3wj0w7` |
| NRVNA Farms Placeholder | brand | `nrvna-farms-placeholder` | `dst_vfkz626za0vra89j` |

## 4. Auth vs gates (D-006)

| Block | Meaning | Shape | Allowed values (v1) |
|---|---|---|---|
| `auth` | permissions / roles | `{ roles: [{ role, principalIds: string[] }] }` | `administrator`, `moderate`, `speak`, `build` |
| `gates` | visitor entry requirements | `[{ kind, config: { … } }]` | `age21`, `ticket`, `member`, `invite` |

The validator rejects structurally detectable confusion (`auth-gates-confusion`): a bare string array as `auth` (the experimental chunk `auth: string[]` shape), a gate kind used as a role, a role used as a gate kind, or `gates`/`entry` keys inside `auth`.

Age model: an `age21` gate requires `ageRestriction.minimumAge >= 21` and vice versa (`age-gate-mismatch`). A destination whose primary district carries an `age21` gate must declare it itself (`gate-inheritance`) so gate evaluation never needs district traversal. Gate `config` values are placeholders (`verification: "placeholder"`, `enforced: false`); no gate is enforced in M0 Step 1 and no legal/jurisdiction truth is asserted (`jurisdictions.policy: "placeholder"`).

## 5. Other model rules encoded in the validator

- Districts are navigation, not taxonomy (D-005): `primaryDistrictId` is separate from `categories[]`, `tags[]` and `relatedDestinationIds[]`. Hubs and districts have `primaryDistrictId: null`; other kinds may reference exactly one district (must exist, must be `kind: "district"`).
- Entertainment / Education / Commerce are `capabilities[]` (D-007), not kinds.
- `event` is a reserved kind (D-008); no event manifests exist yet.
- Exactly one `active` hub must exist (`hub-count`).
- No self-references (`self-reference`); all related ids must exist (`unknown-related-destination`).
- `spatialDestination` platform variants: `the-nrvnaverse` (`worldId` only), `awe-box` (`url`), `awe-partner` (`url`, `partnerId`), `external` (`url`), or `null`.
- Only `status: "active"` destinations are entered as public destinations; `draft`, `hidden`, `archived` fall back to the hub.

## 6. Generated outputs

`pnpm --filter @nrvnaverse/manifest generate` validates the source set and writes:

- `generated/destinations.json` — all destinations (every status) sorted by id, each with a derived `spatialUrl`; `index.bySlug`, `index.byPreviousSlug`, `index.byAnalyticsId`; `hubId`.
- `generated/directory.json` — navigation view: `hub`, `districts[]` (active districts, each with its active member destinations), `unassigned[]`.

Determinism: no timestamps, stable id ordering, deep-sorted keys, fixed serialization. `pnpm --filter @nrvnaverse/manifest generate:check` fails when the committed files are stale; the test suite asserts the same. **`portals-index.json` is not canonical** and is not generated; a physical/spatial index may be derived later, once real placement exists (Step 2+).

## 7. How to add a destination manually

1. Generate an id once: `node -e "const c=require('crypto');const A='0123456789abcdefghjkmnpqrstvwxyz';const b=c.randomBytes(16);console.log('dst_'+[...b].map(x=>A[x%32]).join(''))"` (or call `createDestinationId` from the package).
2. Copy the closest manifest in `packages/nrvna-manifest/manifests/`, name the file `<slug>.json`, set `id` **and** `analyticsId` to the new id, set `slug`, `kind`, `name`, `primaryDistrictId` (or `null`), `webUrl` (`https://www.nrvnaverse.com/worlds/<slug>`), and `updatedAt` (UTC ISO 8601).
3. Declare `gates` and `ageRestriction` consistently (both or neither for 21+), keep `auth.roles` for roles only.
4. Run `pnpm --filter @nrvnaverse/manifest validate`, then `generate`, then `test`.
5. Commit the manifest **and** the regenerated `generated/*.json` together.

## 8. Deep-link contract (app)

`worlds.nrvnaverse.com/?destination=<stable-id>[&from=<token>][&ref=<code>][&return=<id|web>]`

- Only these four parameters are read (`DEEP_LINK_PARAMS`). Everything else — including the experimental `?chunk=` — is ignored and reported as a non-fatal `ignored-param` issue.
- `return` is a token, never a URL: a destination id resolves to that destination's manifest `webUrl` (public destinations only); `web` resolves to `https://www.nrvnaverse.com/`. Anything else is dropped with an `unsafe-return` issue, so `return` can never become an open redirect.
- Unknown / malformed / non-public destination → hub, with a non-fatal notice (`unknown-destination`, `invalid-destination`, `destination-not-public`).

## 9. Application state (app)

Implemented phases: `boot → resolvingDestination → ready | error` (`apps/the-nrvnaverse/src/lib/app-state.ts`, pure and unit-tested).
Reserved, **not implemented**: `loadingGlobals`, `loadingChunk`, `traveling`, `arrived`, `gateRequired` (`PLANNED_PHASES`). They correspond to `SpatialTravelPhase` in the adapter interface.

## 10. What M0 Step 1 does NOT implement

- No 3D runtime is mounted; the app does not instantiate the AWE engine yet (the dependencies are declared so Step 2 can, but no engine code runs).
- No chunk streaming, no portals, no travel, no spawn/placement data — `PlannedSpatialAdapter` reports `unavailable` for every destination.
- No gate enforcement, no age verification, no jurisdiction logic, no cannabis checkout, no commerce.
- No `portals-index.json`, no physical placement registry.
- No slug-based routing in the app (slug helpers exist in the package for the web interface).
- No auth/identity system; `auth.roles` are data only.
- No web interface (www.nrvnaverse.com) code; it will consume the same generated data.
- Legacy `?chunk=` is ignored, not supported.

## 11. Exact boundary for M0 Step 2 (spatial integration)

Step 2 implements `SpatialTravelAdapter` (`packages/nrvna-manifest/src/spatial-adapter.ts`) inside `apps/the-nrvnaverse/src/lib/spatial/` and swaps it for `PlannedSpatialAdapter` in `spatial-panel.tsx` / the store:

```
destinationId ──► adapter.resolvePlacement(id) ──► { worldId, placementRef }   (adapter-private)
destinationId ──► adapter.travelTo(id)         ──► arrived | gate-required | failed
adapter.onPhase(...)                           ──► drives PLANNED_PHASES in app state
```

Constraints the adapter must honour:

1. Its placement registry is keyed by destination **id**; the manifest never gains coordinates (validator enforces this).
2. Gate evaluation (`gates[]`) happens in the adapter/application before gated content is fetched (D-006); enforcement policy stays configurable at the content layer (Landmark §9).
3. It may be backed by any engine-side mechanism. It must not require Ghost's experimental branch to build, and any reuse of his chunk manager / portal component follows D-013 (his review before reworking or republishing).
4. The URL contract stays `?destination=<id>`; the adapter must never write `?chunk=`.
5. `destinations.json` remains the runtime input; a derived spatial index (if needed) is generated, never hand-authored.

## 12. Dependency status

Both new packages declare only dependencies that already exist in `pnpm-lock.yaml` at identical versions (the app mirrors `examples/starter` plus `@nrvnaverse/manifest`; the manifest package has zero runtime dependencies and uses `typescript`, `vitest`, `tsx`, `@types/node` for tooling). No validation library was added: `zod` exists in the lockfile only transitively, so declaring it would itself be a lockfile change, and the contract is small enough for explicit checks with stable error codes.

Adding workspace packages requires new `importers` entries in `pnpm-lock.yaml`; that lockfile change is a separately approved step (D-014) and was not performed in M0 Step 1.
