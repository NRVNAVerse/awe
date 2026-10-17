# NRVNAVerse Blender Authoring — contract v1 (owner guide)

| Field | Value |
|---|---|
| **Status** | **VERIFIED** on `feat/m3-blender-camera-foundation`: synthetic fixtures built by Blender 5.1.2, exported by Spatial Intelligence Core 0.4.0's read-only bridge, imported and checked (`test/authoring-importer.test.ts`, `test/gallery-exhibitions.test.ts`). Not yet tried on the owner's real city scene. |
| **Code** | `apps/the-nrvnaverse/scripts/authoring/` (contract, importer, SIC checks, dry-run CLI) · `scripts/blender/build-authoring-fixture.py` · fixtures in `spatial/authoring/blender/` |
| **Safe by construction** | The dry run never saves, edits or publishes: the `.blend` is opened read-only by SIC's bridge and its SHA-256 is compared before and after; reports are written outside the repository (refused inside it). Nothing is placed in the world without a reviewed commit. |

You compose in Blender; NRVNAVerse reads your placement, rotation, scale and material choices **exactly as authored** and tells you what it cannot use. It never "fixes" your scene.

## 1. Scene setup

| Setting | Required value | Why |
|---|---|---|
| Scene ▸ Units | **Metric**, Length **Meters**, Unit Scale **1.0** | 1 Blender unit = 1 metre. Another unit scale is converted but reported (`scene-unit-scale`). |
| Up axis | Blender's normal **Z up** | Converted for you. |
| World origin | Blender (0, 0, 0) = the NRVNAVerse world origin (the centre of Skyfall Plaza at street level) | Author things where they stand in the world; nothing is re-centred. |
| North | Blender **+Y** (top view: up the screen) = NRVNAVerse north (−Z) | A Blender Z-rotation of θ is the same yaw θ in the world. |
| Object scale | Apply scale (Ctrl+A) unless you mean it | Object scale is preserved, but 100 or 0.01 on any axis is flagged as a probable cm / mm import (`suspect-unit-scale`). |

Useful world facts (from the M2 world): city ground is y = 0 (Blender z = 0); streaming cells are 200 m squares centred on multiples of 200; the walkable region is ±300 m around the origin; the Hub floats at 140 m. Example: Gallery One's door is at Blender (33.8, −150, 0.1).

## 2. Collections

Top-level collections, exact names. Nested collections inherit their top-level role (e.g. `GALLERIES › gallery-one`).

| Collection | Holds |
|---|---|
| `CITY` | streets, blocks, plazas, forecourts, city buildings |
| `VENUES` | stages, clubs, halls (venue shells) |
| `GALLERIES` | gallery buildings (walls, floors, signs) |
| `MARKERS` | **Empty** objects only (§3) |
| `DECORATION` | furniture, planters, props |

An object outside these is imported with a warning (`uncategorised-object`). Geometry inside `MARKERS` is flagged (`geometry-in-markers`).

## 3. Markers — Empty objects with exact names

A marker is an **Empty** (Add ▸ Empty). It must not be a mesh (`marker-not-empty`). Its name is `<kind>:<slug>`; slugs are lowercase kebab-case (`gallery-one`, `east-01`). An anchor names its gallery: `anchor:<gallery-slug>:<anchor-slug>`.

**Facing:** a marker faces its local **+Y** axis — the green arrow of an *Arrows* empty. Rotate markers about Z only; any tilt is reported and ignored (`marker-tilted`). **Volumes:** use the *Cube* empty display; the box is the empty's display size × its scale (display size 1, scale (14, 10, 2.5) → 28 × 20 × 5 m).

| Kind | Name | Display | Means | Optional custom properties |
|---|---|---|---|---|
| spawn | `spawn:<destination-slug>` | Arrows | where a visitor arrives: feet on the floor, facing the view you want first. The world places them 0.9 m above it (as every spawn) | — |
| entrance | `entrance:<slug>` | Arrows | doorway threshold, facing **into** the place | — |
| exit | `exit:<slug>` | Arrows | doorway threshold, facing **out** | — |
| sky lift | `skylift:<slug>` | Circle | sky-lift pad centre | `nrvna_radius` (m) |
| the Drop | `drop:<slug>` | Arrows | walk-off release edge, facing the jump | — |
| portal | `portal:<slug>` | **Cube** | trigger volume that travels to a destination | `nrvna_destination` (a `dst_…` id) |
| gallery | `gallery:<gallery-slug>` | **Cube** | the gallery's interior volume; its slug is the gallery's key | — |
| anchor | `anchor:<gallery-slug>:<anchor-slug>` | Plain Axes | an exhibit position inside that gallery, facing the viewer. **Wall:** on (or a few cm proud of) the wall at the work's centre height; the work hangs in front of it. **Floor:** on the floor; the work stands on it | `nrvna_max_width`, `nrvna_max_height` (m) |
| interaction | `interact:<slug>` | Sphere | where a visitor stands to use something, facing it | `nrvna_radius` (m) |
| chunk | `chunk:<chunk-key>` | **Cube** | a streaming chunk's boundary volume | — |

Blender renames a duplicated object `name.001`; a duplicated marker is an error (`marker-duplicate`). Unknown kinds (`door:…`) and bad slugs (`spawn:Lobby_Main`) are errors.

**Status per kind:** all ten kinds are parsed, converted and validated (VERIFIED). Consumed by the world today: `spawn`, `exit` (facade orientation), `gallery`, `anchor` (Gallery One, §6). `entrance` is checked (clearance, SIC) and recorded. `skylift`, `drop`, `portal`, `interact`, `chunk` are recorded in the manifest with clearance / ground checks but **not yet wired** to runtime behaviour (PLANNED).

