# Reviewer Handoff — M1 Spatial Experience Overnight Campaign

## Baton

NEXT: CLAUDE  
LAST: CHATGPT  
STATE: READY_FOR_LONG_UNATTENDED_CAMPAIGN  
SESSION: NEW  
MODEL: Fable 5.1  
EFFORT: High  
MODE: Auto

## Campaign identity

- Repository: `NRVNAVerse/awe`
- Branch: `feat/m1-spatial-experience-overnight`
- Starting creative checkpoint: `feat/m1-spatial-creative-overnight@1ac17409da4928cca80e513d4e2f8bbd98f3be51`
- Product-direction docs carried onto this branch: D-017–D-021 + `docs/NRVNAVERSE_VENUES_EVENTS_WEB_SPATIAL.md`
- Key operating standard to read: `TheCannaMan/Key@main`, especially `OVERNIGHT_RUNS.md`, `CLAUDE_MODEL_ROUTING.md`, and `AI_REPOSITORY_HANDOFF_STRATEGY.md`
- Key main observed by planner: `6ad778f5c51e5af6d9c103498a7e5eccb9915095`
- GitHub Actions constraint: Key currently records 2,000 / 2,000 included hosted Actions minutes used. Hosted Actions must NOT be a completion dependency for this campaign.

## Operator window

The operator expects to start the run around 11 PM and may not return until roughly 4 PM the following day.

Treat this as an **8+ hour long unattended development campaign**, not a single milestone. Do not wait merely to consume time, but do not enter final closeout after the first early success if valuable safe work remains.

At every clean checkpoint ask:

> What is the next highest-value SAFE improvement I can make without owner input?

Then continue.

## Owner reaction to current checkpoint

The owner has personally reviewed the current direction and said the work so far is **great** and that the concepts are landing.

Do not redesign the M1 creative checkpoint from scratch.

Preserve and deepen its thesis:
- Hub as an authored arrival/return place, not a portal diagram;
- Music and Fashion as real spatial experiences;
- vertical exploration;
- optional discovery;
- routes that reward curiosity;
- premium restrained visual language;
- no generic crypto/metaverse aesthetic.

The next campaign should move from **spatial composition → spatial experience**.

## Campaign objective

Make THE NRVNAVerse feel meaningfully more **alive, usable, reactive and return-worthy** while proving the next product architecture for:

1. a reusable Music venue/concourse system;
2. deeper experiential behavior in the Hub/Music/Fashion spaces;
3. contextual WEB↔SPATIAL seams;
4. targeted use/evaluation of the owner's real asset vault;
5. cross-surface discovery concepts where they can be prototyped safely;
6. durable architecture that remains compatible with future real art and event systems.

The goal is not maximum square footage or feature count.

Prefer:
- depth;
- behavior;
- iteration from evidence;
- atmosphere;
- meaningful transitions;
- usable spaces;
- real asset evaluation;
- discovery;
- polish.

## Required reading before substantial edits

Read in this repository:

1. `docs/NRVNAVERSE_OPERATING_GUIDE.md`
2. `docs/NRVNAVERSE_LANDMARK.md`
3. `docs/DECISIONS.md`
4. `docs/NRVNAVERSE_GOVERNANCE.md`
5. `docs/NRVNAVERSE_M1_CREATIVE_PROGRESS.md`
6. `docs/NRVNAVERSE_HUB_WORLD.md`
7. `docs/NRVNAVERSE_VENUES_EVENTS_WEB_SPATIAL.md`
8. relevant spatial runtime / manifest / data-pipeline docs.

Read current Key `main` if available:
- `README.md`
- `OVERNIGHT_RUNS.md`
- `CLAUDE_MODEL_ROUTING.md`
- `AI_REPOSITORY_HANDOFF_STRATEGY.md`

Read-only references as needed:
- `TheCannaMan/awe` — generic AWE capability discovery only;
- `TheCannaMan/awe-creature-lab` / Glasshollow — experience-design lessons only;
- `TheCannaMan/awe-game-lab` — experience / level-design lessons only;
- `TheCannaMan/spatial-intelligence-core` — consume SIC as a tool; do not develop SIC core here.

Do not modify those repositories.

## SIC and asset vault

Expected SIC:
`C:\Dev\spatial-intelligence-core`

Expected owner asset vault:
`D:\AWE-Vault`

Use SIC heavily where it creates evidence:
- spatial measurement;
- candidate placement;
- navigation / clearance;
- sightlines;
- visibility;
- asset inspection;
- render evidence;
- before/after verification.

The vault is source material, NOT the workspace.

Allowed:
- targeted search after a spatial/product need is defined;
- use existing Vault Organizer metadata read-only;
- copy candidates into scratch/gitignored work areas;
- inspect/optimize derivative copies;
- locally audition models;
- document strong candidates.

