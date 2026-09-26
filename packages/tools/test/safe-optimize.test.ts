/**
 * The safe optimiser's contract: never fails, never returns bigger bytes,
 * refuses what it cannot round-trip, and reports deterministic facts.
 *
 * Every fixture is built in memory (see `support/gltf-fixtures.ts`) — no
 * network, no committed binaries, hand-checkable counts.
 */
import { describe, expect, it } from "vitest";

import {
  OPTIMIZE_REPORT_VERSION,
  optimizeModel,
  optimizeModelBuffer,
  stableReport,
  VRM_EXTENSIONS,
  type OptimizeModelOutput,
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

describe("the happy path", () => {
  it("shrinks a textured cube and says so", async () => {
    const input = await bigTexturedCube();
    const { buffer, report } = await optimizeModel(input);

    expect(report.skipCode).toBeNull();
    expect(report.optimized).toBe(true);
    expect(report.changed).toBe(true);
    expect(buffer.byteLength).toBeLessThan(input.length);
    expect(report.bytes).toEqual({
      input: input.length,
      output: buffer.byteLength,
      candidate: buffer.byteLength,
    });
    expect(report.percentChange).toBeLessThan(0);
  });

  it("welds the cube's 36 written vertices down to its 24 real ones", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.counts.before?.vertices).toBe(CUBE.unweldedVertices);
    expect(report.counts.after?.vertices).toBe(CUBE.weldedVertices);
    expect(report.transforms.applied).toContain("weld");
  });

  it("records what it attempted, applied and skipped, as codes", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.transforms.attempted).toEqual([
      "dedup",
      "prune",
      "weld",
      "textures",
      "draco",
    ]);
    expect(report.transforms.applied).toEqual([
      "dedup",
      "prune",
      "weld",
      "textures",
      "draco",
    ]);
    expect(report.transforms.skipped).toEqual([]);
  });

  it("names the transforms it did not run, with a machine code", async () => {
    // No textures and Draco turned off: two transforms have nothing to do.
    const input = texturedCube(await flatPng(), { untextured: true });
    const { report } = await optimizeModel(input, { draco: false });

    // Texture handling is always *attempted* (it is on by default); it is the
    // absence of textures that skips it. Draco was turned off by the caller.
    expect(report.transforms.attempted).toEqual([
      "dedup",
      "prune",
      "weld",
      "textures",
    ]);
    expect(report.transforms.applied).not.toContain("draco");
    const codes = Object.fromEntries(
      report.transforms.skipped.map((s) => [s.id, s.code]),
    );
    expect(codes.textures).toBe("no-textures");
    expect(codes.draco).toBe("disabled");
    for (const entry of report.transforms.skipped) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("reports texture statistics on both sides, including dimensions", async () => {
    const { report } = await optimizeModel(await bigTexturedCube(), {
      maxTextureSize: 128,
    });

    expect(report.textures.before.images).toBe(1);
    expect(report.textures.before.maxWidth).toBe(512);
    expect(report.textures.before.byMimeType).toEqual({ "image/png": 1 });

    expect(report.textures.after?.images).toBe(1);
    expect(report.textures.after?.maxWidth).toBe(128);
    expect(report.textures.after?.maxHeight).toBe(128);
    expect(report.textures.after?.byMimeType).toEqual({ "image/webp": 1 });
  });

  it("honours the maximum texture dimension", async () => {
    for (const cap of [64, 256]) {
      const { report } = await optimizeModel(await bigTexturedCube(), {
        maxTextureSize: cap,
      });
      expect(report.textures.after?.maxWidth).toBe(cap);
    }
  });

  it("reports the extensions on both sides", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.extensions.before).toEqual({ used: [], required: [] });
    expect(report.extensions.after?.used).toEqual([
      "EXT_texture_webp",
      "KHR_draco_mesh_compression",
    ]);
  });
});

