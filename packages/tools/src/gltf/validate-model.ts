/**
 * Structural and runtime validation plus statistics for a glTF / GLB file.
 *
 * ## What this is, precisely
 *
 * **Structural validation**, not full Khronos conformance. There is no
 * dependency on the Khronos `gltf-validator` in this repo, and adding one was
 * out of scope, so this deliberately does not claim what it does not do. What
 * it actually checks:
 *
 * 1. the **container** — GLB magic, container version, the header's declared
 *    total length, and every chunk's declared length (so a truncated file is
 *    caught rather than quietly reported on), or a parseable `.gltf` document;
 * 2. the **required shape** — `asset`, `asset.version`, and the spec rule that
 *    every `extensionsRequired` entry must also appear in `extensionsUsed`;
 * 3. **reference integrity** for the indices that actually break loaders —
 *    `scene`, scene→node, node→mesh/skin/camera/children,
 *    primitive→material/indices/attribute→accessor, accessor→bufferView,
 *    bufferView→buffer, texture→image/sampler **and texture→extension→image**,
 *    every `material.*Texture.index`, skin→accessor/node, and animation
 *    sampler→accessor plus channel→sampler/node;
 * 4. whether `@gltf-transform` can **read it into a document** at all, which is
 *    the same parse AWE's own optimiser performs.
 *
 * What it does **not** check: accessor component types against attribute
 * semantics, min/max correctness, image dimensions against sampler wrap modes,
 * animation interpolation constraints, UTF-8 validity of names, and the rest of
 * the several hundred rules in the Khronos validator. A file this reports as
 * valid can still fail Khronos conformance. If that matters to a consumer, run
 * the real validator as well — see `BACKLOG.md`.
 *
 * ## Facts, not policy
 *
 * AWE reports what is in the file. It sets **no budgets and no thresholds** —
 * no "texture too large", no "triangle count too high", no licensing checks.
 * Those are decisions a consuming project makes with its own numbers; this
 * hands them the numbers.
 *
 * The one place AWE does have an opinion is its own runtime: warnings say what
 * *this engine* will do with an extension, with the evidence for each claim in
 * {@link AWE_RUNTIME_EXTENSIONS}.
 *
 * ## External resources are reported, never fetched
 *
 * A standalone `.gltf` may point at a `.bin` and a folder of images, and the
 * URI can be `http://169.254.169.254/…` just as easily as `./scene.bin`.
 * Nothing here resolves, opens or requests an external URI: they are listed as
 * facts and the statistics that need them are reported as unavailable. There is
 * no SSRF surface because there is no fetch.
 *
 * Node only (the document pass needs sharp + draco3dgltf through the shared io).
 *
 * @module gltf/validate-model
 */
import type { Document } from "@gltf-transform/core";

import {
  boundsFromJson,
  extensionsOf,
  gltfTextJson,
  isGlb,
  readGlb,
  readGlbChunks,
  resourceRefs,
  sortKeys,
  textureStats,
  type Bounds,
  type ResourceRef,
  type TextureStats,
} from "./gltf-container";
import {
  optimizerIO,
  OPTIMIZE_SUPPORTED_EXTENSIONS,
} from "./optimize-model";
import { VRM_EXTENSIONS } from "./safe-optimize";

/**
 * Report schema version. Bumped only for a breaking shape change; a new
 * optional field does not bump it.
 */
export const VALIDATE_REPORT_VERSION = 1;

/** How thoroughly the file was checked. Only one value exists today. */
export type ValidationLevel = "structural";

/** How a glTF extension fares in the AWE runtime. */
export type RuntimeSupport =
  /** Loaded, with the feature intact. */
  | "supported"
  /** Loaded, but this platform ignores the feature. */
  | "ignored"
  /** Loaded on some platforms only. */
  | "partial"
  /** Not loadable — the file will fail or lose data. */
  | "unsupported";

export interface RuntimeExtensionFact {
  support: RuntimeSupport;
  /** Why, in one line, with the code that decides it. */
  note: string;
}

/**
 * What AWE's own `GLTFLoader` does with each extension it knows about.
 *
 * Every entry here was read out of
 * `packages/engine/src/internal/resources/loaders/gltf-loader.js` (the plugin
 * registrations in the constructor) and
 * `packages/engine/src/internal/loader.js` / `loader-headless.ts` (which
 * decoders are actually wired). An extension that is not in this map is
 * unknown to AWE, which is a different statement from unsupported.
 */
export const AWE_RUNTIME_EXTENSIONS: Readonly<
  Record<string, RuntimeExtensionFact>
