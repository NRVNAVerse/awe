// @ts-check
/**
 * NRVNAVerse spatial authoring helpers (M1 creative build).
 *
 * Pure, deterministic builders for official AWE component data (`mesh`, `text`, sensors). They
 * produce plain JSON that the spatial pipeline passes through untouched; nothing here knows about
 * destinations, gates or chunks (those stay in `spatial-config.m0.json`, D-004 / D-006).
 *
 * Conventions: metres, +Y up, forward is -Z (the spawn faces -Z). Rotations are RADIANS: the
 * engine data docs say degrees, but the runtime applies the numbers as radians (verified headless
 * with getBBox on a rotated ramp, 2026-10-13), so builders take degrees and emit radians via deg(). Every builder takes an `id` first so the composed ids are stable and reviewable.
 */

/** @typedef {{ x: number; y: number; z: number }} XYZ */

/** Degrees → radians, rounded (the engine reads rotation values as radians). @param {number} d */
export const deg = (d) => Math.round((d * Math.PI) / 180 * 10000) / 10000;

/** @param {number} v */
export const r3 = (v) => Math.round(v * 1000) / 1000;

/** @param {number} x @param {number} y @param {number} z @returns {XYZ} */
export const v = (x, y, z) => ({ x: r3(x), y: r3(y), z: r3(z) });

const GEOMETRY_DEFAULTS = {
  sphereParams: { radius: 1, widthSegments: 32, heightSegments: 32 },
  cylinderParams: { radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 32, heightSegments: 1, openEnded: false },
  boxParams: { width: 1, height: 1, depth: 1 },
};

/**
 * @typedef {{
 *   name?: string;
 *   color?: string;
 *   opacity?: number;
 *   rotation?: XYZ;
 *   scale?: XYZ;
 *   collider?: boolean | "sensor" | "none";
 *   colliderType?: "CUBE" | "SPHERE" | "CYLINDER" | "MESH";
 *   castShadow?: boolean;
 *   receiveShadow?: boolean;
 *   plugins?: Array<Record<string, unknown> & { id: string }>;
 *   tag?: string;
 *   renderMode?: string;
 * }} MeshOpts
 */

/**
 * @param {string} id
 * @param {Record<string, unknown>} geometry
 * @param {XYZ} position
 * @param {MeshOpts} opts
 */
function mesh(id, geometry, position, opts) {
  const collider = opts.collider ?? true;
  /** @type {Record<string, unknown>} */
  const data = {
    name: opts.name ?? id,
    id,
    type: "mesh",
    kit: "cyber",
    position,
    rotation: opts.rotation ?? v(0, 0, 0),
    scale: opts.scale ?? v(1, 1, 1),
    geometry: { ...GEOMETRY_DEFAULTS, ...geometry },
    color: opts.color ?? "#ffffff",
    opacity: opts.opacity ?? 1,
    display: true,
    renderMode: opts.renderMode ?? "default",
    wireframe: false,
    castShadow: opts.castShadow ?? true,
    receiveShadow: opts.receiveShadow ?? true,
  };
  if (opts.plugins && opts.plugins.length > 0) data.plugins = opts.plugins;
  if (collider === "none") {
    data.collider = { enabled: false, rigidbodyType: "FIXED", colliderType: opts.colliderType ?? "CUBE" };
  } else if (collider === "sensor") {
    data.collider = { enabled: true, rigidbodyType: "FIXED", colliderType: opts.colliderType ?? "CUBE", isSensor: true };
  } else {
    data.collider = { enabled: true, rigidbodyType: "FIXED", colliderType: opts.colliderType ?? "CUBE" };
  }
  data.script = { identifier: id, tag: opts.tag ?? "m1-authored" };
  return data;
}

/**
 * Axis-aligned box by centre.
 * @param {string} id @param {XYZ} center @param {[number, number, number]} size @param {MeshOpts} [opts]
 */
export function box(id, center, size, opts = {}) {
  return mesh(id, { type: "box", boxParams: { width: r3(size[0]), height: r3(size[1]), depth: r3(size[2]) } }, center, opts);
}

/**
 * Box whose BOTTOM face sits at `baseY` (the usual "stands on a surface" case).
 * @param {string} id @param {number} x @param {number} baseY @param {number} z @param {[number, number, number]} size @param {MeshOpts} [opts]
 */
export function slab(id, x, baseY, z, size, opts = {}) {
  return box(id, v(x, baseY + size[1] / 2, z), size, opts);
}

/**
 * Vertical cylinder whose bottom sits at `baseY`.
 * @param {string} id @param {number} x @param {number} baseY @param {number} z @param {number} radius @param {number} height @param {MeshOpts & { radiusTop?: number; segments?: number }} [opts]
 */
export function column(id, x, baseY, z, radius, height, opts = {}) {
  const { radiusTop, segments, ...rest } = opts;
  return mesh(
    id,
    {
      type: "cylinder",
      cylinderParams: {
        radiusTop: r3(radiusTop ?? radius),
        radiusBottom: r3(radius),
        height: r3(height),
        radialSegments: segments ?? 32,
        heightSegments: 1,
        openEnded: false,
      },
    },
    v(x, baseY + height / 2, z),
    { colliderType: "CYLINDER", ...rest },
  );
}