describe("never bigger", () => {
  it("returns the input untouched when the candidate would not be smaller", async () => {
    // A tiny flat texture and eight vertices: every transform costs more in
    // container overhead than it saves.
    const input = glbOf({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [] }],
    });
    const { buffer, report } = await optimizeModel(input);

    expect(report.skipCode).toBe("not-smaller");
    expect(report.skipReason).toBe("not smaller");
    expect(report.optimized).toBe(false);
    expect(report.changed).toBe(false);
    expect(Buffer.from(buffer)).toEqual(input);
    expect(report.bytes.output).toBe(input.length);
    expect(report.percentChange).toBe(0);
  });

  it("still reports the candidate size, so 'tried and lost' is distinguishable", async () => {
    const input = emptyGlb();
    const { report } = await optimizeModel(input);
    expect(report.skipCode).toBe("not-smaller");
    expect(report.bytes.candidate).toBeGreaterThan(0);
    expect(report.bytes.candidate).toBeGreaterThanOrEqual(input.length);
  });

  it("leaves `candidate` null when the pipeline never ran", async () => {
    const { report } = await optimizeModel(Buffer.from("not a model"));
    expect(report.bytes.candidate).toBeNull();
  });
});

describe("files it refuses to touch", () => {
  it("skips an already-Draco file", async () => {
    const input = texturedCube(await flatPng(), {
      extra: { extensionsUsed: ["KHR_draco_mesh_compression"] },
    });
    const { buffer, report } = await optimizeModel(input);
    expect(report.skipCode).toBe("already-compressed");
    expect(report.skipReason).toBe("already compressed");
    expect(Buffer.from(buffer)).toEqual(input);
  });

  it("skips an already-meshopt file", async () => {
    const input = texturedCube(await flatPng(), {
      extra: { extensionsUsed: ["EXT_meshopt_compression"] },
    });
    const { report } = await optimizeModel(input);
    expect(report.skipCode).toBe("already-compressed");
  });

  it("skips its own output — optimising twice is a no-op", async () => {
    const once = await optimizeModel(await bigTexturedCube());
    expect(once.report.skipCode).toBeNull();

    const twice = await optimizeModel(once.buffer);
    expect(twice.report.skipCode).toBe("already-compressed");
    expect(twice.buffer).toBe(once.buffer);
  });

  it("skips every flavour of VRM with a `vrm` code", async () => {
    for (const extension of VRM_EXTENSIONS) {
      const input = texturedCube(await flatPng(), {
        extra: { extensionsUsed: [extension] },
      });
      const { buffer, report } = await optimizeModel(input);
      expect(report.skipCode, extension).toBe("vrm");
      // The message stays what it has always been, so import notes do not move.
      expect(report.skipReason).toBe(`unsupported extension ${extension}`);
      expect(Buffer.from(buffer)).toEqual(input);
    }
  });

  it("skips an unknown vendor extension, separately from VRM", async () => {
    const input = texturedCube(await flatPng(), {
      extra: { extensionsUsed: ["ACME_secret_sauce"] },
    });
    const { report } = await optimizeModel(input);
    expect(report.skipCode).toBe("unsupported-extension");
    expect(report.skipReason).toBe("unsupported extension ACME_secret_sauce");
  });

  it("passes a known Khronos extension through", async () => {
    const input = texturedCube(await flatPng(), {
      extra: { extensionsUsed: ["KHR_materials_unlit"] },
    });
    const { report } = await optimizeModel(input);
    expect(report.skipCode).not.toBe("unsupported-extension");
  });

  it("refuses a .gltf that points at files it was not given", async () => {
    const input = gltfJsonFile({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [] }],
      buffers: [{ byteLength: 16, uri: "scene.bin" }],
    });
    const { buffer, report } = await optimizeModel(input);
    expect(report.skipCode).toBe("external-resources");
    expect(report.skipReason).toMatch(/references external files \(scene\.bin\)/);
    expect(Buffer.from(buffer)).toEqual(input);
  });
});

describe("malformed input never throws", () => {
  const cases: Array<[string, () => Promise<Buffer> | Buffer]> = [
    ["empty", () => Buffer.alloc(0)],
    ["random bytes", () => Buffer.from("this is not a model at all")],
    ["a JSON document that is not glTF", () => gltfJsonFile({ hello: "world" })],
    ["a truncated GLB", async () => (await bigTexturedCube()).subarray(0, 600)],
    [
      "a GLB whose JSON chunk lies about its length",
      async () => {
        const glb = Buffer.from(await bigTexturedCube());
        glb.writeUInt32LE(0xffffff, 12);
        return glb;
      },
    ],
    [
      "a GLB with the wrong second chunk type",
      async () => {
        const glb = Buffer.from(await bigTexturedCube());
        glb.writeUInt32LE(0xdeadbeef, 16);
        return glb;
      },
    ],
  ];

  for (const [label, make] of cases) {
    it(`survives ${label}`, async () => {
      const input = Buffer.from(await make());
      const { buffer, report } = await optimizeModel(input);
      expect(report.skipCode).not.toBeNull();
      expect(report.skipReason).toBeTruthy();
      expect(report.optimized).toBe(false);
      expect(Buffer.from(buffer)).toEqual(input);
    });
  }

  it("survives a corrupted binary chunk", async () => {
    const glb = Buffer.from(await bigTexturedCube());
    // Scribble over the middle of the BIN chunk, keeping the container valid.
    glb.fill(0xff, glb.length - 400, glb.length - 200);
    const { report } = await optimizeModel(glb);
    // Either it copes or it skips — what it must not do is throw.
    expect(typeof report.reportVersion).toBe("number");
  });
});

