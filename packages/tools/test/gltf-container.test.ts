/**
 * The one GLB parser in the monorepo, on its own.
 *
 * It is the layer both the optimiser and the validator stand on, it is
 * dependency-free on purpose (space-kit imports it so its header helpers can
 * stay synchronous), and it must never throw — every function here is handed
 * bytes from the outside world.
 */
import { describe, expect, it } from "vitest";

import {
  boundsFromJson,
  boundsOf,
  declaredExtensions,
  readGlb,
  externalRefs,
  extensionsOf,
  gltfJsonOf,
  imageBytes,
  isGlb,
  readGlbChunks,
  resourceRefs,
  sortKeys,
  textureStatsOf,
  formatBytes,
  describeSavings,
} from "../src/gltf";
import {
  bigTexturedCube,
  CUBE,
  emptyGlb,
  flatPng,
  glbOf,
  gltfJsonFile,
  noisyPng,
  texturedCube,
} from "./support/gltf-fixtures";

describe("container parsing", () => {
  it("recognises a GLB and splits its chunks", async () => {
    const glb = await bigTexturedCube();
    expect(isGlb(glb)).toBe(true);

    const chunks = readGlbChunks(glb);
    expect(chunks).not.toBeNull();
    expect((chunks!.json as { asset: { version: string } }).asset.version).toBe("2.0");
    expect(chunks!.bin.byteLength).toBeGreaterThan(0);
  });

  it("handles a GLB with no BIN chunk", () => {
    const chunks = readGlbChunks(emptyGlb());
    expect(chunks).not.toBeNull();
    expect(chunks!.bin.byteLength).toBe(0);
  });

  it("reads a standalone .gltf document", () => {
    const json = gltfJsonOf(
      gltfJsonFile({ asset: { version: "2.0" }, scenes: [] }),
    );
    expect(json?.asset.version).toBe("2.0");
  });

  it("tolerates a byte-order mark on a hand-edited .gltf", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify({ asset: { version: "2.0" } })),
    ]);
    expect(gltfJsonOf(bytes)?.asset.version).toBe("2.0");
  });

  it("refuses a JSON document with no asset block", () => {
    expect(gltfJsonOf(gltfJsonFile({ hello: "world" }))).toBeNull();
  });

  it("never throws on hostile bytes", async () => {
    const glb = Buffer.from(await bigTexturedCube());
    const truncated = glb.subarray(0, 40);
    const lying = Buffer.from(glb);
    lying.writeUInt32LE(0xffffff, 12);
    const wrongChunk = Buffer.from(glb);
    wrongChunk.writeUInt32LE(0xdeadbeef, 16);

    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from("nope"),
      Buffer.from([0x67, 0x6c, 0x54, 0x46]),
      truncated,
      lying,
      wrongChunk,
    ]) {
      expect(() => readGlbChunks(bytes)).not.toThrow();
      expect(() => gltfJsonOf(bytes)).not.toThrow();
      expect(() => isGlb(bytes)).not.toThrow();
    }
  });
});

