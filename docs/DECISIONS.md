# NRVNAVerse Decision Log

Architectural and product decisions with stable IDs. Never renumber or delete an entry; to change a decision, add a new entry that **supersedes** the old one and update the old entry's status.

**Statuses:** `Proposed` · `Accepted` · `Superseded by D-xxx` · `Rejected`

Decisions D-001 through D-012 were accepted during the NRVNAVerse planning sessions of September 2026 (Wix reconnaissance → AWE audit → vertical-slice plan → repository foundation) and recorded on 2026-09-19 when the canonical repository was established. Rationale references the findings of those sessions; no earlier history is claimed.

---

## D-001 — Dual Web + Spatial architecture

- **Status:** Accepted (2026-09-19)
- **Decision:** NRVNAVerse is delivered through two parallel interfaces to one ecosystem: WEB (`www.nrvnaverse.com`) and SPATIAL (THE NRVNAVerse at `worlds.nrvnaverse.com`).
- **Rationale:** The web interface carries SEO, discovery, education, case studies, commerce and account/accessibility needs that a 3D runtime cannot serve well; the spatial interface carries persistent experiences, portals, events and social presence that a website cannot. Treating them as one ecosystem lets destination metadata, identity concepts, analytics, design language and commerce references be shared instead of duplicated.
- **Implications:** A shared destination manifest becomes the contract between both interfaces. Every spatial destination should have a web counterpart (`webUrl`) and vice-versa where meaningful. Neither interface may be built as if the other did not exist.

## D-002 — AWE is the core spatial platform

- **Status:** Accepted (2026-09-19)
- **Decision:** THE NRVNAVerse is built on AWE (`oncyberio/awe`, MIT). NRVNAVerse strengthens AWE rather than evolving into a closed competing spatial platform.
- **Rationale:** The AWE audit verified a self-contained Next.js/React/Three.js/Rapier engine with editor, asset tooling and Colyseus multiplayer examples, with no runtime dependency on awe.box. Building on it is faster and keeps NRVNAVerse aligned with the wider AWE ecosystem; forking away would make NRVNAVerse solely responsible for engine maintenance.
- **Implications:** Generic capabilities (chunk streaming, portals, travel, presence, friends, network identity) are treated as AWE/core candidates and kept generic. NRVNAVerse-specific behaviour is injected via configuration, data, `externalApi` and application code, not baked into the engine. Upstream compatibility is a design constraint.

## D-003 — Spatial domain is worlds.nrvnaverse.com

- **Status:** Accepted (2026-09-19)
- **Decision:** The spatial interface is served at `worlds.nrvnaverse.com`. The web interface remains `www.nrvnaverse.com`.
- **Rationale:** A dedicated subdomain isolates the 3D runtime (large bundles, WASM, WebSockets, distinct caching and CSP needs) from the SEO-facing site while staying under the NRVNAVerse brand and cookie scope. It mirrors the Wix headless pattern already identified for the website (custom frontend + Wix subdomain for hosted flows).
- **Implications:** Handoff URLs take the form `www.nrvnaverse.com/worlds/<slug>` → `worlds.nrvnaverse.com/?destination=<id>`. First-party storage (e.g., gate affirmations) is per-origin; cross-origin continuity requires an explicit token design later. DNS changes are out of scope until explicitly authorised.

## D-004 — Stable destination IDs are independent of physical placement/URLs

- **Status:** Accepted (2026-09-19)
- **Decision:** Every meaningful destination has an immutable stable ID. Coordinates, chunk keys, portal positions, slugs, URLs and domains are derived attributes that resolve to the ID — never the identity itself.
- **Rationale:** Ghost's experimental `portals-index.json` is coordinate-keyed; relying on it would break links, analytics and web pages whenever a world is re-laid-out. Stable IDs let layout, hosting and naming change freely while manifests, analytics and deep links stay valid.
- **Implications:** A destination registry (`id → {chunkKey, spawn, …}`) is required before any destination is referenced from the web or analytics. Portals must target destination IDs, not positions. Slug renames are handled with redirect lists. The `?chunk=` URL parameter written by the experimental chunk manager is to be replaced by `?destination=<id>` in NRVNAVerse work.

## D-005 — Districts are navigation, not exclusive taxonomy

- **Status:** Accepted (2026-09-19)
- **Decision:** Districts organise spatial navigation. A destination has at most one primary spatial district but may participate in many categories, tags, relationships, collaborations and events.
- **Rationale:** Real brands, artists and venues cross categories (a cannabis brand may sponsor a music event; a fashion label may host an artist). Forcing exclusive taxonomy would misrepresent the ecosystem and complicate the directory.
- **Implications:** Data models carry `districtId` (primary, optional) separately from `category`/`tags`/`relationships`. Directory and search filter on categories and tags, not only districts. District membership can change without changing identity (see D-004).

