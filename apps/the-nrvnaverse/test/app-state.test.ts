import { describe, expect, it } from "vitest";
import type { DestinationsFile, SpatialPlacement } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import {
  IMPLEMENTED_PHASES,
  PLANNED_PHASES,
  SETTLED_PHASES,
  TRAVEL_START_PHASES,
  beginTravel,
  bootState,
  canBeginTravel,
  dismissTravelOutcome,
  isInitialLoading,
  isSettled,
  withChunkLoading,
  withData,
  withEntry,
  withInitialDeepLink,
  withInitialPlacement,
  withTravelResult,
} from "@/lib/app-state";
import { PlannedSpatialAdapter } from "@/lib/spatial/planned-spatial-adapter";

const data = destinationsJson as unknown as DestinationsFile;
const hubId = data.hubId;
const musicId = data.index.bySlug["music"];
const farmsId = data.index.bySlug["nrvna-farms-placeholder"];
const cannabisId = data.index.bySlug["cannabis-21"];
const fashionId = data.index.bySlug["fashion-culture"];

function placement(destinationId: string, ref: string): SpatialPlacement {
  return { destinationId, platform: "the-nrvnaverse", worldId: "the-nrvnaverse", placementRef: ref };
}

function loadingState(search: string) {
  return withInitialDeepLink(withData(bootState(), data), search);
}

function readyState(search: string) {
  const loading = loadingState(search);
  if (loading.phase !== "loadingGlobals") throw new Error("unreachable");
  return withInitialPlacement(loading, { kind: "placed", placement: placement(loading.requested.id, "test") });
}

describe("application state — phases", () => {
  it("implements loadingChunk and reserves nothing", () => {
    expect(IMPLEMENTED_PHASES).toEqual(["boot", "resolvingDestination", "loadingGlobals", "loadingChunk", "ready", "traveling", "arrived", "gateRequired", "error"]);
    expect(PLANNED_PHASES).toEqual([]);
    for (const settled of SETTLED_PHASES) expect(IMPLEMENTED_PHASES as readonly string[]).toContain(settled);
    for (const phase of TRAVEL_START_PHASES) expect(IMPLEMENTED_PHASES as readonly string[]).toContain(phase);
  });

  it("moves loadingGlobals → loadingChunk(initial) when the first chunk starts loading, and completes from there", () => {
    const loading = loadingState(`?destination=${musicId}`);
    expect(isInitialLoading(loading)).toBe(true);
    const chunk = withChunkLoading(loading, musicId);
    expect(chunk).toMatchObject({ phase: "loadingChunk", stage: "initial" });
    if (chunk.phase !== "loadingChunk" || chunk.stage !== "initial") throw new Error("unreachable");
    expect(chunk.requested.id).toBe(musicId);
    expect(isInitialLoading(chunk)).toBe(true);
    expect(isSettled(chunk)).toBe(false);
    expect(canBeginTravel(chunk)).toBe(false);
    const ready = withInitialPlacement(chunk, { kind: "placed", placement: placement(musicId, "chunk:music") });
    expect(ready.phase).toBe("ready");
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.current.id).toBe(musicId);
  });

  it("boots, loads data, resolves the deep link and waits for the engine", () => {
    const booted = bootState();
    expect(booted.phase).toBe("boot");
    const loaded = withData(booted, data);
    expect(loaded.phase).toBe("resolvingDestination");
    const loading = withInitialDeepLink(loaded, `?destination=${musicId}`);
    expect(loading.phase).toBe("loadingGlobals");
    if (loading.phase !== "loadingGlobals") throw new Error("unreachable");
    expect(loading.requested.id).toBe(musicId);
    expect(loading.notices).toEqual([]);
    expect(isSettled(loading)).toBe(false);
  });

  it("becomes ready at the requested destination once the initial placement is done", () => {
    const ready = readyState(`?destination=${musicId}`);
    expect(ready.phase).toBe("ready");
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.current.id).toBe(musicId);
    expect(ready.placement.destinationId).toBe(musicId);
    expect(ready.notices).toEqual([]);
  });

  it("shows the hub without notices when no destination is requested", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.current.id).toBe(hubId);
    expect(ready.notices).toEqual([]);
  });

  it("falls back to the hub with a non-fatal notice for an unknown destination", () => {
    const loading = loadingState("?destination=dst_0000000000000000");
    if (loading.phase !== "loadingGlobals") throw new Error("unreachable");
    expect(loading.requested.id).toBe(hubId);
    expect(loading.notices.map((n) => n.code)).toEqual(["unknown-destination"]);
  });

  it("does not enter a hidden destination", () => {
    const hidden: DestinationsFile = {
      ...data,
      destinations: data.destinations.map((d) => (d.id === farmsId ? { ...d, status: "hidden" as const } : d)),
    };
    const loading = withInitialDeepLink(withData(bootState(), hidden), `?destination=${farmsId}`);
    if (loading.phase !== "loadingGlobals") throw new Error("unreachable");
    expect(loading.requested.id).toBe(hubId);
    expect(loading.notices.map((n) => n.code)).toEqual(["destination-not-public"]);
  });

  it("never turns the return parameter into an arbitrary redirect", () => {
    const loading = loadingState(`?destination=${farmsId}&return=${encodeURIComponent("https://evil.example/")}`);
    if (loading.phase !== "loadingGlobals") throw new Error("unreachable");
    expect(loading.entry.returnUrl).toBeNull();
    expect(loading.notices.map((n) => n.code)).toEqual(["deep-link-issue"]);

    const safe = loadingState(`?destination=${farmsId}&return=web`);
    if (safe.phase !== "loadingGlobals") throw new Error("unreachable");
    expect(safe.entry.returnUrl).toBe("https://www.nrvnaverse.com/");
  });

  it("becomes an error when the data has no active hub", () => {
    const noHub: DestinationsFile = {
      ...data,
      destinations: data.destinations.map((d) => (d.id === hubId ? { ...d, status: "draft" as const } : d)),
    };
    expect(withData(bootState(), noHub).phase).toBe("error");
  });

  it("refuses to complete an initial placement from the wrong phase", () => {
    expect(withInitialPlacement(bootState(), { kind: "placed", placement: placement(hubId, "x") }).phase).toBe("error");
  });
});

