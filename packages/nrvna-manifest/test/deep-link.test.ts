import { describe, expect, it } from "vitest";
import { buildDeepLinkQuery, parseDeepLink, resolveDeepLink, resolveReturnUrl } from "../src/deep-link";
import { createDestinationIndex } from "../src/resolve";
import { NRVNAVERSE_WEB_ROOT } from "../src/schema";
import { SLUGS, bySlug, loadSeven } from "./support/helpers";

describe("deep-link parsing", () => {
  it("parses the allow-listed parameters", () => {
    const seven = loadSeven();
    const music = bySlug(seven, SLUGS.music);
    const hub = bySlug(seven, SLUGS.hub);
    const { params, issues } = parseDeepLink(`?destination=${music.id}&from=web&ref=launch_2026&return=${hub.id}`);
    expect(params).toEqual({ destination: music.id, from: "web", ref: "launch_2026", return: hub.id });
    expect(issues).toEqual([]);
  });

  it("accepts URLSearchParams and URL inputs", () => {
    const music = bySlug(loadSeven(), SLUGS.music);
    expect(parseDeepLink(new URLSearchParams({ destination: music.id })).params.destination).toBe(music.id);
    expect(parseDeepLink(new URL(`https://worlds.nrvnaverse.com/?destination=${music.id}`)).params.destination).toBe(music.id);
  });

  it("drops malformed values with non-fatal issues", () => {
    const { params, issues } = parseDeepLink("?destination=music&from=Web%20Site&ref=%3Cscript%3E");
    expect(params).toEqual({ destination: null, from: null, ref: null, return: null });
    expect(issues.map((i) => i.code).sort()).toEqual(["invalid-destination", "invalid-from", "invalid-ref"]);
  });

  it("ignores unknown parameters, including the experimental chunk parameter", () => {
    const { params, issues } = parseDeepLink("?chunk=0_0_0&redirect=https://evil.example");
    expect(params.destination).toBeNull();
    expect(issues.map((i) => i.param).sort()).toEqual(["chunk", "redirect"]);
    expect(issues.every((i) => i.code === "ignored-param")).toBe(true);
  });

  it("never accepts a URL as the return value", () => {
    for (const value of [
      "https://evil.example/",
      "//evil.example",
      "/worlds/hub",
      "javascript:alert(1)",
      "www.nrvnaverse.com",
      "https://www.nrvnaverse.com/worlds/hub",
    ]) {
      const { params, issues } = parseDeepLink(`?return=${encodeURIComponent(value)}`);
      expect(params.return).toBeNull();
      expect(issues.map((i) => i.code)).toContain("unsafe-return");
    }
  });
});

describe("return resolution", () => {
  it("resolves return tokens only through manifest data", () => {
    const seven = loadSeven();
    const index = createDestinationIndex(seven);
    const music = bySlug(seven, SLUGS.music);
    expect(resolveReturnUrl(index, "web")).toBe(NRVNAVERSE_WEB_ROOT);
    expect(resolveReturnUrl(index, music.id)).toBe(music.webUrl);
    expect(resolveReturnUrl(index, null)).toBeNull();
    expect(resolveReturnUrl(index, "dst_0000000000000000")).toBeNull();
    expect(resolveReturnUrl(index, "https://evil.example/")).toBeNull();
  });

  it("does not resolve return to a non-public destination", () => {
    const seven = loadSeven();
    const brand = bySlug(seven, SLUGS.brand);
    brand.status = "hidden";
    const index = createDestinationIndex(seven);
    expect(resolveReturnUrl(index, brand.id)).toBeNull();
  });
});

describe("resolveDeepLink", () => {
  it("resolves a known destination with handoff fields", () => {
    const seven = loadSeven();
    const index = createDestinationIndex(seven);
    const farms = bySlug(seven, SLUGS.farms);
    const entry = resolveDeepLink(index, `?destination=${farms.id}&from=portal&ref=abc&return=web`);
    expect(entry.resolution.destination.id).toBe(farms.id);
    expect(entry.resolution.fallback).toBe(false);
    expect(entry.from).toBe("portal");
    expect(entry.ref).toBe("abc");
    expect(entry.returnUrl).toBe(NRVNAVERSE_WEB_ROOT);
    expect(entry.issues).toEqual([]);
  });

  it("falls back to the hub for an unknown destination and flags an unresolvable return", () => {
    const index = createDestinationIndex(loadSeven());
    const entry = resolveDeepLink(index, "?destination=dst_0000000000000000&return=dst_0000000000000001");
    expect(entry.resolution.destination.id).toBe(index.hub.id);
    expect(entry.resolution).toMatchObject({ fallback: true, reason: "unknown" });
    expect(entry.returnUrl).toBeNull();
    expect(entry.issues.map((i) => i.code)).toContain("unsafe-return");
  });

  it("builds canonical queries", () => {
    const music = bySlug(loadSeven(), SLUGS.music);
    expect(buildDeepLinkQuery(music.id)).toBe(`?destination=${music.id}`);
    expect(buildDeepLinkQuery(music.id, { from: "web", return: "web" })).toBe(`?destination=${music.id}&from=web&return=web`);
  });
});
