# NRVNAVerse Hosting — THE NRVNAVerse at worlds.nrvnaverse.com

| Field | Value |
|---|---|
| **Status** | Hosting-readiness layer **IMPLEMENTED** (fail-closed release build, `/api/health`, CI workflow; M4: deployment profiles, indexing policy, security headers + CSP, release probe). **Not deployed; no host chosen; no DNS record.** Every account / DNS action is **HUMAN AUTHORIZATION REQUIRED** (Governance rule 8) |
| **App** | `apps/the-nrvnaverse` (Next.js 16, default server output — not a static export) |
| **Related** | [`NRVNAVERSE_HOSTING_DECISION.md`](./NRVNAVERSE_HOSTING_DECISION.md) (which host, cost — PROPOSED) · [`NRVNAVERSE_STAGING_AND_RELEASE.md`](./NRVNAVERSE_STAGING_AND_RELEASE.md) (workflow — PROPOSED) · [`NRVNAVERSE_R2_STORAGE.md`](./NRVNAVERSE_R2_STORAGE.md) (art origin) · D-014 (frozen lockfile) |

The guide is host-neutral: any Node host that runs `next start` (or a Next-aware platform) works. Nothing in the repository locks a host.

---

## 1. Build and start

```
corepack enable
pnpm install --frozen-lockfile
pnpm --filter the-nrvnaverse verify     # check + tests + manifest tests + build (one command, no browser)
pnpm --filter the-nrvnaverse build      # = release:check && next build --turbopack
pnpm --filter the-nrvnaverse start      # next start (PORT, default 3000)
```

`build` **fails closed** before compiling if generated data is stale: `release:check` runs `spatial:check` (generated spatial index / chunks match the source, runtime assets verified) and the manifest `generate:check` (destinations / directory / web export match the manifests). A deployment can therefore never serve spatial data or destinations that disagree with the committed sources. It also fails on an unknown `NRVNA_DEPLOYMENT` / malformed `NRVNA_WEB_PAGES` (§2).

Node ≥ 20.9 (`engines`); CI uses Node 22.

---

## 2. Environment contract

Destinations, spatial data and the art origin are **committed, generated, content-addressed data**, not runtime settings. M4 added exactly three **build-time** switches; all are validated, none is a secret, none carries a URL.

| Variable | Class | Values | Effect |
|---|---|---|---|
| `NRVNA_DEPLOYMENT` | build time | `production` (default when unset) · `staging` · `local` — anything else **fails the build** | selects a row of the reviewed profile table `src/lib/deployment/deployment-profile.ts`: the world's own origin (canonical / `metadataBase`, web-context spatial links) and the website origin every world → web link goes to |
| `NRVNA_ALLOW_INDEXING` | build time | `true` or unset | the build is indexable **only** if this is `true` **and** the profile is `production`; every other build is `noindex` (§6.2) |
| `NRVNA_WEB_PAGES` | build time | `1` (default) · `0` — anything else **fails the build** | `0` = the website does not serve `/worlds/<slug>` yet: every world → web link goes to the website root (the live Wix `www` returns 404 for those paths — checked 2026-10-19). Use `0` for a production world launched before the WEB app cut-over; back to `1` in the release that ships the WEB app |
| `NODE_ENV=production` | required | set by `next build` / `next start` | production build: console stripped, diagnostics gate off by default, production CSP (no eval) |
| `PORT` | optional | server | `next start` port (host usually sets it) |
| `NRVNA_RELEASE_ID` | optional, server | `[A-Za-z0-9._-]`, ≤ 64 | release id echoed by `/api/health`; when unset, the host's commit SHA (`VERCEL_GIT_COMMIT_SHA`, `CF_PAGES_COMMIT_SHA`) is used |
| `NEXT_TELEMETRY_DISABLED=1` | optional | build | opt out of Next telemetry |
| `?debug=1` (URL, not env) | development-only | visitor browser | diagnostics overlay (`src/lib/debug-mode.ts`); exposes no secret |
| `BASE_URL`, `PORT`, `CDP_PORT`, `CHROME_PATH`, `EXPECT_*`, `CHECK_WEB_LINKS`, `RUNS`, `OUT_DIR` | development-only | developer machine | browser probes |
| `NRVNA_ASSET_R2_*`, `NRVNA_ASSET_PUBLIC_ORIGIN` | **never on the app host** | publishing machine only | `asset:publish` credentials / origin check; the app never reads them |

**Deployment profiles (the origin allowlist)** — changing an origin is a reviewed code change, never an environment value:

