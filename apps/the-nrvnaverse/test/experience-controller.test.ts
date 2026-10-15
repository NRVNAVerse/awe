import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { ExperienceController } from "@/lib/experience/experience-controller";
import { parseChunkPayload } from "@/lib/spatial/chunk-payload";
import { parseSpatialIndex } from "@/lib/spatial/spatial-index";
import { fashionJson, hubJson, musicJson, spatialIndexJson } from "./support/generated-spatial";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";

/**
 * ExperienceController (M1 experience campaign): binds exactly the zones of the active chunk,
 * turns player sensor enter / exit into visibility effects, plays arrival beats on the engine
 * clock and never touches travel. Exercised over the fake runtime with the real generated bindings.
 */

const APP_ROOT = join(__dirname, "..");
const index = parseSpatialIndex(spatialIndexJson);
const data = destinationsJson as unknown as DestinationsFile;
const bySlug = data.index.bySlug;
const HUB = parseChunkPayload(hubJson, { worldId: index.worldId, chunkKey: "hub" });
const MUSIC = parseChunkPayload(musicJson, { worldId: index.worldId, chunkKey: "music" });
const FASHION = parseChunkPayload(fashionJson, { worldId: index.worldId, chunkKey: "fashion-culture" });
const signal = () => new AbortController().signal;

function setup() {
  const runtime = new FakeChunkRuntime();
  const warnings: string[] = [];
  const controller = new ExperienceController({ experience: index.experience, runtime, warn: (m) => warnings.push(m) });
  controller.install();
  return { runtime, controller, warnings };
}

describe("experience controller — hidden-on-stage policy", () => {
  it("install() declares every chunk's hidden set once; staging a chunk hides exactly those components before the batch is returned", async () => {
    const { runtime } = setup();
    expect([...runtime.hiddenOnStage.keys()].sort()).toEqual(["fashion-culture", "hub", "music"]);
    const batch = await runtime.stageChunk(HUB, signal());
    for (const id of index.experience.hidden.hub) {
      expect(batch.componentIds).toContain(id);
      expect(runtime.visibleOf(id), id).toBe(false);
    }
    // Everything else in the chunk is visible, including every portal sensor.
    for (const id of batch.componentIds) {
      if (!index.experience.hidden.hub.includes(id)) expect(runtime.visibleOf(id), id).toBe(true);
    }
    expect(runtime.log.filter((e) => e.startsWith("hide-on-stage:"))).toHaveLength(index.experience.hidden.hub.length);
    expect(runtime.log.indexOf("hide-on-stage:hub-spire-ring-1-lit")).toBeGreaterThan(runtime.log.indexOf("create:hub-spire-ring-1-lit"));
  });

  it("the committed hidden sets name only state-B geometry: never a portal, never a zone sensor, never a surface someone walks on", () => {
    const sensors = new Set(Object.values(index.experience.zones).map((z) => z.sensorId));
    for (const [chunkKey, ids] of Object.entries(index.experience.hidden)) {
      expect(ids.length, chunkKey).toBeGreaterThan(0);
      for (const id of ids) {
        expect(index.portals[id], id).toBeUndefined();
        expect(sensors.has(id), id).toBe(false);
        expect(id).toMatch(/-(lit|blade|glow|halo|well|pool|wash|spot|ring)$/);
      }
    }
  });
});

describe("experience controller — activation follows the active chunk", () => {
  it("activate(hub) binds the 2 Hub zones (enter + exit), music 3, fashion-culture 6, cannabis-21 none", async () => {
    const { runtime, controller, warnings } = setup();
    const hub = await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    expect(controller.boundZoneIds).toEqual(["hub-core", "hub-overlook"]);
    expect(runtime.sensorListenerCount("hub-zone-overlook")).toBe(1);
    expect(runtime.sensorExitListenerCount("hub-zone-overlook")).toBe(1);
    expect(controller.activeChunkKey).toBe("hub");

    const music = await runtime.stageChunk(MUSIC, signal());
    runtime.retireChunk(hub);
    controller.activate("music");
    expect(controller.boundZoneIds).toEqual(["music-booth", "music-walk-north", "music-walk-south"]);
    // Enter-only zones hold no exit subscription.
    expect(runtime.sensorExitListenerCount("music-zone-walk-south")).toBe(0);
    expect(runtime.sensorListenerCount("music-zone-walk-south")).toBe(1);

    const fashion = await runtime.stageChunk(FASHION, signal());
    runtime.retireChunk(music);
    controller.activate("fashion-culture");
    expect(controller.boundZoneIds).toEqual(["fashion-atelier", "fashion-loggia", "fashion-roof", "fashion-walk-1", "fashion-walk-2", "fashion-walk-3"]);

    runtime.retireChunk(fashion);
    controller.activate("cannabis-21");
    expect(controller.boundZoneIds).toEqual([]);
    controller.activate(null);
    expect(controller.activeChunkKey).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("activating the already active chunk is a no-op (same-chunk travel never rebinds)", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    const epoch = controller.bindingEpoch;
    const log = runtime.log.length;
    controller.activate("music");
    expect(controller.bindingEpoch).toBe(epoch);
    expect(runtime.log.length).toBe(log);
    expect(runtime.sensorListenerCount("music-zone-booth")).toBe(1);
  });

  it("a zone whose sensor is not staged is reported and skipped; the others still bind", () => {
    const { controller, warnings } = setup();
    controller.activate("hub"); // nothing staged
    expect(controller.boundZoneIds).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/could not bind zone "hub-core"/);
  });
});

