import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { abortError, StaticChunkDataSource, type StaticChunkEntry } from "@/lib/spatial/chunk-data-source";
import { ChunkOrchestrator } from "@/lib/spatial/chunk-orchestrator";
import { parseChunkPayload } from "@/lib/spatial/chunk-payload";
import { parseSpatialIndex } from "@/lib/spatial/spatial-index";
import cannabisJson from "../public/data/spatial/chunks/cannabis-21.json";
import fashionJson from "../public/data/spatial/chunks/fashion-culture.json";
import hubJson from "../public/data/spatial/chunks/hub.json";
import musicJson from "../public/data/spatial/chunks/music.json";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";

const index = parseSpatialIndex(spatialIndexJson);
const data = destinationsJson as unknown as DestinationsFile;
const ids = {
  hub: data.hubId,
  music: data.index.bySlug["music"],
  artist: data.index.bySlug["placeholder-artist"],
  fashion: data.index.bySlug["fashion-culture"],
};
const spawn = (id: string) => index.destinations[id].spawn;
const chunkOf = (id: string) => index.destinations[id].chunkKey;
const HUB = parseChunkPayload(hubJson, { worldId: index.worldId, chunkKey: "hub" });
const MUSIC = parseChunkPayload(musicJson, { worldId: index.worldId, chunkKey: "music" });
const FASHION = parseChunkPayload(fashionJson, { worldId: index.worldId, chunkKey: "fashion-culture" });

const GENERATED: Record<string, StaticChunkEntry> = { hub: hubJson, music: musicJson, "fashion-culture": fashionJson, "cannabis-21": cannabisJson };

function setup(payloads: Record<string, StaticChunkEntry> = GENERATED) {
  const runtime = new FakeChunkRuntime();
  const source = new StaticChunkDataSource(payloads);
  const warnings: string[] = [];
  const orchestrator = new ChunkOrchestrator({ runtime, chunkSource: source, worldId: index.worldId, chunks: index.chunks, warn: (m) => warnings.push(m) });
  const go = (id: string) => orchestrator.transitionTo({ chunkKey: chunkOf(id), spawn: spawn(id), destinationId: id });
  return { runtime, source, orchestrator, warnings, go };
}

/** Boot the orchestrator into the Hub chunk. */
async function atHub() {
  const ctx = setup();
  expect(await ctx.go(ids.hub)).toMatchObject({ status: "arrived", kind: "cross-chunk", chunkKey: "hub" });
  ctx.runtime.log.length = 0;
  ctx.runtime.placed.length = 0;
  ctx.source.requests.length = 0;
  return ctx;
}

describe("chunk orchestrator — initial load and same-chunk travel", () => {
  it("loads exactly the requested chunk first (no Hub first for a Music deep link)", async () => {
    const { runtime, source, orchestrator, go } = setup();
    expect(orchestrator.activeChunkKey).toBeNull();
    const result = await go(ids.music);
    expect(result).toEqual({ status: "arrived", chunkKey: "music", kind: "cross-chunk" });
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["music"]);
    expect(source.requests[0].dataUrl).toBe(index.chunks.music.dataUrl);
    expect(source.requests[0].dataUrl).toMatch(/\?v=[0-9a-f]{32}$/); // the whole content-versioned delivery URL, as the index emitted it (2B.4B.2)
    expect(orchestrator.activeChunkKey).toBe("music");
    expect(runtime.liveOf(MUSIC)).toEqual(Object.keys(MUSIC.components));
    expect(runtime.liveOf(HUB)).toEqual([]);
    expect(runtime.placed).toEqual([spawn(ids.music)]);
    // Placement happens only after every component of the chunk exists.
    expect(runtime.log.indexOf("place:-70,1,6")).toBeGreaterThan(runtime.log.lastIndexOf("create:path-music-north"));
  });

  it("same-chunk travel neither fetches nor rebuilds: Music District → Placeholder Artist is a teleport", async () => {
    const { runtime, source, orchestrator, go } = setup();
    await go(ids.music);
    runtime.log.length = 0;
    let loading = 0;
    const result = await orchestrator.transitionTo({ chunkKey: chunkOf(ids.artist), spawn: spawn(ids.artist), destinationId: ids.artist, onLoadingChunk: () => loading++ });
    expect(result).toEqual({ status: "arrived", chunkKey: "music", kind: "same-chunk" });
    expect(loading).toBe(0);
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["music"]);
    expect(runtime.log).toEqual(["place:-70,1,-34"]);
    expect(runtime.liveOf(MUSIC)).toEqual(Object.keys(MUSIC.components));
  });

  it("reports a same-chunk teleport failure without touching the chunk", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.failPlace = "physics exploded";
    expect(await go(ids.hub)).toEqual({ status: "failed", chunkKey: "hub", step: "place", reason: "physics exploded" });
    expect(orchestrator.activeChunkKey).toBe("hub");
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
  });

  it("fails structurally for a chunk key the index does not declare, without requesting anything", async () => {
    const { source, orchestrator } = await atHub();
    const result = await orchestrator.transitionTo({ chunkKey: "nowhere", spawn: spawn(ids.hub), destinationId: ids.hub });
    expect(result).toMatchObject({ status: "failed", step: "fetch" });
    expect(source.requests).toEqual([]);
    expect(orchestrator.activeChunkKey).toBe("hub");
  });
});