| Profile | World origin | Website origin | Indexable |
|---|---|---|---|
| `production` | `https://worlds.nrvnaverse.com` | `https://www.nrvnaverse.com` | only with `NRVNA_ALLOW_INDEXING=true` |
| `staging` | `https://worlds-staging.nrvnaverse.com` (PROPOSED) | `https://staging.nrvnaverse.com` (PROPOSED) | never |
| `local` | `http://localhost:3100` | `http://localhost:3000` | never |

`next.config.ts` inlines into the bundle only `NRVNA_DEPLOYMENT` (the profile name), `NRVNA_INDEXING` (0/1) and `NRVNA_WEB_PAGES` (0/1); the bundle maps the name back through the same table (unknown → production). No `NEXT_PUBLIC_*` variable exists (pinned by `test/hosting-readiness.test.ts`). The art origin stays committed data: `spatial-config.m0.json` → `assetStorage["external-cas"].publicOrigin = https://assets.nrvnaverse.com`.

---

## 3. Health check

`GET /api/health` → `200`, `Cache-Control: no-store`, dynamic (never an edge copy):

```json
{
  "status": "ok",
  "app": "the-nrvnaverse",
  "environment": "production",
  "deployment": "production",
  "indexing": false,
  "webPages": true,
  "release": "c2db328",
  "manifestSchemaVersion": 1,
  "spatial": { "worldId": "the-nrvnaverse", "indexSchemaVersion": 1, "globalSceneVersion": "<32 hex>", "chunks": 12 }
}
```

`deployment`, `indexing` and `webPages` are what the **build** was made for (inlined constants), not the runtime environment (M4 fix: a `local` build served by a plain `next start` once reported `production`). Only already-public facts; no secrets, paths or tokens. Use it as the host's health probe and to confirm *which* build is live.

---

## 4. Multiplayer — not part of first live

Resolved 2026-09-25: `ws://localhost:2567` / Colyseus exist **only** in `examples/multiplayer*` (and `apps/ghostt` on `ghost/experimental`). `apps/the-nrvnaverse` has no Colyseus dependency, no WebSocket client and no multiplayer endpoint (pinned by `test/hosting-readiness.test.ts`). **First live needs no multiplayer server and no WebSocket-capable host.**

---

## 5. Custom domains — HUMAN AUTHORIZATION REQUIRED

The zone `nrvnaverse.com` is on Wix DNS (`ns14/ns15.wixdns.net`); Wix supports CNAME / TXT records for subdomains, so no DNS move is needed. Steps (owner): create the host project ([`NRVNAVERSE_STAGING_AND_RELEASE.md`](./NRVNAVERSE_STAGING_AND_RELEASE.md) §3) → deploy a protected preview and smoke it (§7) → add `worlds.nrvnaverse.com` (production) and `worlds-staging.nrvnaverse.com` (staging branch) on the host → create the CNAME (and any TXT) records it shows in Wix → HTTPS only. The art origin `assets.nrvnaverse.com` is a separate decision: an R2 custom domain needs the zone on Cloudflare ([`NRVNAVERSE_HOSTING_DECISION.md`](./NRVNAVERSE_HOSTING_DECISION.md) §6).

---

## 6. Response policy

### 6.1 Caching and the immutable relationship

| Path | Served by | Cache-Control |
|---|---|---|
| `/data/spatial/spatial-index.json` | app | `public, max-age=0, must-revalidate` — the version root |
| `/data/spatial/global-scene.<v>.json`, `/data/spatial/chunks/<key>.<v>.json`, `/data/spatial/layers/<key>.<v>.json` (M4) | app | `public, max-age=31536000, immutable` |
| `/assets/art/<assetId>.<v>.glb` | app (repo-public art) | `public, max-age=31536000, immutable` |
| `https://assets.nrvnaverse.com/art/<assetId>/<sha256>.glb` | R2 custom domain | object header `immutable` (+ Cloudflare cache rule) |
| `/api/health` | app | `no-store` |
| HTML (`/`, `/web-context/*`) | app | Next's default for prerendered pages, `s-maxage=31536000` — correct on Vercel (its CDN is purged per deploy); **re-check on any other CDN** |

Order of truth for a release that changes art: **publish art (verified) → register revision → generate + commit chunks → deploy app**. Art objects are never overwritten, so no purge is ever needed.

### 6.2 Indexing

| Build | `X-Robots-Tag` | `robots.txt` | page meta |
|---|---|---|---|
| any non-indexable build (staging, local, production without `NRVNA_ALLOW_INDEXING=true`) | `noindex, nofollow` on **every** response | `User-Agent: *` / `Disallow: /` | `noindex, nofollow` |
| indexable production | `noindex, nofollow` on `/web-context/*`, `/api/*`, `/data/*`, `/assets/*` | `Allow: /`, `Disallow:` those four prefixes | entry page `index, follow`; web-context panels always `noindex, nofollow` |

