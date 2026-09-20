# NRVNAVerse Spatial Data Pipeline — M0 Step 2B.1

| Field | Value |
|---|---|
| **Status** | VERIFIED (2026-09-19) — authoritative spatial source, validator, deterministic generator, generated global scene + 4 chunks + spatial index, placement registry migrated to generated data, tests, browser smoke. **Since M0 Step 2B.2 the runtime boots from the generated global scene and loads exactly one chunk selectively** (see [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md)); the compatibility full scene is no longer requested by the runtime. |
| **App** | `apps/the-nrvnaverse` (THE NRVNAVerse, spatial interface) |
| **Builds on** | [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) (M0 Step 2A) · [`NRVNAVERSE_DESTINATION_MANIFEST.md`](./NRVNAVERSE_DESTINATION_MANIFEST.md) (M0 Step 1) |
| **Governing decisions** | D-004 (stable ids are identity), D-006 (auth ≠ gates), D-013 (Ghost boundary), D-014 (no dependency changes), D-016 (application-layer chunk orchestration); Landmark §6, §7, §9 |
| **Not in scope here** | runtime chunk loading/unloading and `loadingChunk` (done in **2B.2**, documented in the runtime doc), portal sensors (2B.3), prefetch/cache (2B.4), age verification, gate persistence, jurisdiction policy |

M0 is **not** complete after Step 2B.1/2B.2; the Landmark stays at v0.1. No new architectural decision was needed — D-004, D-006 and D-016 govern this work.

---

## 1. The pipeline

```
AUTHORITATIVE PHYSICAL SOURCE (hand-edited, committed)
  apps/the-nrvnaverse/spatial/source/scene.m0.json            complete authored M0 scene (all 33 components)
  apps/the-nrvnaverse/spatial/source/spatial-config.m0.json   world id · global membership · chunks · placements
        │
        ▼  validate  (reads packages/nrvna-manifest/generated/destinations.json — canonical, read-only)
        ▼  generate  (deterministic; node scripts/spatial/cli.mjs)
GENERATED RUNTIME ARTIFACTS (derived, committed, never hand-edited)
  apps/the-nrvnaverse/public/data/static-scene.json               compatibility FULL scene  ← validation/debugging only since 2B.2
  apps/the-nrvnaverse/public/data/spatial/global-scene.json       components independent of any chunk  ← runtime boot source (2B.2)
  apps/the-nrvnaverse/public/data/spatial/chunks/<key>.json       one file per logical M0 chunk (4)     ← fetched one at a time, after the gate (2B.2)
  apps/the-nrvnaverse/public/data/spatial/spatial-index.json      destinationId → chunkKey → spawn · chunk data URLs · globalSceneUrl
        │
        ▼
RUNTIME (2B.1, historical): index → placement registry → same-scene teleport in the full compatibility scene
RUNTIME (2B.2, current):    index → global scene boot → gate → fetch + validate + stage ONE chunk → teleport → retire the previous chunk
```

| Layer | File | Role |
|---|---|---|
| Pure pipeline (validate + generate, no I/O) | `apps/the-nrvnaverse/scripts/spatial/pipeline.mjs` | dependency-free Node ESM, JSDoc-typed, strict-checked via `tsconfig.strict.json` (`checkJs`), imported directly by the tests |
| CLI (file system) | `apps/the-nrvnaverse/scripts/spatial/cli.mjs` | `validate` · `generate` · `check` |
| Package scripts | `apps/the-nrvnaverse/package.json` | `spatial:validate`, `spatial:generate`, `spatial:check` (scripts only — no dependency change, `pnpm-lock.yaml` untouched) |
| Runtime index loader | `src/lib/spatial/spatial-index.ts`, `src/lib/spatial/spatial-index-source.ts` | `parseSpatialIndex` (structural + finite checks), `registryFromSpatialIndex`, `FetchSpatialIndexSource` (`/data/spatial/spatial-index.json`) |
| Placement registry consumer | `src/lib/app-store.ts` → `AweSpatialAdapter` | registry is built from the loaded index at boot; `placements.m0.ts` is **deleted** |
| Runtime chunk consumer (2B.2) | `src/lib/spatial/chunk-data-source.ts`, `chunk-payload.ts`, `chunk-orchestrator.ts` | `FetchChunkDataSource` fetches `chunks[key].dataUrl`; `parseChunkPayload` validates envelope + component records (schema, `worldId`, `chunkKey`, component ids) before any engine mutation; the orchestrator keeps one active chunk |

No CMS, no generalized world-authoring platform, no automatic spatial-grid partitioner: M0 uses explicit logical chunk membership.

## 2. Canonical vs derived — who owns what

