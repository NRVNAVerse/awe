# NRVNAVerse hosting decision record — THE NRVNAVerse (worlds.nrvnaverse.com)

| Field | Value |
|---|---|
| **Status** | **PROPOSED** (M4, 2026-10-19) — for owner decision. Nothing has been created, deployed or configured; no account was logged into; no DNS changed (Governance rule 8) |
| **Decision asked** | Which platform hosts the world's staging and production, and with which release flow |
| **Recommendation** | **Vercel Pro**, one team hosting both the world and (when it ships) the WEB app; production = `worlds.nrvnaverse.com`, staging = `worlds-staging.nrvnaverse.com` (protected); DNS stays at Wix. Fallback at $0: Cloudflare Pages with a static export (needs the code changes in §5) |
| **Estimated cost** | **≈ $20 / month** (one Vercel Pro seat; covers both projects at current traffic). $0 additional for DNS (Wix), CI (public repo) and storage until production art exists |
| **Related** | [`NRVNAVERSE_HOSTING.md`](./NRVNAVERSE_HOSTING.md) (operating contract) · [`NRVNAVERSE_STAGING_AND_RELEASE.md`](./NRVNAVERSE_STAGING_AND_RELEASE.md) (workflow) · WEB `docs/DEPLOYMENT.md` (read-only: also recommends Vercel) |

Facts below were read from official pages on **2026-10-19** (read-only research; URLs in §7). Prices and limits change; re-check before buying.

## 1. What has to be hosted (VERIFIED on `feat/m4-integration-hosting-readiness`)

| Property | Measured |
|---|---|
| App | Next.js 16.1.6 App Router, Turbopack build, pnpm 10.10.0 workspace (build from the repository root) |
| Routes | `/` static; `/web-context/<id>` static (8 public ungated ids); `/robots.txt`, `/api/destinations` static; `/api/health` dynamic (tiny JSON); `/api/local-audition/*` dynamic but **404 in production** |
| Server needs | No database, no secrets, no WebSockets, no image optimizer. One dynamic route (health) |
| Build output | `.next/static` 6.7 MB (largest JS chunk 816 KB / 226 KB gzip; Rapier WASM 1.41 MB / 504 KB gzip) + `.next/server` 5.3 MB; `public/` 3.7 MB (spatial data 1.4 MB, content-addressed) |
| Build time / memory | 35 s (warm cache) to 3 m 7 s (cold) on the owner's PC (mechanical HDD, antivirus). `pnpm install --frozen-lockfile` is the slow step locally (~25 min first time on this PC; CI is fast) |
| Headers it relies on | Cache policy (immutable content-addressed data, revalidated index), security headers + CSP, `X-Robots-Tag` — all from `next.config.ts` `headers()` |
| Third-party runtime origins | `cdn.oncyber.xyz` (avatar VRM, terrain textures, engine decoders), `cyber.mypinata.cloud` (animation set), `unpkg.com` (engine GPU-tier benchmark tables) — **not ours to control**; §6 risk |
| Large models | None in production yet. Planned origin `assets.nrvnaverse.com` (content-addressed, write-once; R2 adapter exists, PROVISIONAL) |

## 2. Can the existing website platform (Wix) host it? — **No**

- Wix has no facility to upload and serve an arbitrary Next.js app or a static JS + WASM bundle at a subdomain (custom elements / sandboxed HTML iframes only). Not usable.
- **Wix DNS can point a subdomain elsewhere**: `nrvnaverse.com` uses Wix nameservers (`ns14/ns15.wixdns.net`, checked 2026-10-19); Wix "Manage DNS records" supports CNAME and TXT for subdomains — exactly what any external host needs for `worlds.` and `worlds-staging.`. Propagation "up to 48 hours". Wix does not support CAA records (not blocking: no CAA = any CA may issue).
- Consequence: the domain and the website stay where they are; the world gets its own host. Moving DNS to another provider is **not** required for the recommendation.

## 3. Options evaluated

