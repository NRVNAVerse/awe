import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { OUTPUT, experienceIndexOf, generateSpatialArtifacts, validateSpatialSource, type SpatialSourceInput } from "../scripts/spatial/pipeline.mjs";
import { SPATIAL_SCHEMA_VERSION, parseSpatialIndex } from "@/lib/spatial/spatial-index";
import { spatialIndexJson } from "./support/generated-spatial";

/**
 * Experience bindings (M1 experience campaign): authoritative `experience` section of the spatial
 * config → validation (references only) → deterministic `experience` section of the spatial index →
 * runtime parser. Uses the real committed source; every negative case mutates a deep copy.
 */

const APP_ROOT = resolve(__dirname, "..");
const SOURCE_DIR = join(APP_ROOT, "spatial", "source");
type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const readJson = <T = Mutable>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const sourceConfig = readJson(join(SOURCE_DIR, "spatial-config.m0.json"));
const sourceScene = readJson(join(SOURCE_DIR, sourceConfig.scene));
const destinations = destinationsJson as unknown as DestinationsFile;

function source(mutate?: (draft: { config: Mutable; scene: Mutable }) => void): SpatialSourceInput {
  const draft = { config: structuredClone(sourceConfig), scene: structuredClone(sourceScene) };
  mutate?.(draft);
  return { config: draft.config, scene: draft.scene, destinations, layers: { city: JSON.parse(readFileSync(join(SOURCE_DIR, "city-layer.m2.json"), "utf8")) } };
}

const codesOf = (input: SpatialSourceInput) => {
  const result = validateSpatialSource(input);
  return result.ok ? [] : result.errors.map((e) => e.code);
};

const ZONE_IDS = ["club-floor", "club-stage", "fashion-atelier", "fashion-loggia", "fashion-roof", "fashion-walk-1", "fashion-walk-2", "fashion-walk-3", "hub-core", "hub-overlook", "music-booth", "music-walk-north", "music-walk-south", "north-roof", "plaza-landing"];
const ARRIVAL_IDS = ["club-wake", "fashion-brand-welcome", "hub-return-fashion", "hub-return-music", "hub-wake", "music-floor-reset", "music-stage-crescendo"];

