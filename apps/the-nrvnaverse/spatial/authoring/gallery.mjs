// @ts-check
/**
 * Permanent galleries with interchangeable exhibitions (M3 Mission C). Pure and deterministic.
 *
 * Three separate things, three separate sources:
 *
 *   VENUE SHELL   the building as the owner authored it in Blender — walls, floor, forecourt,
 *                 furniture, and its markers (spawn, entrance, exit, gallery volume, exhibit
 *                 anchors). Source: `blender/<key>.blender-export.json` (SIC's read-only export of the
 *                 .blend), read through the authoring importer, placed exactly where it was authored.
 *   EXHIBITION    what hangs on the walls and stands on the floor. Source:
 *                 `../source/exhibitions/<slug>.exhibition.json`. A work names an anchor SLUG
 *                 (`east-02`), never a coordinate, so an exhibition fits any gallery that has the
 *                 anchors it uses and never moves a wall.
 *   ASSIGNMENT    which exhibition a gallery shows now. Source: `../source/gallery-assignments.json`.
 *
 * The gallery's identity (stable destination id), its plot, entrance and arrival point come from
 * the shell alone: switching the assignment changes only the exhibition components (tested).
 * Exact-box Blender objects become blockout `mesh` boxes coloured by their material NAME (the
 * palette below); any other geometry needs a reviewed runtime asset and is listed, not placed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importBlenderExport } from "../../scripts/authoring/importer.mjs";
import { box, column, label, sphere, v } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(here, "..", "source");
export const EXHIBITIONS_DIR = join(SOURCE_DIR, "exhibitions");
export const ASSIGNMENTS_PATH = join(SOURCE_DIR, "gallery-assignments.json");

/** Feet → spawn: the visitor is placed this far above an authored spawn marker (as every M0–M2 spawn). */
export const SPAWN_DROP = 0.9;

/** Permanent galleries. `destinationId` is identity (manifest); everything physical comes from the shell. */
export const GALLERIES = Object.freeze([
  { key: "gallery-one", name: "GALLERY ONE", destinationId: "dst_3kacg0rqgyfnp7fm", chunkKey: "city-south", shell: "blender/gallery-one.blender-export.json" },
]);

/** Blockout colours by Blender material name (base or `base--variant`); real art replaces them through the asset contract. */
export const MATERIAL_PALETTE = Object.freeze({
  gallery_floor: "#b08d63",
  gallery_wall: "#efede6",
  "gallery_wall--warm": "#f1e3cf",
  paving_stone: "#8a8478",
  bench_wood: "#6b4a32",
  sign_black: "#1d1d1f",
});
const UNMAPPED_COLOR = "#8c8c8c";

const TAGS = Object.freeze({ shell: "m3-gallery-shell", work: "m3-gallery-work", text: "m3-gallery-text" });

/**
 * Interior exhibition content is never part of the far-field proxy: an exhibition switch must change
 * exactly one chunk and nothing else (the layer shows the building, not the show).
 * @param {Record<string, any>} components
 */
export function withoutExhibitions(components) {
  return Object.fromEntries(Object.entries(components).filter(([, c]) => c?.script?.tag !== TAGS.work));
}

/** @typedef {import("../../scripts/authoring/importer.mjs").MarkerRecord} MarkerRecord */
/** @typedef {import("../../scripts/authoring/importer.mjs").ObjectRecord} ObjectRecord */
/**
 * @typedef {{ anchor: string; kind: "canvas" | "signal" | "column" | "orb" | "stack" | "wall-text"; title: string; text?: string; size: [number, number]; colors: string[] }} Work
 * @typedef {{ format: string; id: string; slug: string; title: string; subtitle: string; credit: string; works: Work[] }} Exhibition
 */

const WALL_KINDS = new Set(["canvas", "signal", "wall-text"]);
const FLOOR_KINDS = new Set(["column", "orb", "stack"]);

/** @type {Map<string, { manifest: any; skipped: string[] }>} */
const shellCache = new Map();

/** The imported shell of a gallery (cached; throws on any importer error — a broken shell never composes). @param {typeof GALLERIES[number]} g */
export function gallerySource(g) {
  const cached = shellCache.get(g.key);
  if (cached) return cached;
  const { manifest, findings } = importBlenderExport(JSON.parse(readFileSync(join(here, g.shell), "utf8")));
  const errors = findings.filter((f) => f.level === "error");
  if (!manifest || errors.length > 0) throw new Error(`gallery "${g.key}" shell has authoring errors: ${errors.map((e) => `${e.code} ${e.subject}`).join("; ")}`);
  const skipped = manifest.objects.filter((o) => !o.box).map((o) => o.name);
  const out = { manifest, skipped };
  shellCache.set(g.key, out);
  return out;
}