| Data | Owner | Canonical? | May contain |
|---|---|---|---|
| Destination **identity** and metadata: `id`, `slug`, `name`, `webUrl`, `kind`, `primaryDistrictId`, `categories`, `tags`, `gates`, `ageRestriction`, `auth.roles`, `analyticsId`, relationships, status | `packages/nrvna-manifest/manifests/*.json` | **yes** | never coordinates, chunk keys, spawns (validator rejects extra fields; tested) |
| `destinations.json`, `directory.json` | `packages/nrvna-manifest/generated/` | no (derived) | — |
| **Physical organisation**: which authored components are global, which chunk owns which components, where each destination spawns | `apps/the-nrvnaverse/spatial/source/spatial-config.m0.json` | **authoritative for physical placement only** | never names, URLs, categories, tags, analytics ids, gates, age policy, business relationships (`unexpected-field` rejects any extra key; tested) |
| Authored scene geometry | `apps/the-nrvnaverse/spatial/source/scene.m0.json` | authoritative for geometry | scene components only |
| Compatibility scene, global scene, chunk files, spatial index | `apps/the-nrvnaverse/public/data/` | no (derived) | physical data only |

Direction of resolution (D-004):

```
destinationId ──manifest──▶ identity, gates, worldId
destinationId ──spatial config / index──▶ chunkKey ──▶ spawn      ALLOWED
chunkKey ──▶ destination identity                                  NEVER
```

Chunk keys (`hub`, `music`, `fashion-culture`, `cannabis-21`) are replaceable implementation details. They are never written to a URL (`?chunk=` is never emitted — tested since Step 1), never used as identity, and Ghost's 10 000-unit spatial-grid convention was not adopted. `portals-index.json` does not exist and is not generated.

## 3. Authoritative source format (`spatial-config.m0.json`, schema v1)

```jsonc
{
  "schemaVersion": 1,
  "worldId": "the-nrvnaverse",            // must equal spatialDestination.worldId of the placed destinations
  "scene": "scene.m0.json",               // plain file name next to the config
  "global": { "componentIds": [ … ] },    // components that exist independent of any chunk
  "chunks": [
    { "key": "hub", "label": "Hub", "componentIds": [ … ] },   // key: lowercase kebab-case ≤ 64 chars (doubles as file name)
    …
  ],
  "placements": [
    { "destinationId": "dst_…", "chunkKey": "hub", "spawn": { "position": { "x": 0, "y": 1, "z": 6 }, "yaw": 0 } },
    …
  ]
}
```

