import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { StaticChunkDataSource, type StaticChunkEntry } from "@/lib/spatial/chunk-data-source";
import { ChunkOrchestrator } from "@/lib/spatial/chunk-orchestrator";
import { parseSpatialIndex, placementRefFor } from "@/lib/spatial/spatial-index";
import { bootState, withData, withInitialDeepLink, withInitialPlacement, withWalkedInto, beginTravel, type AppState } from "@/lib/app-state";
import { validateSpatialSource, type SpatialSourceInput } from "../scripts/spatial/pipeline.mjs";
import { generatedChunks, spatialIndexJson } from "./support/generated-spatial";
import { FakeChunkRuntime } from "./support/fake-chunk-runtime";

/** M2: position-preserving handoff (orchestrator), the walked-into location (state), streaming validation (pipeline). */

const index = parseSpatialIndex(spatialIndexJson);
const data = destinationsJson as unknown as DestinationsFile;
const CITY = data.index.bySlug["city"];
const MUSIC = data.index.bySlug["music"];

function setup() {
  const runtime = new FakeChunkRuntime();
  const payloads: Record<string, StaticChunkEntry> = Object.fromEntries(Object.entries(generatedChunks).map(([k, v]) => [k, v as StaticChunkEntry]));
  const source = new StaticChunkDataSource(payloads);
  const orchestrator = new ChunkOrchestrator({ runtime, chunkSource: source, worldId: index.worldId, chunks: index.chunks, warn: () => {} });
  return { runtime, source, orchestrator };
}

describe("chunk orchestrator — position-preserving handoff (spawn: null)", () => {
  it("stages the next cell, commits it and retires the old one WITHOUT moving the visitor", async () => {
    const { runtime, source, orchestrator } = setup();
    await orchestrator.transitionTo({ chunkKey: "city-plaza", spawn: index.destinations[CITY].spawn, destinationId: CITY });
    runtime.log.length = 0;
    runtime.placed.length = 0;
    const result = await orchestrator.transitionTo({ chunkKey: "music", spawn: null, destinationId: "handoff:music" });
    expect(result).toEqual({ status: "arrived", chunkKey: "music", kind: "cross-chunk" });
    expect(runtime.placed).toEqual([]);
    expect(runtime.log.some((l) => l.startsWith("place:"))).toBe(false);
    const stageAt = runtime.log.indexOf("stage:music");
    const retireAt = runtime.log.indexOf("retire:city-plaza");
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(retireAt).toBeGreaterThan(stageAt); // stage-before-retire: the street is never missing
    expect(orchestrator.activeChunkKey).toBe("music");
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["city-plaza", "music"]);
  });

  it("a handoff to the active chunk is a no-op (no fetch, no place, no rebuild)", async () => {
    const { runtime, source, orchestrator } = setup();
    await orchestrator.transitionTo({ chunkKey: "city-plaza", spawn: index.destinations[CITY].spawn, destinationId: CITY });
    runtime.log.length = 0;
    const result = await orchestrator.transitionTo({ chunkKey: "city-plaza", spawn: null, destinationId: "handoff:city-plaza" });
    expect(result).toEqual({ status: "arrived", chunkKey: "city-plaza", kind: "same-chunk" });
    expect(runtime.log).toEqual([]);
    expect(source.requests).toHaveLength(1);
  });

  it("a portal travel issued during a handoff supersedes it (latest request wins)", async () => {
    const { orchestrator } = setup();
    await orchestrator.transitionTo({ chunkKey: "city-plaza", spawn: index.destinations[CITY].spawn, destinationId: CITY });
    const handoff = orchestrator.transitionTo({ chunkKey: "music", spawn: null, destinationId: "handoff:music" });
    const travel = orchestrator.transitionTo({ chunkKey: "hub", spawn: index.destinations[data.hubId].spawn, destinationId: data.hubId });
    expect((await handoff).status).toBe("superseded");
    expect(await travel).toMatchObject({ status: "arrived", chunkKey: "hub" });
    expect(orchestrator.activeChunkKey).toBe("hub");
  });
});

