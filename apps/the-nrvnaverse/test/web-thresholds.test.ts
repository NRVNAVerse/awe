import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { OUTPUT, generateSpatialArtifacts, validateSpatialSource, type SpatialSourceInput } from "../scripts/spatial/pipeline.mjs";
import { parseChunkPayload } from "@/lib/spatial/chunk-payload";
import { SPATIAL_SCHEMA_VERSION, parseSpatialIndex } from "@/lib/spatial/spatial-index";
import { ThresholdController } from "@/lib/web/threshold-controller";
import { dismissWebContext, resetWebContext, setThresholdContext, webContextPath, webContextStore } from "@/lib/web/web-context-store";
import { generatedChunks, spatialIndexJson } from "./support/generated-spatial";
import { FakeChunkRuntime, flush } from "./support/fake-chunk-runtime";

/**
 * WEB↔SPATIAL thresholds (M1 experience campaign, D-020): `thresholds[]` in the authoritative
 * source (portal-shaped, never a portal sensor) → `thresholds` in the index → the
 * ThresholdController turning sensor enter / exit into a stable-id web context → the web-context
 * store the shell window reads. No URL anywhere in the bindings; the canonical `webUrl` is
 * resolved from the manifest at display time.
 */

const APP_ROOT = resolve(__dirname, "..");
const SOURCE_DIR = join(APP_ROOT, "spatial", "source");
type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const readJson = <T = Mutable>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const sourceConfig = readJson(join(SOURCE_DIR, "spatial-config.m0.json"));
const sourceScene = readJson(join(SOURCE_DIR, sourceConfig.scene));
const destinations = destinationsJson as unknown as DestinationsFile;
const bySlug = destinations.index.bySlug;
const index = parseSpatialIndex(spatialIndexJson);

function source(mutate?: (draft: { config: Mutable; scene: Mutable }) => void): SpatialSourceInput {
  const draft = { config: structuredClone(sourceConfig), scene: structuredClone(sourceScene) };
  mutate?.(draft);
  return { config: draft.config, scene: draft.scene, destinations };
}
const codesOf = (input: SpatialSourceInput) => {
  const result = validateSpatialSource(input);
  return result.ok ? [] : result.errors.map((e) => e.code);
};

const THRESHOLDS: Record<string, { chunkKey: string; slug: string }> = {
  "club-threshold-bar": { chunkKey: "music-club", slug: "music-club" },
  "fashion-threshold-brand": { chunkKey: "fashion-culture", slug: "placeholder-fashion-culture-brand" },
  "music-threshold-club": { chunkKey: "music", slug: "music-club" },
};
const THRESHOLD_IDS = Object.keys(THRESHOLDS).sort();

