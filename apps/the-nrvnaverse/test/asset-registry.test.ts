import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ASSET_ID_PATTERN,
  M1_EXPERIMENTAL_ASSET_WARNINGS,
  REPO_PUBLIC_OBJECT_KEY,
  assetGate,
  repoPublicObjectKey,
  resolveAssetRefs,
  runtimeAssetUrl,
  validateAssetRegistry,
  type AssetRegistry,
} from "../scripts/spatial/assets.mjs";
import { checkRuntimeAssets, loadSpatialSource } from "../scripts/spatial/cli.mjs";
import { generateSpatialArtifacts, spatialAssetWarnings, validateSpatialSource, type SpatialSourceInput } from "../scripts/spatial/pipeline.mjs";
import { SPATIAL_IMMUTABLE_CACHE_CONTROL, deliveryHeaders, runtimeAssetHeaders } from "../next.config";

/**
 * M1.0 runtime asset registry + NRVNAVerse rights / provenance gate (docs/NRVNAVERSE_ASSET_PIPELINE.md).
 * Uses the real committed source, registry and tracer binary; every negative case mutates a copy.
 */

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const APP_ROOT = resolve(__dirname, "..");
const TRACER_ID = "ast_drbw0be6qzbft4we";
const real = loadSpatialSource() as SpatialSourceInput & { assets: Mutable };

function source(mutate?: (draft: { config: Mutable; scene: Mutable; destinations: Mutable; assets: Mutable }) => void): SpatialSourceInput {
  const draft = structuredClone(real) as unknown as { config: Mutable; scene: Mutable; destinations: Mutable; assets: Mutable };
  mutate?.(draft);
  return draft as unknown as SpatialSourceInput;
}

function codesOf(input: SpatialSourceInput): string[] {
  const result = validateSpatialSource(input);
  return result.ok ? [] : result.errors.map((e) => e.code);
}

const tracer = (d: { assets: Mutable }) => d.assets.assets[TRACER_ID];

