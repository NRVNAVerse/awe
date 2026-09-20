# NRVNAVerse Spatial Data Pipeline — M0 Step 2B.1 + 2B.3 + 2B.4B.2 + 2B.4C.2

| Field | Value |
|---|---|
| **Status** | VERIFIED (2026-09-19) — authoritative spatial source, validator, deterministic generator, generated global scene + 4 chunks + spatial index, placement registry migrated to generated data, tests, browser smoke. **Since M0 Step 2B.2 the runtime boots from the generated global scene and loads exactly one chunk selectively** (see [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md)); the compatibility full scene is no longer requested by the runtime. **Since M0 Step 2B.3 the source may declare physical portal bindings (`portals[]`, optional, additive) and the index carries a generated `portals` section** (§14). **Since M0 Step 2B.4B.2 the index is the version root of the physical artifacts: the global scene and every chunk are written under content-addressed file names (`global-scene.<digest>.json`, `chunks/<key>.<digest>.json`) that `globalSceneUrl` / `chunks[key].dataUrl` point at, so they are delivered `immutable`; an earlier query-only (`?v=`) form was rejected in independent review and corrected** (§15). |
| **App** | `apps/the-nrvnaverse` (THE NRVNAVerse, spatial interface) |
| **Builds on** | [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) (M0 Step 2A) · [`NRVNAVERSE_DESTINATION_MANIFEST.md`](./NRVNAVERSE_DESTINATION_MANIFEST.md) (M0 Step 1) |
| **Governing decisions** | D-004 (stable ids are identity), D-006 (auth ≠ gates), D-013 (Ghost boundary), D-014 (no dependency changes), D-016 (application-layer chunk orchestration); Landmark §6, §7, §9 |
| **Not in scope here** | runtime chunk loading/unloading and `loadingChunk` (done in **2B.2**) and the portal controller / sensor seam (done in **2B.3**) — both documented in the runtime doc; application-level chunk cache / prefetch (**rejected for M0 by the 2B.4B.1 audit**, §15); age verification, gate persistence, jurisdiction policy. **Since M0 Step 2B.4C.2 `spatial:check` also prints non-fatal initial warning budgets for the runtime artifacts (§16)** |

M0 is **not** complete after Step 2B.1/2B.2/2B.3/2B.4B.2/2B.4C.2 (independent review and integration of 2B.4C remain); the Landmark stays at v0.1. No new architectural decision was needed — D-004, D-006, D-009, D-013 and D-016 govern this work.

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
  apps/the-nrvnaverse/public/data/spatial/global-scene.<digest>.json   components independent of any chunk  ← runtime boot source (2B.2); CONTENT-ADDRESSED name, immutable (2B.4B.2)
  apps/the-nrvnaverse/public/data/spatial/chunks/<key>.<digest>.json   one file per logical M0 chunk (4)     ← fetched one at a time, after the gate (2B.2); CONTENT-ADDRESSED name, immutable (2B.4B.2)
  apps/the-nrvnaverse/public/data/spatial/spatial-index.json           destinationId → chunkKey → spawn · content-addressed chunk data URLs · content-addressed globalSceneUrl · portals: componentId → { chunkKey, destinationId } (2B.3)
                                                                        ← VERSION ROOT: fixed URL, `public, max-age=0, must-revalidate` (2B.4B.2)
        │
        ▼