> = Object.freeze({
  KHR_draco_mesh_compression: {
    support: "supported",
    note: "a Draco decoder is wired on both the web and headless loaders",
  },
  EXT_texture_webp: {
    support: "supported",
    note: "GLTFTextureWebPExtension is registered",
  },
  EXT_texture_avif: {
    support: "supported",
    note: "GLTFTextureAVIFExtension is registered",
  },
  EXT_mesh_gpu_instancing: {
    support: "supported",
    note: "GLTFMeshGpuInstancing is registered",
  },
  KHR_texture_transform: { support: "supported", note: "handled in parse()" },
  KHR_mesh_quantization: { support: "supported", note: "handled in parse()" },
  KHR_materials_unlit: { support: "supported", note: "handled in parse()" },
  KHR_materials_clearcoat: { support: "supported", note: "plugin registered" },
  KHR_materials_sheen: { support: "supported", note: "plugin registered" },
  KHR_materials_transmission: { support: "supported", note: "plugin registered" },
  KHR_materials_volume: { support: "supported", note: "plugin registered" },
  KHR_materials_ior: { support: "supported", note: "plugin registered" },
  KHR_materials_emissive_strength: { support: "supported", note: "plugin registered" },
  KHR_materials_specular: { support: "supported", note: "plugin registered" },
  KHR_materials_iridescence: { support: "supported", note: "plugin registered" },
  KHR_materials_anisotropy: { support: "supported", note: "plugin registered" },
  KHR_binary_glTF: { support: "supported", note: "the GLB container itself" },

  EXT_meshopt_compression: {
    support: "unsupported",
    note: "the plugin is registered but nothing ever calls setMeshoptDecoder, so the loader throws when the extension is required and drops the data when it is not",
  },
  KHR_lights_punctual: {
    support: "ignored",
    note: "GLTFLightsExtension is commented out of the loader, so lights inside the file are silently dropped — author them as AWE `pointlight` / `spotlight` components instead",
  },
  KHR_texture_basisu: {
    support: "partial",
    note: "a KTX2 loader is wired on mobile only (`Loader.addKTX()` returns early on desktop), and never headless, so desktop falls back or fails",
  },

  VRM: {
    support: "partial",
    note: "the web loader registers VRMLoaderPlugin; the headless loader does not, so a VRM cannot be loaded outside a browser",
  },
  VRMC_vrm: {
    support: "partial",
    note: "the web loader registers VRMLoaderPlugin; the headless loader does not, so a VRM cannot be loaded outside a browser",
  },
  VRMC_springBone: { support: "partial", note: "VRM: web loader only" },
  VRMC_node_constraint: { support: "partial", note: "VRM: web loader only" },
  VRMC_materials_mtoon: {
    support: "ignored",
    note: "the web loader overrides mtoonMaterialPlugin.getMaterialType to return null (loader.js), which is three-vrm's 'not an MToon material' signal — so MToon materials fall back to standard ones on every platform, not just headless",
  },
});

/** Stable machine codes for structural problems. Treat these as an API. */
export type ValidationErrorCode =
  | "empty-file"
  | "not-a-gltf"
  | "glb-malformed"
  | "glb-truncated"
  | "json-parse-failed"
  | "missing-asset"
  | "unsupported-asset-version"
  | "required-extension-not-used"
  | "dangling-reference"
  | "document-read-failed";

/** Stable machine codes for things worth knowing but not fatal. */
export type ValidationWarningCode =
  | "external-resources"
  | "data-uri-resources"
  | "unknown-extension"
  | "not-round-trippable"
  | "runtime-unsupported"
  | "runtime-ignored"
  | "runtime-partial"
  | "runtime-unknown"
  | "required-extension"
  | "stats-unavailable"
  | "no-scene"
  | "no-geometry"
  | "no-bounds";

export interface ValidationIssue<
  Code extends string = ValidationErrorCode | ValidationWarningCode,
> {
  /** Stable machine code — branch on this. */
  code: Code;
  /** Readable restatement. Free to change wording; never parse it. */
  message: string;
  /** JSON pointer into the glTF, when one identifies the problem. */
  pointer?: string;
}

/** Counts, all of them straight facts about the file. */
export interface ModelStatCounts {
  scenes: number;
  nodes: number;
  meshes: number;
  /** Mesh primitives, i.e. draw calls before instancing. */
  primitives: number;
  /**
   * Triangles across every mesh, counted once per mesh.
   *
   * Only primitives in a triangle mode (TRIANGLES / STRIP / FAN) count. A point
   * cloud or a line set reports `0` here and its own count in
   * {@link ModelStatCounts.points} / {@link ModelStatCounts.lines}, rather than
   * reporting a million "triangles" — which is what summing glTF-Transform's
   * `glPrimitives` blindly used to do.
   *
   * `null` when the document could not be read.
   */
  triangles: number | null;
  /** Points, for primitives in POINTS mode. */
  points: number | null;
  /** Lines, for primitives in LINES / LINE_STRIP / LINE_LOOP mode. */
  lines: number | null;
  /**
   * Triangles multiplied by how many times each mesh is actually drawn: the
   * number of nodes referencing it, times each node's
   * `EXT_mesh_gpu_instancing` instance count. A mesh no node references
   * contributes nothing.
   *
   * This is the number to compare against a draw budget — and the one that used
   * to be off by the whole instance count for exactly the files where
   * instancing matters.
   */
  trianglesInstanced: number | null;
  /** Sum of POSITION counts. `null` when the document could not be read. */
  vertices: number | null;
  materials: number;
  textures: number;
  images: number;
  animations: number;
  skins: number;
  /** `null` when the document could not be read. */
  morphTargets: number | null;
  cameras: number;
  /** `KHR_lights_punctual` lights declared in the file (AWE ignores these). */
  lights: number;
}

