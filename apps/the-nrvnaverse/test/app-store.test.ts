import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { appStore, bootApp, currentPortals, disposeApp, resetAppForTests, spatialDiagnostics, travelToDestination, type BootableRuntime } from "@/lib/app-store";
import type { AppState } from "@/lib/app-state";
import { StaticChunkDataSource, type StaticChunkEntry } from "@/lib/spatial/chunk-data-source";
import { StaticSpatialIndexSource } from "@/lib/spatial/spatial-index-source";
import cannabisJson from "../public/data/spatial/chunks/cannabis-21.json";
import fashionJson from "../public/data/spatial/chunks/fashion-culture.json";
import hubJson from "../public/data/spatial/chunks/hub.json";
import musicJson from "../public/data/spatial/chunks/music.json";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";
import { installFakeWindow, uninstallFakeWindow, type FakeWindow } from "./support/fake-window";

const APP_ROOT = join(__dirname, "..");
const data = destinationsJson as unknown as DestinationsFile;
const hubId = data.hubId;
const musicId = data.index.bySlug["music"];
const artistId = data.index.bySlug["placeholder-artist"];
const fashionId = data.index.bySlug["fashion-culture"];
const brandId = data.index.bySlug["placeholder-fashion-culture-brand"];
const cannabisId = data.index.bySlug["cannabis-21"];
const farmsId = data.index.bySlug["nrvna-farms-placeholder"];

const GENERATED: Record<string, StaticChunkEntry> = { hub: hubJson, music: musicJson, "fashion-culture": fashionJson, "cannabis-21": cannabisJson };

/** Fake engine runtime as the store boots it: records the scene it was initialised from. */
class FakeBootRuntime extends FakeChunkRuntime implements BootableRuntime {
  initOptions: { sceneUrl: string } | null = null;
  revealed = 0;
  disposed = 0;
  async init(options: { sceneUrl: string }) {
    this.initOptions = options;
  }
  async reveal() {
    this.revealed++;
    this.log.push("reveal");
  }
  dispose() {
    this.disposed++;
    this.isReady = false;
  }
}

let win: FakeWindow;
let runtime: FakeBootRuntime;
let chunkSource: StaticChunkDataSource;

async function boot(search: string, payloads: Record<string, StaticChunkEntry> = GENERATED) {
  win = installFakeWindow(search);
  runtime = new FakeBootRuntime();
  chunkSource = new StaticChunkDataSource(payloads);
  await bootApp({
    destinationSource: { load: async () => data },
    spatialIndexSource: new StaticSpatialIndexSource(spatialIndexJson),
    chunkSource,
    createRuntime: async () => runtime,
  });
  return appStore.state;
}

const requested = () => chunkSource.requests.map((r) => r.chunkKey);
const placed = (state: AppState) => ("current" in state ? state.current.id : null);

beforeEach(() => {
  resetAppForTests();
});
afterEach(() => {
  resetAppForTests();
  uninstallFakeWindow();
});

