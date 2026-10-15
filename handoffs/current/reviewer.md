# Implementer Handoff — M1 Spatial Experience Overnight Campaign

## Baton

NEXT: CHATGPT  
LAST: CLAUDE  
STATE: AWAITING_REVIEW — **READY FOR OWNER PLAYTEST / REVIEW**  
BRANCH: `feat/m1-spatial-experience-overnight` (pushed; working tree clean at the final commit)

Durable record (read first): `docs/NRVNAVERSE_M1_EXPERIENCE_CAMPAIGN.md` (checkpoints, evidence, findings, queue). World truth incl. secrets: `docs/NRVNAVERSE_HUB_WORLD.md` §12–§16. Contracts: pipeline doc §17–§18, runtime doc §17–§19. Direction docs annotated: `NRVNAVERSE_VENUES_EVENTS_WEB_SPATIAL.md` (two proof notes).

## 1–4. Commits, duration

- Start `26e6030` (docs-only handoff on the creative checkpoint `1ac1740`). Checkpoints: `0798e71` record · `1157b64` experience layer · `213b038` venue complex · `534c8a8` Club tuning + seam scaffolding · `7d54c26` WEB↔SPATIAL thresholds · `4ba9bb6` discovery memory · final: this commit (convergence: docs, handoff). Base `nrvna/integration@19562bc` is untouched; `main` untouched.
- Wall clock ≈ 12.5 h (2026-10-14 23:05 → 2026-10-15 ≈ 11:45), with one pause at the account usage limit (resumed from the record, nothing repeated).

## 5. What materially changed for a visitor

The composed world now **behaves**. Hub: the spire wakes ring by ring after every arrival; the gateway you came back through glows for six seconds; the overlook lamp lights while you are on the deck; the Core house interior answers with a halo and a brighter well; the dormant frames on the overlook wake as you find the hidden places. Music: the speaker stacks light as you walk the path (a soundcheck trail); reaching the stage lights the fins centre-out and a wash completes it; the sound booth throws a spotlight on the stage while you are up there; the floor is now a **concourse** with tonight's marquee and a door to **The Club**. Fashion: the pylons light as you walk the runway; the gallery frames light while you stand in the loggia and one by one on arrival; the roof lamp lights on the terrace; the atelier wakes when entered. Thresholds open the **web window** with the canonical web context of what you are standing in front of. The three hidden places hold **sigils** the browser remembers; the Hub reads the memory back on your next visit.

## 6. Music venue / concourse architecture

Adding a venue room = a chunk + a `venue` manifest + a placement + two portal bindings + a composer (plus the count-pinned tests). **The Club** (`music-club`, `dst_gqq90k2404cy9nf0`) is the first independently loadable room: 22 × 20 m, low stage with ramp, console, bar with back-light, three booths, nine-tile dance floor, hanging drum lamps with floor pools, its own wake / dance-floor / stage reactions through the unchanged experience system. `TONIGHT` / `VENUE_ROOMS` / `CLUB_TEMPLATE` are authoring-level "select your stage" scaffolding (D-018 vocabulary kept distinct); no event backend was built (D-019).

## 7. Vault venue audition (SIC `inspect_asset`, read-only; nothing placed or copied)

Eight candidates measured (world doc §13 table). Strongest library candidates: `Nightclub1 v1.1` (2.5 k tris, 6.6 MB, 11 textures ≈ 187 MB GPU) and `80s-warehouse v1.0` (75 k tris, 4.3 MB) — **optimize / derive**; `Airplane Hanger 1.3` concert-stage sub-tree — **inspiration / partial derive**; cinema, Scifi Hall, Warehouse FBX, lounge shell — reject; `Elysium v1.20` — inspiration only (1 M tris). **All rights UNKNOWN** (Sketchfab origins or unproven owner authorship); nothing is cleared for production.

## 8–9. WEB↔SPATIAL proof and cross-surface discovery

Mechanism built: a **threshold** (sensor → stable id, portal-shaped, never travels, never holds a URL) opens an application-owned **web window** showing a same-origin page `/web-context/<id>` derived from the manifests (name, kind, district, description, canonical `webUrl` opening in a new tab so the world never leaves, stable-id spatial link back). Three thresholds: in front of the Club door under the marquee, in front of the gallery frames, at the Club bar. **Limitation found and documented** (runtime doc §18): the engine's in-world `iframe` forces absolute `https://` URLs, so static chunk data cannot target a deployment-relative page, and framing the canonical site would depend on its frame policy (Cloudflare, no frame directive observed — not relied on); the in-world CSS3D surface is deferred behind a deployment-aware URL seam. Discovery memory (world doc §15) persists `{ v: 1, found: [...] }` in `localStorage` — a shape a web counterpart can read or share (D-021: nothing restricted behind it).