## D-006 — Auth and visitor gates are separate concepts

- **Status:** Accepted (2026-09-19)
- **Decision:** AUTH means permissions/roles (`administrator`, `moderate`, `speak`, `build`). GATES mean visitor-entry conditions (`age21`, `ticket`, `member`, `invite`). They are never combined in one field or concept.
- **Rationale:** Roles describe what a trusted user may do; gates describe what a visitor must satisfy to enter content. Conflating them (as the experimental chunk `auth` field currently does by describing "role ids permitted to enter") makes compliance logic and moderation logic entangle, and makes the 21+ boundary harder to reason about.
- **Implications:** Chunk/destination data gains an explicit `gates[]` concept distinct from roles. Gate evaluation happens at the application layer before gated content is fetched. Any reuse of Ghost's `auth` field for entry conditions must be reconciled (rename or dual-field) before use.

## D-007 — Entertainment, Education, Commerce are ecosystem-wide capabilities

- **Status:** Accepted (2026-09-19)
- **Decision:** Entertainment, Education and Commerce are capabilities available anywhere in the ecosystem. They are not mandatory separate districts.
- **Rationale:** Education about a product belongs next to the product; commerce belongs next to the experience that creates desire; entertainment is the fabric of every destination. Segregating them into districts would fragment the experience and contradict the north star of richer discovery.
- **Implications:** Destinations declare `capabilities[]` (e.g., `info-cards`, `video`, `commerce-redirect`, `education`) rather than being typed by capability. Districts remain thematic/navigational (music, fashion/culture, cannabis 21+, …).

## D-008 — Events are cross-network objects

- **Status:** Accepted (2026-09-19)
- **Decision:** Events are first-class objects that reference destinations, artists, brands, venues and other entities. They are not owned by a single district or destination type.
- **Rationale:** A concert involves an artist, a venue and possibly brand sponsors; a product drop involves a brand and a venue. Modelling events as cross-network objects supports event discovery, scheduling and analytics across the whole ecosystem.
- **Implications:** The data model reserves an `event` object type with references (not embeddings) to participants and locations. Event discovery is an NRVNAVerse-layer feature built over the directory. Events are **not** implemented in the first vertical slice.

## D-009 — Mobile uses adaptive quality, not a separate Lite product

- **Status:** Accepted (2026-09-19)
- **Decision:** Mobile is first-class. THE NRVNAVerse adapts rendering quality, asset variants and feature enablement per device inside one product; there is no separate consumer-facing "Lite" product.
- **Rationale:** A separate Lite product doubles content and testing surface and fragments identity/analytics. AWE already selects `high/low/low_compressed` asset variants by GPU tier and has touch input; an adaptive quality tier extends that path.
- **Implications:** Asset and scene budgets must be defined with mobile ceilings. Quality tiering (post-processing, shadows, pixel ratio, particle counts, multiplayer) is a runtime setting. A non-3D fallback page is acceptable for unsupported devices, but it is a fallback, not a product.

## D-010 — Generic spatial/network improvements remain upstream-compatible when practical

- **Status:** Accepted (2026-09-19)
- **Decision:** Improvements to generic engine/network capabilities are developed so they can be contributed to `oncyberio/awe` (small, topical, unbranded, tested). NRVNAVerse-specific functionality lives in application packages, not in engine packages.
- **Rationale:** Follows D-002. Ghost's upstream PR #11 (one PR bundling six commits, 181 files and ~200 MB of binaries) was closed unmerged; upstream acceptance requires focused changes. Keeping engine changes topical also keeps `git rebase upstream/main` cheap.
- **Implications:** Engine changes are made on dedicated candidate branches, carry no NRVNAVerse naming, and include tests where feasible. Upstream PRs are opened only with explicit authorisation (see CLAUDE.md governance). Application code lives under `apps/*` and `packages/nrvna-*`.

## D-011 — GitHub organization NRVNAVerse owns canonical project repositories

- **Status:** Accepted (2026-09-19)
- **Decision:** The GitHub organization `NRVNAVerse` owns the canonical project repositories. `https://github.com/NRVNAVerse/awe` is the canonical spatial repository.
- **Rationale:** Organization ownership separates project assets from any individual's personal account (including collaborators' personal forks), supports access control and continuity, and gives the project a stable home for future repositories (web, manifests, tooling).
- **Implications:** Personal forks (including `Gh0sTtD3v/awe`) are inputs, not sources of truth. Collaborator work is brought into the organization repository via branches/PRs with attribution preserved.

## D-012 — NRVNAVerse/awe forks official oncyberio/awe, not Ghost's fork

