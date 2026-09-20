import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDeepLinkQuery, type DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";
import { FetchChunkDataSource } from "@/lib/spatial/chunk-data-source";
import { parseSpatialIndex } from "@/lib/spatial/spatial-index";
import { FetchSpatialIndexSource, SPATIAL_INDEX_URL } from "@/lib/spatial/spatial-index-source";

/**
 * M0 Step 2B.4B.2 — the runtime consumes the content-versioned delivery URLs transparently.
 *
 * The generated index hands out `globalSceneUrl` / `chunks[key].dataUrl` with a `?v=<digest>`
 * query. Every consumer passes the WHOLE string to `fetch` untouched: nothing strips the token,
 * derives a chunk path, or rebuilds a URL. The index itself is requested at its fixed, unversioned
 * URL (it is the version root). The token never reaches a navigation URL.
 */

const APP_ROOT = resolve(__dirname, "..");
const data = destinationsJson as unknown as DestinationsFile;
const index = parseSpatialIndex(spatialIndexJson);
const VERSIONED = /^\/data\/spatial\/(global-scene|chunks\/[a-z0-9-]+)\.json\?v=[0-9a-f]{32}$/;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("versioned delivery URLs — consumers pass them through untouched", () => {
  it("the committed index carries versioned artifact URLs and no versioned index URL", () => {
    expect(index.globalSceneUrl).toMatch(VERSIONED);
    for (const chunk of Object.values(index.chunks)) expect(chunk.dataUrl).toMatch(VERSIONED);
    expect(SPATIAL_INDEX_URL).toBe("/data/spatial/spatial-index.json"); // fixed version root, no token
    expect(SPATIAL_INDEX_URL).not.toContain("?");
  });

  it("FetchChunkDataSource fetches exactly the dataUrl from the index — token included, nothing stripped or rebuilt", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ schemaVersion: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const source = new FetchChunkDataSource();
    const controller = new AbortController();
    for (const [chunkKey, chunk] of Object.entries(index.chunks)) {
      fetchMock.mockClear();
      const raw = await source.load({ chunkKey, dataUrl: chunk.dataUrl, signal: controller.signal });
      expect(raw).toEqual({ schemaVersion: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(chunk.dataUrl); // the exact string, `?v=` and all
      expect(url).toMatch(VERSIONED);
      expect(init.signal).toBe(controller.signal);
    }
  });

  it("FetchChunkDataSource surfaces a non-OK response for a versioned URL as a failure (no fallback to an unversioned path)", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);
    const source = new FetchChunkDataSource();
    await expect(source.load({ chunkKey: "music", dataUrl: index.chunks.music.dataUrl, signal: new AbortController().signal })).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one request, no retry against a derived URL
  });

  it("FetchSpatialIndexSource requests the fixed, unversioned index URL", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(spatialIndexJson));
    vi.stubGlobal("fetch", fetchMock);
    const loaded = await new FetchSpatialIndexSource().load();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(SPATIAL_INDEX_URL);
    expect(loaded.globalSceneUrl).toBe(spatialIndexJson.globalSceneUrl); // parsed through, verbatim
    for (const key of Object.keys(loaded.chunks)) expect(loaded.chunks[key].dataUrl).toBe((spatialIndexJson.chunks as Record<string, { dataUrl: string }>)[key].dataUrl);
  });

  it("parseSpatialIndex keeps the URLs opaque: any string passes through verbatim, with or without a token", () => {
    const withToken = parseSpatialIndex(spatialIndexJson);
    expect(withToken.globalSceneUrl).toBe(spatialIndexJson.globalSceneUrl);
    const draft = structuredClone(spatialIndexJson) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    draft.globalSceneUrl = "/data/spatial/global-scene.json";
    draft.chunks.music.dataUrl = "/data/spatial/chunks/music.json";
    const without = parseSpatialIndex(draft);
    expect(without.globalSceneUrl).toBe("/data/spatial/global-scene.json"); // no requirement, no validation, no rewriting of the token
    expect(without.chunks.music.dataUrl).toBe("/data/spatial/chunks/music.json");
    expect(without.schemaVersion).toBe(1);
  });

  it("no runtime source parses, strips or reconstructs a content-version token or a chunk path", () => {
    const srcFiles = (dir: string): string[] =>
      readdirSync(join(APP_ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? srcFiles(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
      );
    const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const file of srcFiles("src")) {
      const text = stripComments(readFileSync(join(APP_ROOT, file), "utf8"));
      expect(text, file).not.toMatch(/[?&]v=/); // no literal token query anywhere in application code (comments excluded)
      expect(text, file).not.toMatch(/["'`]\/data\/spatial\/chunks\//); // chunk urls come from the index only
      expect(text, file).not.toMatch(/["'`]\/data\/spatial\/global-scene/); // the global scene url comes from the index only
      expect(text, file).not.toMatch(/(dataUrl|sceneUrl|globalSceneUrl)\s*\.\s*(split|replace|slice|substring|indexOf|search)\b/);
      expect(text, file).not.toMatch(/new URL\(\s*(dataUrl|sceneUrl|globalSceneUrl|chunk\.dataUrl|spatialIndex\.globalSceneUrl)/);
      expect(text, file).not.toMatch(/searchParams\.(get|has|delete|set)\(\s*["']v["']/);
    }
    // The two real consumers hand the URL straight to fetch.
    expect(readFileSync(join(APP_ROOT, "src/lib/spatial/chunk-data-source.ts"), "utf8")).toMatch(/fetch\(dataUrl,/);
    expect(readFileSync(join(APP_ROOT, "src/lib/spatial/awe-spatial-runtime.ts"), "utf8")).toMatch(/fetch\(sceneUrl,/);
  });

  it("the content-version token never appears in a canonical navigation URL", () => {
    const tokens = [index.globalSceneUrl, ...Object.values(index.chunks).map((c) => c.dataUrl)].map((u) => new URL(u, "http://localhost").searchParams.get("v")!);
    expect(tokens).toHaveLength(5);
    for (const id of Object.keys(index.destinations)) {
      const query = buildDeepLinkQuery(id, { from: "spatial" });
      expect(query).not.toMatch(/[?&]v=/);
      for (const token of tokens) expect(query).not.toContain(token);
      expect([...new URLSearchParams(query).keys()].sort()).toEqual(["destination", "from"]);
    }
    expect(Object.keys(index.destinations)).toContain(data.index.bySlug["music"]); // the ids above are the real M0 set
  });
});