describe("app store — boot from the global scene with one selectively loaded chunk", () => {
  it("initialises the runtime from spatialIndex.globalSceneUrl, never from the compatibility full scene", async () => {
    await boot("");
    expect(runtime.initOptions).toEqual({ sceneUrl: spatialIndexJson.globalSceneUrl });
    expect(runtime.initOptions?.sceneUrl).toBe("/data/spatial/global-scene.json");
    expect(runtime.initOptions?.sceneUrl).not.toContain("static-scene");
  });

  it("no runtime source references the compatibility static scene", () => {
    const srcFiles = (dir: string): string[] =>
      readdirSync(join(APP_ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? srcFiles(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
      );
    for (const file of srcFiles("src")) {
      const text = readFileSync(join(APP_ROOT, file), "utf8");
      expect(text, file).not.toMatch(/["'`]\/data\/static-scene\.json["'`]/);
      expect(text, file).not.toMatch(/["'`]\/data\/spatial\/chunks\//); // chunk urls come from the index only
    }
  });

  it("Hub direct load: requests the Hub chunk only, places, reveals, ready", async () => {
    const state = await boot("");
    expect(state.phase).toBe("ready");
    expect(placed(state)).toBe(hubId);
    expect(requested()).toEqual(["hub"]);
    expect(runtime.revealed).toBe(1);
    expect(runtime.placed).toEqual([spatialIndexJson.destinations[hubId].spawn]);
    expect(spatialDiagnostics.state.activeChunkKey).toBe("hub");
  });

  it("Music deep link: loads Music only (never Hub first)", async () => {
    const state = await boot(`?destination=${musicId}`);
    expect(state.phase).toBe("ready");
    expect(placed(state)).toBe(musicId);
    expect(requested()).toEqual(["music"]);
    expect(runtime.world.has("platform-hub")).toBe(false);
  });

  it("Artist deep link: loads Music only and spawns at the Artist", async () => {
    const state = await boot(`?destination=${artistId}`);
    expect(placed(state)).toBe(artistId);
    expect(requested()).toEqual(["music"]);
    expect(runtime.placed).toEqual([spatialIndexJson.destinations[artistId].spawn]);
  });

  it("Fashion and Brand deep links: load fashion-culture only", async () => {
    expect(placed(await boot(`?destination=${fashionId}`))).toBe(fashionId);
    expect(requested()).toEqual(["fashion-culture"]);
    resetAppForTests();
    expect(placed(await boot(`?destination=${brandId}`))).toBe(brandId);
    expect(requested()).toEqual(["fashion-culture"]);
  });

  it("unknown destination: existing resolution fallback → Hub chunk", async () => {
    const state = await boot("?destination=dst_0000000000000000");
    expect(placed(state)).toBe(hubId);
    expect(requested()).toEqual(["hub"]);
    expect(state.notices.map((n) => n.code)).toEqual(["unknown-destination"]);
  });

  it("gated deep links: NO cannabis fetch, Hub chunk as fallback, app stays gateRequired for the requested destination", async () => {
    for (const gated of [cannabisId, farmsId]) {
      resetAppForTests();
      const state = await boot(`?destination=${gated}`);
      expect(state.phase).toBe("gateRequired");
      if (state.phase !== "gateRequired") throw new Error("unreachable");
      expect(state.gate).toEqual({ destinationId: gated, gates: ["age21"] });
      expect(state.current.id).toBe(hubId);
      expect(requested()).toEqual(["hub"]);
      expect(runtime.world.has("platform-cannabis-21")).toBe(false);
      expect(win.location.search).toBe(`?destination=${gated}`); // never rewritten
      expect(runtime.revealed).toBe(1);
    }
  });

  it("enters the error state (and does not reveal) when the requested chunk and the Hub fallback both fail", async () => {
    const state = await boot(`?destination=${musicId}`, { "fashion-culture": fashionJson });
    expect(state.phase).toBe("error");
    if (state.phase !== "error") throw new Error("unreachable");
    expect(state.message).toMatch(/404/);
    expect(runtime.revealed).toBe(0);
    expect(requested()).toEqual(["music", "hub"]);
  });

  it("falls back to the Hub with a notice when only the requested chunk fails", async () => {
    const state = await boot(`?destination=${musicId}`, { hub: hubJson });
    expect(state.phase).toBe("ready");
    expect(placed(state)).toBe(hubId);
    expect(state.notices.map((n) => n.code)).toEqual(["travel-failed"]);
    expect(requested()).toEqual(["music", "hub"]);
  });
});

describe("app store — travel, URL and latest-request-wins", () => {
  it("Hub → Music fetches Music, arrives, retires Hub, then writes the destination URL", async () => {
    await boot("");
    await travelToDestination(musicId);
    const state = appStore.state;
    expect(state.phase).toBe("arrived");
    expect(placed(state)).toBe(musicId);
    expect(requested()).toEqual(["hub", "music"]);
    expect(runtime.world.has("platform-hub")).toBe(false);
    expect(runtime.world.has("platform-music")).toBe(true);
    expect(win.location.search).toBe(`?destination=${musicId}&from=spatial`);
    expect(win.history.entries).toHaveLength(2);
    expect(spatialDiagnostics.state.activeChunkKey).toBe("music");
  });

  it("passes through loadingChunk for cross-chunk travel and not for same-chunk travel", async () => {
    await boot("");
    const phases: string[] = [];
    const off = appStore.subscribe(() => phases.push(appStore.state.phase));
    await travelToDestination(musicId);
    expect(phases).toEqual(["traveling", "loadingChunk", "arrived", "arrived"]); // last: entry re-resolved after the URL write
    phases.length = 0;
    await travelToDestination(artistId);
    expect(phases).toEqual(["traveling", "arrived", "arrived"]);
    expect(requested()).toEqual(["hub", "music"]);
    off();
  });

  it("Fashion → Cannabis: gateRequired, no cannabis request, Fashion stays valid, URL unchanged", async () => {
    await boot(`?destination=${fashionId}`);
    await travelToDestination(cannabisId);
    const state = appStore.state;
    expect(state.phase).toBe("gateRequired");
    expect(placed(state)).toBe(fashionId);
    expect(requested()).toEqual(["fashion-culture"]);
    expect(runtime.world.has("platform-fashion-culture")).toBe(true);
    expect(win.location.search).toBe(`?destination=${fashionId}`);
  });

  it("a failed cross-chunk travel keeps the current destination usable and writes no URL", async () => {
    await boot("", { hub: hubJson, "fashion-culture": fashionJson });
    await travelToDestination(musicId);
    const state = appStore.state;
    expect(state.phase).toBe("ready");
    expect(placed(state)).toBe(hubId);
    expect(state.notices.map((n) => n.code)).toEqual(["travel-failed"]);
    expect(runtime.world.has("platform-hub")).toBe(true);
    expect(win.location.search).toBe("");
    await travelToDestination(fashionId);
    expect(placed(appStore.state)).toBe(fashionId);
  });

  it("rapid A → B → C: the latest destination wins; stale results never touch state or URL", async () => {
    await boot("");
    runtime.createDelayMs = 1;
    const a = travelToDestination(musicId);
    const b = travelToDestination(fashionId);
    const c = travelToDestination(brandId);
    // Cross-chunk work for C started synchronously: the state already reports loadingChunk for C, at the Hub.
    expect(appStore.state).toMatchObject({ phase: "loadingChunk", stage: "travel", target: { id: brandId }, current: { id: hubId } });
    await Promise.all([a, b, c]);
    const state = appStore.state;
    expect(state.phase).toBe("arrived");
    expect(placed(state)).toBe(brandId);
    expect(win.location.search).toBe(`?destination=${brandId}&from=spatial`);
    expect(win.history.entries).toHaveLength(2); // exactly one URL write
    expect(runtime.placed).toHaveLength(2); // boot + the winning travel
    expect(runtime.world.has("platform-fashion-culture")).toBe(true);
    expect(runtime.world.has("platform-music")).toBe(false);
    expect(runtime.batches.size).toBe(1);
    expect(spatialDiagnostics.state.activeChunkKey).toBe("fashion-culture");
  });

  it("a superseded request that resolves late cannot overwrite a newer arrival", async () => {
    await boot("");
    runtime.holdStage = true;
    const a = travelToDestination(musicId);
    await flush();
    runtime.holdStage = false;
    const b = travelToDestination(fashionId);
    await flush();
    runtime.releaseStage();
    await Promise.all([a, b]);
    expect(placed(appStore.state)).toBe(fashionId);
    expect(win.location.search).toBe(`?destination=${fashionId}&from=spatial`);
    expect(win.history.entries).toHaveLength(2);
  });

  it("browser back/forward travels through the same safe chunk path without adding history", async () => {
    await boot("");
    await travelToDestination(musicId);
    await travelToDestination(fashionId);
    expect(win.history.entries).toHaveLength(3);
    win.navigate(`?destination=${musicId}&from=spatial`); // back
    await flush(5);
    expect(placed(appStore.state)).toBe(musicId);
    expect(requested()).toEqual(["hub", "music", "fashion-culture", "music"]);
    expect(runtime.world.has("platform-fashion-culture")).toBe(false);
    expect(win.history.entries).toHaveLength(3);

    win.navigate(`?destination=${cannabisId}`); // a gated destination in history: refused, nothing fetched
    await flush(5);
    expect(appStore.state.phase).toBe("gateRequired");
    expect(placed(appStore.state)).toBe(musicId);
    expect(requested()).toEqual(["hub", "music", "fashion-culture", "music"]);
  });

  it("rapid back/forward obeys latest-request-wins", async () => {
    await boot("");
    await travelToDestination(musicId);
    await travelToDestination(fashionId);
    runtime.createDelayMs = 1;
    win.navigate(`?destination=${musicId}&from=spatial`);
    win.navigate(`?destination=${hubId}&from=spatial`);
    win.navigate(`?destination=${fashionId}&from=spatial`);
    await flush(20);
    expect(placed(appStore.state)).toBe(fashionId);
    expect(appStore.state.phase).toBe("arrived");
    expect(runtime.batches.size).toBe(1);
    expect(spatialDiagnostics.state.activeChunkKey).toBe("fashion-culture");
  });

  it("never writes a chunk key or coordinate to the URL", async () => {
    await boot("");
    for (const id of [musicId, artistId, fashionId, brandId, hubId]) {
      await travelToDestination(id);
      expect(win.location.search).not.toMatch(/chunk|spawn|position|[?&][xyz]=/i);
    }
    expect(win.history.entries.join(" ")).not.toMatch(/chunk/);
  });
});

describe("app store — disposal", () => {
  it("aborts pending chunk work, retires the active chunk, unsubscribes and destroys the runtime", async () => {
    await boot("");
    runtime.holdStage = true;
    const pending = travelToDestination(musicId);
    await flush();
    expect(win.listenerCount("popstate")).toBe(1);
    disposeApp();
    expect(win.listenerCount("popstate")).toBe(0);
    expect(runtime.disposed).toBe(1);
    expect(runtime.world.size).toBe(0);
    expect(appStore.state.phase).toBe("boot");
    runtime.holdStage = false;
    runtime.releaseStage();
    await pending;
    expect(appStore.state.phase).toBe("boot"); // the late result changed nothing
    expect(runtime.world.size).toBe(0);
    expect(runtime.batches.size).toBe(0);
    expect(spatialDiagnostics.state.activeChunkKey).toBeNull();
  });
});

/**
 * M0 Step 2B.3 — physical portals drive the SAME `travelToDestination` path as the directory:
 * the fake runtime simulates the player entering a staged sensor component; everything after
 * that (adapter, gate, orchestrator, state, URL) is the unchanged travel machinery.
 */
describe("app store — physical portals use the existing travel path", () => {
  const enter = async (componentId: string) => {
    runtime.enterSensor(componentId);
    await flush(); // the controller defers the request to a microtask; travel then settles through the usual awaits
    await flush();
  };
  const bound = () => spatialDiagnostics.state.boundPortals;

  it("binds the Hub portals after the initial placement and before reveal", async () => {
    const state = await boot("");
    expect(state.phase).toBe("ready");
    expect(bound()).toBe(3);
    expect(currentPortals()?.boundComponentIds).toEqual(["portal-hub-cannabis", "portal-hub-fashion", "portal-hub-music"]);
    const sensorOn = runtime.log.map((e, i) => (e.startsWith("sensor-on:") ? i : -1)).filter((i) => i >= 0);
    expect(sensorOn).toHaveLength(3);
    expect(runtime.log.indexOf("reveal")).toBeGreaterThan(Math.max(...sensorOn)); // committed → portals bound → reveal
    expect(runtime.revealed).toBe(1);
    expect(spatialDiagnostics.state.lastPortal).toBeNull();
  });

  it("Hub → Music portal: cross-chunk arrival, Hub retired, Music portals bound, URL names Music", async () => {
    await boot("");
    await enter("portal-hub-music");
    const state = appStore.state;
    expect(state.phase).toBe("arrived");
    expect(placed(state)).toBe(musicId);
    expect(requested()).toEqual(["hub", "music"]);
    expect(runtime.world.has("platform-hub")).toBe(false);
    expect(runtime.world.has("portal-hub-music")).toBe(false);
    expect(runtime.world.has("portal-music-hub")).toBe(true);
    expect(win.location.search).toBe(`?destination=${musicId}&from=spatial`);
    expect(win.history.entries).toHaveLength(2);
    expect(spatialDiagnostics.state.activeChunkKey).toBe("music");
    expect(currentPortals()?.boundComponentIds).toEqual(["portal-music-artist", "portal-music-hub"]);
    expect(spatialDiagnostics.state.lastPortal).toEqual({ componentId: "portal-hub-music", destinationId: musicId });
    // Portal travel produced exactly the directory's state: the same arrival shape, no portal-specific fields.
    if (state.phase !== "arrived") throw new Error("unreachable");
    expect(state.arrival.destinationId).toBe(musicId);
  });

  it("Music → Artist portal: same-chunk arrival, no second music fetch, sensors not rebound, URL names the Artist", async () => {
    await boot(`?destination=${musicId}`);
    const onCount = runtime.log.filter((e) => e.startsWith("sensor-on:")).length;
    await enter("portal-music-artist");
    const state = appStore.state;
    expect(state.phase).toBe("arrived");
    expect(placed(state)).toBe(artistId);
    expect(requested()).toEqual(["music"]);
    expect(runtime.placed.at(-1)).toEqual(spatialIndexJson.destinations[artistId].spawn);
    expect(runtime.log.filter((e) => e.startsWith("sensor-on:")).length).toBe(onCount); // no rebind
    expect(runtime.log.filter((e) => e.startsWith("sensor-off:"))).toEqual([]);
    expect(win.location.search).toBe(`?destination=${artistId}&from=spatial`);
    expect(bound()).toBe(2);
  });

  it("Music → Hub portal: cross-chunk arrival back at the Hub", async () => {
    await boot(`?destination=${musicId}`);
    await enter("portal-music-hub");
    expect(placed(appStore.state)).toBe(hubId);
    expect(appStore.state.phase).toBe("arrived");
    expect(requested()).toEqual(["music", "hub"]);
    expect(runtime.world.has("platform-music")).toBe(false);
    expect(win.location.search).toBe(`?destination=${hubId}&from=spatial`);
    expect(currentPortals()?.boundComponentIds).toEqual(["portal-hub-cannabis", "portal-hub-fashion", "portal-hub-music"]);
  });

  it("Hub → Fashion, Fashion → Brand (same chunk), Fashion → Hub portals", async () => {
    await boot("");
    await enter("portal-hub-fashion");
    expect(placed(appStore.state)).toBe(fashionId);
    expect(requested()).toEqual(["hub", "fashion-culture"]);
    expect(currentPortals()?.boundComponentIds).toEqual(["portal-fashion-brand", "portal-fashion-hub"]);

    await enter("portal-fashion-brand");
    expect(placed(appStore.state)).toBe(brandId);
    expect(requested()).toEqual(["hub", "fashion-culture"]); // no refetch, no rebuild
    expect(runtime.world.has("platform-fashion-culture")).toBe(true);
    expect(win.location.search).toBe(`?destination=${brandId}&from=spatial`);

    await enter("portal-fashion-hub");
    expect(placed(appStore.state)).toBe(hubId);
    expect(requested()).toEqual(["hub", "fashion-culture", "hub"]);
    expect(runtime.world.has("platform-fashion-culture")).toBe(false);
    expect(win.location.search).toBe(`?destination=${hubId}&from=spatial`);
    expect(win.history.entries).toEqual(["", `?destination=${fashionId}&from=spatial`, `?destination=${brandId}&from=spatial`, `?destination=${hubId}&from=spatial`]);
  });

  it("Hub → Cannabis portal: gateRequired, NO cannabis request, visitor stays in the Hub, URL untouched, portals stay bound", async () => {
    await boot("");
    await enter("portal-hub-cannabis");
    const state = appStore.state;
    expect(state.phase).toBe("gateRequired");
    if (state.phase !== "gateRequired") throw new Error("unreachable");
    expect(state.gate).toEqual({ destinationId: cannabisId, gates: ["age21"] });
    expect(state.current.id).toBe(hubId);
    expect(requested()).toEqual(["hub"]);
    expect(runtime.world.has("platform-cannabis-21")).toBe(false);
    expect(runtime.placed).toHaveLength(1); // only the initial placement — no teleport
    expect(win.location.search).toBe("");
    expect(win.history.entries).toEqual([""]);
    expect(spatialDiagnostics.state.activeChunkKey).toBe("hub");
    expect(bound()).toBe(3);
    expect(spatialDiagnostics.state.lastPortal).toEqual({ componentId: "portal-hub-cannabis", destinationId: cannabisId });
  });

  it("after a gated refusal the app remains usable: another portal still travels, and the gated portal can be re-entered", async () => {
    await boot("");
    await enter("portal-hub-cannabis");
    expect(appStore.state.phase).toBe("gateRequired");
    await enter("portal-hub-cannabis"); // walked out and back in: one more request, same refusal
    expect(appStore.state.phase).toBe("gateRequired");
    expect(requested()).toEqual(["hub"]);
    await enter("portal-hub-music");
    expect(appStore.state.phase).toBe("arrived");
    expect(placed(appStore.state)).toBe(musicId);
    expect(requested()).toEqual(["hub", "music"]);
    expect(win.location.search).toBe(`?destination=${musicId}&from=spatial`);
  });

  it("gated initial deep link: Hub fallback binds the Hub portals while the app stays gateRequired", async () => {
    const state = await boot(`?destination=${cannabisId}`);
    expect(state.phase).toBe("gateRequired");
    expect(bound()).toBe(3);
    expect(currentPortals()?.activeChunkKey).toBe("hub");
    await enter("portal-hub-fashion");
    expect(placed(appStore.state)).toBe(fashionId);
    expect(requested()).toEqual(["hub", "fashion-culture"]);
  });

  it("directory navigation and browser history keep working after portal travel, and portals follow them", async () => {
    await boot("");
    await enter("portal-hub-music");
    await travelToDestination(fashionId); // directory click
    expect(placed(appStore.state)).toBe(fashionId);
    expect(currentPortals()?.boundComponentIds).toEqual(["portal-fashion-brand", "portal-fashion-hub"]);
    win.navigate(`?destination=${musicId}&from=spatial`); // back
    await flush();
    await flush();
    expect(placed(appStore.state)).toBe(musicId);
    expect(currentPortals()?.boundComponentIds).toEqual(["portal-music-artist", "portal-music-hub"]);
    await enter("portal-music-artist");
    expect(placed(appStore.state)).toBe(artistId);
  });

  it("a portal entry during an in-flight cross-chunk travel supersedes it through the existing mechanism", async () => {
    await boot(`?destination=${musicId}`);
    runtime.holdStage = true;
    const pending = travelToDestination(fashionId); // directory click, staging held
    await flush();
    runtime.enterSensor("portal-music-hub"); // the visitor is still in Music: its portals are still bound
    await flush();
    runtime.holdStage = false;
    runtime.releaseStage();
    await pending;
    await flush(5);
    expect(placed(appStore.state)).toBe(hubId);
    expect(runtime.world.has("platform-fashion-culture")).toBe(false);
    expect(runtime.batches.size).toBe(1);
    expect(win.location.search).toBe(`?destination=${hubId}&from=spatial`);
  });

  it("failed portal travel keeps the current destination and its portal bindings", async () => {
    await boot("", { hub: hubJson, "fashion-culture": fashionJson }); // no music payload → 404
    await enter("portal-hub-music");
    expect(appStore.state.phase).toBe("ready");
    expect(placed(appStore.state)).toBe(hubId);
    expect(appStore.state.notices.map((n) => n.code)).toEqual(["travel-failed"]);
    expect(bound()).toBe(3);
    await enter("portal-hub-fashion");
    expect(placed(appStore.state)).toBe(fashionId);
  });

  it("never writes a portal, chunk or component id to the URL", async () => {
    await boot("");
    await enter("portal-hub-music");
    await enter("portal-music-artist");
    await enter("portal-music-hub");
    await enter("portal-hub-cannabis");
    for (const entry of win.history.entries) {
      expect(entry).not.toMatch(/portal|chunk|component|position|[?&]x=/);
      if (entry) expect(entry).toMatch(/^\?destination=dst_[0-9abcdefghjkmnpqrstvwxyz]{16}&from=spatial$/);
    }
  });

  it("disposal releases portal subscriptions before the runtime is destroyed", async () => {
    await boot("");
    const portals = currentPortals()!;
    disposeApp();
    expect(portals.boundPortalCount).toBe(0);
    expect(runtime.sensorListeners.size).toBe(0);
    expect(currentPortals()).toBeNull();
    expect(spatialDiagnostics.state.boundPortals).toBe(0);
    // Order: sensor-off entries precede the retire of the active chunk (portal controller disposed first).
    const lastOff = runtime.log.map((e, i) => (e.startsWith("sensor-off:") ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
    expect(lastOff).toBeGreaterThanOrEqual(0);
    expect(runtime.log.indexOf("retire:hub")).toBeGreaterThan(lastOff);
  });
});
