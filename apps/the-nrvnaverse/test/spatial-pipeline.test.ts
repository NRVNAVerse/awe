import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import {
  OUTPUT,
  SPATIAL_SCHEMA_VERSION,
  generateSpatialArtifacts,
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
const destinations = destinationsJson as unknown as DestinationsFile;

function source(mutate?: (draft: { config: Mutable; scene: Mutable; destinations: Mutable }) => void): SpatialSourceInput {
  const draft = structuredClone({ config: sourceConfig, scene: sourceScene, destinations: destinations as unknown as Mutable });
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
    expect(Object.keys(artifacts.files).sort()).toEqual(
      [OUTPUT.compatibilityScene, OUTPUT.globalScene, OUTPUT.spatialIndex, ...EXPECTED_CHUNKS.map((k) => `${OUTPUT.chunksDir}/${k}.json`)].sort(),
    );
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
    const globalIds = Object.keys(JSON.parse(artifacts.files[OUTPUT.globalScene]).components);
    const chunkIds = EXPECTED_CHUNKS.map((k) => Object.keys(JSON.parse(artifacts.files[`${OUTPUT.chunksDir}/${k}.json`]).components));
    const all = [globalIds, ...chunkIds].flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(sourceScene.components).sort());
    // Genuinely world-global things only: the avatar, its animation set, environment singletons and the shared ground.
    expect(globalIds).toEqual(["vrm-anims", "lighting", "background", "envmap", "fog", "ground", "Player"]);
  });

  it("emits the compatibility full scene as exactly the authored scene", () => {
    const artifacts = generateSpatialArtifacts(source());
    expect(JSON.parse(artifacts.files[OUTPUT.compatibilityScene])).toEqual(sourceScene);
    const global = JSON.parse(artifacts.files[OUTPUT.globalScene]);
    const { components: _c1, ...sceneEnvelope } = sourceScene;
    const { components: _c2, ...globalEnvelope } = global;
    expect(globalEnvelope).toEqual(sceneEnvelope);
  });

  it("keeps canonical destination metadata out of chunk files and the index", () => {
    const artifacts = generateSpatialArtifacts(source());
    for (const key of EXPECTED_CHUNKS) {
      const text = artifacts.files[`${OUTPUT.chunksDir}/${key}.json`];
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
    expect(index.chunks[cannabisChunk].dataUrl).toBe(`/data/${OUTPUT.chunksDir}/${cannabisChunk}.json`);
    const globalIds = Object.keys(JSON.parse(artifacts.files[OUTPUT.globalScene]).components);
    const cannabisIds = Object.keys(JSON.parse(artifacts.files[`${OUTPUT.chunksDir}/${cannabisChunk}.json`]).components);
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
    const committedChunks = readdirSync(join(OUTPUT_DIR, OUTPUT.chunksDir)).filter((n) => n.endsWith(".json")).sort();
    expect(committedChunks).toEqual(EXPECTED_CHUNKS.map((k) => `${k}.json`));
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
      const text = artifacts.files[`${OUTPUT.chunksDir}/${key}.json`];
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
    expect(Object.keys(JSON.parse(artifacts.files[`${OUTPUT.chunksDir}/cannabis-21.json`]).components).filter((id) => id.startsWith("portal-"))).toEqual([]);
    expect(Object.keys(JSON.parse(artifacts.files[OUTPUT.globalScene]).components).filter((id) => id.startsWith("portal-"))).toEqual([]);
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
