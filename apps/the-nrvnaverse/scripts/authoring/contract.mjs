// @ts-check
/**
 * Blender → NRVNAVerse authoring contract, version 1 (M3 Mission B). Pure and dependency-free.
 *
 * The owner composes city blocks, venues, galleries and markers in Blender. Spatial Intelligence
 * Core's read-only bridge exports the scene (`sic.blender-export/0`: per object its name, type,
 * collections, `matrix_world`, custom properties, empty display, material slots with their image
 * textures; plus unit settings and the collection tree). The importer (`importer.mjs`) turns that
 * export into an inspection manifest using the rules below. Nothing here opens, edits or saves a
 * .blend, and nothing here publishes anything.
 *
 * Frames and units (VERIFIED by the fixture round trip, `test/authoring-importer.test.ts`):
 *   Blender: right-handed, Z up, 1 Blender unit = 1 metre at unit scale 1.0 (lengths × scale_length otherwise)
 *   NRVNAVerse / AWE: right-handed, +Y up, north = −Z, metres
 *   point (x, y, z)_blender  →  (x, z, −y)_nrvna        Blender +Y ("north" in Blender's top view) = NRVNAVerse −Z
 *   a rotation of θ about Blender +Z  =  a yaw of θ about NRVNAVerse +Y (engine `rotation.y`, radians)
 *   a marker FACES its local +Y axis (the green arrow of an Arrows empty); unrotated = yaw 0 = facing −Z (north),
 *   the same convention as `spatial-config` spawns (`yaw` 0 faces −Z)
 */

export const AUTHORING_CONTRACT_VERSION = 1;
export const SOURCE_FORMAT = "sic.blender-export/0";
export const MANIFEST_FORMAT = "nrvna.authoring-manifest/1";

/** Top-level collections of an authoring scene (exact names; nested collections inherit their top-level role). */
export const CONTRACT_COLLECTIONS = Object.freeze(["CITY", "VENUES", "GALLERIES", "MARKERS", "DECORATION"]);

/** @typedef {"CITY" | "VENUES" | "GALLERIES" | "MARKERS" | "DECORATION"} ContractCollection */

/**
 * Marker kinds. A marker is an EMPTY in MARKERS named `<kind>:<slug>` (anchors: `anchor:<gallery>:<slug>`).
 * `volume`: the empty must use the Cube display; its box is the empty's display size × object scale.
 * `facing`: the marker's yaw is meaningful (its local +Y). `concept` is what NRVNAVerse does with it.
 * @type {Readonly<Record<string, { concept: string; volume: boolean; facing: boolean; display: string; props: readonly string[] }>>}
 */
export const MARKER_KINDS = Object.freeze({
  spawn: { concept: "arrival point of a destination: visitor feet position + facing", volume: false, facing: true, display: "ARROWS", props: [] },
  entrance: { concept: "doorway into a venue / gallery: threshold position + direction of entry", volume: false, facing: true, display: "ARROWS", props: [] },
  exit: { concept: "doorway out: threshold position + direction of leaving", volume: false, facing: true, display: "ARROWS", props: [] },
  skylift: { concept: "sky-lift pad (vertical travel to / from the Hub)", volume: false, facing: false, display: "CIRCLE", props: ["nrvna_radius"] },
  drop: { concept: "the Drop release edge (walk-off point, facing = direction of the jump)", volume: false, facing: true, display: "ARROWS", props: [] },
  portal: { concept: "trigger volume that travels to a stable destination id", volume: true, facing: false, display: "CUBE", props: ["nrvna_destination"] },
  gallery: { concept: "a gallery's interior volume; its slug is the gallery's authoring key", volume: true, facing: false, display: "CUBE", props: [] },
  anchor: { concept: "exhibit anchor inside a gallery, facing the viewer: on (or a few cm proud of) a wall at the centre height of the work, which hangs in front of it; or on the floor, where the work stands on it", volume: false, facing: true, display: "PLAIN_AXES", props: ["nrvna_max_width", "nrvna_max_height"] },
  interact: { concept: "interaction point (kiosk, desk, screen): where the visitor stands, facing the thing", volume: false, facing: true, display: "SPHERE", props: ["nrvna_radius"] },
  chunk: { concept: "streaming chunk boundary volume; the slug is the chunk key", volume: true, facing: false, display: "CUBE", props: [] },
});

/** Lowercase kebab-case slugs (also valid SIC entity ids and chunk keys). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Blender's automatic rename of a repeated name: `name.001`. */
export const BLENDER_COPY_RE = /^(.*)\.(\d{3,})$/;
/** Material variants: `<base>--<variant>` (e.g. `gallery_wall--warm`); never Blender's `.001`. */
export const MATERIAL_VARIANT_SEPARATOR = "--";