/** @param {any} manifest @param {string} kind @param {string} slug */
function marker(manifest, kind, slug) {
  const m = manifest.markers.find((/** @type {MarkerRecord} */ x) => x.kind === kind && x.slug === slug);
  if (!m) throw new Error(`missing ${kind}:${slug} marker`);
  return /** @type {MarkerRecord} */ (m);
}

/** The ground plan rectangle a gallery reserves in the city (shell objects' bounds + 1 m). @param {typeof GALLERIES[number]} g */
export function galleryPlot(g) {
  const { manifest } = gallerySource(g);
  const objects = /** @type {ObjectRecord[]} */ (manifest.objects).filter((o) => o.bounds && o.collection !== "MARKERS");
  const x0 = Math.min(...objects.map((o) => /** @type {any} */ (o.bounds).min[0]));
  const z0 = Math.min(...objects.map((o) => /** @type {any} */ (o.bounds).min[2]));
  const x1 = Math.max(...objects.map((o) => /** @type {any} */ (o.bounds).max[0]));
  const z1 = Math.max(...objects.map((o) => /** @type {any} */ (o.bounds).max[2]));
  return /** @type {[number, number, number, number]} */ ([Math.floor(x0 - 1), Math.floor(z0 - 1), Math.ceil(x1 + 1), Math.ceil(z1 + 1)]);
}

/** Reserved plots, keyed by gallery key (merged into the city plan's PLOTS). */
export const GALLERY_PLOTS = Object.freeze(Object.fromEntries(GALLERIES.map((g) => [g.key, galleryPlot(g)])));

/** Arrival placements in the world frame (merged into compose's spawns). */
export const GALLERY_SPAWNS = Object.freeze(
  Object.fromEntries(
    GALLERIES.map((g) => {
      const s = marker(gallerySource(g).manifest, "spawn", g.key);
      return [g.destinationId, { chunkKey: g.chunkKey, position: { x: s.position[0], y: s.position[1] + SPAWN_DROP, z: s.position[2] }, yaw: s.yaw ?? 0 }];
    }),
  ),
);

/** Every exhibition fixture, by id. */
export function loadExhibitions() {
  /** @type {Map<string, Exhibition>} */
  const out = new Map();
  for (const file of readdirSync(EXHIBITIONS_DIR).filter((f) => f.endsWith(".exhibition.json")).sort()) {
    /** @type {Exhibition} */
    const ex = JSON.parse(readFileSync(join(EXHIBITIONS_DIR, file), "utf8"));
    if (ex.format !== "nrvna.exhibition/1") throw new Error(`${file}: not an nrvna.exhibition/1 document`);
    if (!/^exh_[0-9abcdefghjkmnpqrstvwxyz]{16}$/.test(ex.id)) throw new Error(`${file}: invalid exhibition id "${ex.id}"`);
    if (`${ex.slug}.exhibition.json` !== file) throw new Error(`${file}: slug "${ex.slug}" does not match the file name`);
    if (out.has(ex.id)) throw new Error(`${file}: duplicate exhibition id ${ex.id}`);
    out.set(ex.id, ex);
  }
  return out;
}

/** The committed assignment (gallery key → exhibition id). */
export function loadAssignments() {
  const doc = JSON.parse(readFileSync(ASSIGNMENTS_PATH, "utf8"));
  if (doc.format !== "nrvna.gallery-assignments/1") throw new Error("gallery-assignments.json: not an nrvna.gallery-assignments/1 document");
  return /** @type {Record<string, string>} */ (doc.assignments);
}

/** @param {number} yaw Unit vector a marker faces. */
const facing = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];
/** Text faces the viewer standing in front of an anchor (a text plane's normal is its local +Z). @param {number} yaw */
const textRotation = (yaw) => ({ x: 0, y: Math.round((yaw + Math.PI) * 10000) / 10000, z: 0 });
/** @param {number[]} p @param {number[]} d @param {number} s */
const along = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];

/**
 * Check an exhibition against a gallery's anchors (throws with every problem listed).
 * @param {Exhibition} ex @param {any} manifest @param {string} galleryKey
 */
