/**
 * The cheap layer of glTF: container parsing, resource classification and
 * image statistics, with no `@gltf-transform` document and no three.js scene.
 *
 * Everything here works on bytes and on the glTF JSON header, which is all you
 * need to answer most questions about a file — what it declares, whether it
 * drags in external resources, how big its textures are. The optimiser
 * (`safe-optimize.ts`) and the validator (`validate-model.ts`) both build on
 * it, so there is one GLB parser in this package rather than the several
 * near-identical copies that used to be scattered across it. Two copies remain
 * outside: `asset-library/src/measure.ts` (isomorphic — it runs in the browser
 * for library packing) and `space-kit/src/server.ts`'s `measureGltf`, both of
 * which also duplicate the bounds maths below. Both are in `BACKLOG.md`.
 *
 * **No module-level dependencies.** Everything but {@link textureStats} is
 * pure byte and JSON work, so a package that only needs to read a glTF header
 * can import this without pulling in `sharp`, `draco3dgltf` or
 * `@gltf-transform` — which is why `@oncyberio/space-kit` can use it
 * synchronously from its own import path. `sharp` is loaded on demand inside
 * {@link textureStats}, the one function that decodes image headers.
 *
 * @module gltf/gltf-container
 */

/**
 * Default per-file cap for the safe optimiser, in milliseconds.
 *
 * Lives in the dependency-free layer so `@oncyberio/space-kit` can re-export it
 * without pulling in sharp, Draco and gltf-transform — one value, not two that
 * drift apart.
 */
export const OPTIMIZE_TIMEOUT_MS = 30_000;

/** `glTF` as a little-endian uint32 — the first four bytes of every GLB. */
export const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** The two chunks of a GLB. `bin` is empty when the file has no binary chunk. */
export interface GlbChunks {
  json: unknown;
  bin: Uint8Array<ArrayBufferLike>;
}

/** Why a GLB could not be read, when it looked like one. */
export type GlbProblem =
  /** Not a GLB at all: wrong magic, or too short to have a header. */
  | "not-glb"
  /** The header's `version` is not 2. */
  | "bad-version"
  /** The header's total length does not match the bytes we have. */
  | "length-mismatch"
  /** A chunk's declared length runs past the end of the file. */
  | "chunk-overrun"
  /** The first chunk is not a JSON chunk, or its JSON is not a glTF object. */
  | "bad-json-chunk";

/**
 * The outcome of reading a GLB: the chunks, or the reason there are none.
 *
 * Deliberately not a discriminated union on a boolean: several packages here
 * compile with `strict: false`, which turns off the narrowing that would make
 * one ergonomic, and a shape that needs a cast to read is worse than a shape
 * with two nullable fields.
 */
export interface GlbReadResult {
  /** The chunks, or `null` when the file could not be read. */
  chunks: GlbChunks | null;
  /** Why it could not be read, or `null` on success. */
  problem: GlbProblem | null;
}

/** Chunks are 4-byte aligned; advance past the padding. */
const align4 = (n: number) => n + ((4 - (n % 4)) % 4);

/** Whether these bytes start with the GLB magic and are long enough to have a header. */
export function isGlb(data: Uint8Array): boolean {
  if (data.byteLength < 20) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(0, true) === GLB_MAGIC;
}

/**
 * Split a GLB into its JSON and BIN chunks.
 *
 * Returns `null` for anything that is not a well-formed GLB — wrong magic, a
 * first chunk that is not JSON, a declared length that runs off the end, or
 * JSON that does not parse. Never throws.
 */
export function readGlbChunks(data: Uint8Array): GlbChunks | null {
  const result = readGlb(data);
  return result.chunks;
}

/**
 * The same read, but saying *why* it failed.
 *
 * A truncated GLB is exactly the failure a validator is bought for — a
 * half-finished upload, a CDN response cut short — and it used to slip through:
 * the chunk walk simply stopped at the short chunk and returned success with an
 * empty BIN, so the file validated clean and reported the statistics of a model
 * whose geometry was no longer in it. Both length fields are checked now.
 */