Forbidden:
- rename/move/delete/reorganize originals;
- bulk dedupe/catalog work;
- mutate Vault Organizer output;
- claim unproven rights;
- upload/publish externally;
- commit binaries contrary to the existing production asset policy.

Rights/provenance should be labelled:
CLEARED / LIKELY NEEDS REVIEW / UNKNOWN / RESTRICTED.

Unknown-rights assets may be used for local private audition on copies, but not published as production art.

## Priority product direction

### A. Music = reusable multi-venue complex

D-017 through D-019 are accepted direction.

Do not treat Music as one permanent concert hall.

Evolve it toward:
- a common entry/lobby/concourse;
- independently loadable venue/room experiences;
- a curated stage library;
- stable venue/room identity;
- future event assignment;
- future “Select Your Stage”.

The owner says the vault contains several concert-hall / stage environments.

Search the vault intentionally for strong venue candidates.

Do NOT build a full event-management backend tonight.

A useful overnight proof may include one or more of:
- a convincing venue-concourse spatial prototype;
- venue-door/room routing semantics;
- one alternate venue-room proof;
- template/room metadata scaffolding that is clearly product-layer and reversible;
- a local/config-driven “select stage” proof;
- a venue asset audition report with top candidates.

Choose the strongest evidence-backed path after inspecting the current architecture.

### B. Existing districts should behave, not merely exist

The current Hub, Music and Fashion geometry is a foundation.

Seek opportunities for:
- proximity/reactive environmental beats;
- staged arrival/return moments;
- lighting/glow/material state changes using capabilities actually available;
- meaningful spatial interactions;
- stronger transitions;
- optional secondary routes;
- multi-step clues;
- quiet/social observation places;
- spaces that reveal more on a second pass.

Do not add HUD quests merely to create activity.

Favor environmental and spatial interaction.

### C. WEB ↔ SPATIAL seam

D-020 / D-021 are accepted product direction.

Investigate and, if the current app architecture supports it safely, prototype a **small contextual web-surface/threshold proof**.

Examples:
- a spatial “window” exposing canonical destination/event web context;
- a threshold that takes a visitor to the relevant web destination with explicit return context;
- a local UI surface driven by canonical manifest/web metadata;
- another lightweight proof that does not rebuild the whole website inside AWE.

Do NOT modify `NRVNAVerse/web` in this campaign.

Do NOT invent a cross-origin auth/token scheme.

Do NOT depend on production deployment.

If iframe/browser/CSP constraints make a true embedded page inappropriate, choose a safer application-owned prototype and document the real limitation rather than forcing it.

### D. Cross-surface discovery

It is acceptable to prototype one harmless cross-surface discovery mechanic if it fits naturally.

Examples:
- a spatial clue revealing a special web-path concept;
- a web-context window containing a clue that points back into the world;
- an optional secret whose architecture clearly supports a future web counterpart.

Do not put sensitive, restricted or age-gated content behind obscurity.

Do not modify the actual web repository merely to prove the idea.

### E. Real asset evaluation

Use the owner's vault to improve visual/product decisions.

Do not browse aimlessly.

For each target role:
1. define what the space needs;
2. search a bounded candidate set;
3. inspect serious candidates;
4. reject unsuitable assets quickly;
5. use SIC/render evidence on finalists;
6. document whether the candidate should be:
   - use as-is later;
   - optimize/derive;
   - extract inspiration only;
   - reject.

Prioritize concert/venue/stage assets because they directly support the newly accepted product direction.

## Suggested campaign phases

These are a queue, not a rigid recipe.

### Phase 1 — recover, measure, choose (early)

- verify branch/worktree clean;
- inspect current M1 world in code/browser;
- read the accepted venue/web-spatial decisions;
- re-establish SIC connection and vault availability;
- inspect current runtime capabilities needed for interaction/reactivity;
- create/update a durable campaign progress file;
- pick the highest-value first experience slice.

Checkpoint and push.

### Phase 2 — deepen the core experience

Implement the strongest experience-layer improvement that makes the existing world feel alive.

Likely focus:
- Hub arrival/return behavior and/or
- Music experiential behavior.

Build → targeted verify → continue.

Checkpoint and push.

### Phase 3 — venue system proof

Advance Music toward the multi-venue/concourse model.

Prove enough architecture/UX to learn something real without building the generalized event backend.

Use targeted vault/SIC venue evaluation.

Checkpoint and push.

### Phase 4 — WEB↔SPATIAL seam proof

Prototype one safe contextual transition/window mechanism if technically viable.

Preserve canonical web ownership and explicit return context.

If blocked by real browser/CSP/runtime limitations, document the finding and move to the next queue item rather than spending hours forcing it.

Checkpoint and push.

### Phase 5 — deeper discovery / second-pass value

Improve at least one area so a returning/exploring visitor can discover something more than on the first pass.

