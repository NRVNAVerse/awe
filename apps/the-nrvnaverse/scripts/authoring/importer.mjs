// @ts-check
/**
 * Blender authoring importer (M3 Mission B): `sic.blender-export/0` → `nrvna.authoring-manifest/1`
 * plus findings. PURE: no file system, no Blender, no network — the CLI (`cli.mjs`) produces the
 * export through Spatial Intelligence Core's read-only bridge and checks files on disk.
 *
 * What the manifest preserves, per object: the Blender name (source identity), an optional
 * `nrvna_id` custom property (an identity that survives renames), the contract collection, the full
 * transform in the NRVNAVerse frame (position, quaternion, XYZ Euler, signed scale, yaw) and the
 * original Blender matrix, the exact box when the mesh is one, the world bounds, and every material
 * slot in order with its base name, variant and image textures. Nothing is re-placed, re-scaled,
 * re-materialled or re-ordered: the importer reports, it never "fixes".
 *
 * Markers (EMPTY objects named per `contract.mjs`) become typed records: kind, slug, gallery,
 * position, yaw, tilt, volume (Cube empties) and their `nrvna_*` properties.
 */

import {
  AUTHORING_CONTRACT_VERSION,
  CONTRACT_COLLECTIONS,
  LIMITS,
  MANIFEST_FORMAT,
  MARKER_KINDS,
  SOURCE_FORMAT,
  applyAxes,
  decomposeBlenderMatrix,
  looksLikeMarker,
  materialVariant,
  parseMarkerName,
  r6,
} from "./contract.mjs";

/** @typedef {import("./contract.mjs").Vec3} Vec3 */
/** @typedef {"error" | "warning" | "info"} Level */
/** @typedef {{ code: string; level: Level; subject: string | null; message: string; evidence?: Record<string, unknown> }} Finding */

/**
 * @typedef {{
 *   name: string; type: string; collections: string[]; matrix_world: number[][];
 *   custom_props?: Record<string, unknown>; hide_render?: boolean; in_view_layer?: boolean; instances?: number;
 *   empty?: { display_type: string; display_size: number };
 *   mesh?: { is_box?: boolean; local_bbox?: { min: Vec3; max: Vec3 }; vertices?: number; triangles?: number };
 *   materials?: Array<{ name: string; textures?: Array<{ image: string; width: number; height: number; packed: boolean; source?: string; path: string | null }> }>;
 * }} ExportObject
 * @typedef {{
 *   format: string; blender_version?: string; file?: { path: string | null }; scene?: string;
 *   unit_settings?: { system?: string; scale_length?: number; length_unit?: string };
 *   objects: ExportObject[]; collections?: Array<{ name: string; children: string[]; objects: string[] }>;
 * }} BlenderExport
 */

/**
 * @typedef {{ min: Vec3; max: Vec3 }} Bounds
 * @typedef {{ slot: number; name: string; base: string; variant: string | null; textures: Array<{ image: string; path: string | null; packed: boolean; loaded: boolean; width: number; height: number }> }} MaterialRecord
 * @typedef {{
 *   id: string; name: string; type: string; collection: string | null; collectionPath: string[];
 *   transform: { position: Vec3; quaternion: [number, number, number, number]; euler: Vec3; scale: Vec3; yaw: number; mirrored: boolean };
 *   blenderMatrix: number[][];
 *   box: { center: Vec3; size: Vec3; euler: Vec3 } | null;
 *   bounds: Bounds | null;
 *   materials: MaterialRecord[];
 *   props: Record<string, unknown>;
 * }} ObjectRecord
 * @typedef {{
 *   name: string; kind: string; slug: string; gallery: string | null; concept: string; collection: string | null;
 *   position: Vec3; yaw: number | null; tiltDeg: number;
 *   volume: { center: Vec3; size: Vec3; euler: Vec3; bounds: Bounds } | null;
 *   props: Record<string, unknown>;
 * }} MarkerRecord
 */

/** @param {Vec3} v */
const rv = (v) => /** @type {Vec3} */ (v.map(r6));

/**
 * @param {Vec3} center @param {Vec3} half @param {[Vec3, Vec3, Vec3]} axes
 * @returns {Bounds}
 */
