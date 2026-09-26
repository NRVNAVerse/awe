import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadAweGltf } from "../scripts/asset-pipeline/awe-gltf";
import { runPrepare } from "../scripts/asset-pipeline/cli";
import { NRVNAVERSE_OPTIMIZE_PROFILE, prepareAsset, stablePrepareJson, stagePrepared, type PrepareResult } from "../scripts/asset-pipeline/prepare-asset";
import { localStagingAdapter, sha256Of } from "../scripts/asset-pipeline/staging";
import { EXTERNAL_CAS_OBJECT_KEY, assetGate, validateAssetRegistry, type AssetRegistry } from "../scripts/spatial/assets.mjs";

/**
 * M1.1 production-asset intake (scripts/asset-pipeline) on SYNTHETIC data only: GLBs are built in
 * memory by the AWE tools' own deterministic fixtures, staging goes to a temp directory. No vault
 * asset, committed binary or network is involved.
 */

type Fixtures = {
  bigTexturedCube(options?: Record<string, unknown>): Promise<Buffer>;
  texturedCube(png: Buffer, options?: Record<string, unknown>): Buffer;
  flatPng(size?: number): Promise<Buffer>;
  emptyGlb(extra?: Record<string, unknown>): Buffer;
  CUBE: { triangles: number; weldedVertices: number };
};
const FIXTURES = new URL("../../../packages/tools/test/support/gltf-fixtures.ts", import.meta.url).href;

const ID = "ast_fx7k2m9q4w8r3t6y";
const APPROVED = { status: "approved", reviewedBy: "Fixture Reviewer", reviewedAt: "2026-09-24T10:00:00-07:00" };

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: ID,
    name: "Synthetic intake cube",
    kind: "model",
    usage: "production",
    provenance: { origin: "self-authored", creationContext: "original", creator: "NRVNAVerse test suite", dependencies: [] },
    rights: {
      status: "cleared",
      license: "test fixture",
      rightsHolder: "NRVNAVerse",
      attributionRequired: false,
      attributionText: null,
      commercialUse: "allowed",
      webRuntimeRedistribution: "allowed",
      modification: "allowed",
      restrictions: [],
    },
    review: { ...APPROVED },
    ...overrides,
  };
}

const codes = (r: PrepareResult, kind: "blockers" | "warnings" = "blockers") => r.report[kind].map((i) => i.code);

let fx: Fixtures;
let optimizable: Uint8Array;
beforeAll(async () => {
  fx = (await import(/* @vite-ignore */ FIXTURES)) as Fixtures;
  optimizable = new Uint8Array(await fx.bigTexturedCube());
}, 60_000);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nrvnaverse-prepare-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AWE adoption seam", () => {
  it("loads H1 optimizeModel and H2 validateModel at the report versions it was written against", async () => {
    const awe = await loadAweGltf();
    expect(typeof awe.optimizeModel).toBe("function");
    expect(typeof awe.validateModel).toBe("function");
    const report = await awe.validateModel(optimizable);
    expect(report).toMatchObject({ kind: "gltf-validate", reportVersion: 1, valid: true });
  });
});

