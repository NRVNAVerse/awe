/**
 * The far-field city layer data (M2) — the generated artifact `spatial/layers/city.<token>.json`,
 * composed by `spatial/authoring/city.mjs`. Pure parsing / validation so the shape is unit-tested
 * without three.js; the renderer is `city-layer.ts`.
 *
 * Units: roads, grounds, buildings and lamps are integer DECIMETRES (compact encoding); everything
 * else is metres. Proxies are keyed by chunk key and contain only ungated chunks.
 */

/** [kind (0 box · 1 cylinder · 2 sphere), x, y, z, a, b, c, rotX, rotY, rotZ, colour, emissive (0 | 1)] */
export type ProxyPrimitive = [number, number, number, number, number, number, number, number, number, number, string, number];

export interface CityLayerData {
  schemaVersion: 1;
  key: string;
  frame: { half: number; pitch: number; cell: number; ring: number };
  facadeColors: string[];
  /** [x0, z0, x1, z1] dm */
  roads: Array<[number, number, number, number]>;
  /** [x0, z0, x1, z1, kind (0 block · 1 park)] dm */
  grounds: Array<[number, number, number, number, number]>;
  plots: Array<{ key: string; rect: [number, number, number, number]; color: string }>;
  /** [x0, z0, x1, z1, y0, y1, facadeColour, style, crown] dm (colour / style / crown are indices / flags) */
  buildings: Array<[number, number, number, number, number, number, number, number, number]>;
  /** [x, z, insideRing] dm */
  lamps: Array<[number, number, number]>;
  /** [x, z, y0, y1, radius, colour] m */
  beacons: Array<[number, number, number, number, number, string]>;
  compounds: Array<{ rect: [number, number, number, number]; height: number; color: string }>;
  ring: { half: number; deckY: number; width: number };
  keel: { x: number; y: number; z: number; radiusX: number; radiusZ: number; depth: number; color: string; glow: string } | null;
  proxies: Record<string, ProxyPrimitive[]>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numbers(v: unknown, n: number, what: string): void {
  if (!Array.isArray(v) || v.length !== n || !v.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error(`city layer is malformed: ${what}`);
}

/** Structural check; throws on anything unexpected so the app never renders half a city. */
export function parseCityLayer(input: unknown): CityLayerData {
  if (!isRecord(input) || input.schemaVersion !== 1 || typeof input.key !== "string") throw new Error("city layer is malformed: envelope");
  const f = input.frame;
  if (!isRecord(f) || ![f.half, f.pitch, f.cell, f.ring].every((x) => typeof x === "number" && x > 0)) throw new Error("city layer is malformed: frame");
  for (const key of ["roads", "grounds", "buildings", "lamps", "beacons", "plots", "compounds", "facadeColors"]) {
    if (!Array.isArray(input[key])) throw new Error(`city layer is malformed: ${key}`);
  }
  (input.roads as unknown[]).forEach((r, i) => numbers(r, 4, `roads[${i}]`));
  (input.grounds as unknown[]).forEach((r, i) => numbers(r, 5, `grounds[${i}]`));
  (input.buildings as unknown[]).forEach((r, i) => numbers(r, 9, `buildings[${i}]`));
  (input.lamps as unknown[]).forEach((r, i) => numbers(r, 3, `lamps[${i}]`));
  if (!isRecord(input.ring)) throw new Error("city layer is malformed: ring");
  if (!isRecord(input.proxies)) throw new Error("city layer is malformed: proxies");
  for (const [k, prims] of Object.entries(input.proxies)) {
    if (!Array.isArray(prims)) throw new Error(`city layer is malformed: proxies.${k}`);
    for (const p of prims) if (!Array.isArray(p) || p.length !== 12 || typeof p[10] !== "string") throw new Error(`city layer is malformed: proxy primitive in ${k}`);
  }
  return input as unknown as CityLayerData;
}
