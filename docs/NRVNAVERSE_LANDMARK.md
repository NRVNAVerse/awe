# NRVNAVerse Landmark

| Field | Value |
|---|---|
| **Version** | 0.1 |
| **Status** | Pre-M0 |
| **Current milestone** | M0 — Foundation |
| **Landmark date** | 2026-09-19 |
| **Canonical repository** | https://github.com/NRVNAVerse/awe (fork of https://github.com/oncyberio/awe) |
| **Companion documents** | [DECISIONS.md](./DECISIONS.md) · [NRVNAVERSE_GOVERNANCE.md](./NRVNAVERSE_GOVERNANCE.md) (developer/agent governance) · [CLAUDE.md](../CLAUDE.md) (entry point) |

This file is the canonical high-level benchmark for the NRVNAVerse project. It states what is **locked**, what is **verified**, what is **experimental**, and what is only **planned or aspirational**. Read it before substantial NRVNAVerse work.

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

## 10. First Vertical Slice  [LOCKED scope · PLANNED implementation]

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

## 12. Static Technical Baseline — Landmark v0.1 (Pre-M0)  [VERIFIED 2026-09-19]

### Repositories and Git relationship

| Ref | SHA | Date | Notes |
|---|---|---|---|
| `upstream/main` (oncyberio/awe) | `04a07c8d75c114d8ea217d0870eeef2c6a65635a` | 2026-03-25 | "fix component factory data config isolation" |
| `origin/main` (NRVNAVerse/awe) | `04a07c8d75c114d8ea217d0870eeef2c6a65635a` | 2026-03-25 | **identical to upstream** (0 ahead / 0 behind) |
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

### Development machine (informational)

Windows 10 Home; Node v24.19.0; Git 2.46.2; Corepack 0.35.0; **pnpm 10.10.0 via Corepack** (shims in `%USERPROFILE%\.local\bin` because `C:\Program Files\nodejs` is not writable without elevation — see D-014). Local clone: `D:\NRVNAVerse\awe` on an **NTFS mechanical HDD**; pnpm content-addressable store at `D:\.pnpm-store`. Git HTTPS requires `http.sslbackend=schannel` on this machine (set repo-locally) because a local antivirus TLS proxy (Avast) breaks the OpenSSL backend. The same antivirus's real-time scanning plus the HDD make pnpm's link phase very slow (≈16 packages/min on first install; package downloads themselves complete in about a minute). An antivirus exclusion for `D:\NRVNAVerse` and `D:\.pnpm-store` would remove most of that cost but is a machine-level change for the machine owner to make, not a coding session.

## 13. Current Risks

| Risk | Status |
|---|---|
| Ghost experimental code requires review/testing | Open — commit message itself says "AI makes mistakes"; no tests for chunk/portal systems. Ghost's review is required before splitting/reworking, publishing refactors, or upstream contributions based on his work (D-013) |
| Chunk transition behavior | Open — unload-then-load, no prefetch/overlap/cancellation; visible pop expected |
| Mobile performance | Open — no adaptive quality tier in engine yet; budgets undefined |
| Asset budgets | Open — no validator thresholds; KTX2 disabled |
| Upstream/fork divergence | Low now (Ghost 6 ahead / 0 behind; NRVNAVerse identical) — grows with every engine change |
| Multiplayer hosting | Open — Colyseus URL hardcoded to `ws://localhost:2567`; needs a WebSocket-capable host |
| Repo runtime lacks built-in auth/persistence | Open — must be provided at application layer |
| Slow dependency installs on the development machine | Known — HDD + antivirus real-time scanning make pnpm's link phase ≈25 min on first install (downloads ≈1 min). Mitigation is a machine-level AV exclusion by the owner; CI/other machines unaffected |
| Cannabis compliance | Open — policy layer not designed beyond principles |
| awe.box and open-source AWE are different runtimes | Confirmed — hosted awe.box worlds are not portable to this repo's runtime |
| Ghost's PR #11 was closed unmerged upstream | Confirmed — future upstream contributions must be small, topical PRs |
| ~200 MB of binaries in Ghost's history | Mitigated by decision (D-013) — `ghost/experimental` is **not** pushed to `origin`; preserved by reference at `a5880dd…` via the `ghost` remote. Any archive / Git LFS / mirror strategy is a separate future decision |

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
| 0.1 | Pre-M0 (this version) |
| 0.2 | M0 complete |
| 0.3 | M1 vertical slice |
| 0.4 | First real partner pilot |
| 0.5 | Web prototype |
| 1.0 | Initial public release |

Rules:

1. Implementation must **not silently redefine** the Landmark. If code and Landmark conflict, surface the conflict (in the PR, the session summary, or `DECISIONS.md`) before proceeding.
2. Every version bump records the milestone reached, refreshes Section 12 (Static Technical Baseline) with current SHAs and versions, and updates Section 13 (Current Risks).
3. Locked principles change only via an accepted entry in `DECISIONS.md` that supersedes the prior decision.