function orientedBounds(center, half, axes) {
  /** @type {Vec3} */
  const min = [Infinity, Infinity, Infinity];
  /** @type {Vec3} */
  const max = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const d = applyAxes(axes, [sx * half[0], sy * half[1], sz * half[2]]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], center[i] + d[i]);
          max[i] = Math.max(max[i], center[i] + d[i]);
        }
      }
  return { min: rv(min), max: rv(max) };
}

/** Bounds overlap with a tolerance. @param {Bounds} a @param {Bounds} b */
export function boundsOverlap(a, b, tol = 1e-4) {
  for (let i = 0; i < 3; i++) if (a.min[i] >= b.max[i] - tol || b.min[i] >= a.max[i] - tol) return false;
  return true;
}

/** @param {Vec3} p @param {Bounds} b */
const pointIn = (p, b, tol = 1e-4) => p.every((v, i) => v >= b.min[i] - tol && v <= b.max[i] + tol);

/**
 * Map each collection to its top-level ancestor (one of the scene's root children).
 * @param {BlenderExport} source
 */
function collectionRoots(source) {
  /** @type {Map<string, string>} */
  const parent = new Map();
  for (const c of source.collections ?? []) for (const child of c.children) parent.set(child, c.name);
  /** @param {string} name @returns {string[]} root-first path */
  const pathOf = (name) => {
    /** @type {string[]} */
    const path = [name];
    let cur = name;
    const seen = new Set([name]);
    while (parent.has(cur)) {
      cur = /** @type {string} */ (parent.get(cur));
      if (seen.has(cur)) break;
      seen.add(cur);
      path.unshift(cur);
    }
    return path;
  };
  return pathOf;
}

/**
 * Import one export. The .blend's folder (from `file.path`) lets the importer flag textures that
 * live outside the project folder; `options.blendSha256` records the source bytes in the manifest.
 * @param {BlenderExport} source
 * @param {{ blendSha256?: string | null }} [options]
 */
