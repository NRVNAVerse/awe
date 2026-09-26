# NRVNAVerse Delivery Roadmap — first live SPATIAL + WEB

| Field | Value |
|---|---|
| **Status** | **PROPOSED** (2026-09-25). A delivery sequence for human review, not a decision. Nothing here authorises deployment, DNS, Wix or commerce changes (Governance rule 8) |
| **Baseline** | `feat/m1-asset-contract` @ M1.1 checkpoint (2026-09-25): runtime asset contract, public-publication policy, provider-neutral `external-cas` + R2 adapter, `asset:prepare` / `publish` / `register` / `place`, visitor launch shell, web handoff export, hosting readiness, GitHub CI (docs/NRVNAVERSE_ASSET_PIPELINE.md, docs/NRVNAVERSE_HOSTING.md) |
| **Related** | D-001 / D-003 (two surfaces, handoff contract) · D-004 (stable ids) · D-006 (gates) · D-007 (commerce is a capability) · D-009 (mobile-first) |

Vocabulary: **VERIFIED** = seen in code / tests · **DOCS** = stated in repo docs only · **PLANNED** = this roadmap.

---

## 1. Where we are (VERIFIED unless marked)

- **Spatial app** (`apps/the-nrvnaverse`): one Next.js page, client-only shell; 4 chunks (hub, music, fashion-culture, cannabis-21); 7 active destinations in `packages/nrvna-manifest/manifests/` including `placeholder-artist` (`kind: "artist"`, Music); 7 portals incl. Music → Artist. All geometry is placeholder (boxes / meshes / text) — **no runtime art**.
- **Deep links**: `?destination=<id>[&from][&ref][&return=<id|web>]` (`packages/nrvna-manifest/src/deep-link.ts`); `return=web` resolves to the manifest `webUrl` (`https://www.nrvnaverse.com/worlds/<slug>`); travel writes the URL with `pushState`.
- **Mobile**: touch joystick + jump, `browser:touch` / `browser:perf` probes; one real-phone input sign-off (DOCS), no broad real-device validation.
- **Launch shell**: DONE — diagnostics (prototype label, `phase:` readouts, raw errors, spatial panel) render only in dev builds or with `?debug=1`; visitors get product copy and a friendly error / retry state. Still missing: analytics / error reporting.
- **Hosting readiness / CI**: DONE — fail-closed release build (`release:check`), `GET /api/health`, host configuration docs (docs/NRVNAVERSE_HOSTING.md); `.github/workflows/nrvnaverse-spatial.yml` has executed successfully on GitHub. **Nothing is deployed; no host is chosen; no `worlds.nrvnaverse.com` DNS.** The background-tab `LOAD_TIMEOUT` risk is **DOCS** (Landmark §13). **Resolved:** the `ws://localhost:2567` Colyseus URL exists only in `examples/multiplayer*` / `apps/ghostt`; the spatial app has no multiplayer (docs/NRVNAVERSE_HOSTING.md §4).
- **Assets**: `external-cas` is implemented (Cloudflare R2 first adapter; committed `publicOrigin` `https://assets.nrvnaverse.com`) with `asset:prepare` → `asset:publish` (write-once + full re-download SHA-256 verification) → `asset:register` → `asset:place` (ungated destinations only; gated chunks carrying `assetRef` fail canonical validation). **Pending**: the real R2 bucket / account, production credentials, `assets.nrvnaverse.com` DNS / custom domain, and the SigV4 security / interoperability gate (the transport is PROVISIONAL). No production art is registered or placed.
- **Release checks are offline**: `release:check` / `spatial:check` re-validate canonical source / config / registry invariants and the recorded publication evidence; they do **not** fetch or re-hash `external-cas` objects.
- **Web**: no website code in this repository. `www.nrvnaverse.com` is the production Wix site (Governance rule 8). Whether `/worlds/<slug>` pages exist there is **unverified**.

---

## 2. SPATIAL — shortest path to worlds.nrvnaverse.com

