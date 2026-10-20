import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MARKER_KINDS, decomposeBlenderMatrix, parseMarkerName, materialVariant } from "../scripts/authoring/contract.mjs";
import { importBlenderExport, summarize } from "../scripts/authoring/importer.mjs";
import { planSicChecks, sicLoadableExport } from "../scripts/authoring/sic-checks.mjs";
import { portableExport } from "../scripts/authoring/portable-export.mjs";

/**
 * M3 Mission B — the Blender → NRVNAVerse authoring contract, proven on synthetic fixtures built by
 * real Blender 5.1 (`pnpm authoring:fixture`) and exported by Spatial Intelligence Core's read-only
 * bridge. The committed exports are portable copies (no machine paths, no triangle arrays); the
 * specs are what the builder was asked to author, in the NRVNAVerse frame.
 */

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => JSON.parse(readFileSync(join(APP_ROOT, "spatial/authoring/blender", name), "utf8"));
const galleryExport = fixture("gallery-one.blender-export.json");
const gallerySpec = fixture("gallery-one.spec.json");
const coverageExport = fixture("contract-coverage.blender-export.json");

type Vec3 = [number, number, number];
type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const close = (a: number[], b: number[], tol = 1e-5) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const rad = (d: number) => (d * Math.PI) / 180;
const sameAngle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-5;

