# NRVNAVerse Developer & Agent Governance

Applies to every human developer and every AI coding session (Claude Code or otherwise) working in `NRVNAVerse/awe` or any NRVNAVerse repository that references this file.

Upstream AWE guidance in `CLAUDE.md` (project overview, kebab-case rule, `/engine`, `/run-space`, `/game-prd` skills, examples) remains in force and is intentionally preserved verbatim above the NRVNAVerse section. This document adds NRVNAVerse rules; it does not replace upstream rules.

## Required reading

| When | Read |
|---|---|
| Before substantial NRVNAVerse work | [`NRVNAVERSE_LANDMARK.md`](./NRVNAVERSE_LANDMARK.md) — locked principles, verified baseline, current risks |
| When an architectural or product decision matters | [`DECISIONS.md`](./DECISIONS.md) — decision log with stable IDs |
| Before engine, editor or tools changes | upstream `CLAUDE.md`, `CONTRIBUTING.md`, `packages/tools/AGENT.md`, `.claude/skills/*` |

## Rules

1. **Read the Landmark first.** Substantial NRVNAVerse work starts by reading `docs/NRVNAVERSE_LANDMARK.md`.
2. **Consult the Decision Log** whenever a change touches architecture, data models, domains, identity, gating, districts, commerce, mobile strategy or the AWE relationship.
3. **Never silently contradict a locked principle.** Locked principles are marked `[LOCKED]` in the Landmark and listed under "Do Not Accidentally Change".
4. **Surface conflicts before implementing.** If a requested change contradicts the Landmark or a decision, stop, state the conflict plainly, and propose either (a) a compliant alternative or (b) a new `DECISIONS.md` entry that supersedes the prior decision. Do not implement the contradiction while the conflict is unresolved.
5. **Label claims.** Distinguish **VERIFIED** (read in code/Git or executed), **EXPERIMENTAL** (exists but unreviewed/untested), **PLANNED** (designed, scheduled), and **ASPIRATIONAL** (long-term direction). Do not let planned or aspirational features appear as current functionality in docs, commit messages, or summaries.
6. **Ghost's experimental code is not production-ready.** Anything from `Gh0sTtD3v/awe` (`ghost/experimental` branch, `apps/ghostt/`, chunk manager, portal component, info-cards, studio chunk/roles services) is EXPERIMENTAL until reviewed and tested. Do not split, rewrite or publish refactors of his commits without his review.
7. **No upstream pull requests without explicit authorization.** Preparing an upstream-candidate branch is fine; opening a PR on `oncyberio/awe` requires a named human's explicit go-ahead in the session.
8. **No production changes without explicit authorization.** This includes the production Wix site (`www.nrvnaverse.com`), DNS/domains, any deployment or hosting change, and any commerce configuration. "Read-only" investigation is allowed; writes are not, unless explicitly authorised for that specific action.
9. **Automate the repetitive; review the judgement calls.** Prefer scripts/tooling for repetitive content and scene assembly (asset optimization, manifest generation, portal indexes, info cards, page data). Product, design, brand, compliance and world-layout decisions require human review.
10. **Preserve upstream compatibility.** Keep engine/editor/tools changes generic, topical and rebase-friendly against `upstream/main`. NRVNAVerse-specific behaviour lives in `apps/*` and `packages/nrvna-*`, or is injected via configuration, data and `externalApi`.

## Branch model (foundation)

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Clean, upstream-compatible base tracking `upstream/main` | Fast-forward from `upstream/main` only; no NRVNAVerse commits |
| `ghost/experimental` | Faithful preservation of Ghost's work (`Gh0sTtD3v/awe@main`) | No rewrites, no splits, no force-pushes; updates only by fetching from the `ghost` remote |
| `nrvna/integration` | NRVNAVerse integration/development line | Where docs, apps and packages land; periodically rebased/merged with `main` |
| `feat/*` | NRVNAVerse feature branches | Branch from and PR into `nrvna/integration` |
| `contrib/*` (see note) | Generalized AWE improvements intended for upstream | Generic, unbranded, tested; opened upstream only with authorization |

Note on naming: the planning documents called the last family `upstream/*`. Because this repository has a Git remote named `upstream`, local branches named `upstream/<x>` collide visually (and, for `upstream/main`, literally) with remote-tracking refs `upstream/<x>`. Use `contrib/*` for upstream-candidate branches instead. The same reasoning applies to `ghost/*`: `ghost/experimental` is safe because the remote only exposes `ghost/main`, but never create a local branch named `ghost/main`.

## Remotes

| Remote | URL |
|---|---|
| `origin` | https://github.com/NRVNAVerse/awe |
| `upstream` | https://github.com/oncyberio/awe |
| `ghost` | https://github.com/Gh0sTtD3v/awe |

## Landmark versioning

See "Landmark Versioning Rule" in `NRVNAVERSE_LANDMARK.md`. The Landmark is a living benchmark; Git history holds static versions; increment only at milestones; implementation never silently redefines it.

## Commit attribution

Commits and PRs created with AI assistance carry the attribution line configured for the session (e.g. `Co-Authored-By: Claude …`). Ghost's authorship on his commits is preserved as-is.