export function validateExhibition(ex, manifest, galleryKey) {
  /** @type {string[]} */
  const problems = [];
  const volume = marker(manifest, "gallery", galleryKey).volume;
  const floorY = volume ? volume.bounds.min[1] : 0;
  const used = new Set();
  for (const w of ex.works) {
    const a = manifest.markers.find((/** @type {MarkerRecord} */ m) => m.kind === "anchor" && m.gallery === galleryKey && m.slug === w.anchor);
    if (!a) {
      problems.push(`work "${w.title}": gallery ${galleryKey} has no anchor "${w.anchor}"`);
      continue;
    }
    if (used.has(w.anchor)) problems.push(`anchor "${w.anchor}" is used twice`);
    used.add(w.anchor);
    const onFloor = a.position[1] - floorY < 0.3;
    if (WALL_KINDS.has(w.kind) && onFloor) problems.push(`work "${w.title}" (${w.kind}) needs a wall anchor; "${w.anchor}" is on the floor`);
    if (FLOOR_KINDS.has(w.kind) && !onFloor) problems.push(`work "${w.title}" (${w.kind}) needs a floor anchor; "${w.anchor}" is on a wall`);
    if (!WALL_KINDS.has(w.kind) && !FLOOR_KINDS.has(w.kind)) problems.push(`work "${w.title}": unknown kind "${w.kind}"`);
    const maxW = Number(a.props.nrvna_max_width ?? Infinity);
    const maxH = Number(a.props.nrvna_max_height ?? Infinity);
    if (w.size[0] > maxW || w.size[1] > maxH) problems.push(`work "${w.title}" (${w.size.join(" × ")} m) exceeds anchor "${w.anchor}" (${maxW} × ${maxH} m)`);
  }
  if (problems.length > 0) throw new Error(`exhibition ${ex.slug} in ${galleryKey}: ${problems.join("; ")}`);
}

/**
 * The venue shell's components (identical whatever is on show).
 * @param {typeof GALLERIES[number]} g
 */