describe("contract — names and frames", () => {
  it("parses marker names, anchors and Blender's duplicate suffix", () => {
    expect(parseMarkerName("spawn:gallery-one")).toEqual({ kind: "spawn", slug: "gallery-one", gallery: null, copyOf: null });
    expect(parseMarkerName("anchor:gallery-one:east-01")).toEqual({ kind: "anchor", slug: "east-01", gallery: "gallery-one", copyOf: null });
    expect(parseMarkerName("spawn:lobby.001")).toEqual({ kind: "spawn", slug: "lobby", gallery: null, copyOf: "spawn:lobby" });
    expect(parseMarkerName("door:lobby")).toMatchObject({ error: "unknown-kind" });
    expect(parseMarkerName("spawn:Lobby_Main")).toMatchObject({ error: "invalid-slug" });
    expect(parseMarkerName("anchor:east-01")).toMatchObject({ error: "anchor-needs-gallery" });
    expect(parseMarkerName("gallery-one-floor")).toEqual({ error: "not-a-marker" });
    expect(Object.keys(MARKER_KINDS).sort()).toEqual(["anchor", "chunk", "drop", "entrance", "exit", "gallery", "interact", "portal", "skylift", "spawn"]);
  });

  it("splits material variants on `--` and flags Blender's `.001` copies", () => {
    expect(materialVariant("gallery_wall--warm")).toEqual({ base: "gallery_wall", variant: "warm", autoCopy: false });
    expect(materialVariant("gallery_wall.001")).toEqual({ base: "gallery_wall", variant: null, autoCopy: true });
    expect(materialVariant("paving_stone")).toEqual({ base: "paving_stone", variant: null, autoCopy: false });
  });

  it("converts Blender Z-up to +Y-up: a Blender Z rotation θ is a yaw θ; local +Y faces −Z at yaw 0", () => {
    const at = (theta: number, t: Vec3 = [1, 2, 3]) => [
      [Math.cos(theta), -Math.sin(theta), 0, t[0]],
      [Math.sin(theta), Math.cos(theta), 0, t[1]],
      [0, 0, 1, t[2]],
      [0, 0, 0, 1],
    ];
    const id = decomposeBlenderMatrix(at(0));
    if (!id.ok) throw new Error("decompose failed");
    expect(id.position).toEqual([1, 3, -2]);
    expect(close(id.forward, [0, 0, -1])).toBe(true);
    expect(id.yaw).toBe(0);
    for (const deg of [-170, -90, -30, 0, 45, 90, 135, 180]) {
      const d = decomposeBlenderMatrix(at(rad(deg)));
      if (!d.ok) throw new Error("decompose failed");
      expect(sameAngle(d.yaw, rad(deg))).toBe(true);
      expect(close(d.euler, [0, d.euler[1], 0])).toBe(true);
      expect(sameAngle(d.euler[1], rad(deg))).toBe(true); // engine rotation.y
    }
  });

  it("tilted objects: the XYZ Euler (engine order) recomposes the converted rotation", () => {
    // Rx·Ry·Rz (three.js order XYZ) from Euler angles, as column vectors.
    const rot = (e: number[]) => {
      const [a, b, c] = e;
      const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
      return [
        [cb * cc, -cb * sc, sb],
        [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
        [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
      ];
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 50; i++) {
      // A random Blender rotation (Euler XYZ in Blender's frame) → matrix_world.
      const b = rot([rnd() * 1.4, rnd() * 1.4, rnd() * 3]);
      const m = [[...b[0], 0], [...b[1], 0], [...b[2], 0], [0, 0, 0, 1]];
      const d = decomposeBlenderMatrix(m);
      if (!d.ok) throw new Error("decompose failed");
      const r = rot(d.euler);
      // Converted columns must equal the decomposed axes.
      for (let c = 0; c < 3; c++) expect(close([r[0][c], r[1][c], r[2][c]], d.axes[c], 1e-6)).toBe(true);
    }
  });

  it("recovers signed scale, mirroring and unit scale; refuses degenerate matrices", () => {
    const m = [
      [-2, 0, 0, 0],
      [0, 3, 0, 0],
      [0, 0, 4, 0],
      [0, 0, 0, 1],
    ];
    const d = decomposeBlenderMatrix(m, 0.01);
    if (!d.ok) throw new Error("decompose failed");
    expect(d.mirrored).toBe(true);
    expect(close(d.scale, [-0.02, 0.04, 0.03])).toBe(true); // converted local axes: (x, z, y)
    expect(decomposeBlenderMatrix([[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])).toMatchObject({ ok: false, reason: "zero scale on an axis" });
    expect(decomposeBlenderMatrix([[NaN, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])).toMatchObject({ ok: false });
  });
});

describe("Gallery One — the authored scene round-trips exactly (Blender 5.1 → SIC export → manifest)", () => {
  const imported = importBlenderExport(galleryExport);
  const manifest = imported.manifest as Mutable;
  const findings = imported.findings;
  if (!manifest) throw new Error("no manifest");

  it("imports clean: no errors or warnings; the two cylinders are reported as needing a reviewed asset", () => {
    expect(summarize(findings)).toEqual({ errors: 0, warnings: 0, info: 2 });
    expect(findings.map((f) => `${f.code}:${f.subject}`)).toEqual(["needs-asset:planter-north", "needs-asset:planter-south"]);
    expect(manifest.source).toMatchObject({ format: "sic.blender-export/0", blenderVersion: "5.1.2", file: "gallery-one.blend", unitSettings: { system: "METRIC", lengthUnit: "METERS", scaleLength: 1 } });
  });

  it("every object keeps its placement, size, yaw, scale, collection and material (with variant and texture)", () => {
    for (const o of gallerySpec.objects) {
      const rec = manifest.objects.find((x: { name: string }) => x.name === o.name);
      expect(rec, o.name).toBeDefined();
      expect(rec.id).toBe(o.id ?? o.name); // nrvna_id wins, the Blender name stays as source identity
      expect(rec.collection).toBe(o.collection.split("/")[0]);
      expect(rec.collectionPath).toEqual(o.collection.split("/"));
      expect(sameAngle(rec.transform.yaw, rad(o.yaw_deg ?? 0)), o.name).toBe(true);
      expect(close(rec.transform.scale, o.scale ?? [1, 1, 1]), o.name).toBe(true);
      const center = o.shape === "box" ? rec.box.center : [(rec.bounds.min[0] + rec.bounds.max[0]) / 2, (rec.bounds.min[1] + rec.bounds.max[1]) / 2, (rec.bounds.min[2] + rec.bounds.max[2]) / 2];
      expect(close(center, o.center, 1e-4), `${o.name} centre ${center}`).toBe(true);
      if (o.shape === "box") expect(close(rec.box.size, o.size, 1e-4), `${o.name} size ${rec.box.size}`).toBe(true);
      expect(rec.materials.map((m: { name: string }) => m.name)).toEqual([o.material]);
      const tex = gallerySpec.materials[o.material].texture;
      expect(rec.materials[0].textures.map((t: { image: string; loaded: boolean }) => [t.image, t.loaded])).toEqual(tex ? [[tex, true]] : []);
    }
    const north = manifest.objects.find((x: { name: string }) => x.name === "gallery-one-wall-north");
    expect(north.materials[0]).toMatchObject({ name: "gallery_wall--warm", base: "gallery_wall", variant: "warm" });
  });

  it("every marker keeps its kind, slug, position, facing and volume", () => {
    expect(manifest.markers).toHaveLength(gallerySpec.markers.length);
    for (const m of gallerySpec.markers) {
      const rec = manifest.markers.find((x: { name: string }) => x.name === m.name);
      expect(rec, m.name).toBeDefined();
      expect(close(rec.position, m.at, 1e-4), m.name).toBe(true);
      if (MARKER_KINDS[rec.kind].facing) expect(sameAngle(rec.yaw, rad(m.yaw_deg ?? 0)), m.name).toBe(true);
      if (m.half) expect(close(rec.volume.size, m.half.map((h: number) => 2 * h), 1e-4), m.name).toBe(true);
    }
    expect(manifest.galleries).toEqual([
      expect.objectContaining({ slug: "gallery-one", spawn: "spawn:gallery-one", entrance: "entrance:gallery-one", exit: "exit:gallery-one", anchors: ["east-01", "east-02", "east-03", "floor-01", "floor-02", "intro", "north-01", "north-02", "south-01", "south-02"] }),
    ]);
    expect(manifest.collections.MARKERS).toHaveLength(gallerySpec.markers.length);
  });

  it("is deterministic and independent of the export's object order", () => {
    const shuffled = { ...galleryExport, objects: [...galleryExport.objects].reverse() };
    expect(JSON.stringify(importBlenderExport(shuffled).manifest)).toBe(JSON.stringify(manifest));
  });

  it("the committed fixture export is portable (no machine paths, no triangle arrays)", () => {
    for (const name of ["gallery-one.blender-export.json", "contract-coverage.blender-export.json"]) {
      const text = readFileSync(join(APP_ROOT, "spatial/authoring/blender", name), "utf8");
      expect(text, name).not.toMatch(/[A-Za-z]:\\\\|AWE-Scratch|AppData|\/Users\//);
      expect(text, name).not.toMatch(/"indices"|"positions"/);
    }
    const again = portableExport({ ...galleryExport, file: { path: "D:\\work\\gallery-one.blend" }, dependencies: [{ kind: "image", name: "a.png", path: "D:\\work\\textures\\a.png" }, { kind: "image", name: "b.png", path: "E:\\library\\b.png" }] });
    expect(again.file.path).toBe("gallery-one.blend");
    expect(again.dependencies.map((d: { path: string }) => d.path)).toEqual(["//textures/a.png", "b.png"]);
    // M4: the same on any OS — a POSIX export is made portable the same way (CI runs on Linux).
    const posix = portableExport({ ...galleryExport, file: { path: "/home/owner/work/gallery-one.blend" }, dependencies: [{ kind: "image", name: "a.png", path: "/home/owner/work/textures/a.png" }, { kind: "image", name: "b.png", path: "/srv/library/b.png" }] });
    expect(posix.file.path).toBe("gallery-one.blend");
    expect(posix.dependencies.map((d: { path: string }) => d.path)).toEqual(["//textures/a.png", "b.png"]);
  });
});

describe("contract coverage — every seeded defect is reported (importer rules; SIC rules in the plan below)", () => {
  const imported = importBlenderExport(coverageExport);
  const manifest = imported.manifest as Mutable;
  const findings = imported.findings;
  const got = findings.filter((f) => f.level !== "info").map((f) => `${f.level}:${f.code}:${f.subject}`).sort();

  it("reports exactly the seeded problems", () => {
    expect(got).toEqual(
      [
        "error:anchor-outside-gallery:anchor:lobby:far-01",
        "error:anchor-unknown-gallery:anchor:nowhere:a-01",
        "error:degenerate-transform:flat-thing",
        "error:marker-duplicate:spawn:lobby.001",
        "error:marker-invalid-slug:spawn:Lobby_Main",
        "error:marker-not-empty:entrance:lobby",
        "error:marker-unknown-kind:door:lobby",
        "error:missing-texture:overlap-b",
        "warning:marker-outside-markers:spawn:roof",
        "warning:marker-tilted:spawn:tilted",
        "warning:material-auto-copy:lobby-wall-copy",
        "warning:mirrored-transform:mirror-box",
        "warning:suspect-unit-scale:tower-cm",
        "warning:suspect-unit-size:giant-slab",
        "warning:uncategorised-object:stray",
      ].sort(),
    );
    // Valid examples of every kind import as markers.
    expect(new Set(manifest!.markers.map((m: { kind: string }) => m.kind))).toEqual(new Set(["spawn", "exit", "skylift", "drop", "portal", "gallery", "anchor", "interact", "chunk"]));
    expect(manifest!.markers.find((m: { name: string }) => m.name === "portal:club-door").props).toEqual({ nrvna_destination: "dst_gqq90k2404cy9nf0" });
  });

  it("the SIC plan asks clearance at the in-wall spawn and the exact intersection of the overlapping buildings", () => {
    const plan = planSicChecks(manifest);
    expect(plan.map((c) => c.id)).toContain("clearance:spawn:in-wall");
    expect(plan.map((c) => c.id)).toContain("intersects:overlap-a+overlap-b");
    expect(plan.some((c) => c.id === "intersects:ground+lobby-wall")).toBe(false); // touching, not overlapping
    const blocked = plan.find((c) => c.id === "clearance:spawn:in-wall")!.read({ id: "F-1", tier: "primitive", exact: true, result: { fits: false, blockers: ["lobby-wall"], clearance_m: -0.6, conclusive: true } });
    expect(blocked).toMatchObject({ code: "marker-blocked", level: "error", subject: "spawn:in-wall", evidence: { sicFinding: "F-1", blockers: ["lobby-wall"] } });
    const pierce = plan.find((c) => c.id === "intersects:overlap-a+overlap-b")!.read({ id: "F-2", result: { intersects: true, penetration_m: 4 } });
    expect(pierce).toMatchObject({ code: "geometry-interpenetration", level: "warning" });
    expect(plan.find((c) => c.id === "clearance:spawn:lobby")!.read({ result: { fits: true } })).toBeNull();
  });

  it("objects SIC cannot load are left out of SIC's copy only", () => {
    const copy = sicLoadableExport(coverageExport, findings);
    expect(copy.objects.some((o: { name: string }) => o.name === "flat-thing")).toBe(false);
    expect(coverageExport.objects.some((o: { name: string }) => o.name === "flat-thing")).toBe(true);
  });
});

describe("units, identity and safety", () => {
  it("a scene unit scale is reported and applied to every length", () => {
    const cm = { ...galleryExport, unit_settings: { system: "METRIC", length_unit: "CENTIMETERS", scale_length: 0.01 } };
    const { manifest: m, findings } = importBlenderExport(cm);
    const manifest = m as Mutable;
    expect(findings.some((f) => f.code === "scene-unit-scale" && f.level === "warning")).toBe(true);
    const floor = manifest!.objects.find((o: { name: string }) => o.name === "gallery-one-floor");
    expect(close(floor.box.center, [0.48, 0.0005, 1.5], 1e-6)).toBe(true);
  });

  it("a duplicate nrvna_id is an error; an unsupported source is refused", () => {
    const dup = structuredClone(galleryExport);
    dup.objects.find((o: { name: string }) => o.name === "bench-centre").custom_props = { nrvna_id: "gallery-one.floor" };
    expect(importBlenderExport(dup).findings.some((f) => f.code === "duplicate-object-id")).toBe(true);
    expect(importBlenderExport({ format: "sic.scene/0", objects: [] } as never)).toMatchObject({ manifest: null, findings: [{ code: "unsupported-source", level: "error" }] });
  });

  it("the Gallery One SIC plan checks the spawn, the doorway and all ten anchor sightlines", () => {
    const plan = planSicChecks(importBlenderExport(galleryExport).manifest);
    const ids = plan.map((c) => c.id);
    for (const k of ["clearance:spawn:gallery-one", "clearance:entrance:gallery-one", "clearance:exit:gallery-one", "clearance:interact:gallery-one-desk", "ground:spawn:gallery-one"]) expect(ids).toContain(k);
    expect(ids.filter((i) => i.startsWith("sightline:"))).toHaveLength(10);
    expect(ids.filter((i) => i.startsWith("intersects:"))).toEqual([]); // the shell is touching, never interpenetrating
  });

  it("the dry-run CLI refuses to write inside the repository and runs on an export without Blender", () => {
    const cli = join(APP_ROOT, "scripts/authoring/cli.mjs");
    const input = join(APP_ROOT, "spatial/authoring/blender/gallery-one.blender-export.json");
    const refused = spawnSync(process.execPath, [cli, "inspect", input, "--out", join(APP_ROOT, "tmp-authoring")], { encoding: "utf8" });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/refusing to write the dry-run report inside the repository/);
    const out = mkdtempSync(join(tmpdir(), "nrvna-authoring-test-"));
    try {
      const ok = spawnSync(process.execPath, [cli, "inspect", input, "--out", out, "--no-sic"], { encoding: "utf8" });
      expect(ok.status, ok.stderr).toBe(0);
      const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
      expect(report).toMatchObject({ format: "nrvna.authoring-report/1", dryRun: true, summary: { errors: 0, warnings: 0 } });
      expect(readFileSync(join(out, "report.md"), "utf8")).toMatch(/DRY RUN: nothing was published/);
      const bad = spawnSync(process.execPath, [cli, "inspect", join(APP_ROOT, "spatial/authoring/blender/contract-coverage.blender-export.json"), "--out", out, "--no-sic"], { encoding: "utf8" });
      expect(bad.status).toBe(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