/** How each buffer and image is carried, and which ones we cannot reach. */
export interface ResourceSummary {
  embedded: number;
  dataUris: number;
  /** Refs that need files we were not given. Never fetched — only listed. */
  external: ResourceRef[];
  /** True when the file needs nothing but its own bytes. */
  selfContained: boolean;
}

/** The deterministic, machine-readable result of validating one model. */
export interface ModelReport {
  /**
   * Which report this is.
   *
   * The validator's and the optimiser's reports both carry `reportVersion` and
   * `elapsedMs`, and several of their keys hold *different shapes*. A consumer
   * handed one as JSON needs to be able to tell them apart without guessing.
   */
  kind: "gltf-validate";
  /** Schema version — see {@link VALIDATE_REPORT_VERSION}. */
  reportVersion: number;
  /** What was checked. Not full Khronos conformance — see the module note. */
  level: ValidationLevel;
  /** True when no structural errors were found. Warnings do not affect it. */
  valid: boolean;
  errors: ValidationIssue<ValidationErrorCode>[];
  warnings: ValidationIssue<ValidationWarningCode>[];
  file: {
    bytes: number;
    container: "glb" | "gltf-json" | "unknown";
  };
  /** From the raw JSON header, so it is what the file says, not what a reader inferred. */
  asset: {
    version: string | null;
    generator: string | null;
    copyright: string | null;
  } | null;
  extensions: {
    used: string[];
    required: string[];
    /** Not in AWE's tools *or* runtime — we have nothing to say about these. */
    unknown: string[];
    /** Known, but the optimiser would refuse the file rather than strip them. */
    notRoundTrippable: string[];
    /** Per-extension runtime verdicts, key-sorted. */
    runtime: Record<string, RuntimeExtensionFact>;
  };
  resources: ResourceSummary;
  counts: ModelStatCounts;
  /** World-space bounding box in the file's own units, or `null`. */
  bounds: Bounds | null;
  textures: TextureStats;
  /**
   * Where the numbers came from: a decoded `document`, the JSON `header` alone
   * (external resources, or an extension our io cannot read), or `none`.
   */
  statsSource: "document" | "header" | "none";
  /**
   * Wall-clock milliseconds. **The one nondeterministic field** — everything
   * else is byte-stable for the same input, so CI should compare with this
   * omitted (see {@link stableModelReport}).
   */
  elapsedMs: number;
}

export interface ValidateModelOptions {
  /**
   * Skip the `@gltf-transform` document pass — much faster, and enough when
   * you only need the header facts, extensions, bounds and external resources.
   * Triangle, vertex and morph-target counts are then `null` and
   * `statsSource` is `"header"`.
   */
  headerOnly?: boolean;
}

const EMPTY_TEXTURE_STATS: TextureStats = {
  textures: 0,
  images: 0,
  bytes: 0,
  maxWidth: null,
  maxHeight: null,
  byMimeType: {},
  perImage: [],
};

const len = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/**
 * What to say about each way a GLB can fail to read.
 *
 * Truncation gets its own code because it is the failure people actually hit —
 * an upload that stopped, a CDN response cut short — and because the fix is
 * different from the fix for a malformed file: re-fetch it, do not re-export it.
 */
const GLB_PROBLEM_ERRORS: Record<
  import("./gltf-container").GlbProblem,
  [ValidationErrorCode, string]
> = {
  "not-glb": ["not-a-gltf", "the bytes do not start with the GLB magic"],
  "bad-version": [
    "glb-malformed",
    "the GLB header declares a container version other than 2",
  ],
  "length-mismatch": [
    "glb-truncated",
    "the GLB header declares a total length that does not match the file — it has been truncated, or something was appended to it",
  ],
  "chunk-overrun": [
    "glb-truncated",
    "a GLB chunk declares more bytes than the file contains — it has been truncated",
  ],
  "bad-json-chunk": [
    "glb-malformed",
    "the GLB JSON chunk is missing, is not first, or does not parse as a glTF object",
  ],
};

/**
 * A list, whatever the file actually put there.
 *
 * glTF fields that must be arrays are routinely not: a hand-edited document, a
 * broken exporter or a fuzzer will hand us a string, a number or null, and a
 * validator that throws on malformed input is not a validator.
 */
