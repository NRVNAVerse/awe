import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { appStore, bootApp, currentExperience, disposeApp, resetAppForTests, spatialDiagnostics, travelToDestination, type BootableRuntime } from "@/lib/app-store";
import { StaticChunkDataSource, type StaticChunkEntry } from "@/lib/spatial/chunk-data-source";
import { StaticSpatialIndexSource } from "@/lib/spatial/spatial-index-source";
import { cannabisJson, fashionJson, hubJson, musicJson, spatialIndexJson } from "./support/generated-spatial";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";
import { installFakeWindow, uninstallFakeWindow, type FakeWindow } from "./support/fake-window";

/**
 * Experience wiring in the store (M1 experience campaign): the controller is installed before the
 * first chunk is staged, follows every committed arrival (zones re-bound on a chunk switch, beats
 * played with the previous chunk as the "from" context) and is disposed before the orchestrator.
 * Travel, gates and the URL are untouched by any of it.
 */

const data = destinationsJson as unknown as DestinationsFile;
const hubId = data.hubId;
const musicId = data.index.bySlug["music"];
const artistId = data.index.bySlug["placeholder-artist"];
const fashionId = data.index.bySlug["fashion-culture"];
const cannabisId = data.index.bySlug["cannabis-21"];
const GENERATED: Record<string, StaticChunkEntry> = { hub: hubJson, music: musicJson, "fashion-culture": fashionJson, "cannabis-21": cannabisJson };

class FakeBootRuntime extends FakeChunkRuntime implements BootableRuntime {
  revealed = 0;
  async init() {}
  async reveal() {
    this.revealed++;
    this.log.push("reveal");
  }
  async dispose() {
    this.isReady = false;
    this.log.push("dispose");
  }
}

let win: FakeWindow;
let runtime: FakeBootRuntime;

async function boot(search: string) {
  win = installFakeWindow(search);
  runtime = new FakeBootRuntime();
  await bootApp({
    destinationSource: { load: async () => data },
    spatialIndexSource: new StaticSpatialIndexSource(spatialIndexJson),
    chunkSource: new StaticChunkDataSource(GENERATED),
    createRuntime: async () => runtime,
  });
  return appStore.state;
}

beforeEach(async () => {
  await resetAppForTests();
});
afterEach(async () => {
  await resetAppForTests();
  uninstallFakeWindow();
});

describe("experience wiring — boot", () => {
  it("declares the hidden sets before the first chunk is staged, so the Hub stages with its state-B geometry already hidden", async () => {
    const state = await boot("");
    expect(state.phase).toBe("ready");
    expect(runtime.hiddenOnStage.get("hub")).toEqual(spatialIndexJson.experience.hidden.hub);
    expect(runtime.visibleOf("hub-spire-ring-1-lit")).toBe(false);
    expect(runtime.visibleOf("hub-spire-ring-1")).toBe(true);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(false);
    // Hidden before the visitor is placed, and both before reveal.
    const firstHide = runtime.log.findIndex((e) => e.startsWith("hide-on-stage:"));
    const place = runtime.log.findIndex((e) => e.startsWith("place:"));
    expect(firstHide).toBeGreaterThan(-1);
    expect(firstHide).toBeLessThan(place);
    expect(runtime.log.indexOf("reveal")).toBeGreaterThan(place);
  });

  it("binds the Hub zones after the initial placement and schedules the Hub wake (no return glow on an initial placement)", async () => {
    await boot("");
    const experience = currentExperience()!;
    expect(experience.boundZoneIds).toEqual(["hub-core", "hub-overlook"]);
    expect(spatialDiagnostics.state.boundZones).toBe(2);
    expect(experience.pendingBeatCount).toBe(3);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(false);
    runtime.advance(2.5);
    expect(runtime.visibleOf("hub-spire-ring-3-lit")).toBe(true);
    expect(spatialDiagnostics.state.lastExperience).toEqual({ kind: "arrival", id: "hub-wake#2" });
  });

  it("a gated initial deep link (Hub fallback) still binds the Hub zones; no cannabis chunk and no cannabis effects", async () => {
    const state = await boot(`?destination=${cannabisId}`);
    expect(state.phase).toBe("gateRequired");
    expect(currentExperience()?.boundZoneIds).toEqual(["hub-core", "hub-overlook"]);
    expect(runtime.world.has("platform-hub")).toBe(true);
    expect(spatialIndexJson.experience.hidden["cannabis-21"]).toBeUndefined();
  });
});