export function importBlenderExport(source, options = {}) {
  /** @type {Finding[]} */
  const findings = [];
  /** @param {Level} level @param {string} code @param {string | null} subject @param {string} message @param {Record<string, unknown>} [evidence] */
  const add = (level, code, subject, message, evidence) => findings.push({ code, level, subject, message, ...(evidence ? { evidence } : {}) });

  if (!source || source.format !== SOURCE_FORMAT || !Array.isArray(source.objects)) {
    add("error", "unsupported-source", null, `expected a ${SOURCE_FORMAT} export (Spatial Intelligence Core's Blender bridge)`, { format: source?.format ?? null });
    return { manifest: null, findings };
  }

  const units = source.unit_settings ?? {};
  const scaleLength = typeof units.scale_length === "number" && units.scale_length > 0 ? units.scale_length : 1;
  if (scaleLength !== 1 || (units.length_unit && units.length_unit !== "METERS") || (units.system && units.system !== "METRIC")) {
    add("warning", "scene-unit-scale", null, `scene units are ${units.system ?? "?"} / ${units.length_unit ?? "?"} at scale ${scaleLength}; the contract expects Metric, Meters, Unit Scale 1.0. Lengths were multiplied by ${scaleLength}.`, { ...units });
  }

  const pathOf = collectionRoots(source);
  const blendPath = source.file?.path ?? null;
  // The .blend's folder, when the export names one (a portable fixture export keeps only the file name).
  const blendDir = blendPath && /[\\/]/.test(blendPath) ? blendPath.replace(/[\\/][^\\/]*$/, "") : null;

  /** @type {ObjectRecord[]} */
  const objects = [];
  /** @type {MarkerRecord[]} */
  const markers = [];
  /** @type {Map<string, string>} */
  const idOwner = new Map();

  for (const o of [...source.objects].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (o.in_view_layer === false) {
      add("info", "object-excluded", o.name, "not in the active view layer (excluded collection): ignored");
      continue;
    }
    const paths = o.collections.map((c) => (c === "Scene Collection" ? [] : pathOf(c)));
    const roots = [...new Set(paths.map((p) => p[0] ?? null))];
    const contractRoots = roots.filter((r) => r !== null && CONTRACT_COLLECTIONS.includes(r));
    const collection = contractRoots[0] ?? null;
    const collectionPath = paths.find((p) => p[0] === collection) ?? [];
    if (contractRoots.length > 1) add("warning", "multiple-collections", o.name, `linked into several contract collections (${contractRoots.join(", ")}); ${collection} is used`);

    const t = decomposeBlenderMatrix(o.matrix_world, scaleLength);
    if (!t.ok) {
      add("error", "degenerate-transform", o.name, `cannot be placed: ${t.reason}`, { scale: "scale" in t ? t.scale : null });
      continue;
    }
    if (t.shear > 1e-4) add("warning", "shear-transform", o.name, "its world matrix is sheared (a non-uniformly scaled parent rotated child); the shape cannot be represented exactly", { shear: r6(t.shear) });
    if (t.mirrored) add("warning", "mirrored-transform", o.name, "negative scale (mirrored); the engine does not mirror components — apply the scale in Blender");
    if (o.instances && o.instances > 0) add("warning", "instancing-not-expanded", o.name, `${o.instances} instances (collection / geometry nodes) are not exported; realise them in Blender`);
    if (o.hide_render) add("info", "hidden-in-render", o.name, "disabled in renders; still imported");

    const props = Object.fromEntries(Object.entries(o.custom_props ?? {}).filter(([k]) => k.startsWith("nrvna_")));
    const parsed = parseMarkerName(o.name);

    // ---- markers
    if (o.type === "EMPTY") {
      if ("error" in parsed) {
        if (parsed.error === "not-a-marker") {
          add("info", "empty-ignored", o.name, "an empty without a marker name is ignored (helper / parent)");
        } else {
          add("error", `marker-${parsed.error}`, o.name, parsed.error === "unknown-kind" ? `unknown marker kind "${parsed.kind}" (known: ${Object.keys(MARKER_KINDS).join(", ")})` : `marker name must be <kind>:<slug> (lowercase kebab-case)${parsed.detail ? `: "${parsed.detail}"` : ""}`);
        }
        continue;
      }
      const kind = MARKER_KINDS[parsed.kind];
      if (collection !== "MARKERS") add("warning", "marker-outside-markers", o.name, `markers belong in MARKERS (found in ${collection ?? "the scene root"}); imported anyway`);
      if (parsed.copyOf) add("error", "marker-duplicate", o.name, `Blender renamed a duplicate of "${parsed.copyOf}"; each marker must be unique`, { original: parsed.copyOf });
      /** @type {MarkerRecord["volume"]} */
      let volume = null;
      const display = o.empty?.display_type ?? "PLAIN_AXES";
      if (kind.volume) {
        if (display !== "CUBE") add("error", "marker-volume-display", o.name, `a ${parsed.kind} marker is a volume: use the Cube empty display (found ${display})`);
        const half = /** @type {Vec3} */ (t.scale.map((s) => Math.abs(s) * (o.empty?.display_size ?? 1)));
        volume = { center: rv(t.position), size: rv(/** @type {Vec3} */ (half.map((h) => 2 * h))), euler: rv(t.euler), bounds: orientedBounds(t.position, half, t.axes) };
      } else if (t.scale.some((s) => Math.abs(Math.abs(s) - 1) > 1e-6)) {
        add("info", "marker-scale-ignored", o.name, "only a volume marker's scale means something; this one is used as a point", { scale: rv(t.scale) });
      }
      if (kind.facing && t.tiltDeg > LIMITS.markerTiltDeg) add("warning", "marker-tilted", o.name, `tilted ${t.tiltDeg.toFixed(1)}° off upright: only its yaw is used`, { tiltDeg: r6(t.tiltDeg) });
      for (const k of Object.keys(props)) if (!kind.props.includes(k)) add("info", "marker-prop-unused", o.name, `"${k}" is not read for ${parsed.kind} markers`);
      markers.push({
        name: o.name,
        kind: parsed.kind,
        slug: parsed.slug,
        gallery: parsed.gallery,
        concept: kind.concept,
        collection,
        position: rv(t.position),
        yaw: kind.facing ? r6(t.yaw) : null,
        tiltDeg: r6(t.tiltDeg),
        volume,
        props,
      });
      continue;
    }

    // ---- geometry (and anything else)
    if (looksLikeMarker(o.name) && !("error" in parsed && parsed.error === "not-a-marker")) {
      add("error", "marker-not-empty", o.name, `named like a marker but is a ${o.type}: markers must be Empty objects (no geometry)`);
      continue;
    }
    if (collection === null) add("warning", "uncategorised-object", o.name, `not under ${CONTRACT_COLLECTIONS.join(" / ")}; imported with no collection role`);
    else if (collection === "MARKERS") add("warning", "geometry-in-markers", o.name, "MARKERS holds Empty markers only; this geometry is imported but belongs in another collection");

    const id = typeof o.custom_props?.nrvna_id === "string" && o.custom_props.nrvna_id.length > 0 ? o.custom_props.nrvna_id : o.name;
    if (idOwner.has(id)) add("error", "duplicate-object-id", o.name, `identity "${id}" is already used by "${idOwner.get(id)}"`);
    idOwner.set(id, o.name);

    /** @type {ObjectRecord["box"]} */
    let box = null;
    /** @type {Bounds | null} */
    let bounds = null;
    const bb = o.mesh?.local_bbox;
    if (bb) {
      // Converted local frame: Blender local (x, y, z) → (x, z, −y).
      /** @type {Vec3} */
      const localCenter = [(bb.min[0] + bb.max[0]) / 2, (bb.min[2] + bb.max[2]) / 2, -(bb.min[1] + bb.max[1]) / 2];
      /** @type {Vec3} */
      const localHalf = [(bb.max[0] - bb.min[0]) / 2, (bb.max[2] - bb.min[2]) / 2, (bb.max[1] - bb.min[1]) / 2];
      // World = position + Σ axis_i · (signed scale_i · local_i) (a mirror is carried by the signed x scale).
      const offset = applyAxes(t.axes, /** @type {Vec3} */ (localCenter.map((c, i) => c * t.scale[i])));
      /** @type {Vec3} */
      const center = [t.position[0] + offset[0], t.position[1] + offset[1], t.position[2] + offset[2]];
      const half = /** @type {Vec3} */ (localHalf.map((h, i) => h * Math.abs(t.scale[i])));
      bounds = orientedBounds(center, half, t.axes);
      if (o.mesh?.is_box) box = { center: rv(center), size: rv(/** @type {Vec3} */ (half.map((h) => 2 * h))), euler: rv(t.euler) };
      const dims = half.map((h) => 2 * h);
      if (dims.some((d) => !Number.isFinite(d))) add("error", "invalid-bounds", o.name, "non-finite bounds");
      else if (Math.max(...dims) > LIMITS.maxDimension) add("warning", "suspect-unit-size", o.name, `${Math.max(...dims).toFixed(1)} m across — larger than the whole far-field city; centimetre units exported as metres?`, { size: rv(/** @type {Vec3} */ (dims)) });
      else if (Math.max(...dims) < LIMITS.minDimension) add("warning", "suspect-unit-size", o.name, `${(Math.max(...dims) * 1000).toFixed(2)} mm across — millimetre units, or a stray object?`, { size: rv(/** @type {Vec3} */ (dims)) });
      if (o.mesh?.vertices === 0) add("warning", "empty-mesh", o.name, "mesh without vertices");
      if (!o.mesh?.is_box) add("info", "needs-asset", o.name, "not an exact box: its geometry can only reach the world as a reviewed runtime asset (asset contract), not as a blockout component");
    } else if (o.type !== "EMPTY") {
      add("info", "unsupported-type", o.name, `${o.type} objects carry no geometry for the importer (cameras, lights: ignored)`);
    }
    const s = t.scale.map(Math.abs);
    if (s.some((v) => v >= LIMITS.suspectScaleHigh || v <= LIMITS.suspectScaleLow)) add("warning", "suspect-unit-scale", o.name, `object scale ${rv(t.scale).join(" × ")}: a cm / mm import scaled into place? Apply the scale (Ctrl+A) after fixing the units`, { scale: rv(t.scale) });

    /** @type {MaterialRecord[]} */
    const materials = (o.materials ?? []).map((m, slot) => {
      const v = materialVariant(m.name);
      if (v.autoCopy) add("warning", "material-auto-copy", o.name, `material "${m.name}" is a Blender auto-numbered copy: name the variant <base>--<variant> or reuse the original`);
      const textures = (m.textures ?? []).map((tx) => {
        const loaded = tx.packed || (tx.width > 0 && tx.height > 0);
        if (!loaded) add("error", "missing-texture", o.name, `material "${m.name}" uses image "${tx.image}" that Blender could not load`, { path: tx.path });
        else if (!tx.packed && tx.path && blendDir && !tx.path.startsWith("//") && !tx.path.toLowerCase().startsWith(blendDir.toLowerCase())) add("warning", "texture-outside-project", o.name, `image "${tx.image}" lives outside the .blend's folder (it will not travel with the file)`, { path: tx.path });
        return { image: tx.image, path: tx.path, packed: tx.packed, loaded, width: tx.width, height: tx.height };
      });
      return { slot, name: m.name, base: v.base, variant: v.variant, textures };
    });
    if (o.type === "MESH" && materials.length === 0) add("info", "no-material", o.name, "no material assigned");

    objects.push({
      id,
      name: o.name,
      type: o.type,
      collection,
      collectionPath,
      transform: { position: rv(t.position), quaternion: /** @type {[number, number, number, number]} */ (t.quaternion.map(r6)), euler: rv(t.euler), scale: rv(t.scale), yaw: r6(t.yaw), mirrored: t.mirrored },
      blenderMatrix: o.matrix_world,
      box,
      bounds,
      materials,
      props,
    });
  }

  // ---- cross-object rules
  /** @type {Map<string, MarkerRecord[]>} */
  const byKey = new Map();
  for (const m of markers) {
    const key = `${m.kind}:${m.gallery ? `${m.gallery}:` : ""}${m.slug}`;
    byKey.set(key, [...(byKey.get(key) ?? []), m]);
  }
  for (const [key, list] of byKey) {
    const named = list.filter((m) => m.name === key);
    if (list.length > 1 && named.length === list.length) add("error", "marker-duplicate", key, `${list.length} markers share this name`);
  }
  const galleries = markers.filter((m) => m.kind === "gallery");
  for (const a of markers.filter((m) => m.kind === "anchor")) {
    const g = galleries.find((x) => x.slug === a.gallery);
    if (!g) add("error", "anchor-unknown-gallery", a.name, `no gallery:${a.gallery} volume marker`);
    else if (g.volume && !pointIn(a.position, g.volume.bounds)) add("error", "anchor-outside-gallery", a.name, `outside the gallery:${a.gallery} volume`, { position: a.position, gallery: g.volume.bounds });
  }
  for (const g of galleries) {
    const spawn = markers.find((m) => m.kind === "spawn" && m.slug === g.slug);
    if (spawn && g.volume && !pointIn(spawn.position, g.volume.bounds)) add("warning", "gallery-spawn-outside", spawn.name, `the gallery's arrival point is outside gallery:${g.slug}`);
    if (!markers.some((m) => m.kind === "anchor" && m.gallery === g.slug)) add("warning", "gallery-without-anchors", g.name, "no exhibit anchors: exhibitions cannot be assigned to this gallery");
  }

  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level] || (a.subject ?? "").localeCompare(b.subject ?? "") || a.code.localeCompare(b.code));

  const manifest = {
    format: MANIFEST_FORMAT,
    contractVersion: AUTHORING_CONTRACT_VERSION,
    source: {
      format: source.format,
      blenderVersion: source.blender_version ?? null,
      file: blendPath ? blendPath.replace(/^.*[\\/]/, "") : null,
      sha256: options.blendSha256 ?? null,
      scene: source.scene ?? null,
      unitSettings: { system: units.system ?? null, lengthUnit: units.length_unit ?? null, scaleLength },
    },
    frame: { units: "metres", up: "+Y", north: "-Z", yaw: "radians about +Y; 0 faces -Z", rotation: "XYZ Euler radians (engine component rotation)", from: "Blender Z-up: (x, y, z) -> (x, z, -y)" },
    collections: Object.fromEntries(CONTRACT_COLLECTIONS.map((c) => [c, [...objects.filter((o) => o.collection === c).map((o) => o.id), ...markers.filter((m) => m.collection === c).map((m) => m.name)]])),
    objects,
    markers,
    galleries: galleries.map((g) => ({
      slug: g.slug,
      volume: g.volume,
      spawn: markers.find((m) => m.kind === "spawn" && m.slug === g.slug)?.name ?? null,
      entrance: markers.find((m) => m.kind === "entrance" && m.slug === g.slug)?.name ?? null,
      exit: markers.find((m) => m.kind === "exit" && m.slug === g.slug)?.name ?? null,
      anchors: markers.filter((m) => m.kind === "anchor" && m.gallery === g.slug).map((m) => m.slug),
    })),
  };
  return { manifest, findings };
}

/** Findings by level. @param {Finding[]} findings */
export function summarize(findings) {
  return {
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warning").length,
    info: findings.filter((f) => f.level === "info").length,
  };
}