describe("chunk orchestrator — cross-chunk transition order", () => {
  it("fetches and stages the target while the old chunk is alive, teleports, then retires the old chunk", async () => {
    const { runtime, source, orchestrator, go } = await atHub();
    let loading = 0;
    const result = await orchestrator.transitionTo({ chunkKey: "music", spawn: spawn(ids.music), destinationId: ids.music, onLoadingChunk: () => loading++ });
    expect(result).toEqual({ status: "arrived", chunkKey: "music", kind: "cross-chunk" });
    expect(loading).toBe(1);
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["music"]);

    const log = runtime.log;
    const stageAt = log.indexOf("stage:music");
    const lastCreateAt = log.lastIndexOf("create:path-music-north");
    const placeAt = log.indexOf("place:-70,1,6");
    const retireAt = log.indexOf("retire:hub");
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(lastCreateAt).toBeGreaterThan(stageAt);
    expect(placeAt).toBeGreaterThan(lastCreateAt);
    expect(retireAt).toBeGreaterThan(placeAt);
    // No hub component was destroyed before the teleport.
    expect(log.slice(0, placeAt).some((e) => e.startsWith("destroy:"))).toBe(false);

    expect(orchestrator.activeChunkKey).toBe("music");
    expect(runtime.liveOf(HUB)).toEqual([]);
    expect(runtime.liveOf(MUSIC)).toEqual(Object.keys(MUSIC.components));
  });

  it("keeps the arrived target active and reports a cleanup problem if the old chunk cannot be fully retired", async () => {
    const { runtime, orchestrator, warnings, go } = await atHub();
    runtime.failRetire = "renderer refused";
    const result = await go(ids.music);
    expect(result).toEqual({ status: "arrived", chunkKey: "music", kind: "cross-chunk", cleanupError: "renderer refused" });
    expect(orchestrator.activeChunkKey).toBe("music");
    expect(runtime.placed).toEqual([spawn(ids.music)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not fully retire chunk "hub" after arriving in "music"/);
  });
});

