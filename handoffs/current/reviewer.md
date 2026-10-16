# Implementer Handoff — M2 Hub-over-Megacity foundation (overnight campaign)

## Baton

NEXT: CHATGPT
LAST: CLAUDE
STATE: AWAITING_REVIEW — **READY FOR OWNER PLAYTEST / REVIEW**
BRANCH: `feat/m2-megacity-foundation` (pushed; working tree clean at the final commit)

Read first: `docs/NRVNAVERSE_M2_MEGACITY_CAMPAIGN.md` (decisions, measurements, checkpoints, evidence, queue). World truth incl. secrets: `docs/NRVNAVERSE_HUB_WORLD.md` §17. Contracts: runtime doc §20, pipeline doc §19. Landmark: new M2 checkpoint note (version unchanged). The M1 handoff that lived in this file is in Git history (`ecda29f`).

## 1. Commits, duration

- Start `ecda29f` (M1 close). Checkpoints: `98d74d0` record · `84d5472` Hub over megacity (core) · `f788bde` tests · `952d1d7` record · `259468b` local audition · `619c8df` audition findings · `a8cb974` city visual pass · `f7064b6` sky-lift veil · `166785b` roof garden · `11bd0ee` Hub signs / return glow · `21c5595` docs · `777fd5b` skyline · `68c8eb7` traffic · `add4f15` keel · `440484e` plaza dressing · final: this commit (convergence docs, handoff). `main`, `nrvna/integration` untouched; nothing merged, nothing deployed.
- Wall clock: 2026-10-15 22:40 → 2026-10-16 ≈ 00:25 PDT (≈ 1 h 45 min). Elapsed ≈ productive: no idle waiting; builds / probes ran while work continued where possible.

## 2. What is playable now

| Place / move | What you get |
|---|---|
| **Hub** (`/`) | The M1 Hub, now a 124 × 98 m floating island 140 m up: deck, parapets, lamps, edge benches with signs *MUSIC DISTRICT ↓* / *FASHION / CULTURE ↓*; downtown towers rise behind the spire from the arrival; M1 reactions intact (spire wake, overlook, Core house, return glows, discovery frames) |
| **The Drop** | Walk off the south tongue (behind the spawn) — a ≈ 6 s steerable descent over the city into **Skyfall Plaza**; no teleport, no loading screen |
| **Skyfall Plaza** (`?destination=dst_8w1j39h5e0ezrsjh`, *The City*) | landing ring that lights under you, sky-lift beam into the keel, planters, masts, kiosks, signs to the districts |
| **Walking the city** | 3 × 3 cells (600 × 600 m) — streets, storefronts, trees, crossings, lamps; walk west to **Music**, east to **Fashion / Culture**, north up **North Row** (downtown framed at the end), anywhere to the Ring; cells stream seamlessly |
| **Sky lifts** | plaza / Music / Fashion → Hub; Hub gateways → Music / Fashion — with a dusk "SKY LIFT" veil |
| **Music, The Club, Fashion, Brand, Artist** | all M1 flows preserved (6 / 6 walked with real input) — the Club is now a building on the Music cell |
| **Roof garden** (secret) | follow the studs north of the plaza; two ramps to an 8 m roof with the fourth sigil; all four sigils light the Drop's lintel |
| **21+** | unchanged: refused at the gate, never fetched, never streamed or proxied; the compound sits beyond the Ring |

## 3. What remains placeholder

All committed art is procedural / primitive: the far-field city (generated buildings with canvas-texture windows), the Hub, districts, Club and plaza (box / cylinder / sphere composition). No avatars / audio / signage art beyond text labels. Interiors of city buildings do not exist (colliders only). Trees and lamps are visual only (no collision). Traffic is light points only.

## 4. Source / licence status of every model touched

**No model is used in the committed build.** Local-only audition (outside the repo; dev-only route):

| Model | Evidence | Status | Audition finding |
|---|---|---|---|
| 80s Warehouse (DaveAlmz) | Sketchfab `CC.txt`: CC BY 4.0 | **not cleared** — attribution + embedded third-party artwork / song lyric on walls need review | strongest Club skin (4.8 MB optimised) |
| Venue stage for great events (QuarizonStudio) | CC BY 4.0 notice | not cleared | Grand Hall quality; 565 k tris → decimate |
| Art Gallery (denis_cliofas) | CC BY 4.0 notice | not cleared | clean gallery; heavy (28.9 MB) |
| Metallic Showroom (jimbogies) | CC BY 4.0 notice | not cleared | not a showroom shell (24 × 1.3 × 18 m) — inspect before use |
| Brutalist venue, Vilnius (Meshkamenas) | CC BY 4.0 notice | not cleared (depicts a real building) | scale model — sculpture prop only |
| Concert hall 1, TV01 stage, VR gallery house, Art Gallery 2 | CC BY 4.0 notices | not cleared | measured only: 19 k draw calls / no bounds / invalid / no top-level GLB → rejected as-is |
| 3DRT Megacity v1.7 | ZIP holds only a link to 3DRT's per-purchaser, no-redistribution licence; no receipt; unusual filename suffix | **UNKNOWN entitlement** | 2 km city level: 39 k tris, 15 draw calls, 12.7 → **4.2 MB** optimised; towers to 235 m pierce the Hub airspace |