/**
 * @param {string} id @param {XYZ} center @param {number} radius @param {MeshOpts} [opts]
 */
export function sphere(id, center, radius, opts = {}) {
  return mesh(id, { type: "sphere", sphereParams: { radius: r3(radius), widthSegments: 32, heightSegments: 32 } }, center, {
    colliderType: "SPHERE",
    ...opts,
  });
}

/**
 * A walkable ramp between two heights along the Z axis. `zFrom` is the low end; the ramp rises
 * toward `zTo`. The box is rotated about X so its TOP surface runs from (x, lowY, zFrom) to
 * (x, highY, zTo); the returned object also carries `ramp` metadata (angle, ends) for checks.
 * Rotation sign: a positive rotation about +X lifts the -Z end of the box (y' = y·cosθ − z·sinθ).
 *
 * @param {string} id @param {number} x @param {number} zFrom @param {number} lowY @param {number} zTo @param {number} highY @param {number} width @param {MeshOpts & { thickness?: number }} [opts]
 */
export function rampZ(id, x, zFrom, lowY, zTo, highY, width, opts = {}) {
  const { thickness = 0.5, ...rest } = opts;
  const run = zTo - zFrom; // signed
  const rise = highY - lowY;
  const length = Math.hypot(run, rise);
  const angle = Math.atan2(rise, Math.abs(run)); // radians, always positive (rise > 0)
  // Rotation about X: positive lifts the -Z end. If the high end is at smaller z (north), use +angle.
  const rotX = run < 0 ? angle : -angle;
  // Centre of the top surface, then drop by half the thickness along the surface normal.
  const cx = x;
  const cz = (zFrom + zTo) / 2;
  const cyTop = (lowY + highY) / 2;
  const normalY = Math.cos(angle);
  const normalZ = run < 0 ? Math.sin(angle) : -Math.sin(angle); // normal tilts toward the low end
  const center = v(cx, cyTop - (thickness / 2) * normalY, cz - (thickness / 2) * normalZ);
  const data = box(id, center, [width, thickness, length], { rotation: { x: Math.round(rotX * 10000) / 10000, y: 0, z: 0 }, ...rest });
  return data;
}

/**
 * A walkable ramp along the X axis (`xFrom` low end). Rotation about +Z: y' = x·sinθ + y·cosθ, so a
 * POSITIVE θ lifts the +X end; a ramp rising toward -X therefore needs a negative θ (headless-verified
 * after an inverted first version).
 * @param {string} id @param {number} z @param {number} xFrom @param {number} lowY @param {number} xTo @param {number} highY @param {number} width @param {MeshOpts & { thickness?: number }} [opts]
 */
export function rampX(id, z, xFrom, lowY, xTo, highY, width, opts = {}) {
  const { thickness = 0.5, ...rest } = opts;
  const run = xTo - xFrom;
  const rise = highY - lowY;
  const length = Math.hypot(run, rise);
  const angle = Math.atan2(rise, Math.abs(run));
  const rotZ = run < 0 ? -angle : angle;
  const cx = (xFrom + xTo) / 2;
  const cyTop = (lowY + highY) / 2;
  const normalY = Math.cos(angle);
  const normalX = run < 0 ? Math.sin(angle) : -Math.sin(angle);
  const center = v(cx - (thickness / 2) * normalX, cyTop - (thickness / 2) * normalY, z);
  return box(id, center, [length, thickness, width], { rotation: { x: 0, y: 0, z: Math.round(rotZ * 10000) / 10000 }, ...rest });
}

/**
 * @param {string} id @param {string} text @param {XYZ} position @param {{ scale?: number; color?: string; font?: string; width?: number; rotation?: XYZ; opacity?: number; name?: string; align?: string }} [opts]
 */
export function label(id, text, position, opts = {}) {
  const s = opts.scale ?? 1;
  return {
    name: opts.name ?? `Label ${text}`,
    id,
    type: "text",
    kit: "cyber",
    text,
    position,
    rotation: opts.rotation ?? v(0, 0, 0),
    scale: v(s, s, s),
    align: opts.align ?? "center",
    font: opts.font ?? "aeonik-bold",
    lineHeight: 60,
    textColor: opts.color ?? "#ffffff",
    textTransform: "none",
    width: opts.width ?? 900,
    opacity: opts.opacity ?? 1,
  };
}

/** Fresnel rim glow (reads as a lit edge / halo on dark backgrounds). */
export function glow(color, { intensity = 1.2, power = 2, speed = 1, pulse = 0 } = {}) {
  return { id: "FresnelGlowPlugin", color, intensity, power, speed, pulse };
}

/** Slow brightness pulse. */
export function pulse(color, { intensity = 0.4, speed = 0.6 } = {}) {
  return { id: "PulsePlugin", color, intensity, speed };
}

/**
 * Collect builders into an ordered `{ id: data }` map, refusing duplicate ids.
 * @param {Array<Record<string, unknown> & { id: string }>} items
 */
export function collect(items) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const item of items) {
    const id = String(item.id);
    if (id in out) throw new Error(`duplicate authored component id "${id}"`);
    out[id] = item;
  }
  return out;
}
