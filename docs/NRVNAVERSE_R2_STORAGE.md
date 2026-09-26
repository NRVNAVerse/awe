# NRVNAVerse Production Asset Storage — Cloudflare R2 (external-cas adapter)

| Field | Value |
|---|---|
| **Status** | Adapter + `asset:publish` **IMPLEMENTED and tested without cloud credentials** (in-memory transport, injected `fetch`, AWS SigV4 reference vectors). **No bucket, token, custom domain, cache rule or DNS record exists yet** — every account action below is **HUMAN AUTHORIZATION REQUIRED** |
| **Decision** | First production adapter for the provider-neutral `external-cas` backend: **Cloudflare R2, Standard storage class**, public origin **`https://assets.nrvnaverse.com`** (owner decision, 2026-09-25). The registry is not shaped around R2 |
| **Code** | `apps/the-nrvnaverse/scripts/spatial/storage.mjs` (contract) · `scripts/asset-pipeline/{s3-transport,r2-config,external-cas-adapter,publish-asset}.ts` · `test/asset-publish.test.ts` |
| **Related** | docs/NRVNAVERSE_ASSET_PIPELINE.md §4, §11 · D-014 (no lockfile change: the S3 transport is dependency-free) · Governance rule 8 (no production account / DNS change without authorisation) |

---

## 1. What is provider-neutral and what is R2

| Layer | Owns | R2-specific? |
|---|---|---|
| Registry revision | `{ sha256, bytes, format, storage: { backend: "external-cas", objectKey } }` | **no** — no bucket, host, URL or vendor name |
| Object key | `art/<assetId>/<full sha256>.glb`, exact match, write-once | no |
| Runtime URL | `<publicOrigin>/<objectKey>`, `publicOrigin` from committed `config.assetStorage["external-cas"]` (`https://assets.nrvnaverse.com`) | no |
| Transport | S3 API (SigV4): `HeadObject`, `GetObject`, conditional `PutObject` | S3-compatible, not Cloudflare REST |
| Adapter config | `NRVNA_ASSET_R2_*` → endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto` | **yes** (`r2-config.ts` only) |

Moving to another S3-compatible store later = a new config module producing an `ObjectTransport`. Nothing in the registry, keys or generated chunks changes except — only if the public origin changes — the URL prefix.

---

## 2. Environment contract (never committed)

| Variable | Required for | Notes |
|---|---|---|
| `NRVNA_ASSET_R2_ACCOUNT_ID` | publish, dry-run | 32-char lower-case hex Cloudflare account id |
| `NRVNA_ASSET_R2_BUCKET` | publish, dry-run | bucket name (3–63 lower-case letters, digits, hyphens) |
| `NRVNA_ASSET_R2_ACCESS_KEY_ID` | publish | R2 API token access key id |
| `NRVNA_ASSET_R2_SECRET_ACCESS_KEY` | publish | R2 API token secret — never printed, never written to a report |
| `NRVNA_ASSET_PUBLIC_ORIGIN` | publish, dry-run | production value `https://assets.nrvnaverse.com`; must equal the committed `config.assetStorage` origin (`public-origin-mismatch` otherwise); bare `https://host` only, never `*.r2.dev` |

Set them in the shell of the machine doing the publication (or a local, Git-ignored env file loaded by that shell). Reports show only `set` / `missing` for credentials.

---

## 3. Publication semantics (implemented)

```
pnpm --filter the-nrvnaverse asset:prepare <source.glb> <metadata.json> --out <dir>
pnpm --filter the-nrvnaverse asset:publish <dir>/prepared/<assetId>.r<n>.json [--dry-run]
```

1. **Policy first, offline.** The prepare report is re-evaluated, not trusted: `status: ready`, registry schema, `usage: production` with every `productionBlockers()` condition, key = `art/<assetId>/<sha256>.glb`, proposal ↔ artifact agreement, staged bytes re-hashed, configuration valid, env origin = committed origin. Any failure → `BLOCKED`, exit 2, **no storage call is made**.
2. **`--dry-run`** stops here and prints / writes the full plan (target, key, size, digest, headers, runtime URL, every request it would make). No network call; credentials not required.
3. **HEAD** the key.
4. **Absent** → `PUT` with `If-None-Match: *`, `Content-Type: model/gltf-binary`, `Cache-Control: public, max-age=31536000, immutable`, `x-amz-meta-sha256`, `x-amz-meta-asset-id`, signed payload hash. A `412` (a concurrent writer won) is treated as "present".
5. **Present** → must be **exactly** this artifact. Different bytes → `conflict`; same bytes with wrong `Content-Type` / `Cache-Control` → `metadata-mismatch`. Both **fail hard (exit 1)**. There is no overwrite path: no unconditional PUT is ever issued.
6. **Verify**: `GET` the whole object, check length and **full SHA-256 computed locally**, plus `Content-Type` and `Cache-Control`. ETags are never treated as digests (R2 / S3 multipart ETags are not content hashes). Success is reported only after this.
7. **Report** `<dir>/published/<assetId>.r<n>.json`: status `published` / `already-published` / `failed` / `blocked`, verification, runtime URL, and the unchanged registry revision **for a human to commit**. The command never edits the registry, a scene, DNS or a deployment, and never creates or changes a review or rights metadata.

