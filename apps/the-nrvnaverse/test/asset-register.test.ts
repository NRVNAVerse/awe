import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runPrepare, runPublish, runRegister } from "../scripts/asset-pipeline/cli";
import type { ObjectHead, ObjectTransport } from "../scripts/asset-pipeline/s3-transport";
import { readAssetRegistry } from "../scripts/spatial/cli.mjs";
import { generateSpatialArtifacts, validateSpatialSource } from "../scripts/spatial/pipeline.mjs";

/**
 * asset:register — a VERIFIED publication becomes the exact committed registry revision; proposal by
 * default, written only with --apply. Runs the real prepare → publish → register flow on synthetic
 * GLBs, an in-memory object store and a TEMP COPY of the committed spatial source (the committed
 * source is never modified).
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMITTED_SOURCE = join(APP_ROOT, "spatial", "source");
const ID = "ast_fx7k2m9q4w8r3t6y";
const ENV = {
  NRVNA_ASSET_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  NRVNA_ASSET_R2_BUCKET: "nrvnaverse-assets",
  NRVNA_ASSET_R2_ACCESS_KEY_ID: "k",
  NRVNA_ASSET_R2_SECRET_ACCESS_KEY: "s",
  NRVNA_ASSET_PUBLIC_ORIGIN: "https://assets.nrvnaverse.com",
};
const COMMITTED = { "external-cas": { publicOrigin: "https://assets.nrvnaverse.com" } };
const APPROVED = { status: "approved", reviewedBy: "Fixture Reviewer", reviewedAt: "2026-09-24T10:00:00-07:00" };

function memoryTransport(): ObjectTransport {
  const objects = new Map<string, { body: Uint8Array; head: ObjectHead }>();
  return {
    description: "memory://bucket",
    async head(k) {
      const o = objects.get(k);
      return o ? { ...o.head } : null;
    },
    async get(k) {
      return objects.get(k)?.body.slice() ?? null;
    },
    async putIfAbsent(k, body, o) {
      if (objects.has(k)) return "exists";
      objects.set(k, { body: body.slice(), head: { bytes: body.byteLength, contentType: o.contentType, cacheControl: o.cacheControl, metadata: o.metadata } });
      return "created";
    },
  };
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    assetId: ID,
    name: "Synthetic registration cube",
    kind: "model",
    usage: "production",
    provenance: { origin: "self-authored", creationContext: "original", creator: "NRVNAVerse test suite", dependencies: [] },
    rights: { status: "cleared", license: "test fixture", rightsHolder: "NRVNAVerse", attributionRequired: false, attributionText: null, commercialUse: "allowed", webRuntimeRedistribution: "allowed", modification: "allowed", restrictions: [] },
    review: { ...APPROVED },
    ...overrides,
  };
}

type Fixtures = { bigTexturedCube(options?: Record<string, unknown>): Promise<Buffer> };
const FIXTURES = new URL("../../../packages/tools/test/support/gltf-fixtures.ts", import.meta.url).href;
let cube: Buffer;
let animatedCube: Buffer;
beforeAll(async () => {
  const fx = (await import(/* @vite-ignore */ FIXTURES)) as Fixtures;
  cube = await fx.bigTexturedCube();
  animatedCube = await fx.bigTexturedCube({ animated: true });
}, 60_000);

let dir: string;
let sourceDir: string;
let transport: ObjectTransport;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nrvnaverse-register-"));
  sourceDir = join(dir, "source");
  mkdirSync(sourceDir);
  for (const f of ["spatial-config.m0.json", "scene.m0.json"]) copyFileSync(join(COMMITTED_SOURCE, f), join(sourceDir, f));
  transport = memoryTransport();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2));
const registryPath = () => join(sourceDir, "asset-registry.json");
const configPath = () => join(sourceDir, "spatial-config.m0.json");

/** prepare + publish one GLB into `<dir>/<out>`; returns the report paths. */
async function preparedAndPublished(glb: Buffer, meta = metadata(), out = "staging", registry?: string) {
  writeFileSync(join(dir, `${out}.glb`), glb);
  writeFileSync(join(dir, `${out}.json`), JSON.stringify(meta));
  const prep = await runPrepare([join(dir, `${out}.glb`), join(dir, `${out}.json`), "--out", join(dir, out), ...(registry ? ["--registry", registry] : [])]);
  expect(prep.exitCode, prep.lines.join("\n")).toBe(0);
  const pub = await runPublish([prep.reportPath!], { env: ENV, transportFor: () => transport, committedStorage: COMMITTED });
  expect(pub.exitCode, pub.lines.join("\n")).toBe(0);
  return { prepare: prep.reportPath!, publish: pub.reportPath! };
}

const register = (publishReport: string, apply = false) => runRegister([publishReport, ...(apply ? ["--apply"] : [])], { sourceDir });
const blockersOf = async (publishReport: string) => readJson((await register(publishReport)).reportPath!).blockers.map((b: { code: string }) => b.code);