const arr = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/** Every reference check worth doing from the JSON alone. */
function referenceErrors(json: any): ValidationIssue<ValidationErrorCode>[] {
  const issues: ValidationIssue<ValidationErrorCode>[] = [];
  const size = {
    accessors: len(json.accessors),
    bufferViews: len(json.bufferViews),
    buffers: len(json.buffers),
    cameras: len(json.cameras),
    images: len(json.images),
    materials: len(json.materials),
    meshes: len(json.meshes),
    nodes: len(json.nodes),
    samplers: len(json.samplers),
    scenes: len(json.scenes),
    skins: len(json.skins),
    textures: len(json.textures),
  };

  const check = (
    value: unknown,
    kind: keyof typeof size,
    pointer: string,
  ): void => {
    if (value == null) return;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= size[kind]) {
      issues.push({
        code: "dangling-reference",
        message: `${pointer} points at ${kind}[${String(value)}], which does not exist (${size[kind]} ${kind})`,
        pointer,
      });
    }
  };

  // `scene` names the default scene and is routinely out of range in
  // hand-edited files; a loader then shows nothing at all.
  if (json.scene != null) check(json.scene, "scenes", "/scene");

  arr(json.scenes).forEach((scene: any, i: number) =>
    arr(scene?.nodes).forEach((n: unknown, j: number) =>
      check(n, "nodes", `/scenes/${i}/nodes/${j}`),
    ),
  );

  arr(json.nodes).forEach((node: any, i: number) => {
    check(node?.mesh, "meshes", `/nodes/${i}/mesh`);
    check(node?.skin, "skins", `/nodes/${i}/skin`);
    check(node?.camera, "cameras", `/nodes/${i}/camera`);
    arr(node?.children).forEach((c: unknown, j: number) =>
      check(c, "nodes", `/nodes/${i}/children/${j}`),
    );
  });

  arr(json.meshes).forEach((mesh: any, i: number) =>
    arr(mesh?.primitives).forEach((primitive: any, j: number) => {
      check(primitive?.material, "materials", `/meshes/${i}/primitives/${j}/material`);
      check(primitive?.indices, "accessors", `/meshes/${i}/primitives/${j}/indices`);
      for (const [name, index] of Object.entries(primitive?.attributes ?? {})) {
        check(index, "accessors", `/meshes/${i}/primitives/${j}/attributes/${name}`);
      }
    }),
  );

  arr(json.accessors).forEach((accessor: any, i: number) =>
    check(accessor?.bufferView, "bufferViews", `/accessors/${i}/bufferView`),
  );

  arr(json.bufferViews).forEach((view: any, i: number) =>
    check(view?.buffer, "buffers", `/bufferViews/${i}/buffer`),
  );

  arr(json.textures).forEach((texture: any, i: number) => {
    check(texture?.source, "images", `/textures/${i}/source`);
    check(texture?.sampler, "samplers", `/textures/${i}/sampler`);
    // A texture may carry its image through an extension instead of a
    // top-level `source` — which is exactly the shape AWE's own optimiser
    // writes, so without this the validator had nothing to say about the
    // output of its own pipeline.
    for (const [name, ext] of Object.entries(texture?.extensions ?? {})) {
      const source = (ext as { source?: unknown })?.source;
      if (source !== undefined) {
        check(source, "images", `/textures/${i}/extensions/${name}/source`);
      }
    }
  });

  arr(json.images).forEach((image: any, i: number) =>
    check(image?.bufferView, "bufferViews", `/images/${i}/bufferView`),
  );

  arr(json.skins).forEach((skin: any, i: number) => {
    check(skin?.inverseBindMatrices, "accessors", `/skins/${i}/inverseBindMatrices`);
    check(skin?.skeleton, "nodes", `/skins/${i}/skeleton`);
    arr(skin?.joints).forEach((j: unknown, k: number) =>
      check(j, "nodes", `/skins/${i}/joints/${k}`),
    );
  });

  arr(json.animations).forEach((animation: any, i: number) => {
    const samplers = arr(animation?.samplers).length;
    samplers &&
      arr(animation?.samplers).forEach((sampler: any, j: number) => {
        check(sampler?.input, "accessors", `/animations/${i}/samplers/${j}/input`);
        check(sampler?.output, "accessors", `/animations/${i}/samplers/${j}/output`);
      });
    arr(animation?.channels).forEach((channel: any, j: number) => {
      check(channel?.target?.node, "nodes", `/animations/${i}/channels/${j}/target/node`);
      // A channel pointing at a sampler that does not exist is a dead
      // animation; loaders differ on whether they throw or ignore it.
      const sampler = channel?.sampler;
      if (sampler == null) return;
      if (
        typeof sampler !== "number" ||
        !Number.isInteger(sampler) ||
        sampler < 0 ||
        sampler >= samplers
      ) {
        issues.push({
          code: "dangling-reference",
          message: `/animations/${i}/channels/${j}/sampler points at samplers[${String(sampler)}], which does not exist (${samplers} samplers)`,
          pointer: `/animations/${i}/channels/${j}/sampler`,
        });
      }
    });
  });

  // Material texture slots. These are the references authors break most often
  // — a deleted texture leaves a stale index behind — and they were unchecked.
  const TEXTURE_SLOTS = [
    "normalTexture",
    "occlusionTexture",
    "emissiveTexture",
  ] as const;
  arr(json.materials).forEach((material: any, i: number) => {
    for (const slot of TEXTURE_SLOTS) {
      check(material?.[slot]?.index, "textures", `/materials/${i}/${slot}/index`);
    }
    const pbr = material?.pbrMetallicRoughness;
    check(
      pbr?.baseColorTexture?.index,
      "textures",
      `/materials/${i}/pbrMetallicRoughness/baseColorTexture/index`,
    );
    check(
      pbr?.metallicRoughnessTexture?.index,
      "textures",
      `/materials/${i}/pbrMetallicRoughness/metallicRoughnessTexture/index`,
    );
  });

  return issues;
}

