import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GALLERIES,
  GALLERY_PLOTS,
  GALLERY_SPAWNS,
  SPAWN_DROP,
  exhibitionComponents,
  galleryItemsFor,
  gallerySource,
  loadAssignments,
  loadExhibitions,
  shellComponents,
  validateExhibition,
  withoutExhibitions,
} from "../spatial/authoring/gallery.mjs";

/**
 * M3 Mission C — one permanent gallery, interchangeable exhibitions. The venue shell (Blender
 * authoring fixture), the exhibition content (fixtures) and the assignment are separate sources;
 * switching the assignment must never move, rename or re-identify the building.
 */

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
type Item = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const gallery = GALLERIES[0];
const exhibitions = loadExhibitions();
const [chromatic, night] = ["chromatic-fields", "night-signals"].map((slug) => [...exhibitions.values()].find((e) => e.slug === slug)!);
const compose = (exhibitionId: string | null) => galleryItemsFor("city-south", { exhibitions, assignments: exhibitionId ? { "gallery-one": exhibitionId } : {} }) as Item[];
const byId = (items: Item[]) => new Map(items.map((i) => [String(i.id), i]));

describe("Gallery One — identity and location come from the shell, never from the exhibition", () => {
  const a = compose(chromatic.id);
  const b = compose(night.id);
  const empty = compose(null);
  const shell = (items: Item[]) => items.filter((i) => String(i.id).startsWith("gallery-one-shell-"));

  it("switching exhibitions leaves every shell component byte-identical (walls, floor, forecourt, desk, bench, sign, name)", () => {
    expect(shell(a).length).toBeGreaterThanOrEqual(13);
    expect(JSON.stringify(shell(a))).toBe(JSON.stringify(shell(b)));
    expect(JSON.stringify(shell(a))).toBe(JSON.stringify(empty));
    expect(JSON.stringify(shellComponents(gallery))).toBe(JSON.stringify(empty));
  });

  it("only the exhibition components differ, and each exhibition's ids carry its slug", () => {
    const onlyA = a.filter((i) => !String(i.id).startsWith("gallery-one-shell-"));
    const onlyB = b.filter((i) => !String(i.id).startsWith("gallery-one-shell-"));
    expect(onlyA.length).toBeGreaterThan(0);
    expect(onlyB.length).toBeGreaterThan(0);
    expect(onlyA.every((i) => String(i.id).startsWith("gallery-one-exh-chromatic-fields-"))).toBe(true);
    expect(onlyB.every((i) => String(i.id).startsWith("gallery-one-exh-night-signals-"))).toBe(true);
  });

  it("exhibition meshes never reach the far-field proxy: a switch changes one chunk and nothing else", () => {
    const meshes = (items: Item[]) => Object.values(withoutExhibitions(Object.fromEntries(items.map((i) => [String(i.id), i])))).filter((c: Item) => c.type === "mesh");
    expect(JSON.stringify(meshes(a))).toBe(JSON.stringify(meshes(b)));
    expect(meshes(a).every((c: Item) => c.script.tag === "m3-gallery-shell")).toBe(true);
  });

  it("the arrival point, entrance and destination id are the authored ones, whatever is on show", () => {
    const { manifest } = gallerySource(gallery);
    const spawn = manifest.markers.find((m: Item) => m.name === "spawn:gallery-one");
    expect(GALLERY_SPAWNS[gallery.destinationId]).toEqual({ chunkKey: "city-south", position: { x: spawn.position[0], y: spawn.position[1] + SPAWN_DROP, z: spawn.position[2] }, yaw: spawn.yaw });
    expect(spawn.yaw).toBeCloseTo(-Math.PI / 2, 5); // faces east, into the room
    expect(manifest.markers.find((m: Item) => m.name === "entrance:gallery-one").position).toEqual([33.8, 0.1, 150]);
    const config = json(join(APP_ROOT, "spatial/source/spatial-config.m0.json"));
    const placement = config.placements.find((p: Item) => p.destinationId === gallery.destinationId);
    expect(placement).toEqual({ destinationId: gallery.destinationId, chunkKey: "city-south", spawn: { position: { x: 37, y: 1, z: 150 }, yaw: -1.571 } });
  });

  it("the shell is placed exactly as authored in Blender (component = imported box)", () => {
    const { manifest } = gallerySource(gallery);
    const items = byId(empty);
    const wall = manifest.objects.find((o: Item) => o.id === "gallery-one.wall-north");
    expect(items.get("gallery-one-shell-wall-north")).toMatchObject({ position: { x: 48, y: 2.6, z: 139.8 }, geometry: { boxParams: { width: 28.8, height: 5, depth: 0.4 } }, color: "#f1e3cf" });
    expect(wall.materials[0].name).toBe("gallery_wall--warm"); // the authored variant picks the colour
    const plinth = items.get("gallery-one-shell-plinth-rotated");
    expect(plinth?.rotation.y).toBeCloseTo((30 * Math.PI) / 180, 5); // authored rotation preserved
    const bench = items.get("gallery-one-shell-bench-centre");
    expect(bench?.geometry.boxParams).toEqual({ width: 3, height: 0.45, depth: 0.8 }); // authored object scale preserved
    // Non-box geometry is never faked: the planters wait for a reviewed asset.
    expect(gallerySource(gallery).skipped).toEqual(["planter-north", "planter-south"]);
    expect([...items.keys()].some((k) => k.includes("planter"))).toBe(false);
  });

  it("the gallery reserves its authored plot: no city building in the far-field layer stands on it", () => {
    const plot = GALLERY_PLOTS["gallery-one"];
    const { manifest } = gallerySource(gallery);
    for (const o of manifest.objects.filter((x: Item) => x.bounds)) {
      expect(o.bounds.min[0] >= plot[0] && o.bounds.max[0] <= plot[2] && o.bounds.min[2] >= plot[1] && o.bounds.max[2] <= plot[3], o.name).toBe(true);
    }
    const layer = json(join(APP_ROOT, "spatial/source/city-layer.m2.json"));
    expect(layer.plots.find((p: Item) => p.key === "gallery-one").rect).toEqual(plot);
    // Building tiers are [x0, z0, x1, z1, …] in decimetres.
    const overlaps = (t: number[]) => t[0] / 10 < plot[2] && t[2] / 10 > plot[0] && t[1] / 10 < plot[3] && t[3] / 10 > plot[1];
    expect(layer.buildings.filter(overlaps)).toEqual([]);
  });
});

