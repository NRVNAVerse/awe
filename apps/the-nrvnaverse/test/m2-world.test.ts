import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCityLayer } from "@/lib/city/city-layer-data";
import { parseSpatialIndex } from "@/lib/spatial/spatial-index";
import { generatedChunks, readServedJson, spatialIndexJson } from "./support/generated-spatial";

/**
 * M2 world invariants (Hub over megacity): geometric facts the composition must keep, checked on the
 * COMMITTED generated artifacts. Axis-aligned boxes only (every city collider is an unrotated box);
 * rotated district pieces are bounded by their rotated extents conservatively.
 */

const index = parseSpatialIndex(spatialIndexJson);
const layer = parseCityLayer(readServedJson(index.layers.city.dataUrl));
const APP_ROOT = resolve(__dirname, "..");

type Box = { id: string; min: [number, number, number]; max: [number, number, number] };

function boxOf(c: Record<string, any> | undefined): Box | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const g = c?.geometry;
  if (!c || !g || !c.position) return null;
  let h: [number, number, number];
  if (g.type === "box") h = [g.boxParams.width / 2, g.boxParams.height / 2, g.boxParams.depth / 2];
  else if (g.type === "cylinder") h = [Math.max(g.cylinderParams.radiusTop, g.cylinderParams.radiusBottom), g.cylinderParams.height / 2, Math.max(g.cylinderParams.radiusTop, g.cylinderParams.radiusBottom)];
  else if (g.type === "sphere") h = [g.sphereParams.radius, g.sphereParams.radius, g.sphereParams.radius];
  else return null;
  const r = c.rotation ?? { x: 0, y: 0, z: 0 };
  if (r.x || r.y || r.z) {
    const m = Math.hypot(...h);
    h = [m, m, m];
  }
  const p = c.position;
  return { id: c.id, min: [p.x - h[0], p.y - h[1], p.z - h[2]], max: [p.x + h[0], p.y + h[1], p.z + h[2]] };
}
const overlaps = (a: Box, b: Box, eps = 0.05) => a.min.every((v, i) => v < b.max[i] - eps) && a.max.every((v, i) => v > b.min[i] + eps);

const cells = Object.entries(index.streaming!.cells).map(([cell, chunkKey]) => ({ cell: cell.split(",").map(Number) as [number, number], chunkKey }));

describe("M2 world — the streaming cells", () => {
  it("every walkable cell chunk carries a ground collider that covers its cell with at least 16 m of overlap", () => {
    for (const { cell, chunkKey } of cells) {
      const ground = generatedChunks[chunkKey].components[`${chunkKey}-ground`] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(ground, chunkKey).toBeDefined();
      expect(ground.display).toBe(false);
      expect(ground.collider).toMatchObject({ enabled: true });
      const b = boxOf(ground)!;
      expect(b.max[1]).toBeCloseTo(0, 5); // walkable top at street level
      const s = index.streaming!.cellSize;
      expect(b.min[0]).toBeLessThanOrEqual(cell[0] * s - s / 2 - 16);
      expect(b.max[0]).toBeGreaterThanOrEqual(cell[0] * s + s / 2 + 16);
      expect(b.min[2]).toBeLessThanOrEqual(cell[1] * s - s / 2 - 16);
      expect(b.max[2]).toBeGreaterThanOrEqual(cell[1] * s + s / 2 + 16);
    }
  });

  it("the outer cells are closed by the Ring (a wall on every outer edge of the 3 × 3 region)", () => {
    for (const { cell, chunkKey } of cells) {
      const ids = Object.keys(generatedChunks[chunkKey].components);
      expect(ids.includes(`${chunkKey}-ring-w`), `${chunkKey} west`).toBe(cell[0] === -1);
      expect(ids.includes(`${chunkKey}-ring-e`), `${chunkKey} east`).toBe(cell[0] === 1);
      expect(ids.includes(`${chunkKey}-ring-n`), `${chunkKey} north`).toBe(cell[1] === -1);
      expect(ids.includes(`${chunkKey}-ring-s`), `${chunkKey} south`).toBe(cell[1] === 1);
    }
  });

  it("no city building collider intersects any district component, lift pad, portal, zone or threshold", () => {
    for (const chunkKey of ["music", "fashion-culture", "city-plaza"]) {
      const comps = Object.values(generatedChunks[chunkKey].components) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const isBuilding = (c: Record<string, unknown>) => /-b\d+-\d+-\d+-t\d+$/.test(String(c.id));
      const isKit = (c: Record<string, unknown>) => c.id === `${chunkKey}-ground` || /-ring-[nsew]$/.test(String(c.id)) || c.id === "music-club-massing";
      const buildings = comps.filter(isBuilding).map(boxOf).filter(Boolean) as Box[];
      const district = comps.filter((c) => !isBuilding(c) && !isKit(c)).map(boxOf).filter(Boolean) as Box[];
      expect(buildings.length, chunkKey).toBeGreaterThan(5);
      for (const b of buildings) for (const d of district) expect(overlaps(b, d), `${chunkKey}: ${b.id} × ${d.id}`).toBe(false);
    }
  });

  it("every spawn of a streamed chunk lies inside its own cell and above the street", () => {
    const s = index.streaming!.cellSize;
    for (const [id, d] of Object.entries(index.destinations)) {
      const entry = cells.find((c) => c.chunkKey === d.chunkKey);
      if (!entry) continue;
      const p = d.spawn.position;
      expect(Math.round(p.x / s) || 0, id).toBe(entry.cell[0]); // `|| 0`: Math.round(-0.17) is -0
      expect(Math.round(p.z / s) || 0, id).toBe(entry.cell[1]);
      expect(p.y, id).toBeGreaterThan(0);
    }
  });
});

