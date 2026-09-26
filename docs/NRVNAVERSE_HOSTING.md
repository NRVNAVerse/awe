# NRVNAVerse Hosting — THE NRVNAVerse at worlds.nrvnaverse.com

| Field | Value |
|---|---|
| **Status** | Hosting-readiness layer **IMPLEMENTED** (fail-closed release build, `/api/health`, CI workflow). **Not deployed; no host chosen; no DNS record.** Every account / DNS action is **HUMAN AUTHORIZATION REQUIRED** (Governance rule 8) |
| **App** | `apps/the-nrvnaverse` (Next.js 16, default server output — not a static export) |
| **Related** | [`NRVNAVERSE_R2_STORAGE.md`](./NRVNAVERSE_R2_STORAGE.md) (art origin) · [`NRVNAVERSE_DELIVERY_ROADMAP.md`](./NRVNAVERSE_DELIVERY_ROADMAP.md) (S7–S9) · D-014 (frozen lockfile) |

The guide is host-neutral: any Node host that runs `next start` (or a Next-aware platform) works. Nothing in the repository locks a host.

---

## 1. Build and start

```
corepack enable
pnpm install --frozen-lockfile
pnpm --filter the-nrvnaverse build      # = release:check && next build --turbopack
pnpm --filter the-nrvnaverse start      # next start (PORT, default 3000)
```

`build` **fails closed** before compiling if generated data is stale: `release:check` runs `spatial:check` (generated spatial index / chunks match the source, runtime assets verified) and the manifest `generate:check` (destinations / directory / web export match the manifests). A deployment can therefore never serve spatial data or destinations that disagree with the committed sources.

Node ≥ 20.9 (`engines`); CI uses Node 22.

---

## 2. Production environment contract

The spatial app is deliberately almost configuration-free: destinations, spatial data and the art origin are **committed, generated, content-addressed data**, not runtime settings.

| Variable | Class | Where | Purpose |
|---|---|---|---|
| `NODE_ENV=production` | **REQUIRED** | set by `next build` / `next start` | production build: console stripped, diagnostics gate off by default |
| `PORT` | OPTIONAL | server | `next start` port (host usually sets it) |
| `NRVNA_RELEASE_ID` | OPTIONAL | server only | release identifier echoed by `/api/health` (Git SHA, tag or host deployment id; plain `[A-Za-z0-9._-]`, ≤ 64 chars, otherwise ignored) |
| `NEXT_TELEMETRY_DISABLED=1` | OPTIONAL | build | opt out of Next telemetry |
| `?debug=1` (URL, not env) | DEVELOPMENT-ONLY | visitor browser | diagnostics overlay (`src/lib/debug-mode.ts`); exposes no secret |
| `BASE_URL`, `PORT`, `CDP_PORT`, `CHROME_PATH`, `ASSET_COMPONENT` | DEVELOPMENT-ONLY | developer machine | `browser:perf` / `browser:touch` probes |
| `NRVNA_ASSET_R2_*`, `NRVNA_ASSET_PUBLIC_ORIGIN` | **NEVER on the app host** | publishing machine only | `asset:publish` credentials / origin check. The app never reads them; **do not configure them on the web host** |
| multiplayer endpoint | FUTURE | — | not used by the first-live slice (§4) |
| analytics / error reporting keys | FUTURE | — | none exist today |

- No `NEXT_PUBLIC_*` variable exists; the client bundle reads only `NODE_ENV` (pinned by `test/hosting-readiness.test.ts`).
- **Art origin** is not an env var: `spatial-config.m0.json` → `assetStorage["external-cas"].publicOrigin = https://assets.nrvnaverse.com`, validated and baked into the generated chunks, so every environment resolves the same URLs (fail closed without it: `asset-storage-unresolved`).

---

## 3. Health check

`GET /api/health` → `200`, `Cache-Control: no-store`, dynamic (never an edge copy):

```json
{
  "status": "ok",
  "app": "the-nrvnaverse",
  "environment": "production",
  "release": "c2db328",
  "manifestSchemaVersion": 1,
  "spatial": { "worldId": "the-nrvnaverse", "indexSchemaVersion": 1, "globalSceneVersion": "<32 hex>", "chunks": 4 }
}
```

Only already-public facts (the global-scene version is part of a served URL). No secrets, paths, tokens or other environment. Use it as the host's health probe and to confirm *which* build is live (`release`, `globalSceneVersion`).

---

## 4. Multiplayer — not part of first live

