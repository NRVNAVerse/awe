import { describe, expect, it } from "vitest";
import { createDestinationIndex, type DestinationsFile, type SpatialTravelPhase } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { AweSpatialAdapter, RUNTIME_NOT_READY_REASON } from "@/lib/spatial/awe-spatial-adapter";
import { StaticChunkDataSource, type StaticChunkEntry } from "@/lib/spatial/chunk-data-source";
import { ChunkOrchestrator } from "@/lib/spatial/chunk-orchestrator";
import { lookupPlacement, toSpatialPlacement, type PlacementRegistry } from "@/lib/spatial/placement-registry";
import { parseSpatialIndex, registryFromSpatialIndex } from "@/lib/spatial/spatial-index";
import cannabisJson from "../public/data/spatial/chunks/cannabis-21.json";
import fashionJson from "../public/data/spatial/chunks/fashion-culture.json";
import hubJson from "../public/data/spatial/chunks/hub.json";
import musicJson from "../public/data/spatial/chunks/music.json";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";

// The registry under test is built from the GENERATED spatial index — the same data the app
// loads at boot. No hand-kept coordinate table exists any more (M0 Step 2B.1).
const M0_INDEX = parseSpatialIndex(spatialIndexJson);
const M0_PLACEMENTS = registryFromSpatialIndex(M0_INDEX);
const M0_WORLD_ID = M0_INDEX.worldId;

const data = destinationsJson as unknown as DestinationsFile;
const index = createDestinationIndex(data.destinations);
const hubId = data.hubId;
const musicId = data.index.bySlug["music"];
const artistId = data.index.bySlug["placeholder-artist"];
const fashionId = data.index.bySlug["fashion-culture"];
const brandId = data.index.bySlug["placeholder-fashion-culture-brand"];
const cannabisId = data.index.bySlug["cannabis-21"];
const farmsId = data.index.bySlug["nrvna-farms-placeholder"];

const GENERATED: Record<string, StaticChunkEntry> = { hub: hubJson, music: musicJson, "fashion-culture": fashionJson, "cannabis-21": cannabisJson };

function harness(options: { registry?: PlacementRegistry; getDestination?: (id: string) => ReturnType<typeof index.byId.get>; payloads?: Record<string, StaticChunkEntry> } = {}) {
  const runtime = new FakeChunkRuntime();
  const source = new StaticChunkDataSource(options.payloads ?? GENERATED);
  const orchestrator = new ChunkOrchestrator({ runtime, chunkSource: source, worldId: M0_WORLD_ID, chunks: M0_INDEX.chunks, warn: () => {} });
  const adapter = new AweSpatialAdapter({
    registry: options.registry ?? M0_PLACEMENTS,
    getDestination: options.getDestination ?? ((id) => index.byId.get(id)),
    orchestrator,
  });
  const phases: Array<[SpatialTravelPhase, string | null]> = [];
  adapter.onPhase((phase, id) => phases.push([phase, id]));
  return { runtime, source, orchestrator, adapter, phases };
}

describe("placement registry (built from the generated spatial index)", () => {
  it("is keyed by stable destination id and covers every M0 manifest", () => {
    for (const d of data.destinations) {
      expect(lookupPlacement(M0_PLACEMENTS, d.id).status).toBe("found");
      expect(M0_PLACEMENTS[d.id].worldId).toBe(d.spatialDestination?.platform === "the-nrvnaverse" ? d.spatialDestination.worldId : M0_WORLD_ID);
    }
  });

  it("returns a structured miss for an unregistered id", () => {
    const miss = lookupPlacement(M0_PLACEMENTS, "dst_0000000000000000");
    expect(miss).toMatchObject({ status: "missing", destinationId: "dst_0000000000000000" });
    expect(lookupPlacement(M0_PLACEMENTS, "constructor").status).toBe("missing");
  });

  it("exposes only a coordinate-free view to the application layer", () => {
    const found = lookupPlacement(M0_PLACEMENTS, musicId);
    if (found.status !== "found") throw new Error("unreachable");
    const view = toSpatialPlacement(musicId, found.placement);
    expect(view).toEqual({ destinationId: musicId, platform: "the-nrvnaverse", worldId: M0_WORLD_ID, placementRef: "chunk:music" });
    expect(JSON.stringify(view)).not.toContain("chunkKey");
    expect(JSON.stringify(view)).not.toMatch(/position|spawn|"x"|"y"|"z"/);
  });

  it("keeps coordinates out of the manifest (registry owns them)", () => {
    for (const d of data.destinations) {
      const spatial = d.spatialDestination as Record<string, unknown> | null;
      if (spatial) expect(Object.keys(spatial).sort()).toEqual(["platform", "worldId"]);
      const text = JSON.stringify(d);
      expect(text).not.toMatch(/"(position|spawn|chunkKey|coordinates|yaw)"/);
    }
  });
});