/** Thresholds behind the unit / bounds warnings (metres). */
export const LIMITS = Object.freeze({
  /** A world dimension above this is "suspect units" (the walkable world is 600 m, the far field 2.4 km). */
  maxDimension: 2000,
  /** A mesh smaller than this on every axis is suspect (mm export, or a stray vertex). */
  minDimension: 0.005,
  /** An object scale at or beyond these on any axis looks like a cm / mm import that was "fixed" by scaling. */
  suspectScaleHigh: 50,
  suspectScaleLow: 0.02,
  /** Tilt (degrees) above which a facing marker is reported: only its yaw is used. */
  markerTiltDeg: 1,
});

/**
 * @typedef {{ kind: string; slug: string; gallery: string | null; copyOf: string | null }} ParsedMarkerName
 * @typedef {{ error: "not-a-marker" | "unknown-kind" | "invalid-slug" | "anchor-needs-gallery"; kind?: string; detail?: string }} MarkerNameError
 */

/**
 * Parse `<kind>:<slug>` / `anchor:<gallery>:<slug>`, tolerating (and reporting) Blender's `.001` suffix.
 * @param {string} name
 * @returns {ParsedMarkerName | MarkerNameError}
 */
export function parseMarkerName(name) {
  const copy = BLENDER_COPY_RE.exec(name);
  const base = copy ? copy[1] : name;
  const parts = base.split(":");
  if (parts.length < 2) return { error: "not-a-marker" };
  const kind = parts[0];
  if (!Object.prototype.hasOwnProperty.call(MARKER_KINDS, kind)) return { error: "unknown-kind", kind };
  if (kind === "anchor") {
    if (parts.length !== 3) return { error: "anchor-needs-gallery", kind, detail: "anchor:<gallery-slug>:<anchor-slug>" };
    if (!SLUG_RE.test(parts[1]) || !SLUG_RE.test(parts[2])) return { error: "invalid-slug", kind, detail: `${parts[1]}:${parts[2]}` };
    return { kind, gallery: parts[1], slug: parts[2], copyOf: copy ? base : null };
  }
  if (parts.length !== 2 || !SLUG_RE.test(parts[1])) return { error: "invalid-slug", kind, detail: parts.slice(1).join(":") };
  return { kind, slug: parts[1], gallery: null, copyOf: copy ? base : null };
}

/** A name that LOOKS like a marker (`word:...`): used to catch marker names on non-empty objects. */
export function looksLikeMarker(/** @type {string} */ name) {
  return /^[A-Za-z]+:/.test(name);
}

/**
 * Split a material name into base + variant (`gallery_wall--warm` → base `gallery_wall`, variant `warm`).
 * @param {string} name
 */
export function materialVariant(name) {
  const copy = BLENDER_COPY_RE.exec(name);
  const i = name.indexOf(MATERIAL_VARIANT_SEPARATOR);
  return {
    base: i > 0 ? name.slice(0, i) : copy ? copy[1] : name,
    variant: i > 0 ? name.slice(i + MATERIAL_VARIANT_SEPARATOR.length) : null,
    autoCopy: copy !== null,
  };
}

// ----------------------------------------------------------------------------------------- frames

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[number, number, number, number]} Quat x, y, z, w */
/** @typedef {number[][]} Mat4 row-major 4×4 */

/** Blender → NRVNAVerse point. @param {Vec3} p @returns {Vec3} */
export const toWorld = (p) => [p[0], p[2], -p[1]];

/**
 * Lengths are rounded to 0.1 mm: Blender stores float32, which resolves only ≈ 10 µm at city
 * coordinates (33.8 is stored as 33.79999924), so finer digits are storage noise, not authoring.
 * @param {number} v
 */
export const rl = (v) => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

/** Angles, quaternions and scale factors: 1e-6. @param {number} v */
export const r6 = (v) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Decompose a Blender `matrix_world` (row-major, metres × `scaleLength`) into the NRVNAVerse frame.
 * Rotation R' = C·R·Cᵀ with C = (x, y, z) → (x, z, −y); scale axes follow the local axes, so a
 * Blender local (sx, sy, sz) becomes (sx, sz, sy) in the converted local frame.
 *
 * @param {Mat4} m
 * @param {number} [scaleLength]
 */