export function readGlb(data: Uint8Array): GlbReadResult {
  const fail = (problem: GlbProblem): GlbReadResult => ({ chunks: null, problem });
  try {
    if (!isGlb(data)) return fail("not-glb");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    if (view.getUint32(4, true) !== 2) {
      return fail("bad-version");
    }
    // The header's total length must be the file's length. Shorter means a
    // truncated download; longer means something was appended.
    if (view.getUint32(8, true) !== data.byteLength) {
      return fail("length-mismatch");
    }

    const jsonLength = view.getUint32(12, true);
    if (view.getUint32(16, true) !== CHUNK_JSON) {
      return fail("bad-json-chunk");
    }
    const jsonEnd = 20 + jsonLength;
    if (jsonEnd > data.byteLength) {
      return fail("chunk-overrun");
    }

    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(data.subarray(20, jsonEnd)));
    } catch {
      return fail("bad-json-chunk");
    }
    // The JSON chunk must be an object. An array passes `typeof === "object"`
    // and would then flow into the bounds and reference walks as if it were a
    // glTF document.
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return fail("bad-json-chunk");
    }

    // The BIN chunk is optional, and a GLB may carry further chunks after it
    // (the spec allows unknown ones, which readers must ignore).
    let bin: Uint8Array = new Uint8Array(0);
    let offset = align4(jsonEnd);
    while (offset + 8 <= data.byteLength) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + length;
      // A chunk that runs off the end means a truncated file, not a file with
      // fewer chunks. Saying so is the whole point.
      if (end > data.byteLength) return fail("chunk-overrun");
      if (type === CHUNK_BIN) {
        bin = data.subarray(start, end);
        break;
      }
      // The spec requires chunkLength to include its padding, but an exporter
      // that writes the unpadded length would otherwise desync the walk and
      // silently lose the BIN chunk. Rounding up is never wrong for a
      // conformant file.
      offset = align4(end);
    }

    return { chunks: { json, bin }, problem: null };
  } catch {
    return fail("bad-json-chunk");
  }
}

/**
 * The glTF JSON of a GLB (its JSON chunk) or of a `.gltf` text buffer.
 *
 * `null` when the bytes are neither — including a JSON document with no
 * `asset`, which is the one field every glTF must have. Never throws.
 */
export function gltfJsonOf(data: Uint8Array): any | null {
  const glb = readGlb(data);
  if (glb.chunks) return glb.chunks.json as any;
  // A broken GLB is a broken GLB; do not then try to read it as text.
  if (isGlb(data)) return null;
  try {
    // A BOM is legal in a hand-edited .gltf and `JSON.parse` chokes on it.
    const json = JSON.parse(new TextDecoder().decode(data).replace(/^﻿/, ""));
    return json && typeof json === "object" && json.asset ? json : null;
  } catch {
    return null;
  }
}

/**
 * Parse a `.gltf` text document, requiring only that it is a JSON object.
 *
 * Unlike {@link gltfJsonOf} this does **not** require `asset`, so a caller can
 * say "this model is missing its asset block" instead of the much less useful
 * "these bytes are not glTF". The GLB path has always been this forgiving;
 * this lets the text path match it.
 */
export function gltfTextJson(data: Uint8Array): any | null {
  if (isGlb(data)) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(data).replace(/^﻿/, ""));
    return json && typeof json === "object" && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

/** One buffer or image the file points at, classified by how it is carried. */
export interface ResourceRef {
  kind: "buffer" | "image";
  /** Index in `json.buffers` / `json.images`. */
  index: number;
  /**
   * - `embedded` — a `bufferView` (GLB BIN chunk, or another buffer)
   * - `data-uri` — a `data:` URI, self-contained but inflated ~33%
   * - `external` — a relative or absolute URI that must be fetched separately
   */
  carrier: "embedded" | "data-uri" | "external";
  /** The URI as written, for `data-uri` truncated to its media type prefix. */
  uri?: string;
  mimeType?: string;
}

const DATA_URI = /^data:/i;