describe("chunk orchestrator — failure keeps the current chunk (rollback state)", () => {
  it("survives a chunk HTTP 404: the old chunk and visitor position are untouched, nothing was staged", async () => {
    const { hub, music: _omit, ...withoutMusic } = GENERATED;
    const { runtime, orchestrator, go } = setup({ hub, ...withoutMusic });
    await go(ids.hub);
    runtime.log.length = 0;
    const result = await go(ids.music);
    expect(result).toMatchObject({ status: "failed", chunkKey: "music", step: "fetch", reason: expect.stringMatching(/404/) });
    expect(orchestrator.activeChunkKey).toBe("hub");
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
    expect(runtime.liveOf(MUSIC)).toEqual([]);
    expect(runtime.log).toEqual([]);
  });

  it("survives a network error thrown by the source", async () => {
    const { runtime, orchestrator, go } = setup({
      ...GENERATED,
      music: () => {
        throw new Error("network down");
      },
    });
    await go(ids.hub);
    expect(await go(ids.music)).toEqual({ status: "failed", chunkKey: "music", step: "fetch", reason: "network down" });
    expect(orchestrator.activeChunkKey).toBe("hub");
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
  });

  it("rejects a malformed or mismatched payload BEFORE any engine mutation", async () => {
    for (const bad of [{ ...musicJson, chunkKey: "hub" }, { ...musicJson, worldId: "elsewhere" }, { ...musicJson, schemaVersion: 9 }, { ...musicJson, components: [] }, "garbage"]) {
      const { runtime, orchestrator, go } = setup({ ...GENERATED, music: bad });
      await go(ids.hub);
      runtime.log.length = 0;
      const result = await go(ids.music);
      expect(result).toMatchObject({ status: "failed", chunkKey: "music", step: "validate" });
      expect(orchestrator.activeChunkKey).toBe("hub");
      expect(runtime.log).toEqual([]);
      expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
    }
  });

  it("cleans up a partially created target when one component fails, leaving the old chunk and position intact", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.failCreate["label-music"] = "font missing";
    const result = await go(ids.music);
    expect(result).toMatchObject({ status: "failed", chunkKey: "music", step: "stage", reason: expect.stringMatching(/label-music: font missing/) });
    expect(orchestrator.activeChunkKey).toBe("hub");
    expect(runtime.liveOf(MUSIC)).toEqual([]);
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
    expect(runtime.placed).toEqual([]);
    // Every other music component was created and then destroyed again.
    const others = Object.keys(MUSIC.components).length - 1;
    expect(runtime.log.filter((e) => e.startsWith("create:")).length).toBe(others);
    expect(runtime.log.filter((e) => e.startsWith("destroy:")).length).toBe(others);
    expect(runtime.log).not.toContain("retire:hub");
  });

  it("destroys the staged target and keeps the old chunk when the teleport fails", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.failPlace = "no ground";
    const result = await go(ids.music);
    expect(result).toEqual({ status: "failed", chunkKey: "music", step: "place", reason: "no ground" });
    expect(orchestrator.activeChunkKey).toBe("hub");
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
    expect(runtime.liveOf(MUSIC)).toEqual([]);
    expect(runtime.log).toContain("retire:music");
    expect(runtime.log).not.toContain("retire:hub");
    expect(runtime.placed).toEqual([]);
    // And the world is fully usable: the next travel works.
    expect(await go(ids.music)).toMatchObject({ status: "arrived" });
    expect(orchestrator.activeChunkKey).toBe("music");
  });
});

