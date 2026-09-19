# Project Overview

This is a 3D game engine/framework built with Three.js and Next.js. The project uses a pnpm monorepo structure with workspaces.

# Code Style Guide

All files in this mono repo MUST use **kebab-case** naming (eg `editor-events.ts`, `constants.ts`)

# Skills

- `/engine` — oncyber engine API and usage patterns. Use before working on game code.
- `/run-space` — headless engine programs via `pnpm run-space`. Use when exact spatial compute, scene inspection, smoke testing, or procedural generation would help.
- `/game-prd` — create a game spec / PRD before implementation. Use when planning a new game or scoping a game idea.

# Examples

Game examples live in `/examples`. Use them as reference when building games with the engine.

If you are working in a scaffolded repo and `/examples` is not present locally, look up the examples in the scaffold origin repository at `https://github.com/oncyberio/awe`, using the matching path under `/examples`.

# NRVNAVerse Governance

This repository (`NRVNAVerse/awe`) is the NRVNAVerse fork of `oncyberio/awe`. Everything above this heading is upstream AWE guidance and still applies. Before substantial NRVNAVerse work, read `docs/NRVNAVERSE_GOVERNANCE.md`, which requires you to:

1. Read `docs/NRVNAVERSE_LANDMARK.md` before substantial NRVNAVerse work.
2. Read `docs/DECISIONS.md` when architectural or product decisions matter.
3. Never silently contradict a locked principle.
4. Surface a conflict before implementing a contradictory change.
5. Distinguish VERIFIED / EXPERIMENTAL / PLANNED / ASPIRATIONAL.
6. Never describe Ghost's experimental code (`ghost/experimental`, `apps/ghostt`) as production-ready.
7. Never open upstream AWE pull requests without explicit authorization.
8. Never modify production Wix, DNS, deployment, or commerce without explicit authorization.
9. Prefer automation for repetitive content/scene assembly; require human review for product/design decisions.
10. Preserve compatibility with upstream AWE wherever practical.