/**
 * Every buffer and image the file references, and how each one is carried.
 *
 * This is the whole of external-resource detection: a standalone `.gltf` may
 * point at a `.bin` and a folder of PNGs, and nothing downstream may fetch
 * them — see the note on SSRF in `validate-model.ts`. Reporting the fact is
 * the contract; resolving it is not.
 */
export function resourceRefs(json: any): ResourceRef[] {
  const refs: ResourceRef[] = [];
  const scan = (kind: "buffer" | "image", list: unknown) => {
    if (!Array.isArray(list)) return;
    list.forEach((entry: any, index: number) => {
      const uri = typeof entry?.uri === "string" ? entry.uri : undefined;
      const mimeType = typeof entry?.mimeType === "string" ? entry.mimeType : undefined;
      if (!uri) {
        refs.push({ kind, index, carrier: "embedded", mimeType });
      } else if (DATA_URI.test(uri)) {
        refs.push({
          kind,
          index,
          carrier: "data-uri",
          // Never echo a megabyte of base64 into a report.
          uri: uri.slice(0, uri.indexOf(",") + 1 || 32),
          mimeType,
        });
      } else {
        refs.push({ kind, index, carrier: "external", uri, mimeType });
      }
    });
  };
  scan("buffer", json?.buffers);
  scan("image", json?.images);
  return refs;
}

/** The refs that cannot be resolved from these bytes alone. */
export function externalRefs(json: any): ResourceRef[] {
  return resourceRefs(json).filter((r) => r.carrier === "external");
}

/** Decode a `data:` URI's payload, or `null` if it is not one we can read. */
function dataUriBytes(uri: string): Uint8Array | null {
  const comma = uri.indexOf(",");
  if (comma === -1) return null;
  const meta = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) {
      return new Uint8Array(Buffer.from(body, "base64"));
    }
    return new TextEncoder().encode(decodeURIComponent(body));
  } catch {
    return null;
  }
}

/**
 * The bytes of one image, when they are reachable from this file alone.
 *
 * `null` for an image that lives in an external file, or whose `bufferView`
 * points outside the data we have.
 */
export function imageBytes(
  json: any,
  bin: Uint8Array,
  index: number,
): Uint8Array | null {
  const image = json?.images?.[index];
  if (!image) return null;

  if (typeof image.uri === "string") {
    return DATA_URI.test(image.uri) ? dataUriBytes(image.uri) : null;
  }

  const view = json?.bufferViews?.[image.bufferView];
  if (!view) return null;

  const bufferIndex = view.buffer ?? 0;
  const buffer = json?.buffers?.[bufferIndex];
  let source: Uint8Array | null;
  if (buffer?.uri) {
    source = DATA_URI.test(buffer.uri) ? dataUriBytes(buffer.uri) : null;
  } else if (bufferIndex === 0) {
    // Only buffer 0 of a GLB may be the BIN chunk.
    source = bin;
  } else {
    // A uri-less buffer other than 0 is not something we hold. Falling back to
    // the BIN chunk here — which is what this used to do — silently attributed
    // buffer 0's bytes to another buffer's image, and then measured them.
    source = null;
  }
  if (!source) return null;

  const start = view.byteOffset ?? 0;
  const end = start + (view.byteLength ?? 0);
  if (end > source.byteLength) return null;
  return source.subarray(start, end);
}

/** What one image turned out to be, once its header was decoded. */
export interface ImageStat {
  index: number;
  /** As declared in the glTF, else as sniffed from the bytes, else `null`. */
  mimeType: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  /** How the image is carried — see {@link ResourceRef}. */
  carrier: ResourceRef["carrier"];
}

/** Aggregate texture facts, in the shape both the optimiser and validator report. */
export interface TextureStats {
  /** `json.textures.length` — texture objects, which may share an image. */
  textures: number;
  /** `json.images.length`. */
  images: number;
  /** Total bytes of every image whose bytes are reachable. */
  bytes: number;
  /** Largest width / height seen, or `null` when nothing could be measured. */
  maxWidth: number | null;
  maxHeight: number | null;
  /** Image count per declared mime type, key-sorted so the JSON is stable. */
  byMimeType: Record<string, number>;
  /** Per-image detail, in glTF index order. */
  perImage: ImageStat[];
}