describe("spatial source — thresholds validate and generate", () => {
  it("the committed source declares the three thresholds and validates; none is a portal sensor", () => {
    expect(validateSpatialSource(source())).toEqual({ ok: true, errors: [] });
    expect(sourceConfig.thresholds.map((t: Mutable) => t.componentId).sort()).toEqual(THRESHOLD_IDS);
    const portalIds = new Set(sourceConfig.portals.map((p: Mutable) => p.componentId));
    for (const t of sourceConfig.thresholds) {
      expect(Object.keys(t).sort()).toEqual(["chunkKey", "componentId", "destinationId"]);
      expect(portalIds.has(t.componentId)).toBe(false);
      expect(t.chunkKey).toBe(THRESHOLDS[t.componentId].chunkKey);
      expect(t.destinationId).toBe(bySlug[THRESHOLDS[t.componentId].slug]);
    }
  });

  it("generates a sorted thresholds section keyed by sensor id, and the sensor is plain hidden geometry in its chunk payload", () => {
    const artifacts = generateSpatialArtifacts(source());
    const generated = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    expect(Object.keys(generated)).toEqual(["schemaVersion", "worldId", "globalSceneUrl", "chunks", "destinations", "portals", "experience", "thresholds"]);
    expect(Object.keys(generated.thresholds)).toEqual(THRESHOLD_IDS);
    expect(artifacts.thresholdComponentIds).toEqual(THRESHOLD_IDS);
    for (const [componentId, binding] of Object.entries<Mutable>(generated.thresholds)) {
      const chunk = JSON.parse(artifacts.files[artifacts.chunkFiles[binding.chunkKey]]);
      const sensor = chunk.components[componentId];
      expect(sensor.collider).toMatchObject({ enabled: true, isSensor: true });
      expect(sensor.display).toBe(false);
      expect(JSON.stringify(sensor)).not.toMatch(/dst_|webUrl|http/);
    }
    expect(JSON.stringify(generated.thresholds)).not.toMatch(/http|webUrl|position/);
    const reversed = generateSpatialArtifacts(source((d) => d.config.thresholds.reverse())).files[OUTPUT.spatialIndex];
    expect(reversed).toBe(artifacts.files[OUTPUT.spatialIndex]);
  });

  it("is optional and additive", () => {
    const input = source((d) => delete d.config.thresholds);
    expect(validateSpatialSource(input)).toEqual({ ok: true, errors: [] });
    const generated = JSON.parse(generateSpatialArtifacts(input).files[OUTPUT.spatialIndex]);
    expect(generated.thresholds).toEqual({});
    expect(generated.schemaVersion).toBe(SPATIAL_SCHEMA_VERSION);
  });

  it("rejects a portal sensor, a global or missing component, a non-sensor, a wrong chunk, a duplicate, an unknown destination and extra fields", () => {
    const t = (d: { config: Mutable }) => d.config.thresholds[0];
    expect(codesOf(source((d) => (t(d).componentId = "portal-hub-music")))).toContain("threshold-is-portal");
    expect(codesOf(source((d) => (t(d).componentId = "ground")))).toContain("global-threshold-component");
    expect(codesOf(source((d) => (t(d).componentId = "nowhere")))).toContain("unknown-component");
    expect(codesOf(source((d) => (t(d).componentId = "club-bar")))).toContain("threshold-not-sensor");
    expect(codesOf(source((d) => (t(d).chunkKey = "hub")))).toContain("threshold-chunk-mismatch");
    expect(codesOf(source((d) => d.config.thresholds.push({ ...t(d) })))).toContain("duplicate-threshold");
    expect(codesOf(source((d) => (t(d).destinationId = "dst_zzzzzzzzzzzzzzzz")))).toContain("unknown-destination");
    expect(codesOf(source((d) => (t(d).url = "https://example.com")))).toContain("unexpected-field");
    expect(codesOf(source((d) => (d.config.thresholds = {})))).toContain("invalid-thresholds");
  });
});

describe("generated spatial index → thresholds (runtime parser)", () => {
  it("parses the committed thresholds and rejects malformed ones", () => {
    expect(Object.keys(index.thresholds)).toEqual(THRESHOLD_IDS);
    expect(index.thresholds["music-threshold-club"]).toEqual({ chunkKey: "music", destinationId: bySlug["music-club"] });
    const mutated = (mutate: (d: Mutable) => void) => {
      const draft = structuredClone(spatialIndexJson) as Mutable;
      mutate(draft);
      return draft;
    };
    expect(parseSpatialIndex(mutated((d) => delete d.thresholds)).thresholds).toEqual({});
    expect(() => parseSpatialIndex(mutated((d) => (d.thresholds["portal-hub-music"] = { chunkKey: "hub", destinationId: bySlug["music"] })))).toThrow(/is a portal sensor/);
    expect(() => parseSpatialIndex(mutated((d) => (d.thresholds["music-threshold-club"].chunkKey = "nowhere")))).toThrow(/unknown chunk/);
    expect(() => parseSpatialIndex(mutated((d) => (d.thresholds["music-threshold-club"].destinationId = "club")))).toThrow(/not a stable destination id/);
  });
});