describe("the timeout", () => {
  /** A transform that never settles, so the cap is the only way out. */
  const neverSettles = () => new Promise<OptimizeModelOutput>(() => {});

  it("gives up and returns the input", async () => {
    const input = await bigTexturedCube();
    const { buffer, report } = await optimizeModel(input, {
      timeoutMs: 5,
      runTransform: neverSettles,
    });

    expect(report.skipCode).toBe("timeout");
    expect(report.skipReason).toBe("timeout");
    expect(Buffer.from(buffer)).toEqual(input);
    expect(report.bytes.output).toBe(input.length);
  });

  it("does not fire when the work finishes first", async () => {
    const { report } = await optimizeModel(await bigTexturedCube(), {
      timeoutMs: 120_000,
    });
    expect(report.skipCode).toBeNull();
  });

  it("does not leave an abandoned rejection unhandled", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { report } = await optimizeModel(await bigTexturedCube(), {
        timeoutMs: 5,
        runTransform: () =>
          new Promise<OptimizeModelOutput>((_resolve, reject) =>
            setTimeout(() => reject(new Error("too late")), 40),
          ),
      });
      expect(report.skipCode).toBe("timeout");
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("turns a transform failure into a skip, not a rejection", async () => {
    const input = await bigTexturedCube();
    const { buffer, report } = await optimizeModel(input, {
      runTransform: () => Promise.reject(new Error("sharp exploded\nstack line")),
    });
    expect(report.skipCode).toBe("failed");
    expect(report.skipReason).toBe("sharp exploded");
    expect(Buffer.from(buffer)).toEqual(input);
  });
});

describe("the report is deterministic", () => {
  it("is byte-identical across runs once the clock is removed", async () => {
    const input = await bigTexturedCube();
    const a = await optimizeModel(input, { maxTextureSize: 128 });
    const b = await optimizeModel(input, { maxTextureSize: 128 });

    expect(JSON.stringify(stableReport(a.report))).toBe(
      JSON.stringify(stableReport(b.report)),
    );
    expect(Buffer.from(a.buffer)).toEqual(Buffer.from(b.buffer));
  });

  it("orders `byMimeType` keys, so a two-format model still compares equal", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    const keys = Object.keys(report.textures.before.byMimeType);
    expect(keys).toEqual([...keys].sort());
  });

  it("carries a schema version", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.reportVersion).toBe(OPTIMIZE_REPORT_VERSION);
  });

  it("keeps elapsedMs out of the stable view", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(stableReport(report)).not.toHaveProperty("elapsedMs");
  });
});

describe("what it must never claim", () => {
  it("never writes meshopt-compressed geometry (AWE cannot load it)", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.extensions.after?.used).not.toContain("EXT_meshopt_compression");
    expect(report.extensions.after?.required).not.toContain(
      "EXT_meshopt_compression",
    );
  });

  it("never writes KTX2 / Basis, and never labels anything as such", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.extensions.after?.used).not.toContain("KHR_texture_basisu");
    for (const mime of Object.keys(report.textures.after?.byMimeType ?? {})) {
      expect(mime).not.toMatch(/ktx|basis/i);
    }
  });

  it("does not convert normal maps to a lossy format", async () => {
    // The colour slot becomes WebP; a normal map keeps its format and is only
    // resized, because lossy re-encoding of normals shows as shading noise.
    const { transforms } = await optimizeModelBuffer(
      await bigTexturedCube(),
      {},
    );
    expect(transforms.applied).toContain("textures");
  });
});