export function decomposeBlenderMatrix(m, scaleLength = 1) {
  const finite = m.length === 4 && m.every((row) => row.length === 4 && row.every((x) => typeof x === "number" && Number.isFinite(x)));
  if (!finite) return { ok: /** @type {const} */ (false), reason: "non-finite matrix" };
  // Converted 3×3: W[i][j] = Σ C[i][a] M[a][b] C[j][b]; C rows: (1,0,0), (0,0,1), (0,−1,0).
  /** @type {(v: Vec3) => Vec3} */
  const C = (v) => [v[0], v[2], -v[1]];
  const col = (/** @type {number} */ j) => /** @type {Vec3} */ ([m[0][j], m[1][j], m[2][j]]);
  // Blender local axes in NRVNAVerse world coordinates.
  const bx = C(col(0));
  const by = C(col(1));
  const bz = C(col(2));
  // Converted local axes: local x = Blender local x, local y (up) = Blender local z, local z = −Blender local y.
  /** @type {Vec3} */
  const ax = bx;
  /** @type {Vec3} */
  const ay = bz;
  /** @type {Vec3} */
  const az = [-by[0], -by[1], -by[2]];
  const len = (/** @type {Vec3} */ v) => Math.hypot(v[0], v[1], v[2]);
  let sx = len(ax);
  const sy = len(ay);
  const sz = len(az);
  const position = /** @type {Vec3} */ (C([m[0][3], m[1][3], m[2][3]]).map((x) => x * scaleLength));
  if (sx < 1e-9 || sy < 1e-9 || sz < 1e-9) return { ok: /** @type {const} */ (false), reason: "zero scale on an axis", position, scale: /** @type {Vec3} */ ([sx, sy, sz]) };
  const det =
    ax[0] * (ay[1] * az[2] - ay[2] * az[1]) - ax[1] * (ay[0] * az[2] - ay[2] * az[0]) + ax[2] * (ay[0] * az[1] - ay[1] * az[0]);
  const mirrored = det < 0;
  if (mirrored) sx = -sx; // the reflection is carried by local x
  /** @type {Vec3} */
  const rx = [ax[0] / sx, ax[1] / sx, ax[2] / sx];
  /** @type {Vec3} */
  const ry = [ay[0] / sy, ay[1] / sy, ay[2] / sy];
  /** @type {Vec3} */
  const rz = [az[0] / sz, az[1] / sz, az[2] / sz];
  // Shear: the rotation columns must be orthogonal.
  const dot = (/** @type {Vec3} */ a, /** @type {Vec3} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const shear = Math.max(Math.abs(dot(rx, ry)), Math.abs(dot(rx, rz)), Math.abs(dot(ry, rz)));
  const R = [
    [rx[0], ry[0], rz[0]],
    [rx[1], ry[1], rz[1]],
    [rx[2], ry[2], rz[2]],
  ];
  // Facing = the Blender local +Y in the world = −(converted local z).
  /** @type {Vec3} */
  const forward = [by[0] / len(by), by[1] / len(by), by[2] / len(by)];
  // Yaw in (−π, π] (a yaw of exactly −π is reported as π, so a south-facing marker reads 180°).
  let yaw = Math.atan2(-forward[0], -forward[2]);
  if (yaw <= -Math.PI + 1e-9) yaw = Math.PI;
  const up = ry;
  const tiltDeg = (Math.acos(Math.max(-1, Math.min(1, up[1]))) * 180) / Math.PI;
  // Upright objects get the pure-yaw form { 0, yaw, 0 } (the authoring convention); XYZ decomposition
  // would return the equivalent (π, π − yaw, π) beyond ±90°.
  const euler = tiltDeg < 1e-6 ? /** @type {Vec3} */ ([0, yaw, 0]) : eulerXYZFromMatrix(R);
  return {
    ok: /** @type {const} */ (true),
    position,
    scale: /** @type {Vec3} */ ([sx * scaleLength, sy * scaleLength, sz * scaleLength]),
    quaternion: quaternionFromMatrix(R),
    euler,
    yaw,
    tiltDeg,
    mirrored,
    shear,
    forward,
    /** Columns: the converted local axes (unit length) in world space. */
    axes: /** @type {[Vec3, Vec3, Vec3]} */ ([rx, ry, rz]),
  };
}

/** @param {number[][]} R @returns {Quat} */
export function quaternionFromMatrix(R) {
  const [m11, m12, m13] = R[0];
  const [m21, m22, m23] = R[1];
  const [m31, m32, m33] = R[2];
  const trace = m11 + m22 + m33;
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m32 - m23) * s;
    y = (m13 - m31) * s;
    z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  return [x, y, z, w];
}

/** three.js `Euler.setFromRotationMatrix` for order XYZ (the engine's component rotation, radians). @param {number[][]} R @returns {Vec3} */
export function eulerXYZFromMatrix(R) {
  const m13 = R[0][2];
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-R[1][2], R[2][2]), y, Math.atan2(-R[0][1], R[0][0])];
  return [Math.atan2(R[2][1], R[1][1]), y, 0];
}

/** Rotate a vector by the converted axes. @param {[Vec3, Vec3, Vec3]} axes @param {Vec3} v @returns {Vec3} */
export function applyAxes(axes, v) {
  return [
    axes[0][0] * v[0] + axes[1][0] * v[1] + axes[2][0] * v[2],
    axes[0][1] * v[0] + axes[1][1] * v[1] + axes[2][1] * v[2],
    axes[0][2] * v[0] + axes[1][2] * v[1] + axes[2][2] * v[2],
  ];
}
