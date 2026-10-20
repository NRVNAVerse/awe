# NRVNAVerse M4 — integration, reliability, safety and hosting readiness — campaign record

Compact, restartable record for the M4 run on `feat/m4-integration-hosting-readiness`. Read this first after a compaction or restart; then `handoffs/current/reviewer.md`. Not a transcript.

| Field | Value |
|---|---|
| **Objective** | Prepare and locally verify a deployment-ready candidate: integration sequence M1 → M2 → M3 → M4, Hub-arrival reliability, indexing / privacy safety, WEB ↔ WORLD return contract with an allowlisted preview origin, a hosting decision record, a staging → production workflow, release verification |
| **Branch** | `feat/m4-integration-hosting-readiness`, from `e1662b7` (= `origin/feat/m3-blender-camera-foundation`). Not merged, not deployed |
| **Session** | Claude Code, Opus 5.5, Auto, 2026-10-19 (PDT), overnight protocol (`TheCannaMan/Key@43c18e4` `OVERNIGHT_RUNS.md`) |
| **Authority** | Prepare and verify locally only. **Not authorized:** merging / advancing `nrvna/integration`, `main` or any protected branch; deploying; DNS; publishing content; creating paid infrastructure or accounts; incurring charges; changing NRVNAVerse WEB, Key, the knowledge core, HVC, NIC or SIC |
| **Guidance read** | Operating Guide, Governance, Landmark, DECISIONS (D-001–D-021), M1 / M2 / M3 campaign records + handoffs, hosting / manifest / runtime docs; Key `OVERNIGHT_RUNS.md`, `CHATGPT_CLAUDE_ONE_PASTE_HANDOFF.md`, `GITHUB_BILLING_AND_CI_GUARDRAILS.md`; WEB `feat/web-world-integration-v05@d7caa64` (read-only): `AWE_INTEGRATION_PROPOSAL.md`, `WEB_SPATIAL_CONTRACT.md`, `DEPLOYMENT.md`, `WORLD_HARNESS.md` |
| **Boundaries kept** | no merge / deploy / DNS / account / spend; WEB, Key, SIC untouched (WEB only read, and one scratch WEB build served read-only for the round trip); no engine / editor / studio file changed; no dependency or lockfile change; no third-party model committed; 21+ gate unchanged (refusal-before-fetch re-verified) |

## 0. Recovered state (VERIFIED 2026-10-19)

- Ancestry is one straight line: `origin/main` `04a07c8` ⊂ `origin/nrvna/integration` `19562bc` ⊂ M1 `ecda29f` ⊂ M2 `7a93c08` ⊂ M3 `e1662b7` = this branch's base. Every step is a fast-forward.
- Baseline on `e1662b7`: 572 app tests, 61 manifest tests, `check` green locally. **Hosted CI on M3 had been failing on every push** (see finding 6) — the M3 handoff said "not run".
- `nrvnaverse.com` DNS is on Wix (`ns14/ns15.wixdns.net`); `www` is the live Wix site, where `/worlds/<slug>` is 404; `worlds.nrvnaverse.com` does not resolve.

## 1. Checkpoints

| # | What | Commit |
|---|---|---|
| 1 | Hub-arrival fall: root cause proven, fixed (`settleTeleportInterpolation`), model test; campaign record | `c48ed34` |
| 2 | Deployment profiles, indexing / privacy, security headers + CSP, return contract, The Club as preview, layer cache, health identity, `browser:release` | `e3e4eaf` |
| 3 | `/api/health` reports the build's profile (found by the local round trip) | `9719b6b` |
| 4 | Hosting decision (PROPOSED), staging → production workflow, M1 → M4 integration sequence, contract docs | `4cdd0b4` |
| 5 | `NRVNA_WEB_PAGES` interim flag, `media-in-gated-chunk`, `verify` script, hosting contract rewrite, Landmark, D-022 / D-023 PROPOSED | `063d5e3` |
| 6 | Portable Blender export OS-independent → hosted CI green again | `671ea46` |
| 7 | Visitors never see milestone markers in descriptions | `e75a7ad` |
| 8 | `browser:release` `BASE_HEADER` for login-protected staging | `462c64d` |
| 9 | Campaign record; upstream candidate `contrib/rigidbody-teleport-interpolation` (`c6160e7`, engine fix + test, no PR); final verification; handoff | `fd61e25`, final commit |

## 2. Findings worth keeping