describe("application state — initial gate and failure handling", () => {
  it("surfaces gateRequired for a gated deep link and places the visitor at the hub", () => {
    const loading = loadingState(`?destination=${cannabisId}`);
    if (loading.phase !== "loadingGlobals") throw new Error("unreachable");
    const hub = loading.loaded.index.hub;
    const state = withInitialPlacement(loading, { kind: "gate-required", gates: ["age21"], fallback: { destination: hub, placement: placement(hubId, "hub") } });
    expect(state.phase).toBe("gateRequired");
    if (state.phase !== "gateRequired") throw new Error("unreachable");
    expect(state.current.id).toBe(hubId);
    expect(state.gate).toEqual({ destinationId: cannabisId, gates: ["age21"] });
    // The deep link itself still names the gated destination; it was never rewritten.
    expect(state.entry.resolution.destination.id).toBe(cannabisId);
    expect(isSettled(state)).toBe(true);
    expect(dismissTravelOutcome(state).phase).toBe("ready");
  });

  it("falls back to the hub with a notice when the initial placement fails but the hub is placed", () => {
    const loading = loadingState(`?destination=${musicId}`);
    if (loading.phase !== "loadingGlobals") throw new Error("unreachable");
    const hub = loading.loaded.index.hub;
    const state = withInitialPlacement(loading, { kind: "failed", message: "no placement", fallback: { destination: hub, placement: placement(hubId, "hub") } });
    if (state.phase !== "ready") throw new Error(`expected ready, got ${state.phase}`);
    expect(state.current.id).toBe(hubId);
    expect(state.notices.map((n) => n.code)).toEqual(["travel-failed"]);
  });

  it("errors when neither the destination nor the hub can be placed", () => {
    const loading = loadingState("");
    const state = withInitialPlacement(loading, { kind: "failed", message: "runtime down", fallback: null });
    expect(state.phase).toBe("error");
  });
});

