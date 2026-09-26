/**
 * The validator's contract: report facts, never fetch anything, never throw,
 * and be precise about what "valid" means.
 *
 * Fixtures are built in memory with hand-checkable counts (see
 * `support/gltf-fixtures.ts`), and several of them are the *optimiser's own
 * output*, so the two halves of the asset pipeline check each other rather than
 * drifting into parallel worlds.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  AWE_RUNTIME_EXTENSIONS,
  optimizeModel,
  stableModelReport,
  VALIDATE_REPORT_VERSION,
  validateModel,
} from "../src/gltf";
import { pepeVrmFixture, soccerFieldFixture } from "./support/cli-test-helpers";
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

describe("a valid minimal GLB", () => {
  it("is valid, and says what level of checking that means", async () => {
    const report = await validateModel(emptyGlb());
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.level).toBe("structural");
    expect(report.reportVersion).toBe(VALIDATE_REPORT_VERSION);
    expect(report.file.container).toBe("glb");
  });

  it("warns, rather than errors, about having nothing in it", async () => {
    const report = await validateModel(emptyGlb());
    const codes = report.warnings.map((w) => w.code);
    expect(codes).toContain("no-geometry");
    expect(report.valid).toBe(true);
  });

  it("reads the asset block from the file, not from a reader", async () => {
    const report = await validateModel(
      glbOf({
        asset: { version: "2.0", generator: "acme-exporter 3.1", copyright: "© nobody" },
        scenes: [{ nodes: [] }],
      }),
    );
    expect(report.asset).toEqual({
      version: "2.0",
      generator: "acme-exporter 3.1",
      copyright: "© nobody",
    });
  });
});

describe("counts are the counts", () => {
  it("gets the cube's hand-countable geometry right", async () => {
    const report = await validateModel(await bigTexturedCube());

    expect(report.statsSource).toBe("document");
    expect(report.counts).toMatchObject({
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      triangles: CUBE.triangles,
      trianglesInstanced: CUBE.triangles,
      vertices: CUBE.unweldedVertices,
      materials: 1,
      textures: 1,
      images: 1,
      animations: 0,
      skins: 0,
      morphTargets: 0,
      cameras: 0,
      lights: 0,
    });
  });

  it("counts an animation", async () => {
    const report = await validateModel(await bigTexturedCube({ animated: true }));
    expect(report.counts.animations).toBe(1);
  });

  it("measures the bounds through the node transform", async () => {
    // The cube is a unit cube translated up 0.5, so it sits on y 0..1.
    const report = await validateModel(await bigTexturedCube());
    expect(report.bounds).toEqual({
      min: [0, 0.5, 0],
      max: [1, 1.5, 1],
      size: [1, 1, 1],
    });
  });

  it("measures textures, with dimensions and mime types", async () => {
    const report = await validateModel(await bigTexturedCube());
    expect(report.textures.images).toBe(1);
    expect(report.textures.maxWidth).toBe(512);
    expect(report.textures.maxHeight).toBe(512);
    expect(report.textures.byMimeType).toEqual({ "image/png": 1 });
    expect(report.textures.perImage[0]).toMatchObject({
      index: 0,
      mimeType: "image/png",
      width: 512,
      carrier: "embedded",
    });
  });

  it("counts multiple primitives separately", async () => {
    const png = await flatPng();
    const cube = texturedCube(png);
    // Duplicate the single primitive so the mesh has two.
    const json = JSON.parse(
      new TextDecoder().decode(
        cube.subarray(20, 20 + cube.readUInt32LE(12)),
      ),
    );
    json.meshes[0].primitives.push({ ...json.meshes[0].primitives[0] });
    const bin = cube.subarray(20 + cube.readUInt32LE(12) + 8);

    const report = await validateModel(glbOf(json, Buffer.from(bin)));
    expect(report.counts.primitives).toBe(2);
    expect(report.counts.triangles).toBe(CUBE.triangles * 2);
  });
});

describe("header-only mode", () => {
  it("skips the decode and says the numbers are missing rather than guessing", async () => {
    const report = await validateModel(await bigTexturedCube(), {
      headerOnly: true,
    });
    expect(report.statsSource).toBe("header");
    expect(report.counts.triangles).toBeNull();
    expect(report.counts.vertices).toBeNull();
    expect(report.counts.morphTargets).toBeNull();
    // Everything that does not need a decode is still there.
    expect(report.counts.meshes).toBe(1);
    expect(report.counts.primitives).toBe(1);
    expect(report.bounds?.size).toEqual([1, 1, 1]);
    expect(report.textures.maxWidth).toBe(512);
  });
});

describe("external resources are reported, never fetched", () => {
  it("lists an external buffer and refuses to count what needs it", async () => {
    const report = await validateModel(
      gltfJsonFile({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [] }],
        buffers: [{ byteLength: 1024, uri: "scene.bin" }],
      }),
    );

    expect(report.valid).toBe(true);
    expect(report.resources.selfContained).toBe(false);
    expect(report.resources.external).toEqual([
      expect.objectContaining({ kind: "buffer", index: 0, uri: "scene.bin" }),
    ]);
    expect(report.warnings.map((w) => w.code)).toContain("external-resources");
    expect(report.warnings.map((w) => w.code)).toContain("stats-unavailable");
    expect(report.counts.triangles).toBeNull();
    expect(report.statsSource).toBe("header");
  });

  it("does not attempt a request for an http(s) URI", async () => {
    // If anything here fetched, this is what it would hit. Nothing does.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const report = await validateModel(
        gltfJsonFile({
          asset: { version: "2.0" },
          scenes: [{ nodes: [] }],
          images: [{ uri: "http://169.254.169.254/latest/meta-data/" }],
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(report.resources.external[0].uri).toBe(
        "http://169.254.169.254/latest/meta-data/",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("treats a data: URI as self-contained, and says it costs a third more", async () => {
    const report = await validateModel(
      texturedCube(await noisyPng(64), { imageAsDataUri: true }),
    );
    expect(report.resources.selfContained).toBe(true);
    expect(report.resources.dataUris).toBe(1);
    expect(report.warnings.map((w) => w.code)).toContain("data-uri-resources");
    // And it can still measure the image inside the data URI.
    expect(report.textures.maxWidth).toBe(64);
    expect(report.textures.perImage[0].carrier).toBe("data-uri");
  });

  it("never echoes a whole base64 payload back into the report", async () => {
    const report = await validateModel(
      texturedCube(await noisyPng(64), { imageAsDataUri: true }),
    );
    expect(JSON.stringify(report).length).toBeLessThan(8_000);
  });
});

describe("extensions", () => {
  it("separates unknown from known-but-not-round-trippable", async () => {
    const report = await validateModel(
      texturedCube(await flatPng(), {
        extra: { extensionsUsed: ["ACME_secret_sauce", "KHR_lights_punctual"] },
      }),
    );

    // Only the vendor extension is a mystery to AWE.
    expect(report.extensions.unknown).toEqual(["ACME_secret_sauce"]);
    // `KHR_lights_punctual` is a Khronos extension the optimiser's io knows and
    // can write back, so it does *not* make the file un-round-trippable — even
    // though the runtime drops the lights. The two questions are separate.
    expect(report.extensions.notRoundTrippable).toEqual(["ACME_secret_sauce"]);
    expect(report.extensions.runtime).toHaveProperty("KHR_lights_punctual");
    expect(report.extensions.runtime).not.toHaveProperty("ACME_secret_sauce");
  });

  it("warns that AWE silently drops punctual lights", async () => {
    const report = await validateModel(
      texturedCube(await flatPng(), {
        extra: { extensionsUsed: ["KHR_lights_punctual"] },
      }),
    );
    const warning = report.warnings.find((w) => w.code === "runtime-ignored");
    expect(warning?.message).toMatch(/KHR_lights_punctual/);
    expect(warning?.message).toMatch(/pointlight/);
    expect(report.valid).toBe(true);
  });

  it("warns that a meshopt file will not load in AWE at all", async () => {
    const report = await validateModel(
      texturedCube(await flatPng(), {
        extra: { extensionsUsed: ["EXT_meshopt_compression"] },
      }),
    );
    const warning = report.warnings.find((w) => w.code === "runtime-unsupported");
    expect(warning?.message).toMatch(/EXT_meshopt_compression/);
    expect(warning?.message).toMatch(/setMeshoptDecoder/);
  });

  it("warns that KTX2 is mobile-only in this runtime", async () => {
    const report = await validateModel(
      texturedCube(await flatPng(), {
        extra: { extensionsUsed: ["KHR_texture_basisu"] },
      }),
    );
    expect(report.warnings.map((w) => w.code)).toContain("runtime-partial");
    expect(report.extensions.runtime.KHR_texture_basisu.support).toBe("partial");
  });

  it("says nothing alarming about an extension AWE fully supports", async () => {
    const report = await validateModel(
      texturedCube(await flatPng(), {
        extra: { extensionsUsed: ["KHR_materials_unlit"] },
      }),
    );
    expect(report.extensions.unknown).toEqual([]);
    expect(report.extensions.notRoundTrippable).toEqual([]);
    expect(
      report.warnings.filter((w) => w.code.startsWith("runtime-")),
    ).toEqual([]);
  });

  it("recognises a real VRM as both un-round-trippable and web-only", async () => {
    const report = await validateModel(readFileSync(pepeVrmFixture));
    expect(report.valid).toBe(true);
    expect(report.extensions.used).toContain("VRM");
    expect(
      report.warnings.find((w) => w.code === "not-round-trippable")?.message,
    ).toMatch(/VRM avatar/);
    expect(report.extensions.runtime.VRM.support).toBe("partial");
  });

  it("every runtime fact carries its evidence", () => {
    for (const [name, fact] of Object.entries(AWE_RUNTIME_EXTENSIONS)) {
      expect(fact.note.length, name).toBeGreaterThan(10);
      expect(["supported", "ignored", "partial", "unsupported"]).toContain(
        fact.support,
      );
    }
  });
});

describe("structural errors", () => {
  it("rejects an empty file", async () => {
    const report = await validateModel(new Uint8Array(0));
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("empty-file");
  });

  it("rejects bytes that are not glTF at all", async () => {
    const report = await validateModel(Buffer.from("hello, world"));
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("not-a-gltf");
  });

  it("rejects a GLB whose chunk layout is broken", async () => {
    const glb = Buffer.from(await bigTexturedCube());
    glb.writeUInt32LE(0xffffff, 12); // JSON chunk longer than the file
    const report = await validateModel(glb);
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("glb-truncated");
  });

  it("rejects a truncated GLB", async () => {
    const report = await validateModel((await bigTexturedCube()).subarray(0, 600));
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("glb-truncated");
  });

  it("catches a GLB truncated inside its BIN chunk, which used to validate clean", async () => {
    // The JSON chunk survives, so every header statistic still parses — and
    // the walk used to stop at the short BIN chunk and call that success,
    // reporting the geometry of a model whose geometry was no longer there.
    const intact = Buffer.from(await bigTexturedCube());
    const truncated = intact.subarray(0, intact.length - 2000);

    const report = await validateModel(truncated);
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("glb-truncated");
    expect(report.errors[0].message).toMatch(/truncat/i);
  });

  it("rejects a GLB declaring a container version other than 2", async () => {
    const glb = Buffer.from(await bigTexturedCube());
    glb.writeUInt32LE(99, 4);
    const report = await validateModel(glb);
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("glb-malformed");
  });

  it("says a .gltf is missing its asset block rather than calling it not-glTF", async () => {
    const report = await validateModel(
      gltfJsonFile({ scenes: [{ nodes: [] }] }),
    );
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("missing-asset");
    expect(report.file.container).toBe("gltf-json");
  });

  it("rejects malformed JSON in a .gltf", async () => {
    const report = await validateModel(Buffer.from('{"asset": {"version": '));
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("not-a-gltf");
  });

  it("rejects a document with no asset block", async () => {
    const report = await validateModel(glbOf({ scenes: [] }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("missing-asset");
  });

  it("rejects glTF 1.0", async () => {
    const report = await validateModel(glbOf({ asset: { version: "1.0" } }));
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain(
      "unsupported-asset-version",
    );
  });

  it("catches a required extension that is not declared as used", async () => {
    const report = await validateModel(
      glbOf({
        asset: { version: "2.0" },
        scenes: [{ nodes: [] }],
        extensionsRequired: ["KHR_draco_mesh_compression"],
        extensionsUsed: [],
      }),
    );
    expect(report.valid).toBe(false);
    const error = report.errors.find(
      (e) => e.code === "required-extension-not-used",
    );
    expect(error?.pointer).toBe("/extensionsRequired");
  });

  it("catches dangling references, and points at them", async () => {
    const report = await validateModel(
      glbOf({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0, 7] }],
        nodes: [{ mesh: 4 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 9 } }] }],
        accessors: [],
      }),
    );

    expect(report.valid).toBe(false);
    const pointers = report.errors
      .filter((e) => e.code === "dangling-reference")
      .map((e) => e.pointer);
    expect(pointers).toContain("/scenes/0/nodes/1");
    expect(pointers).toContain("/nodes/0/mesh");
    expect(pointers).toContain("/meshes/0/primitives/0/attributes/POSITION");
  });

  it("does not invent dangling references in a healthy file", async () => {
    const report = await validateModel(await bigTexturedCube({ animated: true }));
    expect(report.errors).toEqual([]);
  });

  it("never throws, whatever the bytes", async () => {
    const nasty: Array<Uint8Array | Buffer> = [
      Buffer.alloc(0),
      Buffer.from([0x67, 0x6c, 0x54, 0x46]),
      Buffer.from("glTF" + " ".repeat(40)),
      Buffer.from(JSON.stringify({ asset: { version: "2.0" }, nodes: "not an array" })),
      Buffer.from(JSON.stringify({ asset: { version: "2.0" }, nodes: [{ children: [0] }] })),
      (await bigTexturedCube()).subarray(0, 21),
    ];
    for (const bytes of nasty) {
      const report = await validateModel(bytes);
      expect(typeof report.valid).toBe("boolean");
      expect(report.reportVersion).toBe(VALIDATE_REPORT_VERSION);
    }
  });

  it("survives a cyclic node graph instead of recursing forever", async () => {
    const report = await validateModel(
      glbOf({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ children: [1] }, { children: [0] }],
        meshes: [],
        accessors: [],
      }),
    );
    expect(typeof report.valid).toBe("boolean");
  });
});

describe("the report is deterministic", () => {
  it("is byte-identical across runs once the clock is removed", async () => {
    const input = await bigTexturedCube();
    const a = await validateModel(input);
    const b = await validateModel(input);
    expect(JSON.stringify(stableModelReport(a))).toBe(
      JSON.stringify(stableModelReport(b)),
    );
  });

  it("sorts extension lists and runtime keys", async () => {
    const report = await validateModel(
      texturedCube(await flatPng(), {
        extra: {
          extensionsUsed: ["KHR_texture_basisu", "EXT_meshopt_compression", "ACME_z"],
        },
      }),
    );
    for (const list of [
      report.extensions.used,
      report.extensions.unknown,
      report.extensions.notRoundTrippable,
      Object.keys(report.extensions.runtime),
    ]) {
      expect(list).toEqual([...list].sort());
    }
  });

  it("keeps elapsedMs out of the stable view", async () => {
    const report = await validateModel(emptyGlb());
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(stableModelReport(report)).not.toHaveProperty("elapsedMs");
  });
});

describe("the optimiser and the validator agree", () => {
  it("validates the optimiser's own Draco + WebP output", async () => {
    const { buffer, report: optimized } = await optimizeModel(
      await bigTexturedCube(),
      { maxTextureSize: 256 },
    );
    const report = await validateModel(buffer);

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.extensions.used).toEqual([
      "EXT_texture_webp",
      "KHR_draco_mesh_compression",
    ]);
    // Both halves see the same file the same way.
    expect(report.file.bytes).toBe(optimized.bytes.output);
    expect(report.counts.vertices).toBe(optimized.counts.after?.vertices);
    expect(report.textures.maxWidth).toBe(optimized.textures.after?.maxWidth);
    expect(report.textures.byMimeType).toEqual(
      optimized.textures.after?.byMimeType,
    );
  });

  it("agrees on the input before it was optimised, too", async () => {
    const input = await bigTexturedCube();
    const before = await validateModel(input);
    const { report: optimized } = await optimizeModel(input);

    expect(before.counts.vertices).toBe(optimized.counts.before?.vertices);
    expect(before.textures.byMimeType).toEqual(
      optimized.textures.before.byMimeType,
    );
    expect(before.extensions.used).toEqual(optimized.extensions.before.used);
  });

  it("says a Draco output still has measurable bounds", async () => {
    // Draco keeps accessor min/max, which is what makes the builder's
    // auto-sizing work on compressed models.
    const { buffer } = await optimizeModel(await bigTexturedCube());
    const report = await validateModel(buffer);
    expect(report.bounds?.size).toEqual([1, 1, 1]);
  });

  it("warns about what the optimiser would skip, before it is run", async () => {
    const vrm = readFileSync(pepeVrmFixture);
    const check = await validateModel(vrm);
    const { report: attempt } = await optimizeModel(vrm);

    expect(check.warnings.map((w) => w.code)).toContain("not-round-trippable");
    expect(attempt.skipCode).toBe("vrm");
  });
});

describe("a real committed model", () => {
  it("reports the soccer field's geometry and bounds", async () => {
    const report = await validateModel(readFileSync(soccerFieldFixture));
    expect(report.valid).toBe(true);
    expect(report.counts.meshes).toBe(22);
    expect(report.counts.triangles).toBe(7975);
    expect(report.counts.materials).toBe(5);
    expect(report.counts.textures).toBe(0);
    expect(report.bounds?.size[0]).toBeGreaterThan(30);
    expect(report.asset?.generator).toMatch(/Sketchfab/);
  });
});