## 4. Identity, materials and texture variants

- **Identity:** the Blender object name is the source identity. Give objects whose identity must survive renames a custom property `nrvna_id` (string, e.g. `gallery-one.wall-north`); duplicates are errors.
- **Materials:** every slot is kept in order with its name. Choose variants by material name `<base>--<variant>` (`gallery_wall--warm`); never rely on Blender's `.001` copies (`material-auto-copy`).
- **Textures:** keep images next to the `.blend` (e.g. `textures/`, relative paths) or pack them. A texture Blender cannot load is an error (`missing-texture`); one outside the `.blend`'s folder is a warning (`texture-outside-project`).

## 5. What reaches the world

| Authored geometry | Today |
|---|---|
| Exact boxes (8 vertices, any position / rotation / scale) | Become blockout `mesh` boxes, placed exactly as authored, coloured by **material name** through a palette (`spatial/authoring/gallery.mjs`) — VERIFIED for Gallery One |
| Any other mesh (cylinders, detailed models) | Listed as `needs-asset`: it can only enter the world as a **reviewed runtime asset** (asset contract, human `reviewedBy`), never automatically |
| Textures | Recorded (which variant, which image); not shipped — real art goes through the asset contract |
| Cameras, lights | Ignored (`unsupported-type`) |
| Collection / geometry-node instances, armatures, animation | Not expanded / not read (`instancing-not-expanded`) |

Nothing from the vault or any third-party model is committed; the fixtures are synthetic and self-authored.

## 6. Galleries: the room stays, the show changes

A gallery is `gallery:<slug>` + its walls in `GALLERIES` + `spawn:<slug>`, `entrance:<slug>`, `exit:<slug>` + `anchor:<slug>:…`. Exhibitions (`spatial/source/exhibitions/<slug>.exhibition.json`) name anchors, never coordinates; `spatial/source/gallery-assignments.json` says which one is on show. Switching (`pnpm --filter the-nrvnaverse gallery:assign gallery-one night-signals`) changes exactly one chunk; the building, door, arrival and destination id stay (tested). Lessons from Gallery One (SIC): **keep floor anchors off the line from the arrival point to the wall works** — a 2.4 m column on the entrance axis hid the centre work completely.

## 7. The dry run

```powershell
Set-Location D:\AWE\awe
pnpm --filter the-nrvnaverse authoring:inspect "D:\path\to\your-scene.blend"
# optional: --out D:\AWE-Scratch\dryrun\my-scene   (default: %TEMP%\nrvnaverse-authoring\<name>)
# optional: --no-sic   (skip the spatial checks)
```

Needs Blender (`SIC_BLENDER`, else the newest under `C:\Program Files\Blender Foundation`) and SIC (`SIC_ROOT`, default `C:\Dev\spatial-intelligence-core`). Output: `report.md` (read this), `report.json`, `manifest.json` (everything as authored, NRVNAVerse frame), SIC's `blender-export.json`. Exit code 0 = no errors, 1 = errors to fix, 2 = tools missing.

What it checks:

| Check | By | Code (level) |
|---|---|---|
| marker names, kinds, slugs, duplicates, Empties only, Cube volumes, tilt | importer | `marker-*` (error / warning) |
| anchors inside their gallery; gallery spawn inside; galleries with anchors | importer | `anchor-outside-gallery`, `anchor-unknown-gallery` (error), `gallery-spawn-outside`, `gallery-without-anchors` (warning) |
| units, suspect scale / size, zero / mirrored / sheared transforms | importer | `scene-unit-scale`, `suspect-unit-*`, `degenerate-transform` (error), `mirrored-transform`, `shear-transform` |
| textures loaded / inside the project, material copies | importer | `missing-texture` (error), `texture-outside-project`, `material-auto-copy` |
| a visitor fits at every spawn / entrance / exit / interaction (and sky lift / drop) | SIC `capsule_fits` | `marker-blocked` (error for the first four) |
| ground under standing markers | SIC `line_of_sight` | `marker-no-ground` |
| anchors in sight from the gallery's spawn eye | SIC `line_of_sight` | `anchor-sightline-blocked` |
| geometry interpenetration (exact, for overlapping bounds) | SIC `intersects` | `geometry-interpenetration` |

Verified behaviour: Gallery One → 0 errors, 0 warnings (18 SIC questions). The coverage fixture's seeded defects are all reported, including the two only geometry can find (a spawn inside a wall: SIC clearance −0.6 m; two overlapping buildings: SIC penetration 4 m).

## 8. Fixtures (regenerate, never hand-edit)

`spatial/authoring/blender/<name>.spec.json` describes a synthetic scene in the NRVNAVerse frame; `pnpm --filter the-nrvnaverse authoring:fixture <name>` builds it in Blender (scratch folder), exports it through SIC and writes the portable `<name>.blender-export.json` (no machine paths, no triangle arrays). `gallery-one` is the world's Gallery One shell; `contract-coverage` holds one valid example of every marker kind plus seeded defects.

## 9. Limitations

- Tested with Blender 5.1.2 (SIC's bridge documents 4.4; it works on 5.1 for these fixtures — re-verify on the real scene).
- Exact-box blockout only; everything else waits for the asset contract. Material colour comes from a palette keyed by material name, not from Blender's shader.
- Modifiers are evaluated with viewport settings; instances are not expanded; one scene per file.
- The SIC navmesh needs `cell_size_m` ≥ 0.4 for a whole-city scene (the dry run does not run navmesh reachability; the M3 world pass did).
- Walking into Gallery One from the street does not change the displayed location (it is part of the South Row cell); directory travel and deep links do.