describe("experience controller — zone enter / exit effects", () => {
  it("entering the overlook lights the lamp (lit shown, dim hidden); leaving restores it", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    expect(runtime.visibleOf("hub-overlook-lamp")).toBe(true);
    expect(runtime.visibleOf("hub-overlook-lamp-lit")).toBe(false);

    runtime.enterSensor("hub-zone-overlook");
    expect(controller.triggerCount).toBe(0); // deferred to a microtask
    await flush();
    expect(controller.triggerCount).toBe(1);
    expect(controller.lastTrigger).toEqual({ kind: "zone-enter", id: "hub-overlook" });
    expect(runtime.visibleOf("hub-overlook-lamp")).toBe(false);
    expect(runtime.visibleOf("hub-overlook-lamp-lit")).toBe(true);
    expect(runtime.visibleOf("hub-overlook-lamp-pool")).toBe(true);

    runtime.exitSensor("hub-zone-overlook");
    await flush();
    expect(controller.lastTrigger).toEqual({ kind: "zone-exit", id: "hub-overlook" });
    expect(runtime.visibleOf("hub-overlook-lamp")).toBe(true);
    expect(runtime.visibleOf("hub-overlook-lamp-lit")).toBe(false);
  });

  it("a non-player intersection triggers nothing", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    runtime.enterSensor("music-zone-walk-south", "some-npc");
    await flush();
    expect(controller.triggerCount).toBe(0);
    expect(runtime.visibleOf("music-stack-1-band-lit")).toBe(false);
  });

  it("a deferred trigger whose chunk was switched before its microtask ran is dropped, never applied", async () => {
    const { runtime, controller } = setup();
    const music = await runtime.stageChunk(MUSIC, signal());
    const hub = await runtime.stageChunk(HUB, signal());
    controller.activate("music");
    // Sensor fires, then — synchronously, before the deferred microtask — the chunk switch commits.
    runtime.enterSensor("music-zone-walk-south");
    runtime.retireChunk(music);
    controller.activate("hub"); // epoch changes before the microtask
    await flush();
    expect(controller.droppedTriggerCount).toBe(1);
    expect(controller.triggerCount).toBe(0);
    expect(runtime.visibleOf("music-stack-1-band-lit")).toBeUndefined(); // gone with its chunk, never shown
    runtime.retireChunk(hub);
  });

  it("effects apply hide before show, so a swap never leaves both states visible", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(FASHION, signal());
    controller.activate("fashion-culture");
    runtime.enterSensor("fashion-zone-walk-1");
    await flush();
    const hideAt = runtime.log.indexOf("hide:fashion-pylon-1-band");
    const showAt = runtime.log.indexOf("show:fashion-pylon-1-band-lit");
    expect(hideAt).toBeGreaterThan(-1);
    expect(showAt).toBeGreaterThan(hideAt);
  });
});