## 5. Tests and measured performance

- App tests **520** (30+ files incl. new: streaming controller, handoff / walked-into / streaming validation, M2 world invariants, sky lift, local-audition route); manifests **61**; `tsc` + strict typecheck; `spatial:check` (16 files, within the raised 192 KiB / 160-component warning budgets); `compose --check`; manifests `check`.
- **Production `browser:perf` PASSED** (headless Chrome, host GTX 1050): desktop **112 draw calls / 175 k frame triangles / 56.4 fps vsync-capped (p95 18.1 ms) / JS heap 43 MB**; mobile-emulated **104 / 173 k / 56.1 fps / 78 MB**; warm reload 0 wire bytes; travel Hub → Music → Hub arrives. (Pre-visual-pass: 108 / 85 k.) Layer artifact 279 KB raw / **76 KB gzip**; city chunks ≈ 2 KB gzip.
- **`browser:touch`**: first run 1 failure (scenario A cycle 5: 0.41 m vs a 0.5 m threshold — the avatar slides against the Core house ahead of the spawn), immediate rerun **PASSED** (0.91 m). Both runs: Hub → 21+ `gateRequired` with **zero** cannabis requests. Recorded as a marginal probe, not a fix.
- SIC: elevation study (5 elevations × 10 eyes), composition pass on the generated scene (lift pads, ramps, sightlines), world invariants as tests.
- Hosted CI: **not run** — GitHub-hosted Actions capacity for NRVNAVerse is not to be expanded (Key guardrails); local verification above is the evidence. Not a failure, not a pass.

## 6. Unresolved concerns / decisions for the owner

1. **Rights review** of any model before use (Sketchfab notices are evidence, not clearance; the warehouse embeds third-party content). 3DRT entitlement must be proven (receipt / account) before any kit asset enters a build.
2. **New stable id** `dst_8w1j39h5e0ezrsjh` (*The City*, kind `district`, slug `city`) — a product naming call; reversible until published.
3. **World-layout decisions taken autonomously** (reversible, owner review per Governance rule 9): Hub at 140 m, the Drop on the south edge, districts as city cells west / east, The Club on the Music cell, the 21+ compound beyond the Ring to the north, downtown north behind the spire.
4. Budgets raised (warning-only) to 192 KiB / 160 components with rationale (collider-only city kits).
5. The far field is app-rendered three.js (upstream `space.add` pattern), not engine components — a deliberate measured choice (engine `mesh` cannot instance); worth an upstream-friendly discussion later.
6. Real-device mobile still unverified (emulation only); the layer adds ~20 canvas textures and ~190 k scene triangles.

## 7. Preview (Windows PowerShell 5.1)

```powershell
D:
Set-Location D:\AWE\awe
git status
git fetch origin
git checkout feat/m2-megacity-foundation
git pull --ff-only origin feat/m2-megacity-foundation
pnpm install --frozen-lockfile
pnpm --filter the-nrvnaverse build
pnpm --filter the-nrvnaverse start
# browser: http://localhost:3000/            (the Hub; add ?debug=1 for diagnostics)
#          http://localhost:3000/?destination=dst_8w1j39h5e0ezrsjh   (Skyfall Plaza)
```

Local-only art audition (development server; files stay in D:\AWE-Scratch):

```powershell
Set-Location D:\AWE\awe
$env:NRVNA_AUDITION_DIR = "D:\AWE-Scratch\m2\audition\serve"
pnpm --filter the-nrvnaverse dev
# http://localhost:3000/?destination=dst_8w1j39h5e0ezrsjh&audition=lineup   (venue rooms around the plaza — walk inside them)
# http://localhost:3000/?destination=dst_7g19n1vm9ackw8a0&audition=city     (the 3DRT Megacity level in place of the procedural buildings)
```

## 8. Playtest path

Hub: wait 3 s (spire wakes; downtown behind it) → turn round → walk through the Drop frame and off the tongue (steer while falling) → land on Skyfall Plaza → look up (keel, lift beam) → walk west along the avenue into the Music District (location label changes) → the Club door → back out → Music's sky-lift pad → Hub (veil) → east gateway → Fashion → runway → Brand → walk out west to the plaza → north exit, follow the studs to the roof garden (two ramps) → the plaza sky lift back up (the Drop frame glows).

## 9. Next

Recommended next milestone: owner playtest; rights review of the warehouse / venue stage; then a bounded "real venue skins" task through the asset contract (human `reviewedBy`), and district identity in the far field. Do not merge; do not deploy.