describe("spatial source — experience bindings validate and generate deterministically", () => {
  it("the committed source carries hidden sets for the five composed chunks (M2: Skyfall Plaza, the North Row roof garden), 15 zones and 7 arrivals, and validates", () => {
    expect(validateSpatialSource(source())).toEqual({ ok: true, errors: [] });
    expect(Object.keys(sourceConfig.experience)).toEqual(["hidden", "zones", "arrivals"]);
    expect(sourceConfig.experience.hidden.map((h: Mutable) => h.chunkKey)).toEqual(["city-north", "city-plaza", "fashion-culture", "hub", "music", "music-club"]);
    expect(sourceConfig.experience.zones.map((z: Mutable) => z.id)).toEqual(ZONE_IDS);
    expect(sourceConfig.experience.arrivals.map((a: Mutable) => a.id)).toEqual(ARRIVAL_IDS);
  });

  it("generates the experience section keyed by zone / arrival id with sorted lists, independent of authoring order", () => {
    const artifacts = generateSpatialArtifacts(source());
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    expect(Object.keys(index)).toEqual(["schemaVersion", "worldId", "globalSceneUrl", "chunks", "destinations", "portals", "experience", "thresholds", "layers", "streaming"]);
    expect(Object.keys(index.experience)).toEqual(["hidden", "zones", "arrivals"]);
    expect(Object.keys(index.experience.zones)).toEqual(ZONE_IDS);
    expect(Object.keys(index.experience.arrivals)).toEqual(ARRIVAL_IDS);
    expect(artifacts.experienceZoneIds).toEqual(ZONE_IDS);
    expect(artifacts.experienceArrivalIds).toEqual(ARRIVAL_IDS);
    for (const ids of Object.values<string[]>(index.experience.hidden)) expect(ids).toEqual([...ids].sort());
    for (const zone of Object.values<Mutable>(index.experience.zones)) {
      for (const effect of [zone.enter, zone.exit]) {
        if (!effect) continue;
        for (const list of [effect.show, effect.hide]) if (list) expect(list).toEqual([...list].sort());
      }
    }
    const reversed = generateSpatialArtifacts(
      source((d) => {
        d.config.experience.zones.reverse();
        d.config.experience.arrivals.reverse();
        d.config.experience.hidden.reverse();
        for (const h of d.config.experience.hidden) h.componentIds.reverse();
      }),
    ).files[OUTPUT.spatialIndex];
    expect(reversed).toBe(artifacts.files[OUTPUT.spatialIndex]);
    expect(JSON.parse(artifacts.files[OUTPUT.spatialIndex]).experience).toEqual(experienceIndexOf(sourceConfig.experience));
  });

  it("the committed index matches a fresh generation (experience included)", () => {
    const artifacts = generateSpatialArtifacts(source());
    expect(JSON.parse(artifacts.files[OUTPUT.spatialIndex]).experience).toEqual((spatialIndexJson as Mutable).experience);
  });

  it("is optional and additive: a source without experience validates and yields empty sets; the schema version is unchanged", () => {
    const input = source((d) => delete d.config.experience);
    expect(validateSpatialSource(input)).toEqual({ ok: true, errors: [] });
    const index = JSON.parse(generateSpatialArtifacts(input).files[OUTPUT.spatialIndex]);
    expect(index.schemaVersion).toBe(SPATIAL_SCHEMA_VERSION);
    expect(index.experience).toEqual({ hidden: {}, zones: {}, arrivals: {} });
    expect(experienceIndexOf(undefined)).toEqual({ hidden: {}, zones: {}, arrivals: {} });
  });

  it("zone sensors are enabled, invisible sensor meshes owned by their chunk, and chunk payloads carry them as plain geometry", () => {
    const artifacts = generateSpatialArtifacts(source());
    const index = JSON.parse(artifacts.files[OUTPUT.spatialIndex]);
    for (const [zoneId, zone] of Object.entries<Mutable>(index.experience.zones)) {
      const chunk = JSON.parse(artifacts.files[artifacts.chunkFiles[zone.chunkKey]]);
      const sensor = chunk.components[zone.sensorId];
      expect(sensor, zoneId).toBeDefined();
      expect(sensor.collider).toMatchObject({ enabled: true, isSensor: true });
      expect(sensor.display).toBe(false);
      expect(JSON.stringify(sensor)).not.toMatch(/dst_|destinationId|zone\b.*effect|show|hide/);
      // Every target of the zone lives in the same chunk payload.
      for (const effect of [zone.enter, zone.exit]) {
        if (!effect) continue;
        for (const id of [...(effect.show ?? []), ...(effect.hide ?? [])]) expect(chunk.components[id], `${zoneId} → ${id}`).toBeDefined();
      }
    }
    for (const [arrivalId, arrival] of Object.entries<Mutable>(index.experience.arrivals)) {
      const chunkKey = index.destinations[arrival.destinationId].chunkKey;
      const chunk = JSON.parse(artifacts.files[artifacts.chunkFiles[chunkKey]]);
      for (const beat of arrival.beats) for (const id of [...(beat.show ?? []), ...(beat.hide ?? [])]) expect(chunk.components[id], `${arrivalId} → ${id}`).toBeDefined();
    }
  });

  it("keeps the portals last in every composed chunk (asset:place appends after the final portal)", () => {
    for (const chunk of sourceConfig.chunks as Mutable[]) {
      const portalIds = chunk.componentIds.filter((id: string) => id.startsWith("portal-"));
      if (portalIds.length === 0) continue;
      expect(chunk.componentIds.slice(-portalIds.length)).toEqual(portalIds);
    }
  });
});

