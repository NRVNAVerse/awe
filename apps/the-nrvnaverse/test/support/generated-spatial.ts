import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import spatialIndexJson from "../../public/data/spatial/spatial-index.json";

/**
 * The committed generated spatial artifacts, resolved THROUGH the committed index exactly as the
 * runtime resolves them (M0 Step 2B.4B.2). The global scene and the chunk payloads live under
 * content-addressed file names (`global-scene.<digest>.json`, `chunks/<key>.<digest>.json`), so a
 * test must never import them by a fixed path: it reads `globalSceneUrl` / `chunks[key].dataUrl`
 * from the index and maps that public URL back to `public/`. The runtime never does this mapping —
 * it hands the URL to `fetch` — but the test process has no server.
 */

export const PUBLIC_DIR = resolve(__dirname, "../../public");

/** Shape of a generated chunk payload file (validated at runtime by `parseChunkPayload`). */
export interface GeneratedChunkJson {
  schemaVersion: number;
  worldId: string;
  chunkKey: string;
  components: Record<string, Record<string, unknown>>;
}

/** Map a public `/data/...` delivery URL (path only — the pipeline emits no query) to the file under `public/`. */
export function servedFilePath(dataUrl: string): string {
  const parsed = new URL(dataUrl, "http://localhost");
  if (parsed.search !== "" || parsed.hash !== "") throw new Error(`delivery URL carries a query or hash: ${dataUrl}`);
  if (!parsed.pathname.startsWith("/data/")) throw new Error(`delivery URL is not under /data/: ${dataUrl}`);
  return join(PUBLIC_DIR, ...parsed.pathname.split("/").filter(Boolean));
}

/** Read the committed file a delivery URL points at, as JSON. */
export function readServedJson<T = unknown>(dataUrl: string): T {
  return JSON.parse(readFileSync(servedFilePath(dataUrl), "utf8")) as T;
}

export { spatialIndexJson };

/** The committed global scene, read via `spatialIndexJson.globalSceneUrl`. */
export const generatedGlobalScene = readServedJson<Record<string, unknown>>(spatialIndexJson.globalSceneUrl);

/** Every committed chunk payload by chunk key, read via `spatialIndexJson.chunks[key].dataUrl`. */
export const generatedChunks: Record<string, GeneratedChunkJson> = Object.fromEntries(
  Object.entries(spatialIndexJson.chunks).map(([chunkKey, chunk]) => [chunkKey, readServedJson<GeneratedChunkJson>(chunk.dataUrl)]),
);

export const hubJson = generatedChunks["hub"];
export const musicJson = generatedChunks["music"];
export const fashionJson = generatedChunks["fashion-culture"];
export const cannabisJson = generatedChunks["cannabis-21"];
