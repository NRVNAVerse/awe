/**
 * Conservative single-variant glTF optimiser for uploaded media (space-kit /
 * world server imports). Unlike {@link optimizeGLTF} it produces ONE file and
 * only applies steps that keep the model looking the same:
 *
 *   dedup → prune (unused only; leaf nodes, attributes, indices kept) →
 *   weld (exact duplicates) → textures → WebP (≤ maxTextureSize; the
 *   `normalTexture` slot keeps its format and is only resized) → Draco
 *   (edgebreaker, default quantisation).
 *
 * Two caveats on the normal-map exemption, because it is narrower than it
 * sounds. A texture bound to the normal slot **and** some other slot matches
 * the first pass's filter and is converted to WebP like any colour map; and a
 * JPEG normal map is re-encoded by the second pass even when it is already
 * under the size cap, because that pass always supplies `resize`. PNG normal
 * maps — the common case — are safe, since sharp's PNG encoder is lossless.
 * Recorded in `BACKLOG.md`; fixing it means changing the slot filters.
 *
 * No `join` / `palette` / `dequantize` / `simplify`: those change structure or
 * geometry. Animations, skins, morph targets (Draco falls back to sequential
 * encoding for them), `KHR_materials_*`, `KHR_texture_transform`,
 * `EXT_mesh_gpu_instancing` travel through untouched. Files using an
 * extension this io does not know are refused (`skipped`) rather than
 * silently stripped.
 *
 * Node only (sharp + draco3dgltf). Callers add the never-bigger / timeout /
 * never-fail rules on top — see `@oncyberio/space-kit/optimize`.
 */
