import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { createHash } from "node:crypto";
import {
  CHUNK_KEY_PATTERN,
  CONTENT_ADDRESSED_OUTPUT,
  CONTENT_VERSION_LENGTH,
  CONTENT_VERSION_PATTERN,
  DATA_URL_PREFIX,
  OUTPUT,
  SPATIAL_SCHEMA_VERSION,
  contentAddressedFileName,
  contentVersion,
  dataUrl,
  generateSpatialArtifacts,
  isContentAddressedOutput,
  serializeArtifact,
  validateSpatialSource,
  type SpatialSourceInput,
} from "../scripts/spatial/pipeline.mjs";

/**
 * Spatial data pipeline (M0 Step 2B.1): authoritative physical source → validation → deterministic
 * generation. Uses the real committed source and the real canonical destination set; every
 * negative case is an in-memory mutation of a deep copy.
 */

const APP_ROOT = resolve(__dirname, "..");
const SOURCE_DIR = join(APP_ROOT, "spatial", "source");
const OUTPUT_DIR = join(APP_ROOT, "public", "data");
const MANIFESTS_DIR = resolve(APP_ROOT, "../../packages/nrvna-manifest/manifests");

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function readJson<T = Mutable>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const sourceConfig = readJson(join(SOURCE_DIR, "spatial-config.m0.json"));
const sourceScene = readJson(join(SOURCE_DIR, sourceConfig.scene as string));
// M1.0: the config declares an asset registry next to it (the Hub tracer references it).
const sourceAssets = readJson(join(SOURCE_DIR, sourceConfig.assetRegistry as string));
const destinations = destinationsJson as unknown as DestinationsFile;

function source(mutate?: (draft: { config: Mutable; scene: Mutable; destinations: Mutable; assets: Mutable }) => void): SpatialSourceInput {
  const draft = structuredClone({ config: sourceConfig, scene: sourceScene, destinations: destinations as unknown as Mutable, assets: sourceAssets });
  mutate?.(draft);
  return draft;
}

function codesOf(input: SpatialSourceInput): string[] {
  const result = validateSpatialSource(input);
  return result.ok ? [] : result.errors.map((e) => e.code);
}

const EXPECTED_CHUNKS = ["cannabis-21", "fashion-culture", "hub", "music"];
const activeWorldDestinations = destinations.destinations
  .filter((d) => d.status === "active" && d.spatialDestination?.platform === "the-nrvnaverse")
  .map((d) => d.id)
  .sort();

describe("spatial source — valid M0 input", () => {
  it("validates and generates the committed M0 source", () => {
    expect(validateSpatialSource(source())).toEqual({ ok: true, errors: [] });
    const artifacts = generateSpatialArtifacts(source());
    expect(Object.keys(artifacts.chunkFiles)).toEqual(EXPECTED_CHUNKS);
    expect(Object.keys(artifacts.files).sort()).toEqual(
      [OUTPUT.compatibilityScene, artifacts.globalSceneFile, OUTPUT.spatialIndex, ...EXPECTED_CHUNKS.map((k) => artifacts.chunkFiles[k])].sort(),
    );
    expect(artifacts.globalSceneFile).toMatch(CONTENT_ADDRESSED_OUTPUT.globalScene);
    for (const k of EXPECTED_CHUNKS) expect(artifacts.chunkFiles[k]).toMatch(CONTENT_ADDRESSED_OUTPUT.chunk);
  });

  it("places all seven active destination ids exactly once in the spatial index", () => {
    const artifacts = generateSpatialArtifacts(source());
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    const ids = Object.keys(index.destinations);
    expect(ids.length).toBe(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual(activeWorldDestinations);
    expect(artifacts.destinationIds).toEqual(activeWorldDestinations);
    for (const id of ids) expect(index.chunks[index.destinations[id].chunkKey]).toBeDefined();
  });

  it("produces exactly four M0 chunk outputs with the expected logical grouping", () => {
    const artifacts = generateSpatialArtifacts(source());
    expect(artifacts.chunkKeys).toEqual(EXPECTED_CHUNKS);
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    expect(Object.keys(index.chunks)).toEqual(EXPECTED_CHUNKS);

    const bySlug = destinations.index.bySlug;
    const chunkOf = (slug: string) => index.destinations[bySlug[slug]].chunkKey;
    expect(chunkOf("hub")).toBe("hub");
    expect(chunkOf("music")).toBe("music");
    expect(chunkOf("placeholder-artist")).toBe("music");
    expect(chunkOf("fashion-culture")).toBe("fashion-culture");
    expect(chunkOf("placeholder-fashion-culture-brand")).toBe("fashion-culture");
    expect(chunkOf("cannabis-21")).toBe("cannabis-21");
    expect(chunkOf("nrvna-farms-placeholder")).toBe("cannabis-21");
  });

  it("accounts for every authored component exactly once: global ∪ chunks == scene, pairwise disjoint", () => {
    const artifacts = generateSpatialArtifacts(source());
    const globalIds = Object.keys(JSON.parse(artifacts.files[artifacts.globalSceneFile]).components);
    const chunkIds = EXPECTED_CHUNKS.map((k) => Object.keys(JSON.parse(artifacts.files[artifacts.chunkFiles[k]]).components));
    const all = [globalIds, ...chunkIds].flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(sourceScene.components).sort());
    // Genuinely world-global things only: the avatar, its animation set, environment singletons and the shared ground.
    expect(globalIds).toEqual(["vrm-anims", "lighting", "background", "envmap", "fog", "ground", "Player"]);
  });

  it("emits the compatibility full scene as the authored scene with asset references resolved", () => {
    const artifacts = generateSpatialArtifacts(source());
    const compatibility = JSON.parse(artifacts.files[OUTPUT.compatibilityScene]);
    // Identical except that every `assetRef` became the registry-resolved runtime `url` (M1.0).
    const expected = structuredClone(sourceScene);
    for (const component of Object.values(expected.components as Record<string, Mutable>)) {
      if ("assetRef" in component) {
        const record = sourceAssets.assets[component.assetRef];
        delete component.assetRef;
        component.url = `/${record.revisions[String(record.currentRevision)].artifact.storage.objectKey}`;
      }
    }
    expect(compatibility).toEqual(expected);
    expect(JSON.stringify(compatibility)).not.toContain("assetRef");
    const global = JSON.parse(artifacts.files[artifacts.globalSceneFile]);
    const { components: _c1, ...sceneEnvelope } = sourceScene;
    const { components: _c2, ...globalEnvelope } = global;
    expect(globalEnvelope).toEqual(sceneEnvelope);
  });

  it("keeps canonical destination metadata out of chunk files and the index", () => {
    const artifacts = generateSpatialArtifacts(source());
    for (const key of EXPECTED_CHUNKS) {
      const text = artifacts.files[artifacts.chunkFiles[key]];
      const chunk = JSON.parse(text);
      expect(Object.keys(chunk)).toEqual(["schemaVersion", "worldId", "chunkKey", "components"]);
      expect(chunk.schemaVersion).toBe(SPATIAL_SCHEMA_VERSION);
      expect(text).not.toMatch(/dst_[0-9a-z]{16}|"gates"|"webUrl"|"age21"|"categories"|"analyticsId"/);
    }
    const indexText = artifacts.files[OUTPUT.spatialIndex];
    expect(indexText).not.toMatch(/"gates"|"webUrl"|"name"|"age21"|"categories"|"analyticsId"|"auth"/);
  });

  it("documents the cannabis pre-fetch boundary: the index maps gated destinations to their chunk, the chunk payload is separate", () => {
    const artifacts = generateSpatialArtifacts(source());
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    const cannabisChunk = index.destinations[destinations.index.bySlug["cannabis-21"]].chunkKey;
    // The small index reveals the mapping (allowed); the gated CONTENT lives only in the chunk file.
    // The content digest in the file name (2B.4B.2) is delivery metadata: it neither authorises nor prefetches the chunk.
    const cannabisFile = artifacts.chunkFiles[cannabisChunk];
    expect(cannabisFile).toBe(`${OUTPUT.chunksDir}/${cannabisChunk}.${artifacts.versions[cannabisFile]}.json`);
    expect(index.chunks[cannabisChunk].dataUrl).toBe(`/data/${cannabisFile}`);
    const globalIds = Object.keys(JSON.parse(artifacts.files[artifacts.globalSceneFile]).components);
    const cannabisIds = Object.keys(JSON.parse(artifacts.files[artifacts.chunkFiles[cannabisChunk]]).components);
    expect(cannabisIds.length).toBeGreaterThan(0);
    for (const id of cannabisIds) expect(globalIds).not.toContain(id);
    // Gate truth is not in the spatial data at all — it comes from the manifest.
    expect(JSON.stringify(sourceConfig)).not.toMatch(/"(gates|gate|age21|ageRestriction|enforced|jurisdictions|auth)"/);
    expect(JSON.stringify(index)).not.toMatch(/"(gates|gate|age21|ageRestriction|enforced|jurisdictions|auth)"/);
  });
});