| | Vercel Pro (recommended) | Cloudflare Pages + static export | Netlify | Render / Railway / Fly | GitHub Pages |
|---|---|---|---|---|---|
| Commercial use on the plan | Pro: yes. **Hobby is non-commercial only** — not allowed for NRVNAVerse | No restriction found (UNVERIFIED) | not stated (UNVERIFIED) | yes (paid) | **No** (excludes online business) |
| Price | $20 / month / seat | $0 | $0 / $9 / $20 (credits) | ~$2–7+ / month + egress | $0 |
| App changes needed | **None** | Static export + `_headers` generation (§5) | adapter; headers can't vary by context | none (Node server) | no custom headers → **disqualified** |
| Staging privacy | Vercel Authentication on previews — free on all plans | Access policy on `*.pages.dev` previews; a custom staging hostname needs the zone on Cloudflare | password protection Pro only | DIY | none |
| `worlds.` with DNS at Wix | CNAME | CNAME (subdomain) | CNAME (UNVERIFIED) | CNAME | CNAME |
| Rollback | Instant Rollback / promote any previous deployment | rollback to a previous deployment | yes (UNVERIFIED) | redeploy | redeploy |
| Free allowance fit | 1 TB transfer / month included | static requests unmetered; 500 builds / month; 25 MiB / file | 300 credits ≈ 20 production deploys / month, then **all team projects pause** | — | — |
| Verdict | **Fits** — simplest, zero code, matches WEB's own recommendation, one bill for both sites | **Fits at $0** with engineering work and weaker staging | Poor fit for frequent updates | Unneeded server | Out |

Cloudflare Workers (OpenNext) was not shortlisted: Workers custom domains require the zone on Cloudflare (a DNS move away from Wix), and the documented script-size limits conflict between Cloudflare's and OpenNext's pages (UNVERIFIED).

## 4. Recommendation and why

**Vercel Pro, one team, two projects (world now, WEB at its own launch).**

1. **No code change and no new dependency.** `next.config.ts` headers (cache, CSP, robots), the dynamic health route and the deployment profiles work as built and probed.
2. **Commercial use requires a paid plan anyway** — and the WEB's deployment guide already recommends Vercel. One seat covers both projects, so the world adds no marginal cost if the WEB lands there too.
3. **Staging is private for free** (Vercel Authentication on preview deployments, standard protection) and can have a stable custom domain (`worlds-staging.nrvnaverse.com`) by assigning it to the `nrvna/integration` branch — a stable origin the deployment-profile allowlist can name.
4. **Promotion and rollback match "frequent updates, minimal manual work"**: production deploys from a release branch; Instant Rollback returns to the previous production deployment in seconds; content-addressed spatial data makes old and new builds coexist safely (§HOSTING 8).

**When to prefer the fallback (Cloudflare Pages, $0):** if the owner wants no monthly cost and accepts (a) the static-export change (§5), (b) staging on a `*.pages.dev` alias instead of a custom staging domain, (c) a different platform from the WEB. A later DNS move to Cloudflare (free plan) would also unlock R2 on `assets.nrvnaverse.com` (§6).

## 5. Fallback: what a static export needs (spike run 2026-10-19, not committed)