describe("spatial source — experience validation rejects", () => {
  it("a malformed section, unknown fields and non-kebab ids", () => {
    expect(codesOf(source((d) => (d.config.experience = [])))).toContain("invalid-experience");
    expect(codesOf(source((d) => (d.config.experience.triggers = [])))).toContain("unexpected-field");
    expect(codesOf(source((d) => (d.config.experience.zones[0].id = "Hub Core")))).toContain("invalid-experience-id");
    expect(codesOf(source((d) => (d.config.experience.zones[0].spawn = { x: 0 })))).toContain("unexpected-field");
    expect(codesOf(source((d) => (d.config.experience.arrivals[0].url = "https://example.com")))).toContain("unexpected-field");
  });

  it("duplicate zone / arrival ids and a sensor bound by two zones", () => {
    expect(codesOf(source((d) => (d.config.experience.zones[1].id = d.config.experience.zones[0].id)))).toContain("duplicate-experience-id");
    expect(codesOf(source((d) => (d.config.experience.arrivals[1].id = d.config.experience.arrivals[0].id)))).toContain("duplicate-experience-id");
    expect(codesOf(source((d) => (d.config.experience.zones[1].sensorId = d.config.experience.zones[0].sensorId)))).toContain("duplicate-zone-sensor");
  });

  it("a zone whose sensor is missing, global, not a sensor, a portal, or owned by another chunk", () => {
    const zone = (d: { config: Mutable }) => d.config.experience.zones.find((z: Mutable) => z.id === "hub-core");
    expect(codesOf(source((d) => (zone(d).sensorId = "nowhere")))).toContain("unknown-component");
    expect(codesOf(source((d) => (zone(d).sensorId = "ground")))).toContain("global-zone-sensor");
    expect(codesOf(source((d) => (zone(d).sensorId = "hub-core-seat")))).toContain("zone-not-sensor");
    expect(codesOf(source((d) => (zone(d).sensorId = "portal-hub-music")))).toContain("zone-sensor-is-portal");
    expect(codesOf(source((d) => (zone(d).chunkKey = "music")))).toContain("experience-chunk-mismatch");
    expect(codesOf(source((d) => (zone(d).chunkKey = "nowhere")))).toContain("unknown-chunk");
    expect(codesOf(source((d) => delete zone(d).enter))).not.toContain("invalid-experience-zone"); // exit alone is enough
    expect(
      codesOf(
        source((d) => {
          delete zone(d).enter;
          delete zone(d).exit;
        }),
      ),
    ).toContain("invalid-experience-zone");
  });

  it("effects that target a portal, a global component, another chunk's component, nothing, or the same id twice", () => {
    const zone = (d: { config: Mutable }) => d.config.experience.zones.find((z: Mutable) => z.id === "hub-core");
    expect(codesOf(source((d) => (zone(d).enter.show = ["portal-hub-music"])))).toContain("experience-targets-portal");
    expect(codesOf(source((d) => (zone(d).enter.show = ["ground"])))).toContain("global-experience-target");
    expect(codesOf(source((d) => (zone(d).enter.show = ["music-stage-wash"])))).toContain("experience-chunk-mismatch");
    expect(codesOf(source((d) => (zone(d).enter.show = [])))).toContain("invalid-experience-targets");
    expect(codesOf(source((d) => (zone(d).enter = {})))).toContain("invalid-experience-effect");
    expect(codesOf(source((d) => (zone(d).enter = { show: ["hub-core-halo"], hide: ["hub-core-halo"] })))).toContain("experience-effect-conflict");
    expect(codesOf(source((d) => (zone(d).enter.show = ["hub-core-halo", "hub-core-halo"])))).toContain("duplicate-component-ref");
  });

  it("hidden sets: unknown chunk, two entries for one chunk, a portal or a global component", () => {
    expect(codesOf(source((d) => (d.config.experience.hidden[0].chunkKey = "nowhere")))).toContain("unknown-chunk");
    expect(codesOf(source((d) => d.config.experience.hidden.push({ chunkKey: "hub", componentIds: ["hub-core-halo"] })))).toContain("duplicate-experience-hidden");
    expect(codesOf(source((d) => d.config.experience.hidden.find((h: Mutable) => h.chunkKey === "hub").componentIds.push("portal-hub-music")))).toContain("experience-targets-portal");
    expect(codesOf(source((d) => d.config.experience.hidden.find((h: Mutable) => h.chunkKey === "hub").componentIds.push("ground")))).toContain("global-experience-target");
  });

  it("arrivals: unknown / unplaced / malformed destination, own-chunk fromChunkKey, unknown fromChunkKey, empty, unordered, negative or far-future beats", () => {
    const arrival = (d: { config: Mutable }) => d.config.experience.arrivals.find((a: Mutable) => a.id === "hub-wake");
    expect(codesOf(source((d) => (arrival(d).destinationId = "hub")))).toContain("invalid-destination-id");
    expect(codesOf(source((d) => (arrival(d).destinationId = "dst_zzzzzzzzzzzzzzzz")))).toContain("unknown-destination");
    expect(codesOf(source((d) => (arrival(d).fromChunkKey = "hub")))).toContain("invalid-experience-arrival");
    expect(codesOf(source((d) => (arrival(d).fromChunkKey = "nowhere")))).toContain("unknown-chunk");
    expect(codesOf(source((d) => (arrival(d).beats = [])))).toContain("invalid-experience-beats");
    expect(codesOf(source((d) => (arrival(d).beats[0].afterSeconds = 5)))).toContain("invalid-experience-beat"); // 5 > the next beat's 1.1
    expect(codesOf(source((d) => (arrival(d).beats[0].afterSeconds = -1)))).toContain("invalid-experience-beat");
    expect(codesOf(source((d) => (arrival(d).beats[2].afterSeconds = 120)))).toContain("invalid-experience-beat");
    expect(codesOf(source((d) => (arrival(d).beats[0].show = ["music-stage-wash"])))).toContain("experience-chunk-mismatch");
    // Retargeting the rule at a destination in another chunk: the destination is placed (no arrival
    // error of its own) but every Hub component it toggles now belongs to the wrong chunk.
    const retargeted = codesOf(source((d) => (arrival(d).destinationId = destinations.index.bySlug["cannabis-21"])));
    expect(retargeted).not.toContain("arrival-not-placed");
    expect(new Set(retargeted)).toEqual(new Set(["experience-chunk-mismatch"]));
  });

  it("does not generate anything from an invalid experience section", () => {
    expect(() => generateSpatialArtifacts(source((d) => (d.config.experience.zones[0].sensorId = "portal-hub-music")))).toThrow(/zone-sensor-is-portal/);
  });
});