/**
 * A fresh empty result.
 *
 * A factory, not a constant that callers spread: `{ ...EMPTY }` is a shallow
 * copy, so every "no textures" result used to hand back the *same*
 * `byMimeType` object and `perImage` array as every other one, and one
 * mutating consumer would have poisoned all of them.
 */
export function emptyTextureStats(): TextureStats {
  return {
    textures: 0,
    images: 0,
    bytes: 0,
    maxWidth: null,
    maxHeight: null,
    byMimeType: {},
    perImage: [],
  };
}

/** Guess a mime type from the first bytes, for an image that declares none. */
function sniffMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  // The KTX identifiers share their first five bytes (0xAB 'K' 'T' 'X' ' ')
  // and differ in the version that follows: "20" for KTX2, "11" for KTX1.
  // Checking only the first four called every KTX1 file a KTX2.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0xab &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x58 &&
    bytes[4] === 0x20
  ) {
    if (bytes[5] === 0x32 && bytes[6] === 0x30) return "image/ktx2";
    if (bytes[5] === 0x31 && bytes[6] === 0x31) return "image/ktx";
  }
  return null;
}

/**
 * Measure every image in a file, decoding headers only.
 *
 * Deliberately tolerant: an image whose bytes are not reachable (external
 * file), or whose format `sharp` cannot read (KTX2 / Basis), reports its
 * `carrier` and `bytes` with `width`/`height` `null` rather than failing the
 * whole report. Never throws.
 */
export async function textureStats(
  json: any,
  bin: Uint8Array,
): Promise<TextureStats> {
  const images: unknown[] = Array.isArray(json?.images) ? json.images : [];
  if (!images.length) {
    return {
      ...emptyTextureStats(),
      textures: Array.isArray(json?.textures) ? json.textures.length : 0,
    };
  }

  const refs = resourceRefs(json);
  const carrierOf = (index: number): ResourceRef["carrier"] =>
    refs.find((r) => r.kind === "image" && r.index === index)?.carrier ?? "embedded";

  const perImage: ImageStat[] = [];
  let bytes = 0;
  let maxWidth: number | null = null;
  let maxHeight: number | null = null;
  const byMimeType: Record<string, number> = {};

  for (let index = 0; index < images.length; index++) {
    const declared = (images[index] as { mimeType?: unknown })?.mimeType;
    const data = imageBytes(json, bin, index);
    let mimeType = typeof declared === "string" ? declared : null;
    let width: number | null = null;
    let height: number | null = null;

    if (data) {
      bytes += data.byteLength;
      mimeType ??= sniffMimeType(data);
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(Buffer.from(data)).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch {
        // KTX2/Basis and anything else sharp cannot open: size still counts.
      }
    }

    if (width != null) maxWidth = Math.max(maxWidth ?? 0, width);
    if (height != null) maxHeight = Math.max(maxHeight ?? 0, height);
    const key = mimeType ?? "unknown";
    byMimeType[key] = (byMimeType[key] ?? 0) + 1;

    perImage.push({
      index,
      mimeType,
      bytes: data?.byteLength ?? 0,
      width,
      height,
      carrier: carrierOf(index),
    });
  }

  return {
    textures: Array.isArray(json?.textures) ? json.textures.length : 0,
    images: images.length,
    bytes,
    maxWidth,
    maxHeight,
    byMimeType: sortKeys(byMimeType),
    perImage,
  };
}

/** Measure a whole file's textures from its bytes. Never throws. */
export async function textureStatsOf(data: Uint8Array): Promise<TextureStats> {
  const json = gltfJsonOf(data);
  if (!json) return emptyTextureStats();
  const bin = readGlbChunks(data)?.bin ?? new Uint8Array(0);
  return textureStats(json, bin);
}

// ── size formatting ────────────────────────────────────────────────────────
// Here rather than beside the optimiser because space-kit's server needs them
// without pulling in sharp, Draco and gltf-transform. One implementation.

