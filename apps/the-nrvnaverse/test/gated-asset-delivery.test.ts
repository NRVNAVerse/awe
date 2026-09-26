import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateSpatialArtifacts, validateSpatialSource, type SpatialSourceInput } from "../scripts/spatial/pipeline.mjs";

/**
 * Gated delivery invariant at the CANONICAL validation boundary: a chunk serving any destination
 * whose manifest `gates` is non-empty never carries an `assetRef` (gated chunk data and external-cas
 * objects are not access-controlled under M1). `asset:place` refuses this up front; these tests prove
 * a hand-edited source cannot bypass it. Destinations/chunks are derived from gate metadata, never
 * hard-coded, and nothing is written to disk.
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const ID = "ast_fx7k2m9q4w8r3t6y";
const SHA = "a808fd4a5d2301241145513020becc1409e8b7a98ee04e5d1be634632f0428e9";

type Destination = { id: string; gates?: unknown[] };
type Config = { placements: Array<{ destinationId: string; chunkKey: string }>; chunks: Array<{ key: string; componentIds: string[] }> } & Record<string, unknown>;

function committed() {
  const config = readJson(join(APP_ROOT, "spatial", "source", "spatial-config.m0.json")) as Config;
  const scene = readJson(join(APP_ROOT, "spatial", "source", "scene.m0.json")) as { components: Record<string, unknown> };
  const destinations = readJson(join(APP_ROOT, "../../packages/nrvna-manifest/generated/destinations.json")) as { destinations: Destination[] };
  return { config, scene, destinations };
}

const registry = {
  schemaVersion: 1,
  assets: {
    [ID]: {
      name: "Synthetic art",
      kind: "model",
      usage: "production",
      currentRevision: 1,
      provenance: { origin: "self-authored", creationContext: "original", creator: "NRVNAVerse test suite", dependencies: [] },
      rights: { status: "cleared", license: "test fixture", rightsHolder: "NRVNAVerse", attributionRequired: false, attributionText: null, commercialUse: "allowed", webRuntimeRedistribution: "allowed", modification: "allowed", restrictions: [] },
      review: { status: "approved", reviewedBy: "Fixture Reviewer", reviewedAt: "2026-09-24T10:00:00-07:00" },
      revisions: { "1": { artifact: { sha256: SHA, bytes: 177428, format: "glb", storage: { backend: "external-cas", objectKey: `art/${ID}/${SHA}.glb` } }, stats: { triangles: 12 }, pipeline: { optimization: "optimized" } } },
    },
  },
};

/** Chunk keys serving at least one gated / only ungated destinations, derived from gate metadata. */
function chunksByGate(config: Config, destinations: Destination[]) {
  const gated = new Set<string>();
  for (const p of config.placements) {
    const d = destinations.find((x) => x.id === p.destinationId);
    if (d && Array.isArray(d.gates) && d.gates.length > 0) gated.add(p.chunkKey);
  }
  const ungated = config.placements.map((p) => p.chunkKey).filter((k) => !gated.has(k));
  return { gated: [...gated], ungated: [...new Set(ungated)] };
}

/** A copy of the committed source with one assetRef model hand-inserted into `chunkKey`. */
function withArtIn(chunkKey: string, destinations?: { destinations: Destination[] }): SpatialSourceInput {
  const base = committed();
  const config = structuredClone(base.config);
  const scene = structuredClone(base.scene);
  const componentId = "hand-edited-art";
  scene.components[componentId] = { name: "Hand-edited art", id: componentId, type: "model", kit: "cyber", assetRef: ID, position: { x: 0, y: 0.5, z: -4 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
  config.chunks.find((c) => c.key === chunkKey)!.componentIds.push(componentId);
  return { config: { ...config, assetRegistry: "asset-registry.json" }, scene, destinations: destinations ?? base.destinations, assets: registry };
}

const codes = (input: SpatialSourceInput) => validateSpatialSource(input).errors.map((e) => e.code);

describe("gated delivery invariant — validateSpatialSource", () => {
  const { config, destinations } = committed();
  const { gated, ungated } = chunksByGate(config, destinations.destinations);

  it("the committed world has both gated and ungated chunks to exercise", () => {
    expect(gated.length).toBeGreaterThan(0);
    expect(ungated.length).toBeGreaterThan(0);
  });

  it("otherwise-valid assetRef content in an ungated chunk passes", () => {
    for (const key of ungated) expect(validateSpatialSource(withArtIn(key)), key).toEqual({ ok: true, errors: [] });
  });

  it("assetRef content hand-inserted into a gated chunk fails validation", () => {
    for (const key of gated) {
      const result = validateSpatialSource(withArtIn(key));
      expect(result.ok, key).toBe(false);
      expect(result.errors, key).toEqual([expect.objectContaining({ code: "asset-in-gated-chunk", path: "scene.components.hand-edited-art.assetRef" })]);
    }
  });

  it("the same invalid source fails the normal generation path", () => {
    for (const key of gated) expect(() => generateSpatialArtifacts(withArtIn(key)), key).toThrow(/asset-in-gated-chunk/);
    for (const key of ungated) expect(() => generateSpatialArtifacts(withArtIn(key)), key).not.toThrow();
  });

  it("is driven by gate metadata, not destination or chunk ids", () => {
    // Ungate every destination: the formerly gated chunk now accepts the art.
    const ungatedAll = { destinations: structuredClone(destinations.destinations).map((d) => ({ ...d, gates: [] })) };
    for (const key of gated) expect(codes(withArtIn(key, ungatedAll)), key).toEqual([]);
    // Gate a destination served by a formerly ungated chunk: its art is now refused.
    const target = ungated[0];
    const servedIds = new Set(config.placements.filter((p) => p.chunkKey === target).map((p) => p.destinationId));
    const newlyGated = { destinations: structuredClone(destinations.destinations).map((d) => (servedIds.has(d.id) ? { ...d, gates: [{ type: "synthetic-future-gate" }] } : d)) };
    expect(codes(withArtIn(target, newlyGated))).toEqual(["asset-in-gated-chunk"]);
  });
});