describe("experience controller — arrival beats on the engine clock", () => {
  const hubArrival = { destinationId: data.hubId, chunkKey: "hub", fromChunkKey: null };

  it("arriving at the Hub wakes the spire ring by ring at 0.6 / 1.1 / 1.6 s", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    controller.onArrival(hubArrival);
    expect(controller.pendingBeatCount).toBe(3);
    expect(runtime.visibleOf("hub-spire-ring-1-lit")).toBe(false);
    runtime.advance(0.6);
    expect(runtime.visibleOf("hub-spire-ring-1-lit")).toBe(true);
    expect(runtime.visibleOf("hub-spire-ring-1")).toBe(false);
    expect(runtime.visibleOf("hub-spire-ring-2-lit")).toBe(false);
    runtime.advance(0.5);
    expect(runtime.visibleOf("hub-spire-ring-2-lit")).toBe(true);
    runtime.advance(0.5);
    expect(runtime.visibleOf("hub-spire-ring-3-lit")).toBe(true);
    expect(controller.pendingBeatCount).toBe(0);
    expect(controller.lastTrigger).toEqual({ kind: "arrival", id: "hub-wake#2" });
  });

  it("a return from the Music chunk also lights the Music gateway at 0 s (synchronously) and settles it at 6 s; a Fashion return lights the other", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    controller.onArrival({ ...hubArrival, fromChunkKey: "music" });
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(true); // 0 s beat applied immediately
    expect(runtime.visibleOf("hub-return-fashion-glow")).toBe(false);
    expect(controller.pendingBeatCount).toBe(4); // 3 wake beats + the 6 s settle
    runtime.advance(6);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(false);
    expect(controller.pendingBeatCount).toBe(0);

    controller.onArrival({ ...hubArrival, fromChunkKey: "fashion-culture" });
    expect(runtime.visibleOf("hub-return-fashion-glow")).toBe(true);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(false);
  });

  it("the initial placement (no previous chunk) plays the wake but no return glow", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    controller.onArrival(hubArrival);
    expect(runtime.visibleOf("hub-return-music-glow")).toBe(false);
    expect(runtime.visibleOf("hub-return-fashion-glow")).toBe(false);
    expect(controller.arrivalsFor(hubArrival).map((a) => a.id)).toEqual(["hub-wake"]);
  });

  it("a new arrival cancels the pending beats of the previous one (Artist crescendo interrupted by a return to the floor)", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    controller.onArrival({ destinationId: bySlug["placeholder-artist"], chunkKey: "music", fromChunkKey: null });
    expect(controller.pendingBeatCount).toBe(4);
    runtime.advance(0.3);
    expect(runtime.visibleOf("music-fin-3-blade")).toBe(true);
    controller.onArrival({ destinationId: bySlug["music"], chunkKey: "music", fromChunkKey: null }); // same-chunk travel back to the floor
    expect(controller.pendingBeatCount).toBe(0); // the 0 s reset applied synchronously; crescendo cancelled
    expect(runtime.visibleOf("music-fin-3-blade")).toBe(false);
    runtime.advance(5);
    expect(runtime.visibleOf("music-fin-2-blade")).toBe(false);
    expect(runtime.visibleOf("music-stage-wash")).toBe(false);
  });

  it("dispose cancels pending beats and releases every subscription; nothing fires afterwards", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    controller.onArrival(hubArrival);
    runtime.enterSensor("hub-zone-core");
    controller.dispose();
    await flush();
    runtime.advance(10);
    expect(controller.pendingBeatCount).toBe(0);
    expect(runtime.pendingTimerCount).toBe(0);
    expect(controller.boundZoneIds).toEqual([]);
    expect(runtime.sensorListenerCount("hub-zone-core")).toBe(0);
    expect(runtime.visibleOf("hub-spire-ring-1-lit")).toBe(false);
    expect(runtime.visibleOf("hub-core-halo")).toBe(false);
    expect(controller.triggerCount).toBe(0);
    controller.activate("hub"); // refused after dispose
    expect(controller.boundZoneIds).toEqual([]);
  });
});

describe("experience controller — boundaries", () => {
  it("knows no coordinates, gates, URLs or travel", () => {
    const source = readFileSync(join(APP_ROOT, "src/lib/experience/experience-controller.ts"), "utf8");
    expect(source).not.toMatch(/placeVisitor\(|\.spawn\b|position:|window\.|history\.|location\.|fetch\(|\.gates\b|canTravel|transitionTo|travelTo/);
  });

  it("no experience binding targets a portal sensor and no zone binds one (index-level guarantee)", () => {
    const portalIds = new Set(Object.keys(index.portals));
    const targets: string[] = [];
    for (const z of Object.values(index.experience.zones)) {
      expect(portalIds.has(z.sensorId)).toBe(false);
      targets.push(...(z.enter?.show ?? []), ...(z.enter?.hide ?? []), ...(z.exit?.show ?? []), ...(z.exit?.hide ?? []));
    }
    for (const a of Object.values(index.experience.arrivals)) for (const b of a.beats) targets.push(...(b.show ?? []), ...(b.hide ?? []));
    for (const id of targets) expect(portalIds.has(id), id).toBe(false);
  });
});