/** Counts that can be taken from the JSON header without decoding anything. */
function headerCounts(json: any): ModelStatCounts {
  let primitives = 0;
  for (const mesh of arr(json.meshes)) primitives += len(mesh?.primitives);

  return {
    scenes: len(json.scenes),
    nodes: len(json.nodes),
    meshes: len(json.meshes),
    primitives,
    triangles: null,
    points: null,
    lines: null,
    trianglesInstanced: null,
    vertices: null,
    materials: len(json.materials),
    textures: len(json.textures),
    images: len(json.images),
    animations: len(json.animations),
    skins: len(json.skins),
    morphTargets: null,
    cameras: len(json.cameras),
    lights: len(json.extensions?.KHR_lights_punctual?.lights),
  };
}

/** Counts that need a decoded document (Draco unpacked, indices resolved). */
/** glTF primitive modes. */
const MODE = {
  POINTS: 0,
  LINES: 1,
  LINE_LOOP: 2,
  LINE_STRIP: 3,
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6,
} as const;

/**
 * How many GL primitives one glTF primitive draws, for its own mode.
 *
 * glTF-Transform's `inspect()` reports this as `glPrimitives` without saying
 * which kind, which is how a point cloud ends up in a field called
 * `triangles`. Counting it here keeps each kind in its own field, and floors
 * the result so a malformed vertex count cannot produce a fractional "1.333
 * triangles" for a consumer to compare against a budget.
 */
function primitiveCounts(primitive: {
  getMode(): number;
  getIndices(): { getCount(): number } | null;
  getAttribute(name: string): { getCount(): number } | null;
}): { triangles: number; lines: number; points: number } {
  const mode = primitive.getMode();
  const count =
    primitive.getIndices()?.getCount() ??
    primitive.getAttribute("POSITION")?.getCount() ??
    0;
  const zero = { triangles: 0, lines: 0, points: 0 };

  switch (mode) {
    case MODE.POINTS:
      return { ...zero, points: count };
    case MODE.LINES:
      return { ...zero, lines: Math.floor(count / 2) };
    case MODE.LINE_LOOP:
      return { ...zero, lines: count };
    case MODE.LINE_STRIP:
      return { ...zero, lines: Math.max(0, count - 1) };
    case MODE.TRIANGLES:
      return { ...zero, triangles: Math.floor(count / 3) };
    case MODE.TRIANGLE_STRIP:
    case MODE.TRIANGLE_FAN:
      return { ...zero, triangles: Math.max(0, count - 2) };
    default:
      // An invalid mode draws nothing we can name.
      return zero;
  }
}

/**
 * How many times a mesh is actually drawn.
 *
 * The node count, with each node's `EXT_mesh_gpu_instancing` instance count
 * applied. glTF-Transform's `InspectMeshReport.instances` is only the node
 * count, so a mesh drawn 10,000 times through one GPU-instanced node counted
 * as one — the single case where instancing matters at all.
 */
function drawCount(mesh: any): number {
  let total = 0;
  for (const parent of mesh.listParents()) {
    if (parent.propertyType !== "Node") continue;
    const instancing = parent.getExtension?.("EXT_mesh_gpu_instancing");
    const attribute = instancing?.listSemantics?.().length
      ? instancing.getAttribute(instancing.listSemantics()[0])
      : null;
    total += attribute?.getCount?.() ?? 1;
  }
  return total;
}