/** `4.1 MB` / `922 KB` / `31 B`. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n >= 1024 * 1024) return `${(n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** `4.1 MB → 0.9 MB (−78 %)` — one line for an import note, a log or a CLI. */
export function describeSavings(before: number, after: number): string {
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  // Both sides in the unit of the larger number, so "4.1 MB → 0.9 MB" reads at
  // a glance where "4.1 MB → 922 KB" does not.
  const MB = 1048576;
  const fmt =
    before >= MB
      ? (n: number) => `${(n / MB).toFixed(n >= 10 * MB ? 0 : n >= MB / 10 ? 1 : 2)} MB`
      : formatBytes;
  return `${fmt(before)} → ${fmt(after)} (−${pct} %)`;
}

/** A copy with keys in sort order, so `JSON.stringify` is byte-stable. */
export function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key];
  return out;
}

/**
 * Every extension the file actually uses, however it was declared.
 *
 * The union of `extensionsUsed`, `extensionsRequired` and the keys of every
 * `extensions` block anywhere in the document — sorted and de-duplicated.
 *
 * **Why the union and not just `extensionsUsed`.** A reader dispatches on
 * `extensionsUsed`, so an extension whose data is present in the file but whose
 * name is missing from that list is not read, and is therefore *silently
 * dropped* when the document is written back. Real exporters produce such
 * files. Gating the optimiser on `extensionsUsed` alone meant a VRM whose name
 * list had been trimmed was not recognised as a VRM: it went through the
 * pipeline, lost its humanoid rig, blend-shape map, spring bones and licence
 * metadata, came out 7x smaller, and the never-bigger rule called that a win.
 * The same bypass turned Draco geometry declared only in `extensionsRequired`
 * into a file with no geometry at all.
 */
export function declaredExtensions(json: any): string[] {
  const names = new Set<string>();

  const addList = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const name of value) if (typeof name === "string") names.add(name);
  };
  addList(json?.extensionsUsed);
  addList(json?.extensionsRequired);

  // Walk for `extensions` blocks. Depth- and breadth-capped: this runs on
  // untrusted files and a glTF document is a plain JSON tree, so a deep or
  // wide one must cost bounded time.
  let budget = 50_000;
  const walk = (value: unknown, depth: number) => {
    if (budget-- <= 0 || depth > 32 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === "extensions" && entry && typeof entry === "object" && !Array.isArray(entry)) {
        for (const name of Object.keys(entry)) names.add(name);
      }
      walk(entry, depth + 1);
    }
  };
  walk(json, 0);

  return [...names].sort();
}

/** `extensionsUsed` / `extensionsRequired` as sorted, de-duplicated arrays. */
export function extensionsOf(json: any): { used: string[]; required: string[] } {
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((e): e is string => typeof e === "string"))].sort()
      : [];
  return {
    used: list(json?.extensionsUsed),
    required: list(json?.extensionsRequired),
  };
}

// ── bounding box ───────────────────────────────────────────────────────────

/** An axis-aligned box in the file's own units (≈ metres). */
export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  /** `max - min`, the dimensions people actually ask for. */
  size: [number, number, number];
}

type Mat4 = number[]; // column-major, like glTF

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function trsMatrix(
  t: number[] = [0, 0, 0],
  q: number[] = [0, 0, 0, 1],
  s: number[] = [1, 1, 1],
): Mat4 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Which nodes to start the bounds walk from.
 *
 * Three different situations used to collapse into "every node is a root",
 * which double-counts: a child is then measured once under its parent's
 * transform and once at the origin, silently inflating the box. They are kept
 * apart now:
 *
 * - a `scene` index that resolves → exactly that scene's nodes, **including
 *   when it is legitimately empty** (an empty scene has no bounds, and that is
 *   a real answer rather than a reason to measure everything);
 * - a `scene` index that does not resolve → fall back to scene 0 if there is
 *   one, else to the orphan rule below;
 * - no `scenes` array at all → only the nodes no node lists as a child, so
 *   every subtree is still walked exactly once.
 */
