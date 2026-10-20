# Integration sequence M1 → M2 → M3 → M4 into `nrvna/integration`

| Field | Value |
|---|---|
| **Status** | **PREPARED, NOT EXECUTED** (M4, 2026-10-19). Advancing `nrvna/integration` requires explicit owner authorization for each push (Governance branch model, Operating Guide §13). Nothing here has been run against the remote |
| **Topology (VERIFIED 2026-10-19)** | one straight line — every step is a fast-forward, no merge commits, no conflicts |

| Step | Branch | Head | Parent line | Adds (product) |
|---|---|---|---|---|
| R0 | `nrvna/integration` (today) | `19562bc` | `main` `04a07c8` + 49 | M0 + M1.1 checkpoint, 7 destinations |
| 1 | `feat/m1-spatial-experience-overnight` | `ecda29f` | R0 + 20 | composed Hub / Music / Fashion, The Club `dst_gqq90k2404cy9nf0` |
| 2 | `feat/m2-megacity-foundation` | `7a93c08` | 1 + 18 | floating Hub over The City `dst_8w1j39h5e0ezrsjh`, streaming cells, the Drop, sky lifts |
| 3 | `feat/m3-blender-camera-foundation` | `e1662b7` | 2 + 9 | camera toggle, Blender authoring contract, Gallery One `dst_3kacg0rqgyfnp7fm` |
| 4 | `feat/m4-integration-hosting-readiness` | *final M4 SHA in `handoffs/current/reviewer.md`* | 3 + M4 | Hub-arrival fix, indexing / privacy, return contract, deployment profiles, The Club as preview, release probe, hosting docs |

Provisional owner rulings carried by M4 (brief of 2026-10-19): The Club keeps its id and is a **playable preview** (M4 tags it `preview`; the WEB shows "In development · Preview open"); The City keeps name, slug `city`, id, the floating-Hub layout and its expansion architecture; Gallery One keeps its id as a fixture, placement and architecture editable.

## Preconditions (all steps)

1. Owner authorization for the specific push (`nrvna/integration` → the step's SHA).
2. Clean working tree; `git -c http.sslBackend=schannel fetch origin` (this PC); the heads above still match `git rev-parse origin/<branch>` — **if any differs, STOP and report** (Operating Guide §8.1).
3. Independent review done for the step's branch (the M1–M3 handoffs each await it; M4's handoff lists its evidence).

## Commands (PowerShell, Windows 5.1 — `;` chaining)

```powershell
Set-Location D:\AWE\awe
git status                                   # must be clean
git -c http.sslBackend=schannel fetch origin
git checkout nrvna/integration
git pull --ff-only origin nrvna/integration
git rev-parse HEAD                           # expect 19562bc… (R0)

# Rollback anchors (local tags, push only if asked)
git tag nrvna/pre-m1 19562bc

# Step 1 — M1
git merge-base --is-ancestor HEAD origin/feat/m1-spatial-experience-overnight; if ($?) { git merge --ff-only origin/feat/m1-spatial-experience-overnight }
git rev-parse HEAD                           # expect ecda29f…
#   verify (below), then, with authorization:
git -c http.sslBackend=schannel push origin nrvna/integration

# Step 2 — M2 (same pattern)
git merge --ff-only origin/feat/m2-megacity-foundation      # expect 7a93c08…
# Step 3 — M3
git merge --ff-only origin/feat/m3-blender-camera-foundation  # expect e1662b7…
# Step 4 — M4
git merge --ff-only origin/feat/m4-integration-hosting-readiness  # expect the final M4 SHA
```

`git merge --ff-only` refuses anything that is not a fast-forward, so a moved branch can never be merged by accident.

## Verification at each stop

Install once per checkout: `pnpm install --frozen-lockfile` (stop and report if it wants to change the lockfile, D-014).

| Check | Step 1 (M1) | Step 2 (M2) | Step 3 (M3) | Step 4 (M4) |
|---|---|---|---|---|
| `pnpm --filter @nrvnaverse/manifest test` + `generate:check` | ✓ | ✓ | ✓ (61 tests at `e1662b7`) | ✓ (65) |
| `pnpm --filter the-nrvnaverse check` + `test` | ✓ | ✓ | ✓ (572) | ✓ (see handoff) |
| `spatial:check` (+ `compose --check` from M3) | ✓ | ✓ | ✓ | ✓ |
| `pnpm --filter the-nrvnaverse build` (fail-closed) | ✓ | ✓ | ✓ | ✓ |
| Browser probes on the production build | `browser:touch`, `browser:perf` | + same | + `browser:camera`, `browser:gallery` | + **`browser:release`** |
| CI on the pushed head | green | green | green | green |

**Expected, not a regression:** steps 1–3 still contain the intermittent Hub-arrival fall (present since M2, fixed only in M4). A `browser:touch` check-C failure at those stops, with the avatar falling right after the page opens, is that defect — rerun once; step 4 removes it (fault-injection check A in `browser:release`).

Recommended shortcut if the owner accepts M4 as a whole: authorize a single fast-forward `19562bc → <M4 SHA>` and verify once at step 4 (the intermediate heads are contained). The staged sequence exists for reviewers who want to accept each milestone on its own.

## Rollback points

- Before the first push: nothing to undo (`git reset --hard nrvna/pre-m1` locally).
- After a push: each stop's previous head (`19562bc`, `ecda29f`, `7a93c08`, `e1662b7`) is a rollback point. Moving the shared branch **back** is a history rewrite (`git push --force-with-lease origin <sha>:nrvna/integration`) and needs its own explicit authorization; the normal correction is `git revert` on top. Never squash or rebase the accepted commits.
- The WEB stays pinned to `nrvna/integration@19562bc` until its own promotion steps (WEB `docs/AWE_INTEGRATION_PROPOSAL.md`); advancing AWE does not change the website by itself.

## After step 4 — WEB promotion (WEB repo, read-only reference)

On a WEB branch: `pnpm destinations:compat --ref nrvna/integration` (no blockers expected; The Club now reads "In development"), `pnpm destinations:sync --ref nrvna/integration`, the follow-up edits listed in WEB `docs/AWE_INTEGRATION_PROPOSAL.md` (empty `PENDING_CANONICAL`, remove the `the-club` programme entry, counts in `test/model.test.ts` — with The Club as a preview the "previews" count is one higher than that document's M3 estimate), `pnpm verify`, then the WEB ↔ WORLD harness.