`yaw` is the orientation around the world Y axis in radians (`0` faces −Z, the engine's avatar forward) — the same spawn shape `AweSpatialRuntime.placeVisitor` has used since Step 2A. Every key outside this shape is rejected.

## 4. Global component model (derived from the actual Step 2A scene, not from Ghost's sets)

The 33 authored components are accounted for exactly once:

| Owner | Components | Reason |
|---|---|---|
| **global** (7) | `Player` (avatar), `vrm-anims`, `lighting`, `background`, `envmap`, `fog`, `ground` (terrain) | needed before/independent of any destination chunk: the visitor's avatar and animation set, world-wide environment singletons, and the single shared 420 m ground plane every chunk stands on |
| `hub` (5) | `platform-hub`, `marker-hub`, `label-hub`, `path-west`, `path-east` | the Hub platform and the two paths radiating from it |
| `music` (7) | `platform-music`, `marker-music`, `label-music`, `platform-music-artist`, `marker-music-artist`, `label-music-artist`, `path-music-north` | Music District + Placeholder Artist + the path between them |
| `fashion-culture` (7) | `platform-fashion-culture`, `marker-fashion-culture`, `label-fashion-culture`, `platform-fashion-culture-brand`, `marker-fashion-culture-brand`, `label-fashion-culture-brand`, `path-fashion-north` | Fashion / Culture District + Placeholder Brand + path |
| `cannabis-21` (7) | `platform-cannabis-21`, `gate-wall-north/south/west/east`, `label-cannabis-21`, `label-cannabis-21-closed` | the walled 21+ enclosure |

Connecting paths are owned by the chunk they originate from (Hub for the east/west paths, the district for the northern paths). A test asserts `global ∪ chunks == scene` and pairwise disjointness.

## 5. Chunks and placements (M0)

| Chunk key | Destinations (stable id → chunk) |
|---|---|
| `hub` | THE NRVNAVerse Hub `dst_7g19n1vm9ackw8a0` |
| `music` | Music District `dst_gm3xs4a3tws7bgh3`, Placeholder Artist `dst_1qtfn9qjg9kf6jyd` |
| `fashion-culture` | Fashion / Culture District `dst_9c4wxtpec8awsx1q`, Placeholder Fashion / Culture Brand `dst_tgfh5h5jvm3wj0w7` |
| `cannabis-21` | 21+ Cannabis District `dst_441dtdafq3e3ehjn`, NRVNA Farms Placeholder `dst_vfkz626za0vra89j` |

Seven placements, migrated verbatim from the Step 2A `placements.m0.ts` coordinates (stable ids unchanged, not regenerated). The two cannabis destinations have valid physical placements; the age gate is **not** encoded here — it comes from the manifest and the adapter refuses travel before any placement is used (Step 2A behaviour, unchanged).

## 6. Generated artifacts

| Artifact | Shape | Size (bytes, LF) |
|---|---|---|
| `public/data/static-scene.json` (compatibility full scene — not requested by the runtime since 2B.2) | exactly the authored scene (33 components) | 36 954 |
| `public/data/spatial/global-scene.json` | same scene envelope, 7 global components | 9 763 |
| `public/data/spatial/chunks/hub.json` | `{ schemaVersion, worldId, chunkKey, components }` | 5 375 |
| `public/data/spatial/chunks/music.json` | 〃 | 7 321 |
| `public/data/spatial/chunks/fashion-culture.json` | 〃 | 7 578 |
| `public/data/spatial/chunks/cannabis-21.json` | 〃 | 7 335 |
| `public/data/spatial/spatial-index.json` | `{ schemaVersion, worldId, globalSceneUrl, chunks: { key: { dataUrl } }, destinations: { id: { chunkKey, spawn } } }` | 1 863 |

Data-size baseline only (text JSON, no binaries); no asset optimisation or budgets were attempted. Chunk files carry no destination ids, names, URLs, gates or roles (tested). The index reveals which chunk a destination maps to — that small mapping is not the gated content.

Determinism: no timestamps, no random ids, no machine paths, index keys sorted by code-unit order, components in authored scene order (the source is committed, so its order is stable), fixed 2-space JSON + trailing LF. Two consecutive `spatial:generate` runs write nothing the second time; the test suite asserts byte-identical output across runs and across reordered chunks/placements, and asserts the committed files match a fresh generation. `spatial:check` additionally fails on leftover chunk files that the source no longer declares. Line endings are normalised before comparison so a `core.autocrlf` checkout on Windows is not reported as stale (the generator always writes LF).

## 7. Validation rules (`validateSpatialSource`, stable codes)

`unsupported-schema-version` · `invalid-world-id` · `world-id-mismatch` (config world has no destinations, or a placed destination declares a different `worldId`) · `invalid-scene-ref` · `invalid-scene` / `component-id-mismatch` · `unexpected-field` (any key outside the schema — the structural guard that keeps gates and metadata out) · `duplicate-chunk-key` · `invalid-chunk-key` (unsafe file name) · `invalid-chunk-label` · `empty-chunk` · `unknown-component` · `duplicate-component-ref` · `global-component-in-chunk` · `component-in-multiple-chunks` · `unassigned-component` (authored component neither global nor owned) · `invalid-destination-id` · `unknown-destination` · `placement-not-the-nrvnaverse` (manifest platform ≠ `the-nrvnaverse`) · `duplicate-placement` · `unknown-chunk` · `invalid-spawn` (non-finite / malformed position) · `invalid-orientation` (non-finite `yaw`) · `missing-placement` (active THE NRVNAVerse destination without a placement). Stale output is caught by `spatial:check` and by the test suite.

The validator reads the canonical generated destination set only to verify references; it never copies gates or metadata into the spatial source.

## 8. How to …

**Edit a spawn.** Change the `spawn` of the placement in `spatial/source/spatial-config.m0.json` → `pnpm --filter the-nrvnaverse spatial:generate` → commit the source and the regenerated `public/data/spatial/spatial-index.json` together. There is no second place to edit: `placements.m0.ts` no longer exists and `src/` contains no destination ids or coordinates (tested).

**Move or add a component.** Edit the geometry in `spatial/source/scene.m0.json`; list its id in exactly one `chunks[].componentIds` (or in `global.componentIds` if it must exist independent of any chunk) → regenerate → commit the source, `static-scene.json`, the affected chunk file and (if global) `global-scene.json`. A component left unassigned fails validation.

**Add a chunk.** Append `{ key, label, componentIds }` (kebab-case key) → regenerate → a new `public/data/spatial/chunks/<key>.json` appears and the index gains its `dataUrl`. Removing a chunk requires deleting its file too (`spatial:check` reports the leftover).

**Add a destination.** First add the manifest (Manifest doc §7) and regenerate `destinations.json`; then add its placement here. An active THE NRVNAVerse destination without a placement fails `spatial:check` and the test suite.

**Regenerate / check.** `pnpm --filter the-nrvnaverse spatial:validate` · `spatial:generate` · `spatial:check` (CI-style staleness check). The vitest suite (`pnpm --filter the-nrvnaverse test`) repeats the staleness check.

## 9. Why the compatibility full scene still exists

In 2B.1 the Step 2A runtime still mounted the full scene (`/data/static-scene.json`), so the pipeline emitted it as a **generated** compatibility output from the same authoritative source that produces the global scene and the chunks. **Since 2B.2 the runtime no longer requests it** (tested: no `src/` file references the path; the store boots the runtime from `spatialIndex.globalSceneUrl`). The file is kept as a generated artifact for validation and debugging — e.g. `pnpm run-space --scene=apps/the-nrvnaverse/public/data/static-scene.json` still smoke-tests the complete authored world headlessly — and because it costs nothing to keep deterministic. There is still exactly one hand-edited scene (`spatial/source/scene.m0.json`).

## 10. Step 2B.2 runtime handoff — consumed

What 2B.2 built on the inputs listed here (details in the runtime doc):

1. `spatial-index.json` → `parseSpatialIndex` at boot gives `globalSceneUrl` (runtime boot source), `chunks[key].dataUrl` (the only source of chunk URLs) and `destinations[id] = { chunkKey, spawn }` (placement registry).
2. `global-scene.json` is the payload passed to the official `createSpace`: the world boots with avatar, animations, environment and ground only.
3. `chunks/<key>.json` is fetched **one chunk at a time, only after the manifest gate**, validated with `parseChunkPayload` (schema, `worldId`, `chunkKey`, component records) and instantiated through the official `space.components.create(data, { abort })` / `destroy` while the previous chunk stays alive; `loadingChunk` is reported through `SpatialTravelPhase` for real cross-chunk work only.

Order per travel (D-006, implemented): `canTravel(id)` (manifest gates) → only if allowed resolve `chunkKey` → same chunk? teleport : fetch → validate → stage → teleport → commit → retire old. The URL contract stays `?destination=<id>`.

## 11. Cannabis pre-fetch gate requirement (implemented at the application layer in 2B.2)

- The runtime **never fetches `chunks/cannabis-21.json`** (or any chunk mapped from a destination whose manifest carries `gates[]`) before that gate has passed: the adapter evaluates the gate before the orchestrator is asked for anything. Tested at adapter, store and browser level for the initial deep link, directory click and back/forward paths; the Hub chunk is the fallback for a gated initial deep link.
- The spatial index may reveal `cannabis-21` as the chunk key of the two gated destinations. That mapping is not the gated experience content; the content is the chunk payload.
- No age verification, gate persistence, jurisdiction policy or bypass exists or is designed here. The manifest's placeholder `enforced: false` remains deliberately unconsulted: a declared gate stops spatial entry.
- Known limitation (non-M0): files under `public/` are statically served, so "not fetched by the runtime" is an application-layer guarantee, not a hosting-layer one. A real gate will need server-side enforcement of gated chunk URLs — a later decision.

## 12. Tests (`pnpm --filter the-nrvnaverse test` — 69 tests, was 35)

`test/spatial-pipeline.test.ts` (valid M0 source; seven ids exactly once; four chunks with the expected grouping; complete component accounting; compatibility scene == source; no metadata in chunk files/index; cannabis boundary; rejection of unsupported schema, duplicate/invalid chunk keys, unknown component, multiple ownership, global-in-chunk, unassigned component, empty chunk, unknown/invalid destination, unknown chunk, non-finite spawn/orientation, wrong world id, duplicate placement, missing placement, non-THE-NRVNAVerse destination, smuggled gates/metadata; determinism incl. reordered source; committed outputs match; manifests remain coordinate/chunk-free), `test/spatial-index.test.ts` (index parsing, registry from generated data, malformed index rejected, source abstraction, **no hard-coded ids/coordinates in `src/`**, store uses `registryFromSpatialIndex`). The existing adapter/URL tests now build their registry from the committed index (`placementRef` is `chunk:<key>`). No existing test was weakened.

## 13. Ghost boundary

No Ghost code was read, copied, cherry-picked or depended on for this task; `packages/engine`, `packages/engine-edit`, `packages/studio` are untouched; no `contrib/*` branch created; `ghost/experimental` not pushed. The chunk file format, index model and membership model were derived from the Step 2A scene and the official runtime's needs, not from Ghost's chunk-manager or `portals-index.json` (D-013).