describe("prepare — successful synthetic end-to-end flow", () => {
  it("validates, optimises, re-validates and produces a ready, content-addressed production artifact", async () => {
    const result = await prepareAsset(optimizable, metadata());
    const { report } = result;
    expect(report.blockers).toEqual([]);
    expect(report.status).toBe("ready");
    expect(report.revision).toBe(1);
    expect(report.optimization).toMatchObject({ result: "optimized", skipCode: null, profile: NRVNAVERSE_OPTIMIZE_PROFILE });
    expect(report.optimization.transformsApplied).toContain("textures");
    expect(report.optimization.transformsApplied).not.toContain("draco"); // NRVNAVerse profile: Draco off
    expect(report.validation.source.valid).toBe(true);
    expect(report.validation.output?.valid).toBe(true);
    expect(report.validation.output?.extensionsUsed).toEqual(["EXT_texture_webp"]);

    // Digest, size and key describe exactly the bytes that would ship.
    const bytes = result.artifactBytes!;
    expect(bytes.byteLength).toBeLessThan(optimizable.byteLength);
    expect(report.artifact).toMatchObject({ sha256: sha256Of(bytes), bytes: bytes.byteLength, format: "glb", contentType: "model/gltf-binary" });
    expect(report.artifact!.storage).toEqual({ backend: "external-cas", objectKey: `art/${ID}/${sha256Of(bytes)}.glb` });
    expect(report.artifact!.storage.objectKey).toMatch(EXTERNAL_CAS_OBJECT_KEY);
    expect(report.source).toEqual({ sha256: sha256Of(optimizable), bytes: optimizable.byteLength });

    // Derived statistics (not self-declared) from AWE H2 on the output.
    const stats = report.registryProposal!.record.revisions["1"].stats!;
    expect(stats).toMatchObject({ source: "awe-validate-model@1", triangles: fx.CUBE.triangles, vertices: fx.CUBE.weldedVertices, meshes: 1, textures: 1 });
    expect(report.warnings.map((w) => w.code)).not.toContain("m1-unoptimized");
  });

  it("the registry proposal is a valid registry revision, bound to storage that is not referenceable yet", async () => {
    const { report } = await prepareAsset(optimizable, metadata());
    const registry = { schemaVersion: 1, assets: { [ID]: report.registryProposal!.record } } as AssetRegistry;
    expect(validateAssetRegistry(registry)).toEqual([]);
    expect(registry.assets[ID].currentRevision).toBe(1);
    expect(registry.assets[ID].revisions["1"].pipeline).toMatchObject({ optimization: "optimized", source: report.source });
    // Spatial binding: a scene may reference it only once the external backend resolves URLs.
    const gate = assetGate({ components: { m: { type: "model", assetRef: ID } }, registry });
    expect(gate.errors.map((e) => e.code)).toEqual(["asset-storage-unresolved"]);
  });

  it("is deterministic: identical artifact bytes and byte-identical prepare report", async () => {
    const a = await prepareAsset(optimizable, metadata());
    const b = await prepareAsset(new Uint8Array(optimizable), metadata());
    expect(Buffer.from(b.artifactBytes!).equals(Buffer.from(a.artifactBytes!))).toBe(true);
    expect(stablePrepareJson(b.report)).toBe(stablePrepareJson(a.report));
    expect(stablePrepareJson(a.report)).not.toMatch(/elapsedMs/);
  });

  it("stages write-once at the final object key and verifies size + SHA-256", async () => {
    const result = await prepareAsset(optimizable, metadata());
    const adapter = localStagingAdapter(dir);
    const staged = await stagePrepared(result, adapter);
    expect(staged).toEqual({ created: true, location: `objects/${result.report.artifact!.storage.objectKey}`, verified: true, problem: null });
    expect(sha256Of(readFileSync(join(dir, staged!.location)))).toBe(result.report.artifact!.sha256);
    expect((await stagePrepared(result, adapter))!.created).toBe(false); // idempotent for identical bytes
    const key = result.report.artifact!.storage.objectKey;
    const other = new Uint8Array([1, 2, 3]);
    await expect(adapter.put(key, other, { sha256: sha256Of(other), contentType: "model/gltf-binary" })).rejects.toThrow(/write-once violation/);
    await expect(adapter.put(key, other, { sha256: result.report.artifact!.sha256, contentType: "model/gltf-binary" })).rejects.toThrow(/do not match/);
    await expect(adapter.put(`art/${ID}/../../escape.glb`, other, { sha256: sha256Of(other), contentType: "x" })).rejects.toThrow(/not a external-cas object key/);
    expect(await adapter.verify(`art/${ID}/${"0".repeat(64)}.glb`, { sha256: "0".repeat(64), bytes: 1 })).toMatchObject({ ok: false });
  });
});