describe("app state — walked into another place (M2)", () => {
  function placedAtCity(): AppState {
    let s = withData(bootState(), data);
    s = withInitialDeepLink(s, `?destination=${CITY}`);
    if (s.phase !== "loadingGlobals") throw new Error("unexpected");
    return withInitialPlacement(s, { kind: "placed", placement: { destinationId: CITY, platform: "the-nrvnaverse", worldId: "the-nrvnaverse", placementRef: placementRefFor("city-plaza") } });
  }

  it("records the new place without a travel banner (phase ready, current updated)", () => {
    const s = placedAtCity();
    const music = s.phase !== "error" && "loaded" in s ? s.loaded.index.byId.get(MUSIC)! : null;
    const next = withWalkedInto(s, music!, { destinationId: MUSIC, platform: "the-nrvnaverse", worldId: "the-nrvnaverse", placementRef: placementRefFor("music") });
    expect(next.phase).toBe("ready");
    expect("current" in next && next.current.id).toBe(MUSIC);
    expect("placement" in next && next.placement.placementRef).toBe(placementRefFor("music"));
  });

  it("is ignored while a travel is in flight (the travel owns the state)", () => {
    const s = placedAtCity();
    const hub = "loaded" in s ? s.loaded.index.byId.get(data.hubId)! : null;
    const traveling = beginTravel(s, hub!);
    const music = "loaded" in s ? s.loaded.index.byId.get(MUSIC)! : null;
    expect(withWalkedInto(traveling, music!, { destinationId: MUSIC, platform: "the-nrvnaverse", worldId: "the-nrvnaverse", placementRef: placementRefFor("music") })).toBe(traveling);
  });
});

describe("spatial pipeline — streaming validation (M2)", () => {
  const SOURCE_DIR = resolve(__dirname, "..", "spatial", "source");
  const config = JSON.parse(readFileSync(join(SOURCE_DIR, "spatial-config.m0.json"), "utf8"));
  const scene = JSON.parse(readFileSync(join(SOURCE_DIR, "scene.m0.json"), "utf8"));
  const layers = { city: JSON.parse(readFileSync(join(SOURCE_DIR, "city-layer.m2.json"), "utf8")) };
  const input = (mutate: (c: Record<string, any>) => void): SpatialSourceInput => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = structuredClone(config);
    mutate(c);
    return { config: c, scene, destinations: data, layers };
  };
  const codes = (i: SpatialSourceInput) => {
    const r = validateSpatialSource(i);
    return r.ok ? [] : r.errors.map((e) => e.code);
  };

  it("the committed streaming grid validates", () => {
    expect(codes(input(() => {}))).toEqual([]);
  });

  it("refuses the gated 21+ chunk as a streaming cell or a release source (gate before fetch, never by proximity)", () => {
    expect(codes(input((c) => c.streaming.cells.push({ cell: [5, 5], chunkKey: "cannabis-21" })))).toEqual(["streaming-gated-chunk"]);
    expect(codes(input((c) => c.streaming.releases.push({ fromChunkKey: "cannabis-21", belowY: 0 })))).toEqual(["streaming-gated-chunk"]);
  });

  it("refuses unknown chunks, duplicate cells, a chunk on two cells, a margin too large and stray fields", () => {
    expect(codes(input((c) => c.streaming.cells.push({ cell: [9, 9], chunkKey: "nowhere" })))).toEqual(["unknown-chunk"]);
    expect(codes(input((c) => c.streaming.cells.push({ cell: [0, 0], chunkKey: "hub" })))).toEqual(["duplicate-streaming-cell"]);
    expect(codes(input((c) => c.streaming.cells.push({ cell: [7, 7], chunkKey: "music" })))).toEqual(["duplicate-streaming-chunk"]);
    expect(codes(input((c) => (c.streaming.margin = 150)))).toEqual(["invalid-streaming"]);
    expect(codes(input((c) => (c.streaming.extra = 1)))).toEqual(["unexpected-field"]);
    expect(codes(input((c) => (c.streaming.cells[0].cell = [0.5, 0])))).toEqual(["invalid-streaming-cell"]);
  });

  it("refuses a layer whose source is missing or names another key", () => {
    const missing: SpatialSourceInput = { config, scene, destinations: data, layers: {} };
    expect(codes(missing)).toEqual(["missing-layer-source"]);
    const wrong: SpatialSourceInput = { config, scene, destinations: data, layers: { city: { ...layers.city, key: "other" } } };
    expect(codes(wrong)).toEqual(["invalid-layer-source"]);
  });
});
