import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runPlace } from "../scripts/asset-pipeline/cli";
import { parseVec3 } from "../scripts/asset-pipeline/place-asset";
import { generateSpatialArtifacts, validateSpatialSource } from "../scripts/spatial/pipeline.mjs";

/**
 * asset:place — a human-chosen placement of a REGISTERED production asset into one destination's
 * chunk, by assetRef. Runs on a TEMP COPY of the committed spatial source and generated output with a
 * synthetic registry (no real art, no network); the committed files are never modified.
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMITTED_SOURCE = join(APP_ROOT, "spatial", "source");
const ID = "ast_fx7k2m9q4w8r3t6y";
const SHA = "a808fd4a5d2301241145513020becc1409e8b7a98ee04e5d1be634632f0428e9";
const KEY = `art/${ID}/${SHA}.glb`;
const HUB = "dst_7g19n1vm9ackw8a0";
const MUSIC = "dst_gm3xs4a3tws7bgh3";
const CANNABIS = "dst_441dtdafq3e3ehjn";

function registeredAsset(overrides: Record<string, unknown> = {}) {
  return {
    name: "Synthetic Hub centrepiece",
    kind: "model",
    usage: "production",
    currentRevision: 1,
    provenance: { origin: "self-authored", creationContext: "original", creator: "NRVNAVerse test suite", dependencies: [] },
    rights: { status: "cleared", license: "test fixture", rightsHolder: "NRVNAVerse", attributionRequired: false, attributionText: null, commercialUse: "allowed", webRuntimeRedistribution: "allowed", modification: "allowed", restrictions: [] },
    review: { status: "approved", reviewedBy: "Fixture Reviewer", reviewedAt: "2026-09-24T10:00:00-07:00" },
    revisions: { "1": { artifact: { sha256: SHA, bytes: 177428, format: "glb", storage: { backend: "external-cas", objectKey: KEY } }, stats: { triangles: 12 }, pipeline: { optimization: "optimized" } } },
    ...overrides,
  };
}

let dir: string;
let sourceDir: string;
let outputDir: string;
const scenePath = () => join(sourceDir, "scene.m0.json");
const configPath = () => join(sourceDir, "spatial-config.m0.json");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const snapshot = (d: string) => Object.fromEntries(readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => { const p = join(e.parentPath, e.name); return [p.slice(d.length + 1).split("\\").join("/"), readFileSync(p, "utf8")]; }));

function withRegistry(asset: Record<string, unknown> | null = registeredAsset()) {
  writeFileSync(join(sourceDir, "asset-registry.json"), JSON.stringify({ schemaVersion: 1, assets: asset ? { [ID]: asset } : {} }, null, 2));
  const text = readFileSync(configPath(), "utf8");
  writeFileSync(configPath(), text.replace(/("scene":\s*"[^"]+",)/, '$1\n  "assetRegistry": "asset-registry.json",'));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nrvnaverse-place-"));
  sourceDir = join(dir, "source");
  outputDir = join(dir, "data");
  mkdirSync(sourceDir);
  for (const f of ["spatial-config.m0.json", "scene.m0.json"]) copyFileSync(join(COMMITTED_SOURCE, f), join(sourceDir, f));
  cpSync(join(APP_ROOT, "public", "data"), outputDir, { recursive: true });
  withRegistry();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const place = (args: string[]) => runPlace(args, { sourceDir, outputDir });
const HUB_ARGS = [ID, "--destination", HUB, "--component", "hub-centrepiece", "--position", "0,0.5,-4", "--rotation", "0,1.5708,0", "--scale", "1.5"];
const codes = (lines: string[]) => lines.filter((l) => l.startsWith("BLOCKER")).map((l) => /\[([a-z-]+)\]/.exec(l)![1]);

describe("asset:place — proposal by default", () => {
  it("shows the resolved placement and expected changes, and writes nothing", async () => {
    const before = { source: snapshot(sourceDir), data: snapshot(outputDir) };
    const run = await place(HUB_ARGS);
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    expect(run.lines[0]).toBe(`PROPOSED (proposal — nothing changed; --apply to write): ${ID} revision 1 → THE NRVNAVerse Hub (${HUB}), chunk "hub", component "hub-centrepiece"`);
    expect(run.lines).toContain(`url      https://assets.nrvnaverse.com/${KEY}  (resolved at generate time from assetRef; never written to the source)`);
    expect(run.lines).toContain('transform position 0,0.5,-4 · rotation 0,1.5708,0 rad · scale 1.5,1.5,1.5 · name "Synthetic Hub centrepiece"');
    expect(run.lines.filter((l) => l.startsWith("source"))).toHaveLength(2);
    const gen = run.lines.filter((l) => l.startsWith("generate")).map((l) => l.slice(9));
    expect(gen).toEqual([expect.stringMatching(/^- spatial\/chunks\/hub\.[0-9a-f]{32}\.json$/), expect.stringMatching(/^\+ spatial\/chunks\/hub\.[0-9a-f]{32}\.json$/), "~ spatial/spatial-index.json", "~ static-scene.json"].sort());
    expect({ source: snapshot(sourceDir), data: snapshot(outputDir) }).toEqual(before);
  });
});

describe("asset:place --apply", () => {
  it("writes exactly one assetRef component + one chunk id, regenerates, and changes only the Hub chunk", async () => {
    const sceneBefore = readFileSync(scenePath(), "utf8");
    const configBefore = readFileSync(configPath(), "utf8");
    const dataBefore = snapshot(outputDir);
    const run = await place([...HUB_ARGS, "--apply"]);
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    expect(run.lines[0]).toMatch(/^APPLIED: /);

    // Source: the component names the asset, never a URL.
    const component = readJson(scenePath()).components["hub-centrepiece"];
    expect(component).toEqual({ name: "Synthetic Hub centrepiece", id: "hub-centrepiece", type: "model", kit: "cyber", assetRef: ID, position: { x: 0, y: 0.5, z: -4 }, rotation: { x: 0, y: 1.5708, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 } });
    expect(readFileSync(scenePath(), "utf8")).not.toContain("assets.nrvnaverse.com");
    const config = readJson(configPath());
    expect(config.chunks.find((c: { key: string }) => c.key === "hub").componentIds.at(-1)).toBe("hub-centrepiece");
    // Minimal change: config gains exactly one line; the scene only gains the component block.
    const cfgBefore = configBefore.split(/\r?\n/);
    const cfgAfter = readFileSync(configPath(), "utf8").split(/\r?\n/);
    expect(cfgAfter.length).toBe(cfgBefore.length + 1);
    expect(cfgAfter.filter((l, i) => l !== cfgBefore[i - (i > cfgAfter.indexOf('        "hub-centrepiece"') ? 1 : 0)])).toEqual(['        "portal-hub-cannabis",', '        "hub-centrepiece"']);
    const sb = sceneBefore.split(/\r?\n/);
    const sa = readFileSync(scenePath(), "utf8").split(/\r?\n/);
    expect(sa.slice(0, sb.findIndex((l, i) => l !== sa[i]))).toEqual(sb.slice(0, sb.findIndex((l, i) => l !== sa[i])));

    // Generation: only the Hub chunk (new name), the index and the compatibility scene changed.
    const dataAfter = snapshot(outputDir);
    const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((k) => dataBefore[k] !== dataAfter[k]).sort();
    expect(changed).toEqual([expect.stringMatching(/^spatial\/chunks\/hub\.[0-9a-f]{32}\.json$/), expect.stringMatching(/^spatial\/chunks\/hub\.[0-9a-f]{32}\.json$/), "spatial/spatial-index.json", "static-scene.json"]);
    const hubFile = Object.keys(dataAfter).find((k) => k.startsWith("spatial/chunks/hub.") && !(k in dataBefore))!;
    const hub = JSON.parse(dataAfter[hubFile]);
    expect(hub.components["hub-centrepiece"].url).toBe(`https://assets.nrvnaverse.com/${KEY}`);
    expect(hub.components["hub-centrepiece"].assetRef).toBeUndefined();

    // The resulting source validates and regenerates to exactly what was written.
    const source = { config, scene: readJson(scenePath()), destinations: readJson(join(APP_ROOT, "../../packages/nrvna-manifest/generated/destinations.json")), assets: readJson(join(sourceDir, "asset-registry.json")) };
    expect(validateSpatialSource(source).ok).toBe(true);
    // untouched outputs keep the worktree CRLF under autocrlf: compare content, not line endings
    for (const [name, text] of Object.entries(generateSpatialArtifacts(source).files)) expect(dataAfter[name]?.replace(/\r\n/g, "\n"), name).toBe(text);
  });

  it("is idempotent: the same placement again is ALREADY-PLACED and changes nothing", async () => {
    await place([...HUB_ARGS, "--apply"]);
    const snap = { source: snapshot(sourceDir), data: snapshot(outputDir) };
    const again = await place([...HUB_ARGS, "--apply"]);
    expect(again.exitCode).toBe(0);
    expect(again.lines[0]).toMatch(/^ALREADY-PLACED: /);
    expect({ source: snapshot(sourceDir), data: snapshot(outputDir) }).toEqual(snap);
  });
});

describe("asset:place — refusals (nothing written)", () => {
  const refused = async (args: string[]) => {
    const snap = { source: snapshot(sourceDir), data: snapshot(outputDir) };
    const run = await place(args);
    expect({ source: snapshot(sourceDir), data: snapshot(outputDir) }).toEqual(snap);
    return run;
  };
  const withArgs = (patch: Record<string, string>) => {
    const args = [...HUB_ARGS];
    for (const [flag, value] of Object.entries(patch)) args[args.indexOf(flag) + 1] = value;
    return args;
  };

  it("unknown or unregistered asset; no registry at all", async () => {
    expect(codes((await refused(["ast_2b4d6f8h0j1k3m5n", ...HUB_ARGS.slice(1)])).lines)).toEqual(["unregistered-asset"]);
    copyFileSync(join(COMMITTED_SOURCE, "spatial-config.m0.json"), configPath());
    expect(codes((await refused(HUB_ARGS)).lines)).toEqual(["unregistered-asset"]);
  });

  it("non-production and not-production-eligible assets", async () => {
    withRegistry(registeredAsset({ usage: "internal-tracer", review: { status: "internal-tracer-accepted", reviewedBy: "R", reviewedAt: "2026-09-24T10:00:00Z" } }));
    expect(codes((await refused(HUB_ARGS)).lines)).toEqual(["not-production"]);
    withRegistry(registeredAsset({ review: { status: "unreviewed", reviewedBy: null, reviewedAt: null } }));
    expect(codes((await refused(HUB_ARGS)).lines)).toEqual(["not-production-eligible"]);
  });

  it("unresolved storage origin", async () => {
    const text = readFileSync(configPath(), "utf8").replace(/\s*"assetStorage": \{[^}]*\}\s*\},/, "");
    writeFileSync(configPath(), text);
    expect(readJson(configPath()).assetStorage).toBeUndefined();
    expect(codes((await refused(HUB_ARGS)).lines)).toEqual(["storage-unresolved"]);
  });

  it("unknown destination / chunk and gated destinations", async () => {
    for (const d of ["dst_0000000000000000", "hub", "https://worlds.nrvnaverse.com/?destination=x"]) {
      expect(codes((await refused(withArgs({ "--destination": d }))).lines), d).toEqual(["unknown-destination"]);
    }
    expect(codes((await refused(withArgs({ "--destination": CANNABIS }))).lines)).toEqual(["gated-destination"]);
    // A non-gated district works (the Music chunk also carries the Artist placeholder).
    expect((await place(withArgs({ "--destination": MUSIC }))).exitCode).toBe(0);
  });

  it("duplicate component ids, including a different placement under an already-used id", async () => {
    expect(codes((await refused(withArgs({ "--component": "platform-hub" }))).lines)).toEqual(["duplicate-component"]);
    await place([...HUB_ARGS, "--apply"]);
    expect(codes((await refused(withArgs({ "--position": "1,0.5,-4" }))).lines)).toEqual(["duplicate-component"]);
    expect(codes((await refused(withArgs({ "--destination": MUSIC }))).lines)).toEqual(["duplicate-component"]);
  });

  it("malformed transforms and ids", async () => {
    for (const patch of <Record<string, string>[]>[{ "--position": "1,2" }, { "--position": "a,b,c" }, { "--position": "1e999,0,0" }, { "--position": "20000,0,0" }, { "--scale": "0" }, { "--scale": "-1,1,1" }, { "--rotation": "0,10,0" }, { "--position": "NaN,0,0" }]) {
      const run = await refused(withArgs(patch));
      expect(run.exitCode, JSON.stringify(patch)).toBe(2);
      expect(run.lines.join("\n"), JSON.stringify(patch)).toMatch(/invalid-transform/);
    }
    for (const id of ["Hub Art", "hub_art", "-hub", "a".repeat(65)]) expect(codes((await refused(withArgs({ "--component": id }))).lines), id).toEqual(["invalid-component-id"]);
    expect(parseVec3("1, 2.5, -3")).toEqual({ x: 1, y: 2.5, z: -3 });
    expect(parseVec3("2", { uniform: true })).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("a raw URL can never be injected", async () => {
    expect(codes((await refused(["https://evil.example/x.glb", ...HUB_ARGS.slice(1)])).lines)).toEqual(["invalid-asset-id"]);
    expect((await refused([...HUB_ARGS, "--url", "https://evil.example/x.glb"])).exitCode).toBe(1);
    // A URL-looking name is inert display text: the component still has no url field.
    await place([...withArgs({ "--component": "named-art" }), "--name", "https://evil.example/x.glb", "--apply"]);
    const c = readJson(scenePath()).components["named-art"];
    expect(c.url).toBeUndefined();
    expect(c.assetRef).toBe(ID);
  });

  it("usage errors exit 1", async () => {
    expect((await place([])).exitCode).toBe(1);
    expect((await place([ID, "--destination", HUB])).exitCode).toBe(1);
    expect((await place([...HUB_ARGS, "--component", "again"])).exitCode).toBe(1);
  });
});