describe("AWE spatial adapter — eligibility", () => {
  it("allows unrestricted, placed destinations", () => {
    const { adapter } = harness();
    for (const id of [hubId, musicId, artistId]) {
      expect(adapter.canTravel(id)).toEqual({ allowed: true, destinationId: id });
    }
  });

  it("does not treat gated cannabis destinations as ordinary destinations", () => {
    const { adapter } = harness();
    expect(adapter.canTravel(cannabisId)).toEqual({ allowed: false, destinationId: cannabisId, reason: "gate-required", gates: ["age21"] });
    expect(adapter.canTravel(farmsId)).toEqual({ allowed: false, destinationId: farmsId, reason: "gate-required", gates: ["age21"] });
  });

  it("refuses unknown ids, non-public destinations and unplaced destinations with structured reasons", () => {
    const { adapter } = harness();
    expect(adapter.canTravel("dst_0000000000000000")).toMatchObject({ allowed: false, reason: "unknown-destination" });
    expect(adapter.canTravel("not-an-id")).toMatchObject({ allowed: false, reason: "unknown-destination" });

    const hiddenIndex = createDestinationIndex(data.destinations.map((d) => (d.id === musicId ? { ...d, status: "hidden" as const } : d)));
    expect(harness({ getDestination: (id) => hiddenIndex.byId.get(id) }).adapter.canTravel(musicId)).toMatchObject({ allowed: false, reason: "not-public" });

    const { [musicId]: _omit, ...withoutMusic } = M0_PLACEMENTS;
    expect(harness({ registry: withoutMusic }).adapter.canTravel(musicId)).toMatchObject({ allowed: false, reason: "unplaced" });
  });

  it("is unavailable until a ready orchestrator is bound", () => {
    const adapter = new AweSpatialAdapter({ registry: M0_PLACEMENTS, getDestination: (id) => index.byId.get(id) });
    expect(adapter.canTravel(musicId)).toMatchObject({ allowed: false, reason: "unavailable", message: RUNTIME_NOT_READY_REASON });
    const { runtime, orchestrator } = harness();
    runtime.isReady = false;
    adapter.bindOrchestrator(orchestrator);
    expect(adapter.canTravel(musicId)).toMatchObject({ allowed: false, reason: "unavailable" });
    runtime.isReady = true;
    expect(adapter.canTravel(musicId)).toMatchObject({ allowed: true });
  });

  it("evaluates gates before placement so a gated destination is never reported as merely unavailable", () => {
    const adapter = new AweSpatialAdapter({ registry: M0_PLACEMENTS, getDestination: (id) => index.byId.get(id) });
    expect(adapter.canTravel(cannabisId)).toMatchObject({ allowed: false, reason: "gate-required" });
  });
});

