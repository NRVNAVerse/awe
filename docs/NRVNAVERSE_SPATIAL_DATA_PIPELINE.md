# NRVNAVerse Spatial Data Pipeline — M0 Step 2B.1 + 2B.3 + 2B.4B.2

| Field | Value |
|---|---|
| **Status** | VERIFIED (2026-09-19) — authoritative spatial source, validator, deterministic generator, generated global scene + 4 chunks + spatial index, placement registry migrated to generated data, tests, browser smoke. **Since M0 Step 2B.2 the runtime boots from the generated global scene and loads exactly one chunk selectively** (see [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md)); the compatibility full scene is no longer requested by the runtime. **Since M0 Step 2B.3 the source may declare physical portal bindings (`portals[]`, optional, additive) and the index carries a generated `portals` section** (§14). **Since M0 Step 2B.4B.2 the index is the version root of the physical artifacts: `globalSceneUrl` and every `chunks[key].dataUrl` carry a deterministic content-version query so the global scene and chunk files are delivered `immutable`** (§15). |
| **App** | `apps/the-nrvnaverse` (THE NRVNAVerse, spatial interface) |
| **Builds on** | [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) (M0 Step 2A) · [`NRVNAVERSE_DESTINATION_MANIFEST.md`](./NRVNAVERSE_DESTINATION_MANIFEST.md) (M0 Step 1) |
| **Governing decisions** | D-004 (stable ids are identity), D-006 (auth ≠ gates), D-013 (Ghost boundary), D-014 (no dependency changes), D-016 (application-layer chunk orchestration); Landmark §6, §7, §9 |
| **Not in scope here** | runtime chunk loading/unloading and `loadingChunk` (done in **2B.2**) and the portal controller / sensor seam (done in **2B.3**) — both documented in the runtime doc; application-level chunk cache / prefetch (**rejected for M0 by the 2B.4B.1 audit**, §15); age verification, gate persistence, jurisdiction policy |

M0 is **not** complete after Step 2B.1/2B.2/2B.3/2B.4B.2 (2B.4C remains); the Landmark stays at v0.1. No new architectural decision was needed — D-004, D-006, D-013 and D-016 govern this work.

---

## 1. The pipeline

```
AUTHORITATIVE PHYSICAL SOURCE (hand-edited, committed)
  apps/the-nrvnaverse/spatial/source/scene.m0.json            complete authored M0 scene (all 40 components: 33 + 7 portal sensors)
  apps/the-nrvnaverse/spatial/source/spatial-config.m0.json   world id · global membership · chunks · placements · portals (2B.3)
        │
        ▼  validate  (reads packages/nrvna-manifest/generated/destinations.json — canonical, read-only)
        ▼  generate  (deterministic; node scripts/spatial/cli.mjs)
GENERATED RUNTIME ARTIFACTS (derived, committed, never hand-edited)
  apps/the-nrvnaverse/public/data/static-scene.json               compatibility FULL scene  ← validation/debugging only since 2B.2; not versioned
  apps/the-nrvnaverse/public/data/spatial/global-scene.json       components independent of any chunk  ← runtime boot source (2B.2); delivered at …?v=<content version>, immutable (2B.4B.2)
  apps/the-nrvnaverse/public/data/spatial/chunks/<key>.json       one file per logical M0 chunk (4)     ← fetched one at a time, after the gate (2B.2); delivered at …?v=<content version>, immutable (2B.4B.2)
  apps/the-nrvnaverse/public/data/spatial/spatial-index.json      destinationId → chunkKey → spawn · versioned chunk data URLs · versioned globalSceneUrl · portals: componentId → { chunkKey, destinationId } (2B.3)
                                                                   ← VERSION ROOT: fixed URL, `public, max-age=0, must-revalidate` (2B.4B.2)
        │
        ▼
RUNTIME (2B.1, historical): index → placement registry → same-scene teleport in the full compatibility scene
RUNTIME (2B.2, current):    index → global scene boot → gate → fetch + validate + stage ONE chunk → teleport → retire the previous chunk
```