describe("asset:register — proposal by default, explicit --apply", () => {
  it("proposes a deterministic diff and changes nothing", async () => {
    const { publish } = await preparedAndPublished(cube);
    const configBefore = readFileSync(configPath(), "utf8");
    const run = await register(publish);
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    expect(run.lines[0]).toBe(`PROPOSED (proposal — nothing changed; --apply to write): ${ID} revision 1 → spatial/source/asset-registry.json`);
    const diff = run.lines.filter((l) => l.startsWith("diff"));
    expect(diff[0]).toBe('diff     + config.assetRegistry  "asset-registry.json"');
    expect(diff[1]).toMatch(new RegExp(`^diff     \\+ assets\\.${ID}  .*"currentRevision":1`));
    expect(diff[2]).toMatch(new RegExp(`^diff     \\+ assets\\.${ID}\\.revisions\\.1  sha256 [0-9a-f]{64} · \\d+ bytes · external-cas:art/${ID}/[0-9a-f]{64}\\.glb$`));
    expect(existsSync(registryPath())).toBe(false);
    expect(readFileSync(configPath(), "utf8")).toBe(configBefore);
    // Deterministic: the same inputs give the same proposal.
    expect((await register(publish)).lines).toEqual(run.lines);
  });

  it("--apply writes the exact revision, declares the registry, and never places the asset", async () => {
    const { publish, prepare } = await preparedAndPublished(cube);
    const sceneBefore = readFileSync(join(sourceDir, "scene.m0.json"), "utf8");
    const run = await register(publish, true);
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    expect(run.lines[0]).toMatch(/^APPLIED: /);

    const registry = readAssetRegistry(registryPath()) as Record<string, any>;
    const proposal = readJson(prepare).registryProposal;
    expect(registry.assets[ID]).toEqual(proposal.record); // identity, digest, key, H2 stats, provenance, rights, review preserved
    expect(registry.assets[ID].revisions["1"].artifact.storage).toEqual({ backend: "external-cas", objectKey: readJson(prepare).artifact.storage.objectKey });
    expect(readJson(configPath()).assetRegistry).toBe("asset-registry.json");
    expect(readFileSync(join(sourceDir, "scene.m0.json"), "utf8")).toBe(sceneBefore); // no assetRef added

    // The committed spatial generation is unchanged: registered ≠ referenced.
    const source = { config: readJson(configPath()), scene: readJson(join(sourceDir, "scene.m0.json")), destinations: readJson(join(APP_ROOT, "../../packages/nrvna-manifest/generated/destinations.json")), assets: registry };
    expect(validateSpatialSource(source).ok).toBe(true);
    const committed = { config: readJson(join(COMMITTED_SOURCE, "spatial-config.m0.json")), scene: readJson(join(COMMITTED_SOURCE, "scene.m0.json")), destinations: source.destinations };
    expect(generateSpatialArtifacts(source).files).toEqual(generateSpatialArtifacts(committed).files);

    // Re-running is idempotent.
    const text = readFileSync(registryPath(), "utf8");
    const again = await register(publish, true);
    expect(again.lines[0]).toMatch(/^ALREADY-REGISTERED/);
    expect(readFileSync(registryPath(), "utf8")).toBe(text);
  });

  it("registers a second revision with a fresh review, keeping revision 1 immutable", async () => {
    const first = await preparedAndPublished(cube);
    await register(first.publish, true);
    const r1 = readAssetRegistry(registryPath()) as Record<string, any>;
    const second = await preparedAndPublished(animatedCube, metadata({ review: { ...APPROVED, reviewedAt: "2026-09-25T09:00:00-07:00" } }), "second", registryPath());
    const run = await register(second.publish, true);
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    expect(run.lines.filter((l) => l.startsWith("diff"))).toEqual([
      expect.stringMatching(/^diff {5}~ assets\.ast_fx7k2m9q4w8r3t6y\.review /),
      "diff     ~ assets.ast_fx7k2m9q4w8r3t6y.currentRevision  1 → 2",
      expect.stringMatching(/^diff {5}\+ assets\.ast_fx7k2m9q4w8r3t6y\.revisions\.2 /),
    ]);
    const r2 = readAssetRegistry(registryPath()) as Record<string, any>;
    expect(r2.assets[ID].currentRevision).toBe(2);
    expect(r2.assets[ID].revisions["1"]).toEqual(r1.assets[ID].revisions["1"]);
  });
});

