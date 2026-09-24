# NRVNAVerse Asset Pipeline — M1.0 Asset Contract + Rock Monster Tracer

| Field | Value |
|---|---|
| **Status** | M1.0 — asset contract IMPLEMENTED and tested; tracer and spike EXPERIMENTAL; production art pipeline FUTURE |
| **App** | `apps/the-nrvnaverse` |
| **Builds on** | [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) (§17) · [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) |
| **Governing decisions** | D-004 (stable ids — the asset-id pattern follows it), D-009 (mobile-first; adaptive quality decided with representative art), D-010 / D-013 (no binary bloat in canonical history), D-014 (no dependency change), D-016 |
| **Not in scope** | final Hub / Music art, production binary storage, optimisation and full glTF validation (generic AWE platform work H1 / H2), adaptive quality, LOD, a baked-lighting engine feature, vault reorganisation, Blender automation |

M0 Foundation is complete at Landmark v0.2. M1's first representative path is Central Hub → Music District → Placeholder Artist; **M1.0 does not build that art** — it proves the production asset contract with one engineering tracer. Nothing here is THE NRVNAVerse art direction. No `DECISIONS.md` entry was created: the contract below is a domain contract of this document; a change to it is a reviewed update of this document.

Status vocabulary in this document:

- **CURRENT CONTRACT** — implemented, tested, and binding for M1 work.
- **M1 EXPERIMENTAL** — exists to learn; may change or be removed without ceremony.
- **FUTURE** — planned, not built.

---

## 1. CURRENT CONTRACT

### 1.1 Logical identity, not files

A spatial component never names a binary. It names a **logical asset**:

```
scene component  { "type": "model", "assetRef": "ast_…" }             spatial/source/scene.m0.json      (authored)
  → registry     assets["ast_…"].currentRevision → revisions[n]       spatial/source/asset-registry.json (authored)
  → artifact     { sha256, bytes, format, storage: { backend, objectKey } }
  → runtime URL  resolved by the storage backend at GENERATE time → "url" in the generated chunk
```

- **`assetId`** — `ast_` + 16 characters from the destination-id alphabet (`/^ast_[0-9abcdefghjkmnpqrstvwxyz]{16}$/`), generated at random once. It is **never derived** from a file name, a digest, a path or a URL, and it survives renames, re-exports and new revisions.
- **Revision** — a positive integer; `currentRevision` selects the one the world uses. Each revision records the **full SHA-256** and byte count of its runtime artifact.
- **Storage** — `storage.backend` decides where the bytes live and how the URL is formed. Identity never does.

Three things are kept apart: **identity** (`assetId`) · **revision / digest** (`revisions[n].artifact.sha256`) · **storage / URL** (`storage`). Only storage knows a path.

### 1.2 Deterministic spatial resolution

`spatial-config.m0.json` names the registry (`"assetRegistry": "asset-registry.json"`, optional and additive like `portals`). `pnpm --filter the-nrvnaverse spatial:generate` replaces every `assetRef` with the current revision's runtime URL in **every** generated artifact (chunks, global scene, compatibility scene) — so:

| Change | Effect on generated artifacts |
|---|---|
| Rename the asset (`name`) or edit provenance text | none — no chunk digest changes |
| New revision (new bytes → new SHA-256 → new object key) | only the chunks that reference it get a new content-addressed name; the index moves to them |
| Move the bytes to another storage backend | only the URL changes; `assetId` and revision are untouched |

### 1.3 Content-addressed runtime artifacts