describe("spatial source — validation rejects", () => {
  it("an unsupported schema version", () => {
    expect(codesOf(source((d) => (d.config.schemaVersion = 2)))).toEqual(["unsupported-schema-version"]);
    expect(codesOf(source((d) => delete d.config.schemaVersion))).toEqual(["unsupported-schema-version"]);
  });

  it("a duplicate chunk key", () => {
    expect(codesOf(source((d) => (d.config.chunks[1].key = d.config.chunks[0].key)))).toContain("duplicate-chunk-key");
  });

  it("unsafe or invalid chunk keys / file names", () => {
    for (const bad of ["../hub", "Hub", "hub chunk", "hub.json", "", "hub/", "-hub", "a".repeat(65)]) {
      expect(codesOf(source((d) => (d.config.chunks[0].key = bad)))).toContain("invalid-chunk-key");
    }
    expect(codesOf(source((d) => (d.config.scene = "../scene.m0.json")))).toContain("invalid-scene-ref");
  });

  it("an unknown component id (global or chunk)", () => {
    expect(codesOf(source((d) => d.config.chunks[0].componentIds.push("does-not-exist")))).toEqual(["unknown-component"]);
    expect(codesOf(source((d) => d.config.global.componentIds.push("nope")))).toEqual(["unknown-component"]);
  });

  it("a component owned by more than one chunk", () => {
    expect(codesOf(source((d) => d.config.chunks[1].componentIds.push(d.config.chunks[0].componentIds[0])))).toEqual(["component-in-multiple-chunks"]);
    expect(codesOf(source((d) => d.config.chunks[0].componentIds.push(d.config.chunks[0].componentIds[0])))).toEqual(["duplicate-component-ref"]);
  });

  it("a global component that is also assigned to a chunk", () => {
    expect(codesOf(source((d) => d.config.chunks[0].componentIds.push("ground")))).toEqual(["global-component-in-chunk"]);
  });

  it("an authored component that is neither global nor in any chunk", () => {
    expect(codesOf(source((d) => d.config.chunks[0].componentIds.pop()))).toEqual(["unassigned-component"]);
    expect(codesOf(source((d) => (d.scene.components["extra"] = { id: "extra", type: "mesh" })))).toEqual(["unassigned-component"]);
  });

  it("an empty chunk", () => {
    const codes = codesOf(source((d) => (d.config.chunks[0].componentIds = [])));
    expect(codes).toContain("empty-chunk");
    expect(codes).toContain("unassigned-component");
  });

  it("a placement that references an unknown destination id", () => {
    expect(codesOf(source((d) => (d.config.placements[0].destinationId = "dst_0000000000000000")))).toEqual(["unknown-destination", "missing-placement"]);
    expect(codesOf(source((d) => (d.config.placements[0].destinationId = "hub")))).toEqual(["invalid-destination-id", "missing-placement"]);
  });

  it("a placement that references an unknown chunk", () => {
    expect(codesOf(source((d) => (d.config.placements[0].chunkKey = "nowhere")))).toEqual(["unknown-chunk"]);
  });

  it("non-finite or malformed spawn coordinates and orientation", () => {
    expect(codesOf(source((d) => (d.config.placements[0].spawn.position.x = Number.POSITIVE_INFINITY)))).toEqual(["invalid-spawn"]);
    expect(codesOf(source((d) => (d.config.placements[0].spawn.position.z = Number.NaN)))).toEqual(["invalid-spawn"]);
    expect(codesOf(source((d) => (d.config.placements[0].spawn.position.y = "1")))).toEqual(["invalid-spawn"]);
    expect(codesOf(source((d) => delete d.config.placements[0].spawn.position.y))).toEqual(["invalid-spawn"]);
    expect(codesOf(source((d) => (d.config.placements[0].spawn.yaw = Number.NaN)))).toEqual(["invalid-orientation"]);
    expect(codesOf(source((d) => (d.config.placements[0].spawn.yaw = null)))).toEqual(["invalid-orientation"]);
    expect(codesOf(source((d) => (d.config.placements[0].spawn = null)))).toEqual(["invalid-spawn"]);
  });

  it("a wrong worldId", () => {
    expect(codesOf(source((d) => (d.config.worldId = "some-other-world")))).toContain("world-id-mismatch");
    expect(codesOf(source((d) => (d.config.worldId = "")))).toContain("invalid-world-id");
  });

  it("a duplicate destination placement", () => {
    expect(codesOf(source((d) => d.config.placements.push(structuredClone(d.config.placements[0]))))).toEqual(["duplicate-placement"]);
  });

  it("a missing placement for an active THE NRVNAVerse destination", () => {
    expect(codesOf(source((d) => d.config.placements.pop()))).toEqual(["missing-placement"]);
  });

  it("a placement for a destination that is not a THE NRVNAVerse spatial destination", () => {
    const codes = codesOf(
      source((d) => {
        const target = d.destinations.destinations.find((x: Mutable) => x.id === d.config.placements[0].destinationId);
        target.spatialDestination = { platform: "external", url: "https://example.com/" };
      }),
    );
    // placements[0] is the Hub, which two M0 portals target: the portal check reports it too.
    expect(codes).toEqual(["placement-not-the-nrvnaverse", "portal-not-the-nrvnaverse", "portal-not-the-nrvnaverse"]);
    const nullCodes = codesOf(
      source((d) => {
        const target = d.destinations.destinations.find((x: Mutable) => x.id === d.config.placements[0].destinationId);
        target.spatialDestination = null;
      }),
    );
    expect(nullCodes).toEqual(["placement-not-the-nrvnaverse", "portal-not-the-nrvnaverse", "portal-not-the-nrvnaverse"]);
  });

  it("gates or destination metadata smuggled into the spatial source", () => {
    expect(codesOf(source((d) => (d.config.placements[0].gates = ["age21"])))).toEqual(["unexpected-field"]);
    expect(codesOf(source((d) => (d.config.placements[0].name = "Hub")))).toEqual(["unexpected-field"]);
    expect(codesOf(source((d) => (d.config.chunks[0].auth = ["administrator"])))).toEqual(["unexpected-field"]);
    expect(codesOf(source((d) => (d.config.destinations = [])))).toEqual(["unexpected-field"]);
  });

  it("does not generate anything from an invalid source", () => {
    expect(() => generateSpatialArtifacts(source((d) => d.config.placements.pop()))).toThrow(/missing-placement/);
  });
});

