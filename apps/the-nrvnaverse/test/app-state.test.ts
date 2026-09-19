import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { IMPLEMENTED_PHASES, PLANNED_PHASES, bootState, withData, withDeepLink } from "@/lib/app-state";
import { PlannedSpatialAdapter } from "@/lib/spatial/planned-spatial-adapter";

const data = destinationsJson as unknown as DestinationsFile;
const hubId = data.hubId;
const farmsId = data.index.bySlug["nrvna-farms-placeholder"];

function readyState(search: string) {
  return withDeepLink(withData(bootState(), data), search);
}

describe("application state", () => {
  it("keeps implemented and planned phases distinct", () => {
    expect(IMPLEMENTED_PHASES).toEqual(["boot", "resolvingDestination", "ready", "error"]);
    expect(PLANNED_PHASES).toEqual(["loadingGlobals", "loadingChunk", "traveling", "arrived", "gateRequired"]);
    for (const planned of PLANNED_PHASES) expect(IMPLEMENTED_PHASES as readonly string[]).not.toContain(planned);
  });

  it("boots, loads data and resolves a destination", () => {
    const booted = bootState();
    expect(booted.phase).toBe("boot");
    const loaded = withData(booted, data);
    expect(loaded.phase).toBe("resolvingDestination");
    const ready = withDeepLink(loaded, `?destination=${farmsId}`);
    expect(ready.phase).toBe("ready");
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.current.id).toBe(farmsId);
    expect(ready.notices).toEqual([]);
  });

  it("shows the hub without notices when no destination is requested", () => {
    const ready = readyState("");
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.current.id).toBe(hubId);
    expect(ready.notices).toEqual([]);
  });

  it("falls back to the hub with a non-fatal notice for an unknown destination", () => {
    const ready = readyState("?destination=dst_0000000000000000");
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.current.id).toBe(hubId);
    expect(ready.notices.map((n) => n.code)).toEqual(["unknown-destination"]);
  });

  it("does not enter a hidden destination", () => {
    const hidden: DestinationsFile = {
      ...data,
      destinations: data.destinations.map((d) => (d.id === farmsId ? { ...d, status: "hidden" as const } : d)),
    };
    const ready = withDeepLink(withData(bootState(), hidden), `?destination=${farmsId}`);
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.current.id).toBe(hubId);
    expect(ready.notices.map((n) => n.code)).toEqual(["destination-not-public"]);
  });

  it("never turns the return parameter into an arbitrary redirect", () => {
    const ready = readyState(`?destination=${farmsId}&return=${encodeURIComponent("https://evil.example/")}`);
    if (ready.phase !== "ready") throw new Error("unreachable");
    expect(ready.entry.returnUrl).toBeNull();
    expect(ready.notices.map((n) => n.code)).toEqual(["deep-link-issue"]);

    const safe = readyState(`?destination=${farmsId}&return=web`);
    if (safe.phase !== "ready") throw new Error("unreachable");
    expect(safe.entry.returnUrl).toBe("https://www.nrvnaverse.com/");
  });

  it("re-resolves from the ready phase on navigation", () => {
    const first = readyState(`?destination=${farmsId}`);
    const second = withDeepLink(first, `?destination=${hubId}&from=spatial`);
    if (second.phase !== "ready") throw new Error("unreachable");
    expect(second.current.id).toBe(hubId);
    expect(second.entry.from).toBe("spatial");
  });

  it("becomes an error when the data has no active hub", () => {
    const noHub: DestinationsFile = {
      ...data,
      destinations: data.destinations.map((d) => (d.id === hubId ? { ...d, status: "draft" as const } : d)),
    };
    const state = withData(bootState(), noHub);
    expect(state.phase).toBe("error");
  });
});

describe("planned spatial adapter", () => {
  it("reports that travel is unavailable instead of pretending", async () => {
    const adapter = new PlannedSpatialAdapter();
    expect(adapter.name).toBe("planned-spatial-adapter");
    expect(adapter.canTravel).toBe(false);
    expect(await adapter.resolvePlacement(farmsId)).toMatchObject({ status: "unavailable" });
    expect(await adapter.travelTo(farmsId)).toMatchObject({ status: "unavailable" });
  });
});
