import { describe, expect, it } from "vitest";
import { subscribePlayerEnterSensor, type SensorHost } from "@/lib/spatial/sensor-subscription";
import { FakeChunkRuntime } from "./support/fake-chunk-runtime";

/**
 * The generic player-enters-sensor seam (M0 Step 2B.3). The pure helper is exercised against a
 * tiny in-memory host (the same helper `AweSpatialRuntime` binds to the official engine APIs and
 * that `FakeChunkRuntime` binds to its in-memory world), so the contract is proven without the
 * AWE engine.
 */

interface FakeComponent {
  id: string;
  sensor: boolean;
  disposed: boolean;
  listeners: Set<(other: FakeComponent) => void>;
}

function world() {
  const components = new Map<string, FakeComponent>();
  const add = (id: string, sensor: boolean): FakeComponent => {
    const c: FakeComponent = { id, sensor, disposed: false, listeners: new Set() };
    components.set(id, c);
    return c;
  };
  const player = add("Player", false);
  const host: SensorHost<FakeComponent> = {
    resolve: (id) => {
      const c = components.get(id);
      return c && !c.disposed ? c : undefined;
    },
    isSensor: (c) => c.sensor,
    onSensorEnter: (c, listener) => {
      c.listeners.add(listener);
      return () => {
        if (c.disposed) throw new Error("emitter is gone"); // models a disposed engine component
        c.listeners.delete(listener);
      };
    },
  };
  const enter = (id: string, other: FakeComponent) => {
    for (const l of components.get(id)!.listeners) l(other);
  };
  const dispose = (id: string) => {
    const c = components.get(id)!;
    c.disposed = true;
    c.listeners.clear();
    components.delete(id);
  };
  return { host, add, player, enter, dispose, components };
}

describe("subscribePlayerEnterSensor — pure seam", () => {
  it("invokes the callback once per player entry and ignores non-player intersections", () => {
    const w = world();
    w.add("portal", true);
    const npc = w.add("npc", false);
    let calls = 0;
    subscribePlayerEnterSensor(w.host, "portal", w.player, () => calls++);
    w.enter("portal", w.player);
    expect(calls).toBe(1);
    w.enter("portal", npc);
    w.enter("portal", w.add("crate", false));
    expect(calls).toBe(1);
    w.enter("portal", w.player); // left and re-entered: a second physical entry
    expect(calls).toBe(2);
  });

  it("fails clearly for an unknown (not staged) component and for a component without a sensor collider", () => {
    const w = world();
    w.add("wall", false);
    expect(() => subscribePlayerEnterSensor(w.host, "nope", w.player, () => {})).toThrow(/sensor component "nope" is not staged/);
    expect(() => subscribePlayerEnterSensor(w.host, "wall", w.player, () => {})).toThrow(/component "wall" has no sensor collider/);
    // A disposed component is "not staged" too.
    w.add("gone", true);
    w.dispose("gone");
    expect(() => subscribePlayerEnterSensor(w.host, "gone", w.player, () => {})).toThrow(/not staged/);
  });

  it("unsubscribe prevents future callbacks and is idempotent", () => {
    const w = world();
    const portal = w.add("portal", true);
    let calls = 0;
    const off = subscribePlayerEnterSensor(w.host, "portal", w.player, () => calls++);
    w.enter("portal", w.player);
    off();
    off();
    w.enter("portal", w.player);
    expect(calls).toBe(1);
    expect(portal.listeners.size).toBe(0);
  });

  it("unsubscribe is safe after the component was disposed with its chunk", () => {
    const w = world();
    w.add("portal", true);
    const off = subscribePlayerEnterSensor(w.host, "portal", w.player, () => {});
    w.dispose("portal");
    expect(() => off()).not.toThrow();
    expect(() => off()).not.toThrow();
  });
});

describe("FakeChunkRuntime.onPlayerEnterSensor — the runtime-shaped seam the controller consumes", () => {
  const payload = {
    schemaVersion: 1 as const,
    worldId: "w",
    chunkKey: "c",
    components: {
      "portal-a": { id: "portal-a", type: "mesh", collider: { enabled: true, rigidbodyType: "FIXED", colliderType: "CUBE", isSensor: true } },
      "wall-b": { id: "wall-b", type: "mesh", collider: { enabled: true, rigidbodyType: "FIXED", colliderType: "CUBE" } },
      "off-c": { id: "off-c", type: "mesh", collider: { enabled: false, isSensor: true } },
    },
  };

  it("subscribes to staged sensor components only, filters to the player, and survives retirement", async () => {
    const runtime = new FakeChunkRuntime();
    const batch = await runtime.stageChunk(payload, new AbortController().signal);
    let calls = 0;
    const off = runtime.onPlayerEnterSensor("portal-a", () => calls++);
    expect(() => runtime.onPlayerEnterSensor("wall-b", () => {})).toThrow(/no sensor collider/);
    expect(() => runtime.onPlayerEnterSensor("off-c", () => {})).toThrow(/no sensor collider/);
    expect(() => runtime.onPlayerEnterSensor("portal-z", () => {})).toThrow(/not staged/);
    runtime.enterSensor("portal-a"); // player
    runtime.enterSensor("portal-a", "some-npc");
    expect(calls).toBe(1);
    expect(runtime.sensorListenerCount("portal-a")).toBe(1);

    runtime.retireChunk(batch); // the chunk (and its sensor) is gone
    expect(runtime.sensorListenerCount("portal-a")).toBe(0);
    expect(() => off()).not.toThrow(); // safe after disposal
    expect(() => off()).not.toThrow();
  });

  it("a disposed runtime holds no sensor subscription behaviour", async () => {
    const runtime = new FakeChunkRuntime();
    const batch = await runtime.stageChunk(payload, new AbortController().signal);
    let calls = 0;
    const off = runtime.onPlayerEnterSensor("portal-a", () => calls++);
    runtime.retireChunk(batch);
    runtime.isReady = false; // as `dispose()` leaves the store's runtime
    off();
    expect(runtime.sensorListeners.size).toBe(0);
    expect(() => runtime.onPlayerEnterSensor("portal-a", () => {})).toThrow(/not ready/);
    expect(calls).toBe(0);
  });
});