| Layer | File | Role |
|---|---|---|
| Pure pipeline (validate + generate, no I/O) | `apps/the-nrvnaverse/scripts/spatial/pipeline.mjs` | dependency-free Node ESM (built-in `node:crypto` only, for the 2B.4B.2 content digest), JSDoc-typed, strict-checked via `tsconfig.strict.json` (`checkJs`), imported directly by the tests |
| CLI (file system) | `apps/the-nrvnaverse/scripts/spatial/cli.mjs` | `validate` · `generate` · `check` |
| Package scripts | `apps/the-nrvnaverse/package.json` | `spatial:validate`, `spatial:generate`, `spatial:check` (scripts only — no dependency change, `pnpm-lock.yaml` untouched) |
| HTTP cache policy (2B.4B.2) | `apps/the-nrvnaverse/next.config.ts` (`spatialDataHeaders`) | `headers()` rules: index `public, max-age=0, must-revalidate`; global scene / chunk paths `public, max-age=31536000, immutable` **only** when the request carries `?v=<32 lowercase hex>` (§15) |
| Runtime index loader | `src/lib/spatial/spatial-index.ts`, `src/lib/spatial/spatial-index-source.ts` | `parseSpatialIndex` (structural + finite checks), `registryFromSpatialIndex`, `FetchSpatialIndexSource` (`/data/spatial/spatial-index.json`) |
| Placement registry consumer | `src/lib/app-store.ts` → `AweSpatialAdapter` | registry is built from the loaded index at boot; `placements.m0.ts` is **deleted** |
| Runtime chunk consumer (2B.2) | `src/lib/spatial/chunk-data-source.ts`, `chunk-payload.ts`, `chunk-orchestrator.ts` | `FetchChunkDataSource` fetches `chunks[key].dataUrl`; `parseChunkPayload` validates envelope + component records (schema, `worldId`, `chunkKey`, component ids) before any engine mutation; the orchestrator keeps one active chunk |

No CMS, no generalized world-authoring platform, no automatic spatial-grid partitioner: M0 uses explicit logical chunk membership.

## 2. Canonical vs derived — who owns what

| Data | Owner | Canonical? | May contain |
|---|---|---|---|
| Destination **identity** and metadata: `id`, `slug`, `name`, `webUrl`, `kind`, `primaryDistrictId`, `categories`, `tags`, `gates`, `ageRestriction`, `auth.roles`, `analyticsId`, relationships, status | `packages/nrvna-manifest/manifests/*.json` | **yes** | never coordinates, chunk keys, spawns (validator rejects extra fields; tested) |
| `destinations.json`, `directory.json` | `packages/nrvna-manifest/generated/` | no (derived) | — |
| **Physical organisation**: which authored components are global, which chunk owns which components, where each destination spawns, **which physical sensor component navigates to which stable id** (2B.3) | `apps/the-nrvnaverse/spatial/source/spatial-config.m0.json` | **authoritative for physical placement and portal bindings only** | never names, URLs, categories, tags, analytics ids, gates, age policy, business relationships (`unexpected-field` rejects any extra key; tested) |
| Authored scene geometry | `apps/the-nrvnaverse/spatial/source/scene.m0.json` | authoritative for geometry | scene components only |
| Compatibility scene, global scene, chunk files, spatial index | `apps/the-nrvnaverse/public/data/` | no (derived) | physical data only |

Direction of resolution (D-004):

```
destinationId ──manifest──▶ identity, gates, worldId
destinationId ──spatial config / index──▶ chunkKey ──▶ spawn      ALLOWED
portal componentId ──spatial config / index──▶ destinationId       ALLOWED (a sensor handle referencing identity; 2B.3)
chunkKey ──▶ destination identity                                  NEVER
portal componentId / position ──▶ destination identity             NEVER (the component id is not identity; the binding is a reference)
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
  ],
  "portals": [                                   // OPTIONAL, additive (2B.3): omit for an empty portal set
    { "componentId": "portal-hub-music", "chunkKey": "hub", "destinationId": "dst_…" },
    …
  ]
}
```