RUNTIME (2B.1, historical): index → placement registry → same-scene teleport in the full compatibility scene
RUNTIME (2B.2, current):    index → global scene boot → gate → fetch + validate + stage ONE chunk → teleport → retire the previous chunk
```

| Layer | File | Role |
|---|---|---|
| Pure pipeline (validate + generate, no I/O) | `apps/the-nrvnaverse/scripts/spatial/pipeline.mjs` | dependency-free Node ESM (built-in `node:crypto` only, for the 2B.4B.2 content digest), JSDoc-typed, strict-checked via `tsconfig.strict.json` (`checkJs`), imported directly by the tests |
| CLI (file system) | `apps/the-nrvnaverse/scripts/spatial/cli.mjs` | `validate` · `generate` (writes the current set, removes stale content-addressed outputs of previous generations) · `check` (stale / missing / unexpected) — §15 |
| Package scripts | `apps/the-nrvnaverse/package.json` | `spatial:validate`, `spatial:generate`, `spatial:check` (scripts only — no dependency change, `pnpm-lock.yaml` untouched) |
| HTTP cache policy (2B.4B.2) | `apps/the-nrvnaverse/next.config.ts` (`spatialDataHeaders`) | `headers()` rules: index `public, max-age=0, must-revalidate`; the content-addressed paths `global-scene.:version([0-9a-f]{32}).json` and `chunks/:chunk([a-z0-9-]+).:version([0-9a-f]{32}).json` → `public, max-age=31536000, immutable`; no query condition (§15) |
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
| `public/data/spatial/global-scene.<digest>.json` (currently `global-scene.c1acc16bcc0dceb14da723dfd8ac0d77.json`) | same scene envelope, 7 global components | 9 763 (unchanged) |
| `public/data/spatial/chunks/hub.<digest>.json` (currently `hub.6a30542efff7a2e575edac1faf6679f4.json`) | `{ schemaVersion, worldId, chunkKey, components }` | 9 288 (5 375) |
| `public/data/spatial/chunks/music.<digest>.json` (currently `music.dffba466b06980f5e7adc5260538f70d.json`) | 〃 | 9 929 (7 321) |
| `public/data/spatial/chunks/fashion-culture.<digest>.json` (currently `fashion-culture.4cf8e4ca99a8bc9d19afc42e60816b24.json`) | 〃 | 10 216 (7 578) |
| `public/data/spatial/chunks/cannabis-21.<digest>.json` (currently `cannabis-21.47ef62cb39981c5a64bfe91a5dea4f41.json`) | 〃 | 7 335 (unchanged) |
| `public/data/spatial/spatial-index.json` | `{ schemaVersion, worldId, globalSceneUrl, chunks: { key: { dataUrl } }, destinations: { id: { chunkKey, spawn } }, portals: { componentId: { chunkKey, destinationId } } }` — since 2B.4B.2 `globalSceneUrl` and every `dataUrl` are the content-addressed file paths above, no query (§15) | 2 817 (2B.4B.2 query form: 2 827; 2B.3: 2 652; 2B.1: 1 863) |

`<digest>` = first 32 lowercase hex chars of SHA-256 over the file's exact bytes; the file name changes whenever the content changes (§15). The legacy unversioned names (`global-scene.json`, `chunks/<key>.json`) are no longer generated and are not served.

Data-size baseline only (text JSON, no binaries); no asset optimisation was attempted. Since 2B.4C.2 `spatial:check` prints warning-only initial budgets for these runtime artifacts (§16). Chunk files carry no destination ids, names, URLs, gates or roles (tested). The index reveals which chunk a destination maps to — that small mapping is not the gated content.

Determinism: no timestamps, no random ids, no machine paths, index keys sorted by code-unit order, components in authored scene order (the source is committed, so its order is stable), fixed 2-space JSON + trailing LF; content digests — and therefore file names (§15) — depend on the serialized artifact bytes alone. Two consecutive `spatial:generate` runs write and remove nothing the second time; the test suite asserts byte-identical output and identical file names across runs and across reordered chunks/placements, and asserts the committed files match a fresh generation with no stale or legacy file next to them. `spatial:check` additionally fails on any unexpected file in the output namespace (a stale content version, a chunk the source no longer declares, a legacy unversioned name). Line endings are normalised before comparison so a `core.autocrlf` checkout on Windows is not reported as stale (the generator always writes LF).

## 7. Validation rules (`validateSpatialSource`, stable codes)

`unsupported-schema-version` · `invalid-world-id` · `world-id-mismatch` (config world has no destinations, or a placed destination / portal target declares a different `worldId`) · `invalid-scene-ref` · `invalid-scene` / `component-id-mismatch` · `unexpected-field` (any key outside the schema — the structural guard that keeps gates and metadata out) · `duplicate-chunk-key` · `invalid-chunk-key` (unsafe file name) · `invalid-chunk-label` · `empty-chunk` · `unknown-component` · `duplicate-component-ref` · `global-component-in-chunk` · `component-in-multiple-chunks` · `unassigned-component` (authored component neither global nor owned) · `invalid-destination-id` · `unknown-destination` · `placement-not-the-nrvnaverse` (manifest platform ≠ `the-nrvnaverse`) · `duplicate-placement` · `unknown-chunk` · `invalid-spawn` (non-finite / malformed position) · `invalid-orientation` (non-finite `yaw`) · `missing-placement` (active THE NRVNAVerse destination without a placement).

Portal codes (2B.3, references only — the validator never copies gate truth): `invalid-portals` (present but not an array) · `invalid-portal` (entry not an object) · `unexpected-field` (any key beyond `componentId`, `chunkKey`, `destinationId`) · `invalid-component-ref` (missing / non-string componentId) · `duplicate-portal` (same component bound twice) · `unknown-component` · `global-portal-component` (a global component cannot be a portal) · `portal-chunk-mismatch` (component owned by another chunk than declared) · `unknown-chunk` · `portal-not-sensor` (collider not `enabled: true` + `isSensor: true`) · `invalid-destination-id` · `unknown-destination` · `portal-not-the-nrvnaverse` · `world-id-mismatch`. Multiple portals to one destination, same-chunk targets and gated targets are valid. Stale output is caught by `spatial:check` and by the test suite.

The validator reads the canonical generated destination set only to verify references; it never copies gates or metadata into the spatial source.

## 8. How to …

**Edit a spawn.** Change the `spawn` of the placement in `spatial/source/spatial-config.m0.json` → `pnpm --filter the-nrvnaverse spatial:generate` → commit the source and the regenerated `public/data/spatial/spatial-index.json` together. There is no second place to edit: `placements.m0.ts` no longer exists and `src/` contains no destination ids or coordinates (tested).

**Move or add a component.** Edit the geometry in `spatial/source/scene.m0.json`; list its id in exactly one `chunks[].componentIds` (or in `global.componentIds` if it must exist independent of any chunk) → regenerate → commit the source, `static-scene.json`, the index and the affected artifact under its **new** content-addressed name (Git shows the old name deleted and the new one added — `generate` removed the old file, §15). A component left unassigned fails validation.

**Add a chunk.** Append `{ key, label, componentIds }` (kebab-case key) → regenerate → a new `public/data/spatial/chunks/<key>.<digest>.json` appears and the index gains its `dataUrl`. Removing a chunk from the source makes its file a stale content-addressed output: `generate` deletes it and `check` reports it until you regenerate.

**Add a destination.** First add the manifest (Manifest doc §7) and regenerate `destinations.json`; then add its placement here. An active THE NRVNAVerse destination without a placement fails `spatial:check` and the test suite.

**Add a portal (2B.3).** Author a mesh with `collider: { enabled: true, rigidbodyType: "FIXED", colliderType: "CUBE", isSensor: true }` in `scene.m0.json`, list its id in the `componentIds` of the chunk where the visitor encounters it, append `{ componentId, chunkKey, destinationId }` to `portals` → regenerate → commit the source, `static-scene.json`, the chunk file (under its new content-addressed name) and `spatial-index.json`. Keep it clear of every spawn of that chunk (a test checks this) so an arrival never re-triggers it. The runtime binds it automatically whenever its chunk is active.

**Regenerate / check.** `pnpm --filter the-nrvnaverse spatial:validate` · `spatial:generate` · `spatial:check` (CI-style staleness check). The vitest suite (`pnpm --filter the-nrvnaverse test`) repeats the staleness check. Since 2B.4B.2 any change to the global scene or a chunk writes that artifact under a new content-addressed name, removes the previous one and rewrites the index (its `globalSceneUrl` / `dataUrl` path changes, §15) — commit the renamed artifact and the index together; `generate` prints `wrote … (content-addressed)` / `removed stale …` lines.

## 9. Why the compatibility full scene still exists

In 2B.1 the Step 2A runtime still mounted the full scene (`/data/static-scene.json`), so the pipeline emitted it as a **generated** compatibility output from the same authoritative source that produces the global scene and the chunks. **Since 2B.2 the runtime no longer requests it** (tested: no `src/` file references the path; the store boots the runtime from `spatialIndex.globalSceneUrl`). The file is kept as a generated artifact for validation and debugging — e.g. `pnpm run-space --scene=apps/the-nrvnaverse/public/data/static-scene.json` still smoke-tests the complete authored world headlessly — and because it costs nothing to keep deterministic. There is still exactly one hand-edited scene (`spatial/source/scene.m0.json`).

## 10. Step 2B.2 runtime handoff — consumed

What 2B.2 built on the inputs listed here (details in the runtime doc):

1. `spatial-index.json` → `parseSpatialIndex` at boot gives `globalSceneUrl` (runtime boot source), `chunks[key].dataUrl` (the only source of chunk URLs) and `destinations[id] = { chunkKey, spawn }` (placement registry).
2. The global scene (`globalSceneUrl` → `global-scene.<digest>.json`) is the payload passed to the official `createSpace`: the world boots with avatar, animations, environment and ground only.
3. The chunk payload (`chunks[key].dataUrl` → `chunks/<key>.<digest>.json`) is fetched **one chunk at a time, only after the manifest gate**, validated with `parseChunkPayload` (schema, `worldId`, `chunkKey`, component records) and instantiated through the official `space.components.create(data, { abort })` / `destroy` while the previous chunk stays alive; `loadingChunk` is reported through `SpatialTravelPhase` for real cross-chunk work only.

Order per travel (D-006, implemented): `canTravel(id)` (manifest gates) → only if allowed resolve `chunkKey` → same chunk? teleport : fetch → validate → stage → teleport → commit → retire old. The URL contract stays `?destination=<id>`.

## 11. Cannabis pre-fetch gate requirement (implemented at the application layer in 2B.2)

- The runtime **never fetches the cannabis chunk payload** (`chunks/cannabis-21.<digest>.json`, or any chunk mapped from a destination whose manifest carries `gates[]`) before that gate has passed: the adapter evaluates the gate before the orchestrator is asked for anything. Tested at adapter, store and browser level for the initial deep link, directory click and back/forward paths; the Hub chunk is the fallback for a gated initial deep link.
- The spatial index may reveal `cannabis-21` as the chunk key of the two gated destinations. That mapping is not the gated experience content; the content is the chunk payload.
- No age verification, gate persistence, jurisdiction policy or bypass exists or is designed here. The manifest's placeholder `enforced: false` remains deliberately unconsulted: a declared gate stops spatial entry.
- Known limitation (non-M0): files under `public/` are statically served, so "not fetched by the runtime" is an application-layer guarantee, not a hosting-layer one. A real gate will need server-side enforcement of gated chunk URLs — a later decision.

## 12. Tests (`pnpm --filter the-nrvnaverse test` — 69 tests at 2B.1, 177 at 2B.3, 235 at 2B.4B.2 query form, 244 after the content-addressing correction)

`test/spatial-pipeline.test.ts` (valid M0 source; seven ids exactly once; four chunks with the expected grouping; complete component accounting; compatibility scene == source; no metadata in chunk files/index; cannabis boundary; rejection of unsupported schema, duplicate/invalid chunk keys, unknown component, multiple ownership, global-in-chunk, unassigned component, empty chunk, unknown/invalid destination, unknown chunk, non-finite spawn/orientation, wrong world id, duplicate placement, missing placement, non-THE-NRVNAVerse destination, smuggled gates/metadata; determinism incl. reordered source; committed outputs match; manifests remain coordinate/chunk-free; **2B.3:** seven portal bindings, deterministic sorted `portals`, ownership by declared chunk, identity-free chunk payloads, coordinate/gate-free bindings, gated / same-chunk / shared targets allowed, no spawn overlap, optional-additive, and every portal rejection code above), `test/spatial-index.test.ts` (index parsing, registry from generated data, malformed index rejected, source abstraction, **no hard-coded ids/coordinates in `src/`**, store uses `registryFromSpatialIndex`; **2B.3:** seven bindings parsed, missing `portals` → empty set, malformed bindings rejected, store wiring). The existing adapter/URL tests build their registry from the committed index (`placementRef` is `chunk:<key>`). No existing test was weakened (two assertions became data-derived when the Music chunk grew to 9 components and the Hub became a portal target). **2B.4B.2 (content-addressed, after the review correction):** eleven content-addressing tests in `spatial-pipeline.test.ts` (every URL is the path of a content-addressed file `<base>.<token>.json` with no query and the URL IS the file the generation writes; token = SHA-256 prefix of the exact serialized text, independently recomputed, embedded in the file name, one-byte sensitivity, no artifact contains its own token; the ownership patterns match exactly the pipeline's own shapes and reject legacy / malformed / foreign names; determinism of names and bytes across runs and reordered source; Hub content change renames only the Hub file and the old name is absent from the new generation and index; global content change renames only the global scene; spawn / label / portal-target changes rename nothing; **cross-deployment**: Music content A at `music.<HASH_A>.json` vs content B at `music.<HASH_B>.json`, `HASH_B ≠ HASH_A`, generation B has no output at the old name and every content-addressed output in both generations is the digest of its own bytes, the two indexes differ only in the Music URL, unrelated names and bytes identical; schema 1, index keys are logical chunk keys, no id/gate/token in payloads; cannabis addressed like every artifact; the committed index matches and every committed file name token is the digest of its bytes, with no legacy or stale file committed), `test/spatial-cli.test.ts` (the CLI lifecycle in a scratch directory: first generation writes exactly the set and a second run writes/removes nothing; the cross-deployment Music change writes the new name, leaves the old name holding the OLD bytes until removal, then removes it — never overwrites; a retained stale file with old bytes is removed, not rewritten; a chunk removed from the source leaves stale files that `generate` removes and `check` reports; legacy unversioned names and foreign files are reported as leftovers and **never deleted** while a genuinely stale hashed file next to them is; a hand-edited hashed file is stale and rewritten; CRLF tolerated), `test/spatial-delivery.test.ts` (consumers pass the whole content-addressed URL through: `FetchChunkDataSource` / `FetchSpatialIndexSource` with a stubbed `fetch`, parser opacity, comment-stripped source scan for digest parsing / hashing / file-name construction, no digest in navigation URLs) and `test/cache-policy.test.ts` (the `next.config.ts` path rules evaluated with Next's own `path-to-regexp` / `matchHas`: hashed names immutable, legacy names / query form / malformed tokens / nested paths / index never immutable). Tests that used to static-import `chunks/<key>.json` now read the payloads **through the committed index** (`test/support/generated-spatial.ts`), exactly as the runtime resolves them.

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

## 15. Content-addressed delivery and HTTP cache policy (M0 Step 2B.4B.2)

**Why this and not an application cache.** The read-only 2B.4B.1 audit (2026-09-20, `next dev` and `next start`, Chrome over CDP) measured: cross-chunk travel ≈45 ms median locally (validation ≈0, staging ≈10 ms for the placeholder chunks); every *repeat* chunk fetch was a **conditional HTTP revalidation** because both servers answered `Cache-Control: public, max-age=0` plus a weak `ETag` / `Last-Modified`, so each revisit paid one round trip (≈243 B on the wire, 304). Under a bounded 150 ms latency profile a repeat travel cost ≈175 ms; the same travel with a long-lived cache policy simulated in the browser cost ≈36 ms with 0 body bytes from disk cache. The bottleneck was therefore the **HTTP delivery contract**, not the runtime. Decision **B — HTTP delivery follow-up only**: no application raw-payload / validated-payload cache (the browser HTTP cache already holds the bytes; a second copy adds memory, invalidation logic and a stale-data surface for no measured gain), no predictive / neighbour prefetch for M0 (it would fetch chunks the visitor may never enter — and for a gated neighbour it would violate gate-before-fetch, D-006), no instantiated-chunk retention, no Service Worker / CacheStorage / IndexedDB / localStorage, no change to the orchestrator or travel architecture.

**Why query-only versioning was rejected in review (commit `4c64efd` → corrected by the follow-up commit on the same branch).** The first 2B.4B.2 implementation kept the stable file names (`global-scene.json`, `chunks/<key>.json`) and appended `?v=<digest>` to the URLs in the index, with `next.config.ts` marking the paths `immutable` only when the query matched. Independent review found the flaw: **a query string changes the browser's cache key but never selects bytes on the server.** After a deployment that changes Music, a long-lived client still holding the *old* index (it is `max-age=0` but may be in memory, in a background tab, or mid-session) that visits Music for the first time requests `music.json?v=HASH_A`; the server has only the new `music.json` (content B) and answers it with `Cache-Control: … immutable`. The browser then caches **content B under HASH_A** for a year, and old placement/index data is silently combined with new chunk geometry. The same-deployment browser tests could not observe this; only a deployment boundary exposes it. The intended invariant — *URL token ↔ exact artifact bytes* — cannot be delivered by a query token. It can only be delivered by putting the digest **in the file name**, so the server's own file lookup enforces it.

**Contract (content-addressed).**

```
spatial-index.json                                            VERSION ROOT — fixed URL, Cache-Control: public, max-age=0, must-revalidate
  ├─ globalSceneUrl      = /data/spatial/global-scene.<digest>.json         Cache-Control: public, max-age=31536000, immutable
  └─ chunks[key].dataUrl = /data/spatial/chunks/<key>.<digest>.json         Cache-Control: public, max-age=31536000, immutable
