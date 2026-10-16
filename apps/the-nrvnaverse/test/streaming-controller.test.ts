import { describe, expect, it } from "vitest";
import { StreamingController, type StreamingPosition } from "@/lib/spatial/streaming-controller";
import { parseSpatialIndex, type SpatialIndexStreaming } from "@/lib/spatial/spatial-index";
import { spatialIndexJson } from "./support/generated-spatial";

/** M2 streaming controller: which chunk should be active, decided from the visitor's position only. */

const GRID: SpatialIndexStreaming = {
  cellSize: 200,
  margin: 4,
  cells: { "0,0": "plaza", "-1,0": "west", "1,0": "east", "0,-1": "north" },
  releases: [{ fromChunkKey: "sky", belowY: 128 }],
  catchBelowY: -30,
};

function harness(opts: { grid?: SpatialIndexStreaming; active?: string; gated?: string[] } = {}) {
  const calls: string[] = [];
  let pos: StreamingPosition | null = { x: 0, y: 0, z: 0 };
  let active: string | null = opts.active ?? "plaza";
  let busy = false;
  let grounded = true;
  const descent: Array<number | null> = [];
  const controller = new StreamingController({
    streaming: opts.grid ?? GRID,
    position: () => pos,
    activeChunk: () => active,
    isBusy: () => busy,
    isStreamable: (k) => !(opts.gated ?? []).includes(k),
    handoff: (k, reason) => calls.push(`${reason}:${k}`),
    rescue: () => calls.push("rescue"),
    descent: { speed: 22, set: (v) => descent.push(v), grounded: () => grounded },
  });
  return {
    controller,
    calls,
    descent,
    at: (x: number, y: number, z: number) => (pos = { x, y, z }),
    nowhere: () => (pos = null),
    activate: (k: string | null) => (active = k),
    busy: (b: boolean) => (busy = b),
    ground: (g: boolean) => (grounded = g),
  };
}

describe("streaming controller — walking between cells", () => {
  it("maps positions to cells centred on multiples of the cell size", () => {
    const { controller } = harness();
    expect(controller.cellChunkAt(0, 0)).toBe("plaza");
    expect(controller.cellChunkAt(-99, 50)).toBe("plaza");
    expect(controller.cellChunkAt(-101, 50)).toBe("west");
    expect(controller.cellChunkAt(120, -20)).toBe("east");
    expect(controller.cellChunkAt(0, -150)).toBe("north");
    expect(controller.cellChunkAt(400, 0)).toBeNull();
  });

  it("hands off only once the visitor is `margin` inside the neighbour (hysteresis), never back at the edge", () => {
    const h = harness();
    h.at(-102, 0, 0); // 2 m into the west cell: not yet
    expect(h.controller.tick()).toEqual({ kind: "none" });
    h.at(-104.5, 0, 0); // 4.5 m in
    expect(h.controller.tick()).toEqual({ kind: "handoff", chunkKey: "west", reason: "walk" });
    expect(h.calls).toEqual(["walk:west"]);
    // Now in the west chunk, pacing back across the edge by 2 m does nothing.
    h.activate("west");
    h.at(-98, 0, 0);
    expect(h.controller.tick()).toEqual({ kind: "none" });
    h.at(-95, 0, 0);
    expect(h.controller.tick()).toEqual({ kind: "handoff", chunkKey: "plaza", reason: "walk" });
  });

  it("never hands off while a travel / transition is in flight, and never repeats a pending target", () => {
    const h = harness();
    h.at(-120, 0, 0);
    h.busy(true);
    expect(h.controller.tick()).toEqual({ kind: "none" });
    h.busy(false);
    h.controller.tick();
    h.busy(true); // the handoff we just asked for is staging
    h.controller.tick();
    expect(h.calls).toEqual(["walk:west"]);
  });

  it("never streams a gated chunk (defence in depth over the pipeline rule)", () => {
    const h = harness({ gated: ["north"] });
    h.at(0, 0, -150);
    expect(h.controller.tick()).toEqual({ kind: "none" });
    expect(h.calls).toEqual([]);
  });

  it("does nothing outside the grid or without a position / active chunk", () => {
    const h = harness();
    h.at(450, 0, 0);
    expect(h.controller.tick()).toEqual({ kind: "none" });
    h.nowhere();
    expect(h.controller.tick()).toEqual({ kind: "none" });
    h.at(-150, 0, 0);
    h.activate(null);
    expect(h.controller.tick()).toEqual({ kind: "none" });
    expect(h.calls).toEqual([]);
  });
});

