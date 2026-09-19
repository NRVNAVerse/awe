import { describe, expect, it } from "vitest";
import { createDestinationIndex, destinationsInDistrict, resolveDestination, resolveSlug } from "../src/resolve";
import { SLUGS, bySlug, loadSeven } from "./support/helpers";

describe("destination resolution", () => {
  it("resolves a stable id to the same destination regardless of slug", () => {
    const seven = loadSeven();
    const artist = bySlug(seven, SLUGS.artist);
    const id = artist.id;
    artist.slug = "renamed-artist";
    artist.previousSlugs = [SLUGS.artist];

    const index = createDestinationIndex(seven);
    const result = resolveDestination(index, id);
    expect(result.fallback).toBe(false);
    expect(result.reason).toBe("resolved");
    expect(result.destination.id).toBe(id);
    expect(result.destination.slug).toBe("renamed-artist");
  });

  it("falls back to the hub with a non-fatal reason for unknown ids", () => {
    const index = createDestinationIndex(loadSeven());
    const result = resolveDestination(index, "dst_0000000000000000");
    expect(result.destination.id).toBe(index.hub.id);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe("unknown");
    expect(result.requested).toBe("dst_0000000000000000");
  });

  it("falls back to the hub for malformed ids and reports the hub for a missing param", () => {
    const index = createDestinationIndex(loadSeven());
    expect(resolveDestination(index, "music")).toMatchObject({ fallback: true, reason: "invalid" });
    expect(resolveDestination(index, null)).toMatchObject({ fallback: false, reason: "missing" });
    expect(resolveDestination(index, "")).toMatchObject({ fallback: false, reason: "missing" });
  });

  it("does not enter hidden, draft or archived destinations", () => {
    for (const status of ["hidden", "draft", "archived"] as const) {
      const seven = loadSeven();
      const brand = bySlug(seven, SLUGS.brand);
      brand.status = status;
      const index = createDestinationIndex(seven);
      const result = resolveDestination(index, brand.id);
      expect(result.destination.id).toBe(index.hub.id);
      expect(result).toMatchObject({ fallback: true, reason: "not-public" });
    }
  });

  it("resolves previous slugs with a redirect to the current slug", () => {
    const seven = loadSeven();
    const artist = bySlug(seven, SLUGS.artist);
    artist.slug = "renamed-artist";
    artist.previousSlugs = [SLUGS.artist];
    const index = createDestinationIndex(seven);

    expect(resolveSlug(index, "renamed-artist")).toMatchObject({ destination: { id: artist.id }, redirectToSlug: null });
    expect(resolveSlug(index, SLUGS.artist)).toMatchObject({ destination: { id: artist.id }, redirectToSlug: "renamed-artist" });
    expect(resolveSlug(index, "nope")).toEqual({ destination: null, redirectToSlug: null });
  });

  it("lists public destinations per district", () => {
    const seven = loadSeven();
    const index = createDestinationIndex(seven);
    const music = bySlug(seven, SLUGS.music);
    expect(destinationsInDistrict(index, music.id).map((d) => d.slug)).toEqual([SLUGS.artist]);
  });

  it("refuses to build an index without an active hub", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.hub).status = "draft";
    expect(() => createDestinationIndex(seven)).toThrow(/no active hub/);
  });
});
