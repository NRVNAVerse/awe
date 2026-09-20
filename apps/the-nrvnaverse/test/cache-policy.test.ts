import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { CONTENT_ADDRESSED_OUTPUT, CONTENT_VERSION_PATTERN, DATA_URL_PREFIX, contentVersion } from "../scripts/spatial/pipeline.mjs";
import nextConfig, { SPATIAL_CONTENT_VERSION, SPATIAL_IMMUTABLE_CACHE_CONTROL, SPATIAL_INDEX_CACHE_CONTROL, spatialDataHeaders } from "../next.config";

/**
 * M0 Step 2B.4B.2 — HTTP cache policy for the generated spatial data (`next.config.ts`).
 *
 * Config-level check only; the authoritative validation is a real `next build && next start`
 * (documented in docs/NRVNAVERSE_SPATIAL_RUNTIME.md §15). Route matching below uses the very
 * modules Next 16 uses at request time (`path-to-regexp` for `source`, `matchHas` for `has`) so a
 * change in either the rules or the pipeline's content-addressed file-name shape fails here first.
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

const HEX32 = "0123456789abcdef0123456789abcdef";
const artifactUrls = [spatialIndexJson.globalSceneUrl, ...Object.values(spatialIndexJson.chunks).map((c) => c.dataUrl)];

describe("next.config.ts — spatial data cache policy", () => {
  it("is wired into the exported config and declares exactly three rules, none conditioned on a query", async () => {
    expect(nextConfig.headers).toBe(spatialDataHeaders);
    const rules = await spatialDataHeaders();
    expect(rules.map((r) => r.source)).toEqual([
      "/data/spatial/spatial-index.json",
      "/data/spatial/global-scene.:version([0-9a-f]{32}).json",
      "/data/spatial/chunks/:chunk([a-z0-9-]+).:version([0-9a-f]{32}).json",
    ]);
    for (const rule of rules) {
      expect(rule.headers.map((h) => h.key)).toEqual(["Cache-Control"]);
      expect(rule.has).toBeUndefined(); // the content version is in the path — no query condition
      expect(rule.missing).toBeUndefined();
      expect(rule.source).not.toContain("?");
    }
    expect(SPATIAL_IMMUTABLE_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    expect(SPATIAL_INDEX_CACHE_CONTROL).toBe("public, max-age=0, must-revalidate");
    expect(SPATIAL_INDEX_CACHE_CONTROL).not.toMatch(/immutable|31536000/);
  });

  it("keys the immutable rules on exactly the pipeline's content-version shape (32 lowercase hex chars) embedded in the file name", async () => {
    const [indexRule, globalRule, chunkRule] = await spatialDataHeaders();
    expect(indexRule.headers).toEqual([{ key: "Cache-Control", value: SPATIAL_INDEX_CACHE_CONTROL }]);
    for (const rule of [globalRule, chunkRule]) expect(rule.headers).toEqual([{ key: "Cache-Control", value: SPATIAL_IMMUTABLE_CACHE_CONTROL }]);
    // The config's token shape IS the pipeline's token shape, and the rule sources are the pipeline's file-name shapes under /data.
    expect(new RegExp(`^${SPATIAL_CONTENT_VERSION}$`).source).toBe(CONTENT_VERSION_PATTERN.source);
    expect(new RegExp(`^${SPATIAL_CONTENT_VERSION}$`).test(contentVersion("anything"))).toBe(true);
    const globalName = `spatial/global-scene.${HEX32}.json`;
    const chunkName = `spatial/chunks/fashion-culture.${HEX32}.json`;
    expect(CONTENT_ADDRESSED_OUTPUT.globalScene.test(globalName)).toBe(true);
    expect(CONTENT_ADDRESSED_OUTPUT.chunk.test(chunkName)).toBe(true);
    expect(await cacheControlFor(`${DATA_URL_PREFIX}/${globalName}`)).toEqual([SPATIAL_IMMUTABLE_CACHE_CONTROL]);
    expect(await cacheControlFor(`${DATA_URL_PREFIX}/${chunkName}`)).toEqual([SPATIAL_IMMUTABLE_CACHE_CONTROL]);
  });

  it("serves the committed content-addressed global scene and chunk URLs as immutable", async () => {
    expect(artifactUrls).toHaveLength(5);
    for (const url of artifactUrls) {
      expect(url).toMatch(/^\/data\/spatial\/(global-scene|chunks\/[a-z0-9-]+)\.[0-9a-f]{32}\.json$/);
      expect(url).not.toContain("?");
      expect(await cacheControlFor(url), url).toEqual([SPATIAL_IMMUTABLE_CACHE_CONTROL]);
    }
  });

  it("does NOT make the legacy unversioned names or malformed hashed names immutable (old bookmarks, debug requests, stale code)", async () => {
    for (const base of ["/data/spatial/global-scene", "/data/spatial/chunks/music", "/data/spatial/chunks/fashion-culture"]) {
      expect(await cacheControlFor(`${base}.json`), base).toEqual([]); // legacy unversioned name — no rule of ours (and no such file any more)
      expect(await cacheControlFor(`${base}.json?v=${HEX32}`), base).toEqual([]); // the rejected query-token shape matches nothing
      for (const bad of ["abc", HEX32.slice(0, 31), `${HEX32}0`, `${HEX32.slice(0, 31)}g`, "latest", "1"]) {
        expect(await cacheControlFor(`${base}.${bad}.json`), `${base}.${bad}.json`).toEqual([]);
      }
      expect(await cacheControlFor(`${base}.${HEX32}.json.bak`)).toEqual([]);
      expect(await cacheControlFor(`${base}.${HEX32}.json.map`)).toEqual([]);
    }
    expect(await cacheControlFor(`/data/spatial/chunks/nested/music.${HEX32}.json`)).toEqual([]);
    expect(await cacheControlFor(`/data/spatial/chunks/mu.sic.${HEX32}.json`)).toEqual([]); // a dotted chunk key is not a chunk key
    expect(await cacheControlFor(`/data/spatial/chunks/.${HEX32}.json`)).toEqual([]); // empty chunk key
  });

  it("keeps the version root short-lived and revalidated, with or without a query, and never immutable", async () => {
    expect(await cacheControlFor("/data/spatial/spatial-index.json")).toEqual([SPATIAL_INDEX_CACHE_CONTROL]);
    expect(await cacheControlFor(`/data/spatial/spatial-index.json?v=${contentVersion("x")}`)).toEqual([SPATIAL_INDEX_CACHE_CONTROL]);
    expect(await cacheControlFor(`/data/spatial/spatial-index.${HEX32}.json`)).toEqual([]); // the index is never content-addressed
    for (const value of await cacheControlFor("/data/spatial/spatial-index.json")) expect(value).not.toMatch(/immutable/);
  });

  it("does not touch anything outside the spatial data (the compatibility scene, other public files, pages)", async () => {
    for (const path of ["/data/static-scene.json", `/data/static-scene.${HEX32}.json`, `/data/static-scene.json?v=${contentVersion("x")}`, "/api/destinations", "/", `/?destination=dst_7g19n1vm9ackw8a0&v=${contentVersion("x")}`, `/${HEX32}.json`]) {
      expect(await cacheControlFor(path), path).toEqual([]);
    }
  });
});