| # | Milestone | Genuinely blocking? | Work | Human decision / action |
|---|---|---|---|---|
| S1 | **External storage live** | **YES** for any real art | DONE in code: `external-cas` adapter (R2), `publicOrigin` contract, `runtimeUrl` = `<publicOrigin>/<objectKey>`, `asset:publish` verification. REMAINING: create the bucket, immutable caching + CORS on the store, `assets.nrvnaverse.com` custom domain, pass (or replace) the SigV4 security / interoperability gate before real credentials | **authorisation**: storage account / bucket, credentials, DNS |
| S2 | **Central Hub representative art** | YES (the slice's point) | 1–3 hero assets through `asset:prepare` → review → upload → registry → `assetRef`; `browser:perf` with `ASSET_COMPONENT` | Art, rights clearance, attributed approval per asset |
| S3 | **Music District representative art** | YES | same pipeline | same |
| S4 | **Placeholder Artist destination** | light | exists (manifest + portal); give it a readable "artist coming soon" stage (info card + marker), no real artist content | copy |
| S5 | **Launch shell + portal/travel polish** | YES (minimal) | DONE: debug HUD behind dev / `?debug=1`, visitor copy, friendly error / retry, loading indicator. REMAINING: verify travel + back/forward + deep links on the host | copy / tone |
| S6 | **Mobile baseline** | YES (D-009) | real iOS Safari + Android Chrome pass with S2/S3 art; record measured numbers → first real budgets | device run |
| S7 | **Hosting + domain** | YES | DONE: host-readiness config / docs, `/api/health`, CI (`test`, `check`, `spatial:check`, build) green on GitHub; the app has no multiplayer. REMAINING: choose and configure the spatial production host; cache headers verified **on the host**; `worlds.nrvnaverse.com` DNS | **authorisation**: host account, `worlds.nrvnaverse.com` DNS |
| S8 | **Live smoke** | YES | `browser:touch` / `browser:perf` with `BASE_URL=<preview>`; deep-link matrix; 404 / retired-chunk behaviour; cannabis gate refusal | review |
| S9 | **Public release** | — | preview → production promotion; announce via web (W1) | **authorisation** |

Critical path: **S1 → S2 / S3 (parallel art) → S6 → S7 → S8 → S9**; S4 / S5 run alongside S1.

### Can ship AFTER first live (not prerequisites)

Draco / meshopt / KTX2 compression (decoder location open) · adaptive quality, LOD, baked-unlit path · multiplayer / Colyseus · accounts, persistence, cross-origin gate token · Fashion & Culture and Cannabis 21 art (they stay placeholder; Cannabis stays gate-refused) · real artist content · full Khronos validation · curated asset library, Blender automation · analytics beyond a privacy-safe minimum · more districts / destinations.

---

## 3. WEB — first live milestone for www.nrvnaverse.com (W1)

**Principle**: the web complements the world — discovery, context, commerce, accounts, SEO — and never re-implements it (Operating Guide: "Do not put the entire public website inside AWE").

| Surface | W1 content | Where it lives in W1 |
|---|---|---|
| Home | what NRVNAVerse is + **Enter THE NRVNAVerse** → `worlds.nrvnaverse.com/?destination=<hub id>&from=web` | Wix (existing site) |
| Explore | `/worlds/<slug>` page per active, non-gated destination (Hub, Music, Artist placeholder; Fashion & Culture as "coming"), each with an **Enter** deep link; Cannabis 21 info-only, no deep link past the gate | Wix CMS collection fed from the manifests |
| Build / Studio / Services | what NRVNAVerse builds for partners, contact form | Wix |
| Shop | existing Wix Stores, unchanged | Wix (preserved) |
| About | context, team, compliance statements | Wix |
| Members | existing Wix members, unchanged | Wix (preserved) |

- **Stays on Wix initially**: commerce, members, forms, CMS, hosting of www. **No custom frontend for W1.**
- **Custom frontend (W2, later)**: the Wix-headless pattern (custom frontend + Wix-hosted flows) once W1 proves the funnel.
- **Needs implementation in this repo (small)**: a manifest → web export (slug, title, summary, deep link, `webUrl`) for Wix CMS import, generated from `packages/nrvna-manifest` so both surfaces share one source of truth (Governance rule 9: automate content assembly, human review of what publishes).

---

## 4. WEB ↔ SPATIAL connection

- **One source of truth**: destination manifests (stable `dst_` ids, D-004) → spatial generation **and** the web export.
- **Web → world**: `https://worlds.nrvnaverse.com/?destination=<id>&from=web[&ref=<campaign>]`.
- **World → web**: `return=web` → the destination's `webUrl` (a token, never an arbitrary URL); commerce is a redirect capability (`commerceRefs` → Wix product / collection URLs, D-007) — no checkout in the world.
- **Later**: cross-origin gate / member continuity needs a token design (DOCS: DECISIONS D-003); shared `analyticsId` = destination id.

---

## 5. Combined sequence

1. **Done in code (M1.1)**: S5 launch-shell hygiene · manifest → web export · CI workflow (executed on GitHub) · S1 storage adapter + asset pipeline · host readiness.
2. **Human decisions / actions**: R2 account, bucket, credentials and `assets.nrvnaverse.com` DNS (S1) · SigV4 security review or maintained client (S1) · host for `worlds.` + DNS (S7) · first Hub / Music art candidates and their rights (S2 / S3) · real mobile release pass (S6).
3. S1 storage live → S2 / S3 art through `asset:prepare` → `publish` → `register` → `place` → S6 devices → S7 preview deploy (authorised) → S8 smoke.
4. W1 on Wix (human edits, CMS import from the export) in parallel with S6–S8.
5. S9 + W1 go live together: the web "Enter" CTA points at the live world.