export function shellComponents(g) {
  const { manifest } = gallerySource(g);
  /** @type {Array<Record<string, unknown>>} */
  const items = [];
  for (const o of /** @type {ObjectRecord[]} */ (manifest.objects)) {
    if (!o.box || o.collection === "MARKERS") continue;
    const local = o.id.startsWith(`${g.key}.`) || o.id.startsWith(`${g.key}-`) ? o.id.slice(g.key.length + 1) : o.id;
    const id = `${g.key}-shell-${local.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
    const material = o.materials[0]?.name ?? null;
    const color = material && material in MATERIAL_PALETTE ? MATERIAL_PALETTE[/** @type {keyof typeof MATERIAL_PALETTE} */ (material)] : UNMAPPED_COLOR;
    const [rx, ry, rz] = o.box.euler;
    items.push(box(id, v(...o.box.center), o.box.size, { name: `${g.name} · ${o.name}`, color, rotation: { x: rx, y: ry, z: rz }, tag: TAGS.shell }));
  }
  // The venue's permanent name on the facade sign, facing the way out (the exit marker's direction).
  const sign = /** @type {ObjectRecord | undefined} */ (manifest.objects.find((/** @type {ObjectRecord} */ o) => o.id === `${g.key}.sign`));
  const exit = marker(manifest, "exit", g.key);
  if (sign?.box && exit.yaw !== null) {
    const out = facing(exit.yaw);
    const half = Math.min(sign.box.size[0], sign.box.size[2]) / 2;
    const p = along(sign.box.center, out, half + 0.03);
    items.push(label(`${g.key}-shell-name`, g.name, v(p[0], p[1], p[2]), { scale: 0.7, color: "#f4efe6", rotation: textRotation(exit.yaw), width: 900, name: `${g.name} · name` }));
  }
  return items;
}

/**
 * One exhibition's components in one gallery (positions from the gallery's anchors only).
 * @param {typeof GALLERIES[number]} g @param {Exhibition} ex
 */
export function exhibitionComponents(g, ex) {
  const { manifest } = gallerySource(g);
  validateExhibition(ex, manifest, g.key);
  /** @type {Array<Record<string, unknown>>} */
  const items = [];
  for (const w of ex.works) {
    const a = /** @type {MarkerRecord} */ (manifest.markers.find((/** @type {MarkerRecord} */ m) => m.kind === "anchor" && m.gallery === g.key && m.slug === w.anchor));
    const yaw = a.yaw ?? 0;
    const f = facing(yaw);
    const id = (/** @type {string} */ part) => `${g.key}-exh-${ex.slug}-${w.anchor}-${part}`;
    const rot = { x: 0, y: Math.round(yaw * 10000) / 10000, z: 0 };
    const [width, height] = w.size;
    const [c0, c1 = c0, c2 = c1] = w.colors;
    const common = { tag: TAGS.work, collider: /** @type {const} */ ("none"), castShadow: false };
    if (w.kind === "wall-text") {
      const p = along(a.position, f, 0.04);
      items.push(label(id("title"), w.title.toUpperCase(), v(p[0], p[1] + 0.35, p[2]), { scale: 0.5, color: c0, rotation: textRotation(yaw), width: 900, name: `${ex.title} · title` }));
      items.push(label(id("text"), w.text ?? "", v(p[0], p[1] - 0.2, p[2]), { scale: 0.22, color: c0, rotation: textRotation(yaw), width: 1500, name: `${ex.title} · wall text` }));
      continue;
    }
    if (w.kind === "canvas" || w.kind === "signal") {
      const depth = 0.06;
      const frame = along(a.position, f, 0.02);
      const face = along(a.position, f, 0.02 + depth / 2 + 0.01);
      items.push(box(id("frame"), v(frame[0], frame[1], frame[2]), [width + 0.12, height + 0.12, 0.04], { ...common, color: "#202022", rotation: rot }));
      items.push(box(id("ground"), v(face[0], face[1], face[2]), [width, height, depth], { ...common, color: c0, rotation: rot }));
      const front = along(a.position, f, 0.02 + depth + 0.02);
      if (w.kind === "canvas") {
        // Two stacked colour fields on the ground (a Rothko-like placeholder).
        items.push(box(id("field"), v(front[0], front[1] + height * 0.14, front[2]), [width * 0.82, height * 0.46, 0.01], { ...common, color: c1, rotation: rot }));
      } else {
        // Three thin light bars that glow.
        for (const k of [-1, 0, 1]) {
          items.push(box(id(`bar-${k + 1}`), v(front[0], front[1] + k * height * 0.28, front[2]), [width * 0.8, 0.06, 0.01], { ...common, color: c1, rotation: rot, plugins: [{ id: "FresnelGlowPlugin", color: c1, intensity: 1.6, power: 1.5, speed: 1, pulse: 0.2 }] }));
        }
      }
      const cap = along(a.position, f, 0.05);
      items.push(label(id("caption"), `${w.title}`, v(cap[0], a.position[1] - height / 2 - 0.3, cap[2]), { scale: 0.18, color: "#3a3a3a", rotation: textRotation(yaw), width: 900, name: `${ex.title} · ${w.title}` }));
      continue;
    }
    // Floor works stand on the anchor (its y is the floor top).
    const [x, y, z] = a.position;
    if (w.kind === "column") {
      items.push(column(id("column"), x, y, z, width / 2, height, { ...common, color: c0, collider: true }));
    } else if (w.kind === "orb") {
      const plinthH = height * 0.45;
      items.push(box(id("plinth"), v(x, y + plinthH / 2, z), [width * 0.7, plinthH, width * 0.7], { ...common, color: c0, collider: true }));
      items.push(sphere(id("orb"), v(x, y + plinthH + width / 2 - 0.05, z), width / 2, { ...common, color: c1, plugins: [{ id: "FresnelGlowPlugin", color: c1, intensity: 1.4, power: 2, speed: 1, pulse: 0.3 }] }));
    } else if (w.kind === "stack") {
      const parts = [0.42, 0.33, 0.25];
      let base = y;
      parts.forEach((share, i) => {
        const h = height * share;
        const s = width * (1 - i * 0.25);
        items.push(box(id(`block-${i + 1}`), v(x, base + h / 2, z), [s, h, s], { ...common, color: [c0, c1, c2][i], collider: true, rotation: { x: 0, y: Math.round((yaw + i * 0.35) * 10000) / 10000, z: 0 } }));
        base += h;
      });
    }
    const cap = along(a.position, f, width / 2 + 0.45);
    items.push(label(id("caption"), w.title, v(cap[0], y + 0.9, cap[2]), { scale: 0.18, color: "#3a3a3a", rotation: textRotation(yaw), width: 900, name: `${ex.title} · ${w.title}` }));
  }
  return items;
}

/**
 * Everything the galleries in one chunk contribute: shells, then each gallery's assigned exhibition.
 * @param {string} chunkKey
 * @param {{ assignments?: Record<string, string>; exhibitions?: Map<string, Exhibition> }} [inputs] overrides for tests
 */
export function galleryItemsFor(chunkKey, inputs = {}) {
  const exhibitions = inputs.exhibitions ?? loadExhibitions();
  const assignments = inputs.assignments ?? loadAssignments();
  /** @type {Array<Record<string, unknown>>} */
  const items = [];
  for (const g of GALLERIES.filter((x) => x.chunkKey === chunkKey)) {
    items.push(...shellComponents(g));
    const id = assignments[g.key];
    if (!id) continue; // between exhibitions: the room stays open and empty
    const ex = exhibitions.get(id);
    if (!ex) throw new Error(`gallery "${g.key}" is assigned unknown exhibition "${id}"`);
    items.push(...exhibitionComponents(g, ex));
  }
  return items;
}