import { NodeIO, Logger, Verbosity, type Document } from "@gltf-transform/core";
import {
  declaredExtensions,
  externalRefs,
  gltfJsonOf as containerGltfJsonOf,
  isGlb,
} from "./gltf-container";
import { KHRONOS_EXTENSIONS, EXTTextureWebP, EXTMeshGPUInstancing, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, weld, draco, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";

export interface OptimizeModelOptions {
  /** Draco-compress triangle meshes (default true) */
  draco?: boolean;
  /** `"webp"` (default) re-encodes colour / emissive / ORM textures as WebP; `"keep"` leaves formats alone (they are still resized) */
  textures?: "webp" | "keep";
  /** longest texture side after import, px (default 2048; never enlarges) */
  maxTextureSize?: number;
  /** WebP quality for colour textures (default 90) */
  quality?: number;
}

export interface ModelInfo {
  meshes: number;
  primitives: number;
  /** sum of POSITION counts over all primitives */
  vertices: number;
  textures: Array<{ mimeType: string; bytes: number; slots: string[] }>;
  animations: number;
  skins: number;
  morphTargets: number;
  extensionsUsed: string[];
  extensionsRequired: string[];
}

/** Stable machine id for one step of the pipeline. */
export type TransformId = "dedup" | "prune" | "weld" | "textures" | "draco";

/** Why a transform that was attempted did not end up in the output. */
export type TransformSkipCode =
  | "disabled"
  | "nothing-to-do"
  | "no-textures"
  | "no-primitives";

/** One transform that was attempted but did not apply, with a machine reason. */
export interface SkippedTransform {
  id: TransformId;
  code: TransformSkipCode;
  /** Readable restatement of `code`; never parse this, read `code`. */
  reason: string;
}

/**
 * What the pipeline did, as stable ids rather than prose.
 *
 * `attempted` is what the options asked for, in pipeline order; `applied` is
 * what changed the document; `skipped` explains the difference. CI should read
 * these, never {@link OptimizeModelOutput.steps}.
 */
export interface TransformRecord {
  attempted: TransformId[];
  applied: TransformId[];
  skipped: SkippedTransform[];
}

export interface OptimizeModelOutput {
  buffer: Uint8Array;
  /** what was applied, in order (e.g. `["dedup", "weld 36→24 vertices", "3 textures → webp", "draco"]`) */
  steps: string[];
  /** the same thing as stable machine ids — prefer this in CI */
  transforms: TransformRecord;
  /** set (and `buffer` = input) when the file was left alone on purpose */
  skipped?: string;
}

const EXTENSIONS = [...KHRONOS_EXTENSIONS, EXTTextureWebP, EXTMeshGPUInstancing, EXTMeshoptCompression];
/** every extension the optimiser can read and write back; anything else makes it skip the file */
export const OPTIMIZE_SUPPORTED_EXTENSIONS: readonly string[] = EXTENSIONS.map((e) => e.EXTENSION_NAME);

let ioPromise: Promise<NodeIO> | null = null;
/** one io per process: the Draco encoder / decoder wasm modules take a moment to instantiate */
export function optimizerIO(): Promise<NodeIO> {
  ioPromise ??= (async () => {
    const [decoder, encoder] = await Promise.all([draco3d.createDecoderModule(), draco3d.createEncoderModule()]);
    await MeshoptDecoder.ready;
    return new NodeIO()
      .setLogger(new Logger(Verbosity.SILENT))
      .registerExtensions(EXTENSIONS)
      .registerDependencies({ "draco3d.decoder": decoder, "draco3d.encoder": encoder, "meshopt.decoder": MeshoptDecoder });
  })();
  return ioPromise;
}

/**
 * The glTF JSON of a GLB (its JSON chunk) or of a `.gltf` text buffer; null
 * when it is neither.
 *
 * Re-exported from `gltf-container`, which is the one GLB parser in the
 * package — this name is kept because it is part of `@oncyberio/tools/gltf`.
 */
export const gltfJsonOf = containerGltfJsonOf;

async function readAny(io: NodeIO, data: Uint8Array, json: any): Promise<Document> {
  if (isGlb(data)) return io.readBinary(data);
  // a .gltf must be self-contained (data: URIs) — a lone JSON file can't bring its .bin / textures along
  const external = externalRefs(json);
  if (external.length) throw new Error(`references external files (${external.map((r) => r.uri).join(", ")})`);
  return io.readJSON({ json, resources: {} });
}

const slotsOf = (doc: Document, t: any): string[] =>
  Array.from(
    new Set(
      doc
        .getGraph()
        .listParentEdges(t)
        .filter((e) => e.getParent().propertyType !== "Root")
        .map((e) => e.getName()),
    ),
  );

function infoOf(doc: Document, json: any): ModelInfo {
  const root = doc.getRoot();
  let primitives = 0;
  let vertices = 0;
  let morphTargets = 0;
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      primitives++;
      vertices += p.getAttribute("POSITION")?.getCount() ?? 0;
      morphTargets += p.listTargets().length;
    }
  }
  return {
    meshes: root.listMeshes().length,
    primitives,
    vertices,
    textures: root.listTextures().map((t) => ({ mimeType: t.getMimeType(), bytes: t.getImage()?.byteLength ?? 0, slots: slotsOf(doc, t) })),
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    morphTargets,
    extensionsUsed: Array.isArray(json?.extensionsUsed) ? [...json.extensionsUsed] : [],
    extensionsRequired: Array.isArray(json?.extensionsRequired) ? [...json.extensionsRequired] : [],
  };
}

/** Read a GLB / self-contained .gltf (Draco and meshopt decoded) and describe it — for tests, the CLI and logs. */
export async function inspectModel(data: Uint8Array): Promise<ModelInfo> {
  const json = gltfJsonOf(data);
  if (!json) throw new Error("not a glTF / GLB file");
  const io = await optimizerIO();
  return infoOf(await readAny(io, data, json), json);
}

/**
 * Optimise one model. Throws on unreadable input (the caller decides what to
 * do — space-kit keeps the original); returns `skipped` for files it should
 * not touch (already compressed, unknown extensions). Does NOT compare sizes:
 * the caller applies the never-bigger rule.
 */
