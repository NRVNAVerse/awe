import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { parseChunkPayload } from "@/lib/spatial/chunk-payload";
import { PortalController } from "@/lib/spatial/portal-controller";
import { parseSpatialIndex } from "@/lib/spatial/spatial-index";
import fashionJson from "../public/data/spatial/chunks/fashion-culture.json";
import hubJson from "../public/data/spatial/chunks/hub.json";
import musicJson from "../public/data/spatial/chunks/music.json";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";

/**
 * PortalController (M0 Step 2B.3): binds exactly the portal sensors of the active chunk, maps the
 * physical component id to its stable destination id and hands that id — nothing else — to the
 * injected travel callback. Exercised over the fake runtime with the real generated bindings.
 */

const APP_ROOT = join(__dirname, "..");
const index = parseSpatialIndex(spatialIndexJson);
const data = destinationsJson as unknown as DestinationsFile;
const bySlug = data.index.bySlug;
const HUB = parseChunkPayload(hubJson, { worldId: index.worldId, chunkKey: "hub" });
const MUSIC = parseChunkPayload(musicJson, { worldId: index.worldId, chunkKey: "music" });
const FASHION = parseChunkPayload(fashionJson, { worldId: index.worldId, chunkKey: "fashion-culture" });
const signal = () => new AbortController().signal;

function setup(onPortalEntered?: (id: string) => void | Promise<void>) {
  const runtime = new FakeChunkRuntime();
  const travelled: string[] = [];
  const warnings: string[] = [];
  const controller = new PortalController({
    portals: index.portals,
    sensors: runtime,
    onPortalEntered: onPortalEntered ?? ((id) => void travelled.push(id)),
    warn: (m) => warnings.push(m),
  });
  return { runtime, controller, travelled, warnings };
}

