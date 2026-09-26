/**
 * The optimiser's output loads in AWE. Not "re-reads in glTF-Transform" — the
 * bytes go through the **engine's own `GLTFLoader`**, the same class
 * `packages/engine/src/internal/loader.js` and `loader-headless.ts` construct
 * at runtime, with the same `NodeDracoLoader` the headless path wires up.
 *
 * This is the test that would have caught shipping meshopt output: it decodes
 * geometry and resolves textures for real, so a file the runtime cannot open
 * fails here rather than in a player's browser.
 *
 * What this cannot prove: GPU upload, and anything mobile-only (the runtime
 * wires a KTX2 loader on mobile only). Neither is in the optimiser's output.
 */
import { describe, expect, it } from "vitest";

import { optimizeModel } from "../src/gltf";
import { bigTexturedCube, CUBE } from "./support/gltf-fixtures";

/** The engine's loader, configured the way the engine configures it. */
async function aweLoader() {
  const { GLTFLoader } = await import(
    "@oncyberio/engine/internal/resources/loaders/gltf-loader.js"
  );
  const { NodeDracoLoader } = await import(
    "@oncyberio/engine/internal/resources/loaders/node-draco-loader.js"
  );
  const loader = new GLTFLoader();
  loader.setDRACOLoader(new NodeDracoLoader());
  return loader;
}

/** Parse bytes through the AWE loader and describe what came out. */
async function loadThroughAwe(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  const loader = await aweLoader();
  const gltf = await loader.parseAsync(copy.buffer, "");

  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  let withBaseColorMap = 0;
  const attributes = new Set<string>();

  gltf.scene.traverse((object: any) => {
    if (!object.isMesh && !object.isSkinnedMesh) return;
    meshes++;
    const geometry = object.geometry;
    const position = geometry?.attributes?.position;
    vertices += position?.count ?? 0;
    for (const name of Object.keys(geometry?.attributes ?? {})) attributes.add(name);
    const indexCount = geometry?.index?.count ?? position?.count ?? 0;
    triangles += indexCount / 3;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    if (materials.some((m: any) => m?.map)) withBaseColorMap++;
  });

  return {
    meshes,
    vertices,
    triangles,
    withBaseColorMap,
    attributes: [...attributes].sort(),
    animations: gltf.animations?.length ?? 0,
  };
}

describe("a Draco + WebP GLB from the optimiser loads through the real AWE loader", () => {
  it("decodes the geometry the optimiser welded", async () => {
    const input = await bigTexturedCube();
    const { buffer, report } = await optimizeModel(input, { maxTextureSize: 256 });

    // Precondition: this really is the file we mean to test.
    expect(report.skipCode).toBeNull();
    expect(report.extensions.after?.used).toContain("KHR_draco_mesh_compression");
    expect(report.extensions.after?.used).toContain("EXT_texture_webp");
    expect(report.textures.after?.byMimeType).toEqual({ "image/webp": 1 });

    const loaded = await loadThroughAwe(buffer);

    expect(loaded.meshes).toBe(1);
    // Draco-decoded back to exactly the welded count, not the written one.
    expect(loaded.vertices).toBe(CUBE.weldedVertices);
    expect(loaded.triangles).toBe(CUBE.triangles);
    expect(loaded.attributes).toEqual(["normal", "position", "uv"]);
  });

  it("resolves the WebP texture onto the material", async () => {
    const { buffer } = await optimizeModel(await bigTexturedCube(), {
      maxTextureSize: 256,
    });
    const loaded = await loadThroughAwe(buffer);
    expect(loaded.withBaseColorMap).toBe(1);
  });

  it("loads a Draco-only model (textures turned off)", async () => {
    const { buffer, report } = await optimizeModel(await bigTexturedCube(), {
      textures: "keep",
    });
    expect(report.skipCode).toBeNull();
    expect(report.extensions.after?.used).toContain("KHR_draco_mesh_compression");
    expect(report.extensions.after?.used).not.toContain("EXT_texture_webp");

    const loaded = await loadThroughAwe(buffer);
    expect(loaded.vertices).toBe(CUBE.weldedVertices);
  });

  it("loads a WebP-only model (Draco turned off)", async () => {
    const { buffer, report } = await optimizeModel(await bigTexturedCube(), {
      draco: false,
      maxTextureSize: 128,
    });
    expect(report.skipCode).toBeNull();
    expect(report.extensions.after?.used).toEqual(["EXT_texture_webp"]);

    const loaded = await loadThroughAwe(buffer);
    expect(loaded.vertices).toBe(CUBE.weldedVertices);
    expect(loaded.withBaseColorMap).toBe(1);
  });

  it("keeps an animation loadable through Draco", async () => {
    const { buffer, report } = await optimizeModel(
      await bigTexturedCube({ animated: true }),
      { maxTextureSize: 128 },
    );
    expect(report.skipCode).toBeNull();
    expect(report.counts.after?.animations).toBe(1);

    const loaded = await loadThroughAwe(buffer);
    expect(loaded.animations).toBe(1);
    expect(loaded.vertices).toBe(CUBE.weldedVertices);
  });

  it("loads the unoptimised input too, so the comparison is like for like", async () => {
    const input = await bigTexturedCube();
    const before = await loadThroughAwe(input);
    const { buffer } = await optimizeModel(input, { maxTextureSize: 256 });
    const after = await loadThroughAwe(buffer);

    expect(before.meshes).toBe(after.meshes);
    expect(before.triangles).toBe(after.triangles);
    expect(before.withBaseColorMap).toBe(after.withBaseColorMap);
    // Only the vertex count moves, and only by the welding the report claimed.
    expect(before.vertices).toBe(CUBE.unweldedVertices);
    expect(after.vertices).toBe(CUBE.weldedVertices);
  });
});

describe("a real committed model survives the round trip", () => {
  it("optimises `soccer-field.glb` and loads the result", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const here = dirname(fileURLToPath(import.meta.url));
    const input = await readFile(join(here, "..", "artifacts", "soccer-field.glb"));

    const before = await loadThroughAwe(input);
    const { buffer, report } = await optimizeModel(input);

    expect(report.skipCode).toBeNull();
    expect(report.bytes.output).toBeLessThan(report.bytes.input);
    expect(report.extensions.after?.used).toContain("KHR_draco_mesh_compression");

    const after = await loadThroughAwe(buffer);
    expect(after.meshes).toBe(before.meshes);
    expect(after.meshes).toBeGreaterThan(0);
    expect(after.vertices).toBeGreaterThan(0);

    // Triangles are the invariant worth asserting: nothing in this pipeline
    // removes or adds a face. The *vertex* count is not — these are per-node
    // sums over a scene where `dedup` changes which nodes share a mesh, and
    // Draco's edgebreaker splits vertices at attribute seams on decode, so the
    // welded document count and the decoded scene count are different numbers
    // measuring different things (the cube fixture above, with one mesh and one
    // node, is where the welding claim is checked exactly).
    expect(after.triangles).toBe(before.triangles);
  });
});
