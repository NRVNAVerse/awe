import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChunkPayloadError, parseChunkPayload } from "@/lib/spatial/chunk-payload";
import { parseSpatialIndex } from "@/lib/spatial/spatial-index";
import cannabisJson from "../public/data/spatial/chunks/cannabis-21.json";
import hubJson from "../public/data/spatial/chunks/hub.json";
import musicJson from "../public/data/spatial/chunks/music.json";
import spatialIndexJson from "../public/data/spatial/spatial-index.json";

const APP_ROOT = join(__dirname, "..");
const index = parseSpatialIndex(spatialIndexJson);
const expectHub = { worldId: index.worldId, chunkKey: "hub" };

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ChunkPayloadError) return err.code;
    throw err;
  }
  throw new Error("expected a ChunkPayloadError");
}

describe("chunk payload validation (runtime, before any engine mutation)", () => {
  it("accepts every generated M0 chunk against its own index entry", () => {
    for (const chunkKey of Object.keys(index.chunks)) {
      // The runtime never does this: the test maps the opaque versioned delivery URL back to the file on disk.
      const raw = JSON.parse(readFileSync(join(APP_ROOT, "public", new URL(index.chunks[chunkKey].dataUrl, "http://localhost").pathname), "utf8"));
      const payload = parseChunkPayload(raw, { worldId: index.worldId, chunkKey });
      expect(payload.chunkKey).toBe(chunkKey);
      expect(payload.worldId).toBe(index.worldId);
      expect(Object.keys(payload.components).length).toBeGreaterThan(0);
      for (const [id, record] of Object.entries(payload.components)) {
        expect(record.id).toBe(id);
        expect(typeof record.type).toBe("string");
      }
    }
  });

  it("returns a fresh copy in authored order", () => {
    const payload = parseChunkPayload(hubJson, expectHub);
    expect(Object.keys(payload.components)).toEqual(Object.keys(hubJson.components));
    expect(payload.components["platform-hub"]).not.toBe(hubJson.components["platform-hub"]);
    expect(payload.components["platform-hub"]).toEqual(hubJson.components["platform-hub"]);
  });

  it("rejects a non-object payload", () => {
    expect(code(() => parseChunkPayload(null, expectHub))).toBe("not-an-object");
    expect(code(() => parseChunkPayload("hub", expectHub))).toBe("not-an-object");
    expect(code(() => parseChunkPayload([], expectHub))).toBe("not-an-object");
  });

  it("rejects an unsupported schema version", () => {
    expect(code(() => parseChunkPayload({ ...hubJson, schemaVersion: 2 }, expectHub))).toBe("unsupported-schema-version");
    expect(code(() => parseChunkPayload({ ...hubJson, schemaVersion: "1" }, expectHub))).toBe("unsupported-schema-version");
  });

  it("rejects a payload from another world", () => {
    expect(code(() => parseChunkPayload({ ...hubJson, worldId: "other-world" }, expectHub))).toBe("world-id-mismatch");
    expect(code(() => parseChunkPayload(hubJson, { worldId: "other-world", chunkKey: "hub" }))).toBe("world-id-mismatch");
  });

  it("rejects a payload whose chunk key is not the one requested (e.g. a mis-served file)", () => {
    expect(code(() => parseChunkPayload(musicJson, expectHub))).toBe("chunk-key-mismatch");
    expect(code(() => parseChunkPayload(cannabisJson, { worldId: index.worldId, chunkKey: "hub" }))).toBe("chunk-key-mismatch");
    expect(code(() => parseChunkPayload({ ...hubJson, chunkKey: "HUB" }, expectHub))).toBe("chunk-key-mismatch");
  });

  it("rejects malformed components", () => {
    expect(code(() => parseChunkPayload({ ...hubJson, components: [] }, expectHub))).toBe("invalid-components");
    expect(code(() => parseChunkPayload({ ...hubJson, components: null }, expectHub))).toBe("invalid-components");
    expect(code(() => parseChunkPayload({ ...hubJson, components: { "platform-hub": "mesh" } }, expectHub))).toBe("invalid-component");
    expect(code(() => parseChunkPayload({ ...hubJson, components: { "platform-hub": { id: "platform-hub" } } }, expectHub))).toBe("invalid-component");
    expect(code(() => parseChunkPayload({ ...hubJson, components: { "platform-hub": { id: "platform-hub", type: "" } } }, expectHub))).toBe("invalid-component");
    expect(code(() => parseChunkPayload({ ...hubJson, components: { "platform-hub": { id: "marker-hub", type: "mesh" } } }, expectHub))).toBe(
      "component-id-mismatch",
    );
  });

  it("does not look for identity or gate data in the payload (chunk files carry none)", () => {
    for (const file of readdirSync(join(APP_ROOT, "public/data/spatial/chunks"))) {
      const text = readFileSync(join(APP_ROOT, "public/data/spatial/chunks", file), "utf8");
      expect(text, file).not.toMatch(/dst_[0-9abcdefghjkmnpqrstvwxyz]{16}|"gates"|"webUrl"|"slug"/);
    }
  });
});