describe("chunk orchestrator — latest request wins", () => {
  it("a superseded request cannot teleport, replace the active chunk or destroy the current one", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStage = true;
    const a = go(ids.music);
    await flush(); // A: fetched, validated, now inside the lock waiting to stage
    expect(runtime.log).toEqual(["stage:music"]);
    expect(orchestrator.isTransitioning).toBe(true);

    runtime.holdStage = false;
    const b = go(ids.fashion);
    await flush(); // B: fetched, validated, queued behind the lock
    expect(runtime.log).toEqual(["stage:music"]); // single writer: B has not started staging
    runtime.releaseStage();

    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(await b).toEqual({ status: "arrived", chunkKey: "fashion-culture", kind: "cross-chunk" });
    expect(orchestrator.activeChunkKey).toBe("fashion-culture");
    expect(runtime.placed).toEqual([spawn(ids.fashion)]);
    expect(runtime.liveOf(MUSIC)).toEqual([]);
    expect(runtime.liveOf(HUB)).toEqual([]);
    expect(runtime.liveOf(FASHION)).toEqual(Object.keys(FASHION.components));
    expect(runtime.log.filter((e) => e === "retire:hub")).toHaveLength(1);
    expect(runtime.log.indexOf("stage:fashion-culture")).toBeGreaterThan(runtime.log.indexOf("stage:music"));
    expect(orchestrator.isTransitioning).toBe(false);
  });

  it("retires components a stale request had already fully created", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStageEnd = true;
    const a = go(ids.music);
    await flush();
    expect(runtime.liveOf(MUSIC)).toEqual(Object.keys(MUSIC.components)); // created before anyone aborted
    runtime.holdStageEnd = false;
    const b = go(ids.fashion);
    await flush();
    runtime.releaseStage();
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(await b).toMatchObject({ status: "arrived", chunkKey: "fashion-culture" });
    expect(runtime.liveOf(MUSIC)).toEqual([]);
    expect(runtime.log).toContain("retire:music");
    expect(runtime.placed).toEqual([spawn(ids.fashion)]);
  });

  it("rapid A → B → C ends at C with exactly one active chunk and one teleport", async () => {
    const { runtime, source, orchestrator, go } = await atHub();
    runtime.createDelayMs = 1;
    const [a, b, c] = await Promise.all([go(ids.music), go(ids.fashion), go(ids.artist)]);
    expect(a.status).toBe("superseded");
    expect(b.status).toBe("superseded");
    expect(c).toEqual({ status: "arrived", chunkKey: "music", kind: "cross-chunk" });
    expect(orchestrator.activeChunkKey).toBe("music");
    expect(runtime.placed).toEqual([spawn(ids.artist)]);
    expect(runtime.liveOf(MUSIC)).toEqual(Object.keys(MUSIC.components));
    expect(runtime.liveOf(FASHION)).toEqual([]);
    expect(runtime.liveOf(HUB)).toEqual([]);
    expect(runtime.batches.size).toBe(1);
    // No cache yet: every request fetched (order of requests is the order of the calls).
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["music", "fashion-culture", "music"]);
  });

  it("an aborted in-flight fetch is reported as superseded, never as a failure", async () => {
    const { runtime, orchestrator, go } = setup({
      ...GENERATED,
      music: (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(abortError()));
        }),
    });
    await go(ids.hub);
    const a = go(ids.music);
    await flush();
    const b = go(ids.fashion);
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(await b).toMatchObject({ status: "arrived", chunkKey: "fashion-culture" });
    expect(orchestrator.activeChunkKey).toBe("fashion-culture");
    expect(runtime.liveOf(HUB)).toEqual([]);
  });

  it("a same-chunk request supersedes an in-flight cross-chunk transition", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStage = true;
    const a = go(ids.music);
    await flush();
    runtime.holdStage = false;
    const b = await go(ids.hub); // same chunk as the active one: immediate teleport
    expect(b).toEqual({ status: "arrived", chunkKey: "hub", kind: "same-chunk" });
    runtime.releaseStage();
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(orchestrator.activeChunkKey).toBe("hub");
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
    expect(runtime.liveOf(MUSIC)).toEqual([]);
    expect(runtime.placed).toEqual([spawn(ids.hub)]);
  });
});

/**
 * M0 Step 2B.4A — asynchronous shutdown contract. `dispose()` immediately refuses new work and
 * aborts the in-flight request, then WAITS for the mutation queue to settle before retiring the
 * active chunk (exactly once, as the last mutation); it resolves only when no batch this
 * orchestrator created can still exist. Every test uses explicit holds — no timing sleeps.
 */