Every page names the build's world origin as `metadataBase` and the entry page as canonical (a deep-link query is a view of the same page); a web-context panel's canonical is its website page. **Gated destinations have no web-context panel at all** (`/web-context/<gated id>` is a 404; no overview of gated content is published by the world). Search visibility is a product choice, not access control (D-021).

### 6.3 Security headers (every response)

`Content-Security-Policy` (`src/lib/deployment/http-policy.ts`): `default-src 'self'`; scripts `'self' 'unsafe-inline' 'wasm-unsafe-eval'` (prerendered App Router payload, Rapier / Draco WASM; development adds `'unsafe-eval'` + HMR websockets); images / media from self, `data:`, `blob:` and the named asset origins; `connect-src` adds the engine's GPU-benchmark origin (`unpkg.com`); workers `self blob:`; frames `self`; `frame-ancestors 'self'`; `object-src 'none'`; `base-uri` / `form-action` `'self'`. Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, a restrictive `Permissions-Policy` (gamepad / fullscreen / motion stay available), `Strict-Transport-Security: max-age=31536000`; `X-Powered-By` removed. Verified in real loads: **zero CSP violations** desktop and phone (`browser:release`). A test fails if generated spatial data names an origin the CSP does not admit.

**Third-party runtime origins** (none controlled by NRVNAVerse): `cdn.oncyber.xyz` (avatar VRM, terrain textures, engine decoders), `cyber.mypinata.cloud` (animation set), `unpkg.com` (engine GPU-tier tables, found by the M4 CSP). An outage there degrades or breaks the world — launch risk, M4 campaign record.

---

## 7. Release smoke (preview, then production)

1. `curl -s <base>/api/health` → `status: ok`, expected `deployment`, `indexing`, `webPages`, `release` (= the commit), `globalSceneVersion`.
2. `BASE_URL=<base> EXPECT_DEPLOYMENT=<production|staging> EXPECT_INDEXING=<0|1> EXPECT_WEB_PAGES=<1|0> pnpm --filter the-nrvnaverse browser:release` — headers / CSP / robots on every surface, gated web-context 404, cache policy, zero CSP violations and only allow-listed origins in a real load, travel, the 21+ gate (zero gated requests), the return contract, fault-injected Hub arrivals, phone profile. Add `CHECK_WEB_LINKS=1` against production before a launch: every world → web link the world shows must answer < 400 on the live website.
3. `BASE_URL=<base> pnpm --filter the-nrvnaverse browser:perf` (desktop + mobile emulation).
4. Real-device pass (iOS Safari, Android Chrome) before public announcement.

A host's login protection (staging, previews) blocks the headless probes; smoke those by hand while logged in (§STAGING_AND_RELEASE 4).

---

## 8. Rollback

- **App**: redeploy / promote the previous build (every host keeps prior deployments). Old and new builds reference disjoint content-addressed chunk files, and the index revalidates, so switching back is instant and consistent.
- **Art**: never delete; roll the registry `currentRevision` back, regenerate, redeploy.
- **Data**: generated artifacts are committed; `git revert` + rebuild reproduces any earlier state byte-for-byte.
- A client holding an old index may 404 on a retired chunk after a deploy (accepted since M0).

---

## 9. CI

`.github/workflows/nrvnaverse-spatial.yml` (push to `nrvna/**`, `feat/**`, `fix/**`, `contrib/**`; PRs to `nrvna/integration` / `main`; manual): frozen install, manifest check / test / `generate:check`, app check / test / `spatial:check`, production build. No secrets, no deployment. Browser and device probes stay a manual release gate (§7). The repository is public, so GitHub-hosted runners cost nothing.

---

## 10. Open before production credentials / public launch

- Host choice, accounts, `worlds.` / `worlds-staging.` DNS (owner) — [`NRVNAVERSE_STAGING_AND_RELEASE.md`](./NRVNAVERSE_STAGING_AND_RELEASE.md) §3.
- **S3 SigV4 transport: PROVISIONAL UNTIL LIVE-STORAGE SECURITY REVIEW** — before production R2 credentials are used.
- R2 bucket + `assets.nrvnaverse.com` (needs the zone on Cloudflare, or an alternative) — only with the first production art.
- Third-party runtime origins (§6.3): accept for launch or self-host (rights check first).
- Real-device validation (iOS / Android).