digest = first 32 lowercase hex chars (128 bits) of SHA-256 over the exact UTF-8 serialized artifact written to disk — and the file is NAMED with it
```

- **Core invariant.** For every immutable runtime URL, the digest embedded in the requested **file name** corresponds to the bytes stored in **that file** (`generate` names each file from its own serialized text; the test suite recomputes the digest of every committed and generated file and compares it with its name). A request for an old digest after a deployment therefore returns the old matching content if that file still exists, or **404** — never current content under the old name. A 404 at a deployment boundary is accepted; wrong bytes under an immutable policy are not.
- **Generation order** (`generateSpatialArtifacts`): compatibility scene → global scene text → its name from that text → chunk texts → their names from those texts → index. An artifact never contains its own name or digest, so there is no circularity; the index (the version root) depends on the artifacts, never the reverse. `SpatialArtifacts.files` is keyed by the content-addressed names; `globalSceneFile` / `chunkFiles[key]` resolve the logical artifact to its current name; `versions` maps each name to its digest. `contentVersion()`, `contentAddressedFileName()`, `dataUrl()`, `isContentAddressedOutput()` and `CONTENT_ADDRESSED_OUTPUT` are exported; `node:crypto` is the only addition (no dependency, `pnpm-lock.yaml` untouched).
- **Generated artifact strategy — option A, content-addressed only.** The stable unversioned copies are **not** generated any more. Their only consumers were the runtime (which resolves everything through the index, verbatim) and five test files that static-imported `chunks/<key>.json`; those tests now read the payloads through the committed index (`test/support/generated-spatial.ts`), which is the same contract the runtime uses. Keeping duplicate stable copies would have meant a second, non-immutable delivery path with no user, and a second place where "which bytes does this URL serve" could drift. `static-scene.json` (compatibility full scene, §9) is unchanged: fixed name, not content-addressed, not immutable, not requested by the runtime.
- **Stale generated file policy** (`cli.mjs`). `generate` writes exactly the current expected set (write first), then removes every file in the output namespace that matches the pipeline's own content-addressed shapes (`spatial/global-scene.<32hex>.json`, `spatial/chunks/<chunk-key>.<32hex>.json`) but is not part of the current generation — previous content versions and removed chunks — and prints `removed stale …`. **Nothing else is ever deleted:** a file in `spatial/chunks/` or a `spatial/global-scene*.json` that does not match those shapes (a legacy unversioned name, a `.bak`, a hand-placed file, a wrong-case or short-digest name) is reported as an `unexpected leftover` with exit code 1 and left in place; files outside the namespace are never even listed. `check` fails on stale (bytes ≠ expected), missing and unexpected files alike. Consequences: a second `generate` writes and removes nothing; after a content change Git shows the old name deleted and the new name added plus the index; stale digests cannot accumulate silently; there is no generic file cleaner. Because stale files are removed, the deployed behaviour for an old digest is **404** (not "still served"), which satisfies the invariant above.
- **Invalidation.** Same content → same digest → same name → cache hit. Changed content → different digest → a name the browser has never seen → fetched fresh; the old entry can never satisfy the new index (tested: a Hub geometry change renames only the Hub file; Music, Fashion, Cannabis and the global scene keep their exact names and bytes; the old digest is absent from the new index). Placement/spawn, label and portal-binding edits change the index only, never an artifact name.
- **Cross-deployment behaviour** (generator- and CLI-level regression tests). Generation A: Music content A → `music.<HASH_A>.json` contains A. Generation B (Music changed): `music.<HASH_B>.json` contains B, `HASH_B ≠ HASH_A`, B has **no** output at the old name, the old file on disk still holds A until `generate` removes it (it is never overwritten), and every content-addressed output of both generations is the digest of its own bytes. Unrelated chunks and the global scene retain their exact names and bytes, so an old index that still names them keeps resolving to identical content; the only URL that differs between the two indexes is the Music one, and after deployment B it is a 404. Old index + new chunk geometry can therefore never be combined silently.
- **Schema and identity untouched.** `schemaVersion` stays 1; `globalSceneUrl` / `dataUrl` remain plain strings (no new field); index keys are the logical chunk keys, `chunkKey` inside each payload is the logical key, destination ids and gates are exactly as before. The digest is physical delivery metadata: it neither authorises nor prefetches anything, and it is not identity (D-004). The browser contract stays `?destination=<stable-id>&from=spatial`; a digest never appears in a navigation URL (tested at URL-contract, store and browser level).
- **Runtime opacity.** `parseSpatialIndex` passes the strings through verbatim; `FetchChunkDataSource` and `AweSpatialRuntime.init` hand the whole URL to `fetch`. No runtime hashing, no file-name construction, no digest parsing (comment-stripped source scan: no 32-hex literal, no `createHash`/`sha256`, no `${…chunkKey…}.json`, no URL surgery on `dataUrl` / `sceneUrl`).
- **Cache policy** (`next.config.ts`, `headers()`; rules are matched before the `public/` file system, and `send` only fills in `Cache-Control` when none is set): `/data/spatial/spatial-index.json` → `public, max-age=0, must-revalidate`; `/data/spatial/global-scene.:version([0-9a-f]{32}).json` and `/data/spatial/chunks/:chunk([a-z0-9-]+).:version([0-9a-f]{32}).json` → `public, max-age=31536000, immutable`. **No query condition** — the digest is in the path, so the rule simply describes the files the generator writes (confirmed against the installed Next 16.1.6 `path-to-regexp` and the built `routes-manifest.json`: `^/data/spatial/chunks(?:/([a-z0-9-]+))(?:\.([0-9a-f]{32}))\.json(?:/)?$`).
- **Unversioned / malformed safety.** The legacy names (`global-scene.json`, `chunks/<key>.json`), the rejected query form, short / uppercase / non-hex digests, `.bak` suffixes, dotted or nested chunk paths match no rule and — since no such file exists — are 404s carrying Next's `private, no-cache, no-store`; never `immutable`. `static-scene.json` keeps the framework default `public, max-age=0`. Route matching is case-insensitive, so an uppercase-digest path matches the rule; on a case-sensitive production file system it is a 404, and on a case-insensitive one it serves the identical bytes of the lowercase name — the same content, so the invariant still holds.
- **Gate boundary unchanged.** Cannabis: stable destination → adapter gate → `gateRequired` → **zero** requests for the content-addressed cannabis chunk URL (browser-verified below). The cannabis URL is served immutable like every artifact — a delivery detail that does not authorise, prefetch or weaken D-006. Known non-M0 limitation, unchanged and **not** solved by this step: the static chunk file is not server-authorised content, and a content-addressed name is not authorisation.

**Production verification (2026-09-20, `pnpm --filter the-nrvnaverse build` → `next start --port 3211`, URLs read from the served index, GET and HEAD).** `spatial-index.json` → `200`, `public, max-age=0, must-revalidate`, weak ETag; `global-scene.c1acc16b….json` → `200`, `public, max-age=31536000, immutable`, and SHA-256 of the served bytes = the name token; `chunks/music.dffba466….json` → `200`, immutable, served bytes hash to the name token; cannabis likewise; **fabricated old-digest Music paths (`music.000…0.json` and the digest of a one-byte-different Music) → `404`, body ≠ current Music bytes, `private, no-cache, no-store, max-age=0, must-revalidate`**; legacy `global-scene.json`, `chunks/music.json` and `chunks/music.json?v=<32hex>` → `404`, not immutable; `.json.bak` and 31-char digest → `404`, not immutable; `static-scene.json` → `200`, `public, max-age=0`; index with a query → still `must-revalidate`; HEAD parity for the index, the global scene and Music.

**Browser verification (fresh headless-Chrome profile, GPU-backed, raw CDP, same production server; focused Hub → Music → Hub → Music, not the full audit).** Boot: index 200 (1 029 B wire), `global-scene.<digest>.json` 200 (2 834 B), `hub.<digest>.json` 200 (1 375 B). Hub → Music first visit: network 200, **1 387 B on the wire**, `chunk-fetch` 27.8 ms. Music → Hub, Hub → Music, Music → Hub, Hub → Music (revisits of the exact hashed URLs): **`fromDiskCache: true`, 0 wire bytes, Resource Timing `transferSize 0` / `deliveryType "cache"`, no `If-None-Match` sent** — no conditional round trip; `chunk-fetch` 3.2–25.6 ms, travel 14–36 ms (the first two revisits include cold-JIT staging; the later ones 14–16 ms, in line with the 8–14 ms measured for the query form). Hub → Cannabis: `gateRequired`, zero requests, URL unchanged; cannabis chunk requests across the run: 0. Only `?destination=<id>&from=spatial` ever written. No console error; the only console output is pre-existing upstream Three/VRM warnings.

2B.4B is **complete** with this correction; 2B.4C followed (§16 and the runtime doc §16). Landmark version unchanged (0.1); no new decision was needed — this changes physical delivery only, not a governing architecture decision.

## 16. Initial M0 warning budgets (M0 Step 2B.4C.2)

**What.** `pnpm --filter the-nrvnaverse spatial:check` evaluates two initial budgets against the runtime artifacts of the current generation and prints a warning per exceeded metric — **warning only**: the command still succeeds when the artifacts are otherwise valid and current, and stale / missing / unexpected artifacts fail exactly as before. Pure helper `scripts/spatial/budgets.mjs` (`SPATIAL_WARNING_BUDGETS`, `spatialBudgetWarnings`, `formatSpatialBudgetWarning`, `countArtifactComponents`); `cli.mjs` only calls it from `check`.

| Scope | Metric | Initial M0 warning threshold |
|---|---|---|
| runtime global scene (`spatial/global-scene.<token>.json`) | serialized bytes (LF) | 64 KiB (65 536 bytes) |
| runtime global scene | top-level components | 64 |
| each runtime chunk (`spatial/chunks/<key>.<token>.json`) | serialized bytes (LF) | 64 KiB each |
| each runtime chunk | top-level components | 64 each |

Not budgeted, deliberately: the compatibility full scene `static-scene.json` (not requested by the runtime) and `spatial-index.json` (the small version root). No asset, draw-call, triangle, texture, FPS or heap threshold exists.

**Output.** A warning names the artifact and chunk, the actual value and the threshold, e.g. `budget warning: runtime chunk "music" spatial/chunks/music.<token>.json is 70 213 bytes (initial M0 warning threshold 65536 bytes) — warning only, check still succeeds`; a generation within budget prints `… (7 files, within initial budgets)`. Exit status is unchanged by warnings.

**Evidence basis (2B.4C.1 audit, 2026-09-20, committed LF bytes).** Global scene 9 763 B / 7 components; chunks hub 9 288 B / 8, music 9 929 B / 9, fashion-culture 10 216 B / 9, cannabis-21 7 335 B / 7 (≈1.0–1.4 KB gzip on the wire each; the ungated initial Hub requirement index + global + hub is 21 868 B raw / 5 278 B wire). Staging a 9-component chunk cost ≈8–15 ms warm and ≈28–48 ms under a 4× CPU slowdown. 64 KiB / 64 components is generous headroom above that placeholder baseline while keeping a chunk to roughly one network round trip and well under a second of staging on a slow CPU. These are **initial guardrails**, not production or world-capacity promises; they are expected to be re-based when the first representative art vertical slice exists.

**Observational baseline recorded, not enforced (same audit).** Cold Hub boot on a fresh browser profile transferred 3.77 MB in 76 requests, dominated by placeholder / upstream scene assets — the `studio` HDR envmap alone 1.61 MB (43 %), Next JS 0.87 MB, Rapier WASM 0.51 MB, the avatar VRMs 0.34 MB, 17 animation clips 0.12 MB — while the spatial JSON was 5.3 KB (0.14 %). The placeholder world renders with 13–15 draw calls and ≈6.9 k triangles, 22–23 geometries and 10 textures, 15–16 live components, and the browser JS heap stayed ≈44–50 MB (flat) across a ten-step travel loop. Asset / render budgets and any cold-boot time threshold are deferred until representative art exists.

**Tests** (`test/spatial-budgets.test.ts`, 12): thresholds; the committed M0 generation emits no warning; a >64 KiB chunk / global artifact warns naming the artifact, actual bytes and threshold; >64 components warns (64 exactly does not); both metrics can warn and are ordered global-first then chunks by key; `static-scene.json` / the index are never budgeted; malformed text counts as zero components; an over-budget but current generation is up to date; stale / missing / unexpected artifacts still fail; the real `spatial:check` exits 0 for the committed artifacts and reports them within the initial budgets.
