# NRVNAVerse staging → production workflow (THE NRVNAVerse)

| Field | Value |
|---|---|
| **Status** | **PROPOSED** (M4, 2026-10-19). The application side is IMPLEMENTED and locally verified (deployment profiles, indexing, release probe); every host / DNS / branch-protection step below is **HUMAN AUTHORIZATION REQUIRED** (Governance rule 8) and has not been done |
| **Assumes** | the hosting recommendation in [`NRVNAVERSE_HOSTING_DECISION.md`](./NRVNAVERSE_HOSTING_DECISION.md) (Vercel Pro). The flow is host-neutral; only §3's settings are Vercel-specific |
| **Contract** | [`NRVNAVERSE_HOSTING.md`](./NRVNAVERSE_HOSTING.md) (env, headers, health, rollback) |

Goal: the owner can update galleries, stages, worlds and editorial data often, with one safe path from a tested commit to production and an instant way back.

## 1. Environments

| Environment | URL | Built from | `NRVNA_DEPLOYMENT` | Indexed | Access | Links to website |
|---|---|---|---|---|---|---|
| Local | `http://localhost:3100` | working tree | `local` | never | the developer | `http://localhost:3000` (WEB app, harness port) |
| Branch preview | host-generated URL per push | any `feat/*` branch | `staging` | never | protected (host login) | staging website |
| **Staging** | `https://worlds-staging.nrvnaverse.com` (PROPOSED name) | `nrvna/integration` (auto) | `staging` | never (`noindex` + `Disallow: /`, and the host adds its own `noindex` on previews) | protected (host login; invite collaborators) | `https://staging.nrvnaverse.com` (PROPOSED, the WEB staging) |
| **Production** | `https://worlds.nrvnaverse.com` | `nrvna/release` (PROPOSED, fast-forward only) | `production` | only with `NRVNA_ALLOW_INDEXING=true` (owner decision) | public | `https://www.nrvnaverse.com` |

The origin pairs are the reviewed allowlist in `apps/the-nrvnaverse/src/lib/deployment/deployment-profile.ts`. If the staging hostnames end up different, change them there in one reviewed commit — never through an environment variable or URL.

**Website pages.** While `www.nrvnaverse.com/worlds/<slug>` does not exist (the live Wix site returns 404 — checked 2026-10-19), build production with `NRVNA_WEB_PAGES=0`: every world → web link then goes to the site root instead of a dead page. Remove it (or set `1`) in the release that cuts the WEB app over to `www`; `CHECK_WEB_LINKS=1` in the production smoke proves either state.

## 2. Branches and promotion (PROPOSED addition to the Governance branch model)

```
feat/<topic> ──review──► nrvna/integration ──(auto)──► STAGING
                                 │
                       owner acceptance on staging
                                 │  git push origin <accepted sha>:nrvna/release   (fast-forward only)
                                 ▼
                           nrvna/release ──(auto)──► PRODUCTION
```

- `main` stays the pristine upstream mirror (Governance) — it is **never** a deploy branch.
- `nrvna/release` is new: it only ever fast-forwards to a commit that is already on `nrvna/integration` and was accepted on staging. Protect it (no force-push, no direct commits) when it is created.
- Promotion is one command and moves exactly the tested commit; the production build then runs from that SHA. On Vercel the alternative is "Promote to Production" of the exact staging deployment (no rebuild) — either is fine; record the SHA.

## 3. One-time setup (owner, with account access — not done)

1. **Host account / team** (Vercel Pro, §HOSTING_DECISION). Import `NRVNAVerse/awe`. Root directory: `apps/the-nrvnaverse` (the workspace root holds `pnpm-lock.yaml`; confirm in the first build log that install ran at the root with pnpm 10.10.0 — set `ENABLE_EXPERIMENTAL_COREPACK=1` so Corepack pins it, D-014). Install: `pnpm install --frozen-lockfile`. Build: `pnpm build` (= `release:check && next build`). Framework: Next.js. Node: 22.x or 24.x.
2. **Production branch** = `nrvna/release`. Create the branch at the accepted commit (§5) only when the owner authorizes the first production deploy.
3. **Environment variables** (no secrets exist):
   - Production: `NRVNA_DEPLOYMENT=production`; `NRVNA_WEB_PAGES=0` until the WEB app serves `www` (see §1); `NRVNA_ALLOW_INDEXING=true` only if the owner wants search engines to index the world's entry page (otherwise leave unset — the world is still public, just not indexed).
   - Preview (all branches): `NRVNA_DEPLOYMENT=staging`. Never set `NRVNA_ALLOW_INDEXING` here (it would be ignored anyway: staging is never indexable).
   - `NRVNA_RELEASE_ID` is optional: the host's commit SHA (`VERCEL_GIT_COMMIT_SHA` / `CF_PAGES_COMMIT_SHA`) is reported by `/api/health` automatically.