`yaw` is the orientation around the world Y axis in radians (`0` faces −Z, the engine's avatar forward) — the same spawn shape `AweSpatialRuntime.placeVisitor` has used since Step 2A. Every key outside this shape is rejected. A portal is `componentId → chunkKey → destinationId` and nothing else (no coordinates, spawn, URL, gate, name or category — `unexpected-field`); the schema version stays **1** because the field is optional and every committed consumer parses an index without it (tested).

## 4. Global component model (derived from the actual Step 2A scene, not from Ghost's sets)

The 40 authored components (33 + 7 portal sensors since 2B.3) are accounted for exactly once:

| Owner | Components | Reason |
|---|---|---|
| **global** (7) | `Player` (avatar), `vrm-anims`, `lighting`, `background`, `envmap`, `fog`, `ground` (terrain) | needed before/independent of any destination chunk: the visitor's avatar and animation set, world-wide environment singletons, and the single shared 420 m ground plane every chunk stands on |
| `hub` (8) | `platform-hub`, `marker-hub`, `label-hub`, `path-west`, `path-east`, **`portal-hub-music`, `portal-hub-fashion`, `portal-hub-cannabis`** (2B.3) | the Hub platform, the two paths radiating from it and its three portal sensors |
| `music` (9) | `platform-music`, `marker-music`, `label-music`, `platform-music-artist`, `marker-music-artist`, `label-music-artist`, `path-music-north`, **`portal-music-hub`, `portal-music-artist`** | Music District + Placeholder Artist + the path between them + two portal sensors |
| `fashion-culture` (9) | `platform-fashion-culture`, `marker-fashion-culture`, `label-fashion-culture`, `platform-fashion-culture-brand`, `marker-fashion-culture-brand`, `label-fashion-culture-brand`, `path-fashion-north`, **`portal-fashion-hub`, `portal-fashion-brand`** | Fashion / Culture District + Placeholder Brand + path + two portal sensors |
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
| `public/data/static-scene.json` (compatibility full scene — not requested by the runtime since 2B.2) | exactly the authored scene (40 components) | 46 113 (2B.1: 36 954) |
| `public/data/spatial/global-scene.json` | same scene envelope, 7 global components | 9 763 (unchanged) |
| `public/data/spatial/chunks/hub.json` | `{ schemaVersion, worldId, chunkKey, components }` | 9 288 (5 375) |
| `public/data/spatial/chunks/music.json` | 〃 | 9 929 (7 321) |
| `public/data/spatial/chunks/fashion-culture.json` | 〃 | 10 216 (7 578) |
| `public/data/spatial/chunks/cannabis-21.json` | 〃 | 7 335 (unchanged) |
| `public/data/spatial/spatial-index.json` | `{ schemaVersion, worldId, globalSceneUrl, chunks: { key: { dataUrl } }, destinations: { id: { chunkKey, spawn } }, portals: { componentId: { chunkKey, destinationId } } }` — since 2B.4B.2 `globalSceneUrl` and every `dataUrl` end in `?v=<32 lowercase hex>` (§15) | 2 827 (2B.3: 2 652; 2B.1: 1 863) |

Data-size baseline only (text JSON, no binaries); no asset optimisation or budgets were attempted. Chunk files carry no destination ids, names, URLs, gates or roles (tested). The index reveals which chunk a destination maps to — that small mapping is not the gated content.

Determinism: no timestamps, no random ids, no machine paths, index keys sorted by code-unit order, components in authored scene order (the source is committed, so its order is stable), fixed 2-space JSON + trailing LF; content-version tokens (§15) depend on the serialized artifact bytes alone. Two consecutive `spatial:generate` runs write nothing the second time; the test suite asserts byte-identical output across runs and across reordered chunks/placements, and asserts the committed files match a fresh generation. `spatial:check` additionally fails on leftover chunk files that the source no longer declares. Line endings are normalised before comparison so a `core.autocrlf` checkout on Windows is not reported as stale (the generator always writes LF).

## 7. Validation rules (`validateSpatialSource`, stable codes)

`unsupported-schema-version` · `invalid-world-id` · `world-id-mismatch` (config world has no destinations, or a placed destination / portal target declares a different `worldId`) · `invalid-scene-ref` · `invalid-scene` / `component-id-mismatch` · `unexpected-field` (any key outside the schema — the structural guard that keeps gates and metadata out) · `duplicate-chunk-key` · `invalid-chunk-key` (unsafe file name) · `invalid-chunk-label` · `empty-chunk` · `unknown-component` · `duplicate-component-ref` · `global-component-in-chunk` · `component-in-multiple-chunks` · `unassigned-component` (authored component neither global nor owned) · `invalid-destination-id` · `unknown-destination` · `placement-not-the-nrvnaverse` (manifest platform ≠ `the-nrvnaverse`) · `duplicate-placement` · `unknown-chunk` · `invalid-spawn` (non-finite / malformed position) · `invalid-orientation` (non-finite `yaw`) · `missing-placement` (active THE NRVNAVerse destination without a placement).

Portal codes (2B.3, references only — the validator never copies gate truth): `invalid-portals` (present but not an array) · `invalid-portal` (entry not an object) · `unexpected-field` (any key beyond `componentId`, `chunkKey`, `destinationId`) · `invalid-component-ref` (missing / non-string componentId) · `duplicate-portal` (same component bound twice) · `unknown-component` · `global-portal-component` (a global component cannot be a portal) · `portal-chunk-mismatch` (component owned by another chunk than declared) · `unknown-chunk` · `portal-not-sensor` (collider not `enabled: true` + `isSensor: true`) · `invalid-destination-id` · `unknown-destination` · `portal-not-the-nrvnaverse` · `world-id-mismatch`. Multiple portals to one destination, same-chunk targets and gated targets are valid. Stale output is caught by `spatial:check` and by the test suite.

The validator reads the canonical generated destination set only to verify references; it never copies gates or metadata into the spatial source.

## 8. How to …

**Edit a spawn.** Change the `spawn` of the placement in `spatial/source/spatial-config.m0.json` → `pnpm --filter the-nrvnaverse spatial:generate` → commit the source and the regenerated `public/data/spatial/spatial-index.json` together. There is no second place to edit: `placements.m0.ts` no longer exists and `src/` contains no destination ids or coordinates (tested).

**Move or add a component.** Edit the geometry in `spatial/source/scene.m0.json`; list its id in exactly one `chunks[].componentIds` (or in `global.componentIds` if it must exist independent of any chunk) → regenerate → commit the source, `static-scene.json`, the affected chunk file and (if global) `global-scene.json`. A component left unassigned fails validation.

**Add a chunk.** Append `{ key, label, componentIds }` (kebab-case key) → regenerate → a new `public/data/spatial/chunks/<key>.json` appears and the index gains its `dataUrl`. Removing a chunk requires deleting its file too (`spatial:check` reports the leftover).

**Add a destination.** First add the manifest (Manifest doc §7) and regenerate `destinations.json`; then add its placement here. An active THE NRVNAVerse destination without a placement fails `spatial:check` and the test suite.

**Add a portal (2B.3).** Author a mesh with `collider: { enabled: true, rigidbodyType: "FIXED", colliderType: "CUBE", isSensor: true }` in `scene.m0.json`, list its id in the `componentIds` of the chunk where the visitor encounters it, append `{ componentId, chunkKey, destinationId }` to `portals` → regenerate → commit the source, `static-scene.json`, the chunk file and `spatial-index.json`. Keep it clear of every spawn of that chunk (a test checks this) so an arrival never re-triggers it. The runtime binds it automatically whenever its chunk is active.

**Regenerate / check.** `pnpm --filter the-nrvnaverse spatial:validate` · `spatial:generate` · `spatial:check` (CI-style staleness check). The vitest suite (`pnpm --filter the-nrvnaverse test`) repeats the staleness check. Since 2B.4B.2 any change to the global scene or a chunk file also rewrites the index (its `globalSceneUrl` / `dataUrl` token changes, §15) — commit the artifact and the index together; `generate` prints each file's `v=` token.

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

## 12. Tests (`pnpm --filter the-nrvnaverse test` — 69 tests at 2B.1, 177 at 2B.3, 235 at 2B.4B.2)

`test/spatial-pipeline.test.ts` (valid M0 source; seven ids exactly once; four chunks with the expected grouping; complete component accounting; compatibility scene == source; no metadata in chunk files/index; cannabis boundary; rejection of unsupported schema, duplicate/invalid chunk keys, unknown component, multiple ownership, global-in-chunk, unassigned component, empty chunk, unknown/invalid destination, unknown chunk, non-finite spawn/orientation, wrong world id, duplicate placement, missing placement, non-THE-NRVNAVerse destination, smuggled gates/metadata; determinism incl. reordered source; committed outputs match; manifests remain coordinate/chunk-free; **2B.3:** seven portal bindings, deterministic sorted `portals`, ownership by declared chunk, identity-free chunk payloads, coordinate/gate-free bindings, gated / same-chunk / shared targets allowed, no spawn overlap, optional-additive, and every portal rejection code above), `test/spatial-index.test.ts` (index parsing, registry from generated data, malformed index rejected, source abstraction, **no hard-coded ids/coordinates in `src/`**, store uses `registryFromSpatialIndex`; **2B.3:** seven bindings parsed, missing `portals` → empty set, malformed bindings rejected, store wiring). The existing adapter/URL tests build their registry from the committed index (`placementRef` is `chunk:<key>`). No existing test was weakened (two assertions became data-derived when the Music chunk grew to 9 components and the Hub became a portal target). **2B.4B.2:** nine content-versioning tests in `spatial-pipeline.test.ts` (exactly one valid token per URL on the unchanged file path; token = SHA-256 prefix of the exact serialized text, independently recomputed, one-byte sensitivity; determinism across runs and reordered source; Hub content change moves only the Hub token and the old URL disappears from the index; global content change moves only `globalSceneUrl`; spawn / label / portal-target changes move no token; schema 1, no new field, no id/gate/token in payloads; cannabis versioned like every artifact; committed tokens are the digests of the committed files), `test/spatial-delivery.test.ts` (consumers pass the whole URL through: `FetchChunkDataSource` / `FetchSpatialIndexSource` with a stubbed `fetch`, parser opacity, source scan for token parsing, no token in navigation URLs) and `test/cache-policy.test.ts` (the `next.config.ts` rules evaluated with Next's own `path-to-regexp` / `matchHas`). Four exact-URL assertions were tightened to the versioned shape.

## 13. Ghost boundary

No Ghost code was read, copied, cherry-picked or depended on for this task; `packages/engine`, `packages/engine-edit`, `packages/studio` are untouched; no `contrib/*` branch created; `ghost/experimental` not pushed. The chunk file format, index model and membership model were derived from the Step 2A scene and the official runtime's needs, not from Ghost's chunk-manager or `portals-index.json` (D-013). The 2B.3 portal binding model likewise: no `portals-index.json` is generated, the old coordinate-keyed model stays unused, and the sensor components are official mesh + `isSensor` colliders rather than Ghost's engine-level `portal` component.

## 14. Physical portal bindings (M0 Step 2B.3)

```
spatial-config.m0.json  portals[]: { componentId, chunkKey, destinationId }        (authoritative; references only)
        │  validate: component authored · owned by the declared chunk (never global) · enabled sensor collider
        │            · stable-id shape · destination exists · THE NRVNAVerse · same world
        ▼  generate
spatial-index.json      "portals": { "<componentId>": { "chunkKey", "destinationId" } }   (sorted by component id)
chunks/<key>.json       the sensor mesh as plain scene geometry — NO destination id, URL, gate or metadata
manifest                identity + gate truth (unchanged; evaluated at travel time by the adapter)
```

Separation kept: **chunk payload = physical world data · index portal entry = physical sensor → stable destination reference · manifest = destination identity / gate truth.** The generated key is the physical component id (a sensor handle, never identity); the value carries the owning chunk (so the runtime can bind exactly the active chunk's portals) and the canonical target. `parseSpatialIndex()` (`src/lib/spatial/spatial-index.ts`) returns `portals: Record<string, { chunkKey, destinationId }>` and treats a missing field as an empty set (schema version 1 unchanged); it checks the chunk reference and the stable-id shape. Consumption (controller, sensor seam, trigger semantics, browser proof) is documented in the runtime doc §13.

The seven committed bindings and their owners are listed in the runtime doc §13; `pnpm --filter the-nrvnaverse spatial:generate` run twice writes nothing the second time, and the test suite asserts the committed index matches a fresh generation and that authoring order does not change the output.

## 15. Versioned delivery and HTTP cache policy (M0 Step 2B.4B.2)

**Why this and not an application cache.** The read-only 2B.4B.1 audit (2026-09-20, `next dev` and `next start`, Chrome over CDP) measured: cross-chunk travel ≈45 ms median locally (validation ≈0, staging ≈10 ms for the placeholder chunks); every *repeat* chunk fetch was a **conditional HTTP revalidation** because both servers answered `Cache-Control: public, max-age=0` plus a weak `ETag` / `Last-Modified`, so each revisit paid one round trip (≈243 B on the wire, 304). Under a bounded 150 ms latency profile a repeat travel cost ≈175 ms; the same travel with a long-lived cache policy simulated in the browser cost ≈36 ms with 0 body bytes from disk cache. The bottleneck was therefore the **HTTP delivery contract**, not the runtime. Decision **B — HTTP delivery follow-up only**: no application raw-payload / validated-payload cache (the browser HTTP cache already holds the bytes; a second copy adds memory, invalidation logic and a stale-data surface for no measured gain), no predictive / neighbour prefetch for M0 (it would fetch chunks the visitor may never enter — and for a gated neighbour it would violate gate-before-fetch, D-006), no instantiated-chunk retention, no Service Worker / CacheStorage / IndexedDB / localStorage, no change to the orchestrator or travel architecture.

**Contract.**

```
spatial-index.json                                  VERSION ROOT — fixed URL, no token required, Cache-Control: public, max-age=0, must-revalidate
  ├─ globalSceneUrl  = /data/spatial/global-scene.json?v=<token>          Cache-Control: public, max-age=31536000, immutable
  └─ chunks[key].dataUrl = /data/spatial/chunks/<key>.json?v=<token>      Cache-Control: public, max-age=31536000, immutable
token = first 32 lowercase hex chars (128 bits) of SHA-256 over the exact UTF-8 serialized artifact written to disk
```

- **File names are unchanged** (`global-scene.json`, `chunks/<key>.json`); the token lives only in the URL the index hands out. No output-file lifecycle or stale-file cleanup is introduced (hashed file names were deliberately not adopted — that would be a separate design).
- **Generation order** (`generateSpatialArtifacts`): compatibility scene → global scene text → chunk texts → tokens from those exact texts → index. The index depends on the artifacts, never the reverse; the index and the compatibility scene are not versioned. `SpatialArtifacts.versions` maps each versioned file to its token; `contentVersion()` / `versionedDataUrl()` are exported and `node:crypto` is the only addition (no dependency, `pnpm-lock.yaml` untouched).
- **Invalidation.** Same content → same token → same URL → cache hit. Changed content → different token → a URL the browser has never seen → fetched fresh; the old entry can never satisfy the new index (tested: a Hub geometry change moves only the Hub token; Music, Fashion, Cannabis and the global scene keep theirs; the old token is absent from the new index). Placement/spawn, label and portal-binding edits change the index only, never a chunk token.
- **Schema and identity untouched.** `schemaVersion` stays 1; `globalSceneUrl` / `dataUrl` remain plain strings (no new field); destination ids, chunk keys and gates are exactly as before. The token is delivery metadata: it neither authorises nor prefetches anything, and it is not identity (D-004).
- **Runtime opacity.** `parseSpatialIndex` passes the strings through verbatim; `FetchChunkDataSource` and `AweSpatialRuntime.init` hand the whole URL to `fetch`. Nothing strips `?v`, derives a chunk path or rebuilds a URL (source-scan tested). The token never reaches a navigation URL — the browser contract stays `?destination=<stable-id>&from=spatial`.
- **Cache policy** (`next.config.ts`, `headers()`; rules are matched before the `public/` file system, and `send` only fills in `Cache-Control` when none is set): `/data/spatial/spatial-index.json` → `public, max-age=0, must-revalidate` (explicit, not a framework accident); `/data/spatial/global-scene.json` and `/data/spatial/chunks/:chunk([a-z0-9-]+).json` → `public, max-age=31536000, immutable` **only** with `has: [{ type: "query", key: "v", value: "[0-9a-f]{32}" }]` (Next anchors it as `^[0-9a-f]{32}$`; confirmed against the installed Next 16.1.6 `matchHas`).
- **Unversioned safety.** The same paths without `?v=`, with a malformed / short / uppercase token, or with another parameter name match no rule of ours and keep the framework default (`public, max-age=0` + weak ETag → revalidated). Old bookmarks, debug requests and stale code therefore never receive a year-long lifetime. A 404 under a valid-shaped token carries Next's `private, no-cache, no-store` — never `immutable`. `static-scene.json` is untouched.
- **Gate boundary unchanged.** Cannabis: stable destination → adapter gate → `gateRequired` → **zero** requests for the versioned cannabis chunk URL (browser-verified below). The versioned cannabis URL is served immutable like every artifact — a delivery detail that does not authorise, prefetch or weaken D-006. Known non-M0 limitation, unchanged and **not** solved by this step: the static chunk file is not server-authorised content.

**Production verification (2026-09-20, `pnpm --filter the-nrvnaverse build` → `next start --port 3200`, tokens read from the served index).** `spatial-index.json` → `200`, `public, max-age=0, must-revalidate`, weak ETag; versioned global scene / Music / Cannabis URLs → `200`, `public, max-age=31536000, immutable`; unversioned Music and global-scene paths, a 31-char token, an uppercase token, `?version=` → `public, max-age=0` (no `immutable`, no long lifetime); index with a token → still `must-revalidate`; `static-scene.json` → `public, max-age=0`; missing chunk with a valid-shaped token → `404`, `private, no-cache, no-store, max-age=0, must-revalidate`.

**Browser verification (fresh headless-Chrome profile, GPU-backed, raw CDP, same production server).** Boot: index 200 (1 035 B wire), versioned global scene 200 (2 845 B), versioned Hub 200 (1 396 B). Hub → Music first visit: network 200, 1 394 B, `chunk-fetch` 22.6 ms. Every later revisit of a versioned URL (Hub ×5, Music ×4, Fashion ×1): `fromDiskCache: true`, **0 wire bytes**, Resource Timing `transferSize 0` / `deliveryType "cache"`, **no `If-None-Match` sent** — no conditional round trip; `chunk-fetch` 2.2–4.3 ms, orchestrator `cross-chunk-travel` 8–14 ms. Hub → Cannabis: `gateRequired`, zero requests, URL unchanged. Bounded 150 ms-latency check: cache-cold Fashion first visit `chunk-fetch` 153.6 ms / travel 165 ms; Fashion revisit 7.7 ms / 19.3 ms; Hub and Music revisits 3–4 ms / 12–14 ms (2B.4B.1 measured ≈175 ms per repeat travel under the same profile with revalidation). Reload in the same profile: index revalidated (304, 259 B, `If-None-Match` sent), global scene and Hub from disk cache with 0 bytes. No console error; the only console output is pre-existing upstream Three/VRM warnings. Cannabis chunk requests across the whole run: 0.

2B.4B is **complete** with this step; 2B.4C (budgets / mobile / adaptive quality) remains and M0 is still incomplete. Landmark version unchanged (0.1); no new decision was needed.