Possible mechanisms:
- layered clue;
- reactive state;
- alternate route;
- environment change;
- spatially revealed context.

Avoid gamification for its own sake.

Checkpoint and push.

### Phase 6 — iterate from evidence

Walk/render/test what was built.

Revisit weak areas.

Prefer a second polish/behavior pass on strong systems over creating several shallow new areas.

If the new systems make Fashion clearly lag behind, bring Fashion up to the same experience quality where feasible.

### Phase 7 — convergence

In the final portion of the available useful window:
- stop beginning risky large systems;
- close partial work;
- run broader local verification;
- capture representative browser screenshots/evidence;
- measure performance;
- verify age-gate invariants;
- update durable docs/handoff;
- commit/push a clean checkpoint.

## Continuation queue if early milestones finish quickly

If the first 2–3 milestones finish in under ~3 hours, continue with the highest-value safe items from this queue:

1. second iteration on Music venue/concourse UX;
2. second strong venue asset audition / local proof;
3. deepen Hub return behavior;
4. improve Fashion experiential parity;
5. improve web-surface/return-context prototype;
6. add a second-layer optional discovery;
7. improve transitions between spatial areas;
8. targeted performance consolidation/batching if measurement shows a real need;
9. improve mobile/touch comfort for newly added interactions;
10. improve authoring/config structure so future venues/events are cheap to add;
11. produce stronger browser/render evidence and then polish the weakest visible area.

Do NOT fill remaining time with:
- repeated broad audits;
- repeated green tests;
- speculative backend architecture;
- arbitrary new districts;
- unrelated generic AWE core development;
- SIC core development;
- production infrastructure setup.

## GitHub Actions quota rule

Key currently records hosted Actions capacity as exhausted.

Therefore:

- pushing feature-branch checkpoints is still allowed;
- do not wait for Actions;
- do not repeatedly rerun blocked workflows;
- do not treat a runnerless workflow failure as a product regression;
- local tests/build/browser/SIC evidence are the working verification for this feature campaign;
- if integration policy later requires CI, record it as **pending due to Actions quota**;
- do not merge into `nrvna/integration` tonight.

## Verification cadence

Default:

> BUILD → TARGETED VERIFY → CONTINUE

Use focused tests/checks after each coherent change.

Broader local verification belongs at major checkpoints/final convergence.

At minimum before final closeout, if the changed scope warrants it:
- compose/check spatial source;
- spatial validate/generate/check;
- app tests;
- strict typecheck;
- production build;
- browser touch/gate regression;
- browser performance;
- representative screenshots;
- SIC verification on material spatial changes.

Do not rerun the full suite after every tiny change.

## Hard invariants

Do not:
- merge to `nrvna/integration`;
- deploy;
- change DNS;
- configure R2/production credentials;
- publish unknown-rights vault assets;
- weaken or bypass the 21+ gate;
- create cannabis checkout;
- modify generic AWE/SIC/reference repos;
- open upstream AWE PRs;
- silently change stable destination identity;
- turn coordinate/URL/chunk key into identity;
- rebuild the normal website inside AWE;
- build a generalized production event backend;
- invent partner/artist/brand claims.

Cannabis remains outside the creative sandbox except preserving/verifying its boundary.

## Checkpoint / restartability rule

This campaign must survive compaction, model fallback or interruption.

Maintain a compact durable progress file, preferably:

`docs/NRVNAVERSE_M1_EXPERIENCE_CAMPAIGN.md`

Keep it current with:
- campaign objective;
- branch/SHA;
- completed checkpoints;
- evidence already run;
- important findings;
- continuation queue;
- exact next action.

Commit/push meaningful checkpoints.

Before a long render/build/browser verification stage, checkpoint valuable completed implementation first.

**Compaction is not campaign completion.**

If the environment automatically falls back from Fable to another capable model, continue from repository evidence when safe instead of treating the model change as completion.

## Final handoff

At final convergence report:

1. start SHA;
2. final SHA;
3. commits/checkpoints pushed;
4. approximate campaign wall-clock duration;
5. what materially changed in the visitor experience;
6. what changed in Music venue/concourse architecture;
7. venue assets inspected/auditioned and provenance status;
8. WEB↔SPATIAL proof built or limitation discovered;
9. cross-surface discovery proof, if any;
10. Hub/Music/Fashion experiential changes;
11. SIC evidence used;
12. mobile/touch result;
13. performance result;
14. age-gate result;
15. local tests/builds run;
16. GitHub-hosted CI status explicitly noted as unavailable/pending if still quota-blocked;
17. known defects/limitations;
18. exact playtest path for the owner;
19. what should be built next;
20. whether anything requires an owner decision.

End with:
- working tree state;
- pushed branch state;
- **READY FOR OWNER PLAYTEST / REVIEW** or a precise blocker.

Do not merge.
Do not deploy.