4. **Domains**: add `worlds.nrvnaverse.com` to the production environment and `worlds-staging.nrvnaverse.com` to the `nrvna/integration` branch; the host shows the CNAME (and possibly a TXT) record to create.
5. **DNS at Wix** (Domains → Manage DNS Records): CNAME `worlds` → the value the host shows; CNAME `worlds-staging` → the value it shows; TXT if asked. Propagation up to 48 h. Nothing else in the zone changes.
6. **Protection**: keep the host's standard deployment protection on (previews and the staging domain require login; production is public). Invite collaborators who must test on their devices.
7. **WEB staging** (WEB repo's own decision): its staging build must link to `https://worlds-staging.nrvnaverse.com` — the WEB follows `spatial.deepLink` verbatim today, which names production, so it needs its own build-time world origin. Until then staging round trips work world → web only.

## 4. Normal change vs high-risk change

| | **Normal** (content / data) | **High-risk** (runtime / world / platform) |
|---|---|---|
| Examples | switch a gallery exhibition (`gallery:assign`), edit manifest copy / tags, add a cleared asset revision through `asset:*`, docs | engine / physics / camera / travel / chunk / streaming code, gates, new destinations or ids, world layout, Blender imports, `next.config.ts` / headers / profiles, dependencies (D-014), hosting settings |
| Before merge | `pnpm --filter the-nrvnaverse verify` (typecheck, tests, manifest tests, release build) — green CI on the branch | the same + full probe suite on a local production build: `browser:release`, `browser:touch`, `browser:perf`, `browser:camera`, `browser:gallery` + independent review (planning / review AI) |
| On staging | `BASE_URL=https://worlds-staging.… EXPECT_DEPLOYMENT=staging pnpm --filter the-nrvnaverse browser:release` is not possible while staging requires a login (the probe has no bypass); instead open staging logged in and check the changed place + `/api/health` (`deployment: "staging"`, `release` = the SHA) | the same + a real phone (iOS Safari and Android Chrome) walk: Hub arrival, the Drop, one portal, the changed area |
| Accept | owner glance | owner acceptance, recorded in the handoff |
| Promote | §2 one command | §2 one command, at a quiet time; watch `/api/health` and one visit |

## 5. Production release checklist (every release)

1. Commit is on `nrvna/integration`, CI green, staging shows it (`/api/health.release` = SHA).
2. Owner accepted it on staging (high-risk: real-device walk done).
3. Promote: `git fetch origin; git push origin <sha>:nrvna/release` (refused if not a fast-forward — that is the safety).
4. Smoke production (no login needed): `BASE_URL=https://worlds.nrvnaverse.com EXPECT_DEPLOYMENT=production EXPECT_INDEXING=<0|1> EXPECT_WEB_PAGES=<1|0> CHECK_WEB_LINKS=1 pnpm --filter the-nrvnaverse browser:release` — headers, robots, CSP, the 21+ gate (zero gated requests), return links, fault-injected Hub arrivals, phone profile. Plus `curl -s https://worlds.nrvnaverse.com/api/health`.
5. Record SHA, time and the probe result in the handoff / Landmark checkpoint.

## 6. Rollback

- **Immediate**: the host's Instant Rollback (or "promote" the previous production deployment). Seconds; no rebuild. Old and new builds reference disjoint content-addressed chunk files and the index revalidates, so switching back is consistent ([`NRVNAVERSE_HOSTING.md`](./NRVNAVERSE_HOSTING.md) §8).
- **Then fix forward**: revert the faulty commit on `nrvna/integration` (`git revert`), verify on staging, promote. `nrvna/release` only ever moves forward — no force-push.
- **DNS** is not part of a rollback (it never changes per release).
- A visitor holding an old index may 404 on a retired chunk until they reload (accepted since M0).

## 7. What "minimal manual work" means here

Per normal update the owner does: merge (or approve) → look at staging → one promote command (or one host button). Everything else — build fail-closed on stale data, headers, noindex on staging, origins per environment, health identity — is automatic and covered by tests (`test/http-policy.test.ts`, `test/hosting-readiness.test.ts`) and the release probe.