describe("spatial generation — determinism and committed outputs", () => {
  it("produces byte-identical output on repeated runs and regardless of authoring order", () => {
    const a = generateSpatialArtifacts(source()).files;
    const b = generateSpatialArtifacts(source()).files;
    expect(b).toEqual(a);
    const shuffled = generateSpatialArtifacts(
      source((d) => {
        d.config.chunks.reverse();
        d.config.placements.reverse();
      }),
    ).files;
    expect(shuffled).toEqual(a);
    for (const text of Object.values(a)) {
      expect(text.endsWith("\n")).toBe(true);
      expect(text).not.toContain("\r");
      expect(text).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//);
      expect(text).not.toMatch(/generatedAt|timestamp/i);
    }
  });

  it("matches the committed generated files exactly (run `pnpm --filter the-nrvnaverse spatial:generate` if this fails)", () => {
    const artifacts = generateSpatialArtifacts(source());
    for (const [name, expected] of Object.entries(artifacts.files)) {
      const path = join(OUTPUT_DIR, name);
      expect(existsSync(path), `${name} is missing`).toBe(true);
      expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), `${name} is stale`).toBe(expected);
    }
    // Exactly the current content-addressed set is committed — no stale version, no legacy unversioned name.
    const committedChunks = readdirSync(join(OUTPUT_DIR, OUTPUT.chunksDir)).filter((n) => n.endsWith(".json")).sort();
    expect(committedChunks).toEqual(EXPECTED_CHUNKS.map((k) => artifacts.chunkFiles[k].slice(OUTPUT.chunksDir.length + 1)));
    const committedSpatial = readdirSync(join(OUTPUT_DIR, "spatial")).filter((n) => n.startsWith("global-scene")).sort();
    expect(committedSpatial).toEqual([artifacts.globalSceneFile.slice("spatial/".length)]);
    for (const legacy of ["spatial/global-scene.json", ...EXPECTED_CHUNKS.map((k) => `${OUTPUT.chunksDir}/${k}.json`)]) expect(existsSync(join(OUTPUT_DIR, legacy)), legacy).toBe(false);
  });

  it("serializes with fixed formatting", () => {
    expect(serializeArtifact({ b: 1, a: [1, 2] })).toBe('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');
  });
});

describe("canonical destination manifests stay coordinate- and chunk-free", () => {
  it("neither the source manifests nor destinations.json carry physical placement", () => {
    const files = readdirSync(MANIFESTS_DIR).filter((n) => n.endsWith(".json"));
    expect(files.length).toBe(7);
    for (const name of files) {
      const text = readFileSync(join(MANIFESTS_DIR, name), "utf8");
      expect(text, name).not.toMatch(/"(chunkKey|chunk|spawn|position|yaw|coordinates|placementRef)"/);
    }
    expect(JSON.stringify(destinations)).not.toMatch(/"(chunkKey|chunk|spawn|position|yaw|coordinates|placementRef)"/);
  });
});

/**
 * M0 Step 2B.3 — physical portal bindings: `portals[]` in the authoritative source, `portals` in
 * the generated index, sensor components in the chunk payloads, and nothing else anywhere.
 */
const PORTAL_BINDINGS: Record<string, { chunkKey: string; slug: string }> = {
  "portal-hub-music": { chunkKey: "hub", slug: "music" },
  "portal-hub-fashion": { chunkKey: "hub", slug: "fashion-culture" },
  "portal-hub-cannabis": { chunkKey: "hub", slug: "cannabis-21" },
  "portal-music-hub": { chunkKey: "music", slug: "hub" },
  "portal-music-artist": { chunkKey: "music", slug: "placeholder-artist" },
  "portal-fashion-hub": { chunkKey: "fashion-culture", slug: "hub" },
  "portal-fashion-brand": { chunkKey: "fashion-culture", slug: "placeholder-fashion-culture-brand" },
};
const PORTAL_IDS = Object.keys(PORTAL_BINDINGS).sort();
const portalCodes = (mutate: (portal: Mutable, d: { config: Mutable; scene: Mutable; destinations: Mutable }) => void, i = 0) =>
  codesOf(source((d) => mutate(d.config.portals[i], d)));