function documentCounts(
  doc: Document,
  header: ModelStatCounts,
): ModelStatCounts {
  let triangles = 0;
  let points = 0;
  let lines = 0;
  let trianglesInstanced = 0;
  let vertices = 0;
  let morphTargets = 0;
  let primitives = 0;

  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) {
    const draws = drawCount(mesh);
    for (const primitive of mesh.listPrimitives()) {
      primitives++;
      morphTargets += primitive.listTargets().length;
      vertices += primitive.getAttribute("POSITION")?.getCount() ?? 0;
      const counted = primitiveCounts(primitive as never);
      triangles += counted.triangles;
      points += counted.points;
      lines += counted.lines;
      trianglesInstanced += counted.triangles * draws;
    }
  }

  return {
    ...header,
    scenes: root.listScenes().length,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    primitives,
    triangles,
    points,
    lines,
    trianglesInstanced,
    vertices,
    materials: root.listMaterials().length,
    // `textures` deliberately keeps its header value: glTF-Transform's
    // `Texture` is a glTF *image* (sampler state lives on `TextureInfo`), so
    // `listTextures().length` is an image count and would contradict
    // `report.textures.textures` in the same report.
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    morphTargets,
    cameras: root.listCameras().length,
  };
}

/**
 * Validate and describe one glTF / GLB file.
 *
 * Always resolves — a file this cannot read comes back with `valid: false` and
 * an error code, never as a rejection.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { validateModel } from "@oncyberio/tools/gltf";
 *
 * const report = await validateModel(await readFile("scene.glb"));
 * if (!report.valid) {
 *   for (const e of report.errors) console.error(`${e.code}: ${e.message}`);
 * }
 * // Facts, not policy: the caller decides what "too big" means.
 * if ((report.counts.trianglesInstanced ?? 0) > MY_BUDGET) { … }
 * ```
 */
