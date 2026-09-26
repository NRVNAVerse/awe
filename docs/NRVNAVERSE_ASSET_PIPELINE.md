# NRVNAVerse Asset Pipeline — Runtime Asset Contract (M1.0)

| Field | Value |
|---|---|
| **Status** | Runtime asset contract **IMPLEMENTED and tested** (no runtime art is declared yet) · M1.1 production intake (`asset:prepare`, §11) and provider-neutral storage contract (§4) **IMPLEMENTED and tested on synthetic data** · `external-cas` on **Cloudflare R2** + `asset:publish` **IMPLEMENTED, tested without credentials**; bucket / domain / DNS **not created** ([`NRVNAVERSE_R2_STORAGE.md`](./NRVNAVERSE_R2_STORAGE.md)) · M1.0 tracer **EXPERIMENTAL, not integrated** (§8) |
| **App** | `apps/the-nrvnaverse` |
| **Builds on** | [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) (§17) · [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) |
| **Related decisions** | D-004 (stable destination ids — the asset-id pattern *follows* it; D-004 itself governs destinations) · D-009 (mobile-first; budgets and adaptive quality from representative art) · D-014 (no dependency change) · D-016 (application-layer spatial pipeline) |
| **Decision status** | No `DECISIONS.md` entry governs runtime-art identity or art-binary storage yet. One is recommended once this contract is integrated and the binary policy (§3) is confirmed — a human decision, recorded then, not implied by this document |
| **Not in scope** | Hub / Music art, production binary storage, model optimisation and full glTF validation (generic platform capabilities, §7), adaptive quality, LOD, baked-lighting engine support, the curated asset library, Blender automation |

Status vocabulary: **CURRENT CONTRACT** = implemented, tested, binding · **EXPERIMENTAL** = exists to learn, may change or be removed · **PLANNED** = designed, not built.

---

## 1. CURRENT CONTRACT — identity, resolution, delivery

### 1.1 Logical identity, not files

A spatial component never names a binary. It names a **logical asset**:

```
scene component  { "type": "model", "assetRef": "ast_…" }             spatial/source/<scene>.json        (authored)
  → registry     assets["ast_…"].currentRevision → revisions[n]       spatial/source/<registry>.json     (authored)
  → artifact     { sha256, bytes, format, storage: { backend, objectKey } }
  → runtime URL  resolved by the storage backend at GENERATE time → "url" in the generated chunk
```

- **`assetId`** — `ast_` + 16 characters of the destination-id alphabet (`/^ast_[0-9abcdefghjkmnpqrstvwxyz]{16}$/`), generated at random once. Never derived from a file name, digest, path or URL; survives renames, re-exports and new revisions.
- **Revision** — a positive integer key (`"1"`, `"2"`, … — no leading zeros); `currentRevision` must name an existing revision. Each revision records the **full SHA-256** and byte count of its runtime artifact.
- **Storage** — `storage.backend` decides where the bytes live and how the URL is formed. Identity never does.

Only `model` components (`type: "model"`, exact) carry runtime assets in M1.0. A `model` component without `assetRef` is refused (`unregistered-asset-url`), and `assetRef` on any other component type is refused (`asset-ref-unsupported-component`). Other URL-bearing content (environment maps, images, audio, video) is outside the registry until a later kind is added.

### 1.2 Deterministic spatial resolution

`spatial-config.m0.json` may name a registry (`"assetRegistry": "<file>.json"`, optional and additive like `portals`). **The committed configuration declares none**: the world ships no runtime art and the generated spatial data is byte-identical to M0. When a registry is declared, `spatial:generate` replaces every `assetRef` with the current revision's runtime URL in **every** generated artifact:

| Change | Effect on generated artifacts |
|---|---|
| Rename the asset or edit provenance text | none |
| New revision (new bytes → new SHA-256 → new object key) | only the chunks that reference the asset get a new content-addressed name; the index moves to them; the global scene and every other chunk stay byte-identical |
| Point `currentRevision` back | the previous generation is reproduced exactly (rollback) |
| Move the bytes to another storage backend | only the URL changes; `assetId` and revision are untouched |

### 1.3 Content-addressed artifacts and binary verification