describe("generated spatial index → experience bindings (runtime parser, additive)", () => {
  const mutated = (mutate: (draft: Mutable) => void): unknown => {
    const draft = structuredClone(spatialIndexJson) as Mutable;
    mutate(draft);
    return draft;
  };

  it("parses the committed experience section", () => {
    const index = parseSpatialIndex(spatialIndexJson);
    expect(Object.keys(index.experience.zones)).toEqual(ZONE_IDS);
    expect(Object.keys(index.experience.arrivals)).toEqual(ARRIVAL_IDS);
    expect(Object.keys(index.experience.hidden).sort()).toEqual(["city-north", "city-plaza", "fashion-culture", "hub", "music", "music-club"]);
    expect(index.experience.zones["hub-overlook"]).toEqual({
      chunkKey: "hub",
      sensorId: "hub-zone-overlook",
      enter: { show: ["hub-overlook-lamp-lit", "hub-overlook-lamp-pool"], hide: ["hub-overlook-lamp"] },
      exit: { show: ["hub-overlook-lamp"], hide: ["hub-overlook-lamp-lit", "hub-overlook-lamp-pool"] },
    });
    expect(index.experience.arrivals["hub-return-music"]).toMatchObject({ destinationId: destinations.hubId, fromChunkKey: "music" });
    expect(index.experience.arrivals["hub-wake"].beats.map((b) => b.afterSeconds)).toEqual([1.5, 2, 2.5]);
  });

  it("parses an index without an experience field as empty sets (schema version unchanged)", () => {
    const index = parseSpatialIndex(mutated((d) => delete d.experience));
    expect(index.schemaVersion).toBe(SPATIAL_SCHEMA_VERSION);
    expect(index.experience).toEqual({ hidden: {}, zones: {}, arrivals: {} });
  });

  it("rejects malformed bindings: unknown chunk, portal targets, portal sensors, unplaced arrival destinations, unordered beats", () => {
    expect(() => parseSpatialIndex(mutated((d) => (d.experience = [])))).toThrow(/experience must be an object/);
    expect(() => parseSpatialIndex(mutated((d) => (d.experience.hidden.nowhere = ["x"])))).toThrow(/unknown chunk "nowhere"/);
    expect(() => parseSpatialIndex(mutated((d) => d.experience.hidden.hub.push("portal-hub-music")))).toThrow(/portal sensor "portal-hub-music"/);
    expect(() => parseSpatialIndex(mutated((d) => (d.experience.zones["hub-core"].sensorId = "portal-hub-music")))).toThrow(/binds the portal sensor/);
    expect(() => parseSpatialIndex(mutated((d) => (d.experience.zones["hub-core"].chunkKey = "nowhere")))).toThrow(/unknown chunk "nowhere"/);
    expect(() => parseSpatialIndex(mutated((d) => (d.experience.zones["hub-core"].enter = {})))).toThrow(/shows and hides nothing/);
    expect(() => parseSpatialIndex(mutated((d) => (d.experience.arrivals["hub-wake"].destinationId = "dst_zzzzzzzzzzzzzzzz")))).toThrow(/unplaced destination/);
    expect(() => parseSpatialIndex(mutated((d) => (d.experience.arrivals["hub-wake"].beats[0].afterSeconds = 9)))).toThrow(/out of order/);
    expect(() => parseSpatialIndex(mutated((d) => (d.experience.arrivals["hub-wake"].beats = [])))).toThrow(/has no beats/);
  });

  it("the store hands the parsed experience bindings to the experience controller and declares the hidden sets before any chunk is staged", () => {
    const store = readFileSync(join(APP_ROOT, "src/lib/app-store.ts"), "utf8");
    expect(store).toMatch(/new ExperienceController\(\{\s*experience: spatialIndex\.experience,\s*runtime: bootRuntime,/);
    expect(store.indexOf("experience.install()")).toBeLessThan(store.indexOf("await bootRuntime.init("));
  });
});