## 10. Hub / Music / Fashion experiential changes

13 zones, 7 arrival rules, 3 thresholds, 3 sigils; every effect is a visibility toggle over authored state geometry, hidden on staging so nothing flashes; no HUD quests, no counters. Component counts: hub 92, music 93, fashion-culture 93 (warning budget 96 / 128 KiB — little headroom; raise with rationale before adding geometry), music-club 62.

## 11. SIC evidence used (design → build → measure → refine)

`bounds` of zone anchors before authoring; `in_region` / `intersects` / `survey_visibility` after every composition (zones contain their anchors; no zone or threshold penetrates a portal, ramp, wall or the beam ring; lit geometry visible from its intended eyes with measured fractions); `inspect_asset` for the vault audition. Limitations handed back (campaign record §5): no way to declare runtime-hidden state in visibility surveys; `passable` needs an `opening` role the AWE adapter cannot mark; text labels are markers (no visibility).

## 12–15. Mobile, performance, gate, local checks

Official probes on the final production build (2026-10-15 11:33): `browser:perf` **PASSED** (desktop 163 draw calls / 23.9 k triangles / 56 fps vsync-capped / JS heap ≈ 30 MB; mobile-emulated 154 calls / 25.9 k triangles / heap ≈ 24 MB; immutable caching intact, 0 wire bytes on warm reload; travel Hub → Music → Hub arrives) and `browser:touch` **PASSED** (joystick / look / jump ownership, orientation, directory; Hub → Cannabis ends `gateRequired` with **zero** cannabis chunk requests). Local: manifests 61 tests + check, app **484** tests, strict typecheck, `spatial:validate/generate/check` (within budget), `compose --check`, headless Mover proofs (16 sensors enter/exit; Club walk onto the stage), real-input browser probes for every reactive beat, the Club door, the web window (open / dismiss / re-enter / close on travel) and the discovery memory (a real find on the booth, the Hub's answer, a seeded three-sigil memory). The reveal fade (≈1 s) hides arrival beats shorter than ≈1.2 s on an initial placement — beats were retimed.

## 16. Hosted CI

Not run: GitHub-hosted Actions capacity is exhausted (Key constraint). Recorded as **pending due to Actions quota**, not as a failure; local verification above is the working evidence.

## 17. Known defects / limitations

- Component budgets nearly full in hub / music / fashion-culture (warning-only).
- Club lighting and the stage approach were tuned from single browser passes; a human eye pass is due (the drum lamps replaced 7 m discs that read as cyan plates).
- The character controller jams when sliding diagonally along a 0.6 m riser; ramps remain the rule (the Club has one).
- Real-device mobile is still emulated only; the web window on phones yields to the open directory.
- The Core and atelier finds were proven by the same zone path as the booth (browser-proven), not walked in a browser.

## 18. Playtest path (production build)

`pnpm --filter the-nrvnaverse build` → `pnpm --filter the-nrvnaverse start` → open `/` (add `?debug=1` for the diagnostics panel incl. zones / thresholds / remembered). Hub: wait 3 s (spire wakes); up a ramp to the terrace, along to the overlook (lamp lights); round the back of the Core house (interior wakes; the sigil is on the east side). Music: walk the path (stacks light), onto the stage (crescendo); turn round → marquee and Club door → stand in front of the door (web window) → through the passage → The Club (room wakes, dance floor, ramp to the stage, bar threshold); back out, then to the Hub through the Music gateway (return glow). Fashion: runway → loggia (frames; web window in front of them) → roof → round the north wall's west end into the atelier. Return to the Hub to see the frames remember.

## 19–20. Next and owner decisions

Next milestone: a human eye pass on the Club; the audio layer (an application-owned WebAudio analyser driving the existing seams; a cleared track as an `audio` component); per-song arrival states and the artist-room configuration (world doc §16 design notes); raise the budgets before more geometry. Owner decisions: rights review for Nightclub1 / 80s warehouse before derivation; Eddie asset clearance and the artist room's name / kind; whether the discovery memory should get a web counterpart.

Do not merge; do not deploy.