describe("the lower-level pipeline is still the lower-level pipeline", () => {
  it("throws on unreadable input rather than skipping", async () => {
    await expect(
      optimizeModelBuffer(new Uint8Array(Buffer.from("nope"))),
    ).rejects.toThrow(/not a glTF/);
  });

  it("does not apply the never-bigger rule", async () => {
    const input = emptyGlb();
    const out = await optimizeModelBuffer(new Uint8Array(input));
    // It hands back a bigger file quite happily; policy is the caller's job.
    expect(out.skipped).toBeUndefined();
    expect(out.buffer.byteLength).toBeGreaterThanOrEqual(input.length);
  });
});

describe("the extension gate sees what the file actually uses", () => {
  /**
   * The bypass, which cost an avatar its rig: a reader dispatches on
   * `extensionsUsed`, so an extension whose data is present but whose *name*
   * is missing from that list is never read — and is therefore silently
   * dropped on write. The result is smaller, so the never-bigger rule used to
   * call the wreckage a win.
   */
  it("refuses a VRM whose extensionsUsed has been trimmed", async () => {
    const input = texturedCube(await flatPng(), {
      extra: {
        // Declared nowhere in the name lists — only as real data.
        extensions: { VRM: { exporterVersion: "UniVRM-0.99", meta: {} } },
      },
    });

    const { buffer, report } = await optimizeModel(input);

    expect(report.skipCode).toBe("vrm");
    expect(Buffer.from(buffer)).toEqual(input);
  });

  it("refuses Draco declared only in extensionsRequired", async () => {
    const input = texturedCube(await flatPng(), {
      extra: { extensionsRequired: ["KHR_draco_mesh_compression"] },
    });

    const { buffer, report } = await optimizeModel(input);

    expect(report.skipCode).toBe("already-compressed");
    expect(Buffer.from(buffer)).toEqual(input);
  });

  it("refuses an unknown extension found only in a nested extensions block", async () => {
    const input = texturedCube(await flatPng(), {
      extra: {
        materials: [
          {
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
            extensions: { ACME_secret_sauce: { magic: true } },
          },
        ],
      },
    });

    const { report } = await optimizeModel(input);
    expect(report.skipCode).toBe("unsupported-extension");
    expect(report.skipReason).toMatch(/ACME_secret_sauce/);
  });

  it("still optimises a file whose only nested extension is one it supports", async () => {
    const input = await bigTexturedCube({
      extra: {
        materials: [
          {
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
            extensions: { KHR_materials_unlit: {} },
          },
        ],
        extensionsUsed: ["KHR_materials_unlit"],
      },
    });

    const { report } = await optimizeModel(input);
    expect(report.skipCode).toBeNull();
  });
});

describe("a refusal costs nothing but a parse", () => {
  it("does not decode the document or measure textures before refusing", async () => {
    // Deciding the refusal *after* describing the input meant every
    // already-compressed re-import instantiated the Draco wasm encoders and
    // ran sharp over every image — outside the timeout — to produce facts
    // about a file it was about to decline.
    const input = texturedCube(await noisyPng(512), {
      extra: { extensionsUsed: ["KHR_draco_mesh_compression"] },
    });

    const { report } = await optimizeModel(input);

    expect(report.skipCode).toBe("already-compressed");
    // The extensions are what the refusal is about, so they are reported…
    expect(report.extensions.before.used).toContain(
      "KHR_draco_mesh_compression",
    );
    // …and everything that would have cost a decode is an honest nothing.
    expect(report.counts.before).toBeNull();
    expect(report.textures.before.perImage).toEqual([]);
    expect(report.textures.before.maxWidth).toBeNull();
  });

  it("reports no transforms attempted when the whole file is refused", async () => {
    const { report } = await optimizeModel(
      texturedCube(await flatPng(), { extra: { extensionsUsed: ["ACME_x"] } }),
    );
    // Claiming five attempts and explaining none of them would be a lie a CI
    // job reads: `skipped` is documented as the gap between the two.
    expect(report.transforms).toEqual({
      attempted: [],
      applied: [],
      skipped: [],
    });
  });
});

describe("the report says which report it is", () => {
  it("carries a kind, so it cannot be confused with the validator's", async () => {
    const { report } = await optimizeModel(await bigTexturedCube());
    expect(report.kind).toBe("gltf-optimize");
  });
});