`repo-public` object key: `assets/art/<assetId>.<first 32 hex of the SHA-256>.<format>` (32 = the spatial pipeline's content-version length). The registry validator rejects any other key, and `spatial:generate` / `spatial:check` verify the stored file **byte-for-byte** (size + full SHA-256) and fail on any file under `public/assets/art/` that is not the current artifact of a referenced asset. Runtime assets are **placed** by the asset pipeline and **verified** by the spatial CLI; the CLI never generates or deletes them.

### 1.4 Immutable delivery

`next.config.ts` → `runtimeAssetHeaders()` serves exactly `/assets/art/:asset(ast_[0-9abcdefghjkmnpqrstvwxyz]{16}).:version([0-9a-f]{32}).glb` as `public, max-age=31536000, immutable`. Nothing else under `/assets` (animation clips, any unhashed file, `.gltf`, nested paths) becomes immutable, and the spatial-index revalidation rule is unchanged (`deliveryHeaders()` = the M0 spatial rules + this rule).

### 1.5 Provenance / rights gate (NRVNAVerse policy)

This is **NRVNAVerse product policy**, not a generic AWE licensing system (`scripts/spatial/assets.mjs`).

| Code | Level | When |
|---|---|---|
| `unregistered-asset-url` | FAIL | a `model` component uses a raw `url` instead of `assetRef` |
| `asset-ref-with-url` | FAIL | a component declares both |
| `invalid-asset-ref` / `unknown-asset-ref` | FAIL | the reference is not an asset id / not registered |
| `missing-asset-registry` | FAIL | a reference with no registry, or a declared registry file that does not exist |
| `asset-missing-artifact` | FAIL | the referenced asset's current revision has no runtime artifact |
| `asset-redistribution-prohibited` | FAIL | `rights.webRuntimeRedistribution: "prohibited"` |
| `asset-review-rejected` | FAIL | `review.status: "rejected"` |
| `asset-production-unresolved` | FAIL | `usage: "production"` while rights are not `cleared`, web redistribution is not `allowed`, any dependency is `unresolved`, or review is not `approved` |
| `invalid-object-key` / `unsupported-storage-backend` | FAIL | the artifact is not content-addressed / uses a backend M1.0 does not implement |
| registry schema codes (`invalid-*`, `unexpected-field`) | FAIL | strict schema; `rights.status: "cleared"` is refused unless web redistribution is `allowed` |
| `asset-internal-tracer` | WARN | `usage: "internal-tracer"` — always reported, with every open rights item |
| `m1-asset-bytes` / `m1-texture-dimension` / `m1-triangles` / `m1-unoptimized` | WARN | M1 EXPERIMENTAL warning bands (§2.2) |

Rights values are explicit: `permission ∈ { allowed, prohibited, unknown }`; `unknown` never fails an internal tracer but always blocks `production`. Every embedded third-party model / texture / animation / HDRI is a separate `provenance.dependencies[]` entry with its own status; a composite is never production-cleared while any dependency is `unresolved`. **Rights are never inferred from a file name.**

### 1.6 Source boundary

- Art sources (`.blend`, raw exports, source textures) stay **outside Git**. The raw vault (`D:\AWE-Vault`) is **read-only** to the pipeline: no writes, renames, moves, saves, reorganisation, recursive scans or whole-vault hashing. Its curation belongs to the separate asset-library effort, and M1 must not depend on its current layout.
- The registry records the source reference (path, size, modification time, SHA-256 of that one file) as provenance evidence, not as a live dependency.
- Work on copies in an isolated temporary directory outside the vault.

### 1.7 Registry schema (v1)

```
{ schemaVersion: 1, assets: { "<assetId>": {
    name, kind: "model", usage: "internal-tracer" | "production", currentRevision: <n>,
    provenance: { origin: self-authored | commissioned | licensed-third-party | partner-supplied,
                  creationContext?, creator?, source?, dependencies: [ { id, kind, description, status: cleared | unresolved | removed, notes? } ] },
    rights: { status: cleared | unresolved | restricted, license, rightsHolder, attributionRequired, attributionText,
              commercialUse, webRuntimeRedistribution, modification, restrictions[] },
    review: { status: unreviewed | internal-tracer-accepted | approved | rejected, reviewedBy, reviewedAt, notes? },
    revisions: { "<n>": { artifact: { sha256, bytes, format: "glb", storage: { backend: "repo-public", objectKey } } | null,
                          stats?, export?, pipeline?, notes? } } } } }
```

Attribution text, when required, lives in the registry (`rights.attributionText`) and is the single source for any credit line.

---

## 2. M1 EXPERIMENTAL

### 2.1 Rock Monster tracer (`ast_drbw0be6qzbft4we`)

| | |
|---|---|
| Canonical source | `D:/AWE-Vault/Blender/Rock Monster 1.7.blend` — 79,969,756 B, 2023-04-09, SHA-256 `6d063935…c040ae5368` (highest version, newest file of the series) |
| Export used | `D:/AWE-Vault/Blender/Rock Monster/Animated GLB/Rock1.glb` — 6,355,764 B, 2022-09-26, SHA-256 `62c2278b…a39154fb7`, used **unchanged**. It **predates** the current `.blend`, so its exact source revision is unknown (its mesh node is named `Lava2-body`) |
| Content | 1 skinned mesh, 38,022 triangles / 105,446 vertices, 28-joint armature, 1 material (base-color texture only, metallic 0, roughness 0.5, double-sided), 1 embedded PNG 800×3568, 1 animation clip, no extensions / cameras / lights, uncompressed |
| Runtime | `public/assets/art/ast_drbw0be6qzbft4we.62c2278be4c2180be4df622e01e2f8e4.glb` (the one M1.0 Git binary; cap 10 MiB) |
| Placement | Hub chunk component `tracer-rock-monster` at (4, 1.06, −10): right of the Hub marker, ≥ 2.5 m from every portal sensor, off the spawn → Cannabis gate route, no collider / script / portal binding |
| Provenance | origin **self-authored**, creation context **tutorial-assisted** (Nic) |
| Open dependencies | **`animation-mixamo-layer0`** — the clip is named `Armature|mixamo.com|Layer0`, which indicates Adobe Mixamo; its terms for this use are not established · **`texture-color-pallette`** — embedded "color pallette" PNG, origin not established |
| Rights | `unresolved`; commercial use / web redistribution / modification `unknown` → **INTERNAL TRACER ONLY**, never production-cleared as it stands |

**Publication note.** `NRVNAVerse/awe` is a public repository: committing the tracer makes the GLB — including the Mixamo-named clip — publicly retrievable. This was authorised for M1.0; the dependency is recorded as unresolved, not cleared.

### 2.2 Warning bands — investigation triggers only

`M1_EXPERIMENTAL_ASSET_WARNINGS` (asset gate, warning-only): one asset > 8 MiB; a texture edge > 2048 px; > 150,000 triangles; any artifact not optimised. They are **not** production budgets and never fail a check. The M0 spatial-JSON warnings (64 KiB / 64 components per artifact) remain placeholder architecture guardrails, not art budgets. The tracer currently triggers `m1-texture-dimension` (3568 px) and `m1-unoptimized`.

### 2.3 Render-regime spike (same tracer, 2026-09-24, production build, headless Chrome on a GTX 1050)

| Regime | How (actual engine behaviour) | Result on the tracer | Scene draw calls / frame (desktop) |
|---|---|---|---|
| **A — lit PBR** (as committed) | `lighting` component enabled: sun + ambient, two 2048 shadow maps | Correct: shaded rock facets, cast shadow | 17 (tracer adds 2: main + shadow pass, 76,044 tris incl. the shadow pass) |
| **B1 — global unlit switch** | `lighting.enabled = false` at runtime (a supported data change; the world re-reads the state every frame) | The tracer **stays lit**: animated models load on the engine's *classic* path and keep their glTF `MeshStandardMaterial`. The whole M0 placeholder scene turns **flat white** (its pipeline meshes switch to a basic diffuse material that does not carry their colours) | 13 (−4 = the shadow passes) |
| **B2 — per-asset `KHR_materials_unlit`** | same GLB with the extension added to its material (in memory, served through CDP interception; 6,355,772 B) | Technically works in **both** regimes (the loader yields a `MeshBasicMaterial`), but visually **incorrect for this asset**: a flat dark silhouette, because its base-color texture has no lighting baked in | 17 lit / 11 global-unlit (the tracer still casts a shadow) |

**Findings.** (1) The only visually correct path for this asset today is **A**. (2) The global switch (B1) is not a viable art regime for current content. (3) The cheapest currently viable alternative is **per-asset `KHR_materials_unlit` with lighting BAKED into the base-color texture in Blender** — a Blender-side workflow (bake), not an engine feature; its benefit is cheaper shading (no lighting in the fragment shader), not fewer draw calls. (4) **Untested and suspected from source:** a *static* (non-animated) model goes through the instanced pipeline, whose lit material is rebuilt as a Standard material under the lit regime, so `KHR_materials_unlit` may not stay unlit there — to verify before relying on baked-unlit static art (platform item, §4). **Recommendation:** keep lit PBR as the default for M1 art; plan one baked-unlit static test asset during M1.1 / M1.2 to decide per-asset baking. One tutorial monster does not set THE NRVNAVerse art direction.

Evidence: `pnpm browser:perf` screenshots `*-A-lit(-closeup).png`, `*-B1-global-unlit(-closeup).png`, `*-B2-khr-unlit-*.png` and the JSON report (OS temp dir; not committed).

### 2.4 First representative-art measurements (`pnpm browser:perf`, same run)

| Metric | Desktop 1280×800 @1 | Phone (emulated) 390×844 @3 |
|---|---|---|
| Cold load, wire / decoded | 5.37 MB / 16.6 MB, 67 requests | 5.36 MB / 16.4 MB, 67 requests |
| Tracer GLB, wire / decoded | 1,585,845 B / 6,355,764 B (served compressed; 200, `immutable`) | same |
| Environment HDR (`studio`, CDN) | 1.61 MB | same |
| Warm reload | GLB from disk cache, 0 wire bytes; whole page 42.5 KB on the wire | same |
| Ready (navigate → placed world) / tracer present | 8.8 s / 8.8 s | 7.0 s / 7.0 s |
| App measures `boot→engine-ready` / `boot→revealed` | 4.8 s / 7.8 s | 3.5 s / 6.4 s |
| Scene | 16 components, 217 objects, 16 meshes (2 skinned: avatar + tracer), 16 materials, 16 geometries, 45,003 scene-graph triangles, 3 lights | same |
| Renderer / frame (lit) | 17 draw calls, 82,959 triangles (incl. shadow passes), 14 programs, 23 geometries / 12 textures in GPU memory | 15 calls, 82,935 triangles |
| Pixel ratio | 1 (DPR 1) | 2 (DPR 3 capped at 2; backing 780×1688) |
| JS heap | 30.0 → 22.1 MB after Hub → Music → Hub | 25.5 → 22.5 MB |
| Travel Hub → Music / → Hub (wall, DOM click) | 282 ms / 597 ms | 194 ms / 489 ms |

Not measurable here, labelled as such in the report: real-device frame time (headless frame timing is vsync-capped at 60 fps on a desktop GPU — a relative indicator only), GPU memory in bytes, skinning CPU cost, per-travel stage timings (the app's travel / chunk measures are not exposed as `performance.measure` entries in production; the probe reports travel wall time instead). The M0 baseline for comparison was 3.77 MB cold without the tracer. **No budget is set from one tracer.**

### 2.5 Known engine console noise

`ModelFactory` disposes a classic (animated) model with `wrapper.stop()` and no clip name (`packages/engine/src/internal/media/model/index.js`), so `ClassicWrapper.stop(null)` logs `STOP Animation not found null` whenever an animated model is destroyed — e.g. when its chunk is retired on travel. Harmless; recorded by `browser:perf` as `knownEngineConsoleErrors`, not patched here (platform item, §4).

---

## 3. Blender → runtime contract — DRAFT (M1 EXPERIMENTAL)

A starting point for M1.1; refined with Nic on the first representative asset. None of this is automated yet, and the Rock Monster `.blend` was not modified.

| Topic | Draft rule |
|---|---|
| Units / scale | Metric, 1 Blender unit = 1 m; unit scale 1.0; a human-scale reference (≈1.8 m) in the source file |
| Transforms | Apply rotation and scale on every exported object **including armature roots** (the tracer's armature root carries an unapplied ≈44° yaw and an offset); no negative scale |
| Origin / pivot | At the object's ground contact point, centred in X/Z, unless the asset is explicitly a wall / ceiling piece |
| Forward axis | glTF +Z forward (Blender −Y with the exporter's +Y-up conversion); the default rotation faces the viewer at spawn |
| Naming | Meaningful object / material names (`<asset>-<part>`); no `Cube.001`-style names on exported objects; collision proxies suffixed `-collider` |
| Materials | Principled BSDF → glTF metal / roughness only. Transmission, clearcoat and sheen are dropped by the engine; avoid node setups the exporter cannot translate; single-sided unless double-sided is needed |
| Baked lighting (only if an asset is chosen for the baked-unlit path, §2.3) | bake lighting into the base-color texture in Blender and mark the material `KHR_materials_unlit`; verify in `browser:perf` |
| Textures | Embedded in the GLB (no external paths); power-of-two preferred; **M1 warning** above 2048 px on any edge; sources for every texture recorded as provenance dependencies |
| Cameras / lights | Not exported (the world owns lighting) |
| Animation | Only clips the world uses; named clips; third-party clips (e.g. Mixamo) are provenance dependencies with their terms recorded |
| Collision / proxy | No render-mesh colliders by default; a simplified proxy mesh when collision is needed |
| Export | glTF 2.0 binary (`.glb`), selected objects, +Y up, apply modifiers, no Draco / meshopt at export (optimisation is a later pipeline step — H1); no KTX2 |
| Ownership | `.blend` + raw export = art source (outside Git, owned by Nic); optimised runtime GLB + registry record = pipeline output; generated spatial JSON = derived |

---

## 4. Pending platform work (generic AWE — `TheCannaMan/awe`)

Checked at pushed `main` **`a96b6c1`**: **H1** (modern safe model optimiser + standalone CLI) and **H2** (glTF / GLB validation + statistics) are queued as open HIGH items in that repository's backlog ("Asset pipeline primitives — downstream production findings"), **not landed**. NRVNAVerse therefore builds no optimiser or validator: revision 1 ships unoptimised (`pipeline.optimization: "pending-platform-H1"`), statistics come from the existing `pnpm inspect-gltf` plus the glTF JSON, and full validation is pending H2. When H1 lands, the optimised output becomes revision 2 of the same `assetId`.

New generic findings from M1.0 for the platform lane:

- `ModelFactory` → `ClassicWrapper.stop(null)` console error on disposing any animated model (§2.5).
- Under the global unlit regime, pipeline meshes lose their authored colours (flat white) — the global switch is not a usable art regime.
- `KHR_materials_unlit` on static (instanced-pipeline) models is suspected not to survive the lit regime (untested; see §2.3) — part of the baked-lighting platform item (H5).

---

## 5. FUTURE

- **External content-addressed binary storage** for representative production art, **before M1.2** — a new storage backend in the registry (same `assetId`, new `storage.backend`), with its own immutable URL rule. No Git LFS.
- Mature Blender automation (inventory, transform / scale checks, export-preset enforcement) — after the contract is proven on real assets.
- Final production budgets from representative-art measurements (M1.4), desktop + emulated + real phone.
- Adaptive quality (D-009), decided from those measurements.
- LOD, if measurements justify it.
- Baked-lighting engine support (H5), if the baked-unlit static test in M1.1 / M1.2 justifies it.

---

## 6. How to add or revise a runtime asset (M1.0 procedure)

1. Copy the chosen export out of the source location into a temporary working directory; never write in the vault.
2. Record source path, size, modification time and the SHA-256 of that one file.
3. Inspect it (`pnpm inspect-gltf <copy>`); list every embedded third-party dependency.
4. Check the size against the current storage policy (M1.0: one Git binary ≤ 10 MiB).
5. Copy it to `apps/the-nrvnaverse/public/assets/art/<assetId>.<first 32 hex of SHA-256>.glb`.
6. Add or extend the registry entry (new asset: a fresh random `ast_…`; new bytes: a new revision + `currentRevision`).
7. Reference it from the scene with `assetRef`, add the component to its chunk, run `spatial:generate`, then `spatial:check`, the app tests, a production build, `browser:touch` and `browser:perf`.

## 7. Tests and commands

- `test/asset-registry.test.ts` — committed registry + binary (digest, bytes, 10 MiB cap), every gate rule, resolution (rename = no change; new revision = only the referencing chunk; id kept), determinism, storage separation, CLI byte verification, the immutable art header rule and its negative cases, and the tracer's placement guarantees.
- `test/cache-policy.test.ts` (config wired to `deliveryHeaders`), `test/spatial-pipeline.test.ts` (compatibility scene = authored scene with references resolved), `test/spatial-budgets.test.ts` (the chunk boundary case reads the Hub's real size).
- `pnpm --filter the-nrvnaverse spatial:check` — verifies the binary and prints the tracer / warning-band notices.
- `pnpm --filter the-nrvnaverse browser:perf` — the representative-art probe (`scripts/browser/art-perf-probe.mjs`, raw CDP, no dependency; measurement only).