describe("prepare — invalid / corrupt input", () => {
  it("refuses a truncated GLB before optimising anything, and produces no artifact", async () => {
    const truncated = optimizable.slice(0, Math.floor(optimizable.byteLength / 2));
    const result = await prepareAsset(truncated, metadata());
    expect(result.report.status).toBe("blocked");
    expect(codes(result)).toEqual(["source-invalid"]);
    expect(result.report.blockers[0].message).toMatch(/glb-truncated/);
    expect(result.report.optimization.result).toBe("not-run");
    expect(result.artifactBytes).toBeNull();
    expect(result.report.artifact).toBeNull();
    expect(result.report.registryProposal).toBeNull();
    expect(await stagePrepared(result, localStagingAdapter(dir))).toBeNull();
  });

  it("refuses bytes that are not glTF at all", async () => {
    const result = await prepareAsset(new TextEncoder().encode("definitely not a model"), metadata());
    expect(codes(result)).toEqual(["source-invalid"]);
    expect(result.report.validation.source.errors).toContain("not-a-gltf");
  });

  it("refuses a GLB that needs external files", async () => {
    const png = await fx.flatPng();
    const result = await prepareAsset(new Uint8Array(fx.texturedCube(png, { imageUri: "texture.png" })), metadata());
    expect(codes(result)).toContain("source-external-resources");
    expect(result.artifactBytes).toBeNull();
  });
});

describe("prepare — optimiser skips (the input comes back unchanged)", () => {
  it("not-smaller: the artifact IS the source, reported as skipped and unoptimised", async () => {
    const tiny = new Uint8Array(fx.emptyGlb());
    const result = await prepareAsset(tiny, metadata());
    expect(result.report.optimization).toMatchObject({ result: "skipped" });
    expect(result.report.optimization.skipCode).toBeTruthy();
    expect(result.report.artifact!.sha256).toBe(sha256Of(tiny));
    expect(Buffer.from(result.artifactBytes!).equals(Buffer.from(tiny))).toBe(true);
    expect(codes(result, "warnings")).toEqual(expect.arrayContaining(["optimizer-skipped", "m1-unoptimized"]));
    expect(result.report.registryProposal!.record.revisions["1"].pipeline).toMatchObject({ optimization: "skipped" });
  });

  it("already-compressed meshopt: skipped by AWE, and blocked by NRVNAVerse because the runtime cannot load it", async () => {
    const png = await fx.flatPng();
    const meshopt = new Uint8Array(fx.texturedCube(png, { extra: { extensionsUsed: ["EXT_meshopt_compression"] } }));
    const result = await prepareAsset(meshopt, metadata());
    expect(result.report.optimization.skipCode).toBe("already-compressed");
    expect(codes(result)).toContain("runtime-unsupported-extension");
    expect(result.report.status).toBe("blocked");
  });
});

