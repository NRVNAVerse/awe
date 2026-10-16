// @ts-check
/**
 * THE NRVNAVerse — the megacity plan (M2). Pure and deterministic: the same constants always give
 * byte-identical output, and every block draws its randomness from a hash of its own grid
 * coordinates, so editing one block (or reserving a plot) never reshuffles the rest of the city.
 *
 * World frame (shared by every chunk): metres, +Y up, city ground at y = 0, north is −Z.
 *
 *   - Road centrelines every PITCH metres on both axes; avenues (every third line) are wider.
 *   - Streaming cells are CELL × CELL metres, centred on multiples of CELL, so every cell edge
 *     lies on a road centreline (buildings never straddle a cell edge).
 *   - The first walkable region is the 3 × 3 cells around the origin, enclosed by THE RING (an
 *     elevated viaduct on the ±RING avenues). Everything outside it is far-field only.
 *   - PLOTS are reserved rectangles (the plaza, district floors, the Club, the gated compound):
 *     no lot may intersect a plot.
 *
 * Nothing here knows about destinations or gates; the composer (`city.mjs`) maps cells to chunks.
 */

/** Deterministic 32-bit hash of integers → [0, 1). */
export function hash01(...ints) {
  let h = 0x811c9dc5;
  for (const n of ints) {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

/** Round to 0.1 m (layer precision). @param {number} v */
export const r1 = (v) => Math.round(v * 10) / 10;

export const CITY = Object.freeze({
  /** Half extent of the city (metres). */
  half: 1200,
  /** Road pitch (block + road), metres. */
  pitch: 100,
  /** Streaming cell edge, metres (= two blocks). */
  cell: 200,
  /** Ring avenue offset from the origin (outer edge of the 3 × 3 walkable cells). */
  ring: 300,
  /** Street / avenue half widths (asphalt). */
  streetHalf: 8,
  avenueHalf: 12,
  /** Sidewalk band inside each block edge. */
  sidewalk: 5,
  /** Alley between lots. */
  alley: 5,
});

/** Downtown (north, behind the Hub's spire) and the east cluster: skyline centres. */
export const SKYLINE = Object.freeze([
  { x: 0, z: -760, radius: 520, lift: 210 },
  { x: 880, z: 120, radius: 330, lift: 120 },
  { x: -820, z: 420, radius: 300, lift: 90 },
]);

/** Palette indices used by the layer renderer (`city-layer.ts`) — facade tints. */
export const FACADE_COLORS = Object.freeze(["#8d8a84", "#6f747c", "#a3917a", "#5b6470", "#7d6a5e", "#4a5260", "#9aa3ad", "#3e434c"]);

/** @typedef {[number, number, number, number]} Rect x0, z0, x1, z1 */

/** @param {Rect} a @param {Rect} b */
export const rectsOverlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** @param {Rect} r @param {number} m */
export const grow = (r, m) => /** @type {Rect} */ ([r[0] - m, r[1] - m, r[2] + m, r[3] + m]);

/**
 * a − b as up to four disjoint rectangles.
 * @param {Rect} a @param {Rect} b @returns {Rect[]}
 */
export function subtractRect(a, b) {
  if (!rectsOverlap(a, b)) return [a];
  /** @type {Rect[]} */
  const out = [];
  if (b[1] > a[1]) out.push([a[0], a[1], a[2], b[1]]);
  if (b[3] < a[3]) out.push([a[0], b[3], a[2], a[3]]);
  const z0 = Math.max(a[1], b[1]);
  const z1 = Math.min(a[3], b[3]);
  if (b[0] > a[0]) out.push([a[0], z0, b[0], z1]);
  if (b[2] < a[2]) out.push([b[2], z0, a[2], z1]);
  return out.filter((r) => r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5);
}

/** Road half width of the line at `k * PITCH`. @param {number} k */
export const roadHalf = (k) => (k % 3 === 0 ? CITY.avenueHalf : CITY.streetHalf);

/** True when (x, z) lies inside the walkable 3 × 3 region (inside the Ring). @param {number} x @param {number} z */
export const inWalkable = (x, z) => Math.abs(x) <= CITY.ring && Math.abs(z) <= CITY.ring;

/**
 * Height envelope at a point: skyline lift outside the Ring, human-scale inside it.
 * @param {number} x @param {number} z @param {number} noise 0..1
 */
export function heightAt(x, z, noise) {
  const d0 = Math.hypot(x, z);
  if (inWalkable(x, z)) {
    // Inside the Ring: 9–40 m (the Hub floats clear above), lower around the plaza.
    const lo = d0 < 160 ? 8 : 11;
    const hi = d0 < 160 ? 24 : 40;
    return lo + noise * (hi - lo);
  }
  let h = 16 + noise * 34;
  for (const s of SKYLINE) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.radius) h += Math.pow(1 - d / s.radius, 1.6) * s.lift * (0.55 + 0.45 * noise);
  }
  // A gentle rise just outside the Ring so the walkable region reads as a low district.
  const ringDist = Math.max(Math.abs(x), Math.abs(z)) - CITY.ring;
  if (ringDist < 200) h = Math.min(h, 30 + ringDist * 0.4);
  return h;
}