describe("resource classification", () => {
  it("calls an embedded image embedded", async () => {
    const json = gltfJsonOf(await bigTexturedCube());
    const refs = resourceRefs(json);
    expect(refs.filter((r) => r.kind === "image")).toEqual([
      expect.objectContaining({ carrier: "embedded", mimeType: "image/png" }),
    ]);
    expect(externalRefs(json)).toEqual([]);
  });

  it("calls an external URI external, and keeps it verbatim", () => {
    const json = gltfJsonOf(
      gltfJsonFile({
        asset: { version: "2.0" },
        buffers: [{ byteLength: 4, uri: "scene.bin" }],
        images: [{ uri: "../textures/wood.png" }],
      }),
    );
    expect(externalRefs(json).map((r) => r.uri)).toEqual([
      "scene.bin",
      "../textures/wood.png",
    ]);
  });

  it("truncates a data URI rather than carrying megabytes of base64 around", async () => {
    const json = gltfJsonOf(
      texturedCube(await noisyPng(128), { imageAsDataUri: true }),
    );
    const ref = resourceRefs(json).find((r) => r.kind === "image")!;
    expect(ref.carrier).toBe("data-uri");
    expect(ref.uri).toBe("data:image/png;base64,");
    expect(ref.uri!.length).toBeLessThan(40);
  });

  it("extracts image bytes from a bufferView and from a data URI alike", async () => {
    const png = await flatPng(16);

    const embedded = texturedCube(png);
    const fromView = imageBytes(
      gltfJsonOf(embedded),
      readGlbChunks(embedded)!.bin,
      0,
    );
    expect(Buffer.from(fromView!)).toEqual(png);

    const inline = texturedCube(png, { imageAsDataUri: true });
    const fromUri = imageBytes(gltfJsonOf(inline), new Uint8Array(0), 0);
    expect(Buffer.from(fromUri!)).toEqual(png);
  });

  it("returns null for an image it cannot reach", () => {
    const json = gltfJsonOf(
      gltfJsonFile({ asset: { version: "2.0" }, images: [{ uri: "far-away.png" }] }),
    );
    expect(imageBytes(json, new Uint8Array(0), 0)).toBeNull();
    expect(imageBytes(json, new Uint8Array(0), 9)).toBeNull();
  });
});

describe("texture statistics", () => {
  it("measures dimensions, bytes and mime types", async () => {
    const stats = await textureStatsOf(await bigTexturedCube());
    expect(stats).toMatchObject({
      textures: 1,
      images: 1,
      maxWidth: 512,
      maxHeight: 512,
      byMimeType: { "image/png": 1 },
    });
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.perImage[0]).toMatchObject({ index: 0, carrier: "embedded" });
  });

  it("reports an untextured model as empty rather than missing", async () => {
    const stats = await textureStatsOf(
      texturedCube(await flatPng(), { untextured: true }),
    );
    expect(stats).toMatchObject({
      textures: 0,
      images: 0,
      bytes: 0,
      maxWidth: null,
      maxHeight: null,
      byMimeType: {},
      perImage: [],
    });
  });

  it("does not crash on bytes that are not an image", () => {
    const json = {
      asset: { version: "2.0" },
      images: [{ bufferView: 0, mimeType: "image/ktx2" }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      buffers: [{ byteLength: 4 }],
    };
    const glb = glbOf(json, Buffer.from([0xab, 0x4b, 0x54, 0x58]));
    return expect(textureStatsOf(glb)).resolves.toMatchObject({
      images: 1,
      // sharp cannot open KTX2 — size still counts, dimensions honestly null.
      maxWidth: null,
      byMimeType: { "image/ktx2": 1 },
    });
  });
});

describe("bounds", () => {
  it("applies the node transform", async () => {
    // A unit cube translated up by 0.5 sits on y 0.5..1.5.
    expect(boundsOf(await bigTexturedCube())).toEqual({
      min: [...CUBE.min.slice(0, 1), 0.5, 0],
      max: [1, 1.5, 1],
      size: [1, 1, 1],
    });
  });

  it("applies a scale", () => {
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, scale: [2, 3, 4] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ min: [0, 0, 0], max: [1, 1, 1], componentType: 5126, count: 1, type: "VEC3" }],
    };
    expect(boundsFromJson(json)?.size).toEqual([2, 3, 4]);
  });

  it("composes parent and child transforms", () => {
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { children: [1], translation: [10, 0, 0] },
        { mesh: 0, translation: [0, 5, 0] },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ min: [0, 0, 0], max: [1, 1, 1], componentType: 5126, count: 1, type: "VEC3" }],
    };
    expect(boundsFromJson(json)?.min).toEqual([10, 5, 0]);
  });

  it("returns null when there is nothing to measure", () => {
    expect(boundsFromJson({ asset: { version: "2.0" } })).toBeNull();
    // Accessors with no min/max (some exporters omit them on non-POSITION).
    expect(
      boundsFromJson({
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ componentType: 5126, count: 3, type: "VEC3" }],
      }),
    ).toBeNull();
  });

  it("does not hang on a cyclic node graph", () => {
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ children: [1] }, { children: [0] }],
      meshes: [],
      accessors: [],
    };
    expect(boundsFromJson(json)).toBeNull();
  });

  it("survives Draco, because the spec keeps POSITION min/max", async () => {
    const { optimizeModel } = await import("../src/gltf");
    const { buffer } = await optimizeModel(await bigTexturedCube());
    expect(boundsOf(buffer)?.size).toEqual([1, 1, 1]);
  });
});