function boundsRoots(json: any): number[] {
  const scenes = Array.isArray(json.scenes) ? json.scenes : null;
  if (scenes) {
    const scene = scenes[json.scene ?? 0] ?? scenes[0];
    if (scene) return Array.isArray(scene.nodes) ? scene.nodes : [];
  }

  const isChild = new Set<number>();
  for (const node of json.nodes) {
    if (!Array.isArray(node?.children)) continue;
    for (const child of node.children) isChild.add(child);
  }
  const roots: number[] = [];
  for (let i = 0; i < json.nodes.length; i++) {
    if (!isChild.has(i)) roots.push(i);
  }
  return roots;
}

/**
 * World-space bounding box from the POSITION accessors' `min`/`max`,
 * transformed by the node hierarchy — pure JSON maths, no three.js and no
 * `@gltf-transform` document.
 *
 * That matters twice over: it works on a `.gltf` whose buffers live in files we
 * were not given (the min/max are in the JSON header, not the `.bin`), and it
 * works on Draco geometry, because the spec still requires POSITION accessors
 * to carry min/max.
 *
 * `null` when there is nothing measurable — no nodes, no meshes, no accessor
 * min/max (some exporters omit them), or a degenerate zero-size result.
 * Traversal is bounded three ways — by depth, by a per-path visited set, and by
 * a total visit budget — so neither a cycle nor a deliberately branchy graph
 * can hang it.
 */
export function boundsFromJson(json: any): Bounds | null {
  if (
    !Array.isArray(json?.nodes) ||
    !Array.isArray(json?.meshes) ||
    !Array.isArray(json?.accessors)
  ) {
    return null;
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  // A depth cap bounds depth, not work. Two nodes that each list the other
  // twice as a child expand to 2^64 visits *inside* a depth-64 limit, so a
  // 200-byte file used to hang whatever was validating it. Nothing here needs
  // to visit a node twice on the same path, so a per-path set stops the
  // blow-up and handles honest cycles at the same time; the budget is a
  // backstop for a very wide but legal graph.
  const onPath = new Set<number>();
  let budget = 200_000;

  const visit = (index: number, parent: Mat4, depth: number) => {
    const node = json.nodes[index];
    if (!node || depth > 64) return;
    if (onPath.has(index)) return;
    if (budget-- <= 0) return;
    onPath.add(index);
    const local =
      Array.isArray(node.matrix) && node.matrix.length === 16
        ? node.matrix
        : trsMatrix(node.translation, node.rotation, node.scale);
    const world = multiply(parent, local);

    if (node.mesh != null) {
      for (const primitive of json.meshes[node.mesh]?.primitives ?? []) {
        const accessor = json.accessors[primitive.attributes?.POSITION];
        if (
          !Array.isArray(accessor?.min) ||
          !Array.isArray(accessor?.max) ||
          accessor.min.length < 3
        ) {
          continue;
        }
        // All eight corners, because a rotation can push any of them outward.
        for (let corner = 0; corner < 8; corner++) {
          const px = corner & 1 ? accessor.max[0] : accessor.min[0];
          const py = corner & 2 ? accessor.max[1] : accessor.min[1];
          const pz = corner & 4 ? accessor.max[2] : accessor.min[2];
          const wx = world[0] * px + world[4] * py + world[8] * pz + world[12];
          const wy = world[1] * px + world[5] * py + world[9] * pz + world[13];
          const wz = world[2] * px + world[6] * py + world[10] * pz + world[14];
          for (const [k, v] of [wx, wy, wz].entries()) {
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
          }
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child, world, depth + 1);
    }
    onPath.delete(index);
  };

  for (const root of boundsRoots(json)) visit(root, IDENTITY, 0);

  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;

  const size: [number, number, number] = [
    round3(max[0] - min[0]),
    round3(max[1] - min[1]),
    round3(max[2] - min[2]),
  ];
  if (Math.max(...size) <= 0) return null;

  return {
    min: [round3(min[0]), round3(min[1]), round3(min[2])],
    max: [round3(max[0]), round3(max[1]), round3(max[2])],
    size,
  };
}

/** World-space bounding box straight from bytes. Never throws. */
export function boundsOf(data: Uint8Array): Bounds | null {
  const json = gltfJsonOf(data);
  return json ? boundsFromJson(json) : null;
}