describe("exhibitions bind to anchors, not coordinates", () => {
  const { manifest } = gallerySource(gallery);
  const volume = manifest.markers.find((m: Item) => m.name === "gallery:gallery-one").volume.bounds;

  it("every work sits on its anchor, faces the room, and stays inside the gallery volume", () => {
    for (const ex of [chromatic, night]) {
      const items = exhibitionComponents(gallery, ex) as Item[];
      for (const w of ex.works) {
        const anchor = manifest.markers.find((m: Item) => m.kind === "anchor" && m.slug === w.anchor);
        const parts = items.filter((i) => String(i.id).startsWith(`gallery-one-exh-${ex.slug}-${w.anchor}-`));
        expect(parts.length, `${ex.slug} ${w.anchor}`).toBeGreaterThan(0);
        for (const p of parts) {
          const d = Math.hypot(p.position.x - anchor.position[0], p.position.z - anchor.position[2]);
          expect(d, `${p.id} distance from anchor`).toBeLessThan(w.size[0] / 2 + 0.6);
          for (const [axis, i] of [["x", 0], ["y", 1], ["z", 2]] as const) {
            expect(p.position[axis] >= volume.min[i] - 1e-6 && p.position[axis] <= volume.max[i] + 1e-6, `${p.id} ${axis}`).toBe(true);
          }
        }
      }
    }
  });

  it("no floor work stands between the arrival point and the centre of a wall work (SIC found it once: keep it fixed)", () => {
    const spawn = GALLERY_SPAWNS[gallery.destinationId].position;
    for (const ex of [chromatic, night]) {
      const items = exhibitionComponents(gallery, ex) as Item[];
      const floor = ex.works.filter((w) => ["column", "orb", "stack"].includes(w.kind)).map((w) => {
        const a = manifest.markers.find((m: Item) => m.kind === "anchor" && m.slug === w.anchor);
        // Footprint radius: a column's radius; a box's half-diagonal (orb plinth 0.7 × width, stack base = width).
        const r = w.kind === "column" ? w.size[0] / 2 : (w.size[0] * (w.kind === "orb" ? 0.7 : 1) * Math.SQRT2) / 2;
        return { x: a.position[0], z: a.position[2], r, id: w.anchor };
      });
      for (const g of items.filter((i) => String(i.id).endsWith("-ground"))) {
        const [ax, az, bx, bz] = [spawn.x, spawn.z, g.position.x, g.position.z];
        for (const f of floor) {
          const t = Math.max(0, Math.min(1, ((f.x - ax) * (bx - ax) + (f.z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
          const d = Math.hypot(ax + t * (bx - ax) - f.x, az + t * (bz - az) - f.z);
          expect(d, `${ex.slug}: ${f.id} blocks ${g.id}`).toBeGreaterThan(f.r);
        }
      }
    }
  });

  it("Night Signals uses a subset of the anchors; the unused ones stay empty", () => {
    const used = new Set(night.works.map((w) => w.anchor));
    expect(used.size).toBeLessThan(manifest.galleries[0].anchors.length);
    const ids = compose(night.id).map((i) => String(i.id));
    for (const anchor of manifest.galleries[0].anchors.filter((a: string) => !used.has(a))) expect(ids.some((id) => id.includes(`-${anchor}-`))).toBe(false);
  });

  it("refuses works the gallery cannot hold (unknown anchor, oversize, wrong surface, anchor used twice)", () => {
    const base = { format: "nrvna.exhibition/1", id: "exh_0000000000000000", slug: "bad", title: "Bad", subtitle: "", credit: "" };
    const bad = (works: Item[]) => () => validateExhibition({ ...base, works } as never, manifest, "gallery-one");
    expect(bad([{ anchor: "west-09", kind: "canvas", title: "Lost", size: [1, 1], colors: ["#000"] }])).toThrow(/has no anchor "west-09"/);
    expect(bad([{ anchor: "east-01", kind: "canvas", title: "Huge", size: [9, 1], colors: ["#000"] }])).toThrow(/exceeds anchor "east-01"/);
    expect(bad([{ anchor: "floor-01", kind: "canvas", title: "Flat", size: [1, 1], colors: ["#000"] }])).toThrow(/needs a wall anchor/);
    expect(bad([{ anchor: "east-01", kind: "column", title: "Pillar", size: [1, 1], colors: ["#000"] }])).toThrow(/needs a floor anchor/);
    expect(bad([{ anchor: "east-01", kind: "canvas", title: "A", size: [1, 1], colors: ["#000"] }, { anchor: "east-01", kind: "canvas", title: "B", size: [1, 1], colors: ["#000"] }])).toThrow(/used twice/);
    expect(() => compose("exh_9999999999999999")).toThrow(/unknown exhibition/);
  });

  it("exhibition fixtures are well formed: stable ids, slug = file name, no real artist credits", () => {
    expect([...exhibitions.keys()].sort()).toEqual(["exh_52vnk38ynvct0cct", "exh_fztaq4wxq1q4pjt3"]);
    for (const ex of exhibitions.values()) expect(ex.credit).toMatch(/fixture exhibition: procedural placeholder works, no real artist or artwork/);
  });
});

describe("the committed world shows the committed assignment", () => {
  it("city-south holds the shell plus exactly the assigned exhibition", () => {
    const assigned = loadAssignments()["gallery-one"];
    const ex = exhibitions.get(assigned)!;
    const config = json(join(APP_ROOT, "spatial/source/spatial-config.m0.json"));
    const scene = json(join(APP_ROOT, "spatial/source/scene.m0.json"));
    const chunk = config.chunks.find((c: Item) => c.key === "city-south");
    const galleryIds = chunk.componentIds.filter((id: string) => id.startsWith("gallery-one-"));
    const expected = compose(assigned).map((i) => String(i.id));
    expect(galleryIds).toEqual(expected);
    expect(galleryIds.filter((id: string) => id.startsWith("gallery-one-exh-")).every((id: string) => id.startsWith(`gallery-one-exh-${ex.slug}-`))).toBe(true);
    for (const id of galleryIds) expect(JSON.stringify(scene.components[id])).toBe(JSON.stringify(byId(compose(assigned)).get(id)));
  });

  it("Gallery One is a stable destination: a venue in The City, enterable from the web, never gated", () => {
    const manifest = json(join(REPO_ROOT, "packages/nrvna-manifest/manifests/gallery-one.json"));
    expect(manifest).toMatchObject({ id: gallery.destinationId, slug: "gallery-one", kind: "venue", primaryDistrictId: "dst_8w1j39h5e0ezrsjh", gates: [], ageRestriction: null, status: "active" });
    const web = json(join(REPO_ROOT, "packages/nrvna-manifest/generated/web-destinations.json"));
    const entry = web.destinations.find((d: Item) => d.id === gallery.destinationId);
    expect(entry.spatial).toMatchObject({ enterable: true, deepLink: `https://worlds.nrvnaverse.com/?destination=${gallery.destinationId}&from=web&return=web` });
    const index = json(join(APP_ROOT, "public/data/spatial/spatial-index.json"));
    expect(index.destinations[gallery.destinationId]).toMatchObject({ chunkKey: "city-south", spawn: { position: { x: 37, y: 1, z: 150 } } });
  });
});
