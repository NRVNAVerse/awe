import { describe, expect, it } from "vitest";
import { createDestinationIndex, type DestinationsFile, type SpatialTravelPhase } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { AweSpatialAdapter, RUNTIME_NOT_READY_REASON } from "@/lib/spatial/awe-spatial-adapter";
import { lookupPlacement, toSpatialPlacement, type PlacementRegistry } from "@/lib/spatial/placement-registry";
import type { SpawnPoint } from "@/lib/spatial/placement-registry";
import { parseSpatialIndex, registryFromSpatialIndex } from "@/lib/spatial/spatial-index";
import type { SpatialRuntime } from "@/lib/spatial/spatial-runtime";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";

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
const cannabisId = data.index.bySlug["cannabis-21"];
const farmsId = data.index.bySlug["nrvna-farms-placeholder"];

/** Fake engine runtime: records teleports instead of moving anything. */
class FakeRuntime implements SpatialRuntime {
  isReady = true;
  placed: SpawnPoint[] = [];
  placeVisitor(spawn: SpawnPoint): void {
    if (!this.isReady) throw new Error("not ready");
    this.placed.push(spawn);
  }
}

function makeAdapter(runtime: SpatialRuntime | null = new FakeRuntime(), registry: PlacementRegistry = M0_PLACEMENTS) {
  return new AweSpatialAdapter({ registry, getDestination: (id) => index.byId.get(id), runtime });
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
    const adapter = makeAdapter();
    for (const id of [hubId, musicId, artistId]) {
      expect(adapter.canTravel(id)).toEqual({ allowed: true, destinationId: id });
    }
  });

  it("does not treat gated cannabis destinations as ordinary destinations", () => {
    const adapter = makeAdapter();
    expect(adapter.canTravel(cannabisId)).toEqual({ allowed: false, destinationId: cannabisId, reason: "gate-required", gates: ["age21"] });
    expect(adapter.canTravel(farmsId)).toEqual({ allowed: false, destinationId: farmsId, reason: "gate-required", gates: ["age21"] });
  });

  it("refuses unknown ids, non-public destinations and unplaced destinations with structured reasons", () => {
    const adapter = makeAdapter();
    expect(adapter.canTravel("dst_0000000000000000")).toMatchObject({ allowed: false, reason: "unknown-destination" });
    expect(adapter.canTravel("not-an-id")).toMatchObject({ allowed: false, reason: "unknown-destination" });

    const hiddenIndex = createDestinationIndex(data.destinations.map((d) => (d.id === musicId ? { ...d, status: "hidden" as const } : d)));
    const hiddenAdapter = new AweSpatialAdapter({ registry: M0_PLACEMENTS, getDestination: (id) => hiddenIndex.byId.get(id), runtime: new FakeRuntime() });
    expect(hiddenAdapter.canTravel(musicId)).toMatchObject({ allowed: false, reason: "not-public" });

    const { [musicId]: _omit, ...withoutMusic } = M0_PLACEMENTS;
    expect(makeAdapter(new FakeRuntime(), withoutMusic).canTravel(musicId)).toMatchObject({ allowed: false, reason: "unplaced" });
  });

  it("is unavailable until a ready runtime is bound", () => {
    const adapter = makeAdapter(null);
    expect(adapter.canTravel(musicId)).toMatchObject({ allowed: false, reason: "unavailable", message: RUNTIME_NOT_READY_REASON });
    const runtime = new FakeRuntime();
    runtime.isReady = false;
    adapter.bindRuntime(runtime);
    expect(adapter.canTravel(musicId)).toMatchObject({ allowed: false, reason: "unavailable" });
    runtime.isReady = true;
    expect(adapter.canTravel(musicId)).toMatchObject({ allowed: true });
  });

  it("evaluates gates before placement so a gated destination is never reported as merely unavailable", () => {
    const adapter = makeAdapter(null);
    expect(adapter.canTravel(cannabisId)).toMatchObject({ allowed: false, reason: "gate-required" });
  });
});

