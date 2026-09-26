/**
 * Small, deterministic glTF fixtures, built in memory.
 *
 * Nothing here touches the network and nothing is committed as a binary: every
 * fixture is assembled from a handful of numbers and a `sharp`-generated image,
 * so a fresh clone produces byte-identical inputs. The counts are chosen to be
 * checkable by hand — a cube is 12 triangles as 36 unwelded vertices, which
 * welds to exactly 24.
 *
 * Shared by the optimiser and validator suites so the two are asserted against
 * the same files.
 */
import sharp from "sharp";

const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Wrap glTF JSON and a binary blob into a GLB container. */
export function glbOf(json: unknown, bin: Buffer = Buffer.alloc(0)): Buffer {
  const pad = (b: Buffer, fill: number) =>
    b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b;
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);

  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(
    12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0),
    8,
  );

  const chunkHeader = (length: number, type: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };

  const parts = [header, chunkHeader(jsonChunk.length, CHUNK_JSON), jsonChunk];
  if (binChunk.length) parts.push(chunkHeader(binChunk.length, CHUNK_BIN), binChunk);
  return Buffer.concat(parts);
}

/**
 * A noisy PNG, so it is large and WebP has something real to win.
 *
 * Gaussian noise with a fixed mean and sigma; `sharp` is deterministic for
 * these inputs, and every assertion here is on size *relations*, never on an
 * exact byte count.
 */
export async function noisyPng(size = 512): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  } as never)
    .png()
    .toBuffer();
}

/** A flat one-colour PNG — tiny, so optimising it cannot win anything. */
export async function flatPng(size = 8): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 20, g: 90, b: 200 } },
  } as never)
    .png()
    .toBuffer();
}

const CUBE_FACES: Array<[number[], number[][]]> = [
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]],
  [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 0], [1, 0, 1], [0, 0, 1]]],
];

/** The known facts about {@link texturedCube}, for assertions to quote. */
export const CUBE = {
  /** 6 faces x 2 triangles. */
  triangles: 12,
  /** Every corner written out per face: 36. */
  unweldedVertices: 36,
  /** What exact welding must reduce them to. */
  weldedVertices: 24,
  /** Unit cube, translated up 0.5, so it sits on y 0..1. */
  min: [0, 0, 0],
  max: [1, 1, 1],
  translation: [0, 0.5, 0],
} as const;

export interface TexturedCubeOptions {
  /** Extra top-level glTF keys (e.g. `extensionsUsed`). */
  extra?: Record<string, unknown>;
  /** Leave the image out entirely. */
  untextured?: boolean;
  /** Carry the image as a `data:` URI instead of a bufferView. */
  imageAsDataUri?: boolean;
  /** Point the image at an external file instead of embedding it. */
  imageUri?: string;
  /** Point the buffer at an external `.bin` instead of the GLB BIN chunk. */
  bufferUri?: string;
  /** Add an animation channel so animation/sampler counts are non-zero. */
  animated?: boolean;
}

/**
 * A textured unit cube: 12 triangles as 36 unwelded vertices (every corner
 * appears three times), POSITION / NORMAL / TEXCOORD_0, one baseColor image,
 * translated to sit on y 0..1.
 */
export function texturedCube(
  png: Buffer,
  options: TexturedCubeOptions = {},
): Buffer {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  for (const [n, verts] of CUBE_FACES) {
    for (const v of verts) {
      position.push(v[0], v[1], v[2]);
      normal.push(n[0], n[1], n[2]);
      uv.push(v[0], v[1]);
    }
  }

  const f32 = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
  const positionBytes = f32(position);
  const normalBytes = f32(normal);
  const uvBytes = f32(uv);

  const textured = !options.untextured;
  const embedImage = textured && !options.imageAsDataUri && !options.imageUri;

  // An animation needs a time input and a translation output.
  const times = options.animated ? f32([0, 1]) : Buffer.alloc(0);
  const translations = options.animated
    ? f32([0, 0.5, 0, 0, 1.5, 0])
    : Buffer.alloc(0);

  const chunks: Buffer[] = [positionBytes, normalBytes, uvBytes];
  if (options.animated) chunks.push(times, translations);
  if (embedImage) chunks.push(png);
  const bin = Buffer.concat(chunks);

  const bufferViews: Array<Record<string, unknown>> = [];
  let offset = 0;
  const pushView = (byteLength: number) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength });
    offset += byteLength;
    return bufferViews.length - 1;
  };
  const positionView = pushView(positionBytes.length);
  const normalView = pushView(normalBytes.length);
  const uvView = pushView(uvBytes.length);
  const timeView = options.animated ? pushView(times.length) : -1;
  const translationView = options.animated ? pushView(translations.length) : -1;
  const imageView = embedImage ? pushView(png.length) : -1;

  const accessors: Array<Record<string, unknown>> = [
    {
      bufferView: positionView,
      componentType: 5126,
      count: CUBE.unweldedVertices,
      type: "VEC3",
      min: [...CUBE.min],
      max: [...CUBE.max],
    },
    { bufferView: normalView, componentType: 5126, count: CUBE.unweldedVertices, type: "VEC3" },
    { bufferView: uvView, componentType: 5126, count: CUBE.unweldedVertices, type: "VEC2" },
  ];
  if (options.animated) {
    accessors.push(
      { bufferView: timeView, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: translationView, componentType: 5126, count: 2, type: "VEC3" },
    );
  }

  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "awe-test-fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [...CUBE.translation] }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            ...(textured ? { material: 0 } : {}),
          },
        ],
      },
    ],
    accessors,
    bufferViews,
    buffers: [
      options.bufferUri
        ? { byteLength: bin.length, uri: options.bufferUri }
        : { byteLength: bin.length },
    ],
    ...(textured
      ? {
          materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
          textures: [{ source: 0 }],
          images: [
            options.imageUri
              ? { uri: options.imageUri }
              : options.imageAsDataUri
                ? { uri: `data:image/png;base64,${png.toString("base64")}` }
                : { bufferView: imageView, mimeType: "image/png" },
          ],
        }
      : {}),
    ...(options.animated
      ? {
          animations: [
            {
              samplers: [{ input: 3, output: 4, interpolation: "LINEAR" }],
              channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
            },
          ],
        }
      : {}),
    ...(options.extra ?? {}),
  };

  return glbOf(json, options.bufferUri ? Buffer.alloc(0) : bin);
}

/** A cube with a big noisy texture — the happy path, where optimising wins. */
export async function bigTexturedCube(
  options: TexturedCubeOptions = {},
): Promise<Buffer> {
  return texturedCube(await noisyPng(512), options);
}

/** The smallest thing that is still valid glTF: one empty scene, no meshes. */
export function emptyGlb(extra: Record<string, unknown> = {}): Buffer {
  return glbOf({
    asset: { version: "2.0", generator: "awe-test-fixture" },
    scene: 0,
    scenes: [{ nodes: [] }],
    ...extra,
  });
}

/** A standalone `.gltf` document (not a GLB), as UTF-8 bytes. */
export function gltfJsonFile(json: unknown): Buffer {
  return Buffer.from(JSON.stringify(json), "utf8");
}
