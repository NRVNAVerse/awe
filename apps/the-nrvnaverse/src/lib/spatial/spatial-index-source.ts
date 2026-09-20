import { parseSpatialIndex, type SpatialIndexFile } from "@/lib/spatial/spatial-index";

/**
 * Runtime source of the generated spatial index. The store depends on this interface (tests use
 * an in-memory source); the default fetches the static file Next.js serves from `public/data`.
 */
export interface SpatialIndexSource {
  load(): Promise<SpatialIndexFile>;
}

export const SPATIAL_INDEX_URL = "/data/spatial/spatial-index.json";

export class FetchSpatialIndexSource implements SpatialIndexSource {
  constructor(private readonly url: string = SPATIAL_INDEX_URL) {}

  async load(): Promise<SpatialIndexFile> {
    const res = await fetch(this.url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`spatial index request failed: ${res.status} ${res.statusText}`);
    }
    return parseSpatialIndex(await res.json());
  }
}

/** In-memory source for tests and headless tooling. */
export class StaticSpatialIndexSource implements SpatialIndexSource {
  constructor(private readonly index: unknown) {}

  async load(): Promise<SpatialIndexFile> {
    return parseSpatialIndex(this.index);
  }
}