describe("small helpers", () => {
  it("sorts and de-duplicates extension lists", () => {
    expect(
      extensionsOf({
        extensionsUsed: ["B", "A", "A"],
        extensionsRequired: ["A"],
      }),
    ).toEqual({ used: ["A", "B"], required: ["A"] });
    expect(extensionsOf({})).toEqual({ used: [], required: [] });
    expect(extensionsOf({ extensionsUsed: "nope" })).toEqual({
      used: [],
      required: [],
    });
  });

  it("key-sorts a record so JSON.stringify is stable", () => {
    expect(Object.keys(sortKeys({ z: 1, a: 2, m: 3 }))).toEqual(["a", "m", "z"]);
  });

  it("formats bytes the way import notes expect", () => {
    expect(formatBytes(31)).toBe("31 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(4 * 1048576)).toBe("4.0 MB");
    expect(formatBytes(-1)).toBe("?");
    expect(describeSavings(4 * 1048576, 1048576)).toBe("4.0 MB → 1.0 MB (−75 %)");
  });
});

describe("the checks a truncated file needs", () => {
  it("refuses a GLB whose header lies about its total length", async () => {
    const glb = Buffer.from(await bigTexturedCube());
    glb.writeUInt32LE(glb.length + 8, 8);
    expect(readGlb(glb).problem).toBe("length-mismatch");
    expect(readGlbChunks(glb)).toBeNull();
  });

  it("refuses a GLB truncated inside its BIN chunk", async () => {
    // The JSON chunk survives, so the header still parses — which is exactly
    // why the walk used to stop at the short chunk and call it a success with
    // an empty BIN, reporting the statistics of geometry that was gone.
    const intact = Buffer.from(await bigTexturedCube());
    const truncated = Buffer.from(intact.subarray(0, intact.length - 2000));
    // Keep the declared total honest so this tests the *chunk* check.
    truncated.writeUInt32LE(truncated.length, 8);

    expect(readGlb(truncated).problem).toBe("chunk-overrun");
    expect(readGlbChunks(truncated)).toBeNull();
  });

  it("refuses a container version other than 2", async () => {
    const glb = Buffer.from(await bigTexturedCube());
    glb.writeUInt32LE(3, 4);
    expect(readGlb(glb).problem).toBe("bad-version");
  });

  it("refuses a JSON chunk that parses to an array", () => {
    expect(readGlb(glbOf([1, 2, 3] as never)).problem).toBe("bad-json-chunk");
  });

  it("still reads a well-formed file, and a BIN-less one", async () => {
    expect(readGlb(await bigTexturedCube()).problem).toBeNull();
    const empty = readGlb(emptyGlb());
    expect(empty.problem).toBeNull();
    expect(empty.chunks?.bin.byteLength).toBe(0);
  });
});

describe("every extension the file uses, however it was declared", () => {
  it("finds one declared only in a nested extensions block", () => {
    expect(
      declaredExtensions({
        asset: { version: "2.0" },
        materials: [{ extensions: { ACME_thing: {} } }],
      }),
    ).toEqual(["ACME_thing"]);
  });

  it("unions the two name lists with the nested blocks", () => {
    expect(
      declaredExtensions({
        extensionsUsed: ["B"],
        extensionsRequired: ["C"],
        nodes: [{ extensions: { A: {} } }],
      }),
    ).toEqual(["A", "B", "C"]);
  });

  it("is bounded, so a deep or wide document cannot hang it", () => {
    // A chain far deeper than the walk's limit, built iteratively.
    let deep: any = { extensions: { DEEP_thing: {} } };
    for (let i = 0; i < 5_000; i++) deep = { child: deep };
    const started = Date.now();
    expect(() => declaredExtensions(deep)).not.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("ignores junk where a list should be", () => {
    expect(declaredExtensions({ extensionsUsed: "nope" })).toEqual([]);
    expect(declaredExtensions(null)).toEqual([]);
  });
});

describe("bounds cannot be made to hang", () => {
  it("survives a branching cycle that would otherwise be exponential", () => {
    // Two nodes each listing the other twice: 2^64 visits inside a depth-64
    // cap. This used to wedge whatever was validating the file.
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ children: [1, 1] }, { children: [0, 0], mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { min: [0, 0, 0], max: [1, 1, 1], componentType: 5126, count: 1, type: "VEC3" },
      ],
    };

    const started = Date.now();
    const bounds = boundsFromJson(json);
    expect(Date.now() - started).toBeLessThan(2_000);
    // It still measures the mesh it could reach.
    expect(bounds?.size).toEqual([1, 1, 1]);
  });

  it("does not double-count a child when the file declares no scenes", () => {
    // Every node used to be treated as a root, so a child was measured once
    // under its parent's transform and once at the origin.
    const json = {
      asset: { version: "2.0" },
      nodes: [
        { children: [1], translation: [100, 0, 0] },
        { mesh: 0 },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { min: [0, 0, 0], max: [1, 1, 1], componentType: 5126, count: 1, type: "VEC3" },
      ],
    };
    expect(boundsFromJson(json)?.size).toEqual([1, 1, 1]);
  });

  it("respects a legitimately empty scene instead of measuring everything", () => {
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{}, { nodes: [0] }],
      nodes: [{ mesh: 0, translation: [50, 0, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { min: [0, 0, 0], max: [1, 1, 1], componentType: 5126, count: 1, type: "VEC3" },
      ],
    };
    expect(boundsFromJson(json)).toBeNull();
  });
});

describe("image bytes belong to the buffer that owns them", () => {
  it("refuses to read the BIN chunk for a bufferView on another buffer", () => {
    // Falling back to the BIN chunk here silently handed back buffer 0's bytes
    // as if they were another buffer's image — and then measured them.
    const json = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 8 }, { byteLength: 8 }],
      bufferViews: [{ buffer: 1, byteOffset: 0, byteLength: 8 }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
    };
    const glb = glbOf(json, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    expect(imageBytes(gltfJsonOf(glb), readGlbChunks(glb)!.bin, 0)).toBeNull();
  });
});

describe("image sniffing", () => {
  it("does not call a KTX1 file a KTX2", () => {
    const ktx1 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ktx2 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    const statsOf = (bytes: Buffer) =>
      textureStatsOf(
        glbOf(
          {
            asset: { version: "2.0" },
            images: [{ bufferView: 0 }],
            bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bytes.length }],
            buffers: [{ byteLength: bytes.length }],
          },
          bytes,
        ),
      );

    return Promise.all([statsOf(ktx1), statsOf(ktx2)]).then(([one, two]) => {
      expect(one.byMimeType).toEqual({ "image/ktx": 1 });
      expect(two.byMimeType).toEqual({ "image/ktx2": 1 });
    });
  });
});

describe("empty stats are not shared", () => {
  it("gives each caller its own object", async () => {
    const a = await textureStatsOf(Buffer.from("not a model"));
    const b = await textureStatsOf(Buffer.from("also not a model"));
    a.byMimeType["poisoned"] = 1;
    a.perImage.push({ index: 9, mimeType: null, bytes: 0, width: null, height: null, carrier: "embedded" });
    expect(b.byMimeType).toEqual({});
    expect(b.perImage).toEqual([]);
  });
});
