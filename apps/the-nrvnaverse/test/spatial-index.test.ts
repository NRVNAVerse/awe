import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { SPATIAL_SCHEMA_VERSION, parseSpatialIndex, placementRefFor, registryFromSpatialIndex } from "@/lib/spatial/spatial-index";
import { SPATIAL_INDEX_URL, StaticSpatialIndexSource } from "@/lib/spatial/spatial-index-source";

/**
 * The runtime placement resolver (M0 Step 2B.1) obtains physical placement from the GENERATED
 * spatial index — never from a hard-coded table in application code.
 */

const APP_ROOT = resolve(__dirname, "..");
const data = destinationsJson as unknown as DestinationsFile;
const activeWorldIds = data.destinations
  .filter((d) => d.status === "active" && d.spatialDestination?.platform === "the-nrvnaverse")
  .map((d) => d.id)
  .sort();

function mutated(mutate: (draft: Record<string, any>) => void): unknown { // eslint-disable-line @typescript-eslint/no-explicit-any
  const draft = structuredClone(spatialIndexJson) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  mutate(draft);
  return draft;
}

describe("generated spatial index → placement registry", () => {
  it("parses the committed index", () => {
    const index = parseSpatialIndex(spatialIndexJson);
    expect(index.schemaVersion).toBe(SPATIAL_SCHEMA_VERSION);
    expect(index.worldId).toBe("the-nrvnaverse");
    expect(index.globalSceneUrl).toBe("/data/spatial/global-scene.json");
    expect(Object.keys(index.chunks)).toEqual(["cannabis-21", "fashion-culture", "hub", "music"]);
    expect(Object.keys(index.destinations).sort()).toEqual(activeWorldIds);
  });

  it("builds the registry consumed by the adapter from generated data only", () => {
    const index = parseSpatialIndex(spatialIndexJson);
    const registry = registryFromSpatialIndex(index);
    expect(Object.keys(registry).sort()).toEqual(activeWorldIds);
    for (const [id, entry] of Object.entries(index.destinations)) {
      expect(registry[id]).toEqual({ worldId: index.worldId, chunkKey: entry.chunkKey, placementRef: placementRefFor(entry.chunkKey), spawn: entry.spawn });
      expect(registry[id].placementRef).toBe(`chunk:${entry.chunkKey}`);
    }
    // Every world-id in the registry is the manifest's world-id for that destination.
    for (const d of data.destinations) {
      if (d.spatialDestination?.platform === "the-nrvnaverse") expect(registry[d.id].worldId).toBe(d.spatialDestination.worldId);
    }
  });

  it("rejects an unsupported schema version, malformed entries, unknown chunk references and non-finite spawns", () => {
    expect(() => parseSpatialIndex(mutated((d) => (d.schemaVersion = 2)))).toThrow(/unsupported spatial schema version 2/);
    expect(() => parseSpatialIndex(null)).toThrow(/malformed/);
    expect(() => parseSpatialIndex(mutated((d) => (d.destinations.dst_7g19n1vm9ackw8a0.chunkKey = "nowhere")))).toThrow(/unknown chunk "nowhere"/);
    expect(() => parseSpatialIndex(mutated((d) => (d.destinations.dst_7g19n1vm9ackw8a0.spawn.position.x = "0")))).toThrow(/finite number/);
    expect(() => parseSpatialIndex(mutated((d) => (d.destinations.dst_7g19n1vm9ackw8a0.spawn.yaw = null)))).toThrow(/finite number/);
    expect(() => parseSpatialIndex(mutated((d) => (d.chunks["../etc"] = { dataUrl: "/x" })))).toThrow(/invalid chunk key/);
    expect(() => parseSpatialIndex(mutated((d) => delete d.worldId))).toThrow(/worldId/);
  });

  it("serves the index through a source abstraction the store can swap", async () => {
    expect(SPATIAL_INDEX_URL).toBe("/data/spatial/spatial-index.json");
    const loaded = await new StaticSpatialIndexSource(spatialIndexJson).load();
    expect(loaded).toEqual(parseSpatialIndex(spatialIndexJson));
    await expect(new StaticSpatialIndexSource({ schemaVersion: 0 }).load()).rejects.toThrow(/unsupported spatial schema version/);
  });
});

describe("no independently hard-coded placement table remains in application code", () => {
  const srcFiles = (dir: string): string[] =>
    readdirSync(join(APP_ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? srcFiles(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
    );

  it("application sources contain no stable destination ids and no spawn coordinate literals", () => {
    for (const file of srcFiles("src")) {
      const text = readFileSync(join(APP_ROOT, file), "utf8");
      expect(text, file).not.toMatch(/dst_[0-9abcdefghjkmnpqrstvwxyz]{16}/);
      expect(text, file).not.toMatch(/position:\s*\{\s*x:\s*-?\d/);
    }
    expect(srcFiles("src").some((f) => /placements\.m0/.test(f))).toBe(false);
  });

  it("the store builds the adapter registry from the spatial index", () => {
    const store = readFileSync(join(APP_ROOT, "src/lib/app-store.ts"), "utf8");
    expect(store).toMatch(/registryFromSpatialIndex\(/);
    expect(store).toMatch(/FetchSpatialIndexSource/);
  });
});