describe("experience wiring — travel", () => {
  it("Hub → Music: Music zones bound, Hub zones released with the retired chunk, the Music floor reset applies, URL unchanged by any effect", async () => {
    await boot("");
    await travelToDestination(musicId);
    const experience = currentExperience()!;
    expect(experience.boundZoneIds).toEqual(["music-booth", "music-walk-north", "music-walk-south"]);
    expect(runtime.sensorListenerCount("hub-zone-overlook")).toBe(0);
    expect(runtime.visibleOf("music-stack-1-band-lit")).toBe(false);
    expect(runtime.visibleOf("music-fin-3-blade")).toBe(false);
    expect(spatialDiagnostics.state.lastExperience).toEqual({ kind: "arrival", id: "music-floor-reset#0" });
    expect(win.location.search).toBe(`?destination=${musicId}&from=spatial`);
  });

  it("walking the processional path lights the stacks; same-chunk travel to the Artist plays the crescendo without rebinding", async () => {
    await boot("");
    await travelToDestination(musicId);
    const experience = currentExperience()!;
    const epoch = experience.bindingEpoch;
    runtime.enterSensor("music-zone-walk-south");
    await flush();
    expect(runtime.visibleOf("music-stack-1-band-lit")).toBe(true);
    expect(runtime.visibleOf("music-stack-1-band")).toBe(false);

    await travelToDestination(artistId);
    expect(experience.bindingEpoch).toBe(epoch); // same chunk → zones kept
    expect(experience.pendingBeatCount).toBe(4);
    runtime.advance(1.6);
    expect(runtime.visibleOf("music-fin-3-blade")).toBe(true);
    expect(runtime.visibleOf("music-stage-wash")).toBe(true);
    expect(runtime.visibleOf("music-stack-1-band-lit")).toBe(true); // the soundcheck trail stays lit
    expect(win.location.search).toBe(`?destination=${artistId}&from=spatial`);
  });

  it("Music → Hub: the Music gateway return glow shows at once (from chunk music), settles after 6 s; the spire wakes again on the fresh Hub chunk", async () => {
    await boot("");
    await travelToDestination(musicId);
    await travelToDestination(hubId);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(true);
    expect(runtime.visibleOf("hub-return-fashion-glow")).toBe(false);
    expect(runtime.visibleOf("hub-spire-ring-1-lit")).toBe(false); // fresh chunk: hidden on stage again
    runtime.advance(6);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(false);
    expect(runtime.visibleOf("hub-spire-ring-3-lit")).toBe(true);
    expect(currentExperience()?.pendingBeatCount).toBe(0);
  });

  it("Fashion → Hub lights the Fashion gateway instead", async () => {
    await boot("");
    await travelToDestination(fashionId);
    expect(currentExperience()?.boundZoneIds).toHaveLength(6);
    await travelToDestination(hubId);
    expect(runtime.visibleOf("hub-return-fashion-glow")).toBe(true);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(false);
  });

  it("a gated refusal (Hub → Cannabis) changes nothing: zones stay bound, no beat, no cannabis fetch", async () => {
    await boot("");
    runtime.advance(3); // wake done
    const experience = currentExperience()!;
    const triggers = experience.triggerCount;
    await travelToDestination(cannabisId);
    expect(appStore.state.phase).toBe("gateRequired");
    expect(experience.boundZoneIds).toEqual(["hub-core", "hub-overlook"]);
    expect(experience.pendingBeatCount).toBe(0);
    expect(experience.triggerCount).toBe(triggers);
    expect(runtime.world.has("platform-hub")).toBe(true);
  });
});

describe("experience wiring — teardown", () => {
  it("dispose cancels pending beats, releases zone subscriptions before the runtime is destroyed, and clears diagnostics", async () => {
    await boot("");
    const experience = currentExperience()!;
    runtime.enterSensor("hub-zone-core");
    expect(experience.pendingBeatCount).toBe(3);
    await disposeApp();
    expect(experience.pendingBeatCount).toBe(0);
    expect(experience.boundZoneIds).toEqual([]);
    expect(runtime.pendingTimerCount).toBe(0);
    const lastZoneOff = runtime.log.map((e, i) => (e.startsWith("sensor-off:hub-zone") || e.startsWith("sensor-exit-off:hub-zone") ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
    expect(lastZoneOff).toBeGreaterThan(-1);
    expect(lastZoneOff).toBeLessThan(runtime.log.indexOf("dispose"));
    expect(currentExperience()).toBeNull();
    expect(spatialDiagnostics.state).toMatchObject({ boundZones: 0, lastExperience: null });
  });
});