Resolved 2026-09-25: `ws://localhost:2567` / Colyseus exist **only** in `examples/multiplayer*` (and `apps/ghostt` on `ghost/experimental`). `apps/the-nrvnaverse` has no Colyseus dependency, no WebSocket client and no multiplayer endpoint (pinned by `test/hosting-readiness.test.ts`). **First live needs no multiplayer server and no WebSocket-capable host.** Presence is a FUTURE capability (Operating Guide, `@oncyberio/multiplayer`); it will need its own endpoint configuration and gate-before-join design when adopted.

---

## 5. Custom domain — HUMAN AUTHORIZATION REQUIRED

1. Choose the host (owner decision) and create the project from this repository (build `pnpm --filter the-nrvnaverse build`, start `pnpm --filter the-nrvnaverse start`, root = repository root for the pnpm workspace).
2. Deploy a **preview** first; run §7 against it.
3. Add `worlds.nrvnaverse.com` to the host and create the DNS record it asks for (CNAME / A) in the `nrvnaverse.com` zone. HTTPS only.
4. The art origin `assets.nrvnaverse.com` is a separate R2 custom domain ([`NRVNAVERSE_R2_STORAGE.md`](./NRVNAVERSE_R2_STORAGE.md) §4); the world fetches it cross-origin (CORS `*`).

---

## 6. Caching and the immutable relationship

| Path | Served by | Cache-Control |
|---|---|---|
| `/data/spatial/spatial-index.json` | app | `public, max-age=0, must-revalidate` — the version root |
| `/data/spatial/global-scene.<v>.json`, `/data/spatial/chunks/<key>.<v>.json` | app | `public, max-age=31536000, immutable` |
| `https://assets.nrvnaverse.com/art/<assetId>/<sha256>.glb` | R2 custom domain | object header `public, max-age=31536000, immutable` (+ Cloudflare cache rule) |
| `/api/health` | app | `no-store` |

Order of truth for a release that changes art: **publish art (verified) → register revision → generate + commit chunks → deploy app**. The new index names new chunk files; the new chunks name new art keys; art objects are never overwritten, so no purge is ever needed. Verify on the host that `next.config.ts` headers are applied (some platforms override static caching) — §7 step 4.

---

## 7. Release smoke (preview, then production)

1. `curl -s <base>/api/health` → `status: ok`, expected `release` and `globalSceneVersion`.
2. `<base>/` loads the world; the visitor shell shows no diagnostics; travel Hub → Music → Artist works.
3. `BASE_URL=<base> pnpm --filter the-nrvnaverse browser:perf` (headless Chrome; desktop + mobile emulation; visitor-shell check included).
4. `curl -sI <base>/data/spatial/spatial-index.json` → `must-revalidate`; a chunk URL from it → `immutable`.
5. Deep links: `?destination=<id>&from=web&return=web` (from `packages/nrvna-manifest/generated/web-destinations.json`) land on the right destination; a gated destination is refused.
6. If art is referenced: its `https://assets.nrvnaverse.com/art/…` URL → `200`, `immutable`, `access-control-allow-origin: *`.
7. Real-device pass (iOS Safari, Android Chrome) before public announcement.

---

## 8. Rollback

- **App**: redeploy the previous build (every host keeps prior deployments). Old and new builds reference disjoint content-addressed chunk files, and the index revalidates, so switching back is instant and consistent.
- **Art**: never delete; roll the registry `currentRevision` back, regenerate, redeploy. Previous objects remain at their keys.
- **Data**: generated artifacts are committed; `git revert` + rebuild reproduces any earlier state byte-for-byte.
- A client holding an old index may 404 on a retired chunk after a deploy (accepted in M0); multi-generation retention is a later hosting feature.

---

## 9. CI

`.github/workflows/nrvnaverse-spatial.yml` (push to `nrvna/**`, `feat/**`, `fix/**`, `contrib/**`; PRs to `nrvna/integration` / `main`; manual): frozen install, manifest check / test / `generate:check`, app check / test / `spatial:check`, production build. No secrets, no deployment. Browser and device probes stay a manual release gate (§7).

---

## 10. Open before production credentials / public launch

- **S3 SigV4 transport: PROVISIONAL UNTIL LIVE-STORAGE SECURITY REVIEW.** `scripts/asset-pipeline/s3-transport.ts` is dependency-free and matches AWS reference vectors, but has not been used against a live store. Before production R2 credentials are used: either a focused review + live interoperability test, or swap it for a maintained S3 client (it sits behind `ObjectTransport`).
- Host choice, `worlds.` DNS, R2 bucket + `assets.` domain (human).
- Real Hub / Music art through `asset:prepare` → `asset:publish` → `asset:register`.