Order of truth: **upload → verify → commit registry revision + regenerated chunks → deploy**. The registry decides which bytes are live; the bucket only holds them.

---

## 4. Bucket and domain setup — HUMAN AUTHORIZATION REQUIRED

Nothing below has been done. Each step is an account / DNS change (Governance rule 8).

| # | Action | Setting |
|---|---|---|
| 1 | Create bucket | Name e.g. `nrvnaverse-assets`; **Standard** storage class; location hint near the audience. Do **not** enable Infrequent Access for runtime art |
| 2 | Public access | **Custom domain** `assets.nrvnaverse.com` on the bucket (the `nrvnaverse.com` zone must be on Cloudflare). **Leave `r2.dev` public access disabled**; production never relies on it (the code refuses `*.r2.dev` origins) |
| 3 | CORS policy | See §5 |
| 4 | Cache rule | See §6 |
| 5 | API token | R2 token with **Object Read & Write** scoped to **this bucket only**; store its key id / secret outside the repository |
| 6 | Lifecycle | **No expiry / deletion rules** on `art/`. Objects referenced by any registry revision are retained (rollback + old clients). Optional, owner decision: an R2 bucket lock / retention rule on `art/` for enforced immutability |
| 7 | Verify | §7 checklist, then publish the first real asset |

---

## 5. CORS contract

The world (`https://worlds.nrvnaverse.com`) fetches GLBs cross-origin from `https://assets.nrvnaverse.com`, so the bucket must answer CORS.

**Recommended policy: `Access-Control-Allow-Origin: *`, GET / HEAD, no credentials.**

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

Why `*` is the simplest correct policy here:
- The objects are **public, immutable, credential-free** content; anyone can already fetch them directly. CORS does not protect public bytes; it protects credentialed responses, and there are none (`AllowCredentials` stays false).
- A single constant `ACAO: *` response is identical for every requester, so the edge cache holds **one** variant. An origin allow-list makes the header depend on `Origin` (needs `Vary: Origin`, fragments the cache, and a cached response for one origin can be wrong for another).
- It keeps preview / staging hosts and local development working without editing bucket config.

Choose an explicit allow-list (`https://worlds.nrvnaverse.com` plus preview origins) only if a future requirement demands it — e.g. hot-link accounting. That is a product decision, not a correctness one.

---

## 6. Cache contract

Objects already carry `Cache-Control: public, max-age=31536000, immutable` (set at upload, verified after). Cloudflare does **not** cache `.glb` by default (it is not in the default cached-extension list), so an explicit rule is required:

| Setting | Value |
|---|---|
| Rule match | hostname equals `assets.nrvnaverse.com` **and** URI path starts with `/art/` (optionally: ends with `.glb`) |
| Cache eligibility | **Eligible for cache** |
| Edge TTL | **Use cache-control header if present** (respect origin → one year, immutable) |
| Browser TTL | **Respect origin** |
| Status-code TTL | **404 / 403 / 5xx → no cache** (0 s / bypass). A missing object must never be cached, let alone as immutable |
| Do NOT | "Cache everything" with an overridden long edge TTL (it would cache errors), or strip / rewrite `Cache-Control` |

Because keys are content-addressed and write-once, no purge is ever needed for a new revision: a new revision is a new key.

Ordering keeps 404s rare: a registry revision (and therefore a URL in a chunk) is committed only **after** its object is published and verified.

---

## 7. Post-setup verification checklist (human, after §4)

1. `asset:publish <report> --dry-run` with the real env → `PLANNED`, target shows the real bucket, credentials `set`.
2. `asset:publish <report>` → `PUBLISHED`, `verified full-object-get-sha256`.
3. Run it again → `ALREADY-PUBLISHED` (idempotent).
4. `curl -sI https://assets.nrvnaverse.com/art/<assetId>/<sha256>.glb`
   → `200`, `content-type: model/gltf-binary`, `cache-control: public, max-age=31536000, immutable`.
5. Same with `-H "Origin: https://worlds.nrvnaverse.com"` → `access-control-allow-origin: *`.
6. Repeat → `cf-cache-status: HIT`.
7. `curl -sI https://assets.nrvnaverse.com/art/<assetId>/<64 zeros>.glb` → `404`, **no** `immutable`, not `HIT` on repeat.
8. `https://<bucket>.<account>.r2.dev/...` is not publicly reachable.
9. `curl -s <url> | sha256sum` equals the registry `sha256`.
10. Commit the registry revision, reference it (`assetRef`), `spatial:generate` / `spatial:check`, then `browser:perf` with `ASSET_COMPONENT` against a preview.

---

## 8. Known limits

- Not yet exercised against a live R2 bucket (no credentials exist). The transport is standard S3 SigV4 and matches AWS's reference signatures; the first real run is the §7 checklist.
- Single-request `PUT` (no multipart). Fine for runtime GLBs well under R2's single-PUT limit; very large art would need multipart, which is out of scope.
- `If-None-Match: *` conditional PUT is used where the store supports it; correctness does not depend on it (a present object is always verified, never overwritten).
- Verification downloads the whole object once per publish — deliberate; it is the only reliable digest check.