`output: "export"` built the client but failed on dynamic routes, as Next documents. A $0 static host needs: `/api/health` → a static `/health.json` generated at build (release id from the host's commit variable); the dev-only `/api/local-audition` route excluded from export builds (it is a route handler, so it needs a separate route convention or build-time exclusion); response headers emitted as a `_headers` file from the same `http-policy.ts` / `next.config.ts` tables (cache + security + robots; Cloudflare allows 100 rules); a test that the generated `_headers` equals the config rules. Estimated: a bounded half-day task with tests. Not done because the recommended host needs none of it.

## 6. Costs, operations and uncertainties

| Item | Estimate | Notes |
|---|---|---|
| Vercel Pro seat | **$20 / month** | covers both projects; extra seats only for collaborators who must deploy (viewers of protected previews can be invited without a seat — UNVERIFIED, check the current Vercel docs) |
| Transfer | $0 at current traffic | 1 TB included; a cold first visit loads ≈ 3–4 MB from our origin (JS + WASM + spatial data, before compression) ⇒ hundreds of thousands of cold visits / month inside the allowance; repeat visits are cache hits |
| DNS | $0 | existing Wix DNS; owner adds CNAME (+ TXT if asked) |
| TLS | $0 | issued by the host for the custom domains |
| CI | $0 | `NRVNAVerse/awe` is public: GitHub-hosted runners are free; NRVNAVerse org has no paid Actions budget (Key guardrails) |
| Error monitoring | $0 (optional, not integrated) | Vercel runtime logs (1 day on Pro). A client error reporter (e.g. Sentry free tier) would be a dependency change (D-014) — separate decision |
| Art storage | $0 until real art | R2 free tier 10 GB, no egress fee. **R2 custom domain `assets.nrvnaverse.com` requires the zone on Cloudflare** (or the Business plan) — with DNS at Wix it is not available. Decide with the first production art: move DNS to Cloudflare (free; touches the Wix site's records — owner decision), or serve art from the world host itself while files stay small, or another object store with custom-domain support |

**Operational risks found in M4 (not host-specific):**
- **Third-party runtime dependencies**: the world cannot load its avatar / terrain / GPU tier if `cdn.oncyber.xyz`, `cyber.mypinata.cloud` or `unpkg.com` is down or changes those files. Mitigation (later, needs a rights check of the engine assets): self-host them under the asset contract and pass the engine a self-hosted GPU benchmark URL (engine option — upstream candidate).
- **HTML caching**: Next serves the prerendered page with `Cache-Control: s-maxage=31536000`. Vercel purges its CDN on deploy, so this is correct there; behind any other shared CDN it would pin old HTML — re-check if the host changes.
- **The website pages the world links to do not exist yet**: `www.nrvnaverse.com/worlds/<slug>` is 404 on the live Wix site (checked 2026-10-19). Handled by the build flag `NRVNA_WEB_PAGES=0` ([`NRVNAVERSE_HOSTING.md`](./NRVNAVERSE_HOSTING.md) §2): until the WEB app ships, production world → web links go to the site root.

**Uncertainties:** Vercel's monorepo install behaviour with `packageManager: pnpm@10.10.0` (enable Corepack on the project — `ENABLE_EXPERIMENTAL_COREPACK=1` — so the build uses the pinned pnpm; verify in the first preview build log); exact Vercel build memory per machine type; viewer-seat rules for protected previews; Cloudflare commercial terms for Pages; whether Vercel's 1 TB includes all edge traffic types for this app (verify on the usage page after a month).

## 7. Sources (read 2026-10-19)

Vercel: fair-use guidelines (Hobby non-commercial) https://vercel.com/docs/limits/fair-use-guidelines · pricing https://vercel.com/pricing · limits https://vercel.com/docs/limits · deployment protection https://vercel.com/docs/deployment-protection · domains https://vercel.com/docs/domains/working-with-domains/add-a-domain · instant rollback https://vercel.com/docs/instant-rollback. Cloudflare: Pages limits https://developers.cloudflare.com/pages/platform/limits/ · custom domains https://developers.cloudflare.com/pages/configuration/custom-domains/ · previews https://developers.cloudflare.com/pages/configuration/preview-deployments/ · Workers custom domains https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ · partial setup https://developers.cloudflare.com/dns/zone-setups/partial-setup/ · R2 pricing https://developers.cloudflare.com/r2/pricing/ · R2 public buckets https://developers.cloudflare.com/r2/buckets/public-buckets/. Netlify pricing https://www.netlify.com/pricing/ · paused projects https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/. GitHub Pages limits https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits. Wix DNS https://support.wix.com/en/article/managing-dns-records-in-your-wix-account · subdomain to external https://support.wix.com/en/article/connecting-a-subdomain-to-an-external-resource · CAA request https://support.wix.com/en/article/request-supporting-caa-records. Next.js static exports https://nextjs.org/docs/app/guides/static-exports.
