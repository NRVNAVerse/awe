import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { appStore, bootApp, currentDiscovery, currentExperience, resetAppForTests, spatialDiagnostics, travelToDestination, type BootableRuntime } from "@/lib/app-store";
import { DISCOVERY_M1, DISCOVERY_STORAGE_KEY, DiscoveryMemory, parsePersisted, serializePersisted, type DiscoveryStorage } from "@/lib/discovery/discovery-memory";
import type { ExperienceEffect } from "@/lib/spatial/spatial-index";
import { parseSpatialIndex } from "@/lib/spatial/spatial-index";
import { StaticChunkDataSource, type StaticChunkEntry } from "@/lib/spatial/chunk-data-source";
import { StaticSpatialIndexSource } from "@/lib/spatial/spatial-index-source";
import { cannabisJson, fashionJson, generatedChunks, hubJson, musicJson, spatialIndexJson } from "./support/generated-spatial";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";
import { installFakeWindow, uninstallFakeWindow, type FakeWindow } from "./support/fake-window";

/**
 * Discovery memory (M1 experience campaign): finding a hidden place's sigil is remembered in the
 * visitor's browser and the world answers on later arrivals (lit sigils, the Hub's dormant frames).
 * Visibility effects only, through the experience controller; no HUD, no gate, no URL.
 */

const data = destinationsJson as unknown as DestinationsFile;
const hubId = data.hubId;
const musicId = data.index.bySlug["music"];
const index = parseSpatialIndex(spatialIndexJson);

class MemoryStorage implements DiscoveryStorage {
  readonly map = new Map<string, string>();
  failing = false;
  getItem(key: string) {
    if (this.failing) throw new Error("storage blocked");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failing) throw new Error("storage blocked");
    this.map.set(key, value);
  }
}

describe("discovery memory — configuration is grounded in the generated world", () => {
  it("every sigil zone exists in the index, every effect id is a hidden state-B component (or its dim twin) of the right chunk", () => {
    for (const sigil of DISCOVERY_M1.sigils) {
      const zone = index.experience.zones[sigil.zoneId];
      expect(zone, sigil.key).toBeDefined();
      expect(zone.chunkKey).toBe(sigil.chunkKey);
      const chunk = generatedChunks[sigil.chunkKey].components;
      for (const id of sigil.remembered.show ?? []) {
        expect(chunk[id], id).toBeDefined();
        expect(index.experience.hidden[sigil.chunkKey]).toContain(id);
      }
      for (const id of sigil.remembered.hide ?? []) expect(chunk[id], id).toBeDefined();
    }
    for (const rule of DISCOVERY_M1.memory) {
      for (const id of [...(rule.effect.show ?? []), ...(rule.effect.hide ?? [])]) {
        expect(generatedChunks[rule.chunkKey].components[id], id).toBeDefined();
        if (rule.effect.show?.includes(id)) expect(index.experience.hidden[rule.chunkKey]).toContain(id);
      }
    }
    expect(DISCOVERY_M1.sigils.map((s) => s.key)).toEqual(["centre", "booth", "atelier", "rooftop"]);
    expect(DISCOVERY_M1.memory.map((r) => r.atLeast)).toEqual([1, 2, 3, 4]);
  });

  it("persisted shape is tiny, stable and tolerant", () => {
    expect(serializePersisted(["booth", "centre"])).toBe('{"v":1,"found":["booth","centre"]}');
    expect(parsePersisted(serializePersisted(["centre", "booth", "centre"]))).toEqual(["booth", "centre"]);
    expect(parsePersisted(null)).toEqual([]);
    expect(parsePersisted("not json")).toEqual([]);
    expect(parsePersisted('{"v":2,"found":["centre"]}')).toEqual([]);
    expect(parsePersisted('{"v":1,"found":["centre", 42, "../x", "ok-key"]}')).toEqual(["centre", "ok-key"]);
  });
});