describe("M2 world — the floating Hub", () => {
  const hub = Object.values(generatedChunks.hub.components) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const byId = new Map(hub.map((c) => [c.id, c]));

  it("the Hub floats over Skyfall Plaza, clear above every building of the city under its keel", () => {
    const deck = boxOf(byId.get("hub-isle-deck"))!;
    const keel = layer.keel!;
    const keelBottom = keel.y - keel.depth;
    const under = layer.buildings.filter(([x0, z0, x1, z1]) => x1 / 10 > deck.min[0] && x0 / 10 < deck.max[0] && z1 / 10 > deck.min[2] && z0 / 10 < deck.max[2]);
    const tallest = Math.max(0, ...under.map((b) => b[5] / 10));
    expect(deck.max[1]).toBeGreaterThan(130);
    expect(keelBottom).toBeGreaterThan(tallest + 30);
    const plaza = layer.plots.find((p) => p.key === "plaza")!;
    // The Drop's tongue ends over the plaza plot.
    const tongue = boxOf(byId.get("hub-drop-tongue"))!;
    expect(tongue.max[2]).toBeLessThan(plaza.rect[3]);
    expect(tongue.min[0]).toBeGreaterThan(plaza.rect[0]);
    expect(tongue.max[0]).toBeLessThan(plaza.rect[2]);
  });

  it("parapets close the island except for the Drop gap", () => {
    for (const id of ["hub-isle-parapet-n", "hub-isle-parapet-w", "hub-isle-parapet-e", "hub-isle-parapet-sw", "hub-isle-parapet-se"]) expect(byId.has(id), id).toBe(true);
    const sw = boxOf(byId.get("hub-isle-parapet-sw"))!;
    const se = boxOf(byId.get("hub-isle-parapet-se"))!;
    expect(se.min[0] - sw.max[0]).toBeGreaterThan(10); // the Drop is a 14 m gap
  });
});

describe("M2 world — the far-field layer", () => {
  it("proxies every ungated composed chunk and never the gated compound", () => {
    // M3: city-south gained visible geometry (Gallery One), so it is proxied too.
    expect(Object.keys(layer.proxies).sort()).toEqual(["city-north", "city-plaza", "city-south", "fashion-culture", "hub", "music", "music-club"]);
    expect(layer.proxies).not.toHaveProperty("cannabis-21");
    // The compound shell is authored, not derived: its colour is not the gated chunk's platform colour.
    const gated = generatedChunks["cannabis-21"].components["platform-cannabis-21"] as { color: string };
    expect(layer.compounds.map((c) => c.color)).not.toContain(gated.color);
  });

  it("carries no destination identity, gate or URL (it is geometry only)", () => {
    const text = JSON.stringify(layer);
    expect(text).not.toMatch(/dst_[0-9a-z]{16}|"gates"|https?:\/\//);
  });

  it("keeps the walkable region human-scale and the skyline beyond it", () => {
    const ring = layer.frame.ring;
    const inside = layer.buildings.filter(([x0, z0, x1, z1]) => Math.abs((x0 + x1) / 20) < ring && Math.abs((z0 + z1) / 20) < ring);
    expect(Math.max(...inside.map((b) => b[5] / 10))).toBeLessThan(45);
    expect(Math.max(...layer.buildings.map((b) => b[5] / 10))).toBeGreaterThan(150);
  });

  it("the composed layer source and the delivered artifact are the same data", () => {
    const source = JSON.parse(readFileSync(join(APP_ROOT, "spatial", "source", "city-layer.m2.json"), "utf8"));
    expect(layer).toEqual(source);
  });
});
