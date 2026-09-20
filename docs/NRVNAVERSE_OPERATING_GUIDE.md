# NRVNAVerse Operating Guide

**START HERE.**

This is the project-wide orientation and operating guide for NRVNAVerse. It is written for Nic (the human owner), the planning/review AI, Claude Code, Codex, any future AI agent, and any human developer who enters the repository cold — possibly months from now, possibly with no chat history at all.

| This document **owns** | This document deliberately does **not** own |
|---|---|
| What NRVNAVerse is and what it is trying to achieve | The *current* implementation state → [`NRVNAVERSE_LANDMARK.md`](./NRVNAVERSE_LANDMARK.md) |
| Cross-cutting strategy approved by the owner | Locked product/architecture decisions → [`DECISIONS.md`](./DECISIONS.md) |
| Which document is authoritative for which subject (source precedence) | Process rules, authority, branch policy, upstream/Ghost boundaries → [`NRVNAVERSE_GOVERNANCE.md`](./NRVNAVERSE_GOVERNANCE.md) |
| How Nic, the planning/review AI and the implementation agent work together | Implementation contracts → the domain documents listed in [§4](#4-document-map) |
| Session, model, mode, push and review conventions for Claude tasks | Generic AWE capability details → the [`TheCannaMan/awe`](https://github.com/TheCannaMan/awe) repository and its own READMEs / skills |
| Which decisions need a human and which are routine | Exact SHAs, test counts, hashes, ports, timings, today's next task ([§17](#17-what-must-not-live-here)) |
| How to recover project state without chat memory | |
| How the related AWE repositories fit into planning | |

It routes readers to authoritative sources; it does not replace them. It should survive many milestones without needing edits.

---

## 1. If you are starting cold

**IF YOU ARE A NEW AI OR DEVELOPER STARTING COLD:**

1. Read this guide.
2. Read [`NRVNAVERSE_LANDMARK.md`](./NRVNAVERSE_LANDMARK.md) — locked principles, verified baseline, current milestone state, current risks.
3. Read [`DECISIONS.md`](./DECISIONS.md) — accepted decisions with stable IDs (`D-xxx`).
4. Read [`NRVNAVERSE_GOVERNANCE.md`](./NRVNAVERSE_GOVERNANCE.md) — rules, branch model, remotes, toolchain, Ghost boundary.
5. Read the domain document relevant to the task ([§4](#4-document-map)).
6. Inspect the actual Git state: `git status`, `git branch -vv`, `git remote -v`, `git log --oneline -20`. Install only per the toolchain rule (Governance / D-014: Corepack-provided pnpm, `pnpm install --frozen-lockfile`, never repair the lockfile as a side effect).
7. Verify implementation reality in code before proposing any change. Implementation reality outranks stale prose.
8. If the task concerns a **generic AWE capability**, inspect the current pushed `main` of `TheCannaMan/awe` first ([§6](#6-capability-aware-planning)).
9. If the task materially overlaps **Ghost's** work, inspect the Ghost reference read-only and respect Governance rule 6 / D-013.
10. Classify the task: audit / planning (read-only) vs implementation.
11. Work on the correct branch ([§13](#13-integration-model)).
12. Return evidence for independent review ([§12](#12-independent-review-rule)).

**Do not reconstruct missing project history by guessing.** Git history, the Landmark and the decision log are the durable memory. If something is not recorded there and cannot be verified in code, treat it as unknown and say so.

---

## 2. What NRVNAVerse is

### 2.1 Product identity

NRVNAVerse is the technology / digital-culture arm of the broader NRVNA ecosystem. The long-term product is a connected digital ecosystem combining **entertainment, education, discovery, commerce, interactive / spatial experiences, and brand / creator connection** (Landmark §1, locked).

A central objective is to give strong brands and creators — especially smaller or emerging ones without large marketing budgets — richer ways to be discovered and experienced. Frame this as **opportunity, discovery, connection, experience and better access to audiences**. Do not frame it publicly as "small brands good / large brands bad".

### 2.2 Web + Spatial: two interfaces, one ecosystem

| Interface | Address | Name | Carries (examples) |
|---|---|---|---|
| **WEB** | `www.nrvnaverse.com` | NRVNAVerse (web) | SEO, conventional web discovery, content, education, services, case studies, commerce, accounts, accessibility, fast / shareable / indexable pages |
| **SPATIAL** | `worlds.nrvnaverse.com` | **THE NRVNAVerse** | persistent explorable destinations, branded worlds, districts, portals, music / fashion / culture experiences, events, social spaces, interactive discovery, contextual commerce links |

They complement each other and share identity, data, analytics, destination concepts and design language where appropriate (D-001, D-003). **Do not put the entire public website inside AWE.** Website architecture beyond what `DECISIONS.md` locks is **PLANNED**, not decided.

### 2.3 AWE relationship

AWE (`oncyberio/awe`, MIT) is the core spatial platform. NRVNAVerse strengthens the AWE ecosystem rather than becoming a closed competitor to it (D-002, D-010). **AWE-first for 3D**; FrameVR is secondary and use-case-specific.

| Generic — keep upstream-friendly where practical | NRVNAVerse owns (application / experience layer) |
|---|---|
| streaming primitives, generic portals / travel, multiplayer / presence, generic social primitives, generic networking, reusable behaviors, authoring infrastructure, generic world-building tools | THE NRVNAVerse, the stable destination system, branded destinations, artist worlds, venue worlds, districts, discovery / directory, events, education, commerce integration, analytics / business tools, NRVNAVerse experience design |

### 2.4 Product architecture principles (summary — the Landmark and `DECISIONS.md` are authoritative)

| Principle | Where it is locked |
|---|---|
| Stable destination IDs are mandatory and independent of coordinates, chunk keys, slugs, URLs, domains and physical placement; they survive rename and move | Landmark §6, D-004 |
| Districts are navigation, not exclusive taxonomy; a destination may carry a primary district, categories, tags and relationships | Landmark §5, D-005 |
| Events are cross-network objects, not a permanent district | Landmark §4, D-008 |
| Entertainment, Education and Commerce are ecosystem-wide capabilities, not mutually exclusive destination categories | Landmark §4, D-007 |
| AUTH (permissions / roles) and GATES (visitor-entry conditions) are separate concepts | Landmark §7, D-006 |
| Mobile is a first-class adaptive client; there is no separate "Lite NRVNAVerse" product | Landmark §8, D-009 |
| M0 spatial streaming / travel lives at the NRVNAVerse application layer over official AWE APIs — an M0 boundary, not a permanent prohibition on engine-level primitives | D-016 |

### 2.5 Initial world (M0 product shape)

The first flagship spatial experience is THE NRVNAVerse with the initial verticals **Music**, **Fashion / Culture** and **Cannabis (21+)**. The initial vertical slice is: Central Hub → Music District (placeholder artist) → Fashion / Culture District (placeholder brand) → 21+ Cannabis District (NRVNA Farms anchor destination). Locked scope: Landmark §10.

**The exact implementation status of this slice is not recorded here.** Read the Landmark's "NRVNAVerse implementation state" sections and Section 13 (Current Risks).

### 2.6 Cannabis

- NRVNAVerse is not itself the cannabis seller or distributor (Landmark §9).
- Cannabis experiences sit behind an explicit 21+ / applicable visitor-gate boundary (D-006).
- Being spatial does not exempt an experience from cannabis advertising, commerce or regulatory rules.
- Commerce flows redirect to appropriate compliant web experiences rather than putting cannabis checkout inside the AWE world.
- The current client-side **gate-before-fetch** is an architecture / prototype boundary, **not** server-side authorization. Static gated assets being publicly retrievable by direct URL is a known, separate, open concern until authorized content delivery exists (Landmark §13).

### 2.7 Business and scale strategy  [PLANNED / ASPIRATIONAL]

Start with a credible vertical slice and real founding partners rather than trying to generate hundreds of finished worlds immediately.

- **Founding Worlds cohort** [PLANNED]: roughly 5–8 partners with defined scope, pilot period, feedback, asset requirements, revision limits and case-study permission where appropriate. Avoid unlimited free custom work.
- **Potential revenue later** [ASPIRATIONAL]: custom immersive builds, recurring spatial presence / hosting, premium environments, events, sponsorship / campaigns, analytics / business tooling, ecommerce integrations, production / design services.
- **Scale through** templates, manifests, automation and reusable systems. Bespoke engineering remains premium.

### 2.8 Web strategy  [PLANNED]

The conventional web surface remains important: preserve HTML/web capabilities for SEO, accessibility, speed, discovery, services, case studies and commerce, while AWE supplies the immersive spatial layer. Implementation details that are merely planned are not locked here; treat them as PLANNED unless `DECISIONS.md` says otherwise.

---

## 3. Source precedence

When documents disagree, this order decides. If two **canonical NRVNAVerse** sources genuinely conflict, **STOP and report** — do not silently choose one.

| Rank | Source | Governs |
|---|---|---|
| 1 | [`DECISIONS.md`](./DECISIONS.md) | Accepted / locked NRVNAVerse product and architecture decisions and their supersessions |
| 2 | [`NRVNAVERSE_GOVERNANCE.md`](./NRVNAVERSE_GOVERNANCE.md) | Process, authority, contributions, branch model, remotes, toolchain, production and upstream boundaries, Ghost boundary |
| 3 | [`NRVNAVERSE_LANDMARK.md`](./NRVNAVERSE_LANDMARK.md) | Current verified project / milestone state, locked principles, risks, Landmark versioning |
| 4 | NRVNAVerse domain documents ([§4](#4-document-map)) | Their implementation contracts |
| 5 | [`CLAUDE.md`](../CLAUDE.md) (upstream portion) and upstream AWE instructions / skills | Upstream project conventions and available AWE skills, where not superseded by NRVNAVerse governance |
| 6 | **This guide** | Orientation, cross-cutting strategy, human/AI operating model, recovery workflow, source map, related-repository discovery model |

Two things are **not** sources of truth for current NRVNAVerse implementation:

- `TheCannaMan/awe` — a source for **generic AWE capability discovery** only ([§5](#5-repositories-and-their-roles), [§6](#6-capability-aware-planning)).
- `Gh0sTtD3v/awe` — Ghost's experimental / reference work; never production truth (Governance rule 6, D-013).

Implementation reality (code, Git) outranks stale prose in any document, including this one; when you find such a gap, fix the document through the maintenance rule in [§16](#16-document-maintenance-rule).

---

## 4. Document map

| Subject | Authoritative document |
|---|---|
| Orientation, operating model, source map, related repositories | this guide |
| Locked principles, verified baseline, milestone state, risks, Landmark version | [`NRVNAVERSE_LANDMARK.md`](./NRVNAVERSE_LANDMARK.md) |
| Decisions `D-001`… (dual interface, AWE platform, spatial domain, stable IDs, districts, auth ≠ gates, capabilities, events, mobile, upstream compatibility, org ownership, fork origin, Ghost preservation, toolchain, `contrib/*`, M0 application-layer streaming) | [`DECISIONS.md`](./DECISIONS.md) |
| Rules 1–10, branch model, remotes, toolchain / frozen lockfile, Landmark versioning, commit attribution | [`NRVNAVERSE_GOVERNANCE.md`](./NRVNAVERSE_GOVERNANCE.md) |
| Destination identity and metadata contract, manifests, deep links, auth/gates data model, generated destination views, adapter boundary | [`NRVNAVERSE_DESTINATION_MANIFEST.md`](./NRVNAVERSE_DESTINATION_MANIFEST.md) |
| Authoritative physical scene / spatial config, validation, deterministic generation, chunk files, spatial index, portal bindings, content-addressed delivery and HTTP cache policy | [`NRVNAVERSE_SPATIAL_DATA_PIPELINE.md`](./NRVNAVERSE_SPATIAL_DATA_PIPELINE.md) |
| Official AWE runtime mount, chunk orchestrator, gate-before-fetch, application state / URL contract, physical portals, lifecycle / shutdown hardening, instrumentation, browser validation | [`NRVNAVERSE_SPATIAL_RUNTIME.md`](./NRVNAVERSE_SPATIAL_RUNTIME.md) |
| Upstream AWE conventions, kebab-case rule, `/engine`, `/run-space`, `/game-prd` skills, examples | [`CLAUDE.md`](../CLAUDE.md) (upstream portion), `CONTRIBUTING.md`, `packages/tools/AGENT.md`, `.claude/skills/*` |
| Generic AWE capability implementation and usage (multiplayer, space kit, behaviors, generators, scaffolding) | `TheCannaMan/awe` — its `README.md`, package READMEs, `.claude/skills/engine/references/*.md` |

**Where NRVNAVerse code lives** (Governance rule 10, D-010): NRVNAVerse-specific behaviour is in `apps/*` and `packages/nrvna-*`, or injected through configuration, data and `externalApi`. `packages/engine`, `engine-edit`, `studio`, `tools` and `examples/*` are upstream AWE and stay generic and rebase-friendly; the Landmark records exactly which apps and packages exist at the current milestone.

### Status vocabulary

Use these labels exactly, in docs, commit messages and reports (Governance rule 5):

| Label | Meaning |
|---|---|
| **VERIFIED** | confirmed by reading code / Git or by executing a check |
| **EXPERIMENTAL** | exists in code but is unreviewed / untested (notably Ghost's fork) |
| **PLANNED** | designed and scheduled, not implemented |
| **ASPIRATIONAL** | long-term direction; not a commitment and not current functionality |
| **[LOCKED]** | a principle implementation must not silently contradict (Landmark) |

Cross-repository qualifiers ([§5](#5-repositories-and-their-roles)) are added when the repository matters: *VERIFIED IN NRVNAVerse/awe*, *VERIFIED IN TheCannaMan/awe*, *EXPERIMENTAL IN Gh0sTtD3v/awe*, *UPSTREAM AWE*.

---

## 5. Repositories and their roles

| Repository | Role | Status meaning | Source of truth for |
|---|---|---|---|
| `oncyberio/awe` (`upstream` remote) | Official upstream AWE — the generic engine, editor, tools and examples | **UPSTREAM AWE** | AWE itself; `main` in the canonical repo fast-forwards from it only |
| **`NRVNAVerse/awe`** (`origin` remote) | **Canonical NRVNAVerse product repository**: THE NRVNAVerse, stable destination identity, network / navigation architecture, districts, gates, the NRVNAVerse experience / business layer | **VERIFIED IN NRVNAVerse/awe** = available to the canonical product codebase | Current NRVNAVerse implementation |
| `TheCannaMan/awe` (no remote in this repo) | Nic's **generic AWE capability / tooling / experimentation** repository: reusable AWE functionality — authoring, behaviors, multiplayer / presence, creation / publishing tools, generic world-building primitives | **VERIFIED IN TheCannaMan/awe** = implemented / tested there, **not** automatically available to THE NRVNAVerse | Generic capability discovery only ([§6](#6-capability-aware-planning)) |
| `Gh0sTtD3v/awe` (`ghost` remote, push disabled) | Ghost's experimental / reference work, preserved at the SHA recorded in D-013 on `ghost/experimental` | **EXPERIMENTAL IN Gh0sTtD3v/awe**; never production-ready | Architectural reference under attribution / review boundaries |

A useful planning distinction: **`TheCannaMan/awe` answers "what generic capabilities can AWE already provide?"; `NRVNAVerse/awe` answers "what is THE NRVNAVerse product and network?"**

Rules that follow:

- Code in one repository does **not** exist in another until a reviewed integration task brings it across. Never describe a `TheCannaMan/awe` capability as present in `NRVNAVerse/awe`, and never describe Ghost's code as production-ready.
- Git relationships are stated only where Git proves them. `NRVNAVerse/awe` is a GitHub fork of `oncyberio/awe` (D-012). `TheCannaMan/awe` is **not** Git-related to either: its history begins with a parentless snapshot import of upstream `main`, so there is no shared ancestry to merge or rebase across — transfers between it and the canonical repo are deliberate, reviewed ports, never merges. `Gh0sTtD3v/awe` branches from upstream (Landmark §12).
- Remotes and branch rules live in Governance; do not add remotes or push targets casually.

### Ghost / contribution boundary

Gh0sTtD3v (GhostDev) is a trusted personal friend of Nic and closely connected to AWE leadership. His experimental work is useful architectural reference but is not ours to silently copy, split, rewrite, republish or claim. Preserve attribution, commit history, review requirements and the upstream relationship. **Ghost's review is required** before materially reworking or publishing his work, or proposing upstream changes materially derived from it (Governance rule 6, D-013). Automate routine work; do not turn Ghost into unpaid implementation labour.

---

## 6. Capability-aware planning

**Stable operating principle: BEFORE DESIGNING OR IMPLEMENTING A GENERIC AWE CAPABILITY FOR NRVNAVerse, CHECK THE CURRENT PUSHED `main` OF `TheCannaMan/awe` FIRST.** The goal is to avoid independently rebuilding a generic capability Nic has already developed and validated elsewhere.

### 6.1 When this rule applies

Any task touching a generic AWE capability, including: multiplayer / presence · visitor social features · teleport-to-visitor · reconnect / presence resilience · reusable behaviors · generic portals · owner / world authoring · template-based world generation · media / gallery generation · room generation · procedural placement · partner-facing world management · local / interior lighting · minimaps · visitor photography · sharing · SEO / social-card tooling for spaces · publishing / deployment tooling · scaffolding · generic world / plot primitives.

### 6.2 How to discover

1. Confirm the current pushed `main` SHA (`git ls-remote https://github.com/TheCannaMan/awe.git main`). Never assume a SHA recorded in a task prompt is still current.
2. Read its `README.md`, the relevant `packages/<name>/README.md`, and `.claude/skills/engine/references/*.md` (notably `space-kit.md`, `behaviors.md`, `multiplayer.md`, `space-generators.md`).
3. Verify a README claim in source before relying on it. Work that exists only in a local working tree and is absent from GitHub is **NOT VERIFIABLE FROM THE PUSHED REPOSITORY** — record that; do not guess.
4. Record the SHA you inspected in the task report.

### 6.3 Classify before proposing

| Class | Meaning |
|---|---|
| **A. USE / ADAPT** | Appears suitable; may later be brought into the canonical repo through a **separate, reviewed integration task** |
| **B. INFORM** | Its architecture should inform NRVNAVerse, but direct adoption is not appropriate |
| **C. KEEP SEPARATE** | Solves a different problem or conflicts with NRVNAVerse architecture |
| **D. CONTRIBUTE / GENERALIZE** | May belong in generic AWE / `contrib/*` work, subject to normal review and upstream rules (Governance rule 7, D-010, D-015) |

**Discovery does not authorize code transfer.** Bringing anything across is its own bounded, reviewed task with an explicit dependency policy (D-014) and Ghost review where his work is materially involved (D-013).

### 6.4 Capability families in `TheCannaMan/awe` (high level — not a feature catalog)

Verified on its pushed `main` at the time this guide was written; re-verify before relying on any item. Detailed capability documentation stays in that repository.

| Family (package / area) | What it is | Relevance to NRVNAVerse | Likely class · boundary to respect |
|---|---|---|---|
| **Multiplayer / presence** (`@oncyberio/multiplayer`) | Colyseus-based *current-space* presence: shared avatars, nameplates, chat, speech bubbles, emotes, join / leave, reconnect, visitor list, "Go to" (teleport to a **current** visitor by session id), per-space visitor stats and guestbook | Fills the ASPIRATIONAL "presence" item; informs social features | **B INFORM** now (candidate A later) · brings a hosted WebSocket server and Colyseus **dependencies**; has **no accounts and no friend graph**; must attach only after gate resolution and key rooms by stable destination id, not by URL path |
| **Space Kit** (`@oncyberio/space-kit`) | Owner-facing `/manage` UI + `space.json` config → deterministic single-space generation: onboarding wizard, presets / templates, connected rooms, media walls, pedestals, music / ambience, moods, interior lighting, room map, CLI, build and publish flow | Highly relevant to Founding Worlds, partner-facing authoring and template + automation scale | **B INFORM** · models one standalone space, not a multi-destination network; its publish step runs Git / hosting deploys and must never be wired into NRVNAVerse without Governance rule 8 authorization |
| **Behaviors** (`@oncyberio/behaviors`) | Attachable, data-driven, Studio-editable mechanics: doors, keys, collectibles, triggers, checkpoints, respawn, damage / heal zones, NPC dialogue, info cards, slideshows, signs, moving platforms, spawners, media control, teleporters, link portals, game systems; prefabs | Many branded-world interactions may need no bespoke NRVNAVerse code | **A USE / ADAPT selectively** · requires an engine data-model change (`scripts` on component data) — an explicit upstream-divergence decision; **link-portal / teleporter are C KEEP SEPARATE** for destination travel (§6.5) |
| **Generation / authoring tools** (`packages/tools` scene generators; Studio "Generate" panel) | `place-media`, `build-room`, `scatter` generators; prefab generation; reusable room / gallery layouts | Direct support for the templates + automation strategy (Governance rule 9) | **A USE / ADAPT** for the pure generators · Studio panel **B INFORM** (Studio there depends on the fork's packages) |
| **Scaffolding** (`create-oncyber-app`) | Clean-scene scaffolds, `--with-demo`, presets (gallery, showroom, hangout, mini-game), Space Kit / behaviors / multiplayer integration | Useful reference for onboarding flows | **C KEEP SEPARATE** · template source is that repository; THE NRVNAVerse app is not scaffolded |
| **Visitor UX / starter** (`examples/starter`) | Minimap, touch controls, photo capture, native / copy sharing, presence HUD, SEO metadata and Open Graph image generation from space config | Relevant to mobile / adaptive and presentation work; no adaptive-quality tier exists there | **A USE / ADAPT** at app level · derive metadata from destination manifests, not `space.json` |
| **Engine / editor changes** | Point / spot / local interior lights and editor, sensor ↔ kinematic collider fix, hot-reload parent-order fix, frozen-data copy fix, case-sensitive icon path fix, `COMPONENT_CREATED` event, `scripts` data field | Bug-fix class items are upstream-worthy | **D CONTRIBUTE / GENERALIZE** for fixes (Governance rule 7 for any PR) · lights **B INFORM** · every adoption widens divergence from `upstream/main` (rule 10) — diff `packages/engine`, `engine-edit`, `studio` against that repo's snapshot root before reusing |

Facts to carry into planning:

- That repository is a **snapshot import**, not a Git fork: compare with upstream by file diff, not by Git ancestry; nothing merges across.
- **World / plots authoring** is now VERIFIED IN TheCannaMan/awe on its pushed `main`: a generic world/plots system with, at family level, an operator-owned world, bounded manager-owned plots, plot-local authoring, a draft/live publish model, a merged visitor scene and operator administration. Preliminary NRVNAVerse classification: **B INFORM** — highly relevant to Founding Worlds / partner authoring, but its visitor model is a single merged scene, whereas THE NRVNAVerse canonical product uses stable destination identity, gate resolution and chunk-based travel (D-004, D-006, D-016). Any selective USE / ADAPT is decided in a dedicated post-M0 architecture review, not inferred from this note.
- Nothing there implements chunk streaming, `?chunk=` URLs, coordinate-keyed portal indexes, auth / gates, or cannabis compliance; none of the NRVNAVerse network architecture exists there.
- Some README claims are ahead of or behind the code (counts, deployment flows, CI status): verify in source.

### 6.5 Boundaries that must not blur

| Keep distinct | Why |
|---|---|
| A **generic URL / link / teleporter portal** vs **NRVNAVerse stable-ID navigation** (`stable destination id → manifest / gate resolution → physical placement → chunk orchestration`) | A generic portal must never silently replace the canonical navigation chain; it may only *trigger* it with a stable id (D-004, D-006, D-016; Runtime doc §13) |
| **Current-space presence / teleport-to-current-visitor** vs a **persistent, account-level friend network** (friend relationships, social graph, network-wide friend discovery, cross-destination friend location, teleport across worlds / chunks / servers) | The former is a per-space session feature; the latter is an unbuilt ASPIRATIONAL NRVNAVerse network concept (Landmark §11) |
| **Owner-facing space authoring** in a generic kit vs **NRVNAVerse partner-facing authoring architecture** | A generic kit may inform or seed the Founding Worlds workflow; it is not automatically the final partner-authoring architecture |
| **Generic behaviors** (doors, collectibles, triggers, info cards, media control …) vs **NRVNAVerse application / network concerns** | Many branded-world interactions may need no bespoke NRVNAVerse code; destination navigation, gating and identity remain NRVNAVerse-owned |

---

## 7. Human + AI operating model

```
NIC (human owner)
  │  goals, approvals, product / brand / business / compliance judgement
  ▼
PLANNING / REVIEW AI   (currently primarily ChatGPT)
  │  persistent specifications · repo docs · decisions · bounded task prompt
  ▼
IMPLEMENTATION AGENT   (currently primarily Claude Code)
  │  inspect repo → implement bounded task → tests / validation → commit on feature branch
  ▼
PLANNING / REVIEW AI
  │  independent inspection of the ACTUAL repository changes
  ▼
correction on the feature branch if necessary
  ▼
deterministic integration into nrvna/integration
```

**Git and repository documentation are the durable state.** Chat conversations are useful working context; they are **not** the project memory. Anything that must survive a lost conversation goes into Git, the Landmark, `DECISIONS.md` or a domain document.

### 7.1 Responsibility model

| Role | Responsibilities |
|---|---|
| **Nic / human owner** | Owns or explicitly approves major: product direction · brand direction · business commitments · compliance / legal-policy choices · production deployment · domains / DNS · commerce changes · upstream PR publication · material Ghost-derived contribution decisions · major architectural reversals · significant business / public-facing commitments |
| **Planning / review AI** | Understands objectives · maintains system-level coherence · proposes better alternatives proactively · makes routine technical / product recommendations · identifies when existing capability should be reused · inspects related repos before inventing generic AWE systems · defines bounded implementation tasks · chooses the Claude workflow ([§8](#8-claude-workflow-convention)) · independently inspects the actual implementation · catches architecture / regression problems before integration · keeps durable docs current. **Does not require Nic to make every routine engineering choice.** |
| **Claude Code / implementation agent** | Inspects actual repo state · implements the bounded approved task · uses repo-native skills and docs · runs the requested validation · preserves task boundaries · returns structured evidence · commits / pushes only within the explicit push policy · **STOPs when instructed**. Its prose does not substitute for independent review. |

### 7.2 Approval matrix

| Needs Nic's explicit approval | Routine — agents decide, state the choice, move on |
|---|---|
| Production website, DNS / domains, deployment, hosting, commerce configuration (Governance rule 8) | File / module structure inside the approved scope; naming within the kebab-case rule |
| Opening any upstream `oncyberio/awe` PR (rule 7) | Test design and coverage for the task |
| Splitting, reworking, republishing or upstreaming Ghost-derived work — plus Ghost's own review (rule 6, D-013) | Which validation to run for a checkpoint (narrow vs full), within the task's stated policy |
| Pushing `main`, merging product work into `main`, rewriting accepted history, deleting branches | Branch naming under `feat/*` / `contrib/*` |
| Any change to a `[LOCKED]` principle (needs a `DECISIONS.md` entry and Landmark bump) | Routine refactors inside the task boundary that change no contract |
| Dependency / lockfile changes (D-014 — a reviewed change with a stated reason) | Choosing Plan vs Auto mode for a session ([§9](#9-plan-vs-auto)) |
| Product, design, brand, compliance and world-layout decisions (rule 9) | Automating repetitive content / scene assembly (rule 9) |
| Starting the *next* milestone or phase after a task completes ([§10](#10-claude-task-design)) | Fixing a genuine defect discovered inside the task boundary (report it) |
| Business / public-facing commitments, partner terms, pricing | Recommending — not deciding — a model, mode or split of a phase |

---

## 8. Claude workflow convention

Every Claude Code task prepared through the planning / review workflow **begins** with this header:

```
CLAUDE WORKFLOW RECOMMENDATION

Recommended model:
Recommended mode:
Switch now?:
Fresh Claude session?:
Push policy:
APP_VERSION recommendation:
```

| Field | Meaning |
|---|---|
| **Recommended model** | The Claude model the task should run on. Model choice is effectively a **session-start** decision in the local workflow: it is *not* changed casually mid-session. If no fresh session is warranted, write `Keep current model`. Recommend another model only when the expected benefit justifies restarting the session. |
| **Recommended mode** | `Plan` or `Auto` ([§9](#9-plan-vs-auto)) — a default, not a law. |
| **Switch now?** | Whether Nic should **leave the current working Claude / PowerShell context and start the recommended new one** before running the task. It is a concrete instruction about the terminal, not an abstract model preference. |
| **Fresh Claude session?** | Whether the task should start in a new Claude session (clean context). When `Yes`, the planning AI also supplies the exact PowerShell commands (below). |
| **Push policy** | Exactly what Claude may **commit**, **push**, **merge**, **PR**, and must **not touch**. Repository write authority is never left ambiguous. |
| **APP_VERSION recommendation** | Whether the application version should `not change`, `patch`, `minor`, `major`, or `N/A`. See [§14](#14-version-concepts) — do not invent a versioning system where none exists. |

### 8.1 Fresh-session command block

When `Fresh Claude session?: Yes`, the planning AI provides exact PowerShell commands (Windows PowerShell 5.1: no `&&`; chain with `;` or separate lines) that:

```powershell
<drive>:                                   # enter the correct drive
Set-Location <path-to-NRVNAVerse-awe>      # enter the canonical repository (the current machine path is recorded in the Landmark)
git status                                 # verify a clean working tree
git fetch origin
git checkout <intended-branch>             # usually nrvna/integration, or the feature branch named in the task
git pull --ff-only origin <intended-branch>  # update from remote safely (fast-forward only)
git rev-parse HEAD                         # must match the expected HEAD stated in the task
claude                                     # launch Claude Code (select the recommended model / mode at start)
```

If the HEAD does not match the task's expected SHA, the agent's first action is to **STOP and report**, not to proceed.

---

## 9. Plan vs Auto

| Mode | Prefer for |
|---|---|
| **Plan** (read-only until approved) | read-only audits · architecture investigation · repository exploration · measurement-first work · decision support · implementation planning not yet approved |
| **Auto** | bounded implementation · tests · approved fixes · deterministic Git integration / checkpoints · documentation implementation |

These are defaults, not rigid laws. Use judgement; say which mode you are in and why when it matters.

---

## 10. Claude task design

Tasks are **bounded**. A good task prompt defines:

- starting branch / expected SHA
- exact scope
- required first-read files
- implementation boundary and **explicit non-goals**
- tests / validation to run (and what *not* to run)
- dependency policy (default: none added — D-014)
- branch / push policy
- STOP conditions
- expected report structure
- whether the task may continue into the next phase

**Default: do NOT automatically begin the next milestone or phase after completing the current task.** Large phases are split when independent review between phases reduces risk. Use subagents when independent parallel investigation genuinely saves time or improves coverage; do not spawn agents merely to consume usage.

---

## 11. Efficiency principles

- Implementation reality outranks stale docs.
- Inspect before designing.
- Check existing generic capability before rebuilding it ([§6](#6-capability-aware-planning)).
- Measure before optimizing.
- Do not implement "standard" infrastructure without a measured need.
- Prefer the smallest architecture that satisfies the requirement.
- Avoid giant open-ended audits when a bounded audit answers the question.
- Distinguish prototype requirements from production requirements.
- Do not run expensive full validation when a checkpoint needs only narrow generated-state checks; **do** run full tests / build / browser proof when the change warrants it.
- Preserve working systems while staging replacements.
- Fail safely rather than silently accepting mismatched state.
- Use actual repo evidence rather than an implementation agent's summary.
- Prefer automation for repetitive assembly; preserve human review for high-judgement product / design / business decisions.

Useful generic pattern: **measure → decide → minimally implement → independently verify → integrate.**

---

## 12. Independent review rule

After the implementation agent reports "complete", the planning / review AI — when practical — inspects the repository itself rather than the report:

- branch, commits and ancestry (`git log --oneline --graph`, merge-base with `nrvna/integration`)
- the actual changed code (`git diff <base>...<branch>`)
- critical implementation claims, verified against source
- architecture boundaries (stable IDs, auth ≠ gates, application-layer vs engine, Ghost boundary)
- subtle failure modes the report may miss
- no unexpected dependency / lockfile changes
- no unexpected engine / editor / studio changes
- no Ghost boundary violations
- no `main` movement
- generated artifacts where relevant (regenerate and diff)
- **test claims vs actually inspected implementation** — a major implementation is not accepted solely because "tests pass"

Corrections happen on the feature branch **before** integration. The Landmark records, as examples, that independent review has already caught a design flaw that passing tests could not see; treat that as the norm, not the exception.

---

## 13. Integration model

Summary of the canonical branch model — [`NRVNAVERSE_GOVERNANCE.md`](./NRVNAVERSE_GOVERNANCE.md) is authoritative and wins on any difference.

| Branch | Role |
|---|---|
| `main` | pristine, upstream-compatible base; fast-forward from `upstream/main` only |
| `nrvna/integration` | NRVNAVerse development / integration line (pushed to `origin`) |
| `feat/*` | bounded NRVNAVerse feature work, from and into `nrvna/integration` |
| `contrib/*` | generic upstream-candidate work (D-015) |
| `ghost/experimental` | preserved Ghost experimental reference; local / remote-tracking only (D-013) |

Accepted feature work normally reaches `nrvna/integration` through a **deterministic checkpoint** performed after independent review. Prefer clean **fast-forward** integration where branch topology permits it.

**Never silently** (i.e. without explicit authorization for that specific action):

- squash accepted history
- rebase accepted commits
- rewrite Ghost history
- merge NRVNAVerse product work into `main`
- push `main`
- open an upstream PR
- deploy production
- delete branches

---

## 14. Version concepts

Two unrelated things are both called "version". Keep them apart.

| Concept | What it is | Where it lives | When it changes |
|---|---|---|---|
| **APP_VERSION recommendation** | The software / application release-version decision for a task | The repository has **no** `APP_VERSION` constant today; the only application version fields are `version` in `apps/the-nrvnaverse/package.json` and `packages/nrvna-manifest/package.json`. Until a release-versioning decision exists, the header field answers whether those fields should change (usually `No bump`) | Only when a task explicitly decides it; never automatically because a commit exists |
| **Landmark version** | The project benchmark / milestone marker | `NRVNAVERSE_LANDMARK.md` header, governed by its Landmark Versioning Rule (§15 there) | Only at meaningful milestones, with Section 12 / 13 refreshed |

---

## 15. Related-repository discovery must stay a discovery model

This guide records that `TheCannaMan/awe` exists, its role, why planners inspect it, the status vocabulary and the high-level capability families. It does **not** duplicate package features. Detailed generic capability documentation stays in `TheCannaMan/awe` (its `README.md`, package READMEs and Claude skills); NRVNAVerse docs describe a capability only once it is formally adopted into `NRVNAVerse/awe`.

---

## 16. Document maintenance rule

| Document | Update when |
|---|---|
| **This Operating Guide** | stable project purpose, operating method, authority model, source map, cross-repository role model or cross-cutting strategy changes |
| **Landmark** | the current milestone / verified state, risks or the technical baseline change; version bump only at milestones |
| **`DECISIONS.md`** | an accepted, locked decision is made or superseded (never renumber or delete) |
| **Governance** | process, authority, branch policy, contribution / upstream rules change |
| **Domain docs** (manifest, pipeline, runtime, future domains) | their specific implementation contracts change |
| **`TheCannaMan/awe` docs** | own generic capability implementation and usage details for that repository; not duplicated here unless a capability is formally adopted |
| **Git history** | retains the exact historical state; nothing is "kept alongside" as an old copy |

---

## 17. What must not live here

This guide is not a status log. Volatile details belong in the Landmark, Git history, task reports, domain docs or the related repository — never here:

exact current integration SHA · current test counts · current generated content hashes · the current active feature branch · today's next implementation task · temporary server ports · machine-specific benchmark timings · subscription / usage-reset details · currently running local agents · uncommitted work in another checkout.