describe("streaming controller — the Hub release, the descent glide and the safety catch", () => {
  it("does not stream from a non-cell chunk (the Hub, the Club) while the visitor stands in it", () => {
    const h = harness({ active: "sky" });
    h.at(-150, 141, 0);
    expect(h.controller.tick()).toEqual({ kind: "none" });
    const club = harness({ active: "club" });
    club.at(-150, 0, 0);
    expect(club.controller.tick()).toEqual({ kind: "none" });
  });

  it("releases a falling visitor into the cell underneath (no margin: they are falling into it)", () => {
    const h = harness({ active: "sky" });
    h.ground(false);
    h.at(-101, 127, 3);
    expect(h.controller.tick()).toEqual({ kind: "handoff", chunkKey: "west", reason: "release" });
  });

  it("engages the descent glide within 10 m above the release height and releases it on the ground", () => {
    const h = harness({ active: "sky" });
    h.ground(false);
    h.at(0, 139, 0);
    h.controller.tick();
    expect(h.descent).toEqual([]);
    h.at(0, 137, 0);
    h.controller.tick();
    expect(h.descent).toEqual([22]);
    expect(h.controller.isDescending).toBe(true);
    // Released into the plaza; still falling → the glide stays on.
    h.activate("plaza");
    h.at(0, 60, 0);
    h.controller.tick();
    expect(h.descent).toEqual([22]);
    h.ground(true);
    h.at(0, 0.1, 0);
    h.controller.tick();
    expect(h.descent).toEqual([22, null]);
    expect(h.controller.isDescending).toBe(false);
  });

  it("rescues a visitor below the catch height", () => {
    const h = harness();
    h.at(10, -31, 10);
    expect(h.controller.tick()).toEqual({ kind: "rescue" });
    expect(h.calls).toEqual(["rescue"]);
  });

  it("dispose() releases an engaged glide", () => {
    const h = harness({ active: "sky" });
    h.ground(false);
    h.at(0, 130, 0);
    h.controller.tick();
    h.controller.dispose();
    expect(h.descent).toEqual([22, null]);
  });
});

describe("streaming controller — the committed grid", () => {
  const index = parseSpatialIndex(spatialIndexJson);
  it("parses the committed streaming grid: 3 × 3 walkable cells, the Hub releases, a safety catch", () => {
    const s = index.streaming!;
    expect(s.cellSize).toBe(200);
    expect(Object.keys(s.cells).sort()).toEqual(["-1,-1", "-1,0", "-1,1", "0,-1", "0,0", "0,1", "1,-1", "1,0", "1,1"]);
    expect(s.cells["0,0"]).toBe("city-plaza");
    expect(s.cells["-1,0"]).toBe("music");
    expect(s.cells["1,0"]).toBe("fashion-culture");
    expect(Object.values(s.cells)).not.toContain("cannabis-21");
    expect(Object.values(s.cells)).not.toContain("hub");
    expect(Object.values(s.cells)).not.toContain("music-club");
    expect(s.releases).toEqual([{ fromChunkKey: "hub", belowY: expect.any(Number) }]);
    expect(s.catchBelowY).toBeLessThan(0);
  });

  it("the Hub's spawn floats above the release height, and the release lands in the plaza cell", () => {
    const hubSpawn = Object.values(index.destinations).find((d) => d.chunkKey === "hub")!.spawn.position;
    const release = index.streaming!.releases[0].belowY;
    expect(hubSpawn.y).toBeGreaterThan(release + 10);
    const c = new StreamingController({
      streaming: index.streaming!,
      position: () => ({ x: hubSpawn.x, y: release - 1, z: hubSpawn.z }),
      activeChunk: () => "hub",
      isBusy: () => false,
      isStreamable: () => true,
      handoff: () => {},
      rescue: () => {},
    });
    expect(c.decide()).toEqual({ kind: "handoff", chunkKey: "city-plaza", reason: "release" });
  });
});