describe("asset:register — refusals (nothing is written)", () => {
  const edit = (path: string, mutate: (v: any) => void) => {
    const v = readJson(path);
    mutate(v);
    writeJson(path, v);
  };

  it("refuses a dry-run, blocked or failed publication", async () => {
    const { publish } = await preparedAndPublished(cube);
    for (const change of [(v: any) => (v.mode = "dry-run"), (v: any) => (v.status = "planned"), (v: any) => (v.status = "failed"), (v: any) => (v.kind = "something-else")]) {
      const copy = join(dir, "staging", "published", "copy.json");
      writeJson(copy, readJson(publish));
      edit(copy, change);
      expect((await blockersOf(copy))[0]).toMatch(/not-published|invalid-publish-report/);
    }
    expect(existsSync(registryPath())).toBe(false);
  });

  it("refuses a digest / verification mismatch", async () => {
    const { publish } = await preparedAndPublished(cube);
    edit(publish, (v) => (v.verification.sha256 = "0".repeat(64)));
    expect(await blockersOf(publish)).toContain("digest-mismatch");
  });

  it("refuses unverified evidence (no full-object SHA-256)", async () => {
    const { publish } = await preparedAndPublished(cube);
    edit(publish, (v) => (v.verification.method = "etag"));
    expect(await blockersOf(publish)).toContain("unverified");
  });

  it("refuses hand-edited derived stats — even when both reports are edited consistently", async () => {
    const { publish, prepare } = await preparedAndPublished(cube);
    edit(publish, (v) => (v.registryRevision.record.revisions["1"].stats.triangles = 1));
    expect(await blockersOf(publish)).toEqual(["derived-facts-edited", "derived-facts-edited"]);
    edit(prepare, (v) => (v.registryProposal.record.revisions["1"].stats.triangles = 1));
    expect(await blockersOf(publish)).toEqual(["derived-facts-edited"]); // H2 re-derivation from the bytes
  });

  it("refuses when the staged bytes are gone (stats cannot be re-derived)", async () => {
    const { publish } = await preparedAndPublished(cube);
    rmSync(join(dir, "staging", "objects"), { recursive: true });
    expect(await blockersOf(publish)).toEqual(["staged-object-missing"]);
  });

  it("refuses a production record with incomplete rights", async () => {
    const { publish, prepare } = await preparedAndPublished(cube);
    for (const p of [publish, prepare]) {
      edit(p, (v) => ((p === publish ? v.registryRevision : v.registryProposal).record.rights.commercialUse = "unknown"));
    }
    expect(await blockersOf(publish)).toEqual(["not-production-eligible"]);
  });

  it("refuses a storage backend or public origin mismatch", async () => {
    const { publish } = await preparedAndPublished(cube);
    const copy = join(dir, "staging", "published", "copy.json");
    writeJson(copy, readJson(publish));
    edit(copy, (v) => (v.plan.runtimeUrl = v.plan.runtimeUrl.replace("assets.nrvnaverse.com", "cdn.example.com")));
    expect(await blockersOf(copy)).toEqual(["origin-mismatch"]);
    edit(configPath(), (v) => (v.assetStorage["external-cas"].publicOrigin = "https://cdn.example.com"));
    expect(await blockersOf(publish)).toEqual(["origin-mismatch"]);
    edit(configPath(), (v) => (v.assetStorage["external-cas"].publicOrigin = "https://assets.nrvnaverse.com"));
    edit(publish, (v) => (v.plan.backend = "repo-public"));
    expect(await blockersOf(publish)).toContain("backend-mismatch");
  });

  it("refuses the same revision number with different bytes", async () => {
    const first = await preparedAndPublished(cube);
    await register(first.publish, true);
    const before = readFileSync(registryPath(), "utf8");
    // Prepared WITHOUT the registry: it proposes revision 1 again, for other bytes.
    const clash = await preparedAndPublished(animatedCube, metadata({ review: { ...APPROVED, reviewedAt: "2026-09-25T09:00:00-07:00" } }), "clash");
    const run = await register(clash.publish, true);
    expect(run.exitCode).toBe(2);
    expect(readJson(run.reportPath!).blockers.map((b: { code: string }) => b.code)).toContain("revision-conflict");
    expect(readFileSync(registryPath(), "utf8")).toBe(before);
  });

  it("refuses a human review carried over from earlier bytes", async () => {
    const first = await preparedAndPublished(cube);
    await register(first.publish, true);
    const fresh = { ...APPROVED, reviewedAt: "2026-09-25T09:00:00-07:00" };
    const second = await preparedAndPublished(animatedCube, metadata({ review: fresh }), "second", registryPath());
    // Copy the OLD review onto the new revision in both reports (the pipeline would have refused it).
    edit(second.publish, (v) => (v.registryRevision.record.review = { ...APPROVED }));
    edit(second.prepare, (v) => (v.registryProposal.record.review = { ...APPROVED }));
    expect(await blockersOf(second.publish)).toEqual(["stale-review"]);
    // An older reviewedAt than the one on record is stale too.
    edit(second.publish, (v) => (v.registryRevision.record.review = { ...APPROVED, reviewedAt: "2026-01-01T00:00:00Z" }));
    edit(second.prepare, (v) => (v.registryProposal.record.review = { ...APPROVED, reviewedAt: "2026-01-01T00:00:00Z" }));
    expect(await blockersOf(second.publish)).toEqual(["stale-review"]);
  });

  it("usage errors exit 1", async () => {
    expect((await runRegister([])).exitCode).toBe(1);
    expect((await runRegister(["a.json", "--force"])).exitCode).toBe(1);
    expect((await runRegister([join(dir, "missing.json")], { sourceDir })).exitCode).toBe(1);
  });
});
