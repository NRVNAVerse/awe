import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { CONTENT_VERSION_PATTERN, contentVersion } from "../scripts/spatial/pipeline.mjs";
import nextConfig, { SPATIAL_CONTENT_VERSION_QUERY, SPATIAL_IMMUTABLE_CACHE_CONTROL, SPATIAL_INDEX_CACHE_CONTROL, spatialDataHeaders } from "../next.config";

/**
 * M0 Step 2B.4B.2 — HTTP cache policy for the generated spatial data (`next.config.ts`).
 *
 * Config-level check only; the authoritative validation is a real `next build && next start`
 * (documented in docs/NRVNAVERSE_SPATIAL_RUNTIME.md §15). Route matching below uses the very
 * modules Next 16 uses at request time (`path-to-regexp` for `source`, `matchHas` for `has`) so a
 * change in either the rules or the pipeline's token shape fails here first.
 */

const require = createRequire(import.meta.url);
type HeaderRule = Awaited<ReturnType<typeof spatialDataHeaders>>[number];
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string, keys: unknown[], opts: object) => RegExp };
const { matchHas } = require("next/dist/shared/lib/router/utils/prepare-destination") as {
  matchHas: (req: { headers: Record<string, string> }, query: Record<string, string | string[]>, has?: HeaderRule["has"], missing?: HeaderRule["missing"]) => false | Record<string, string>;
};

/** Apply the rules the way Next does: every rule whose `source` and `has` match contributes its headers. */
async function cacheControlFor(url: string): Promise<string[]> {
  const parsed = new URL(url, "http://localhost");
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(parsed.searchParams.keys())) {
    const all = parsed.searchParams.getAll(key);
    query[key] = all.length === 1 ? all[0] : all;
  }
  const values: string[] = [];
  for (const rule of await spatialDataHeaders()) {
    const matcher = pathToRegexp(rule.source, [], { strict: true, sensitive: false, delimiter: "/" });
    if (!matcher.test(parsed.pathname)) continue;
    if (matchHas({ headers: {} }, query, rule.has, rule.missing) === false) continue;
    for (const h of rule.headers) if (h.key === "Cache-Control") values.push(h.value);
  }
  return values;
}

const versionedUrls = [spatialIndexJson.globalSceneUrl, ...Object.values(spatialIndexJson.chunks).map((c) => c.dataUrl)];
const unversionedPaths = versionedUrls.map((u) => new URL(u, "http://localhost").pathname);

describe("next.config.ts — spatial data cache policy", () => {
  it("is wired into the exported config and declares exactly three rules", async () => {
    expect(nextConfig.headers).toBe(spatialDataHeaders);
    const rules = await spatialDataHeaders();
    expect(rules.map((r) => r.source)).toEqual([
      "/data/spatial/spatial-index.json",
      "/data/spatial/global-scene.json",
      "/data/spatial/chunks/:chunk([a-z0-9-]+).json",
    ]);
    for (const rule of rules) expect(rule.headers.map((h) => h.key)).toEqual(["Cache-Control"]);
    expect(SPATIAL_IMMUTABLE_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    expect(SPATIAL_INDEX_CACHE_CONTROL).toBe("public, max-age=0, must-revalidate");
    expect(SPATIAL_INDEX_CACHE_CONTROL).not.toMatch(/immutable|31536000/);
  });

  it("conditions the immutable rules on exactly the pipeline's content-version shape (32 lowercase hex chars), and the index rule on nothing", async () => {
    const [indexRule, globalRule, chunkRule] = await spatialDataHeaders();
    expect(indexRule.has).toBeUndefined();
    expect(indexRule.headers).toEqual([{ key: "Cache-Control", value: SPATIAL_INDEX_CACHE_CONTROL }]);
    for (const rule of [globalRule, chunkRule]) {
      expect(rule.has).toEqual([{ type: "query", key: "v", value: SPATIAL_CONTENT_VERSION_QUERY }]);
      expect(rule.headers).toEqual([{ key: "Cache-Control", value: SPATIAL_IMMUTABLE_CACHE_CONTROL }]);
    }
    // Next anchors `has.value` as `^value$`; that must be exactly the pipeline's token pattern.
    expect(new RegExp(`^${SPATIAL_CONTENT_VERSION_QUERY}$`).source).toBe(CONTENT_VERSION_PATTERN.source);
    const anchored = new RegExp(`^${SPATIAL_CONTENT_VERSION_QUERY}$`);
    expect(anchored.test(contentVersion("anything"))).toBe(true);
    for (const bad of ["", "abc", "0123456789ABCDEF0123456789abcdef", "0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcdef0", "0123456789abcdef0123456789abcdeg", "latest", "1"]) {
      expect(anchored.test(bad), bad).toBe(false);
    }
  });

  it("serves the committed versioned global scene and chunk URLs as immutable", async () => {
    expect(versionedUrls).toHaveLength(5);
    for (const url of versionedUrls) {
      expect(url).toMatch(/\?v=[0-9a-f]{32}$/);
      expect(await cacheControlFor(url), url).toEqual([SPATIAL_IMMUTABLE_CACHE_CONTROL]);
    }
  });

  it("does NOT make the same paths immutable without a valid token (old bookmarks, debug requests, stale code)", async () => {
    for (const path of unversionedPaths) {
      expect(path).not.toContain("?");
      expect(await cacheControlFor(path), path).toEqual([]); // no rule of ours — framework default, short-lived
      for (const bad of ["", "abc", "0123456789ABCDEF0123456789abcdef", "0123456789abcdef0123456789abcde", "latest"]) {
        expect(await cacheControlFor(`${path}?v=${encodeURIComponent(bad)}`), `${path}?v=${bad}`).toEqual([]);
      }
      expect(await cacheControlFor(`${path}?version=${contentVersion("x")}`)).toEqual([]); // wrong parameter name
    }
  });

  it("keeps the version root short-lived and revalidated, with or without a token, and never immutable", async () => {
    expect(await cacheControlFor("/data/spatial/spatial-index.json")).toEqual([SPATIAL_INDEX_CACHE_CONTROL]);
    expect(await cacheControlFor(`/data/spatial/spatial-index.json?v=${contentVersion("x")}`)).toEqual([SPATIAL_INDEX_CACHE_CONTROL]);
    for (const value of await cacheControlFor("/data/spatial/spatial-index.json")) expect(value).not.toMatch(/immutable/);
  });

  it("does not touch anything outside the spatial data (the compatibility scene, other public files, pages)", async () => {
    for (const path of ["/data/static-scene.json", `/data/static-scene.json?v=${contentVersion("x")}`, "/data/spatial/chunks/music.json.bak", "/data/spatial/chunks/nested/music.json", "/api/destinations", "/", `/?destination=dst_7g19n1vm9ackw8a0&v=${contentVersion("x")}`]) {
      expect(await cacheControlFor(path), path).toEqual([]);
    }
  });
});