- **Status:** Accepted (2026-09-19)
- **Decision:** `NRVNAVerse/awe` is a GitHub fork of `oncyberio/awe`. Ghost's experimental fork (`Gh0sTtD3v/awe`) is attached as an additional remote and preserved on its own branch; it is not the fork parent.
- **Rationale:** Forking upstream keeps the GitHub fork relationship and `upstream` remote pointed at Oncyber, so future upstream improvements are a straightforward fetch/rebase. Ghost's fork was 6 commits ahead / 0 behind upstream at the time, so his work rebases cleanly onto upstream and can be preserved faithfully as a branch. Forking Ghost would have made every future upstream pull a three-way merge through his unreviewed changes.
- **Implications:** `main` tracks `upstream/main` and stays upstream-compatible. Ghost's work is preserved unmodified on `ghost/experimental` until he reviews it; no splitting or rewriting of his commits happens without his review. NRVNAVerse development happens on `nrvna/integration` and `feat/*` branches (see CLAUDE.md governance and the Landmark).

## D-013 — Ghost's experimental work is preserved by reference at `a5880dd`, not republished

- **Status:** Accepted (2026-09-19)
- **Decision:** The `ghost` remote (`https://github.com/Gh0sTtD3v/awe`) stays attached. Ghost's current public `main`, commit **`a5880dd463e105275c251c61b6bfa951c2431af1`** (2026-08-04, "Preview world"), is the **verified experimental baseline**. It is preserved as the local branch `ghost/experimental` and the remote-tracking ref `ghost/main`. Ghost's full branch/history is **not** pushed into `NRVNAVerse/awe` yet; his history is **not** rewritten, split or republished; his large binary assets are **not** imported into the canonical NRVNAVerse Git history merely for preservation.
- **Rationale:** Ghost's six commits carry ≈200 MB of Git objects (mostly binaries under `apps/ghostt/public/assets/`). Pushing them would permanently bloat the canonical repository for a preservation goal that a pinned SHA plus an attached remote already satisfies. The SHA was independently confirmed as his current public `main`, so no round-trip with Ghost is needed merely to verify it. Splitting or rewriting his commits without his review would violate rule 6 of the governance document.
- **Implications:** A local or remote-tracking reference is sufficient for now; the Landmark records the SHA (Section 12) so it can be re-fetched from `Gh0sTtD3v/awe` or any mirror. Any future preservation mechanism (archive tarball, Git LFS, dedicated mirror repository) is a separate decision. **Ghost's review is required before:** (a) splitting or reworking his commits; (b) publishing refactors of his work; (c) opening upstream AWE contributions based materially on his changes. Refines D-012: "preserved on its own branch" means a local/remote-tracking branch until a later decision says otherwise.

## D-014 — Package manager is Corepack-provided pnpm at the exact declared version, installed with a frozen lockfile

- **Status:** Accepted (2026-09-19)
- **Decision:** pnpm is provided through Corepack (`corepack enable`) at exactly the version declared in `package.json#packageManager` (currently `pnpm@10.10.0`). Dependencies are installed with `pnpm install --frozen-lockfile`. Foundation work does **not** update dependencies, does **not** change `package.json`, and does **not** regenerate or alter `pnpm-lock.yaml`. If installation proves the existing lockfile invalid, the session stops and reports instead of repairing the lockfile.
- **Rationale:** Reproducibility across developer machines, CI and AI sessions; the declared version is what upstream `oncyberio/awe` builds with, so matching it keeps `main` and `nrvna/integration` upstream-compatible (D-002, D-010). Dependency bumps are upstream's decision unless a NRVNAVerse package needs something upstream does not have.
- **Implications:** Developer setup is `corepack enable` (or `corepack enable --install-directory <user-writable dir on PATH>` when the Node installation directory is not writable, as on the Windows development machine) followed by `pnpm install --frozen-lockfile`. CI uses the same commands. A lockfile change is a reviewable event, never a side effect.

## D-015 — Upstream-candidate branches are named `contrib/*`, not `upstream/*`

- **Status:** Accepted (2026-09-19)
- **Decision:** Generalized engine/editor/tools changes that may eventually be proposed back to `oncyberio/awe` are developed on branches named `contrib/<topic>`. The planning documents' `upstream/*` family is retired before use.
- **Rationale:** The repository has a Git remote named `upstream`. Local branches named `upstream/<x>` collide visually with remote-tracking refs `upstream/<x>` and literally for `upstream/main`, inviting mistakes in `git checkout`, `git rebase` and `git push`.
- **Implications:** Branch model in the governance document lists `contrib/*`. Never create local branches named `upstream/<anything>` or `ghost/main`. Opening a PR from a `contrib/*` branch to `oncyberio/awe` still requires explicit authorization (governance rule 7) and, where the change is materially based on Ghost's work, his review (D-013).
