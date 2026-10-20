# Implementer Handoff — M4: spatial integration, reliability, safety and hosting readiness

## Baton

NEXT: CHATGPT
LAST: CLAUDE
STATE: AWAITING_REVIEW — **READY FOR STAGING** (deployment-ready candidate, locally verified; nothing merged, deployed or configured)
BRANCH: `feat/m4-integration-hosting-readiness` (pushed; working tree clean at the final commit). Also pushed: `contrib/rigidbody-teleport-interpolation` (upstream candidate, one engine commit on `main`; **no PR opened**)

Read first: `docs/NRVNAVERSE_M4_CAMPAIGN.md` (findings, checkpoints, queue). Decisions to take: `docs/NRVNAVERSE_HOSTING_DECISION.md` (D-022 PROPOSED), `docs/NRVNAVERSE_STAGING_AND_RELEASE.md` (D-023 PROPOSED), `docs/NRVNAVERSE_INTEGRATION_M1_M4.md`. Contracts: `docs/NRVNAVERSE_HOSTING.md`, manifest §8.1–8.2, runtime §22, pipeline §21. The M3 handoff that lived in this file is in Git history (`e1662b7`).

## 1. Integration state and outstanding owner approvals

- **Ancestry (VERIFIED 2026-10-19):** `main 04a07c8` ⊂ `nrvna/integration 19562bc` ⊂ M1 `ecda29f` ⊂ M2 `7a93c08` ⊂ M3 `e1662b7` ⊂ M4 (this branch). One straight line; every step is a fast-forward. `main` and `nrvna/integration` untouched.
- **Prepared, not executed:** exact staged fast-forward commands, preconditions, per-stop verification and rollback points — `docs/NRVNAVERSE_INTEGRATION_M1_M4.md`. A single fast-forward `19562bc → <M4 head>` is equivalent if the owner accepts M4 as a whole. Heads M1–M3 still contain the Hub-arrival fall (fixed only in M4).
- **Provisional product rulings applied:** The Club `dst_gqq90k2404cy9nf0` keeps its id and is a **playable preview** (new internal `preview` tag → the web export's v1 `placeholder` flag; the WEB shows "In development · Preview open · Enter the preview"; entry never depends on the flag — tested). The City and Gallery One unchanged (ids, slugs, layout).
- **Owner approvals outstanding:** (1) fast-forward `nrvna/integration` (each push); (2) hosting choice D-022 (Vercel Pro recommended) and account / billing; (3) release branch model D-023 (`nrvna/release`); (4) staging hostnames (`worlds-staging.` / `staging.nrvnaverse.com` PROPOSED) and the Wix DNS records; (5) production indexing (`NRVNA_ALLOW_INDEXING`); (6) launching before the WEB app (`NRVNA_WEB_PAGES=0`); (7) acceptance of the third-party runtime origins; (8) The Club's marquee text "THE CLUB — placeholder listening session" and the "Placeholder Artist / Brand" names are product copy — left as is.

## 2. Hub-arrival fall — investigation and evidence

**Root cause proven; fixed in the runtime.** The engine renders the PLAYER body at `lerp(previous, current, α)`. `teleport()` resets only the current pose; physics is inactive until `space.start()`, so after the hidden placement teleport the previous pose is still the boot pose (y = 0) while the current one is the deck spawn (y = 141). When the first live physics update is shorter than one fixed step (1/60 s), zero steps run, interpolation writes `lerp(0, 141, α)` into the avatar, and the Mover's ground-sync probe after `reset()` restores the body to that component position — below the 0.5 m deck; the M2 release then hands the visitor to The City.

| Evidence | Result |
|---|---|
| Fault injection: first physics update forced to 16 ms (an ordinary 60 Hz frame), production build, before the fix | **4 / 4 falls, y = 135.36** (= 0.96 × 141; the M3-recorded failure signature was 134.5–135.5 at `ready`) |
| Same injection at 16 ms and 5 ms, after the fix | **0 / 12** (scratch tool) and 3 + 3 in every `browser:release` run (check A) |
| Natural first live frame on this PC | 17–34 ms — right at the 16.7 ms threshold → intermittent, load- and display-dependent (90 / 120 Hz screens make short first frames likely) |
| Bounded CPU load (4 of 8 threads at 80 %), 24 fresh loads each | M3 head: 0 / 24 falls but **24 / 24 loads in the hazardous state** (previous pose = stale boot pose); M4: 0 / 24 falls, **0 / 24** in that state |
| Travel teleports while running | not affected (zero-step frame injected after a travel teleport: 3 / 3 exact — the character controller moves from the raw Rapier translation) |
| Intentional Drop | unchanged (`browser:touch` / `browser:perf` pass; the Drop path is not a teleport) |

Not claimed fixed because it stopped reproducing: the natural fall was **not** reproduced under load on either head; the claim rests on the deterministic injection and the observed state. Fix: `src/lib/spatial/teleport-interpolation.ts` (`settleTeleportInterpolation`, the engine's own `_preInterpolate`, feature-checked) called in `placeVisitor` right after the official teleport. Engine-level fix prepared for upstream on `contrib/rigidbody-teleport-interpolation` (`c6160e7`: `_resetPosition` / `_resetQuaternion` also reset the previous pose; new engine test fails before / passes after; engine 127 tests + `engine:check` green). Residual risk: none known for placement; the app workaround stays harmless if the engine fix lands.

## 3. Indexing and age-gate results

- `/web-context/<gated id>` (WEB v0.5 finding) is **gone**: panels exist only for public, ungated destinations (gated ids 404; the in-world window never opens for them; no threshold points at a gated id — tested). Panels are `noindex, nofollow`, canonical = the website page.
- **No accidental indexing:** every build is `noindex` (X-Robots-Tag on every response, `Disallow: /`, page meta) unless `NRVNA_DEPLOYMENT=production` **and** `NRVNA_ALLOW_INDEXING=true`; even then `/web-context`, `/api`, `/data`, `/assets` are never indexed. Verified for production-default, staging, local and indexable-production builds on a real server.
- **21+ boundary unchanged:** Hub → 21+ (deep link) refused at the Hub with **zero** requests for the gated chunk or panel (both gated ids, every `browser:release` run; `browser:touch` touch path likewise). New canonical rule `media-in-gated-chunk`: a gated chunk may carry no media by URL (no image / model / audio / video address, `data:` / `blob:` payloads) — the static gated file can only describe placeholder geometry and text. The gated chunk file itself remains publicly retrievable by direct URL (known limitation since M0 — not authorization).
- **Security headers / CSP** on every response; **zero CSP violations** in real desktop and phone loads. The CSP surfaced an undocumented engine fetch of GPU benchmark tables from `unpkg.com` (allowed for `connect-src` only).

## 4. WEB ↔ WORLD return contract

- `return` (only a token that resolved: `web` or a public destination id) is now **kept through in-world travel and walk-in handoffs** (`?destination=<id>&from=spatial[&ref][&return]`); unsafe tokens and URLs are dropped (no open redirect — probed).
- The card shows `<current place> on nrvnaverse.com` and the way back (`Back to <page> on nrvnaverse.com`), de-duplicated. Exact avatar position on return is **not** promised (back/forward cache only — contract doc corrected; roadmap's `return=web` wording corrected to "site root").
- **Allowlisted preview origins:** reviewed deployment profiles (`production` / `staging` / `local`) pair the world origin with the website origin; chosen at build time by `NRVNA_DEPLOYMENT` (unknown → build error); no URL or origin from env or visitor. Local round trip (world `NRVNA_DEPLOYMENT=local` on :3100 → scratch WEB build on :3000): way back lands on `http://localhost:3000/worlds/music`, return kept through travel, web-context panel on the local web, **zero requests to production hosts**. Staging build: every link on `https://staging.nrvnaverse.com`.
- **WEB-side follow-ups (WEB repo's decision):** a build-time world origin for its staging (it follows `spatial.deepLink`, which names production); optionally `return=<own id>` on destination pages (AWE supports it; the WEB's `expectedDeepLink` pins `return=web`, so the feed keeps `return=web`).
- **Live-site finding:** `www.nrvnaverse.com/worlds/<slug>` is 404 on the Wix site. A world launched before the WEB app builds with `NRVNA_WEB_PAGES=0` (all world → web links to the root); `CHECK_WEB_LINKS=1` in the production smoke proves it.

## 5. Recommended staging / production architecture

Vercel Pro, one team for world + WEB; production `worlds.nrvnaverse.com` from a fast-forward-only `nrvna/release`; staging `worlds-staging.nrvnaverse.com` from `nrvna/integration`, login-protected; feature branches get protected previews; DNS stays at Wix (CNAME / TXT only). Wix cannot host the app (checked). Fallback $0: Cloudflare Pages static export (needs the bounded changes in the decision record §5; staging only on `*.pages.dev`). Normal vs high-risk change paths and the release checklist: `docs/NRVNAVERSE_STAGING_AND_RELEASE.md`.

## 6. Costs and operational requirements

≈ **$20 / month** (one Vercel Pro seat, both projects; 1 TB transfer included — a cold visit is ≈ 3.96 MB on the wire). $0: DNS (Wix), TLS, CI (public repo), R2 until real art. Operations: no secrets on the app host; three build-time switches (`NRVNA_DEPLOYMENT`, `NRVNA_ALLOW_INDEXING`, `NRVNA_WEB_PAGES`); `/api/health` reports deployment / indexing / web pages / release SHA; hosted build ≈ 1 min (CI job 57 s). Uncertainties (decision record §6): Vercel monorepo + Corepack pin, viewer seats, Pages commercial terms, R2 custom domain needs Cloudflare DNS.

## 7. Deployment and rollback (once authorized)

Setup and the per-release checklist: `docs/NRVNAVERSE_STAGING_AND_RELEASE.md` §3 / §5. Promote = `git push origin <accepted sha>:nrvna/release` (fast-forward only) or the host's "promote" of the exact staging deployment. Smoke = `BASE_URL=https://worlds.nrvnaverse.com EXPECT_DEPLOYMENT=production EXPECT_WEB_PAGES=<0|1> CHECK_WEB_LINKS=1 pnpm --filter the-nrvnaverse browser:release` (staging: add `BASE_HEADER` with the host's automation bypass). Rollback = the host's Instant Rollback (seconds), then `git revert` on integration and re-promote; content-addressed data makes old / new builds coexist.

## 8. Local verification evidence (final head)

| Check | Result |
|---|---|
| App tests (vitest) | **598 passed** (41 files; 572 at the M3 base) |
| Manifest tests | **65 passed** (61 at base) |
| `tsc` + strict, `spatial:check`, `generate:check`, `compose --check`, release build | pass (`pnpm --filter the-nrvnaverse verify`, 1 m 12 s warm) |
| Hosted CI (GitHub Actions, Linux) | **green** on `671ea46` — all 12 steps executed; it had failed on every push since M3 (`authoring-importer.test.ts:170`, Windows path on Linux; fixed) |
| `browser:release` | **PASSED** — production default (57 checks), staging, local, indexable-production, `NRVNA_WEB_PAGES=0`, and through a header-counting proxy (`BASE_HEADER` on 254 / 254 own-origin requests) |
| `browser:perf` | **PASSED** — desktop 113 calls / 175 k tris / 56 fps (p95 18.1 ms) / heap 46 MB; mobile 105 / 173 k / 56 fps / heap 59–78 MB across 4 runs (one 78 MB snapshot, others 59). **A/B vs the M3 head on this PC the same day: identical calls / triangles / fps; heap equal** (M3 recorded 60 fps on 2026-10-16 — machine state) |
| `browser:touch`, `browser:camera`, `browser:gallery` | **PASSED** (see `D:\AWE-Scratch\m4\final\`) |
| Hub arrival | fault-injected 0 / 12 after vs 4 / 4 before; loaded 0 / 24 |
| Not run / not possible | real iOS / Android devices; a hosted deployment; the WEB → world leg on staging (needs the WEB's own origin setting) |

Recorded failures during the run (all explained): the first `browser:release` caught the `/:path*` root-matching gap and the unpkg CSP block (fixed); the local round trip caught the health identity bug (fixed); in the final pass, 4 subprocess-spawning tests timed out at 5 s in the full parallel suite immediately after a branch switch had rewritten every app file (isolated: 0.5–0.75 s; warm full rerun 598 / 598) and two probes correctly refused the then-stale build (rerun green).

## 9. Owner actions to get the world live

1. Accept M4 (or the staged sequence) and authorize the fast-forward of `nrvna/integration`.
2. Decide D-022 (host) and D-023 (release branch); create the host team (Vercel Pro) and import `NRVNAVerse/awe` per the staging doc §3.
3. Set env: Preview `NRVNA_DEPLOYMENT=staging`; Production `NRVNA_DEPLOYMENT=production`, `NRVNA_WEB_PAGES=0` (until the WEB app serves `www`), `NRVNA_ALLOW_INDEXING=true` only if the world should be indexed.
4. In Wix DNS: CNAME `worlds-staging` and `worlds` to the values the host shows (+ TXT if asked).
5. Play on staging on a real iPhone and Android phone (Hub arrival, the Drop, a portal, The Club, Gallery One); run the staging smoke.
6. Create `nrvna/release` at the accepted commit → production deploys; run the production smoke with `CHECK_WEB_LINKS=1`.
7. Decide whether to keep or self-host the third-party runtime assets before a broad announcement.

## 10. Blockers, uncertainties, remaining risks

- **Blockers for public launch:** owner approvals and setup above; real-device validation (all mobile evidence is emulated).
- Third-party runtime origins (`cdn.oncyber.xyz`, `cyber.mypinata.cloud`, `unpkg.com`) can break the world if they change or go down.
- The gated chunk file is still publicly retrievable by direct URL (placeholder geometry and text only; now enforced to carry no media).
- Prerendered HTML is `s-maxage=31536000`: correct on Vercel, re-check on any other CDN.
- R2 / `assets.nrvnaverse.com` needs the zone on Cloudflare — no production art exists yet.
- Subprocess-spawning tests have a 5 s timeout that a cold machine can exceed (seen once right after a checkout); not changed.
- Vercel specifics (Corepack pin, protection bypass, seats) are UNVERIFIED until an account exists.

## Release recommendation

**READY FOR STAGING.** Code, data, headers, indexing, gate, return contract and the Hub-arrival fix are verified locally and in hosted CI; the hosting and workflow decisions are written down with costs. **Not yet ready for public launch**: that needs the owner approvals and setup in §9 and one evidence step only staging can provide (real-device pass + hosted smoke). Nothing technical found in M4 blocks staging.

Operator command: say "handoff" in the ChatGPT planning/review conversation.
