# NRVNAVerse Asset Pipeline — Runtime Asset Contract (M1.0)

| Field | Value |
|---|---|
| **Status** | Runtime asset contract **IMPLEMENTED and tested** (no runtime art is declared yet) · production binary storage **PLANNED** (before M1.2) · M1.0 tracer **EXPERIMENTAL, not integrated** (§8) |
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

## 4. PLANNED — provider-neutral external storage (design only; no provider chosen)

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
| Model optimiser | an offline, deterministic GLB → GLB optimiser with a report (input / output digests, settings, compression used); its output becomes a new revision | blocking for production art; not for this contract |
| glTF validator + statistics | machine-readable validation errors and statistics (triangles, texture dimensions, clip names, extensions) to replace self-declared `stats` | blocking for a production-grade gate |
| Animated-model disposal console error | `ClassicWrapper.stop(null)` logs `STOP Animation not found null` when an animated model is destroyed; removing it lets the probe drop its only allowlist entry | non-blocking |
| `KHR_materials_unlit` on static (instanced-pipeline) models under the lit regime | confirmation or support before any baked-unlit static art | blocking only for that path |
| Decoder / environment asset location | which decoders (Draco / meshopt / KTX2) and environment maps the engine loads, and whether their URLs are configurable for self-hosting | blocking for compressed art under a self-hosting policy |

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
