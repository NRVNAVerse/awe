import { describe, expect, it } from "vitest";
import { GENERATED_FILE_NAMES, generateViews, serializeView } from "../src/generate";
import { checkGeneratedViews, generateFromSource, loadSourceManifests } from "../src/node/manifests-fs";
import { SLUGS, bySlug, loadSeven } from "./support/helpers";

describe("generated views", () => {
  it("are deterministic across runs and input order", () => {
    const { manifests } = loadSourceManifests();
    const a = generateViews(manifests);
    const b = generateViews(manifests);
    const c = generateViews([...manifests].reverse());
    for (const name of GENERATED_FILE_NAMES) {
      expect(serializeView(a[name])).toBe(serializeView(b[name]));
      expect(serializeView(a[name])).toBe(serializeView(c[name]));
    }
  });

  it("match the committed files (run the generate script if this fails)", () => {
    const check = checkGeneratedViews(generateFromSource());
    expect(check.stale).toEqual([]);
    expect(check.upToDate).toBe(true);
  });

  it("derive directory.json from the seven manifests", () => {
    const seven = loadSeven();
    const views = generateViews(seven);
    const directory = views["directory.json"];
    expect(directory.hub.id).toBe(bySlug(seven, SLUGS.hub).id);
    expect(directory.districts.map((d) => d.slug).sort()).toEqual([SLUGS.cannabis, SLUGS.fashion, SLUGS.music].sort());
    const cannabis = directory.districts.find((d) => d.slug === SLUGS.cannabis)!;
    expect(cannabis.gates).toEqual(["age21"]);
    expect(cannabis.minimumAge).toBe(21);
    expect(cannabis.destinations.map((d) => d.slug)).toEqual([SLUGS.farms]);
    expect(directory.unassigned).toEqual([]);
  });

  it("derive destinations.json indexes that resolve to identity", () => {
    const seven = loadSeven();
    const views = generateViews(seven);
    const file = views["destinations.json"];
    expect(file.destinations).toHaveLength(7);
    expect(file.hubId).toBe(bySlug(seven, SLUGS.hub).id);
    for (const d of seven) {
      expect(file.index.bySlug[d.slug]).toBe(d.id);
      expect(file.index.byAnalyticsId[d.analyticsId]).toBe(d.id);
    }
    const ids = file.destinations.map((d) => d.id);
    expect(ids).toEqual([...ids].sort());
    expect(file.destinations[0].spatialUrl).toBe(`https://worlds.nrvnaverse.com/?destination=${ids[0]}`);
  });

  it("exclude non-public destinations from the directory but keep them in destinations.json", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.artist).status = "hidden";
    const views = generateViews(seven);
    const music = views["directory.json"].districts.find((d) => d.slug === SLUGS.music)!;
    expect(music.destinations).toEqual([]);
    expect(views["destinations.json"].destinations.map((d) => d.slug)).toContain(SLUGS.artist);
  });

  it("refuse to generate from an invalid set", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.artist).primaryDistrictId = "dst_0000000000000000";
    expect(() => generateViews(seven)).toThrow(/missing-primary-district/);
  });
});