describe("committed registry and tracer", () => {
  it("the committed registry is structurally valid and the committed source passes the gate", () => {
    expect(validateAssetRegistry(real.assets)).toEqual([]);
    expect(validateSpatialSource(source()).ok).toBe(true);
  });

  it("the tracer id is a stable asset id not derived from its file name, digest, path or URL", () => {
    expect(TRACER_ID).toMatch(ASSET_ID_PATTERN);
    const record = real.assets.assets[TRACER_ID];
    const revision = record.revisions[String(record.currentRevision)];
    const token = TRACER_ID.slice(4);
    expect(revision.artifact.sha256).not.toContain(token);
    for (const text of [record.provenance.source.canonicalSource.path, record.provenance.source.exportUsed.path, "Rock1.glb", "Rock Monster 1.7.blend"]) {
      expect(text.toLowerCase()).not.toContain(token);
    }
    // The object key is built FROM the id and the digest, never the other way round.
    expect(revision.artifact.storage.objectKey).toBe(repoPublicObjectKey(TRACER_ID, revision.artifact.sha256, "glb"));
  });

  it("the committed binary matches the registry byte count and full SHA-256, and is within the 10 MiB M1.0 Git cap", () => {
    const record = real.assets.assets[TRACER_ID];
    const artifact = record.revisions[String(record.currentRevision)].artifact;
    const bytes = readFileSync(join(APP_ROOT, "public", ...artifact.storage.objectKey.split("/")));
    expect(bytes.length).toBe(artifact.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    expect(bytes.length).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(checkRuntimeAssets(real.assets as AssetRegistry, [TRACER_ID]).ok).toBe(true);
  });

  it("records honest provenance: self-authored, tutorial-assisted, internal tracer, unresolved dependencies kept separate", () => {
    const record = real.assets.assets[TRACER_ID];
    expect(record.usage).toBe("internal-tracer");
    expect(record.provenance.origin).toBe("self-authored");
    expect(record.provenance.creationContext).toBe("tutorial-assisted");
    expect(record.rights.status).toBe("unresolved");
    expect(record.provenance.dependencies.map((d: Mutable) => [d.id, d.status])).toEqual([
      ["animation-mixamo-layer0", "unresolved"],
      ["texture-color-pallette", "unresolved"],
    ]);
  });
});

describe("gate — failures", () => {
  it("fails a model component that uses a raw URL instead of the registry", () => {
    expect(codesOf(source((d) => {
      d.scene.components["tracer-rock-monster"].url = "/assets/rock.glb";
      delete d.scene.components["tracer-rock-monster"].assetRef;
    }))).toEqual(["unregistered-asset-url"]);
  });

  it("fails a component that declares both assetRef and url", () => {
    expect(codesOf(source((d) => {
      d.scene.components["tracer-rock-monster"].url = "/assets/rock.glb";
    }))).toEqual(["asset-ref-with-url"]);
  });

  it("fails an unknown or malformed asset reference", () => {
    expect(codesOf(source((d) => {
      d.scene.components["tracer-rock-monster"].assetRef = "ast_0000000000000000";
    }))).toEqual(["unknown-asset-ref"]);
    expect(codesOf(source((d) => {
      d.scene.components["tracer-rock-monster"].assetRef = "Rock1.glb";
    }))).toEqual(["invalid-asset-ref"]);
  });

  it("fails when the config declares a registry that is missing, and when a reference has no registry at all", () => {
    expect(codesOf(source((d) => {
      d.assets = null as unknown as Mutable;
    }))).toEqual(["missing-asset-registry"]);
    expect(codesOf(source((d) => {
      delete d.config.assetRegistry;
    }))).toEqual(["missing-asset-registry"]);
  });

  it("fails a referenced asset whose current revision has no runtime artifact", () => {
    expect(codesOf(source((d) => {
      tracer(d).revisions["1"].artifact = null;
    }))).toEqual(["asset-missing-artifact"]);
  });

  it("fails a referenced asset whose rights prohibit web-runtime redistribution", () => {
    expect(codesOf(source((d) => {
      tracer(d).rights.webRuntimeRedistribution = "prohibited";
    }))).toEqual(["asset-redistribution-prohibited"]);
  });

  it("fails production use while rights, dependencies or review are unresolved", () => {
    const input = source((d) => {
      tracer(d).usage = "production";
    });
    expect(codesOf(input)).toEqual(["asset-production-unresolved"]);
    const message = (validateSpatialSource(input) as { errors: { message: string }[] }).errors[0].message;
    expect(message).toContain("animation-mixamo-layer0");
    expect(message).toContain('review status is "internal-tracer-accepted"');
  });

  it("allows production use only once rights are cleared, dependencies resolved and review approved", () => {
    expect(codesOf(source((d) => {
      const r = tracer(d);
      r.usage = "production";
      r.rights.status = "cleared";
      r.rights.webRuntimeRedistribution = "allowed";
      r.provenance.dependencies.forEach((dep: Mutable) => (dep.status = "cleared"));
      r.review.status = "approved";
    }))).toEqual([]);
  });

  it("fails a referenced asset that was rejected in review", () => {
    expect(codesOf(source((d) => {
      tracer(d).review.status = "rejected";
    }))).toEqual(["asset-review-rejected"]);
  });

  it("rejects a repo-public object key that is not the content-addressed <assetId>.<sha256 prefix>.glb", () => {
    expect(codesOf(source((d) => {
      tracer(d).revisions["1"].artifact.storage.objectKey = "assets/art/Rock1.glb";
    }))).toEqual(["invalid-object-key"]);
    expect(codesOf(source((d) => {
      const a = tracer(d).revisions["1"].artifact;
      a.storage.objectKey = repoPublicObjectKey(TRACER_ID, "f".repeat(64), "glb");
    }))).toEqual(["invalid-object-key"]);
  });

  it("rejects storage backends that M1.0 does not implement (external storage is a later backend, not a new identity)", () => {
    expect(codesOf(source((d) => {
      tracer(d).revisions["1"].artifact.storage = { backend: "external-cas", objectKey: "x" };
    }))).toEqual(["unsupported-storage-backend"]);
  });

  it("keeps the registry strict: unexpected fields, cleared-but-not-redistributable and bad ids are errors", () => {
    expect(codesOf(source((d) => {
      tracer(d).url = "/somewhere.glb";
    }))).toEqual(["unexpected-field"]);
    expect(codesOf(source((d) => {
      tracer(d).rights.status = "cleared";
    }))).toEqual(["invalid-rights"]);
    const bad = structuredClone(real.assets);
    bad.assets["Rock Monster"] = bad.assets[TRACER_ID];
    expect(validateAssetRegistry(bad).map((e) => e.code)).toContain("invalid-asset-id");
  });
});

describe("gate — warnings (never fatal)", () => {
  it("reports the internal tracer and the M1 experimental bands for the committed source", () => {
    const codes = spatialAssetWarnings(source()).map((w) => w.code);
    expect(codes).toEqual(["asset-internal-tracer", "m1-texture-dimension", "m1-unoptimized"]);
    expect(M1_EXPERIMENTAL_ASSET_WARNINGS).toEqual({ artifactBytes: 8 * 1024 * 1024, maxTextureDimension: 2048, triangles: 150_000 });
  });

  it("the M1 bands are warnings only: an asset far over every band still validates and generates", () => {
    const input = source((d) => {
      const stats = tracer(d).revisions["1"].stats;
      stats.triangles = 10_000_000;
      stats.maxTextureDimension = 16384;
    });
    expect(validateSpatialSource(input).ok).toBe(true);
    expect(() => generateSpatialArtifacts(input)).not.toThrow();
    expect(spatialAssetWarnings(input).map((w) => w.code)).toContain("m1-triangles");
  });
});

describe("resolution — logical asset → content-addressed runtime URL", () => {
  it("replaces assetRef with the current revision's URL in every generated artifact", () => {
    const gen = generateSpatialArtifacts(source());
    const hub = JSON.parse(gen.files[gen.chunkFiles.hub]);
    const component = hub.components["tracer-rock-monster"];
    expect(component.assetRef).toBeUndefined();
    expect(component.url).toBe(`/assets/art/${TRACER_ID}.62c2278be4c2180be4df622e01e2f8e4.glb`);
    for (const text of Object.values(gen.files)) expect(text).not.toContain("assetRef");
    expect(gen.assetIds).toEqual([TRACER_ID]);
  });

  it("a registry rename changes no artifact; a new revision changes only the hub chunk (and the index), and keeps the asset id", () => {
    const base = generateSpatialArtifacts(source());
    const renamed = generateSpatialArtifacts(source((d) => {
      tracer(d).name = "Renamed tracer";
    }));
    expect(renamed.files).toEqual(base.files);

    const sha = "a".repeat(64);
    const revised = generateSpatialArtifacts(source((d) => {
      const r = tracer(d);
      r.revisions["2"] = structuredClone(r.revisions["1"]);
      r.revisions["2"].artifact.sha256 = sha;
      r.revisions["2"].artifact.storage.objectKey = repoPublicObjectKey(TRACER_ID, sha, "glb");
      r.currentRevision = 2;
    }));
    expect(revised.chunkFiles.hub).not.toBe(base.chunkFiles.hub);
    for (const key of ["music", "fashion-culture", "cannabis-21"]) expect(revised.chunkFiles[key]).toBe(base.chunkFiles[key]);
    expect(revised.globalSceneFile).toBe(base.globalSceneFile);
    expect(JSON.parse(revised.files[revised.chunkFiles.hub]).components["tracer-rock-monster"].url).toBe(`/assets/art/${TRACER_ID}.${sha.slice(0, 32)}.glb`);
    expect(revised.assetIds).toEqual([TRACER_ID]);
  });

  it("is deterministic and leaves components without assetRef untouched (same object)", () => {
    expect(generateSpatialArtifacts(source()).files).toEqual(generateSpatialArtifacts(source()).files);
    const components = { a: { id: "a", type: "mesh" } };
    expect(resolveAssetRefs(components, null).a).toBe(components.a);
  });

  it("separates identity, revision and storage: the URL comes from the storage backend only", () => {
    const record = real.assets.assets[TRACER_ID];
    const artifact = record.revisions[String(record.currentRevision)].artifact;
    expect(Object.keys(artifact).sort()).toEqual(["bytes", "format", "sha256", "storage"]);
    expect(runtimeAssetUrl(artifact.storage)).toBe(`/${artifact.storage.objectKey}`);
    expect(() => runtimeAssetUrl({ backend: "external-cas", objectKey: "x" })).toThrow(/unsupported storage backend/);
    expect(artifact.storage.objectKey).toMatch(REPO_PUBLIC_OBJECT_KEY);
  });
});

describe("binary verification (cli)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nrvnaverse-assets-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const bytes = Buffer.from("glTF fake tracer bytes");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const registry = (): AssetRegistry => {
    const r = structuredClone(real.assets) as AssetRegistry;
    const artifact = r.assets[TRACER_ID].revisions["1"].artifact!;
    artifact.sha256 = sha;
    artifact.bytes = bytes.length;
    artifact.storage.objectKey = repoPublicObjectKey(TRACER_ID, sha, "glb");
    return r;
  };
  const place = (name: string, content: Buffer) => {
    mkdirSync(join(dir, "assets", "art"), { recursive: true });
    writeFileSync(join(dir, "assets", "art", name), content);
  };

  it("passes when the stored artifact matches the registry exactly", () => {
    place(`${TRACER_ID}.${sha.slice(0, 32)}.glb`, bytes);
    expect(checkRuntimeAssets(registry(), [TRACER_ID], dir)).toEqual({ ok: true, problems: [] });
  });

  it("fails on a missing artifact, a byte / digest mismatch, and an unregistered file", () => {
    expect(checkRuntimeAssets(registry(), [TRACER_ID], dir).problems[0]).toMatch(/^missing runtime asset/);
    place(`${TRACER_ID}.${sha.slice(0, 32)}.glb`, Buffer.from("tampered"));
    const tampered = checkRuntimeAssets(registry(), [TRACER_ID], dir).problems;
    expect(tampered.some((p) => /bytes, registry says/.test(p))).toBe(true);
    expect(tampered.some((p) => /has sha256/.test(p))).toBe(true);
    place(`${TRACER_ID}.${sha.slice(0, 32)}.glb`, bytes);
    place("hand-copied.glb", bytes);
    expect(checkRuntimeAssets(registry(), [TRACER_ID], dir).problems).toEqual([
      "unexpected file assets/art/hand-copied.glb — not the current artifact of any referenced registered asset",
    ]);
  });
});