describe("threshold controller — enter / exit → web context", () => {
  const signal = () => new AbortController().signal;
  const MUSIC = parseChunkPayload(generatedChunks["music"], { worldId: index.worldId, chunkKey: "music" });
  const CLUB = parseChunkPayload(generatedChunks["music-club"], { worldId: index.worldId, chunkKey: "music-club" });

  function setup() {
    const runtime = new FakeChunkRuntime();
    const events: Array<string | null> = [];
    const controller = new ThresholdController({ thresholds: index.thresholds, sensors: runtime, onThreshold: (id) => events.push(id), warn: () => {} });
    return { runtime, controller, events };
  }

  it("binds exactly the active chunk's thresholds (enter + exit) and follows a chunk switch", async () => {
    const { runtime, controller } = setup();
    const music = await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    expect(controller.boundComponentIds).toEqual(["music-threshold-club"]);
    expect(runtime.sensorListenerCount("music-threshold-club")).toBe(1);
    expect(runtime.sensorExitListenerCount("music-threshold-club")).toBe(1);
    const club = await runtime.stageChunk(CLUB, signal());
    runtime.retireChunk(music);
    controller.activate("music-club");
    expect(controller.boundComponentIds).toEqual(["club-threshold-bar"]);
    controller.activate("music-club");
    expect(runtime.sensorListenerCount("club-threshold-bar")).toBe(1);
    runtime.retireChunk(club);
    controller.activate("hub");
    expect(controller.boundComponentIds).toEqual([]);
  });

  it("entering surfaces the stable id, leaving clears it; leaving a threshold you are not in changes nothing", async () => {
    const { runtime, controller, events } = setup();
    await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    runtime.enterSensor("music-threshold-club");
    await flush();
    expect(events).toEqual([bySlug["music-club"]]);
    expect(controller.current).toEqual({ componentId: "music-threshold-club", destinationId: bySlug["music-club"] });
    runtime.exitSensor("music-threshold-club");
    await flush();
    expect(events).toEqual([bySlug["music-club"], null]);
    expect(controller.current).toBeNull();
    runtime.exitSensor("music-threshold-club"); // not inside
    await flush();
    expect(events).toHaveLength(2);
  });

  it("a chunk switch while inside a threshold closes the context (teleported out without a sensor exit); dispose does too", async () => {
    const { runtime, controller, events } = setup();
    const music = await runtime.stageChunk(MUSIC, signal());
    controller.activate("music");
    runtime.enterSensor("music-threshold-club");
    await flush();
    const club = await runtime.stageChunk(CLUB, signal());
    runtime.retireChunk(music);
    controller.activate("music-club");
    expect(events).toEqual([bySlug["music-club"], null]);
    runtime.enterSensor("club-threshold-bar");
    await flush();
    expect(events.at(-1)).toBe(bySlug["music-club"]);
    controller.dispose();
    expect(events.at(-1)).toBeNull();
    expect(controller.boundComponentIds).toEqual([]);
    runtime.retireChunk(club);
  });

  it("never travels, never holds a URL", () => {
    const text = readFileSync(join(APP_ROOT, "src/lib/web/threshold-controller.ts"), "utf8");
    expect(text).not.toMatch(/travelTo\(|placeVisitor\(|fetch\(|https?:\/\/|\.webUrl\b|location\.|history\./);
  });
});

describe("web-context store", () => {
  beforeEach(() => resetWebContext());
  afterEach(() => resetWebContext());

  it("threshold enter sets the context, exit clears it, dismiss keeps it closed until re-entry", () => {
    setThresholdContext(bySlug["music-club"], "music-threshold-club");
    expect(webContextStore.state).toEqual({ destinationId: bySlug["music-club"], source: "threshold", dismissedComponentId: null });
    dismissWebContext("music-threshold-club");
    expect(webContextStore.state.destinationId).toBeNull();
    setThresholdContext(bySlug["music-club"], "music-threshold-club"); // still inside: stays closed
    expect(webContextStore.state.destinationId).toBeNull();
    setThresholdContext(null, null); // left
    setThresholdContext(bySlug["music-club"], "music-threshold-club"); // re-entered
    expect(webContextStore.state.destinationId).toBe(bySlug["music-club"]);
  });

  it("the window frame path is same-origin and stable-id based", () => {
    expect(webContextPath("dst_gqq90k2404cy9nf0")).toBe("/web-context/dst_gqq90k2404cy9nf0");
  });
});
