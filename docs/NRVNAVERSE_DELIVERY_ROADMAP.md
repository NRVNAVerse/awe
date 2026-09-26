# NRVNAVerse Delivery Roadmap — first live SPATIAL + WEB

| Field | Value |
|---|---|
| **Status** | **PROPOSED** (2026-09-25). A delivery sequence for human review, not a decision. Nothing here authorises deployment, DNS, Wix or commerce changes (Governance rule 8) |
| **Baseline** | `feat/m1-asset-contract` @ M1.1: runtime asset contract, public-publication policy, provider-neutral storage contract, `asset:prepare` intake (docs/NRVNAVERSE_ASSET_PIPELINE.md) |
| **Related** | D-001 / D-003 (two surfaces, handoff contract) · D-004 (stable ids) · D-006 (gates) · D-007 (commerce is a capability) · D-009 (mobile-first) |

Vocabulary: **VERIFIED** = seen in code / tests · **DOCS** = stated in repo docs only · **PLANNED** = this roadmap.

---

## 1. Where we are (VERIFIED unless marked)

- **Spatial app** (`apps/the-nrvnaverse`): one Next.js page, client-only shell; 4 chunks (hub, music, fashion-culture, cannabis-21); 7 active destinations in `packages/nrvna-manifest/manifests/` including `placeholder-artist` (`kind: "artist"`, Music); 7 portals incl. Music → Artist. All geometry is placeholder (boxes / meshes / text) — **no runtime art**.
- **Deep links**: `?destination=<id>[&from][&ref][&return=<id|web>]` (`packages/nrvna-manifest/src/deep-link.ts`); `return=web` resolves to the manifest `webUrl` (`https://www.nrvnaverse.com/worlds/<slug>`); travel writes the URL with `pushState`.
- **Mobile**: touch joystick + jump, `browser:touch` / `browser:perf` probes; one real-phone input sign-off (DOCS), no broad real-device validation.
- **Launch hygiene gaps**: HUD shows debug `phase:` readouts and the label "M0 Foundation — architecture prototype complete" (`src/lib/app-identity.ts:15`, `src/components/app-shell.tsx:74,99`); no analytics / error reporting; no CI; no hosting config; nothing deployed. Colyseus hard-coded to `ws://localhost:2567` and the background-tab `LOAD_TIMEOUT` risk are **DOCS** (Landmark §13).
- **Assets**: production art must use `external-cas`; its adapter and public URL base are **pending**, so no production art can be referenced yet (`asset-storage-unresolved`).
- **Web**: no website code in this repository. `www.nrvnaverse.com` is the production Wix site (Governance rule 8). Whether `/worlds/<slug>` pages exist there is **unverified**.

---

## 2. SPATIAL — shortest path to worlds.nrvnaverse.com

| # | Milestone | Genuinely blocking? | Work | Human decision / action |
|---|---|---|---|---|
| S1 | **External storage live** | **YES** for any real art | Implement the `external-cas` adapter (put / verify) + fix the one public base; `runtimeUrl` = `<base>/<objectKey>`; immutable caching + CORS on the store; release check re-verifies referenced objects | Choose provider + base (same-origin path via host is simplest) |
| S2 | **Central Hub representative art** | YES (the slice's point) | 1–3 hero assets through `asset:prepare` → review → upload → registry → `assetRef`; `browser:perf` with `ASSET_COMPONENT` | Art, rights clearance, attributed approval per asset |
| S3 | **Music District representative art** | YES | same pipeline | same |
| S4 | **Placeholder Artist destination** | light | exists (manifest + portal); give it a readable "artist coming soon" stage (info card + marker), no real artist content | copy |
| S5 | **Launch shell + portal/travel polish** | YES (minimal) | hide debug HUD behind a dev flag; public identity copy; friendly error / retry state; loading transition; verify travel + back/forward + deep links | copy / tone |
| S6 | **Mobile baseline** | YES (D-009) | real iOS Safari + Android Chrome pass with S2/S3 art; record measured numbers → first real budgets | device run |
| S7 | **Hosting + domain** | YES | host config for Next server build (not static export); cache headers verified **on the host**; multiplayer off or pointed at a real server; minimal CI (`test`, `check`, `spatial:check`, build) | **authorisation**: host account, `worlds.nrvnaverse.com` DNS |
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

1. **Now (code, no decision needed)**: S5 launch-shell hygiene · manifest → web export · CI workflow file (local only until authorised).
2. **Human decisions**: storage provider + public base (S1) · host for `worlds.` (S7) · first Hub / Music art candidates and their rights (S2 / S3).
3. S1 adapter → S2 / S3 art through `asset:prepare` → S6 devices → S7 preview deploy (authorised) → S8 smoke.
4. W1 on Wix (human edits, CMS import from the export) in parallel with S6–S8.
5. S9 + W1 go live together: the web "Enter" CTA points at the live world.