1. **Hub-arrival fall — ROOT CAUSE PROVEN, FIXED.** The engine renders the PLAYER body at `lerp(previous, current, α)`; `teleport()` resets only the current pose; physics is inactive until `space.start()`, so after the hidden placement teleport the previous pose is still the boot pose (y = 0). A first live physics update shorter than 1/60 s runs zero fixed steps, the interpolation writes `lerp(0, 141, α)` into the avatar, and the Mover's ground-sync probe after `reset()` restores the body to that component position → committed below the 0.5 m deck → falls into The City. Evidence: forced 16 ms first physics update → **4 / 4 falls at y = 135.36** (= 0.96 × 141; the M3 failure signature was 134.5–135.5); after the fix, same injection at 16 ms and 5 ms → **0 / 12**, and `browser:release` check A repeats it on every run. Natural first-frame dt on this PC: 17–34 ms — right at the threshold, hence intermittent and load-sensitive. Under a bounded CPU load (4 of 8 threads at 80 %): M3 **0 / 24** falls but **24 / 24 loads in the hazardous state** (previous pose = stale boot pose at the start), M4 **0 / 24** falls and **0 / 24** in that state. Not claimed "fixed because it stopped reproducing": the claim rests on the deterministic injection and the observed state. Travel teleports while running were already safe (zero-step frame injected after a travel teleport: 3 / 3 exact — the character controller moves from the raw Rapier translation). Upstream candidate (not opened): `RapierRigidBody.teleport()` should reset the previous pose itself. Tools: `D:\AWE-Scratch\m4\tools\hub-fall-hz.mjs` (`INJECT_DT`, `UNCAPPED`), `travel-inject.mjs`, `cpu-load.mjs`.
2. **`/web-context/<gated id>` published an overview** (WEB v0.5 finding): now generated only for public, ungated destinations (gated ids 404, the in-world window never opens for them); panels `noindex` with the website page as canonical. No in-world threshold points at a gated id (tested).
3. **The world was indexable by default** (no robots policy). Now `noindex` everywhere (header + robots.txt + meta) unless a production build sets `NRVNA_ALLOW_INDEXING=true`; even then the machine surfaces are never indexed. Next's `/:path*` source does **not** match `/` with its strict matcher — the all-paths rules use `/(.*)` (caught by the route-matching test before a server ever ran).
4. **The engine fetches GPU benchmark tables from `unpkg.com`** on every boot (`getGPUTier()` default URL) — found when the first CSP blocked it. Allowed for `connect-src` only; together with `cdn.oncyber.xyz` and `cyber.mypinata.cloud` it is a third-party runtime dependency (launch risk; self-hosting needs a rights check + an engine option).
5. **`/api/health` read the runtime environment, not the build** (a `local` build under plain `next start` said `production`) — fixed; health now reports the inlined profile / indexing / web-pages flags.
6. **Hosted CI had failed on every push since M3**: `authoring-importer.test.ts:170` used the running OS's `node:path` on a Windows Blender path, so on Linux the basename was never split. Fixed in `portable-export.mjs` (`path.win32` / `path.posix` by the path's own shape); first green hosted run `671ea46` (all 12 steps executed, 57 s). Per Key's CI guardrails this was a real test failure, not billing.
7. **The live website has no `/worlds/<slug>` pages** (404 on Wix): an early world launch must build with `NRVNA_WEB_PAGES=0` (all world → web links go to the root); `CHECK_WEB_LINKS=1` in the production smoke proves the state. A profile-level default was rejected because it would break the WEB repo's own harness (which models the post-cut-over world).
8. **Visitors saw "M0 placeholder." in the destination card** — display-only `presentDescription()` with the WEB's exact rule.
9. **Gated chunks could carry media by URL** without an `assetRef` — new canonical code `media-in-gated-chunk`.
10. **Perf A/B on the same PC, same day (M4 vs M3 head `e1662b7`)**: identical 113 / 105 draw calls and 175 k / 173 k triangles desktop / mobile, ≈ 56 fps both (p95 18.1 ms), heap 46 MB vs 45–46 MB desktop, 59 MB both mobile; cold transfer +0.05 MB (headers, policy code). The recorded M3 "60 fps / 46 MB" were a different day's machine state. No regression.
11. **Next serves the prerendered HTML with `s-maxage=31536000`** — fine on Vercel (purged per deploy), wrong behind a generic CDN; documented.
12. **R2 custom domain needs the zone on Cloudflare** — `assets.nrvnaverse.com` is not available while DNS stays at Wix; decide with the first production art.

## 3. Verification (final numbers in `handoffs/current/reviewer.md`)

App vitest 598, manifest 65, `tsc` + strict, `spatial:check`, `generate:check`, release build; `browser:release` (default, staging, local, indexable-production, `NRVNA_WEB_PAGES=0`, through a header-counting proxy), `browser:perf` (+ A/B vs M3), `browser:touch`, `browser:camera`, `browser:gallery`; local origin round trip world(:3100) → web(:3000); fault-injected and loaded Hub arrivals; hosted CI green.

## 4. Continuation queue

1. Owner decisions: host (D-022), release branch (D-023), staging hostnames, indexing, `NRVNA_WEB_PAGES` at launch, third-party runtime origins.
2. Owner authorization → fast-forward `nrvna/integration` (`NRVNAVERSE_INTEGRATION_M1_M4.md`).
3. Upstream candidate (`contrib/*`, not opened): `teleport()` resets the previous interpolation pose; a configurable GPU-benchmark URL.
4. Real-device pass (iOS Safari / Android Chrome) on staging.
5. WEB side (WEB repo's own task): a build-time world origin for its staging; optionally `return=<own id>` on destination pages.

## 5. Exact next action

Done: final verification green (`verify` 598 + 65, all five browser probes on the final build), handoff written, `NEXT: CHATGPT`. Stop at this review boundary; continuation queue §4 needs owner / reviewer decisions.