describe("application state — travel transitions", () => {
  it("travels: ready → traveling → arrived, then dismiss → ready", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    const music = ready.loaded.index.byId.get(musicId)!;

    const traveling = beginTravel(ready, music);
    expect(traveling.phase).toBe("traveling");
    if (traveling.phase !== "traveling") throw new Error("unreachable");
    expect(traveling.target.id).toBe(musicId);
    expect(traveling.current.id).toBe(hubId);

    const arrived = withTravelResult(traveling, { status: "arrived", placement: placement(musicId, "m0:music") }, 12.5);
    expect(arrived.phase).toBe("arrived");
    if (arrived.phase !== "arrived") throw new Error("unreachable");
    expect(arrived.current.id).toBe(musicId);
    expect(arrived.placement.placementRef).toBe("m0:music");
    expect(arrived.arrival).toEqual({ destinationId: musicId, durationMs: 12.5 });

    const settled = dismissTravelOutcome(arrived);
    expect(settled.phase).toBe("ready");
    if (settled.phase !== "ready") throw new Error("unreachable");
    expect(settled.current.id).toBe(musicId);
  });

  it("keeps the visitor where they are when travel is gate-required", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    const cannabis = ready.loaded.index.byId.get(cannabisId)!;
    const traveling = beginTravel(ready, cannabis);
    const state = withTravelResult(traveling, { status: "gate-required", destinationId: cannabisId, gates: ["age21"] }, 1);
    expect(state.phase).toBe("gateRequired");
    if (state.phase !== "gateRequired") throw new Error("unreachable");
    expect(state.current.id).toBe(hubId);
    expect(state.placement.destinationId).toBe(hubId);
    expect(state.gate.gates).toEqual(["age21"]);
  });

  it("returns to ready with a notice when travel fails or is unavailable", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    const music = ready.loaded.index.byId.get(musicId)!;

    const failed = withTravelResult(beginTravel(ready, music), { status: "failed", destinationId: musicId, reason: "nope" }, 1);
    if (failed.phase !== "ready") throw new Error("unreachable");
    expect(failed.current.id).toBe(hubId);
    expect(failed.notices.map((n) => n.code)).toEqual(["travel-failed"]);

    const unavailable = withTravelResult(beginTravel(ready, music), { status: "unavailable", reason: "engine down" }, 1);
    if (unavailable.phase !== "ready") throw new Error("unreachable");
    expect(unavailable.notices.map((n) => n.code)).toEqual(["spatial-unavailable"]);
  });

  it("allows a new travel from arrived and gateRequired, and from an in-flight travel (which it supersedes), but not while booting", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    const music = ready.loaded.index.byId.get(musicId)!;
    const arrived = withTravelResult(beginTravel(ready, music), { status: "arrived", placement: placement(musicId, "x") }, 1);
    expect(beginTravel(arrived, ready.loaded.index.hub).phase).toBe("traveling");

    const traveling = beginTravel(ready, music);
    expect(canBeginTravel(traveling)).toBe(true);
    const superseding = beginTravel(traveling, ready.loaded.index.hub);
    expect(superseding).toMatchObject({ phase: "traveling", target: { id: hubId }, current: { id: hubId } });
    expect(superseding).not.toBe(traveling);

    const loadingChunk = withChunkLoading(traveling, musicId);
    expect(loadingChunk).toMatchObject({ phase: "loadingChunk", stage: "travel", target: { id: musicId }, current: { id: hubId } });
    expect(canBeginTravel(loadingChunk)).toBe(true);
    expect(beginTravel(loadingChunk, ready.loaded.index.hub)).toMatchObject({ phase: "traveling", target: { id: hubId } });

    const loading = loadingState("");
    expect(beginTravel(loading, ready.loaded.index.hub)).toBe(loading);
  });

  it("enters loadingChunk only for the destination currently targeted; stale reports change nothing", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    const music = ready.loaded.index.byId.get(musicId)!;
    const traveling = beginTravel(ready, music);
    expect(withChunkLoading(traveling, hubId)).toBe(traveling); // stale: the target is music
    expect(withChunkLoading(ready, musicId)).toBe(ready); // nothing in flight
    const loadingChunk = withChunkLoading(traveling, musicId);
    expect(loadingChunk.phase).toBe("loadingChunk");
    const arrived = withTravelResult(loadingChunk, { status: "arrived", placement: placement(musicId, "chunk:music") }, 40);
    expect(arrived).toMatchObject({ phase: "arrived", current: { id: musicId }, arrival: { destinationId: musicId, durationMs: 40 } });
  });

  it("a superseded travel result leaves the state untouched", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    const music = ready.loaded.index.byId.get(musicId)!;
    const fashion = ready.loaded.index.byId.get(fashionId)!;
    const traveling = beginTravel(beginTravel(ready, music), fashion);
    expect(withTravelResult(traveling, { status: "superseded", destinationId: musicId }, 5)).toBe(traveling);
    const loadingChunk = withChunkLoading(traveling, fashionId);
    expect(withTravelResult(loadingChunk, { status: "superseded", destinationId: musicId }, 5)).toBe(loadingChunk);
    expect(withTravelResult(ready, { status: "superseded", destinationId: musicId }, 5)).toBe(ready);
  });

  it("re-resolves the deep-link entry after the URL changes without moving anyone", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    const next = withEntry(ready, `?destination=${musicId}&from=spatial`);
    if (next.phase !== "ready") throw new Error("unreachable");
    expect(next.entry.resolution.destination.id).toBe(musicId);
    expect(next.entry.from).toBe("spatial");
    expect(next.current.id).toBe(hubId);
  });
});

describe("planned (null) spatial adapter", () => {
  it("reports that travel is unavailable instead of pretending", async () => {
    const adapter = new PlannedSpatialAdapter();
    expect(adapter.name).toBe("planned-spatial-adapter");
    expect(adapter.canTravel(farmsId)).toMatchObject({ allowed: false, reason: "unavailable" });
    expect(await adapter.resolvePlacement(farmsId)).toMatchObject({ status: "unavailable" });
    expect(await adapter.travelTo(farmsId)).toMatchObject({ status: "unavailable" });
  });
});