`repo-public` object key: `assets/art/<assetId>.<first 32 hex of the SHA-256>.<format>` (32 = the spatial content-version length; the registry keeps and the CLI verifies the full 256 bits). The validator accepts **exactly** that key — anything else (path traversal, nesting, another asset's key, upper case) is `invalid-object-key`. `spatial:generate` / `spatial:check` verify each referenced artifact **byte-for-byte** (size + full SHA-256) and fail on any file under `public/assets/art/` that is not the current artifact of a referenced asset (orphans, the previous revision's file, an unreferenced asset's file). The CLI never generates or deletes runtime assets.

### 1.4 Immutable delivery

`next.config.ts` → `runtimeAssetHeaders()` serves exactly `/assets/art/:asset(ast_[0-9abcdefghjkmnpqrstvwxyz]{16}).:version([0-9a-f]{32}).glb` as `public, max-age=31536000, immutable`. Nothing else under `/assets` becomes immutable; the spatial-index revalidation rule is unchanged (`deliveryHeaders()` = the M0 spatial rules + this rule). A running client that still holds an old index and asks for a retired chunk or asset after a deploy gets a 404 — the same behaviour M0 accepted for chunks; multi-generation retention belongs to the external storage contract (§4).

---

## 2. CURRENT CONTRACT — provenance, rights, review and publication (NRVNAVerse policy)

This is **NRVNAVerse product policy** (`scripts/spatial/assets.mjs`), not a generic AWE licensing system. Metadata is **evidence for a human review, never the approval**: nothing in the pipeline promotes an asset.

### 2.1 Production rule — `usage: "production"`

A referenced production asset (`productionBlockers()`) needs **all** of:

- `rights.status: "cleared"`
- `rights.webRuntimeRedistribution: "allowed"`, `rights.commercialUse: "allowed"`, `rights.modification: "allowed"` (`unknown` or `prohibited` blocks — the optimiser's output is a modification)
- no dependency with a status other than `cleared` / `removed`
- a known `provenance.origin` (not `unknown`)
- `review.status: "approved"` **with** `reviewedBy` (the human reviewer) and `reviewedAt` (ISO 8601 date-time with offset)

Otherwise: `asset-production-unresolved`, listing every reason.

### 2.2 Human review rule

`review.status: "approved"` is a **review event**: the schema refuses an approval without `reviewedBy` or without a valid `reviewedAt` (`review-approval-unattributed`), and the production rule re-checks it. Provenance completeness, licence metadata, passing tests, source type or self-authorship are inputs to that review, never a substitute for it.

### 2.3 Internal-tracer rule — `usage: "internal-tracer"`

For engineering use only. Requires the explicit `review.status: "internal-tracer-accepted"` (`asset-internal-tracer-unaccepted`); always reported as a warning (`asset-internal-tracer`). Because its bytes still need a storage backend, an uncleared tracer can only exist once a **non-public** backend exists — see §2.4.

### 2.4 Repo-public rule — a public Git commit is publication

`NRVNAVerse/awe` is a public repository: **a committed binary is published** the moment it is pushed and stays retrievable from Git history. `repo-public` is therefore a **publication event**, reserved for cleared **internal engineering** assets. **Every** revision whose artifact uses `repo-public` — referenced or not — must satisfy all of:

| Rule | Schema code |
|---|---|
| `usage` is not `production` — **production art never uses `repo-public`**; it lives in external content-addressed storage (§4) | `repo-public-production` |
| cleared rights, `webRuntimeRedistribution: "allowed"`, a known origin, no unresolved dependency (`publicationBlockers()`) | `repo-public-uncleared` |
| a deliberate human review (`publicationReviewBlockers()`): `review.status: "internal-tracer-accepted"`, `reviewedBy` a non-blank reviewer name, `reviewedAt` a genuinely valid ISO 8601 date-time with offset (real calendar date and clock time — `2026-02-30…` is refused) | `repo-public-unreviewed` |

**`reviewedBy` is a human-attestation field**: it records the person who took the publication decision. **Automation must never fill in `reviewedBy` / `reviewedAt` or set a review status** — tooling (including the intake command, §5) may prepare a record for review, never approve its publication. Uncleared or evaluative art can never be registered in the repository. The same non-blank rule applies to an `approved` review's `reviewedBy`.

### 2.5 All gate outcomes

| Code | Level | When |
|---|---|---|
| `unregistered-asset-url` | FAIL | a `model` component uses a raw `url` instead of `assetRef` |
| `asset-ref-with-url` | FAIL | a component declares both |
| `asset-ref-unsupported-component` | FAIL | `assetRef` on a component type that cannot carry a runtime asset |
| `invalid-asset-ref` / `unknown-asset-ref` | FAIL | not an asset id / not registered |
| `missing-asset-registry` | FAIL | a reference with no registry, or a declared registry file that does not exist |
| `asset-missing-artifact` | FAIL | the current revision has no runtime artifact |
| `asset-redistribution-prohibited` | FAIL | `webRuntimeRedistribution: "prohibited"` |
| `asset-rights-restricted` | FAIL | `rights.status: "restricted"` |
| `asset-review-rejected` | FAIL | `review.status: "rejected"` |
| `asset-production-unresolved` | FAIL | §2.1 |
| `asset-internal-tracer-unaccepted` | FAIL | §2.3 |
| `repo-public-production` / `repo-public-uncleared` / `repo-public-unreviewed` | FAIL | §2.4 |
| `review-approval-unattributed` | FAIL | §2.2 |
| `invalid-object-key` / `unsupported-storage-backend` | FAIL | not the exact content-addressed key / a backend not implemented |
| schema codes (`invalid-*`, `unexpected-field`) | FAIL | strict schema; `rights.status: "cleared"` is refused unless redistribution is `allowed` |
| duplicate JSON keys | FAIL | the registry file repeats a key (`readAssetRegistry()`; `JSON.parse` alone would silently keep the last) |
| `asset-internal-tracer` | WARN | every referenced internal tracer, with its open rights items |
| `m1-asset-bytes` / `m1-texture-dimension` / `m1-triangles` / `m1-unoptimized` | WARN | M1 experimental warning bands (§2.6) |

### 2.6 Warning bands — investigation triggers only

`M1_EXPERIMENTAL_ASSET_WARNINGS`: one artifact > 8 MiB; a texture edge > 2048 px; > 150,000 triangles; an artifact not recorded as optimised. **Warnings, never failures, never production budgets.** They read the registry's `stats`, which are **self-declared** until a generic glTF validator supplies derived statistics (§7). Final budgets come from measured representative art.

### 2.7 Registry schema (v1)

```
{ schemaVersion: 1, assets: { "<assetId>": {
    name, kind: "model", usage: "internal-tracer" | "production", currentRevision: <n>,
    provenance: { origin: self-authored | commissioned | licensed-third-party | partner-supplied | unknown,
                  creationContext?: original | tutorial-assisted | derived | unknown, creator?, source?,
                  dependencies: [ { id, kind, description, status: cleared | unresolved | removed, notes? } ] },
    rights: { status: cleared | unresolved | restricted, license, rightsHolder, attributionRequired, attributionText,
              commercialUse, webRuntimeRedistribution, modification   (each: allowed | prohibited | unknown), restrictions[] },
    review: { status: unreviewed | internal-tracer-accepted | approved | rejected, reviewedBy, reviewedAt, notes? },
    revisions: { "<n>": { artifact: { sha256, bytes, format: "glb", storage: { backend: "repo-public", objectKey } } | null,
                          stats?, export?, pipeline?, notes? } } } } }
```

Every embedded third-party model, texture, animation or HDRI is its own `dependencies[]` entry. **Rights are never inferred from a file name.** Attribution text, when required, lives in `rights.attributionText`. The registry is committed to a public repository: `provenance.source` records a **stable library reference and the source file's digest**, never an absolute local path or a private receipt (licences / receipts are referenced by id, kept outside the repository).

---

## 3. CURRENT CONTRACT — binary policy

| Content | Policy |
|---|---|
| **Production / representative art** | **Never committed to Git.** Provider-neutral external content-addressed storage (§4) before M1.2 |
| **Engineering fixtures** | Prefer bytes generated in memory or in a temp directory at test time (the asset tests do exactly this). A committed binary fixture only for a demonstrated testing need **and** tiny, purpose-built, fully cleared, free of third-party dependencies, documented and published by an attributed human `internal-tracer-accepted` review — the repo-public rule (§2.4) enforces the rights and review parts. None exists today |
| **Uncleared or evaluative art** | Never pushed; stays in local working copies |
| **Git LFS** | Not used — it still publishes and adds quotas |

---

## 4. Provider-neutral external storage — contract + first adapter (Cloudflare R2) IMPLEMENTED

`scripts/spatial/storage.mjs` is the storage contract; the registry only ever records `{ backend, objectKey }`:

| Backend | Status | Object key (exact match) | Git publication | Production art | Runtime URL |
|---|---|---|---|---|---|
| `repo-public` | implemented | `assets/art/<assetId>.<first 32 hex>.<format>` | **yes** | **never** (`repo-public-production`) | `/<objectKey>` |
| `external-cas` | implemented (adapter: Cloudflare R2) | `art/<assetId>/<full 64-hex sha256>.<format>` (write-once) | no | yes | `<config.assetStorage["external-cas"].publicOrigin>/<objectKey>` = `https://assets.nrvnaverse.com/art/…`; no configured origin → **refused** (`asset-storage-unresolved`, fail closed) |

The public origin is committed, non-secret configuration (`spatial-config.m0.json` → `assetStorage`), so generation stays deterministic; the registry never holds a host or bucket. Publication (`asset:publish`: write-once, full re-download SHA-256 verification) and the R2 bucket / CORS / cache contract are in [`NRVNAVERSE_R2_STORAGE.md`](./NRVNAVERSE_R2_STORAGE.md). The I/O boundary is `StorageAdapter { put(objectKey, bytes, { sha256, contentType }) → { created, location }, verify(objectKey, { sha256, bytes }) → { ok, problem } }`: write-once (identical bytes = no-op, different bytes = error) and verify-by-re-hash. `scripts/asset-pipeline/staging.ts` implements it locally (`.asset-staging/objects/<objectKey>`, Git-ignored) with the same semantics, so an eventual upload is a copy of `objects/**` with no re-keying. Choosing a provider = one adapter + the public base; the registry, keys and ids do not change.

Remaining design (unchanged from the plan):

| Element | Contract | Lives in |
|---|---|---|
| `assetId`, revision, full `sha256`, `bytes`, `format` | unchanged | registry |
| `storage.backend` | a logical backend name; no URLs or credentials in the registry | registry |
| `objectKey` | content-addressed from assetId + digest, exact-match validated, write-once | registry / generator |
| runtime URL | resolved at generate time, deterministic and environment-independent (a same-origin path mapped by hosting, or one fixed public base per backend in committed non-secret config — to be decided) | generator + committed backend config |
| caching | objects served `public, max-age=31536000, immutable` with the right content type (CORS if cross-origin); a 404 must never be cached as immutable | hosting configuration |
| upload | human-triggered pipeline step from a local working copy; credentials outside the repository | deployment tooling |
| verification | re-download and check bytes + SHA-256 before the registry revision is committed; a release check re-verifies every referenced object; `spatial:check` stays offline | deployment tooling |
| order / source of truth | the registry defines which bytes; the store only holds them. Upload → verify → commit registry + regenerated chunks → deploy (the index revalidates) | deployment tooling |
| rollback | `currentRevision` back → regenerate → deploy; objects are never overwritten | registry + generator |
| retention | never delete an object referenced by a registry revision inside the retention window; old-client requests keep resolving | deployment tooling |
| local development | `repo-public` for cleared fixtures only; external objects read from the store or a digest-verified local mirror | CLI + tooling |

---

## 5. CURRENT CONTRACT — adding or revising a runtime asset

1. **Rights first.** Establish provenance, every embedded dependency, licence and permissions, and obtain the human review (§2). No repo-public bytes before §2.4 holds.
2. Copy the chosen export out of its source location into a temporary working directory; never write in the source library.
3. Record the source reference (library reference, digest), inspect the export (`pnpm inspect-gltf <copy>`), list every embedded third-party dependency.
4. Place the bytes at the content-addressed key of the storage backend the policy allows (§3) — never production art in Git.
5. Add the registry entry (new asset: a fresh random `ast_…`; new bytes: a **new revision** and `currentRevision`). Keep previous revisions in the registry.
6. **Remove the previous revision's repo-public file**: the CLI fails on it as an unexpected file (the registry keeps its record; Git history keeps the bytes — see §3).
7. Reference it with `assetRef`, add the component to its chunk, run `spatial:generate`, `spatial:check`, the app tests, a production build, `browser:touch` and `browser:perf` (with `ASSET_COMPONENT`, §6).

---

## 6. CURRENT CONTRACT — `browser:perf`

`pnpm --filter the-nrvnaverse browser:perf` (`scripts/browser/perf-probe.mjs`, raw CDP, no dependency; measurement only, never a budget) runs against the production build. Without arguments it measures the committed world (**no-art baseline**); `ASSET_COMPONENT=<component id>` additionally measures one runtime asset in the Hub: GLB fetched once / 200 / immutable, warm-cache hit, world bounds, incremental per-frame cost.

- **Cold / warm.** Cold = a throw-away Chrome profile plus a cleared HTTP cache. Warm = a reload in the same page; every immutable response of the cold load that is requested again must come from cache, and at least one must be observed.
- **Bytes.** `wireBytes` = `encodedDataLength` (compressed body + headers, 0 on a cache hit); `resourceBytes` = decoded body bytes.
- **Failures.** Any HTTP status ≥ 400, any failed request (aborted requests are reported separately), any unexpected console error or exception, a stale build (a source / public / config file newer than `.next/BUILD_ID`), a busy port, or a check that observed nothing.
- **Known engine noise** is listed by exact message *and* phase: `STOP Animation not found null` is accepted only after a chunk retire (an animated model's disposal, §7) and counted; the same text before any travel fails.
- **Limits.** Frame timing and wall times are headless Chrome on the host (usually vsync-capped): relative indicators. The mobile profile is an **emulation** (viewport, UA, DPR on the host GPU): its bytes, requests and draw calls are meaningful, its timings are **not** phone measurements. Heap is JS heap only; GPU memory is not measured.

The earlier tracer-specific render-regime spike is not part of the probe; its findings are recorded in §8.

---

## 7. Generic platform capabilities — HANDOFF DEPENDENCIES

Generic AWE capabilities belong to the platform lane (Operating Guide §5–§6); NRVNAVerse records only what it needs:

| HANDOFF DEPENDENCY | What NRVNAVerse needs | Blocking? |
|---|---|---|
| Model optimiser | an offline, deterministic GLB → GLB optimiser with a report | **ADOPTED (M1.1)** — H1 `optimizeModel()` ported byte-identical from TheCannaMan/awe@120ec0c into `packages/tools/src/gltf`; consumed through `scripts/asset-pipeline/awe-gltf.ts` |
| glTF validator + statistics | machine-readable validation errors and statistics | **ADOPTED (M1.1)** — H2 `validateModel()` (structural + AWE-runtime facts, *not* full Khronos conformance); prepared revisions now carry **derived** `stats` |
| Animated-model disposal console error | `ClassicWrapper.stop(null)` logs `STOP Animation not found null` when an animated model is destroyed; removing it lets the probe drop its only allowlist entry | non-blocking |
| `KHR_materials_unlit` on static (instanced-pipeline) models under the lit regime | confirmation or support before any baked-unlit static art | blocking only for that path |
| Decoder / environment asset location | which decoders (Draco / meshopt / KTX2) and environment maps the engine loads, and whether their URLs are configurable for self-hosting | blocking for compressed art under a self-hosting policy — why the NRVNAVerse optimiser profile keeps **Draco off** by default (§11) |

---

## 8. EXPERIMENTAL — historical M1.0 tracer evidence (not integrated)

The contract was first exercised with an engineering tracer on the branch **`feat/m1-asset-contract-tracer`** (commits `6b6d26f` tracer, `0a7de49` probe, `e8f7cf0` docs; HEAD `e8f7cf0`). That branch is **not integrated and is not part of this contract**; it is preserved unchanged as the record of the experiment.

- **What it was.** An existing animated GLB export of a self-authored, tutorial-assisted Blender model ("Rock Monster"), used unchanged in the Hub as an `internal-tracer`, with two embedded dependencies left **unresolved**: an animation clip whose name indicates Adobe Mixamo, and an embedded palette texture of unestablished origin. Rights were never cleared.
- **Why it is not integrated.** An independent review found the gate accepted that record for a public repository. Under this contract (§2.4) the same record is refused (`repo-public-uncleared`, covered by a test). The contract was therefore integrated **without** the binary; the canonical line never contained it.
- **Publication semantics.** The tracer branch was pushed to the public repository, so its GLB is publicly retrievable there (and by anyone who fetched it) regardless of later integration choices. Whether anything further is needed is a rights question for the owner, not a pipeline question.
- **What it proved (still valid).** Content-addressed resolution changed only the Hub chunk; byte verification and the immutable header worked end to end in the production build (cold 200 `immutable`, warm reload from disk cache with 0 wire bytes).
- **Render comparison (one asset, one machine — limitations below).** (A) lit PBR rendered the asset correctly with a cast shadow; (B1) the engine's global unlit switch (`lighting.enabled = false`) turned the placeholder world's pipeline meshes flat white while the animated asset stayed lit; (B2) per-asset `KHR_materials_unlit` produced an unlit material in both regimes but a flat dark silhouette, because that texture has no baked lighting. **Conclusion scope:** lit PBR is the default *candidate* for current M1 work; a genuinely baked static asset is evaluated separately before any per-asset unlit decision. One tutorial model does not set THE NRVNAVerse art direction. **Limitations:** headless Chrome on one desktop GPU; the B2 global-unlit frame was captured at a different camera position from B1, so their draw-call counts are not comparable; per-regime triangle totals do not isolate shadow passes; `castShadow` is a flag, not proof of a rendered shadow pass when shadow maps are off.
- **Measurements (environment-specific, reproduced once independently).** Cold load ≈ 5.37 MB on the wire / 16.6 MB decoded with the 6.36 MB (1.59 MB compressed) tracer; tracer +2 draw calls / +76 k triangles per frame incl. its shadow pass. Wall times and heap varied by ~15 % between runs; frame timing was vsync-capped. None of it is a phone measurement or a budget.
- **Placement note.** Its measured world bounds reached closer to the Cannabis route and sensor than the experiment's test and notes claimed (they used mesh-local bounds); it had no collider, so gameplay was unaffected.

---

## 9. DRAFT (EXPERIMENTAL) — Blender → runtime export contract

A starting point, to be refined with the owner on the first representative asset; nothing is automated.

| Topic | Draft rule |
|---|---|
| Units / scale | Metric, 1 Blender unit = 1 m; unit scale 1.0 |
| Transforms | Apply rotation and scale on every exported object **including armature roots**; no negative scale |
| Origin / pivot | At the ground contact point, centred in X/Z, unless explicitly a wall / ceiling piece |
| Forward axis | glTF +Z forward (Blender −Y with the exporter's +Y-up conversion) |
| Naming | Meaningful `<asset>-<part>` names; collision proxies suffixed `-collider` |
| Materials | Principled BSDF → glTF metal / roughness; avoid node setups the exporter cannot translate; single-sided unless needed |
| Baked lighting | Only for an asset chosen for the baked-unlit path: bake into the base colour, mark `KHR_materials_unlit`, verify with `browser:perf` |
| Textures | Embedded; power-of-two preferred; warning band above 2048 px; every texture's source is a provenance dependency |
| Cameras / lights | Not exported (the world owns lighting) |
| Animation | Only clips the world uses, named; third-party clips are provenance dependencies with their terms recorded |
| Export | glTF 2.0 binary, selected objects, +Y up, apply modifiers, no Draco / meshopt / KTX2 at export (optimisation is a later step, §7) |
| Ownership | `.blend` + raw export = art source, outside Git; optimised runtime GLB + registry record = pipeline output; generated spatial JSON = derived |

---

## 10. Tests and commands

- `test/asset-registry.test.ts` — the contract on **synthetic data only** (in-memory registry, generated bytes in a temp directory): committed source ships no asset; production / human-review / internal-tracer / repo-public rules; schema (origin, creation context, revisions, object keys, backends, unexpected fields); duplicate keys; scene references; resolution (determinism, rename, new revision, rollback, unrelated chunks byte-identical); CLI byte verification (missing, size, SHA-256, orphan, stale previous revision, unreferenced asset); the immutable art header and its negative cases.
- `test/cache-policy.test.ts` — the config serves `deliveryHeaders()` and the M0 spatial rules are unchanged.
- `pnpm --filter the-nrvnaverse spatial:check` — verifies generated data and any referenced runtime asset, prints asset warnings.
- `pnpm --filter the-nrvnaverse browser:perf` — §6.
- `test/prepare-asset.test.ts` — M1.1 intake on **synthetic** in-memory GLBs (the AWE tools' own deterministic fixtures): seam load + report versions; ready end-to-end flow (optimised, derived stats, `external-cas` key, valid registry proposal, not yet referenceable); determinism; write-once staging + verify; truncated / non-glTF / external-resource input; optimiser skips (`not-smaller`, `already-compressed` meshopt → runtime blocker); never-approves, rights and dependency blockers, authored derived facts refused; internal-tracer acceptance; new revision numbering, `revision-exists`, `review-predates-revision`; CLI exit codes.
- `packages/tools/test/{gltf-container,safe-optimize,validate-model,optimized-model-loads}.test.ts` — the adopted H1/H2 suites (the last loads optimiser output through the engine's real `GLTFLoader`).

---

## 11. CURRENT CONTRACT (M1.1) — production-asset intake: `asset:prepare`

```
pnpm --filter the-nrvnaverse asset:prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]
```

Takes a **cleared** source GLB (a copy — never the library file) and authored intake metadata, and produces a deterministic "ready for upload" artifact plus a registry revision proposal. It **never** uploads, edits the committed registry or scene, targets `repo-public`, or sets / re-dates a review.

| Step | Owner | What happens |
|---|---|---|
| validate source | AWE H2 | structural errors → `source-invalid`; not a GLB → `source-not-glb`; external URIs → `source-external-resources` (never fetched). Stops here |
| optimise safely | AWE H1 | NRVNAVerse profile `{ draco: false, textures: "webp", maxTextureSize: 2048, quality: 90 }` (`--draco` opts in). Never bigger, never fails: a skip returns the exact source (`optimizer-skipped` warning, revision `pipeline.optimization: "skipped"` → `m1-unoptimized`) |
| validate output | AWE H2 | the bytes that would ship; failure → `output-invalid` |
| runtime policy | NRVNAVerse | an extension the AWE runtime marks `unsupported` / `partial` (meshopt, KTX2, VRM) → `runtime-unsupported-extension`; unknown to AWE → `runtime-unknown-extension`; `ignored` (e.g. punctual lights) → warning |
| identity / metadata | NRVNAVerse | `assetId` authored once (`ast_…`) and kept; only `assetId, name, kind, usage, provenance, rights, review, notes` may be authored — digests, sizes and stats never are (`metadata-invalid`); the proposed record must pass the registry schema |
| rights / review | NRVNAVerse | `usage: production` → every `productionBlockers()` reason (`production-unresolved`); internal tracer → needs `internal-tracer-accepted`. A new revision whose review equals the one on record → `review-predates-revision` (a human re-reviews the new bytes) |
| revision / digest | NRVNAVerse | next revision number (1 for a new asset), full SHA-256 of the output, **derived** stats (`awe-validate-model@1`: instanced triangles, vertices, meshes, materials, textures, largest texture edge, animations, skins, extensions, bounds), pipeline provenance (source digest, profile, transforms); same bytes as an existing revision → `revision-exists` |
| artifact | NRVNAVerse | `external-cas` key `art/<assetId>/<sha256>.glb`, staged write-once under `<out>/objects/<objectKey>` and re-verified |
| M1 bands | NRVNAVerse | §2.6 warnings on the derived stats |

Output: `<out>/objects/<objectKey>` and `<out>/prepared/<assetId>.r<revision>.json` (sorted keys, no wall-clock fields — byte-identical for identical inputs). Default `<out>` = `apps/the-nrvnaverse/.asset-staging/` (Git-ignored). Exit `0` ready · `2` blocked (report still written, every blocker listed) · `1` usage / I/O error.

After `READY`: `asset:publish <report>` (write-once to R2, verified), then `asset:register` (§12), then `asset:place` (§13); it resolves to `https://assets.nrvnaverse.com/<objectKey>`.

---

## 12. CURRENT CONTRACT (M1.1) — registration: `asset:register`

```
pnpm --filter the-nrvnaverse asset:register <out>/published/<assetId>.r<n>.json            # proposal (default)
pnpm --filter the-nrvnaverse asset:register <out>/published/<assetId>.r<n>.json --apply    # write
```

Turns a **verified** publication into the exact committed registry revision. The default run prints a deterministic diff (`+ config.assetRegistry` the first time, `+ assets.<id>` / `~ …review` / `~ …currentRevision`, `+ assets.<id>.revisions.<n>  sha256 · bytes · external-cas:<key>`) and writes `<out>/registered/<id>.r<n>.proposal.json`; nothing in the repository changes. `--apply` writes `spatial/source/asset-registry.json` (canonical sorted JSON) and, the first time, declares it in `spatial-config.m0.json`. Re-applying is idempotent (`ALREADY-REGISTERED`). Exit `0` proposed / applied / already registered · `2` blocked · `1` usage.

It **never** contacts storage (the publish report's full-object SHA-256 is the evidence), never creates or changes a review or rights metadata, and never places the asset: `assetRef` in a scene remains a separate, deliberate edit.

| Refused (blocker) | When |
|---|---|
| `not-published` / `invalid-publish-report` / `unverified` | dry-run, planned, blocked or failed publication; no full-object SHA-256 verification |
| `digest-mismatch` | verification ≠ published artifact ≠ registry revision ≠ staged bytes |
| `delivery-headers` | verified object lacks `model/gltf-binary` / immutable Cache-Control |
| `backend-mismatch` / `object-key-mismatch` / `origin-mismatch` | not `external-cas`, key ≠ `art/<id>/<sha256>.glb`, published runtime URL ≠ committed `assetStorage` origin |
| `derived-facts-edited` / `staged-object-missing` | the revision differs from asset:prepare's proposal, or its stats differ from what AWE H2 re-derives from the staged bytes |
| `not-production` / `not-production-eligible` / `registry-invalid` | not production, any `productionBlockers()` reason, schema failure |
| `revision-conflict` / `duplicate-bytes` / `registry-conflict` | the revision number already holds other bytes; an existing revision would be rewritten; the same bytes under another number; kind or object-key clash |
| `stale-review` | a review equal to (or older than) the one recorded for earlier bytes is carried onto a new revision |
| `spatial-invalid` | the resulting spatial source fails validation |

---

## 13. CURRENT CONTRACT (M1.1) — placement: `asset:place`

```
pnpm --filter the-nrvnaverse asset:place <assetId> --destination <dst_id> --component <component-id>   --position x,y,z [--rotation x,y,z] [--scale x,y,z|s] [--name <text>]            # proposal (default)
  … --apply                                                                       # write + regenerate
```

Places a **registered, production-eligible** asset into the chunk of one **destination** (stable `dst_` id → the config's `placements` → chunk key) as a `model` component that names it by **`assetRef`** — never a URL (the generator resolves it through the registry and the committed `assetStorage` origin). Rotation is in radians (the scene's convention); scale may be one uniform number.

- **Proposal (default)** prints the asset and resolved current revision + SHA-256, destination / chunk / component id, the transform, the runtime URL that *would* resolve, the exact two source edits and the generated files that would change (`- hub.<old>.json`, `+ hub.<new>.json`, `~ spatial-index.json`, `~ static-scene.json`). Nothing is written.
- **`--apply`** writes the minimum change — one component appended to `scene.m0.json`, one id appended to the chunk's `componentIds` in `spatial-config.m0.json` (verified by re-parsing; every other byte unchanged) — regenerates, proves the regeneration equals the plan, writes the new artifacts, removes the stale chunk version and lists both.
- Re-running an identical placement → `ALREADY-PLACED`, nothing changes. A different placement under a used id → `duplicate-component` (placements are never overwritten).

| Refused | When |
|---|---|
| `invalid-asset-id` / `unregistered-asset` / `no-artifact` | not an `ast_` id (URLs are rejected here), no registry, not registered, no current artifact |
| `not-production` / `not-production-eligible` / `registry-invalid` | tracer usage, any `productionBlockers()` reason, schema failure |
| `storage-unresolved` | the backend's runtime URL cannot be resolved (e.g. no committed `external-cas` origin) |
| `unknown-destination` | not a `dst_` id, not active, or no spatial placement |
| `gated-destination` | the chunk serves a gated destination (Cannabis 21 / NRVNA Farms): gated chunk JSON is not access-controlled, so art is never placed there |
| `invalid-component-id` / `duplicate-component` | not kebab-case ≤ 64 chars; id already used anywhere |
| `invalid-transform` / `invalid-name` | non-finite or out-of-bounds position (±10 000), rotation (±2π), scale (0.001–1000); bad name |
| `spatial-invalid` / `unexpected-generated-change` | the result fails spatial validation, or anything but that chunk / the index / the compatibility scene would change |
| unknown option (exit 1) | e.g. `--url` — placement never takes a URL |

**Measuring a placed external asset.** `ASSET_COMPONENT=<component id> pnpm --filter the-nrvnaverse browser:perf` measures it against the no-art baseline (art GLBs under `/assets/art/` and `/art/<assetId>/<sha256>.glb` are recognised). Before the store exists, `ASSET_MIRROR=<asset:prepare --out dir>` serves the committed origin's requests from the staged, digest-named bytes with the production headers (CDP-fulfilled, so the warm-cache check is skipped for mirrored art and the result says `assetOrigin: "mirror"`); against the real origin, leave it unset.

---

## 14. The full production-art workflow

```
asset:prepare  → asset:publish  → asset:register  → asset:place  → spatial:check → build → ASSET_COMPONENT=<id> browser:perf → commit
 (stage)          (R2, verified)   (registry)        (scene)        (generate is part of place --apply)
```

| HUMAN decides | AUTOMATION does |
|---|---|
| which asset (the source GLB, a copy — never the library file) | validates the source and the output (AWE H2) |
| its provenance, rights and dependencies (the intake metadata) | optimises safely (AWE H1), hashes (SHA-256), derives stats |
| the attributed review (`reviewedBy` / `reviewedAt`) — publication approval | stages bytes write-once and verifies them |
| running `asset:publish` (the publication event) | publishes to `external-cas` write-once, re-downloads and re-hashes |
| reviewing the registration proposal, then `--apply` | builds the exact registry revision, refuses conflicts / stale reviews / edited facts |
| where it goes: destination, component id, transform; then `--apply` | applies exactly that placement, regenerates spatial data, lists what changed |
| reviewing the perf numbers and committing | measures with `browser:perf` |

Nothing in the automation column selects art, approves it, changes a review or rights, deploys, or changes DNS.