describe("next.config.ts — content-addressed art cache policy", () => {
  const require = createRequire(import.meta.url);
  const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string, keys: unknown[], opts: object) => RegExp };
  async function cacheControlFor(path: string): Promise<string[]> {
    const values: string[] = [];
    for (const rule of await deliveryHeaders()) {
      if (!pathToRegexp(rule.source, [], { strict: true, sensitive: false, delimiter: "/" }).test(path)) continue;
      for (const h of rule.headers) if (h.key === "Cache-Control") values.push(h.value);
    }
    return values;
  }

  it("serves the committed tracer URL as immutable", async () => {
    const gen = generateSpatialArtifacts(source());
    const url = JSON.parse(gen.files[gen.chunkFiles.hub]).components["tracer-rock-monster"].url;
    expect(await cacheControlFor(url)).toEqual([SPATIAL_IMMUTABLE_CACHE_CONTROL]);
    expect((await runtimeAssetHeaders()).map((r) => r.source)).toEqual(["/assets/art/:asset(ast_[0-9abcdefghjkmnpqrstvwxyz]{16}).:version([0-9a-f]{32}).glb"]);
  });

  it("does not make unhashed or malformed art, other /assets files or other formats immutable", async () => {
    const hex = "0123456789abcdef0123456789abcdef";
    for (const path of [
      "/assets/art/Rock1.glb",
      `/assets/art/${TRACER_ID}.glb`,
      `/assets/art/${TRACER_ID}.${hex.slice(0, 31)}.glb`,
      `/assets/art/${TRACER_ID}.${hex}.gltf`,
      `/assets/art/${TRACER_ID}.${hex}.glb.bak`,
      `/assets/art/ast_ILOU000000000000.${hex}.glb`,
      `/assets/art/nested/${TRACER_ID}.${hex}.glb`,
      "/assets/anims/idle.json",
      `/assets/${TRACER_ID}.${hex}.glb`,
    ]) {
      expect(await cacheControlFor(path), path).toEqual([]);
    }
  });
});