/**
 * @typedef {{
 *   id: string;
 *   rect: Rect;           // footprint of the lowest tier
 *   tiers: Array<{ rect: Rect; y0: number; y1: number }>;
 *   color: number;        // FACADE_COLORS index
 *   style: number;        // 0 office · 1 residential · 2 dark-glass tower
 *   cell: [number, number];
 *   crown: boolean;       // lit crown / aviation light
 * }} Building
 */

/**
 * @param {{ plots: Record<string, Rect> }} opts
 */
export function planCity(opts) {
  const { half, pitch } = CITY;
  const kMax = Math.round(half / pitch);
  const plots = Object.values(opts.plots);
  /** @type {Rect[]} */
  const roads = [];
  /** @type {Array<{ rect: Rect; kind: "block" | "park" }>} */
  const grounds = [];
  /** @type {Building[]} */
  const buildings = [];
  /** @type {Array<[number, number, number]>} street lamps (x, z, kind) */
  const lamps = [];

  // --- Roads: full-length strips on every centreline (avenues wider). Intersections overlap in the
  //     same material (no visible fighting).
  for (let k = -kMax; k <= kMax; k++) {
    const c = k * pitch;
    const w = roadHalf(Math.abs(k));
    roads.push([c - w, -half, c + w, half]);
    roads.push([-half, c - w, half, c + w]);
  }

  // --- Blocks.
  for (let bi = -kMax; bi < kMax; bi++) {
    for (let bj = -kMax; bj < kMax; bj++) {
      const x0 = bi * pitch + roadHalf(Math.abs(bi));
      const x1 = (bi + 1) * pitch - roadHalf(Math.abs(bi + 1));
      const z0 = bj * pitch + roadHalf(Math.abs(bj));
      const z1 = (bj + 1) * pitch - roadHalf(Math.abs(bj + 1));
      /** @type {Rect} */
      const block = [x0, z0, x1, z1];
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const walk = inWalkable(cx, cz);
      const isPark = !walk && hash01(bi, bj, 7) < 0.06;
      // Ground of the block minus any plot it touches.
      let pieces = [block];
      for (const p of plots) pieces = pieces.flatMap((piece) => subtractRect(piece, p));
      for (const piece of pieces) grounds.push({ rect: piece, kind: isPark ? "park" : "block" });
      if (isPark) continue;

      // Lots: finer grain inside the Ring (human scale), coarser outside, single towers downtown.
      const inner = grow(block, -CITY.sidewalk);
      const hNoise = hash01(bi, bj, 1);
      const env = heightAt(cx, cz, hNoise);
      let nx;
      let nz;
      if (walk) {
        nx = 3;
        nz = 3;
      } else if (env > 110) {
        nx = hash01(bi, bj, 2) < 0.5 ? 1 : 2;
        nz = nx === 1 ? 1 : hash01(bi, bj, 3) < 0.5 ? 1 : 2;
      } else {
        nx = 2 + (hash01(bi, bj, 4) < 0.35 ? 1 : 0);
        nz = 2 + (hash01(bi, bj, 5) < 0.35 ? 1 : 0);
      }
      const lw = (inner[2] - inner[0] - (nx - 1) * CITY.alley) / nx;
      const ld = (inner[3] - inner[1] - (nz - 1) * CITY.alley) / nz;
      for (let li = 0; li < nx; li++) {
        for (let lj = 0; lj < nz; lj++) {
          const lx0 = inner[0] + li * (lw + CITY.alley);
          const lz0 = inner[1] + lj * (ld + CITY.alley);
          /** @type {Rect} */
          const lot = [lx0, lz0, lx0 + lw, lz0 + ld];
          if (plots.some((p) => rectsOverlap(grow(lot, 3), p))) continue;
          const n = hash01(bi, bj, li, lj, 11);
          if (walk && n < 0.08) continue; // a few open courts inside the Ring
          const setback = 0.6 + hash01(bi, bj, li, lj, 12) * 2.2;
          /** @type {Rect} */
          const fp = [lot[0] + setback, lot[1] + setback, lot[2] - setback, lot[3] - setback];
          const lcx = (fp[0] + fp[2]) / 2;
          const lcz = (fp[1] + fp[3]) / 2;
          const h = Math.max(7, heightAt(lcx, lcz, 0.35 * hNoise + 0.65 * n));
          const tiers = [];
          if (h > 70) {
            // Setback tower: base, shaft, crown.
            const base = Math.min(24, h * 0.22);
            tiers.push({ rect: fp, y0: 0, y1: base });
            const s1 = grow(fp, -Math.min((fp[2] - fp[0]) * 0.14, 6));
            const shaftTop = h * (0.82 + 0.1 * hash01(bi, bj, li, lj, 13));
            tiers.push({ rect: s1, y0: base, y1: shaftTop });
            const s2 = grow(s1, -Math.min((s1[2] - s1[0]) * 0.18, 5));
            tiers.push({ rect: s2, y0: shaftTop, y1: h });
          } else if (h > 28 && hash01(bi, bj, li, lj, 14) < 0.5) {
            const base = h * (0.55 + 0.2 * hash01(bi, bj, li, lj, 15));
            tiers.push({ rect: fp, y0: 0, y1: base });
            tiers.push({ rect: grow(fp, -Math.min((fp[2] - fp[0]) * 0.18, 4)), y0: base, y1: h });
          } else {
            tiers.push({ rect: fp, y0: 0, y1: h });
          }
          const style = h > 90 ? (hash01(bi, bj, li, lj, 16) < 0.6 ? 2 : 0) : h > 30 ? (hash01(bi, bj, li, lj, 17) < 0.5 ? 0 : 1) : 1;
          const cell = /** @type {[number, number]} */ ([Math.round(lcx / CITY.cell), Math.round(lcz / CITY.cell)]);
          buildings.push({
            id: `b${bi + kMax}-${bj + kMax}-${li}${lj}`,
            rect: fp,
            tiers: tiers.map((t) => ({ rect: /** @type {Rect} */ (t.rect.map(r1)), y0: r1(t.y0), y1: r1(t.y1) })),
            color: Math.floor(hash01(bi, bj, li, lj, 18) * FACADE_COLORS.length),
            style,
            cell,
            crown: h > 110,
          });
        }
      }
    }
  }

  // --- Street lamps: both sides of every road, every 34 m, skipping plots and intersections.
  for (let k = -kMax; k <= kMax; k++) {
    const c = k * pitch;
    const off = roadHalf(Math.abs(k)) + 1.2;
    for (let s = -half + 17; s < half; s += 34) {
      const local = ((s % pitch) + pitch) % pitch;
      if (local < 16 || local > pitch - 16) continue;
      for (const side of [-1, 1]) {
        for (const [x, z] of [
          [c + side * off, s],
          [s, c + side * off],
        ]) {
          if (plots.some((p) => x > p[0] && x < p[2] && z > p[1] && z < p[3])) continue;
          lamps.push([r1(x), r1(z), inWalkable(x, z) ? 1 : 0]);
        }
      }
    }
  }

  // --- Street trees (inside the Ring and one block beyond): sidewalk centre line, between lamps.
  /** @type {Array<[number, number, number]>} x, z, size (0..1) */
  const trees = [];
  const treeReach = CITY.ring + pitch;
  for (let k = -kMax; k <= kMax; k++) {
    const c = k * pitch;
    if (Math.abs(c) > treeReach) continue;
    const off = roadHalf(Math.abs(k)) + CITY.sidewalk / 2;
    for (let s = -treeReach; s < treeReach; s += 17) {
      const local = ((s % pitch) + pitch) % pitch;
      if (local < 18 || local > pitch - 18) continue;
      for (const side of [-1, 1]) {
        for (const [x, z] of [
          [c + side * off, s + 8.5],
          [s + 8.5, c + side * off],
        ]) {
          if (plots.some((p) => x > p[0] - 2 && x < p[2] + 2 && z > p[1] - 2 && z < p[3] + 2)) continue;
          if (hash01(Math.round(x), Math.round(z), 31) < 0.18) continue;
          trees.push([r1(x), r1(z), Math.round(hash01(Math.round(x), Math.round(z), 32) * 100) / 100]);
        }
      }
    }
  }

  // --- Crosswalks at every intersection inside the Ring and one block beyond: [x, z, axis (0 = across x-road)].
  /** @type {Array<[number, number, number]>} */
  const crossings = [];
  for (let i = -kMax; i <= kMax; i++) {
    for (let j = -kMax; j <= kMax; j++) {
      const x = i * pitch;
      const z = j * pitch;
      if (Math.abs(x) > treeReach || Math.abs(z) > treeReach) continue;
      if (plots.some((p) => x > p[0] && x < p[2] && z > p[1] && z < p[3])) continue;
      crossings.push([x, z, 0]);
    }
  }

  return { roads: roads.map((r) => /** @type {Rect} */ (r.map(r1))), grounds: grounds.map((g) => ({ rect: /** @type {Rect} */ (g.rect.map(r1)), kind: g.kind })), buildings, lamps, trees, crossings };
}