export async function validateModel(
  data: Uint8Array,
  options: ValidateModelOptions = {},
): Promise<ModelReport> {
  const startedAt = Date.now();
  const errors: ValidationIssue<ValidationErrorCode>[] = [];
  const warnings: ValidationIssue<ValidationWarningCode>[] = [];

  const finish = (
    report: Omit<
      ModelReport,
      | "kind"
      | "reportVersion"
      | "level"
      | "valid"
      | "errors"
      | "warnings"
      | "elapsedMs"
    >,
  ): ModelReport => ({
    kind: "gltf-validate",
    reportVersion: VALIDATE_REPORT_VERSION,
    level: "structural",
    valid: errors.length === 0,
    errors,
    warnings,
    ...report,
    elapsedMs: Date.now() - startedAt,
  });

  const bytes = data.byteLength;
  const container: ModelReport["file"]["container"] = isGlb(data)
    ? "glb"
    : "gltf-json";

  const unreadable = (
    code: ValidationErrorCode,
    message: string,
  ): ModelReport => {
    errors.push({ code, message });
    return finish({
      file: { bytes, container: "unknown" },
      asset: null,
      extensions: {
        used: [],
        required: [],
        unknown: [],
        notRoundTrippable: [],
        runtime: {},
      },
      resources: { embedded: 0, dataUris: 0, external: [], selfContained: true },
      counts: headerCounts({}),
      bounds: null,
      textures: { ...EMPTY_TEXTURE_STATS },
      statsSource: "none",
    });
  };

  if (bytes === 0) return unreadable("empty-file", "the file is empty");

  // A GLB is read through `readGlb` so the report can say *what* is wrong with
  // it, and a `.gltf` through `gltfTextJson`, which does not require `asset` —
  // "this model is missing its asset block" is a far more useful thing to tell
  // an author than "these bytes are not glTF".
  let json: any;
  if (container === "glb") {
    const glb = readGlb(data);
    if (glb.problem) {
      const [code, message] = GLB_PROBLEM_ERRORS[glb.problem];
      return unreadable(code, message);
    }
    json = glb.chunks!.json;
  } else {
    json = gltfTextJson(data);
    if (!json) {
      return unreadable(
        "not-a-gltf",
        "the bytes are neither a GLB nor a JSON document",
      );
    }
  }

  // ── the required shape ──────────────────────────────────────────────────
  const asset = json.asset;
  if (!asset || typeof asset !== "object") {
    errors.push({
      code: "missing-asset",
      message: "every glTF must have an `asset` object",
      pointer: "/asset",
    });
  } else if (typeof asset.version !== "string") {
    errors.push({
      code: "missing-asset",
      message: "`asset.version` is required",
      pointer: "/asset/version",
    });
  } else if (!/^2\./.test(asset.version)) {
    errors.push({
      code: "unsupported-asset-version",
      message: `glTF ${asset.version} is not glTF 2.0; AWE reads 2.x only`,
      pointer: "/asset/version",
    });
  } else if (asset.version !== "2.0") {
    // A 2.x minor is legal glTF, but glTF-Transform's reader insists on exactly
    // "2.0" — so the document pass will fail. Saying so here keeps that from
    // surfacing as `document-read-failed`, which would blame the file for a
    // limitation of our tools.
    warnings.push({
      code: "stats-unavailable",
      message: `glTF ${asset.version} is a legal 2.x minor, but the reader these tools use accepts only "2.0", so the decoded statistics may be unavailable`,
      pointer: "/asset/version",
    });
  }

  const extensions = extensionsOf(json);
  for (const required of extensions.required) {
    if (!extensions.used.includes(required)) {
      errors.push({
        code: "required-extension-not-used",
        message: `\`${required}\` is in extensionsRequired but not in extensionsUsed, which the spec forbids`,
        pointer: "/extensionsRequired",
      });
    }
  }

  errors.push(...referenceErrors(json));

  // ── extensions, and what they mean here ─────────────────────────────────
  const knownToTools = new Set(OPTIMIZE_SUPPORTED_EXTENSIONS);
  const runtime: Record<string, RuntimeExtensionFact> = {};
  const unknown: string[] = [];
  const notRoundTrippable: string[] = [];

  for (const name of extensions.used) {
    const fact = AWE_RUNTIME_EXTENSIONS[name];
    if (fact) runtime[name] = fact;
    if (!knownToTools.has(name)) notRoundTrippable.push(name);
    if (!fact && !knownToTools.has(name)) unknown.push(name);
  }

  if (unknown.length) {
    warnings.push({
      code: "unknown-extension",
      message: `AWE knows nothing about ${unknown.join(", ")} — neither its tools nor its runtime mention ${unknown.length === 1 ? "it" : "them"}`,
      pointer: "/extensionsUsed",
    });
  }

  // An extension the *tools* round-trip happily but the *runtime* has never
  // heard of used to fall through every list and warn about nothing. That is
  // how a file using KHR_materials_pbrSpecularGlossiness — which three.js
  // r170 dropped — validated clean, optimised clean, and rendered wrong.
  const unknownToRuntime = extensions.used.filter(
    (e) => !AWE_RUNTIME_EXTENSIONS[e] && !unknown.includes(e),
  );
  if (unknownToRuntime.length) {
    warnings.push({
      code: "runtime-unknown",
      message: `${unknownToRuntime.join(", ")} round-trips through AWE's tools, but AWE's loader has no handler for ${unknownToRuntime.length === 1 ? "it" : "them"} — the feature will be missing at runtime`,
      pointer: "/extensionsUsed",
    });
  }

  // A required extension is a portability cliff: per the spec, a client that
  // does not implement it must refuse the file outright, and there is no
  // fallback to drop back to. AWE's own optimiser writes EXT_texture_webp as
  // required, so its output is not portable to a viewer without WebP support —
  // worth saying plainly rather than leaving a consumer to find out.
  if (extensions.required.length) {
    warnings.push({
      code: "required-extension",
      message: `${extensions.required.join(", ")} ${extensions.required.length === 1 ? "is" : "are"} listed in extensionsRequired: any client that does not implement ${extensions.required.length === 1 ? "it" : "them"} must refuse this file, and there is no fallback in it`,
      pointer: "/extensionsRequired",
    });
  }
  if (notRoundTrippable.length) {
    const vrm = notRoundTrippable.filter((e) => VRM_EXTENSIONS.includes(e));
    warnings.push({
      code: "not-round-trippable",
      message:
        vrm.length === notRoundTrippable.length
          ? `a VRM avatar (${vrm.join(", ")}): the optimiser will skip it rather than strip its extensions`
          : `the optimiser cannot round-trip ${notRoundTrippable.join(", ")} and will skip this file rather than strip ${notRoundTrippable.length === 1 ? "it" : "them"}`,
      pointer: "/extensionsUsed",
    });
  }

  for (const [name, fact] of Object.entries(runtime)) {
    if (fact.support === "supported") continue;
    warnings.push({
      code:
        fact.support === "unsupported"
          ? "runtime-unsupported"
          : fact.support === "ignored"
            ? "runtime-ignored"
            : "runtime-partial",
      message: `${name}: ${fact.note}`,
      pointer: "/extensionsUsed",
    });
  }

  // ── resources ───────────────────────────────────────────────────────────
  const refs = resourceRefs(json);
  const external = refs.filter((r) => r.carrier === "external");
  const dataUris = refs.filter((r) => r.carrier === "data-uri").length;
  const resources: ResourceSummary = {
    embedded: refs.filter((r) => r.carrier === "embedded").length,
    dataUris,
    external,
    selfContained: external.length === 0,
  };

  if (external.length) {
    warnings.push({
      code: "external-resources",
      message: `needs ${external.length} file${external.length === 1 ? "" : "s"} it does not carry (${external.map((r) => r.uri).join(", ")}); they are listed, never fetched`,
    });
  }
  if (dataUris) {
    warnings.push({
      code: "data-uri-resources",
      message: `${dataUris} resource${dataUris === 1 ? " is" : "s are"} carried as a data: URI, which is self-contained but about a third larger than a GLB buffer`,
    });
  }

  // ── statistics ──────────────────────────────────────────────────────────
  const bin = readGlbChunks(data)?.bin ?? new Uint8Array(0);
  const textures = await textureStats(json, bin).catch(() => ({
    ...EMPTY_TEXTURE_STATS,
  }));
  const bounds = boundsFromJson(json);
  if (!bounds) {
    warnings.push({
      code: "no-bounds",
      message:
        "no bounding box could be computed — the POSITION accessors carry no min/max, or the file has no placed geometry",
    });
  }

  let counts = headerCounts(json);
  let statsSource: ModelReport["statsSource"] = "header";

  if (!options.headerOnly) {
    if (external.length) {
      warnings.push({
        code: "stats-unavailable",
        message:
          "triangle, vertex and morph-target counts need the file's buffers, which live in files that were not provided",
      });
    } else {
      try {
        const io = await optimizerIO();
        const doc = isGlb(data)
          ? await io.readBinary(data)
          : await io.readJSON({ json, resources: {} });
        counts = documentCounts(doc, counts);
        statsSource = "document";
      } catch (error) {
        const message =
          error instanceof Error ? error.message.split("\n")[0] : String(error);
        if (notRoundTrippable.length || unknown.length) {
          // Our io does not register this extension, so failing to read is a
          // limitation of the tools, not a defect in the file.
          warnings.push({
            code: "stats-unavailable",
            message: `the document could not be decoded (${message}); the file uses ${[...new Set([...notRoundTrippable, ...unknown])].join(", ")}, which these tools do not read`,
          });
        } else {
          errors.push({
            code: "document-read-failed",
            message: `the file parses as JSON but cannot be read as a glTF document: ${message}`,
          });
        }
      }
    }
  }

  if (counts.scenes === 0) {
    warnings.push({ code: "no-scene", message: "the file declares no scenes" });
  }
  if (counts.meshes === 0) {
    warnings.push({ code: "no-geometry", message: "the file contains no meshes" });
  }

  return finish({
    file: { bytes, container },
    asset: {
      version: typeof asset?.version === "string" ? asset.version : null,
      generator: typeof asset?.generator === "string" ? asset.generator : null,
      copyright: typeof asset?.copyright === "string" ? asset.copyright : null,
    },
    extensions: {
      used: extensions.used,
      required: extensions.required,
      unknown: [...unknown].sort(),
      notRoundTrippable: [...notRoundTrippable].sort(),
      runtime: sortKeys(runtime),
    },
    resources,
    counts,
    bounds,
    textures,
    statsSource,
  });
}