describe("Hub tracer placement", () => {
  const config = real.config as Mutable;
  const scene = real.scene as Mutable;
  const component = scene.components["tracer-rock-monster"];

  it("is a temporary, clearly labelled model in the hub chunk with no collider, portal binding or script", () => {
    expect(config.chunks.find((c: Mutable) => c.key === "hub").componentIds).toContain("tracer-rock-monster");
    expect(component.type).toBe("model");
    expect(component.name).toMatch(/M1\.0 TRACER/);
    expect(component.collider).toBeUndefined();
    expect(component.script).toBeUndefined();
    expect((config.portals as Mutable[]).some((p) => p.componentId === "tracer-rock-monster")).toBe(false);
  });

  it("stands clear of the Hub spawn, the portal sensors and the spawn → Cannabis gate route", () => {
    const p = component.position;
    const hubSpawn = (config.placements as Mutable[]).find((pl) => pl.destinationId === "dst_7g19n1vm9ackw8a0")!.spawn.position;
    const half = 2.1; // bind-pose half-extent of the tracer in x / z (registry stats), rounded up
    expect(Math.hypot(p.x - hubSpawn.x, p.z - hubSpawn.z)).toBeGreaterThan(10);
    for (const id of ["portal-hub-music", "portal-hub-fashion", "portal-hub-cannabis"]) {
      const portal = scene.components[id];
      const box = portal.geometry.boxParams;
      const dx = Math.max(0, Math.abs(p.x - portal.position.x) - box.width / 2 - half);
      const dz = Math.max(0, Math.abs(p.z - portal.position.z) - box.depth / 2 - half);
      expect(Math.hypot(dx, dz), id).toBeGreaterThan(1.5);
    }
    // The gate route runs from the spawn straight to the Cannabis sensor along x ∈ [-3, 3].
    expect(p.x - half).toBeGreaterThan(1.5);
  });
});