describe("AWE spatial adapter — placement and travel through the chunk orchestrator", () => {
  it("resolves placements by stable id without moving anyone or fetching anything", async () => {
    const { runtime, source, adapter } = harness();
    expect(await adapter.resolvePlacement(musicId)).toEqual({
      status: "resolved",
      placement: { destinationId: musicId, platform: "the-nrvnaverse", worldId: M0_WORLD_ID, placementRef: "chunk:music" },
    });
    expect(await adapter.resolvePlacement("dst_0000000000000000")).toMatchObject({ status: "unplaced", destinationId: "dst_0000000000000000" });
    expect(runtime.placed).toEqual([]);
    expect(source.requests).toEqual([]);
  });

  it("first travel loads exactly the destination's chunk and reports traveling → loadingChunk → arrived", async () => {
    const { runtime, source, adapter, phases } = harness();
    const result = await adapter.travelTo(musicId);
    expect(result).toEqual({
      status: "arrived",
      placement: { destinationId: musicId, platform: "the-nrvnaverse", worldId: M0_WORLD_ID, placementRef: "chunk:music" },
    });
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["music"]);
    expect(runtime.placed).toEqual([M0_INDEX.destinations[musicId].spawn]);
    expect(phases).toEqual([
      ["traveling", musicId],
      ["loadingChunk", musicId],
      ["arrived", musicId],
    ]);
    expect(adapter.activeChunkKey).toBe("music");
  });

  it("same-chunk travel reports no loadingChunk and does not refetch (Music → Artist, Fashion → Brand)", async () => {
    const { runtime, source, adapter, phases } = harness();
    await adapter.travelTo(musicId);
    phases.length = 0;
    expect(await adapter.travelTo(artistId)).toMatchObject({ status: "arrived", placement: { placementRef: "chunk:music" } });
    expect(phases).toEqual([
      ["traveling", artistId],
      ["arrived", artistId],
    ]);
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["music"]);

    await adapter.travelTo(fashionId);
    phases.length = 0;
    expect(await adapter.travelTo(brandId)).toMatchObject({ status: "arrived", placement: { placementRef: "chunk:fashion-culture" } });
    expect(phases.map(([p]) => p)).toEqual(["traveling", "arrived"]);
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["music", "fashion-culture"]);
    expect(runtime.placed.length).toBe(4);
  });

  it("GATE BEFORE FETCH: gated cannabis destinations are refused with no teleport, no chunk request and no loadingChunk", async () => {
    const { runtime, source, adapter, phases } = harness();
    await adapter.travelTo(fashionId);
    phases.length = 0;
    source.requests.length = 0;
    runtime.placed.length = 0;

    for (const id of [cannabisId, farmsId]) {
      const result = await adapter.travelTo(id);
      expect(result).toEqual({ status: "gate-required", destinationId: id, gates: ["age21"] });
    }
    expect(source.requests).toEqual([]);
    expect(runtime.placed).toEqual([]);
    expect(runtime.world.has("platform-cannabis-21")).toBe(false);
    expect(phases).toEqual([
      ["traveling", cannabisId],
      ["gateRequired", cannabisId],
      ["traveling", farmsId],
      ["gateRequired", farmsId],
    ]);
    expect(adapter.currentPhase).toBe("gateRequired");
    expect(adapter.activeChunkKey).toBe("fashion-culture");
  });

  it("the manifest's placeholder enforced:false is not a permission to fetch", () => {
    for (const id of [cannabisId, farmsId]) {
      const gate = index.byId.get(id)!.gates[0] as { kind: string; config: { enforced?: boolean } };
      expect(gate.kind).toBe("age21");
      expect(gate.config.enforced).toBe(false); // placeholder data …
      expect(harness().adapter.canTravel(id)).toMatchObject({ allowed: false, reason: "gate-required" }); // … still refused
    }
  });

  it("reports missing placements and chunk failures as failures, and a missing orchestrator as unavailable", async () => {
    const { [artistId]: _omit, ...registry } = M0_PLACEMENTS;
    const { adapter } = harness({ registry });
    expect(await adapter.travelTo(artistId)).toMatchObject({ status: "failed", destinationId: artistId });
    expect(await adapter.travelTo("dst_0000000000000000")).toMatchObject({ status: "failed" });

    const broken = harness();
    await broken.adapter.travelTo(hubId);
    broken.runtime.failPlace = "physics exploded";
    expect(await broken.adapter.travelTo(musicId)).toEqual({ status: "failed", destinationId: musicId, reason: "physics exploded" });
    expect(broken.adapter.activeChunkKey).toBe("hub");
    expect(broken.phases.at(-1)).toEqual(["failed", musicId]);

    const missing = harness({ payloads: { hub: hubJson } });
    await missing.adapter.travelTo(hubId);
    expect(await missing.adapter.travelTo(musicId)).toMatchObject({ status: "failed", destinationId: musicId, reason: expect.stringMatching(/404/) });
    expect(missing.adapter.activeChunkKey).toBe("hub");

    const unbound = new AweSpatialAdapter({ registry: M0_PLACEMENTS, getDestination: (id) => index.byId.get(id) });
    expect(await unbound.travelTo(musicId)).toEqual({ status: "unavailable", reason: RUNTIME_NOT_READY_REASON });
  });

  it("returns superseded (not failed) for a travel a newer one replaced, and emits no phase for it afterwards", async () => {
    const { runtime, adapter, phases } = harness();
    await adapter.travelTo(hubId);
    phases.length = 0;
    runtime.holdStage = true;
    const a = adapter.travelTo(musicId);
    await flush();
    runtime.holdStage = false;
    const b = adapter.travelTo(fashionId);
    await flush();
    runtime.releaseStage();
    expect(await a).toEqual({ status: "superseded", destinationId: musicId });
    expect(await b).toMatchObject({ status: "arrived", placement: { destinationId: fashionId } });
    expect(phases).toEqual([
      ["traveling", musicId],
      ["loadingChunk", musicId],
      ["traveling", fashionId],
      ["loadingChunk", fashionId],
      ["arrived", fashionId],
    ]);
    expect(adapter.activeChunkKey).toBe("fashion-culture");
  });

  it("cleans up subscriptions and detaches the orchestrator on dispose", async () => {
    const { runtime, adapter } = harness();
    const seen: SpatialTravelPhase[] = [];
    const offA = adapter.onPhase((p) => seen.push(p));
    adapter.onPhase(() => {});
    expect(adapter.listenerCount).toBe(3); // harness listener + two here
    offA();
    expect(adapter.listenerCount).toBe(2);

    adapter.dispose();
    expect(adapter.listenerCount).toBe(0);
    expect(adapter.onPhase(() => seen.push("idle"))).toBeTypeOf("function");
    expect(adapter.listenerCount).toBe(0);
    expect(await adapter.travelTo(musicId)).toMatchObject({ status: "unavailable" });
    expect(runtime.placed).toEqual([]);
    expect(seen).toEqual([]);
  });
});