export async function optimizeModelBuffer(data: Uint8Array, opts: OptimizeModelOptions = {}): Promise<OptimizeModelOutput> {
  const json = gltfJsonOf(data);
  if (!json) throw new Error("not a glTF / GLB file");

  // What the options asked for, before anything has run. A transform that ends
  // up doing nothing moves from here into `skipped` with a reason.
  // Texture handling is always attempted: `"keep"` still resizes, so there is
  // no option value that opts out of the step entirely.
  const attempted: TransformId[] = ["dedup", "prune", "weld", "textures"];
  if (opts.draco !== false) attempted.push("draco");
  const applied: TransformId[] = [];
  const skippedTransforms: SkippedTransform[] = [];
  const noop = (id: TransformId, code: TransformSkipCode, reason: string) =>
    skippedTransforms.push({ id, code, reason });

  // Nothing is attempted when the whole file is refused, and `skipped` is
  // documented as explaining the gap between attempted and applied — so
  // claiming five attempts and explaining none would be a lie a CI job reads.
  const bail = (skipped: string): OptimizeModelOutput => ({
    buffer: data,
    steps: [],
    transforms: { attempted: [], applied: [], skipped: [] },
    skipped,
  });

  // Every extension the file actually uses, not just the ones it remembered
  // to declare. `extensionsUsed` alone is what a reader dispatches on, so an
  // extension present in the `extensions` blocks but missing from the list was
  // silently *deleted* on write — and the result being smaller meant the
  // never-bigger rule waved it through. That turned a VRM into a 7x "saving"
  // with its rig, blend shapes and licence gone.
  const used = declaredExtensions(json);
  if (used.includes("KHR_draco_mesh_compression") || used.includes("EXT_meshopt_compression")) return bail("already compressed");
  const unknown = used.filter((e) => !OPTIMIZE_SUPPORTED_EXTENSIONS.includes(e));
  if (unknown.length) return bail(`unsupported extension ${unknown.join(", ")}`);

  const io = await optimizerIO();
  const doc = await readAny(io, data, json);
  doc.setLogger(new Logger(Verbosity.SILENT));
  const steps: string[] = [];
  const before = infoOf(doc, json);

  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true }));
  steps.push("dedup", "prune");
  applied.push("dedup", "prune");

  // exact welding only (tolerance 0): identical position + attributes → one vertex; nothing moves
  await doc.transform(weld({ tolerance: 0, toleranceNormal: 0 }));
  const afterWeld = infoOf(doc, json).vertices;
  if (afterWeld < before.vertices) {
    steps.push(`weld ${before.vertices}→${afterWeld} vertices`);
    applied.push("weld");
  } else {
    noop("weld", "nothing-to-do", "no duplicate vertices to merge");
  }

  const maxTextureSize = Math.max(64, Math.round(opts.maxTextureSize ?? 2048));
  const textures = doc.getRoot().listTextures();
  if (textures.length) {
    const resize: [number, number] = [maxTextureSize, maxTextureSize];
    if ((opts.textures ?? "webp") === "webp") {
      // colour-like slots → lossy WebP; normal maps keep their format (lossy re-encoding shows as shading noise) and are only capped in size
      await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize, quality: opts.quality ?? 90, slots: /^(?!normalTexture).*$/ }));
      await doc.transform(textureCompress({ encoder: sharp, resize, slots: /^normalTexture$/ }));
    } else {
      await doc.transform(textureCompress({ encoder: sharp, resize }));
    }
    const webp = doc
      .getRoot()
      .listTextures()
      .filter((t) => t.getMimeType() === "image/webp").length;
    const resized = textures.length;
    steps.push(webp ? `${webp}/${resized} texture${resized === 1 ? "" : "s"} → webp (≤ ${maxTextureSize} px)` : `textures ≤ ${maxTextureSize} px`);
    applied.push("textures");
  } else {
    noop("textures", "no-textures", "the model has no textures");
  }

  if (opts.draco === false) {
    noop("draco", "disabled", "draco: false");
  } else if (before.primitives === 0) {
    noop("draco", "no-primitives", "the model has no mesh primitives to compress");
  } else {
    await doc.transform(draco({ method: "edgebreaker" }));
    steps.push("draco");
    applied.push("draco");
  }

  const buffer = await io.writeBinary(doc);
  return { buffer, steps, transforms: { attempted, applied, skipped: skippedTransforms } };
}