describe("prepare — NRVNAVerse policy (identity, rights, review, revisions)", () => {
  it("never approves: an unreviewed production asset is prepared but blocked, and its review is left as authored", async () => {
    const review = { status: "unreviewed", reviewedBy: null, reviewedAt: null };
    const result = await prepareAsset(optimizable, metadata({ review }));
    expect(codes(result)).toEqual(["production-unresolved"]);
    expect(result.report.registryProposal!.record.review).toEqual(review);
    expect(result.report.artifact).not.toBeNull(); // bytes exist for inspection; nothing is ready for upload
  });

  it("reports incomplete rights and unresolved dependencies as production blockers", async () => {
    const result = await prepareAsset(optimizable, metadata({
      provenance: { origin: "self-authored", dependencies: [{ id: "clip", kind: "animation", description: "third-party clip", status: "unresolved" }] },
    }));
    expect(codes(result)).toEqual(["production-unresolved"]);
    expect(result.report.blockers[0].message).toMatch(/1 unresolved dependency \(clip\)/);
  });

  it("refuses authored derived facts, unknown fields and a missing / malformed asset id", async () => {
    expect(codes(await prepareAsset(optimizable, metadata({ sha256: "abc" })))).toEqual(["metadata-invalid"]);
    const noId = await prepareAsset(optimizable, metadata({ assetId: "Rock Monster" }));
    expect(codes(noId)).toEqual(["metadata-invalid"]);
    expect(noId.report.artifact).toBeNull();
    expect(codes(await prepareAsset(optimizable, metadata({ review: { status: "approved", reviewedBy: " ", reviewedAt: "2026-02-30T10:00Z" } })))).toContain("metadata-invalid");
  });

  it("prepares an internal tracer only with its explicit acceptance, and still never for repo-public", async () => {
    const tracer = await prepareAsset(optimizable, metadata({ usage: "internal-tracer", review: { status: "internal-tracer-accepted", reviewedBy: "Fixture Reviewer", reviewedAt: "2026-09-24T10:00:00Z" } }));
    expect(tracer.report.status).toBe("ready");
    expect(tracer.report.artifact!.storage.backend).toBe("external-cas");
    expect(codes(tracer, "warnings")).toContain("internal-tracer");
    expect(codes(await prepareAsset(optimizable, metadata({ usage: "internal-tracer" })))).toEqual(["internal-tracer-unaccepted"]);
  });

  it("a new revision of a registered asset: next number, earlier revisions kept, and a fresh human review required", async () => {
    const first = await prepareAsset(optimizable, metadata());
    const registry = { schemaVersion: 1, assets: { [ID]: first.report.registryProposal!.record } } as AssetRegistry;

    // Same bytes again: nothing to prepare.
    expect(codes(await prepareAsset(optimizable, metadata(), { registry }))).toEqual(["revision-exists"]);

    const changed = new Uint8Array(await fx.bigTexturedCube({ animated: true }));
    // The approval on record was given for revision 1's bytes: carrying it over is refused.
    const carried = await prepareAsset(changed, metadata(), { registry });
    expect(codes(carried)).toEqual(["review-predates-revision"]);
    expect(carried.report.revision).toBe(2);

    const reReviewed = await prepareAsset(changed, metadata({ review: { ...APPROVED, reviewedAt: "2026-09-25T09:00:00-07:00" } }), { registry });
    expect(reReviewed.report.status).toBe("ready");
    const record = reReviewed.report.registryProposal!.record;
    expect(record.currentRevision).toBe(2);
    expect(Object.keys(record.revisions)).toEqual(["1", "2"]);
    expect(record.revisions["1"]).toEqual(registry.assets[ID].revisions["1"]);
    expect(validateAssetRegistry({ schemaVersion: 1, assets: { [ID]: record } })).toEqual([]);
  });
});

describe("asset:prepare command", () => {
  it("ready → exit 0, bytes staged, deterministic report written", async () => {
    const src = join(dir, "source.glb");
    const meta = join(dir, "metadata.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(src, optimizable);
    writeFileSync(meta, JSON.stringify(metadata()));
    const out = join(dir, "staging");
    const run = await runPrepare([src, meta, "--out", out]);
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    expect(run.lines[0]).toBe(`READY: ${ID} revision 1`);
    expect(run.reportPath).toBe(join(out, "prepared", `${ID}.r1.json`));
    const report = JSON.parse(readFileSync(run.reportPath!, "utf8"));
    expect(existsSync(join(out, "objects", ...report.artifact.storage.objectKey.split("/")))).toBe(true);
    const again = await runPrepare([src, meta, "--out", out]);
    expect(readFileSync(again.reportPath!, "utf8")).toBe(readFileSync(run.reportPath!, "utf8"));
    expect(again.lines.join("\n")).toMatch(/already present, identical/);
  });

  it("blocked → exit 2 with blockers listed; usage errors → exit 1", async () => {
    const { writeFileSync } = await import("node:fs");
    const src = join(dir, "broken.glb");
    const meta = join(dir, "metadata.json");
    writeFileSync(src, Buffer.from(optimizable.slice(0, 100)));
    writeFileSync(meta, JSON.stringify(metadata()));
    const run = await runPrepare([src, meta, "--out", join(dir, "staging")]);
    expect(run.exitCode).toBe(2);
    expect(run.lines.join("\n")).toMatch(/BLOCKER {2}\[source-invalid\]/);
    expect((await runPrepare([src])).exitCode).toBe(1);
    expect((await runPrepare([src, meta, "--bogus"])).exitCode).toBe(1);
    expect((await runPrepare([join(dir, "missing.glb"), meta])).exitCode).toBe(1);
  });
});