/**
 * The report with its one nondeterministic field removed, for snapshot tests
 * and for CI jobs that compare two runs.
 */
export function stableModelReport(
  report: ModelReport,
): Omit<ModelReport, "elapsedMs"> {
  const { elapsedMs: _elapsedMs, ...rest } = report;
  return rest;
}

/** A short human summary — the CLI's default output. */
export function describeModelReport(report: ModelReport): string {
  const lines: string[] = [];
  const c = report.counts;
  const n = (value: number | null) => (value == null ? "?" : value.toLocaleString("en-US"));

  lines.push(
    `${report.valid ? "valid" : "INVALID"} ${report.file.container} · ${n(report.file.bytes)} bytes · glTF ${report.asset?.version ?? "?"}${report.asset?.generator ? ` · ${report.asset.generator}` : ""}`,
  );
  lines.push(
    `  ${n(c.scenes)} scene(s), ${n(c.nodes)} nodes, ${n(c.meshes)} meshes, ${n(c.primitives)} primitives, ${n(c.triangles)} triangles (${n(c.trianglesInstanced)} instanced), ${n(c.vertices)} vertices`,
  );
  lines.push(
    `  ${n(c.materials)} materials, ${n(c.textures)} textures / ${n(c.images)} images${report.textures.maxWidth ? ` up to ${report.textures.maxWidth}x${report.textures.maxHeight}` : ""}, ${n(c.animations)} animations, ${n(c.skins)} skins, ${n(c.morphTargets)} morph targets`,
  );
  if (report.bounds) {
    const [x, y, z] = report.bounds.size;
    lines.push(`  bounds ${x} x ${y} x ${z}`);
  }
  if (report.extensions.used.length) {
    lines.push(`  extensions: ${report.extensions.used.join(", ")}`);
  }
  if (!report.resources.selfContained) {
    lines.push(
      `  external: ${report.resources.external.map((r) => r.uri).join(", ")}`,
    );
  }
  lines.push(`  stats from: ${report.statsSource}`);
  for (const e of report.errors) lines.push(`  ERROR   [${e.code}] ${e.message}`);
  for (const w of report.warnings) lines.push(`  warning [${w.code}] ${w.message}`);
  return lines.join("\n");
}