describe("spatial source — physical portal bindings (M0 Step 2B.3)", () => {
  it("the committed source declares exactly the seven M0 portals and validates", () => {
    expect(validateSpatialSource(source())).toEqual({ ok: true, errors: [] });
    expect(sourceConfig.portals.map((p: Mutable) => p.componentId).sort()).toEqual(PORTAL_IDS);
    for (const p of sourceConfig.portals) {
      expect(Object.keys(p).sort()).toEqual(["chunkKey", "componentId", "destinationId"]);
      expect(p.chunkKey).toBe(PORTAL_BINDINGS[p.componentId].chunkKey);
      expect(p.destinationId).toBe(destinations.index.bySlug[PORTAL_BINDINGS[p.componentId].slug]);
    }
  });

  it("generates exactly seven deterministic portal bindings keyed by physical component id", () => {
    const artifacts = generateSpatialArtifacts(source());
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    expect(Object.keys(index)).toEqual(["schemaVersion", "worldId", "globalSceneUrl", "chunks", "destinations", "portals"]);
    expect(Object.keys(index.portals)).toEqual(PORTAL_IDS); // sorted, code-unit order
    expect(artifacts.portalComponentIds).toEqual(PORTAL_IDS);
    for (const [componentId, binding] of Object.entries<Mutable>(index.portals)) {
      expect(Object.keys(binding)).toEqual(["chunkKey", "destinationId"]);
      expect(binding.chunkKey).toBe(PORTAL_BINDINGS[componentId].chunkKey);
      expect(binding.destinationId).toBe(destinations.index.bySlug[PORTAL_BINDINGS[componentId].slug]);
      expect(index.chunks[binding.chunkKey]).toBeDefined();
      expect(index.destinations[binding.destinationId]).toBeDefined();
    }
    // Order of authoring does not matter.
    const reversed = generateSpatialArtifacts(source((d) => d.config.portals.reverse())).files[OUTPUT.spatialIndex];
    expect(reversed).toBe(artifacts.files[OUTPUT.spatialIndex]);
  });

  it("owns every portal sensor by exactly its declared chunk, and no chunk payload carries a destination id or target data", () => {
    const artifacts = generateSpatialArtifacts(source());
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    for (const key of EXPECTED_CHUNKS) {
      const text = artifacts.files[artifacts.chunkFiles[key]];
      const chunk = JSON.parse(text);
      const owned = Object.keys(chunk.components).filter((id) => id in PORTAL_BINDINGS);
      expect(owned.sort()).toEqual(PORTAL_IDS.filter((id) => PORTAL_BINDINGS[id].chunkKey === key));
      for (const id of owned) {
        expect(index.portals[id].chunkKey).toBe(key);
        const c = chunk.components[id];
        expect(c.type).toBe("mesh");
        expect(c.collider).toEqual({ enabled: true, rigidbodyType: "FIXED", colliderType: "CUBE", isSensor: true });
        expect(Object.keys(c)).not.toContain("destinationId");
      }
      // Physical world data only: no stable id, target URL, gate or destination metadata.
      expect(text).not.toMatch(/dst_[0-9a-z]{16}|"destinationId"|"targetUrl"|"webUrl"|"gates"|"age21"|"portalTarget"/);
      expect(text.match(/"chunkKey"/g)).toHaveLength(1); // the envelope only
    }
    expect(Object.keys(JSON.parse(artifacts.files[artifacts.chunkFiles["cannabis-21"]]).components).filter((id) => id.startsWith("portal-"))).toEqual([]);
    expect(Object.keys(JSON.parse(artifacts.files[artifacts.globalSceneFile]).components).filter((id) => id.startsWith("portal-"))).toEqual([]);
  });

  it("keeps coordinates, gates and destination metadata out of the portal bindings", () => {
    const index = JSON.parse(generateSpatialArtifacts(source()).files[OUTPUT.spatialIndex]);
    const text = JSON.stringify(index.portals);
    expect(text).not.toMatch(/"(position|spawn|x|y|z|yaw|gates|gate|age21|name|slug|webUrl|url|categories|analyticsId|auth)"/);
    // The old coordinate-keyed model is not generated.
    expect(generateSpatialArtifacts(source()).files["spatial/portals-index.json"]).toBeUndefined();
    expect(existsSync(join(OUTPUT_DIR, "spatial", "portals-index.json"))).toBe(false);
    expect(existsSync(join(OUTPUT_DIR, "portals-index.json"))).toBe(false);
  });

  it("allows a gated target, a same-chunk target and several portals to one destination (references only, no gate truth copied)", () => {
    const index = JSON.parse(generateSpatialArtifacts(source()).files[OUTPUT.spatialIndex]);
    const bySlug = destinations.index.bySlug;
    const cannabis = destinations.destinations.find((d) => d.id === bySlug["cannabis-21"])!;
    expect(cannabis.gates.length).toBeGreaterThan(0);
    expect(index.portals["portal-hub-cannabis"].destinationId).toBe(cannabis.id); // gated target is a valid binding
    expect(index.destinations[bySlug["placeholder-artist"]].chunkKey).toBe(index.portals["portal-music-artist"].chunkKey); // same-chunk
    expect(index.destinations[bySlug["placeholder-fashion-culture-brand"]].chunkKey).toBe(index.portals["portal-fashion-brand"].chunkKey);
    expect(index.portals["portal-music-hub"].destinationId).toBe(index.portals["portal-fashion-hub"].destinationId); // two portals → Hub
    expect(JSON.stringify(index)).not.toMatch(/"(gates|gate|age21|ageRestriction|enforced|jurisdictions)"/);
  });

  it("places every portal sensor away from every spawn of its chunk (no immediate retrigger after a teleport)", () => {
    const index = JSON.parse(generateSpatialArtifacts(source()).files[OUTPUT.spatialIndex]);
    for (const [componentId, binding] of Object.entries<Mutable>(index.portals)) {
      const c = sourceScene.components[componentId];
      const half = { x: c.geometry.boxParams.width / 2, y: c.geometry.boxParams.height / 2, z: c.geometry.boxParams.depth / 2 };
      for (const [destinationId, placement] of Object.entries<Mutable>(index.destinations)) {
        if (placement.chunkKey !== binding.chunkKey) continue;
        const p = placement.spawn.position;
        const margin = 2; // generous player capsule + landing wobble
        const overlaps = Math.abs(p.x - c.position.x) < half.x + margin && Math.abs(p.y - c.position.y) < half.y + margin && Math.abs(p.z - c.position.z) < half.z + margin;
        expect(overlaps, `${componentId} overlaps the spawn of ${destinationId}`).toBe(false);
      }
    }
  });

  it("is optional and additive: a source without portals validates, generates an empty portal set, and the schema version is unchanged", () => {
    const artifacts = generateSpatialArtifacts(source((d) => delete d.config.portals));
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    expect(index.schemaVersion).toBe(SPATIAL_SCHEMA_VERSION);
    expect(index.portals).toEqual({});
    expect(artifacts.portalComponentIds).toEqual([]);
    expect(SPATIAL_SCHEMA_VERSION).toBe(1);
    expect(codesOf(source((d) => (d.config.portals = [])))).toEqual([]);
  });
});