describe("chunk orchestrator — asynchronous shutdown contract", () => {
  const settledFlag = (promise: Promise<unknown>) => {
    const state = { settled: false };
    void promise.then(() => (state.settled = true));
    return state;
  };
  const retireCount = (log: string[], key: string) => log.filter((e) => e === `retire:${key}`).length;

  it("dispose during an in-flight fetch: the fetch is aborted, nothing is staged, the active chunk is retired once", async () => {
    let aborted = false;
    const { runtime, source, orchestrator, go } = setup({
      ...GENERATED,
      music: (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(abortError());
          });
        }),
    });
    await go(ids.hub);
    runtime.log.length = 0;
    const a = go(ids.music);
    await flush();
    expect(source.requests.map((r) => r.chunkKey)).toEqual(["hub", "music"]);

    const disposal = orchestrator.dispose();
    expect(aborted).toBe(true); // synchronously
    expect(orchestrator.isReady).toBe(false);
    expect(orchestrator.isDisposed).toBe(true);
    await disposal;
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(runtime.log.filter((e) => e.startsWith("stage:"))).toEqual([]);
    expect(retireCount(runtime.log, "hub")).toBe(1);
    expect(orchestrator.activeChunkKey).toBeNull();
    expect(runtime.world.size).toBe(0);
    expect(runtime.batches.size).toBe(0);
  });

  it("dispose while a request waits to enter the mutation lock: it never stages; shutdown waits for the request holding the lock", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStage = true;
    const a = go(ids.music); // enters the lock, staging held
    await flush();
    runtime.holdStage = false;
    const b = go(ids.fashion); // fetched + validated, queued behind the lock
    await flush();
    expect(runtime.log).toEqual(["stage:music"]);

    const disposal = orchestrator.dispose();
    const flag = settledFlag(disposal);
    await flush(5);
    expect(flag.settled).toBe(false); // A still holds the lock
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components)); // active chunk untouched until the queue settles
    runtime.releaseStage();
    await disposal;
    expect(flag.settled).toBe(true);
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(await b).toEqual({ status: "superseded", chunkKey: "fashion-culture" });
    expect(runtime.log.filter((e) => e.startsWith("stage:"))).toEqual(["stage:music"]); // B never staged
    expect(retireCount(runtime.log, "hub")).toBe(1);
    expect(runtime.world.size).toBe(0);
    expect(runtime.batches.size).toBe(0);
  });

  it("dispose while stageChunk is resolving: waits for it, the fully created batch is retired before shutdown resolves, active retired once", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStageEnd = true;
    const a = go(ids.music);
    await flush();
    expect(runtime.liveOf(MUSIC)).toEqual(Object.keys(MUSIC.components)); // every target component exists already

    const disposal = orchestrator.dispose();
    const flag = settledFlag(disposal);
    await flush(5);
    expect(flag.settled).toBe(false);
    expect(runtime.liveOf(MUSIC)).toEqual(Object.keys(MUSIC.components)); // nothing destroyed while the stage is unsettled
    expect(runtime.liveOf(HUB)).toEqual(Object.keys(HUB.components));
    runtime.holdStageEnd = false;
    runtime.releaseStage();
    await disposal;
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    // The stale batch cleaned itself BEFORE the active chunk was retired, and both are gone.
    expect(runtime.log.indexOf("retire:music")).toBeGreaterThanOrEqual(0);
    expect(runtime.log.indexOf("retire:hub")).toBeGreaterThan(runtime.log.indexOf("retire:music"));
    expect(retireCount(runtime.log, "hub")).toBe(1);
    expect(retireCount(runtime.log, "music")).toBe(1);
    expect(runtime.placed).toEqual([]); // the stale request never teleported
    expect(runtime.world.size).toBe(0);
    expect(runtime.batches.size).toBe(0);
    expect(orchestrator.activeChunkKey).toBeNull();
  });

  it("a batch whose components are created just before the abort is observed is cleaned before shutdown resolves", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStage = true;
    const a = go(ids.music);
    await flush();
    const disposal = orchestrator.dispose(); // abort fires while the stage is held before creation
    runtime.holdStage = false;
    runtime.releaseStage();
    await disposal;
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(runtime.liveOf(MUSIC)).toEqual([]); // the batch helper rolled the aborted creation back
    expect(runtime.world.size).toBe(0);
    expect(runtime.batches.size).toBe(0);
  });

  it("dispose with no work in flight retires the active chunk once and resolves", async () => {
    const { runtime, orchestrator } = await atHub();
    await orchestrator.dispose();
    expect(runtime.log).toEqual(["retire:hub", ...Object.keys(HUB.components).map((id) => `destroy:${id}`)]);
    expect(runtime.world.size).toBe(0);
    expect(orchestrator.activeChunkKey).toBeNull();
  });

  it("is idempotent: every call returns the same promise, the active chunk is retired exactly once, and calls after settlement resolve", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStage = true;
    const a = go(ids.music);
    await flush();
    const first = orchestrator.dispose();
    const second = orchestrator.dispose();
    expect(second).toBe(first);
    runtime.holdStage = false;
    runtime.releaseStage();
    await first;
    await a;
    await orchestrator.dispose();
    await orchestrator.dispose();
    expect(retireCount(runtime.log, "hub")).toBe(1);
    expect(runtime.world.size).toBe(0);
  });

  it("refuses transitions structurally after dispose, before and after settlement, without touching the runtime", async () => {
    const { runtime, source, orchestrator, go } = await atHub();
    const disposal = orchestrator.dispose();
    expect(await go(ids.music)).toEqual({ status: "failed", chunkKey: "music", step: "place", reason: "chunk orchestrator is disposed" });
    await disposal;
    expect(await go(ids.music)).toMatchObject({ status: "failed", reason: expect.stringMatching(/disposed/) });
    expect(await go(ids.hub)).toMatchObject({ status: "failed", reason: expect.stringMatching(/disposed/) }); // even the former active chunk
    expect(source.requests).toEqual([]);
    expect(runtime.placed).toEqual([]);
    expect(runtime.log.filter((e) => e.startsWith("stage:"))).toEqual([]);
  });

  it("a retire failure during shutdown is reported and does not leave the shutdown promise hanging", async () => {
    const { runtime, orchestrator, warnings, go } = await atHub();
    runtime.holdStageEnd = true;
    const a = go(ids.music);
    await flush();
    const disposal = orchestrator.dispose();
    runtime.holdStageEnd = false;
    runtime.failRetire = "renderer refused (stale target)"; // consumed by the stale batch's own retire
    runtime.releaseStage();
    await disposal;
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(warnings).toEqual([expect.stringMatching(/could not fully retire superseded target \("music"\)/)]);
    expect(runtime.world.size).toBe(0); // the fake removes components before throwing
    expect(runtime.batches.size).toBe(0);
  });

  it("a retire failure of the active chunk is reported and shutdown still resolves", async () => {
    const { runtime, orchestrator, warnings } = await atHub();
    runtime.failRetire = "renderer refused";
    await orchestrator.dispose();
    expect(warnings).toEqual([expect.stringMatching(/could not fully retire active chunk on dispose \("hub"\)/)]);
    expect(orchestrator.activeChunkKey).toBeNull();
    expect(runtime.batches.size).toBe(0);
  });

  it("an interrupted staging that rejects with a real error (not an abort) is reported as superseded and shutdown resolves", async () => {
    const { runtime, orchestrator, go } = await atHub();
    runtime.holdStage = true;
    const a = go(ids.music);
    await flush();
    runtime.failCreate["label-music"] = "font missing";
    const disposal = orchestrator.dispose();
    runtime.holdStage = false;
    runtime.releaseStage();
    await disposal;
    expect(await a).toEqual({ status: "superseded", chunkKey: "music" });
    expect(runtime.liveOf(MUSIC)).toEqual([]);
    expect(runtime.world.size).toBe(0);
  });

  it("never leaks an unhandled rejection from the mutation queue during shutdown", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { runtime, orchestrator, go } = await atHub();
      runtime.holdStage = true;
      const a = go(ids.music);
      await flush();
      runtime.failCreate["label-music"] = "font missing";
      runtime.failRetire = "renderer refused";
      const disposal = orchestrator.dispose();
      runtime.holdStage = false;
      runtime.releaseStage();
      await disposal;
      await a;
      await flush(5);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});