describe("discovery memory — finds, answers and storage", () => {
  function setup(storage: DiscoveryStorage | null = new MemoryStorage()) {
    const applied: Array<{ label: string; effect: ExperienceEffect }> = [];
    const found: string[] = [];
    const memory = new DiscoveryMemory({ storage, applyEffect: (effect, label) => applied.push({ label, effect }), onFound: (k) => found.push(k), warn: () => {} });
    return { memory, applied, found, storage };
  }

  it("a zone enter of a sigil's place is a find: persisted, lit at once, the Hub answers on the next arrival", () => {
    const { memory, applied, found, storage } = setup();
    memory.onArrival("hub");
    expect(applied).toEqual([]); // nothing remembered yet
    memory.onTrigger({ kind: "zone-enter", id: "hub-core" });
    expect(found).toEqual(["centre"]);
    expect(memory.remembered).toEqual(["centre"]);
    expect(applied.map((a) => a.label)).toEqual(["sigil:centre", "memory:hub:1"]);
    expect(applied[0].effect).toEqual({ show: ["hub-core-sigil-lit"], hide: ["hub-core-sigil"] });
    expect((storage as MemoryStorage).map.get(DISCOVERY_STORAGE_KEY)).toBe('{"v":1,"found":["centre"]}');
    memory.onTrigger({ kind: "zone-enter", id: "hub-core" }); // again: no second find
    expect(found).toEqual(["centre"]);
    memory.onTrigger({ kind: "zone-exit", id: "hub-core" });
    memory.onTrigger({ kind: "zone-enter", id: "hub-overlook" }); // not a sigil place
    expect(memory.remembered).toEqual(["centre"]);
  });

  it("a find in another chunk lights the sigil there and the Hub frames on the next Hub arrival; all three reveal the inscription", () => {
    const { memory, applied } = setup();
    memory.onArrival("music");
    memory.onTrigger({ kind: "zone-enter", id: "music-booth" });
    expect(applied.map((a) => a.label)).toEqual(["sigil:booth"]); // no Hub rule applies in Music
    applied.length = 0;
    memory.onArrival("hub");
    expect(applied.map((a) => a.label)).toEqual(["memory:hub:1"]);
    applied.length = 0;
    memory.onTrigger({ kind: "zone-enter", id: "hub-core" });
    expect(applied.map((a) => a.label)).toEqual(["sigil:centre", "memory:hub:1", "memory:hub:2"]);
    applied.length = 0;
    memory.onArrival("fashion-culture");
    memory.onTrigger({ kind: "zone-enter", id: "fashion-atelier" });
    expect(memory.remembered).toEqual(["atelier", "booth", "centre"]);
    applied.length = 0;
    memory.onArrival("hub");
    expect(applied.map((a) => a.label)).toEqual(["sigil:centre", "memory:hub:1", "memory:hub:2", "memory:hub:3"]);
    expect(applied.at(-1)?.effect).toEqual({ show: ["hub-memory-line"] });
  });

  it("a later visit reads the memory back from storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(DISCOVERY_STORAGE_KEY, serializePersisted(["booth", "centre"]));
    const { memory, applied } = setup(storage);
    expect(memory.remembered).toEqual(["booth", "centre"]);
    memory.onArrival("hub");
    expect(applied.map((a) => a.label)).toEqual(["sigil:centre", "memory:hub:1", "memory:hub:2"]);
  });

  it("blocked or absent storage degrades to this-visit memory without throwing", () => {
    const blocked = new MemoryStorage();
    blocked.failing = true;
    const { memory } = setup(blocked);
    memory.onArrival("hub");
    expect(() => memory.onTrigger({ kind: "zone-enter", id: "hub-core" })).not.toThrow();
    expect(memory.remembered).toEqual(["centre"]);
    const { memory: none } = setup(null);
    none.onTrigger({ kind: "zone-enter", id: "hub-core" });
    expect(none.remembered).toEqual(["centre"]);
  });
});

describe("discovery memory — store wiring", () => {
  const GENERATED: Record<string, StaticChunkEntry> = { hub: hubJson, music: musicJson, "fashion-culture": fashionJson, "cannabis-21": cannabisJson, "music-club": generatedChunks["music-club"] };
  class FakeBootRuntime extends FakeChunkRuntime implements BootableRuntime {
    async init() {}
    async reveal() {
      this.log.push("reveal");
    }
    async dispose() {
      this.isReady = false;
    }
  }
  let win: FakeWindow;
  let runtime: FakeBootRuntime;
  const storage = new MemoryStorage();
  async function boot(search: string) {
    win = installFakeWindow(search);
    runtime = new FakeBootRuntime();
    await bootApp({
      destinationSource: { load: async () => data },
      spatialIndexSource: new StaticSpatialIndexSource(spatialIndexJson),
      chunkSource: new StaticChunkDataSource(GENERATED),
      createRuntime: async () => runtime,
      discoveryStorage: storage,
    });
    return appStore.state;
  }
  beforeEach(async () => {
    storage.map.clear();
    await resetAppForTests();
  });
  afterEach(async () => {
    await resetAppForTests();
    uninstallFakeWindow();
  });

  it("entering the Core house lights its sigil and the first dormant frame; the memory survives a re-boot and a return to the Hub", async () => {
    await boot("");
    expect(runtime.visibleOf("hub-core-sigil-lit")).toBe(false);
    expect(runtime.visibleOf("hub-dormant-1-inset-lit")).toBe(false);
    runtime.enterSensor("hub-zone-core");
    await flush();
    expect(currentDiscovery()?.remembered).toEqual(["centre"]);
    expect(runtime.visibleOf("hub-core-sigil-lit")).toBe(true);
    expect(runtime.visibleOf("hub-core-sigil")).toBe(false);
    expect(runtime.visibleOf("hub-dormant-1-inset-lit")).toBe(true);
    expect(runtime.visibleOf("hub-dormant-2-inset-lit")).toBe(false);
    expect(spatialDiagnostics.state.remembered).toBe(1);
    expect(storage.map.get(DISCOVERY_STORAGE_KEY)).toBe('{"v":1,"found":["centre"]}');
    // Away and back: the fresh Hub chunk is staged hidden, then the memory lights it again.
    await travelToDestination(musicId);
    await travelToDestination(hubId);
    expect(runtime.visibleOf("hub-core-sigil-lit")).toBe(true);
    expect(runtime.visibleOf("hub-dormant-1-inset-lit")).toBe(true);
    // A new boot in the same browser remembers.
    await resetAppForTests();
    uninstallFakeWindow();
    await boot("");
    expect(currentDiscovery()?.remembered).toEqual(["centre"]);
    expect(runtime.visibleOf("hub-core-sigil-lit")).toBe(true);
    expect(currentExperience()?.lastTrigger?.id).toBe("memory:hub:1");
    expect(win.history.entries).toEqual([""]); // nothing here touches the URL
  });
});