describe("AWE spatial adapter — placement and travel", () => {
  it("resolves placements by stable id without moving anyone", async () => {
    const runtime = new FakeRuntime();
    const adapter = makeAdapter(runtime);
    expect(await adapter.resolvePlacement(musicId)).toEqual({
      status: "resolved",
      placement: { destinationId: musicId, platform: "the-nrvnaverse", worldId: M0_WORLD_ID, placementRef: "chunk:music" },
    });
    expect(await adapter.resolvePlacement("dst_0000000000000000")).toMatchObject({ status: "unplaced", destinationId: "dst_0000000000000000" });
    expect(runtime.placed).toEqual([]);
  });

  it("travels to an unrestricted destination by teleporting through the runtime and reports phases", async () => {
    const runtime = new FakeRuntime();
    const adapter = makeAdapter(runtime);
    const phases: Array<[SpatialTravelPhase, string | null]> = [];
    const off = adapter.onPhase((phase, id) => phases.push([phase, id]));

    const result = await adapter.travelTo(musicId);
    expect(result).toEqual({
      status: "arrived",
      placement: { destinationId: musicId, platform: "the-nrvnaverse", worldId: M0_WORLD_ID, placementRef: "chunk:music" },
    });
    expect(runtime.placed).toEqual([M0_PLACEMENTS[musicId].spawn]);
    expect(runtime.placed[0]).toEqual(M0_INDEX.destinations[musicId].spawn);
    expect(phases).toEqual([
      ["traveling", musicId],
      ["arrived", musicId],
    ]);
    off();
  });

  it("refuses gated cannabis destinations: no teleport, structured gate-required result, gateRequired phase", async () => {
    const runtime = new FakeRuntime();
    const adapter = makeAdapter(runtime);
    const phases: SpatialTravelPhase[] = [];
    adapter.onPhase((phase) => phases.push(phase));

    for (const id of [cannabisId, farmsId]) {
      const result = await adapter.travelTo(id);
      expect(result).toEqual({ status: "gate-required", destinationId: id, gates: ["age21"] });
    }
    expect(runtime.placed).toEqual([]);
    expect(phases).toEqual(["traveling", "gateRequired", "traveling", "gateRequired"]);
    expect(adapter.currentPhase).toBe("gateRequired");
  });

  it("reports missing placements and runtime errors as failures, and a missing runtime as unavailable", async () => {
    const { [artistId]: _omit, ...registry } = M0_PLACEMENTS;
    const adapter = makeAdapter(new FakeRuntime(), registry);
    expect(await adapter.travelTo(artistId)).toMatchObject({ status: "failed", destinationId: artistId });
    expect(await adapter.travelTo("dst_0000000000000000")).toMatchObject({ status: "failed" });

    const broken = new FakeRuntime();
    broken.placeVisitor = () => {
      throw new Error("physics exploded");
    };
    expect(await makeAdapter(broken).travelTo(musicId)).toEqual({ status: "failed", destinationId: musicId, reason: "physics exploded" });

    expect(await makeAdapter(null).travelTo(musicId)).toEqual({ status: "unavailable", reason: RUNTIME_NOT_READY_REASON });
  });

  it("cleans up subscriptions and detaches the runtime on dispose", async () => {
    const runtime = new FakeRuntime();
    const adapter = makeAdapter(runtime);
    const seen: SpatialTravelPhase[] = [];
    const offA = adapter.onPhase((p) => seen.push(p));
    adapter.onPhase(() => {});
    expect(adapter.listenerCount).toBe(2);
    offA();
    expect(adapter.listenerCount).toBe(1);

    adapter.dispose();
    expect(adapter.listenerCount).toBe(0);
    expect(adapter.onPhase(() => seen.push("idle"))).toBeTypeOf("function");
    expect(adapter.listenerCount).toBe(0);
    expect(await adapter.travelTo(musicId)).toMatchObject({ status: "unavailable" });
    expect(runtime.placed).toEqual([]);
    expect(seen).toEqual([]);
  });
});
