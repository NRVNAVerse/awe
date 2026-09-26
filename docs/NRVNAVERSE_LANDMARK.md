# NRVNAVerse Landmark

| Field | Value |
|---|---|
| **Version** | 0.2 |
| **Status** | M0 Complete · M1.1 checkpoint VERIFIED on `feat/m1-asset-contract` (not yet integrated; M1 not complete) |
| **Current milestone** | M1 — representative-art vertical slice (in progress; asset pipeline / hosting-readiness checkpoint M1.1 reached) |
| **Landmark date** | 2026-09-20 |
| **Canonical repository** | https://github.com/NRVNAVerse/awe (fork of https://github.com/oncyberio/awe) |
| **Companion documents** | [NRVNAVERSE_OPERATING_GUIDE.md](./NRVNAVERSE_OPERATING_GUIDE.md) (project orientation / operating model — start there) · [DECISIONS.md](./DECISIONS.md) · [NRVNAVERSE_GOVERNANCE.md](./NRVNAVERSE_GOVERNANCE.md) (developer/agent governance) · [CLAUDE.md](../CLAUDE.md) (entry point) |

This file is the canonical high-level benchmark for the NRVNAVerse project. It states what is **locked**, what is **verified**, what is **experimental**, and what is only **planned or aspirational**. Read it before substantial NRVNAVerse work.

> **Project orientation / operating model** (what NRVNAVerse is, source precedence, related repositories, how humans and AI agents work together) → [`NRVNAVERSE_OPERATING_GUIDE.md`](./NRVNAVERSE_OPERATING_GUIDE.md). This Landmark records *current state*; the guide records *how we operate*.

Labels used throughout:

- **[LOCKED]** — a principle that implementation must not silently contradict. Changing it requires an explicit decision in `DECISIONS.md` and a Landmark version bump.
- **[VERIFIED]** — confirmed by reading code, Git history, or running a check.
- **[EXPERIMENTAL]** — exists in code but is unreviewed/untested (notably Ghost's fork).
- **[PLANNED]** — designed and scheduled, not implemented.
- **[ASPIRATIONAL]** — long-term direction, not a commitment and not current functionality.

---

## 1. North Star  [LOCKED]

NRVNAVerse is a connected digital ecosystem combining:

- entertainment
- education
- discovery
- commerce

Its purpose includes elevating brands and creators — especially those whose quality or creativity may exceed their marketing resources — and empowering consumers through richer discovery, education, interaction, and connection.

## 2. Dual Interface  [LOCKED]

| Interface | Address | Product name |
|---|---|---|
| **WEB** | https://www.nrvnaverse.com | NRVNAVerse (web) |
| **SPATIAL** | `worlds.nrvnaverse.com` | **THE NRVNAVerse** |

Web and Spatial are **parallel interfaces to the same ecosystem**, not unrelated products. They are expected to share destination metadata, identity concepts, analytics, design language, and commerce references.

## 3. AWE Platform Principle  [LOCKED]

AWE (the open-source `oncyberio/awe` engine and its ecosystem) is the core spatial platform.

NRVNAVerse should **strengthen AWE rather than evolve into a closed competing spatial platform**. Generic engine/network capabilities should remain generic and upstream-compatible whenever practical.

**Potential AWE / core candidates** (generic; keep upstream-compatible):

- chunk streaming
- portals
- travel primitives
- multiplayer primitives
- presence
- friends
- find-a-friend
- teleport-to-friend
- generic spatial/network identity concepts

**NRVNAVerse primarily owns** (application/content layer):

- THE NRVNAVerse
- destination network
- districts
- brand experiences
- artist experiences
- venues
- events
- education
- discovery
- commerce integrations
- analytics products
- business tooling
- experience design

## 4. Core Experience Model  [LOCKED]

- Entertainment, Education, and Commerce are **ecosystem-wide capabilities**. They are not mandatory separate districts.
- **Events are cross-network objects** associated with destinations, artists, brands, venues, etc.
- Commerce can appear contextually anywhere appropriate.

## 5. Spatial Model  [LOCKED]

Potential object types include: `hub`, `district`, `brand`, `artist`, `venue`, `event`, `experience`.

- **Districts organize spatial navigation.**
- **Districts are NOT a mutually exclusive taxonomy.** A destination may have a primary spatial district while participating in multiple categories, tags, relationships, collaborations, and events.

## 6. Destination Identity  [LOCKED]

Every meaningful destination uses an **immutable, stable destination ID**.

Identity must **NOT** depend on:

- coordinates
- chunk keys
- portal positions
- slug
- URL
- domain

Slugs, URLs, chunk keys and spawn positions are derived, replaceable attributes that resolve *to* an ID — never the other way round.

## 7. Auth vs Gates  [LOCKED]

Two separate concepts that must never be combined:

| Concept | Meaning | Examples |
|---|---|---|
| **AUTH** | permissions / roles | `administrator`, `moderate`, `speak`, `build` |
| **GATES** | visitor-entry conditions | `age21`, `ticket`, `member`, `invite` |

Note: Ghost's experimental studio code stores a per-chunk `auth: string[]` that is documented there as "role ids permitted to enter this chunk". Under this principle that field describes a **gate**, not auth, and must be reconciled before it is used in NRVNAVerse work (see Section 12).

## 8. Mobile  [LOCKED]

Mobile is first-class. Use **adaptive rendering/quality inside the same NRVNAVerse** rather than creating a separate consumer-facing "Lite" product.

## 9. Cannabis  [LOCKED]

- Cannabis may exist in **separately gated 21+ spatial areas**.
- Compliance policy must stay **configurable at the application/content layer**.
- Do **not** hardcode jurisdiction-specific legal assumptions into AWE engine core.
- **NRVNAVerse itself does not sell or distribute cannabis.**

## 10. First Vertical Slice  [LOCKED scope · VERIFIED M0 architecture slice]

```
THE NRVNAVerse Hub
  → Music District
      → Placeholder Artist
  → Fashion / Culture District
      → Placeholder Brand
  → 21+ Cannabis District
      → NRVNA Farms Placeholder
```

This is a **technical vertical slice** — it proves architecture, navigation, loading, metadata, web handoff and scalability. It is **not** final visual or world design.

**M0 state (VERIFIED 2026-09-20).** The placeholder destination graph above exists as seven committed manifests with stable ids, and the stable-id navigation / selective loading / gate-before-fetch architecture over it is proven in tests and in the browser (Section 12, "M0 Foundation Completion Gate"). The Hub, Music District, Fashion / Culture District, Placeholder Artist and Placeholder Brand are enterable through their implemented navigation paths (deep link, directory, physical portals). The 21+ Cannabis District can be **targeted** by deep link, by the directory and by the physical `portal-hub-cannabis` sensor in the Hub (one of the seven authored portal bindings, runtime doc §13), but every attempt is refused at the manifest gate before the cannabis chunk is fetched — the portal exists without weakening the gate boundary. The `cannabis-21` chunk owns no portals and NRVNA Farms has no internal physical portal in M0; NRVNA Farms is targetable through the directory / deep link only and is likewise refused at the gate. Neither gated destination can be entered in M0: there is no verification and no bypass. All content is placeholder geometry (boxes, labels, translucent sensor panels); nothing here is final visual or world design, and no representative art exists yet.

## 11. Long-Term Direction — NOT Current Functionality  [ASPIRATIONAL]

None of the following exists today. They are future possibilities that inform architecture choices only:

- 100+ branded destinations
- very large chunk-streamed spatial network
- automated brand onboarding
- friends
- presence
- find-a-friend
- teleport-to-friend
- cross-AWE travel
- events
- account continuity
- analytics
- creator/business tools
- contextual commerce
- companion-app integration

## 12. Static Technical Baseline — Landmark v0.2 (M0 Complete)  [VERIFIED 2026-09-20]

### Current verified refs (v0.2)

| Ref | SHA | Meaning |
|---|---|---|
| `upstream/main` (oncyberio/awe) | `04a07c8d75c114d8ea217d0870eeef2c6a65635a` | official upstream AWE |
| `origin/main` (NRVNAVerse/awe) | `04a07c8d75c114d8ea217d0870eeef2c6a65635a` | **pristine, upstream-compatible base** — identical to `upstream/main`, no NRVNAVerse commits |
| `origin/nrvna/integration` | `135ec860d49268525502844e09f6b772a840a832` | **the completed NRVNAVerse M0 product work** — 18 commits ahead of `main` (apps / packages / docs only; `packages/engine`, `engine-edit`, `studio`, `tools` and `examples/*` are byte-identical to upstream) |
| `ghost/main` = local `ghost/experimental` | `a5880dd463e105275c251c61b6bfa951c2431af1` | Ghost's preserved experimental baseline (D-013), unchanged, not pushed to `origin` |

Application / package versions are unchanged by this milestone: `apps/the-nrvnaverse` **0.1.0**, `@nrvnaverse/manifest` **0.1.0** (no `APP_VERSION` bump; Landmark version ≠ application version, Operating Guide §14). Dependency policy: the only lockfile change since upstream is the registration of the two workspace importers (`44992f3`, D-014); no third-party dependency was added or changed.

### M0 Foundation Completion Gate  [VERIFIED 2026-09-20]

Why M0 is considered complete — each row is verified in the integrated code and its tests (269 app + 56 manifest), and where stated in a real browser; detail lives in the linked domain documents.

| Criterion | Verified state | Detail |
|---|---|---|
| A. Canonical destination identity | Stable `dst_…` ids generated once and committed; identity independent of coordinates, chunk keys, slug, URL and domain (validator rejects coordinates in manifests); deterministic manifest validation / generation with `generate:check`; deep links are `?destination=<id>` only, `?chunk=` ignored | [Manifest](./NRVNAVERSE_DESTINATION_MANIFEST.md) |
| B. Deterministic physical data | One authoritative spatial source (`scene.m0.json` + `spatial-config.m0.json`); generated global scene, four chunks and spatial index are byte-deterministic; `destinationId → chunkKey → spawn` resolved from the generated index at boot; `spatial:check` fails on stale / missing / unexpected artifacts; chunk files carry no identity or gate data | [Pipeline](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) §1–§7 |
| C. Application-layer chunk streaming | Official AWE `createSpace` / `ComponentManager.create / destroy` only; global scene + exactly one active chunk; fetch → validate → stage (old chunk alive) → teleport → commit → retire; every failure step leaves the previous chunk and position intact | [Runtime](./NRVNAVERSE_SPATIAL_RUNTIME.md) §1–§5 |
| D. Concurrency / lifecycle correctness | Monotonic generation + `AbortController`: latest request wins, stale work cannot teleport, commit, destroy or write the URL; same-chunk travel is a teleport only; asynchronous orchestrator / runtime disposal awaits staged mutations and the engine session; boot → dispose → re-boot verified in tests and in a real headless teardown | [Runtime](./NRVNAVERSE_SPATIAL_RUNTIME.md) §4, §14 |
| E. Stable-id physical portals | Seven authored sensor components bound to stable destination ids in the generated index (never coordinates); a sensor enter routes into the same `travelToDestination(id)` path; walked into with real input in the browser | [Runtime](./NRVNAVERSE_SPATIAL_RUNTIME.md) §13 |
| F. Gate boundary (application layer) | Gates come from the canonical manifest; evaluated before any gated chunk fetch; Hub → Cannabis (deep link, directory, portal, touch) → `gateRequired` with **zero** cannabis chunk requests in every browser run; no bypass exists. This is **application-layer gate-before-fetch, not server-side content authorization** (the static file remains publicly retrievable — Section 13) | [Runtime](./NRVNAVERSE_SPATIAL_RUNTIME.md) §7 |
| G. Delivery / cache correctness | Global scene and chunks are content-addressed (`<name>.<sha256[0:32]>.json`, digest of the exact bytes), served `immutable` behind the revalidated `spatial-index.json` version root; a stale URL is the old bytes or 404, never new bytes; repeat visits are disk-cache hits with 0 wire bytes and no conditional request; navigation stays stable-id based | [Pipeline](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) §15 |
| H. Mobile-aware M0 viability | **EMULATED MOBILE ONLY** (four viewports + 4× CPU profile): touch movement, jump, simultaneous joystick + jump, drag-look, joystick + look, orientation / canvas resize, directory closed by default on touch / narrow viewports with reachable controls and status, gate / arrival controls usable; desktop regression passed. Real iOS / Android validation is future work | [Runtime](./NRVNAVERSE_SPATIAL_RUNTIME.md) §16 |
| I. Initial guardrails | `spatial:check` warning-only budgets (64 KiB / 64 components per runtime global-scene or chunk artifact); current placeholder artifacts (≈7–10 KiB, 7–9 components) are within them; adaptive quality deliberately deferred to representative art | [Pipeline](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) §16 |
| J. Architecture boundaries | No Ghost chunk / portal code adopted (D-013); no NRVNAVerse product work in `main`; no engine / editor / studio change for M0 streaming (D-010, D-016); no new dependency (D-014); D-016 remains the governing M0 boundary | this section, Governance |
| K. Non-goals unchanged | M0 completion does **not** claim production deployment, a production-ready visual world, representative-art performance, real age verification, server-authorized gated delivery, cannabis compliance, multiplayer, friends / social graph, partner authoring, world / plots integration, analytics backend, CMS, final mobile polish or real-device certification, a final adaptive-quality architecture, web-site migration, or an upstream AWE contribution | Section 11, Section 13 |

### Repositories and Git relationship (historical v0.1 snapshot, 2026-09-19)

| Ref | SHA | Date | Notes |
|---|---|---|---|
| `upstream/main` (oncyberio/awe) | `04a07c8d75c114d8ea217d0870eeef2c6a65635a` | 2026-03-25 | "fix component factory data config isolation" |
| `origin/main` (NRVNAVerse/awe) | `04a07c8d75c114d8ea217d0870eeef2c6a65635a` | 2026-03-25 | `main` **identical to upstream** (0 ahead / 0 behind) — still true at v0.2; the NRVNAVerse work lives on `nrvna/integration` (see the v0.2 refs above) |
| `ghost/main` (Gh0sTtD3v/awe) | `a5880dd463e105275c251c61b6bfa951c2431af1` | 2026-08-04 | **6 ahead / 0 behind** upstream; merge-base = `04a07c8` |
| `upstream/dev` | `864510978661fb0d1a17db304c438067abac2b1a` | 2026-03-24 | "Headless (#9)" |
| `upstream/headless` | `8c7abd1e15897a39226a05d3690bb42511ee8f4a` | 2026-03-24 | |

- NRVNAVerse/awe was created 2026-09-19 as a GitHub fork of `oncyberio/awe` (organization-owned, public).
- Ghost opened upstream PR **oncyberio/awe#11** ("Update water-object.js", head `Gh0sTtD3v:main@a5880dd`, all 6 commits, 181 files, +21 345/−1 127). It was **closed unmerged on 2026-08-29**.
- Ghost's 6 commits add ≈ **200 MB** of Git objects (mostly binary assets under `apps/ghostt/public/assets/`).

### Ghost preservation point  [VERIFIED 2026-09-19 · D-013]

| Item | Value |
|---|---|
| Verified experimental baseline | `a5880dd463e105275c251c61b6bfa951c2431af1` — Ghost's current public `main`, independently confirmed |
| Local preservation | branch `ghost/experimental` = remote-tracking `ghost/main` = `a5880dd…` (identical) |
| Pushed to `origin`? | **No.** A local / remote-tracking reference is sufficient for now; the full history and its binaries are not imported into the canonical repository merely for preservation |
| History rewrites | None. Not split, not rebased, not republished |
| Re-fetch | `git fetch ghost` (remote `ghost` → `https://github.com/Gh0sTtD3v/awe`, push disabled) |

### Ghost's commits (faithful list, oldest first)

| SHA | Date | Subject |
|---|---|---|
| `b5bd1ac` | 2026-05-22 | Update water-object.js (adds `#include <begin_vertex>` to the water shader) |
| `6c6ca4f` | 2026-05-27 | Update .gitignore |
| `b59b367` | 2026-05-27 | Github based assets (22 studio icon PNGs under `assets/`) |
| `ac19723` | 2026-05-27 | "Warning ⚠️ AI makes mistakes. Please double check this commit before using." (+3 465/−1 129, 38 files) |
| `9899793` | 2026-08-04 | "🤖" (+867/−105, 12 files) |
| `a5880dd` | 2026-08-04 | Preview world (`apps/ghostt/`, +17 117, 116 files) |

### Known Ghost-specific systems  [EXPERIMENTAL — unreviewed, untested]

- `packages/engine/src/space/chunk-manager.ts` — spatial chunk streaming (`CHUNK_SIZE = 10 000`; camera-position boundary check; loads `/data/chunks/<x_y_z>.json`; unload-then-load; per-chunk singleton presets; `localStorage` position persistence; writes `?chunk=` to the URL; `travelTo()` teleport primitive).
- `chunked?: boolean` option threaded through `engine.ts`, `space-factory.ts`, `space-opts.ts`, `enter-space-opts.ts`.
- New **`portal` component** (`packages/engine/src/space/components/portal/*`, `engine-edit` editor, studio icon) — sensor disc, cooldown, emits `GameEvents.PORTAL_OPEN`; directory built from `portals-index.json` (**coordinate-keyed** — conflicts with Section 6 until stable IDs are added).
- `packages/engine/src/internal/ui-overlay.ts` — HTML overlay layer manager over the canvas.
- `image`/`video` components extended with `loadDistance`, `actionKey`, `focusDistance`, info-card fields and up to 3 CTA buttons (`redirect` / `popup`).
- Studio: `game-service.ts` writes chunk files, `chunk-config.json` (`info`, `auth`), `roles.json`, `portals-index.json`; new `world-config-panel.tsx`, `camera-position-hud.tsx`.
- `apps/ghostt/` — a preview world (6 chunks, portals, Colyseus multiplayer copied from `examples/multiplayer`, `bodySizeLimit: "100mb"`).
- `packages/engine-edit/src/navigation/perspective.ts` heavily rewritten (−284/+238).

### Framework and tooling versions (upstream main)

| Item | Version |
|---|---|
| Next.js | 16.1.6 (App Router, Turbopack) |
| React | 19.2.4 in apps; `@oncyberio/engine` declares `react ^18` |
| TypeScript | ^5 |
| Three.js | ^0.170.0 |
| Physics | `@dimforge/rapier3d` 0.11.2 |
| VRM | `@pixiv/three-vrm` ^2.0.6 |
| Particles | `three.quarks` ^0.15.0 |
| Navigation | `recast-navigation` ^0.38.0 |
| Post-processing | `postprocessing` ^6.38.0 |
| Asset tools | `@gltf-transform/*` 4.0.0-alpha.7, `meshoptimizer` ^0.19.0, `draco3dgltf` ^1.5.6, `sharp` ^0.34.5, `basisu` ^1.16.3 (KTX2 path disabled in `optimize-gltf.ts`) |
| Multiplayer (examples) | `colyseus` ^0.17 |
| Node requirement | `>=20.9.0` (`package.json#engines`) |
| Package manager | `pnpm@10.10.0` (`package.json#packageManager`) |
| Workspaces | `packages/*`, `examples/*`, `apps/*` |

### Available checks (root `package.json`)

`engine:check`, `engine:test`, `engine-edit:check`, `tools:check`, `tools:test`, `studio:check`, plus asset CLI scripts (`inspect-gltf`, `validate-scene`, `optimize-model`, `optimize-vrm`, `add-model`, `add-avatar`, `bake-anim`, `upload-asset`, `run-space`).

### Install and checks executed  [VERIFIED 2026-09-19 · M0 Step 0]

| Step | Result |
|---|---|
| `corepack enable --install-directory %USERPROFILE%\.local\bin` | pnpm resolved from `package.json#packageManager` → **10.10.0** |
| `pnpm install --frozen-lockfile` | **Success** — 976 packages resolved, `Done in 24m 58.6s using pnpm v10.10.0` (the first run was killed by the AI coding session while it was diagnosing the very slow link phase — the process was slow, not hung — and the install was resumed from the store: `reused 968, downloaded 0`). `pnpm-lock.yaml` and `package.json` SHA-256 unchanged before/after. Frozen re-run: "Lockfile is up to date… Already up to date" in 6 s. |
| pnpm warning | `Ignored build scripts: msgpackr-extract` — pnpm 10 blocks lifecycle scripts by default; `msgpackr-extract` is an optional native accelerator for `msgpackr` (Colyseus dependency) with a pure-JS fallback. Not approved; revisit only if multiplayer performance work needs it. |
| Workspaces | 11 packages: root `awe`, `@oncyberio/engine`, `@oncyberio/engine-edit`, `@oncyberio/studio`, `@oncyberio/tools`, `create-oncyber-app@0.1.4`, examples `starter`, `multiplayer`, `auth-multiplayer`, `football-demo`, `zombie-survival` |
| `pnpm engine:check` (`tsc --noEmit`) | **Pass** (16 s) |
| `pnpm engine-edit:check` | **Pass** |
| `pnpm tools:check` | **Pass** |
| `pnpm engine:test` (vitest) | **Pass** — 27 test files, 126 tests |
| Not run | `studio:check`, `tools:test`, any Next.js `dev`/`build`, any example app. These remain unverified at v0.1. |

### NRVNAVerse implementation state — M0 Step 1  [VERIFIED 2026-09-19]

Branch `feat/m0-app-foundation` (from `nrvna/integration`). Full description: [`NRVNAVERSE_DESTINATION_MANIFEST.md`](./NRVNAVERSE_DESTINATION_MANIFEST.md).

| Item | State |
|---|---|
| `packages/nrvna-manifest` (`@nrvnaverse/manifest`) | Destination manifest contract **schema v1**; validator with stable error codes; stable-id resolver (hub fallback); deep-link contract (`?destination=<id>`, allow-listed `from`/`ref`/`return`, `return` is a token resolved through manifest data — never a URL); deterministic generator; `SpatialTravelAdapter` interface. Zero runtime dependencies. 49 vitest tests pass; `tsc` clean. |
| Seven placeholder manifests | Hub, Music, Fashion / Culture, 21+ Cannabis districts, Placeholder Artist (→ Music), Placeholder Fashion / Culture Brand (→ Fashion / Culture), NRVNA Farms Placeholder (→ Cannabis). Stable ids generated once and committed. `age21` gate + `ageRestriction` modelled (placeholder config, `enforced: false`, jurisdictions `placeholder`) on the Cannabis district and NRVNA Farms. |
| Generated views | `generated/destinations.json`, `generated/directory.json` — derived; `generate:check` and a test fail if stale; two runs produce no diff. `portals-index.json` is **not** canonical and not generated. |
| `apps/the-nrvnaverse` | Next.js 16 app shell adapted from `examples/starter`: identity, runtime load of `destinations.json` via `/api/destinations`, URL parsing, resolution with non-fatal notices, state model `boot → resolvingDestination → ready \| error` (planned phases `loadingGlobals`, `loadingChunk`, `traveling`, `arrived`, `gateRequired` reserved, not implemented), `PlannedSpatialAdapter` reporting travel unavailable. 9 vitest tests pass; `tsc` clean; `next build --turbopack` succeeds; smoke-tested in a browser (deep link, hub fallback, unsafe `return` rejected, `?chunk=` ignored, in-app navigation). |
| Not implemented | No engine mounted, no chunk streaming, portals, travel, placement data, gate enforcement, compliance policy, commerce, auth system, web interface. |
| Ghost boundary | No Ghost code inspected beyond the already-documented interfaces, copied, cherry-picked or depended on (D-013). |
| Dependencies | No new third-party packages; every declared dependency already exists in `pnpm-lock.yaml` at the same version. The `importers` entries for the two new workspace packages were added in `44992f3` (separately approved under D-014); `pnpm install --frozen-lockfile --offline` succeeds. No third-party dependency versions were added or changed. |

### NRVNAVerse implementation state — M0 Step 2A  [VERIFIED 2026-09-19]

Branch `feat/m0-spatial-runtime` (from `feat/m0-app-foundation`). Full description: [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md).

| Item | State |
|---|---|
| Official AWE runtime | Mounted in `apps/the-nrvnaverse` via the upstream starter lifecycle (`createSpace → controls/camera/mover → reveal → start → dispose`); desktop controls verified; official touch joystick/jump path preserved (not exercised on a device). |
| Prototype scene | One minimal static scene (`public/data/static-scene.json`): Hub, Music District + Placeholder Artist, Fashion / Culture District + Placeholder Brand, and a walled, labelled 21+ enclosure. No new binaries, no Ghost assets. |
| Placement registry | `src/lib/spatial/placements.m0.ts`, keyed by stable destination id, separate from the manifests (which remain coordinate-free — tested). `portals-index.json` not created. |
| Spatial adapter | `AweSpatialAdapter` implements `canTravel(id)`, `resolvePlacement`, `travelTo` (same-scene teleport via `Mover.teleport`), `onPhase`; only the adapter/registry know coordinates. |
| Gates | Any manifest `gates[]` → `gate-required`, no teleport, `gateRequired` phase; deep link to a gated id places the visitor at the Hub. No verification, policy or bypass exists. |
| State / URL | Phases `loadingGlobals`, `ready`, `traveling`, `arrived`, `gateRequired` implemented; `loadingChunk` reserved. URL stays `?destination=<id>`; `?chunk=` never written. |
| Instrumentation | `performance.mark/measure` (`nrvna:*`), dev console + panel only. Baseline (dev server, warm): boot→engine-ready ≈ 2 s, boot→revealed ≈ 4.7 s, same-scene travel ≈ 1–20 ms. |
| Checks | 35 app vitest tests, 49 manifest tests, `check`, the strict tsconfig and `next build` pass; browser checklist A–L executed. |
| Not implemented | Chunk streaming, portals, generated spatial index, age verification, compliance policy, commerce, auth, web interface (Step 2B+). |
| Ghost boundary | No Ghost code read, copied, cherry-picked or depended on. |
| Dependencies | None added; `package.json` dependency ranges and `pnpm-lock.yaml` unchanged. |

### NRVNAVerse implementation state — M0 Step 2B.1  [VERIFIED 2026-09-19]

Branch `feat/m0-chunk-streaming` (from `nrvna/integration`). Full description: [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md).

| Item | State |
|---|---|
| Authoritative physical source | `apps/the-nrvnaverse/spatial/source/scene.m0.json` (complete authored M0 scene, 33 components) + `spatial-config.m0.json` (schema v1: `worldId`, global membership, 4 logical chunks with explicit component membership, 7 destination placements `destinationId → chunkKey → spawn`). Carries no destination metadata and no gates — any extra field is rejected. |
| Pipeline | Dependency-free Node ESM (`scripts/spatial/pipeline.mjs` pure, `cli.mjs` I/O), JSDoc-typed and strict-checked; `spatial:validate` / `spatial:generate` / `spatial:check` package scripts. 23 stable validation codes incl. unsupported schema, duplicate/unsafe chunk keys, unknown/multiply-owned/unassigned components, unknown destination/chunk, non-finite spawn/orientation, wrong world id, duplicate/missing placement, non-THE-NRVNAVerse destination, stale output. |
| Generated artifacts (`public/data/`) | `static-scene.json` (compatibility full scene, still what the runtime loads), `spatial/global-scene.json` (7 global components: avatar, VRM anims, lighting, background, envmap, fog, ground), `spatial/chunks/{hub,music,fashion-culture,cannabis-21}.json`, `spatial/spatial-index.json`. Deterministic: second run writes nothing; byte-identical across reordered source; committed outputs verified by `spatial:check` and tests. Sizes: 36 954 / 9 763 / 5 375 / 7 321 / 7 578 / 7 335 / 1 863 bytes. `portals-index.json` still not created. |
| Placement registry | `placements.m0.ts` **deleted**. `app-store.ts` loads the generated index at boot (`FetchSpatialIndexSource`) and builds the adapter registry with `registryFromSpatialIndex`; `PhysicalPlacement` gained `chunkKey`; `placementRef` is `chunk:<key>` (diagnostics only). A test asserts `src/` contains no stable ids or coordinate literals. |
| Runtime behaviour | Unchanged from Step 2A by design: full compatibility scene, same-scene teleport, gate refusal for the cannabis destinations, `?destination=<id>` only, `?chunk=` never written. Browser smoke re-executed after the migration. |
| Checks | 69 app vitest tests (was 35), `check` (incl. strict tsconfig now also covering the pipeline scripts), `next build` pass. |
| Not implemented | Runtime chunk loading/unloading, `loadingChunk`, portals, age verification, gate persistence, jurisdiction policy, hosting-level protection of gated chunk URLs (Step 2B.2+). |
| Ghost boundary | No Ghost code read, copied, cherry-picked or depended on; engine/engine-edit/studio untouched. |
| Dependencies | None added; `package.json` gained three scripts only; `pnpm-lock.yaml` unchanged. |

### NRVNAVerse implementation state — M0 Step 2B.2  [VERIFIED 2026-09-19]

Branch `feat/m0-chunk-runtime` (from `nrvna/integration`). Full description: [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md).

| Item | State |
|---|---|
| Runtime boot | Official AWE (`createSpace`) is initialised from the generated **global scene** (`spatialIndex.globalSceneUrl` → `/data/spatial/global-scene.json`: avatar, animations, environment, ground). The compatibility full scene `static-scene.json` is **no longer requested by the runtime** (source scan + fake-runtime boot test + browser resource list); it remains a generated validation/debugging artifact. |
| Active-chunk model | Exactly **one** chunk is instantiated at a time. `ChunkOrchestrator` (app-owned, `src/lib/spatial/chunk-orchestrator.ts`) owns fetch → validate → stage → teleport → commit → retire over the official `space.components.create(data, { abort })` / `destroy` wrappers in `AweSpatialRuntime`; engine `Component3D` handles never leave the runtime file (opaque `ChunkBatch`). Same-chunk travel (Music District ↔ Artist, Fashion ↔ Brand) is a teleport only. |
| Transition safety | Never unload-before-fetch: the target is fetched, validated and fully staged **while the old chunk stays alive**; the visitor is teleported with both alive; the old chunk is retired only after a successful placement. Fetch 404 / network error / malformed payload / partial component creation / teleport failure all leave the previous chunk and position intact (partial targets are destroyed). A failed old-chunk cleanup after arrival keeps the target active and is reported, never rolled back. |
| Latest request wins | Monotonic request generation + `AbortController` per request (signal passed to fetch and to `ComponentManager.create`), re-checked at every async boundary; a promise-chain mutex serialises stage/commit/rollback. Stale requests cannot teleport, commit, destroy, change state or write the URL; they resolve `superseded` (new `TravelResult` status), not as a user-facing failure. |
| Gate before fetch | Manifest `gates[]` are evaluated before the orchestrator is consulted: `chunks/cannabis-21.json` is never requested on the initial gated deep link (Hub chunk loaded as fallback, app `gateRequired`), on a directory click, or on back/forward. `enforced: false` is not a permission. No verification, bypass or fake pass exists. |
| State / URL | `loadingChunk` is implemented (`initial` during boot, `travel` for cross-chunk travel only); `PLANNED_PHASES` is empty. Travel may supersede an in-flight travel. URL stays `?destination=<id>`, written only after committed arrival; `?chunk=` never written. |
| Instrumentation | `chunk-fetch`, `chunk-validate`, `chunk-stage`, `cross-chunk-travel`, `same-chunk-travel`, `travel` with outcome. Warm dev-server baseline: cross-chunk 21–95 ms (fetch 10–78 ms, stage 8–14 ms), same-chunk ≈0.1 ms, superseded fetches abort in ≈20 ms. |
| Checks | 126 app vitest tests (was 69), 56 manifest tests, `check` (incl. strict pass), `spatial:check`, `generate:check`, `next build` pass. Browser checks A–N all executed (A, D, E, F, G, J, K, M, N in Chrome via the extension; B, C, H, I, L in headless Chrome over CDP after the extension tab went to the background). |
| Not implemented | 3D portals (2B.3), prefetch/cache/neighbour warming (2B.4), age verification, gate persistence, jurisdiction policy, hosting-level protection of gated chunk URLs. |
| Ghost boundary | No Ghost code read, copied, cherry-picked or depended on; his ChunkManager, localStorage persistence, `?chunk=` URL mutation and unload-first transition were explicitly not adopted; engine/engine-edit/studio untouched. |
| Dependencies | None added; `package.json` dependency ranges and `pnpm-lock.yaml` unchanged. |

### NRVNAVerse implementation state — M0 Step 2B.3  [VERIFIED 2026-09-19]

Branch `feat/m0-portals` (from `nrvna/integration`). Full description: [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) §13 and [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) §14.

| Item | State |
|---|---|
| Physical portals | Seven official mesh sensors (`collider { enabled, FIXED, CUBE, isSensor: true }`, translucent primitives, no assets) in the authored scene, each owned by the chunk in which it is encountered (hub 3, music 2, fashion-culture 2, cannabis-21 none) and therefore staged/retired with it. Contract: **sensor enter → stable destination id → existing `travelToDestination(id)`**. Bindings: Hub → Music `dst_gm3xs4a3tws7bgh3`, Hub → Fashion / Culture `dst_9c4wxtpec8awsx1q`, Hub → 21+ Cannabis `dst_441dtdafq3e3ehjn`, Music → Hub `dst_7g19n1vm9ackw8a0`, Music → Placeholder Artist `dst_1qtfn9qjg9kf6jyd`, Fashion → Hub `dst_7g19n1vm9ackw8a0`, Fashion → Placeholder Brand `dst_tgfh5h5jvm3wj0w7`. |
| Authoritative source / generated index | `spatial-config.m0.json` gained an optional, additive `portals[]` (`componentId → chunkKey → destinationId`, nothing else; schema version still 1); the pipeline validates references only (14 stable codes, never copies gate truth) and emits a deterministic `portals` section in `spatial-index.json` keyed by physical component id. Chunk payloads carry the sensor geometry only — no destination id, URL, gate or metadata (tested). `portals-index.json` still not created. |
| Runtime seam | `AweSpatialRuntime.onPlayerEnterSensor(componentId, cb)` over official `ComponentManager.byInternalId` + `Collider.isSensor` + `Component3D.onSensorEnter`, filtered to the player avatar; pure helper `sensor-subscription.ts`; idempotent unsubscribe safe after disposal; `Component3D` never leaves the runtime file. |
| Portal controller | App-owned `PortalController`: binds exactly the active chunk's portals on every committed arrival (no-op for same-chunk travel, released on chunk switch, disposed before orchestrator/runtime), routes the exact stable id once per SENSOR ENTER (microtask-deferred), never inspects gates, fetches, teleports, resolves spawns or touches history. Gated Hub → Cannabis portal → `gateRequired`, **no cannabis fetch**, visitor stays in the Hub, sensor stays bound, no bypass. |
| Checks | 177 app vitest tests (was 126), 56 manifest tests, `check` (incl. strict pass), `spatial:validate/generate/check` (second generation writes nothing), `generate:check`, `next build` pass. Browser checks A–N executed in headless Chrome over CDP with the **real avatar walked by trusted WASD input into the real sensor colliders**; cannabis chunk never requested; URLs only ever `?destination=<id>&from=spatial`. |
| Sizes (bytes, LF) | `static-scene.json` 46 113 (was 36 954), chunks hub 9 288 / music 9 929 / fashion-culture 10 216 / cannabis-21 7 335 (unchanged), global scene 9 763 (unchanged), index 2 652 (was 1 863). Text JSON only. |
| Not implemented | Prefetch/cache, budgets, mobile/adaptive quality, async mutation-queue shutdown hardening (2B.4); age verification, gate persistence, jurisdiction policy, hosting-level protection of gated chunk URLs; final portal art. |
| Ghost boundary | No Ghost code read, copied, cherry-picked or depended on; his `portal` component, `PORTAL_OPEN` event, coordinate-keyed `portals-index.json` and portal directory remain unadopted; engine/engine-edit/studio untouched. |
| Dependencies | None added; `package.json` and `pnpm-lock.yaml` unchanged. |

### NRVNAVerse implementation state — M0 Step 2B.4A  [VERIFIED 2026-09-19]

Branch `feat/m0-hardening-correctness` (from `nrvna/integration`). Correctness / lifecycle / shutdown hardening only — no new travel architecture, prefetch, cache, budget, mobile tier or gate flow. Full description: [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) §14.

| Item | State |
|---|---|
| Orchestrator shutdown | `ChunkOrchestrator.dispose()` is now `Promise<void>`: synchronously marks disposed, bumps the generation and aborts the controller (fetch/creation cancelled, `transitionTo` fails structurally), then **awaits the mutation queue** and retires the active chunk as the **last** mutation — exactly once. A stale transition still in `stageChunk` finishes, sees it is stale and retires its own batch before shutdown resolves. Idempotent; never rejects (cleanup failures reported through `warn`; `mutationTail` catch-guarded so no unhandled rejection). |
| Runtime shutdown | `AweSpatialRuntime.dispose()` is now `Promise<void>`, idempotent: destroys the Space exactly once, then awaits the engine session settling back to `"void"` (`settleEngineSession`, bounded fallback that warns rather than hangs), so a replacement `init()` cannot hit the engine's "already has a session" guard. Engine core, `ComponentManager`, `LOAD_TIMEOUT` and animation scheduling untouched. |
| App lifecycle | The incremental boolean globals were replaced by one explicit `AppRun` (`booting → running → disposing → idle`) with a `disposeRequested` flag and `booted`/`settled` promises. All eight required cases are correct: first boot, duplicate boot while booting (one runtime), normal dispose, repeated dispose, boot after dispose, boot failure before running, dispose while booting, boot while a previous async dispose is still finishing (new Space never created while the old one shuts down). |
| Boot-failure recovery | A boot that fails before `running` (destination source, spatial index, malformed index, runtime init, both chunks fail) unwinds every allocated resource in its `finally`, keeps the `error` state on screen, clears the run, and leaves nothing wedged — a later boot works. |
| React Strict Mode | Preserved the Step 2A "don't destroy the initial boot on the simulated cleanup" intent via `disposeRequested`: setup → simulated cleanup → setup rescinds the pending dispose and adopts the in-flight boot (one runtime, never destroyed). A real unmount unwinds. Strict Mode not disabled; runtime safety not weakened. |
| Stale portal work | `PortalController` deferred triggers now carry the binding **epoch**; a trigger whose binding changed (chunk switch, release, dispose) between SENSOR ENTER and its microtask is dropped, never turned into stale travel. Legitimate entry still routes exactly once; no debounce/cooldown. `release()` attempts every unsubscribe even if one throws (reported). |
| Failure containment | `teardown` steps are best-effort: a failing step (runtime.dispose, retireChunk, stale cleanup, portal unsubscribe) is reported and the following steps still run; the lifecycle always returns to `idle` and the next boot is deterministic. No generalized error-reporting platform added. |
| Checks | 213 app vitest tests (was 177), 56 manifest tests, `check` (strict pass incl. the orchestrator/portal changes), `spatial:check`, `generate:check`, `next build` all pass. |
| Browser validation | Headless Chrome + SwiftShader over raw CDP against `next dev`, real avatar walked into real sensor colliders: normal Hub boot, all portals, gate-before-fetch (cannabis fetch count 0), and — the target of this step — a **real teardown during a cross-chunk travel followed by a re-boot that created a fresh Space** (no "engine already has a session"), plus a repeat boot→dispose→boot cycle twice in one page. No stale portal travel, no duplicate bindings, no URL write after dispose, no new console error attributable to the hardening. |
| Carried disposal risk | **Closed** (see Section 13). Background-tab `LOAD_TIMEOUT` remains a separate upstream risk, unchanged. |
| Ghost boundary | No Ghost code read, copied, cherry-picked or depended on; engine/engine-edit/studio untouched. |
| Dependencies | None added; `package.json` dependency ranges and `pnpm-lock.yaml` unchanged. |

### NRVNAVerse implementation state — M0 Step 2B.4B  [VERIFIED 2026-09-20]

Read-only audit 2B.4B.1 (no repo change), then branch `feat/m0-http-cache-delivery` (2B.4B.2, from `nrvna/integration`): a first query-token implementation (`4c64efd`) and, after independent review found a deployment-boundary correctness flaw in it, a follow-up commit on the same branch that makes the artifacts truly content-addressed. Performance step delivered as **HTTP delivery policy only** — no new travel architecture, no application cache, no prefetch, no retained chunks, no gate change. Full description: [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) §15 and [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) §15.

| Item | State |
|---|---|
| 2B.4B.1 measurement | Cross-chunk travel ≈45 ms median locally (validation ≈0, staging ≈10 ms for the placeholder chunks). Every **repeat** chunk fetch was a conditional HTTP revalidation: `next dev` and `next start` both served `Cache-Control: public, max-age=0` + weak `ETag`/`Last-Modified`, so each revisit paid one round trip (≈175 ms per repeat travel under a bounded 150 ms-latency profile; ≈36 ms / 0 body bytes with a long-lived policy simulated in the browser). |
| Decision B | HTTP delivery follow-up only. **Rejected for M0:** application raw/validated payload cache (the browser HTTP cache already holds the bytes; a second copy adds memory, invalidation and a stale-data surface), predictive/neighbour prefetch (fetches chunks the visitor may never enter; a gated neighbour would violate gate-before-fetch, D-006), instantiated-chunk retention, Service Worker / CacheStorage / IndexedDB / localStorage. |
| Review correction | The first 2B.4B.2 commit (`4c64efd`) kept stable file names and appended `?v=<digest>` to the URLs. **Rejected in independent review:** a query changes the browser's cache key but never selects bytes on the server, so after a deployment an old index's `music.json?v=HASH_A` would be answered with the *new* `music.json` under `immutable` — content B cached under HASH_A, old placement data combined with new geometry; the same-deployment tests could not see it. Corrected by a follow-up commit on the same branch (history kept: query version → content-addressed correction). |
| Content addressing | The global scene and every chunk are written as `global-scene.<digest>.json` / `chunks/<key>.<digest>.json`, digest = first 32 lowercase hex chars (128 bits) of SHA-256 over the exact serialized artifact text (`node:crypto`, no dependency); `globalSceneUrl` and every `chunks[key].dataUrl` are those file paths, no query. **Invariant: the digest in a requested file name corresponds to the bytes in that file** — an old URL after a deployment is the old bytes (if retained) or a 404, never new bytes. Same content → same name; any byte change → new name → new URL. Chunk keys, destination ids, gates and `schemaVersion` (1) unchanged; no new index field. Generation order: artifact texts → names from those texts → index (no circularity). The stable unversioned copies are **not** generated any more (option A: their only non-runtime consumers were tests, which now read through the index). `static-scene.json` unchanged. |
| Stale-file policy | `spatial:generate` writes exactly the current set, then removes every file in its output namespace that matches its own content-addressed shapes but is not current (previous versions, removed chunks) and prints `removed stale …`; anything else in the namespace (legacy unversioned names, `.bak`, hand-placed files) is reported as a leftover and **never deleted**; nothing outside the namespace is touched; no generic file cleaner. `spatial:check` fails on stale, missing and unexpected files. A second generation writes and removes nothing; after a content change Git shows old name deleted + new name added + index. Consequence: a stale digest is a **404** in the next deployment. |
| Version root | `/data/spatial/spatial-index.json` keeps its fixed URL and is served `public, max-age=0, must-revalidate` (explicit rule); it points at the immutable content-addressed artifact paths. |
| Cache rules (`next.config.ts` `headers()`) | `/data/spatial/global-scene.:version([0-9a-f]{32}).json` and `/data/spatial/chunks/:chunk([a-z0-9-]+).:version([0-9a-f]{32}).json` → `public, max-age=31536000, immutable`; **no query condition** (confirmed against the installed Next 16.1.6 `path-to-regexp` and the built `routes-manifest.json`). |
| Unversioned / malformed safety | Legacy `global-scene.json` / `chunks/<key>.json`, the `?v=` form, short / uppercase / non-hex digests, `.bak`, dotted or nested paths match no rule and are 404s with `private, no-cache, no-store` — never immutable. `static-scene.json` keeps `public, max-age=0`. Verified on the production server (GET + HEAD, URLs read from the served index). |
| Cross-deployment proof | Generator- and CLI-level regression tests: Music A at `music.<HASH_A>.json` → Music B at `music.<HASH_B>.json`, `HASH_B ≠ HASH_A`; generation B has no output at the old name; the old file still holds A until `generate` removes it (never overwritten); every content-addressed output in both generations is the digest of its own bytes; unrelated chunks and the global scene keep identical names and bytes; the two indexes differ only in the Music URL. Production: fabricated old-digest Music paths → `404`, body ≠ current Music. |
| Runtime | No behavioural change: `FetchChunkDataSource`, orchestrator, adapter, portal controller and `AweSpatialRuntime.init` pass the whole URL to `fetch`; no runtime hashing, file-name construction or digest parsing (stubbed-fetch + comment-stripped source-scan tests). A digest never appears in a navigation URL (`?destination=<id>&from=spatial` only). |
| Gate / cannabis | Hub → Cannabis → `gateRequired` → **zero** requests for the content-addressed cannabis chunk URL (browser-verified; 0 cannabis requests across the run). The cannabis URL is served immutable like every artifact — delivery metadata, not authorisation, not prefetch; D-006 unchanged. Static gated-file availability remains the known non-M0 limitation and is **not** solved by this step; a content-addressed name is not authorisation. |
| Browser validation | Fresh headless-Chrome profile (GPU-backed, raw CDP) against `next build` + `next start --port 3211`, focused Hub → Music → Hub → Music (the full 2B.4B.2 audit was not rerun): first Music visit network `200` 1 387 B (`chunk-fetch` 27.8 ms); every revisit of the exact hashed URL `fromDiskCache: true`, 0 wire bytes, `transferSize 0`, `deliveryType "cache"`, **no `If-None-Match`** (`chunk-fetch` 3.2–25.6 ms, travel 14–36 ms; the later revisits 14–16 ms vs 8–14 ms measured for the query form). No console error. The query-form run had additionally shown 150 ms-latency and reload behaviour (cache-cold 165 ms vs revisit 19 ms; reload revalidates only the index) — unchanged in mechanism, not re-measured. |
| Checks | 244 app vitest tests (235 at `4c64efd`, 213 before 2B.4B; +11 content-addressing incl. the cross-deployment proof, +7 CLI lifecycle, +7 URL-consumer, +6 cache-policy; exact-URL assertions tightened to the hashed shape, none weakened; five suites now read chunk payloads through the index), 56 manifest tests, `check` (incl. strict `checkJs` over pipeline and CLI), `spatial:validate/generate/check` (second generation writes and removes nothing), `generate:check`, `next build` pass. |
| Ghost boundary | No Ghost code read, copied, cherry-picked or depended on; engine/engine-edit/studio untouched. |
| Dependencies | None added; `package.json` and `pnpm-lock.yaml` unchanged (`node:crypto` is built in). |
| Status | **2B.4B complete.** 2B.4C (budgets, mobile/adaptive quality) remains; M0 is still incomplete; Landmark version unchanged; no new decision needed (D-004, D-006, D-013, D-014, D-016 govern). |

### NRVNAVerse implementation state — M0 Step 2B.4C  [VERIFIED 2026-09-20 · emulated mobile · independently reviewed and integrated]

Read-only audit 2B.4C.1 (no repo change; emulated mobile matrix, content / boot / travel / memory baselines, capability-repo comparison), then branch `feat/m0-mobile-guardrails` (2B.4C.2, from `nrvna/integration`): a bounded mobile HUD correction in `apps/the-nrvnaverse` plus warning-only spatial budgets. No adaptive quality, no engine / editor / studio change, no dependency change. Full description: [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) §16 and [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) §16.

| Item | State |
|---|---|
| Test environment | **EMULATED MOBILE, not a physical device**: HEAD-parity `next build` + `next start`, headless Chrome (GPU-backed) over raw CDP with a mobile UA, touch emulation (coarse pointer, 5 touch points), device metrics 375×667 @2, 390×844 @3, 844×390 @3, 768×1024 @2, real `Input.dispatchTouchEvent`s, one 4× CPU-throttled profile; plus one 1280×800 desktop regression. iOS Safari, physical notches / home indicator, pull-to-refresh and browser chrome are **not** covered. |
| Touch viability (2B.4C.1, unchanged code paths) | Official joystick moves the avatar (first movement ≈125–175 ms after touch; stops ≤0.5 s after release **and** `touchcancel`), jump works, joystick + jump on two pointers work, canvas drag-look works without pointer lock (engine `Touch.delta()` → app `Look` → third-person rig), joystick + look on two fingers work; portrait ↔ landscape ↔ portrait keeps canvas CSS / backing store / camera aspect exact with no stuck input; the engine caps the renderer pixel ratio at 2 (DPR 3 → 780×1688 backing). Under 4× CPU slowdown touch responsiveness is unchanged (boot 7.0–7.7 s, cross-chunk travel 79–190 ms). |
| Blockers found (2B.4C.1) | With the directory open by default, ≤390 px viewports showed no world and the only close control was 0 % tappable (aside + joystick over it; 36–41 % on landscape / tablet); travel / gate banners were painted under the aside (`ok` 0 % tappable on all four viewports); the last directory links slid under the `z-40` joystick (three real taps hit the joystick); desktop-only WASD text was shown on touch; no `viewport-fit=cover` / safe-area handling; no `touch-action` / `overscroll-behavior` on the world surface. |
| Mobile shell correction (2B.4C.2) | One app-local interaction mode (`src/lib/interaction-mode.ts`: starter touch detection + Tailwind `sm` narrow class) shared by shell, joystick and jump button. Directory starts **closed** on touch / narrow viewports (open on desktop as before); the opener is a top-right, safe-area-aware button and the open directory carries its own close control; touch controls are not rendered while the directory is open (they return on close); travel / gate / notice status is mounted inside the open directory (sticky top) and in the overlay when closed; touch-aware instruction line; `export const viewport` with `viewportFit: "cover"` + `env(safe-area-inset-*)` offsets on joystick, jump, toggle and aside padding; `#canvas-container { touch-action: none }`, `html, body { overscroll-behavior: none }`; `touch-action: manipulation` on HUD buttons / links. State, travel, gate and engine input logic untouched. |
| Browser re-run (emulated, all four viewports + desktop) | Directory closed by default with the world visible; opener 100 % tappable and overlapping neither joystick nor jump; open directory: close control 100 % tappable, every one of the 7 destination links tappable (also at Music District, where they were previously under the joystick), joystick / jump not rendered, no horizontal overflow; gate and arrival banners and a non-fatal notice visible inside the open directory with `ok` 100 % tappable and dismissable by touch; joystick / jump / simultaneous / drag-look / joystick + look pass with the same figures as 2B.4C.1; portrait → landscape → portrait coherent with the panel open and closed, no stuck joystick, safe-area CSS present on every fixed control; desktop 1280×800: directory open by default, desktop instruction line, no touch controls, keyboard movement unchanged. |
| Gate boundary | Hub → Cannabis by touch → `gateRequired`, **0** cannabis chunk requests in every run (audit and re-run). |
| Initial warning budgets | `spatial:check` now prints non-fatal warnings when a runtime global-scene / chunk artifact exceeds **64 KiB** or **64 components** (`scripts/spatial/budgets.mjs`); the committed M0 set (7–10 KiB, 7–9 components) is within budget; stale / missing / unexpected artifacts fail exactly as before. Not budgeted: `static-scene.json`, the index, assets, draw calls, FPS, heap. |
| Adaptive quality | **Deferred** until the first representative art vertical slice (real GLB / material / texture / render costs). Evidence: 13–15 draw calls, ≈6.9 k triangles, 22–23 geometries, 10 textures, 15–16 live components, JS heap ≈44–52 MB flat across a travel loop; cold boot 3.77 MB is dominated by placeholder / upstream assets (the `studio` HDR envmap 1.61 MB = 43 %), spatial JSON 0.14 %. D-009 unchanged; no `DECISIONS.md` entry. |
| Performance regression smoke (after the HUD change) | Cross-chunk travel 24–37 ms, same-chunk ≈1–2 ms, chunk fetches served from disk cache with 0 wire bytes, no new network request from the HUD, heap 49.6 → 44.3 MB over six travels, no console error. |
| Checks | 269 app vitest tests (244 before 2B.4C; +12 budget, +13 mobile-shell), 56 manifest tests, `check` (strict pass), `spatial:check` (within initial budgets), `generate:check`, `next build` pass. |
| Capability repo | `TheCannaMan/awe` pushed `main` inspected read-only: joystick / jump byte-identical to upstream; shared touch hook, safe-area offsets and hidden keyboard hints are USE / ADAPT patterns (adapted, not copied); no adaptive-quality logic exists there; its world / plots system is pushed and classified INFORM (Operating Guide §6.4). |
| Not implemented | Real-device (iOS / Android) validation, real safe-area behaviour, adaptive quality, minimap / photo / share / multiplayer, age verification, hosting-level gate enforcement, world / plots integration, visual design. |
| Ghost boundary | No Ghost code read, copied, cherry-picked or depended on; engine / engine-edit / studio untouched. |
| Dependencies | None added; `package.json` dependency ranges and `pnpm-lock.yaml` unchanged. |
| Status | **Independently reviewed, integrated into `nrvna/integration` by fast-forward (`dc07ee0` + `135ec86`), and accepted as part of M0 completion** (this Landmark v0.2). The feature branch is retained as history. |

### NRVNAVerse implementation state — M1.0b / M1.1 checkpoint  [VERIFIED 2026-09-25 · feature branch `feat/m1-asset-contract`, GitHub CI green · not yet integrated into `nrvna/integration`]

The production asset pipeline and hosting-readiness layer that the M1 art slice needs. Tooling and contracts only: **no production art is placed, nothing is deployed, no storage bucket or DNS exists.** Detail: [`NRVNAVERSE_ASSET_PIPELINE.md`](./NRVNAVERSE_ASSET_PIPELINE.md), [`NRVNAVERSE_R2_STORAGE.md`](./NRVNAVERSE_R2_STORAGE.md), [`NRVNAVERSE_HOSTING.md`](./NRVNAVERSE_HOSTING.md), [`NRVNAVERSE_DELIVERY_ROADMAP.md`](./NRVNAVERSE_DELIVERY_ROADMAP.md) (PROPOSED).

| Item | State |
|---|---|
| Asset identity / revisions | Stable `ast_…` asset ids with numbered, immutable revisions (full SHA-256, bytes, format) in a committed registry; scene components name `assetRef`, never a URL; generation resolves the current revision's content-addressed URL |
| Rights / publication policy | Provenance, rights and attributed review are validated; only cleared, approved `usage: production` assets are publishable to a public store (fail closed) |
| AWE tooling adoption | H1 generic glTF optimizer and H2 validator / statistics adopted in `packages/tools` (generic, upstream-compatible) |
| Storage | Provider-neutral `external-cas` backend (write-once, content-addressed `art/<assetId>/<sha256>.<format>`), committed non-secret `publicOrigin`; Cloudflare R2 is the first adapter. The SigV4 transport is **PROVISIONAL** until a live-storage security review |
| Pipeline commands | `asset:prepare` (intake → optimized, validated, staged artifact) · `asset:publish` (write-once upload + full re-download SHA-256 verification) · `asset:register` (verified revision → registry) · `asset:place` (human-chosen placement into an ungated destination chunk) |
| Gated delivery invariant | Chunks serving any gated destination carry no `assetRef`; enforced by `asset:place` and by canonical `validateSpatialSource` (`asset-in-gated-chunk`, gate-metadata driven) |
| Measurement | `browser:perf` can measure an external production asset; no production art measured yet |
| Visitor shell / web handoff | Diagnostics (prototype label, phase readouts, raw errors, spatial panel) only in dev builds or with `?debug=1`; visitors get product copy and a friendly error / retry state. Generated `web-destinations.json` handoff view derived from the manifests |
| Hosting readiness | Fail-closed release build (`release:check`), `/api/health`, host configuration docs; `release:check` is offline — it re-validates source / config / registry invariants and recorded publication evidence, it does not re-fetch stored objects |
| CI | `.github/workflows/nrvnaverse-spatial.yml` (manifests, app typecheck + tests, `spatial:check`, production build) executed successfully on GitHub at `724f47a` |
| **Not done** | Live R2 bucket / credentials, `assets.nrvnaverse.com` DNS, `worlds.nrvnaverse.com` deployment / DNS, real Hub / Music production art, M1 visual work, real mobile release pass, first live |
| Landmark version | Unchanged (0.2): the 0.3 bump is reserved for the completed M1 vertical slice (§15) |

### Development machine (informational)

Windows 10 Home; Node v24.19.0; Git 2.46.2; Corepack 0.35.0; **pnpm 10.10.0 via Corepack** (shims in `%USERPROFILE%\.local\bin` because `C:\Program Files\nodejs` is not writable without elevation — see D-014). Local clone: `D:\NRVNAVerse\awe` on an **NTFS mechanical HDD**; pnpm content-addressable store at `D:\.pnpm-store`. Git HTTPS requires `http.sslbackend=schannel` on this machine (set repo-locally) because a local antivirus TLS proxy (Avast) breaks the OpenSSL backend. The same antivirus's real-time scanning plus the HDD make pnpm's link phase very slow (≈16 packages/min on first install; package downloads themselves complete in about a minute). An antivirus exclusion for `D:\NRVNAVerse` and `D:\.pnpm-store` would remove most of that cost but is a machine-level change for the machine owner to make, not a coding session.

## 13. Current Risks

**M0 blockers: none remaining** — the M0 Foundation Completion Gate (Section 12) passed on 2026-09-20. Everything below is **known post-M0 / production work**; M0 completion is an architecture proof, not production readiness.

| Risk / open work | Status |
|---|---|
| Real iOS / Android device validation | Open (post-M0) — all mobile evidence is EMULATED (headless Chrome, touch emulation, device metrics); physical safe areas, pull-to-refresh, double-tap zoom on HUD text, software keyboard, thermal / fps behaviour are unverified |
| Representative-art asset / render budgets | Open (post-M0) — only warning-only JSON byte / component budgets exist; GLB / texture / draw-call / FPS / heap budgets are defined with the first representative art vertical slice |
| Adaptive quality | Deferred by measurement (M0 Step 2B.4C) — re-decide with real art; D-009 (adaptive quality inside one product, no Lite product) unchanged |
| Production deployment / hosting | Open — hosting-readiness layer exists (M1.1: fail-closed release build, `/api/health`, CI green) but nothing is deployed, no host is chosen, `worlds.nrvnaverse.com` is not wired; cache policy is verified only on `next start` locally (Governance rule 8 for any production change) |
| Production asset storage | Open — `external-cas` / R2 adapter and `asset:publish` exist, but no bucket, credentials or `assets.nrvnaverse.com` DNS exist; the SigV4 transport is PROVISIONAL until a focused security / interoperability review or replacement by a maintained S3-compatible client, required before real credentials are used |
| Partner authoring / worlds-plots architecture | Open (post-M0) — `TheCannaMan/awe` holds a pushed generic world / plots system classified INFORM (Operating Guide §6.4); a dedicated architecture review is a separate planning task |
| Ghost experimental code requires review/testing | Open — commit message itself says "AI makes mistakes"; no tests for chunk/portal systems. Ghost's review is required before splitting/reworking, publishing refactors, or upstream contributions based on his work (D-013) |
| Chunk transition behavior | Mitigated (M0 Step 2B.2) for THE NRVNAVerse app: stage-before-retire with rollback and latest-request-wins cancellation; portal-triggered travel (2B.3) uses the same path. **Repeat visits no longer pay a network round trip (M0 Step 2B.4B): content-addressed chunk/global-scene files (`<name>.<digest>.json`) are served `immutable` and revisits are browser disk-cache hits with 0 wire bytes; a stale URL can never be answered with new bytes (query-only versioning was rejected in review).** A first visit to a chunk still shows a short load (≈20–40 ms locally; ≈165 ms under a 150 ms-latency profile) — prefetch was measured and deliberately rejected for M0. Ghost's experimental unload-then-load manager remains unreviewed and unused |
| Unmount while a chunk transition is staging | **Closed (M0 Step 2B.4A, `feat/m0-hardening-correctness`)** — `ChunkOrchestrator.dispose()` and `AweSpatialRuntime.dispose()` are now asynchronous; `disposeApp` awaits the settled orchestrator mutation queue (active chunk retired as the last mutation, stale batches self-cleaned) and the runtime's disposal (engine session settled) before the run is cleared, so the Space is never destroyed while `stageChunk` / `ComponentManager.create` is still resolving. Idempotent, best-effort (cleanup failures reported, never hang shutdown). Verified by 213 app tests and a real headless teardown / re-boot cycle. See [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) §14 |
| Mobile performance | Baseline recorded (M0 Step 2B.4C, emulated mobile): placeholder world renders trivially (13–15 draw calls, ≈6.9 k triangles), heap flat, touch viable, 4× CPU slowdown tolerated; **adaptive quality deferred until the first representative art vertical slice** (D-009 unchanged). **Real iOS / Android device validation and real safe-area behaviour still required** — emulation only |
| Asset budgets | Partially addressed (M0 Step 2B.4C.2): warning-only initial budgets for runtime JSON artifacts (64 KiB / 64 components per global scene or chunk) in `spatial:check`; **asset (GLB / texture), draw-call, FPS and heap budgets deferred to representative art**; cold boot is dominated by placeholder / upstream scene assets (`studio` HDR 1.6 MB) — a scene-data choice for the art step; KTX2 disabled |
| Upstream/fork divergence | Low — canonical `main` remains identical to `upstream/main` at `04a07c8`; `nrvna/integration` is intentionally ahead (18 commits) with NRVNAVerse app / package / docs work only, and `packages/engine`, `engine-edit`, `studio`, `tools`, `examples/*` are unchanged from upstream; Ghost's fork is 6 ahead / 0 behind. Divergence grows only with a future engine change |
| Multiplayer hosting | Not needed for first live — the `ws://localhost:2567` Colyseus URL is in `examples/multiplayer*` / `apps/ghostt` only; `apps/the-nrvnaverse` has no multiplayer (verified 2026-09-25, docs/NRVNAVERSE_HOSTING.md §4). A WebSocket-capable host is needed only when presence is adopted |
| Repo runtime lacks built-in auth/persistence | Open — must be provided at application layer |
| Slow dependency installs on the development machine | Known — HDD + antivirus real-time scanning make pnpm's link phase ≈25 min on first install (downloads ≈1 min). Mitigation is a machine-level AV exclusion by the owner; CI/other machines unaffected |
| Cannabis compliance | Open — policy layer not designed beyond principles; M0 Step 1 models the `age21` gate as placeholder data only (not enforced) |
| New workspace packages not yet in `pnpm-lock.yaml` | Closed — `importers` entries added in `44992f3`; `pnpm install --frozen-lockfile --offline` is up to date |
| Engine load in a background tab | Known (unchanged by 2B.4A) — no `requestAnimationFrame` in a hidden tab stalls the upstream intro and trips the engine's 60 s `LOAD_TIMEOUT`; the app shows its error phase and a foreground reload recovers. Upstream behaviour, deliberately not touched by the lifecycle hardening; a resume-on-visibility strategy is a later decision |
| Placement registry is hand-kept | Closed (M0 Step 2B.1) — placements and the scene are generated from one authoritative spatial source; `placements.m0.ts` removed; the spatial index is generated and keyed by stable id, never by coordinates |
| Gated chunk payloads are statically served | Open (known non-M0 limitation) — `public/data/spatial/chunks/cannabis-21.<digest>.json` is a static file; "never fetched before the gate" is an implemented and tested application-layer rule (Step 2B.2), not a hosting-layer one, until a server-side enforcement design exists. Unchanged by 2B.4B: the content-addressed cannabis URL is served `immutable` like every artifact, which is delivery policy and neither authorises nor prefetches it (browser-verified: 0 cannabis requests); a content-addressed name is not authorisation. M1.1: gated chunks may carry no runtime asset (`assetRef`), enforced at canonical validation, so gated art is never publicly published |
| Manifest `generate:check` fails on `core.autocrlf=true` checkouts | Closed (2026-09-19, `feat/m0-chunk-streaming`) — `manifests-fs.ts` now normalises line endings only when comparing on-disk files with fresh canonical LF output (write and check paths); canonical serialization unchanged; temp-directory tests cover LF, CRLF, real content and whitespace differences |
| awe.box and open-source AWE are different runtimes | Confirmed — hosted awe.box worlds are not portable to this repo's runtime |
| Ghost's PR #11 was closed unmerged upstream | Confirmed — future upstream contributions must be small, topical PRs |
| ~200 MB of binaries in Ghost's history | Mitigated by decision (D-013) — `ghost/experimental` is **not** pushed to `origin`; preserved by reference at `a5880dd…` via the `ghost` remote. Any archive / Git LFS / mirror strategy is a separate future decision |

### M0 implementation direction (D-016)  [COMPLETE FOR M0 — application-layer boundary; chunk orchestration VERIFIED in Step 2B.2, physical portals VERIFIED in Step 2B.3, lifecycle/shutdown hardening VERIFIED in Step 2B.4A, content-addressed immutable delivery VERIFIED in Step 2B.4B, mobile-aware prototype shell + warning guardrails VERIFIED in Step 2B.4C; all integrated into `nrvna/integration`]

For M0, chunk orchestration and destination travel are implemented in the NRVNAVerse application layer (`apps/the-nrvnaverse`) over official AWE runtime APIs, with stable destination IDs resolving to physical chunk/spawn data and visitor gates evaluated before gated fetches (D-016). Step 2B.2 delivered the one-active-chunk orchestrator on `ComponentManager.create/destroy`; Step 2B.3 delivered physical portal sensors (official mesh + `isSensor` collider + `Component3D.onSensorEnter`) that route a stable destination id into the same travel path; Step 2B.4A hardened the runtime lifecycle (asynchronous orchestrator/runtime shutdown, boot/dispose coordination with an explicit run state, boot-failure recovery, stale-portal-microtask protection) and closed the carried disposal risk; Step 2B.4B measured the loading path and delivered the performance step as HTTP policy only — content-addressed, `immutable` global-scene/chunk files behind a revalidated spatial-index version root (a first query-token version was corrected after independent review), with application cache and prefetch rejected for M0 on the measurements; Step 2B.4C audited the shell on emulated mobile, corrected the phone HUD (directory default / toggle / status layering / touch-control interception / safe area / world-surface gestures) and added warning-only JSON budgets, while deferring adaptive quality to the first representative art slice. The M0 direction is **complete**: every step above is integrated and verified (Section 12, Completion Gate). This remains an M0 implementation boundary — it is not a claim that generic or upstream chunk streaming is complete, and it is not an adoption of Ghost's experimental chunk/portal code, which remains EXPERIMENTAL per Section 13 and D-013. D-016 is unchanged; generic primitives may later move to `contrib/*` or upstream once validated, as a separate decision.

## 14. Do Not Accidentally Change  [LOCKED]

Implementation, refactors, or "helpful" cleanups must not alter any of the following without an explicit decision:

- Web + Spatial architecture (Section 2)
- AWE-first spatial strategy (Section 3)
- `worlds.nrvnaverse.com` as the spatial domain (Section 2)
- stable destination identity (Section 6)
- districts are navigation rather than taxonomy (Section 5)
- auth ≠ gates (Section 7)
- entertainment + education + commerce model (Section 4)
- strengthen AWE rather than compete with it (Section 3)
- mobile-first / adaptive principle (Section 8)

## 15. Landmark Versioning Rule

`NRVNAVERSE_LANDMARK.md` is a **living current benchmark**. Git history preserves each static historical version — do not keep old copies alongside it.

Increment the Landmark version only at meaningful milestones, for example:

| Version | Milestone |
|---|---|
| 0.1 | Pre-M0 (historical, 2026-09-19) |
| 0.2 | M0 complete (**this version**, 2026-09-20) |
| 0.3 | M1 vertical slice (in progress; M1.1 asset-pipeline / hosting-readiness checkpoint reached 2026-09-25 — bump when the slice is complete) |
| 0.4 | First real partner pilot |
| 0.5 | Web prototype |
| 1.0 | Initial public release |

Rules:

1. Implementation must **not silently redefine** the Landmark. If code and Landmark conflict, surface the conflict (in the PR, the session summary, or `DECISIONS.md`) before proceeding.
2. Every version bump records the milestone reached, refreshes Section 12 (Static Technical Baseline) with current SHAs and versions, and updates Section 13 (Current Risks).
3. Locked principles change only via an accepted entry in `DECISIONS.md` that supersedes the prior decision.