describe("portal controller — activation follows the active chunk", () => {
  it("activate(hub) binds exactly the 3 Hub portals, music 2, fashion-culture 2, cannabis-21 none", async () => {
    const { runtime, controller } = setup();
    const hub = await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    expect(controller.boundPortalCount).toBe(3);
    expect(controller.boundComponentIds).toEqual(["portal-hub-cannabis", "portal-hub-fashion", "portal-hub-music"]);
    expect(controller.activeChunkKey).toBe("hub");

    const music = await runtime.stageChunk(MUSIC, signal());
    runtime.retireChunk(hub);
    controller.activate("music");
    expect(controller.boundComponentIds).toEqual(["portal-music-artist", "portal-music-hub"]);

    const fashion = await runtime.stageChunk(FASHION, signal());
    runtime.retireChunk(music);
    controller.activate("fashion-culture");
    expect(controller.boundComponentIds).toEqual(["portal-fashion-brand", "portal-fashion-hub"]);

    runtime.retireChunk(fashion);
    controller.activate("cannabis-21");
    expect(controller.boundPortalCount).toBe(0);
    expect(controller.portalsOf("cannabis-21")).toEqual([]);
    controller.activate(null);
    expect(controller.boundPortalCount).toBe(0);
    expect(controller.activeChunkKey).toBeNull();
  });

  it("activating the already active chunk is a no-op: no duplicate listeners, no rebind (same-chunk travel)", async () => {
    const { runtime, controller } = setup();
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    const log = runtime.log.length;
    controller.activate("music");
    controller.activate("music");
    expect(runtime.log.length).toBe(log);
    expect(runtime.sensorListenerCount("portal-music-artist")).toBe(1);
    expect(runtime.sensorListenerCount("portal-music-hub")).toBe(1);
    expect(controller.boundPortalCount).toBe(2);
  });

  it("a chunk switch removes the previous listeners before binding the new set", async () => {
    const { runtime, controller, travelled } = setup();
    const hub = await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    // The old chunk is retired by the orchestrator BEFORE the store re-syncs portals: unsubscribing must survive that.
    await runtime.stageChunk(MUSIC, signal());
    runtime.retireChunk(hub);
    controller.activate("music");
    expect(runtime.log.filter((e) => e.startsWith("sensor-off:"))).toEqual([]); // hub emitters were already gone
    expect(controller.boundComponentIds).toEqual(["portal-music-artist", "portal-music-hub"]);
    for (const id of ["portal-hub-music", "portal-hub-fashion", "portal-hub-cannabis"]) expect(runtime.sensorListenerCount(id)).toBe(0);

    // Switching while the old chunk is still alive unsubscribes cleanly too.
    const hub2 = await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    expect(runtime.log.filter((e) => e.startsWith("sensor-off:")).sort()).toEqual(["sensor-off:portal-music-artist", "sensor-off:portal-music-hub"]);
    runtime.enterSensor("portal-music-artist");
    await flush();
    expect(travelled).toEqual([]);
    void hub2;
  });

  it("binds what it can and reports a portal it cannot bind instead of throwing into the travel path", async () => {
    const { runtime, controller, warnings } = setup();
    const broken = structuredClone(HUB);
    broken.components["portal-hub-music"].collider = { enabled: true, isSensor: false };
    await runtime.stageChunk(broken, signal());
    expect(() => controller.activate("hub")).not.toThrow();
    expect(controller.boundComponentIds).toEqual(["portal-hub-cannabis", "portal-hub-fashion"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not bind portal "portal-hub-music" of chunk "hub"/);
  });
});

describe("portal controller — trigger routing", () => {
  it("routes the exact stable destination id of the entered sensor, once per entry, on a microtask", async () => {
    const { runtime, controller, travelled } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    runtime.enterSensor("portal-hub-music");
    expect(travelled).toEqual([]); // deferred out of the engine's event dispatch
    await flush();
    expect(travelled).toEqual([bySlug["music"]]);
    expect(controller.lastTrigger).toEqual({ componentId: "portal-hub-music", destinationId: bySlug["music"] });
    runtime.enterSensor("portal-hub-fashion");
    runtime.enterSensor("portal-hub-cannabis");
    await flush();
    expect(travelled).toEqual([bySlug["music"], bySlug["fashion-culture"], bySlug["cannabis-21"]]);
    expect(controller.triggerCount).toBe(3);
  });

  it("non-player intersections never trigger travel", async () => {
    const { runtime, controller, travelled } = setup();
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    runtime.enterSensor("portal-music-hub", "marker-music");
    runtime.enterSensor("portal-music-artist", "npc-42");
    await flush();
    expect(travelled).toEqual([]);
    expect(controller.lastTrigger).toBeNull();
  });

  it("the gated portal is not special-cased: it routes its stable id like any other portal and stays bound after a refusal", async () => {
    const refused: string[] = [];
    const { runtime, controller } = setup(async (id) => {
      refused.push(id); // the real callback would return `gate-required` from the adapter; the controller does not care
    });
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    runtime.enterSensor("portal-hub-cannabis");
    await flush();
    expect(refused).toEqual([bySlug["cannabis-21"]]);
    expect(controller.boundComponentIds).toContain("portal-hub-cannabis");
    // Leaving and re-entering is the only way to ask again — one entry, one request.
    runtime.enterSensor("portal-hub-cannabis");
    await flush();
    expect(refused).toHaveLength(2);
  });

  it("an asynchronous travel callback is awaited for errors only — no repeated requests while it is pending", async () => {
    let resolveTravel: () => void = () => {};
    const calls: string[] = [];
    const { runtime, controller, warnings } = setup(
      (id) =>
        new Promise<void>((resolve) => {
          calls.push(id);
          resolveTravel = resolve;
        }),
    );
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    runtime.enterSensor("portal-music-artist");
    await flush();
    await flush(5);
    expect(calls).toEqual([bySlug["placeholder-artist"]]); // still pending, still exactly one request
    resolveTravel();
    await flush();
    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("a rejected or throwing travel callback is reported, never thrown into the sensor dispatch", async () => {
    const { runtime, controller, warnings } = setup(async () => {
      throw new Error("adapter exploded");
    });
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    expect(() => runtime.enterSensor("portal-music-hub")).not.toThrow();
    await flush();
    expect(warnings).toEqual([expect.stringMatching(/portal travel to ".*" rejected/)]);

    const sync = setup(() => {
      throw new Error("sync boom");
    });
    await sync.runtime.stageChunk(MUSIC, signal());
    sync.controller.activate("music");
    expect(() => sync.runtime.enterSensor("portal-music-hub")).not.toThrow();
    await flush();
    expect(sync.warnings).toEqual([expect.stringMatching(/portal travel to ".*" threw/)]);
  });

  it("the controller never receives coordinates, spawns or gates: bindings are componentId → chunkKey → destinationId", () => {
    const { controller } = setup();
    for (const chunkKey of ["hub", "music", "fashion-culture"]) {
      for (const portal of controller.portalsOf(chunkKey)) {
        expect(Object.keys(portal).sort()).toEqual(["chunkKey", "componentId", "destinationId"]);
        expect(portal.destinationId).toMatch(/^dst_[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
      }
    }
    const text = JSON.stringify(index.portals);
    expect(text).not.toMatch(/"(position|spawn|yaw|x|y|z|gates|age21|webUrl|name)"/);
    const source = readFileSync(join(APP_ROOT, "src/lib/spatial/portal-controller.ts"), "utf8");
    expect(source).not.toMatch(/@oncyberio\/engine|Component3D|three/);
  });
});

describe("portal controller — disposal", () => {
  it("dispose removes every listener, refuses further activation and drops late triggers", async () => {
    const { runtime, controller, travelled } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    controller.dispose();
    expect(controller.boundPortalCount).toBe(0);
    expect(controller.activeChunkKey).toBeNull();
    for (const id of ["portal-hub-music", "portal-hub-fashion", "portal-hub-cannabis"]) expect(runtime.sensorListenerCount(id)).toBe(0);
    controller.activate("hub");
    expect(controller.boundPortalCount).toBe(0);
    runtime.enterSensor("portal-hub-music");
    await flush();
    expect(travelled).toEqual([]);
    controller.dispose(); // idempotent
  });

  it("a trigger already queued when dispose() runs does not call back", async () => {
    const { runtime, controller, travelled } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    runtime.enterSensor("portal-hub-music");
    controller.dispose();
    await flush();
    expect(travelled).toEqual([]);
    expect(controller.droppedTriggerCount).toBe(1);
    expect(controller.triggerCount).toBe(0);
  });

  it("a throwing unsubscribe is reported, every other portal is still released, and disposal completes", () => {
    // The real seam (`subscribePlayerEnterSensor`) already swallows a disposed emitter; this exercises the
    // controller's own second line of defence against a `SensorRuntime` whose unsubscribe throws.
    const released: string[] = [];
    const warnings: string[] = [];
    const sensors = {
      onPlayerEnterSensor: (componentId: string) => () => {
        if (componentId === "portal-hub-fashion") throw new Error("emitter exploded");
        released.push(componentId);
      },
    };
    const controller = new PortalController({ portals: index.portals, sensors, onPortalEntered: () => {}, warn: (m) => warnings.push(m) });
    controller.activate("hub");
    expect(controller.boundPortalCount).toBe(3);
    expect(() => controller.dispose()).not.toThrow();
    expect(controller.boundPortalCount).toBe(0);
    expect(released.sort()).toEqual(["portal-hub-cannabis", "portal-hub-music"]);
    expect(warnings).toEqual([expect.stringMatching(/could not release portal "portal-hub-fashion"/)]);
  });
});

/**
 * M0 Step 2B.4A — a deferred trigger is bound to the binding epoch it was recorded under. If the
 * bound set changed between SENSOR ENTER and the microtask (chunk switch, release, dispose), the
 * trigger is dropped instead of starting a stale travel. No debounce/cooldown: a legitimate entry
 * still routes exactly once.
 */
describe("portal controller — stale deferred triggers", () => {
  it("trigger, binding unchanged → the callback runs exactly once", async () => {
    const { runtime, controller, travelled } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    const epoch = controller.bindingEpoch;
    runtime.enterSensor("portal-hub-music");
    controller.activate("hub"); // same chunk again: no-op, no epoch change
    expect(controller.bindingEpoch).toBe(epoch);
    await flush();
    expect(travelled).toEqual([bySlug["music"]]);
    expect(controller.triggerCount).toBe(1);
    expect(controller.droppedTriggerCount).toBe(0);
  });

  it("trigger, then a different chunk is activated before the microtask → the old callback does NOT run", async () => {
    const { runtime, controller, travelled } = setup();
    const hub = await runtime.stageChunk(HUB, signal());
    await runtime.stageChunk(MUSIC, signal()); // a transition has the target staged (old chunk alive)
    controller.activate("hub");
    runtime.enterSensor("portal-hub-music"); // deferred to a microtask
    // Before that microtask runs, an earlier-queued continuation commits the chunk switch.
    runtime.retireChunk(hub);
    controller.activate("music");
    await flush();
    expect(travelled).toEqual([]);
    expect(controller.droppedTriggerCount).toBe(1);
    expect(controller.lastTrigger).toBeNull();
    // The new chunk's portals work, exactly once each.
    runtime.enterSensor("portal-music-artist");
    await flush();
    expect(travelled).toEqual([bySlug["placeholder-artist"]]);
    expect(controller.triggerCount).toBe(1);
    expect(runtime.sensorListenerCount("portal-music-artist")).toBe(1);
    expect(runtime.sensorListenerCount("portal-music-hub")).toBe(1);
  });

  it("trigger, then dispose before the microtask → the callback does NOT run; a fresh controller still works", async () => {
    const { runtime, controller, travelled } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    runtime.enterSensor("portal-hub-fashion");
    controller.dispose();
    await flush();
    expect(travelled).toEqual([]);
    expect(controller.droppedTriggerCount).toBe(1);

    const next = setup();
    await next.runtime.stageChunk(HUB, signal());
    next.controller.activate("hub");
    next.runtime.enterSensor("portal-hub-fashion");
    await flush();
    expect(next.travelled).toEqual([bySlug["fashion-culture"]]);
  });

  it("two entries in one frame both route (no debounce), and none is duplicated by a rebind of the same chunk", async () => {
    const { runtime, controller, travelled } = setup();
    await runtime.stageChunk(HUB, signal());
    controller.activate("hub");
    runtime.enterSensor("portal-hub-music");
    runtime.enterSensor("portal-hub-fashion");
    controller.activate("hub");
    await flush();
    expect(travelled).toEqual([bySlug["music"], bySlug["fashion-culture"]]);
    expect(controller.triggerCount).toBe(2);
    expect(controller.droppedTriggerCount).toBe(0);
    for (const id of ["portal-hub-music", "portal-hub-fashion", "portal-hub-cannabis"]) expect(runtime.sensorListenerCount(id)).toBe(1);
  });
});