describe("spatial source — portal validation rejects", () => {
  it("portals that are not an array, and malformed entries", () => {
    expect(codesOf(source((d) => (d.config.portals = {})))).toEqual(["invalid-portals"]);
    expect(codesOf(source((d) => (d.config.portals = "portal-hub-music")))).toEqual(["invalid-portals"]);
    expect(codesOf(source((d) => (d.config.portals[0] = null)))).toEqual(["invalid-portal"]);
    expect(codesOf(source((d) => (d.config.portals[0] = "portal-hub-music")))).toEqual(["invalid-portal"]);
  });

  it("unknown fields in a portal entry (no coordinates, spawns, URLs, gates or metadata)", () => {
    expect(portalCodes((p) => (p.position = { x: 0, y: 0, z: 0 }))).toEqual(["unexpected-field"]);
    expect(portalCodes((p) => (p.spawn = { position: { x: 0, y: 1, z: 0 }, yaw: 0 }))).toEqual(["unexpected-field"]);
    expect(portalCodes((p) => (p.targetUrl = "/?destination=x"))).toEqual(["unexpected-field"]);
    expect(portalCodes((p) => (p.gates = ["age21"]))).toEqual(["unexpected-field"]);
    expect(portalCodes((p) => (p.name = "Music"))).toEqual(["unexpected-field"]);
  });

  it("a missing, invalid or duplicate portal componentId", () => {
    expect(portalCodes((p) => delete p.componentId)).toEqual(["invalid-component-ref"]);
    expect(portalCodes((p) => (p.componentId = ""))).toEqual(["invalid-component-ref"]);
    expect(portalCodes((p) => (p.componentId = 42))).toEqual(["invalid-component-ref"]);
    expect(codesOf(source((d) => d.config.portals.push(structuredClone(d.config.portals[0]))))).toEqual(["duplicate-portal"]);
  });

  it("a portal component that does not exist in the authored scene", () => {
    expect(portalCodes((p) => (p.componentId = "portal-nowhere"))).toEqual(["unknown-component"]);
  });

  it("a global component used as a portal", () => {
    expect(
      portalCodes((p, d) => {
        p.componentId = "ground";
        d.scene.components.ground.collider = { enabled: true, rigidbodyType: "FIXED", colliderType: "MESH", isSensor: true };
      }),
    ).toEqual(["global-portal-component"]);
  });

  it("a portal declared under a different chunk than the one owning its component, or an unknown chunk", () => {
    expect(portalCodes((p) => (p.chunkKey = "music"))).toEqual(["portal-chunk-mismatch"]); // portal-hub-music is owned by hub
    expect(portalCodes((p) => (p.chunkKey = "nowhere"))).toEqual(["unknown-chunk"]);
    expect(portalCodes((p) => delete p.chunkKey)).toEqual(["unknown-chunk"]);
  });

  it("a portal component that is not configured as an enabled sensor", () => {
    expect(portalCodes((p, d) => (d.scene.components[p.componentId].collider.isSensor = false))).toEqual(["portal-not-sensor"]);
    expect(portalCodes((p, d) => delete d.scene.components[p.componentId].collider.isSensor)).toEqual(["portal-not-sensor"]);
    expect(portalCodes((p, d) => (d.scene.components[p.componentId].collider.enabled = false))).toEqual(["portal-not-sensor"]);
    expect(portalCodes((p, d) => delete d.scene.components[p.componentId].collider)).toEqual(["portal-not-sensor"]);
    expect(portalCodes((p) => (p.componentId = "platform-hub"))).toEqual(["portal-not-sensor"]); // a solid platform is not a trigger
    expect(portalCodes((p) => (p.componentId = "label-hub"))).toEqual(["portal-not-sensor"]); // a text label has no collider
  });

  it("a malformed, unknown, non-THE-NRVNAVerse or wrong-world destination", () => {
    expect(portalCodes((p) => (p.destinationId = "music"))).toEqual(["invalid-destination-id"]);
    expect(portalCodes((p) => delete p.destinationId)).toEqual(["invalid-destination-id"]);
    expect(portalCodes((p) => (p.destinationId = "dst_0000000000000000"))).toEqual(["unknown-destination"]);
    // portal-hub-fashion → Fashion / Culture District; its placement trips too (same canonical record).
    expect(
      portalCodes((p, d) => {
        const target = d.destinations.destinations.find((x: Mutable) => x.id === p.destinationId);
        target.spatialDestination = { platform: "external", url: "https://example.com/" };
      }, 1),
    ).toEqual(["placement-not-the-nrvnaverse", "portal-not-the-nrvnaverse"]);
    expect(
      portalCodes((p, d) => {
        const target = d.destinations.destinations.find((x: Mutable) => x.id === p.destinationId);
        target.spatialDestination = { platform: "the-nrvnaverse", worldId: "another-world" };
      }, 1),
    ).toEqual(["world-id-mismatch", "world-id-mismatch"]); // the placement and the portal both name the wrong world
  });

  it("does not generate anything from an invalid portal set", () => {
    expect(() => generateSpatialArtifacts(source((d) => (d.config.portals[0].componentId = "nope")))).toThrow(/unknown-component/);
  });
});

/**
 * M0 Step 2B.4B.2 — content-addressed spatial delivery. The index is the version root: its own
 * URL is fixed; `globalSceneUrl` and every `chunks[key].dataUrl` are the paths of CONTENT-ADDRESSED
 * files (`global-scene.<token>.json`, `chunks/<key>.<token>.json`) where the token is the first 32
 * lowercase hex chars of SHA-256 over the exact serialized artifact. Chunk keys, destination ids and
 * the schema version are unchanged. A query-only token (`?v=`) was rejected in review because the
 * server never selects bytes by query: after a deployment an old `?v=` URL would have been answered
 * with NEW bytes under an immutable policy. With the digest in the file name that is impossible.
 */
