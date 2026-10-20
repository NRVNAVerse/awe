# NRVNAVerse M4 — integration, reliability, safety and hosting readiness — campaign record

Compact, restartable record for the M4 run on `feat/m4-integration-hosting-readiness`. Read this first after a compaction or restart; then `handoffs/current/reviewer.md`. Not a transcript.

| Field | Value |
|---|---|
| **Objective** | Prepare and locally verify a deployment-ready candidate: integration sequence M1 → M2 → M3 → M4, Hub-arrival reliability, indexing / privacy safety, WEB ↔ WORLD return contract with an allowlisted preview origin, a hosting decision record, a staging → production workflow, release verification |
| **Branch** | `feat/m4-integration-hosting-readiness`, from `e1662b7` (= `origin/feat/m3-blender-camera-foundation`). Not merged, not deployed |
| **Session** | Claude Code, Opus 5.5, Auto, 2026-10-19 (PDT), overnight protocol (`TheCannaMan/Key@43c18e4` `OVERNIGHT_RUNS.md`) |
| **Authority** | Prepare and verify locally only. **Not authorized:** merging / advancing `nrvna/integration`, `main` or any protected branch; deploying; DNS; publishing content; creating paid infrastructure or accounts; incurring charges; changing NRVNAVerse WEB, Key, the knowledge core, HVC, NIC or SIC |
| **Guidance read** | Operating Guide, Governance, Landmark, DECISIONS (D-001–D-021), M1 / M2 / M3 campaign records + handoffs, hosting / manifest / runtime docs; Key `OVERNIGHT_RUNS.md`, `CHATGPT_CLAUDE_ONE_PASTE_HANDOFF.md`, `GITHUB_BILLING_AND_CI_GUARDRAILS.md`; WEB `feat/web-world-integration-v05@d7caa64` (read-only): `AWE_INTEGRATION_PROPOSAL.md`, `WEB_SPATIAL_CONTRACT.md`, `DEPLOYMENT.md`, `WORLD_HARNESS.md` |

## 0. Recovered state (VERIFIED 2026-10-19)

- Ancestry is one straight line: `origin/main` `04a07c8` ⊂ `origin/nrvna/integration` `19562bc` ⊂ M1 `ecda29f` ⊂ M2 `7a93c08` ⊂ M3 `e1662b7` = this branch's base (`git merge-base --is-ancestor` for every pair). Every step is a fast-forward.
- Baseline on `e1662b7`: 572 app tests, 61 manifest tests, `check` (tsc + strict) green.
- `nrvnaverse.com` DNS is hosted by Wix (`ns14/ns15.wixdns.net`); `www` is the live Wix site; `worlds.nrvnaverse.com` does not resolve.
- The runtime loads the avatar VRM, animation set and terrain textures from third-party origins (`cdn.oncyber.xyz`, `cyber.mypinata.cloud`) referenced by the generated global scene.

## 1. Checkpoints

| # | What | Commit |
|---|---|---|
| 0–1 | Campaign record, recovered state; Hub-arrival fall: root cause proven by fault injection, fixed in the runtime (`settleTeleportInterpolation`), model test | `6788d0f` |

## 2. Findings worth keeping

1. **Hub-arrival fall — ROOT CAUSE PROVEN.** The engine interpolates the PLAYER body between its previous and current physics pose each rendered frame; `RapierRigidBody.teleport()` resets only the current pose, and the previous pose is refreshed only at the start of a fixed step. Physics is inactive until `space.start()` (GAME_START), so after the hidden placement teleport the previous pose is still the boot pose (y = 0) and the current pose the deck spawn (y = 141). If the first live physics update is shorter than one fixed step (1/60 s), zero steps run, `_interpolatePose(α)` writes `lerp(0, 141, α)` into the avatar, and the Mover's ground-sync probe after `reset()` restores the body to that component position — the visitor is committed below the 0.5 m deck and falls into The City. **Fault injection** (first physics update forced to 16 ms, an ordinary 60 Hz frame): **4 / 4 falls**, y = 135.36 = 0.96 × 141 — the M3 failure signature (134.5–135.5 at `ready`). Without injection the first post-reveal frame is long (40–500 ms: first render of the revealed world), which is why it was rare; any machine whose first live frame is short (lightly loaded GPU, high-refresh display) is exposed. Travel teleports while running are NOT affected (the character controller moves from the raw Rapier translation; probed with a zero-step frame after the travel teleport: 3 / 3 exact). **Fix:** after the official teleport, `settleTeleportInterpolation()` copies the current pose into the previous one (the engine's own `_preInterpolate`, feature-checked). With the fix, same injection: **0 / 12** (16 ms and 5 ms). Tools: `D:\AWE-Scratch\m4\tools\hub-fall-hz.mjs` (`INJECT_DT`, `UNCAPPED`), `travel-inject.mjs`. Upstream candidate: `teleport()` should reset the previous pose itself (engine, `contrib/*`, not opened).

## 3. Continuation queue

1. Indexing / privacy safety: robots policy, `noindex` everywhere except an explicit production opt-in, gated `/web-context` not served, security headers, CSP verified in the browser.
2. Return contract: `return` preserved through in-world travel and handoffs; allowlisted, build-time web / world origins for staging; contract docs corrected.
3. The Club as a playable preview without misusing `placeholder`.
4. Hub-arrival fall: code-level analysis of first-frame collider / avatar state, then a deterministic fault-injection test; fix only a proven cause.
5. Hosting decision record + staging / production workflow + integration sequence.
6. Release verification (tests, typecheck, spatial checks, production build, browser probes desktop + phone, repeated Hub loads, WEB ↔ WORLD, age gate, indexing / headers).

## 4. Exact next action

Mission 3 (indexing / privacy) implementation.