const TOKEN = /^[0-9a-f]{32}$/;
type Artifacts = ReturnType<typeof generateSpatialArtifacts>;

/** Content-addressed output file names of a generation: logical name → file name. */
function contentAddressedFilesOf(artifacts: Artifacts): Record<string, string> {
  return { "global-scene": artifacts.globalSceneFile, ...artifacts.chunkFiles };
}

/** Split a content-addressed delivery URL into its `public/data`-relative file name, base and token. */
function splitAddressed(url: string): { file: string; base: string; token: string } {
  expect(url).not.toMatch(/[?#]/); // a path, nothing else — no query, no fragment
  expect(url.startsWith(`${DATA_URL_PREFIX}/`)).toBe(true);
  const file = url.slice(DATA_URL_PREFIX.length + 1);
  const m = file.match(/^(.*)\.([0-9a-f]{32})\.json$/);
  expect(m, url).not.toBeNull();
  const [, base, token] = m!;
  expect(token).toMatch(TOKEN);
  return { file, base, token };
}

/** logical name → delivery URL as the index hands it out. */
function urlsOf(artifacts: Artifacts): Record<string, string> {
  const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
  const urls: Record<string, string> = { "global-scene": index.globalSceneUrl };
  for (const [key, entry] of Object.entries<{ dataUrl: string }>(index.chunks)) urls[key] = entry.dataUrl;
  return urls;
}

describe("spatial generation — content-addressed delivery (M0 Step 2B.4B.2)", () => {
  it("emits globalSceneUrl and every chunk dataUrl as the path of a content-addressed file: <base>.<token>.json, no query", () => {
    const artifacts = generateSpatialArtifacts(source());
    const urls = urlsOf(artifacts);
    const files = contentAddressedFilesOf(artifacts);
    expect(Object.keys(urls).sort()).toEqual(Object.keys(files).sort());
    for (const [logical, url] of Object.entries(urls)) {
      const { file, base, token } = splitAddressed(url);
      expect(file).toBe(files[logical]); // the URL IS the file the generation writes
      expect(url).toBe(dataUrl(file));
      expect(base).toBe(logical === "global-scene" ? OUTPUT.globalSceneBase : `${OUTPUT.chunksDir}/${logical}`);
      expect(file).toBe(contentAddressedFileName(base, token));
      expect(token).toBe(artifacts.versions[file]);
      expect(isContentAddressedOutput(file)).toBe(true);
      expect(artifacts.files[file]).toBeDefined();
    }
    expect(Object.keys(artifacts.versions).sort()).toEqual(Object.values(files).sort());
    // The version root itself and the compatibility scene are NOT content-addressed.
    expect(artifacts.versions[OUTPUT.spatialIndex]).toBeUndefined();
    expect(artifacts.versions[OUTPUT.compatibilityScene]).toBeUndefined();
    expect(isContentAddressedOutput(OUTPUT.spatialIndex)).toBe(false);
    expect(isContentAddressedOutput(OUTPUT.compatibilityScene)).toBe(false);
    expect(artifacts.files[OUTPUT.spatialIndex]).not.toMatch(/spatial-index\.json|[?&]v=/); // the index never points at itself; no query token anywhere
  });

  it("derives each token from the exact serialized artifact (SHA-256 over the UTF-8 text, first 32 lowercase hex chars) and embeds exactly that token in the file name", () => {
    const artifacts = generateSpatialArtifacts(source());
    for (const file of Object.values(contentAddressedFilesOf(artifacts))) {
      const text = artifacts.files[file];
      const independent = createHash("sha256").update(text, "utf8").digest("hex").slice(0, CONTENT_VERSION_LENGTH);
      expect(artifacts.versions[file]).toBe(independent);
      expect(contentVersion(text)).toBe(independent);
      expect(file.endsWith(`.${independent}.json`)).toBe(true); // the file name token IS the digest of the file's bytes
      expect(CONTENT_VERSION_PATTERN.test(independent)).toBe(true);
      // Any byte change to the serialized artifact changes the token — nothing else participates.
      expect(contentVersion(`${text} `)).not.toBe(independent);
      expect(contentVersion(text.replace(/\n$/, "\r\n"))).not.toBe(independent);
      expect(text).not.toContain(independent); // the artifact never contains its own name or token (no circularity)
    }
    expect(CONTENT_VERSION_LENGTH).toBe(32);
    expect(CONTENT_VERSION_PATTERN.source).toBe("^[0-9a-f]{32}$");
    expect(contentVersion("")).toBe("e3b0c44298fc1c149afbf4c8996fb924"); // SHA-256("") prefix — a fixed, machine-independent value
  });

  it("recognises exactly its own content-addressed shapes (the ownership boundary for stale-file cleanup)", () => {
    const hex = contentVersion("x");
    for (const own of [`spatial/global-scene.${hex}.json`, `spatial/chunks/hub.${hex}.json`, `spatial/chunks/fashion-culture.${hex}.json`, `spatial/chunks/a1.${hex}.json`]) {
      expect(isContentAddressedOutput(own), own).toBe(true);
    }
    for (const foreign of [
      "spatial/global-scene.json", // legacy unversioned names are NOT owned (never auto-deleted)
      "spatial/chunks/hub.json",
      "spatial/spatial-index.json",
      "static-scene.json",
      `static-scene.${hex}.json`,
      `spatial/chunks/hub.${hex.slice(0, 31)}.json`,
      `spatial/chunks/hub.${hex.toUpperCase()}.json`,
      `spatial/chunks/Hub.${hex}.json`,
      `spatial/chunks/hub.${hex}.json.bak`,
      `spatial/chunks/nested/hub.${hex}.json`,
      `spatial/chunks/-hub.${hex}.json`,
      `spatial/chunks/.${hex}.json`,
      `spatial/global-scene-old.${hex}.json`,
      `spatial/other.${hex}.json`,
      `${hex}.json`,
    ]) {
      expect(isContentAddressedOutput(foreign), foreign).toBe(false);
    }
    // The chunk shape embeds the chunk-key grammar exactly.
    const keyPart = CONTENT_ADDRESSED_OUTPUT.chunk.source.match(/chunks\\\/\((.*?)\)\\\./)![1];
    expect(`^${keyPart}$`).toBe(CHUNK_KEY_PATTERN.source);
  });

  it("is deterministic: the same source yields the same file names, URLs and byte-identical artifacts on every run", () => {
    const a = generateSpatialArtifacts(source());
    const b = generateSpatialArtifacts(source());
    expect(b.files).toEqual(a.files);
    expect(b.versions).toEqual(a.versions);
    expect(contentAddressedFilesOf(b)).toEqual(contentAddressedFilesOf(a));
    expect(urlsOf(b)).toEqual(urlsOf(a));
    expect(b.files[OUTPUT.spatialIndex]).toBe(a.files[OUTPUT.spatialIndex]);
    // Reordering the authored membership/placements/portals does not move a single byte or name.
    const reordered = generateSpatialArtifacts(
      source((d) => {
        d.config.chunks.reverse();
        d.config.placements.reverse();
        d.config.portals.reverse();
        for (const chunk of d.config.chunks) chunk.componentIds.reverse();
        d.config.global.componentIds.reverse();
      }),
    );
    expect(reordered.files).toEqual(a.files);
    expect(contentAddressedFilesOf(reordered)).toEqual(contentAddressedFilesOf(a));
  });

  it("changes only the Hub file name when Hub physical content changes (Music, Fashion, Cannabis and the global scene keep their exact names)", () => {
    const before = generateSpatialArtifacts(source());
    const after = generateSpatialArtifacts(source((d) => (d.scene.components["platform-hub"].position.x += 1)));
    const hubBefore = before.chunkFiles.hub;
    const hubAfter = after.chunkFiles.hub;
    expect(hubAfter).not.toBe(hubBefore);
    expect(splitAddressed(urlsOf(after).hub).base).toBe(splitAddressed(urlsOf(before).hub).base); // same base, new token
    expect(after.files[hubAfter]).not.toBe(before.files[hubBefore]);
    expect(after.files[hubBefore]).toBeUndefined(); // the old name is not part of the new generation at all
    for (const key of EXPECTED_CHUNKS.filter((k) => k !== "hub")) {
      expect(after.chunkFiles[key]).toBe(before.chunkFiles[key]);
      expect(after.files[after.chunkFiles[key]]).toBe(before.files[before.chunkFiles[key]]);
      expect(urlsOf(after)[key]).toBe(urlsOf(before)[key]);
    }
    expect(after.globalSceneFile).toBe(before.globalSceneFile);
    expect(after.files[after.globalSceneFile]).toBe(before.files[before.globalSceneFile]);
    // Cache invalidation proof: the old URL is gone from the new index, so a browser entry cached
    // under `hub.<old>.json` can never satisfy the new index's `hub.<new>.json`.
    expect(after.files[OUTPUT.spatialIndex]).not.toContain(before.versions[hubBefore]);
    expect(after.files[OUTPUT.spatialIndex]).toContain(after.versions[hubAfter]);
    // Everything else in the index is byte-identical.
    expect(after.files[OUTPUT.spatialIndex].replace(after.versions[hubAfter], before.versions[hubBefore])).toBe(before.files[OUTPUT.spatialIndex]);
  });

  it("changes only the global scene file name when global physical content changes", () => {
    const before = generateSpatialArtifacts(source());
    const after = generateSpatialArtifacts(source((d) => (d.scene.components.ground.position.y -= 0.5)));
    expect(after.globalSceneFile).not.toBe(before.globalSceneFile);
    expect(urlsOf(after)["global-scene"]).not.toBe(urlsOf(before)["global-scene"]);
    expect(splitAddressed(urlsOf(after)["global-scene"]).base).toBe(OUTPUT.globalSceneBase);
    expect(after.files[before.globalSceneFile]).toBeUndefined();
    expect(after.chunkFiles).toEqual(before.chunkFiles);
    for (const key of EXPECTED_CHUNKS) expect(after.files[after.chunkFiles[key]]).toBe(before.files[before.chunkFiles[key]]);
    expect(after.files[OUTPUT.compatibilityScene]).not.toBe(before.files[OUTPUT.compatibilityScene]); // the authored scene changed …
    expect(after.versions[OUTPUT.compatibilityScene]).toBeUndefined(); // … but the compatibility output is still not content-addressed
  });

  it("does not spuriously change a file name for index-only or label-only changes that leave the artifact's serialized content alone", () => {
    const before = generateSpatialArtifacts(source());
    const spawnMoved = generateSpatialArtifacts(
      source((d) => {
        const hubPlacement = d.config.placements.find((p: Mutable) => p.chunkKey === "hub");
        hubPlacement.spawn.position.z += 2; // placement metadata lives in the index, not in the chunk payload
        hubPlacement.spawn.yaw = 1.5;
        d.config.chunks.find((c: Mutable) => c.key === "hub").label = "The Hub (renamed)"; // labels are source-only
        d.config.portals.reverse();
      }),
    );
    expect(contentAddressedFilesOf(spawnMoved)).toEqual(contentAddressedFilesOf(before));
    expect(spawnMoved.versions).toEqual(before.versions);
    expect(urlsOf(spawnMoved)).toEqual(urlsOf(before));
    for (const file of Object.values(contentAddressedFilesOf(before))) expect(spawnMoved.files[file]).toBe(before.files[file]);
    expect(spawnMoved.files[OUTPUT.spatialIndex]).not.toBe(before.files[OUTPUT.spatialIndex]); // the spawn did change in the index
    // A portal binding change (a different target) is index-only too: the sensor geometry is unchanged.
    const rebound = generateSpatialArtifacts(
      source((d) => {
        const portal = d.config.portals.find((p: Mutable) => p.componentId === "portal-music-artist");
        portal.destinationId = destinations.index.bySlug["hub"];
      }),
    );
    expect(contentAddressedFilesOf(rebound)).toEqual(contentAddressedFilesOf(before));
  });

  it("CROSS-DEPLOYMENT: a Music content change is a new Music file name; the old name never maps to the new bytes, and every other name is unchanged", () => {
    // Generation A (deployment A): Music content A at /music.HASH_A.json.
    const genA = generateSpatialArtifacts(source());
    const musicA = genA.chunkFiles.music;
    const { token: hashA } = splitAddressed(urlsOf(genA).music);
    const contentA = genA.files[musicA];
    expect(musicA).toBe(`${OUTPUT.chunksDir}/music.${hashA}.json`);
    expect(contentVersion(contentA)).toBe(hashA); // the file at that exact name contains A (its digest is HASH_A)

    // Generation B (deployment B): Music physical content changes.
    const genB = generateSpatialArtifacts(source((d) => (d.scene.components["platform-music"].position.z -= 3)));
    const musicB = genB.chunkFiles.music;
    const { token: hashB } = splitAddressed(urlsOf(genB).music);
    const contentB = genB.files[musicB];
    expect(hashB).not.toBe(hashA);
    expect(musicB).toBe(`${OUTPUT.chunksDir}/music.${hashB}.json`);
    expect(contentB).not.toBe(contentA);
    expect(contentVersion(contentB)).toBe(hashB); // the current output at HASH_B contains B

    // Critically: generation B does NOT map the old HASH_A URL to B. The old name is simply not an
    // output of B (it is removed by `spatial:generate`, see the CLI lifecycle suite), and no output
    // of B has content whose digest is not its own name — so nothing B writes can ever answer
    // /music.HASH_A.json with content B.
    expect(genB.files[musicA]).toBeUndefined();
    expect(Object.keys(genB.files)).not.toContain(musicA);
    expect(genB.files[OUTPUT.spatialIndex]).not.toContain(hashA);
    expect(genB.files[OUTPUT.spatialIndex]).toContain(hashB);
    for (const gen of [genA, genB]) {
      for (const [file, text] of Object.entries(gen.files)) {
        if (!isContentAddressedOutput(file)) continue;
        expect(file.endsWith(`.${contentVersion(text)}.json`), file).toBe(true); // name ↔ bytes, in every generation
      }
    }
    // If deployment B still served the old file (a retained-artifact policy), it could only be the A bytes:
    // the A bytes are the only content whose digest is HASH_A (name ↔ bytes above), and genA keeps them.
    expect(genA.files[musicA]).toBe(contentA);
    expect(contentVersion(genA.files[musicA])).toBe(hashA);

    // Unrelated artifacts retain their exact same file names and bytes across the deployment boundary:
    // an old index that still names them keeps resolving to identical content.
    for (const key of EXPECTED_CHUNKS.filter((k) => k !== "music")) {
      expect(genB.chunkFiles[key]).toBe(genA.chunkFiles[key]);
      expect(genB.files[genB.chunkFiles[key]]).toBe(genA.files[genA.chunkFiles[key]]);
    }
    expect(genB.globalSceneFile).toBe(genA.globalSceneFile);
    expect(genB.files[genB.globalSceneFile]).toBe(genA.files[genA.globalSceneFile]);
    // And the old index (deployment A) + new artifacts (deployment B) can never be silently combined:
    // the only URL that differs between the two indexes is the Music one, and it 404s or serves A.
    const indexA = JSON.parse(genA.files[OUTPUT.spatialIndex]);
    const indexB = JSON.parse(genB.files[OUTPUT.spatialIndex]);
    expect(indexA.chunks.music.dataUrl).not.toBe(indexB.chunks.music.dataUrl);
    for (const key of EXPECTED_CHUNKS.filter((k) => k !== "music")) expect(indexA.chunks[key].dataUrl).toBe(indexB.chunks[key].dataUrl);
    expect(indexA.globalSceneUrl).toBe(indexB.globalSceneUrl);
    expect(indexA.destinations).toEqual(indexB.destinations);
    expect(indexA.portals).toEqual(indexB.portals);
  });

  it("keeps identity, gates and the schema untouched: schemaVersion 1 everywhere, no destination id or gate in any chunk payload, no token in the payloads", () => {
    const artifacts = generateSpatialArtifacts(source());
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    expect(index.schemaVersion).toBe(1);
    expect(Object.keys(index)).toEqual(["schemaVersion", "worldId", "globalSceneUrl", "chunks", "destinations", "portals"]); // no new field for the digest
    for (const key of EXPECTED_CHUNKS) {
      expect(Object.keys(index.chunks[key])).toEqual(["dataUrl"]);
      const file = artifacts.chunkFiles[key];
      const text = artifacts.files[file];
      const chunk = JSON.parse(text);
      expect(chunk.schemaVersion).toBe(1);
      expect(chunk.chunkKey).toBe(key); // the chunk key is the stable logical key — never the hashed file name
      expect(chunk.chunkKey).not.toMatch(/[0-9a-f]{32}/);
      expect(Object.keys(chunk)).toEqual(["schemaVersion", "worldId", "chunkKey", "components"]);
      expect(text).not.toMatch(/dst_[0-9a-z]{16}|"gates"|"gate"|"age21"|"destinationId"|"dataUrl"|"version"|[?&]v=/);
      expect(text).not.toContain(artifacts.versions[file]); // a payload never carries its own token
    }
    expect(Object.keys(index.chunks)).toEqual(EXPECTED_CHUNKS); // index keys are the logical chunk keys, not file names
    expect(artifacts.files[artifacts.globalSceneFile]).not.toContain(artifacts.versions[artifacts.globalSceneFile]);
    expect(JSON.parse(artifacts.files[artifacts.globalSceneFile]).schemaVersion).toBeUndefined(); // the scene envelope is authored, unchanged
    expect(Object.keys(index.destinations).sort()).toEqual(activeWorldDestinations);
    expect(JSON.stringify(index)).not.toMatch(/"(gates|gate|age21|ageRestriction|enforced|jurisdictions|auth)"/);
  });

  it("addresses the gated cannabis chunk exactly like every other artifact — a digest is delivery metadata, not authorisation", () => {
    const artifacts = generateSpatialArtifacts(source());
    const cannabis = artifacts.chunkFiles["cannabis-21"];
    const { file, base, token } = splitAddressed(urlsOf(artifacts)["cannabis-21"]);
    expect(file).toBe(cannabis);
    expect(base).toBe(`${OUTPUT.chunksDir}/cannabis-21`);
    expect(token).toBe(contentVersion(artifacts.files[cannabis]));
    // Nothing in the generated data says anything about gates, prefetch or eligibility.
    expect(artifacts.files[OUTPUT.spatialIndex]).not.toMatch(/prefetch|preload|warm|eligible|allowed|gate/i);
  });

  it("matches the committed index byte for byte, and every committed content-addressed file is the digest of its own bytes", () => {
    const artifacts = generateSpatialArtifacts(source());
    const committed = readFileSync(join(OUTPUT_DIR, OUTPUT.spatialIndex), "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(artifacts.files[OUTPUT.spatialIndex]);
    const committedIndex = JSON.parse(committed);
    const urls = [committedIndex.globalSceneUrl, ...EXPECTED_CHUNKS.map((key) => committedIndex.chunks[key].dataUrl)];
    for (const url of urls) {
      const { file, token } = splitAddressed(url);
      const onDisk = readFileSync(join(OUTPUT_DIR, file), "utf8").replace(/\r\n/g, "\n");
      expect(contentVersion(onDisk), file).toBe(token); // the committed file name token IS the digest of the committed file
    }
  });
});
