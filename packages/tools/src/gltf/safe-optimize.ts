/**
 * The safe model optimiser: the conservative transform pipeline in
 * `optimize-model.ts` wrapped in the rules an asset pipeline actually needs.
 *
 * ## The contract
 *
 * - **never fails** — every error becomes a skip with a code and a reason; this
 *   function has no rejection path;
 * - **never bigger** — if the optimised candidate is not *smaller* than the
 *   input, the input comes back untouched (`not-smaller`);
 * - **never lossy by surprise** — already-compressed files, VRM avatars and
 *   anything using an extension the pipeline cannot round-trip are left alone;
 * - **time-capped** — a file that takes too long is abandoned (`timeout`), and
 *   the input comes back;
 * - **reports facts** — a deterministic, versioned JSON report with stable
 *   machine codes, so CI reads codes and humans read messages.
 *
 * The bytes in {@link SafeOptimizeResult.buffer} are always safe to store: they
 * are either a genuinely smaller optimised file or the exact input.
 *
 * ## What this is not
 *
 * It does not emit **meshopt**-compressed geometry. The engine registers
 * `EXT_meshopt_compression` on its `GLTFLoader` but never calls
 * `setMeshoptDecoder`, so a meshopt-compressed GLB does not load in AWE at all
 * — writing one would produce a file the runtime refuses. Meshopt is decode-only
 * here, so meshopt *input* is read and then left alone.
 *
 * It does not produce **KTX2 / Basis**. `packages/tools/src/texture/toktx.ts`
 * exists but is commented out of the exports, and the runtime only wires a
 * KTX2 loader on mobile. Nothing in this module labels an output KTX2, and the
 * report never claims it.
 *
 * ## Timeout semantics, honestly
 *
 * The cap is a `Promise.race` against a timer. When it fires, the result of the
 * in-flight transform is **discarded, not cancelled** — sharp and the Draco
 * wasm encoder keep running to completion on their own, and the process pays
 * for that work. There is no `AbortSignal` through `@gltf-transform`, and no
 * worker to terminate. Treat the cap as "stop waiting", not "stop working". A
 * caller that genuinely needs to reclaim the CPU must run the optimiser in a
 * child process it can kill.
 *
 * Node only (sharp + draco3dgltf).
 *
 * @module gltf/safe-optimize
 */
import {
  declaredExtensions,
  describeSavings,
  OPTIMIZE_TIMEOUT_MS,
  emptyTextureStats,
  extensionsOf,
  formatBytes,
  gltfJsonOf,
  readGlbChunks,
  textureStats,
  type TextureStats,
} from "./gltf-container";

import {
  inspectModel,
  optimizeModelBuffer,
  OPTIMIZE_SUPPORTED_EXTENSIONS,
  type ModelInfo,
  type OptimizeModelOptions,
  type OptimizeModelOutput,
  type TransformRecord,
} from "./optimize-model";

// Re-exported so `@oncyberio/tools/gltf` remains one import for a caller that
// wants the optimiser and a size line; the implementations live in the
// dependency-free container layer.
export { describeSavings, formatBytes };

/**
 * Report schema version. Bumped only for a breaking shape change; a new
 * optional field does not bump it.
 */
export const OPTIMIZE_REPORT_VERSION = 1;

// The default per-file cap lives in the dependency-free container layer so
// space-kit can re-export it without the heavy imports; re-exported here so
// `@oncyberio/tools/gltf` stays one import for an optimiser caller.
export { OPTIMIZE_TIMEOUT_MS };

/**
 * Every extension that marks a file as a VRM avatar.
 *
 * VRM 0.x declares `VRM`; VRM 1.0 declares `VRMC_vrm` alongside
 * `VRMC_springBone` / `VRMC_node_constraint` / `VRMC_materials_mtoon`. None of
 * them is in {@link OPTIMIZE_SUPPORTED_EXTENSIONS}, so a VRM would be skipped
 * anyway — it is named here so the report says *why* rather than lumping an
 * avatar in with an unrecognised vendor extension. The behaviour is the same;
 * only the code differs.
 *
 * Verified against `packages/tools/artifacts/pepe-vrm.glb`, which declares
 * `["VRM", "KHR_materials_unlit", "KHR_texture_transform"]`.
 */
export const VRM_EXTENSIONS: readonly string[] = [
  "VRM",
  "VRMC_vrm",
  "VRMC_vrm_animation",
  "VRMC_springBone",
  "VRMC_springBone_extended_collider",
  "VRMC_node_constraint",
  "VRMC_materials_mtoon",
  "VRMC_materials_hdr_emissiveMultiplier",
  // The draft spelling three-vrm still accepts.
  "VRMC_hdr_emissiveMultiplier",
];

/**
 * Why the input came back unchanged. Stable — treat these as an API.
 *
 * - `not-a-gltf` — the bytes are not a GLB or a glTF JSON document
 * - `already-compressed` — the file already uses Draco or meshopt
 * - `vrm` — a VRM avatar; optimising one would strip its extensions
 * - `unsupported-extension` — an extension the pipeline cannot round-trip
 * - `external-resources` — a `.gltf` that points at files we were not given
 * - `not-smaller` — the candidate was not smaller than the input
 * - `timeout` — the cap fired (see the module note on what that does and does not do)
 * - `failed` — anything else went wrong; `skipReason` carries the message
 */
export type OptimizeSkipCode =
  | "not-a-gltf"
  | "already-compressed"
  | "vrm"
  | "unsupported-extension"
  | "external-resources"
  | "not-smaller"
  | "timeout"
  | "failed";

/** Counts taken from a decoded document, or `null` when it could not be read. */
export interface ModelCounts {
  meshes: number;
  primitives: number;
  vertices: number;
  animations: number;
  skins: number;
  morphTargets: number;
}

/** The deterministic, machine-readable result of one optimisation. */
export interface OptimizeModelReport {
  /**
   * Which report this is.
   *
   * The optimiser's and the validator's reports both carry `reportVersion` and
   * `elapsedMs`, and several of their keys (`textures`, `counts`,
   * `extensions`) hold *different shapes*. A consumer handed one as JSON needs
   * to be able to tell them apart without guessing.
   */
  kind: "gltf-optimize";
  /** Schema version — see {@link OPTIMIZE_REPORT_VERSION}. */
  reportVersion: number;
  /** True when an optimised, smaller file was produced. */
  optimized: boolean;
  /** True when the returned bytes differ from the input. Always `optimized`. */
  changed: boolean;
  /** `null` when optimised; otherwise why the input came back. */
  skipCode: OptimizeSkipCode | null;
  /** Human restatement of `skipCode`. Read the code, show the reason. */
  skipReason: string | null;
  bytes: {
    input: number;
    /** What was returned: the optimised file, or the input when skipped. */
    output: number;
    /**
     * What the pipeline produced before the never-bigger rule was applied.
     * `null` when the pipeline never ran (a file it refused, or a timeout).
     * This is how you tell "it tried and the result was bigger" from "it never
     * tried".
     */
    candidate: number | null;
  };
  /** `(output - input) / input`, as a percentage, 2 dp. Negative is smaller. */
  percentChange: number;
  /** Which transforms were attempted, applied, and skipped (with codes). */
  transforms: TransformRecord;
  /**
   * The same story as prose, in pipeline order
   * (`["dedup", "prune", "weld 36→24 vertices", "1/1 texture → webp (≤ 256 px)", "draco"]`).
   *
   * For humans and for import notes. **Never parse these** — the wording is
   * free to change; read {@link OptimizeModelReport.transforms} instead.
   */
  steps: string[];
  extensions: {
    before: { used: string[]; required: string[] };
    /** `null` when nothing was produced. */
    after: { used: string[]; required: string[] } | null;
  };
  textures: {
    before: TextureStats;
    /** `null` when nothing was produced. */
    after: TextureStats | null;
  };
  counts: {
    before: ModelCounts | null;
    after: ModelCounts | null;
  };
  /**
   * Wall-clock milliseconds. **The one nondeterministic field** — everything
   * else in this report is byte-stable for the same input and options, so CI
   * should compare reports with this omitted.
   */
  elapsedMs: number;
}

export interface SafeOptimizeOptions extends OptimizeModelOptions {
  /** Per-file cap, ms (default {@link OPTIMIZE_TIMEOUT_MS}). */
  timeoutMs?: number;
  /**
   * Advanced / testing seam: run the transform through this instead of the
   * real pipeline.
   *
   * It exists so that timeout and failure paths can be tested in milliseconds
   * rather than by waiting 30 seconds or corrupting a fixture. Production
   * callers should leave it alone.
   */
  runTransform?: (
    data: Uint8Array,
    options: OptimizeModelOptions,
  ) => Promise<OptimizeModelOutput>;
}

export interface SafeOptimizeResult {
  /** Always safe to store: a smaller optimised file, or the exact input. */
  buffer: Uint8Array;
  report: OptimizeModelReport;
}

const EMPTY_TRANSFORMS: TransformRecord = {
  attempted: [],
  applied: [],
  skipped: [],
};

/** A refusal decided from the header alone. */
export interface OptimizePrecheck {
  code: OptimizeSkipCode;
  reason: string;
}

/**
 * Would the optimiser refuse this file, judging by its header alone?
 *
 * Split out so the decision is made **once** and can be made **cheaply**: it
 * needs nothing but the parsed glTF JSON, so a caller can refuse an
 * already-Draco re-import or a VRM without instantiating the Draco wasm
 * encoders or loading sharp. {@link optimizeModel} calls it before it decodes
 * anything, and `@oncyberio/space-kit` calls it to keep its own fast path
 * without owning a second copy of the policy.
 *
 * Returns `null` when there is no reason to refuse from the header.
 */
export function optimizePrecheck(json: any): OptimizePrecheck | null {
  // Every extension the file actually uses — see `declaredExtensions` for why
  // `extensionsUsed` alone is not enough.
  const used = declaredExtensions(json);

  if (
    used.includes("KHR_draco_mesh_compression") ||
    used.includes("EXT_meshopt_compression")
  ) {
    return { code: "already-compressed", reason: "already compressed" };
  }

  const unsupported = used.filter(
    (e) => !OPTIMIZE_SUPPORTED_EXTENSIONS.includes(e),
  );
  if (!unsupported.length) return null;

  // Same message either way — import notes have always said this, and only the
  // code got more precise — but a VRM deserves to be named as one.
  const reason = `unsupported extension ${unsupported.join(", ")}`;
  const isVrm = unsupported.some((e) => VRM_EXTENSIONS.includes(e));
  return { code: isVrm ? "vrm" : "unsupported-extension", reason };
}

const countsOf = (info: ModelInfo): ModelCounts => ({
  meshes: info.meshes,
  primitives: info.primitives,
  vertices: info.vertices,
  animations: info.animations,
  skins: info.skins,
  morphTargets: info.morphTargets,
});

const percent = (input: number, output: number): number =>
  input > 0 ? Math.round(((output - input) / input) * 10_000) / 100 : 0;

interface InputFacts {
  extensions: { used: string[]; required: string[] };
  textures: TextureStats;
  counts: ModelCounts | null;
}

/**
 * The facts a refusal can report without decoding anything.
 *
 * A refused file gets its extensions (which is what the refusal is about) and
 * honest nulls for everything that would have cost a document decode.
 */
function headerOnlyFacts(json: any): InputFacts {
  return {
    extensions: extensionsOf(json),
    textures: emptyTextureStats(),
    counts: null,
  };
}

/** Facts about the input that hold whether or not the pipeline ever runs. */
async function describeInput(data: Uint8Array, json: any): Promise<InputFacts> {
  const bin = readGlbChunks(data)?.bin ?? new Uint8Array(0);
  const textures = await textureStats(json, bin).catch(() => null);
  const counts = await inspectModel(data)
    .then(countsOf)
    .catch(() => null);
  return {
    extensions: extensionsOf(json),
    textures: textures ?? emptyTextureStats(),
    counts,
  };
}

/**
 * Optimise one model, safely.
 *
 * Always resolves. The returned `buffer` is the bytes to keep; `report` says
 * what happened and why, in codes a CI job can branch on.
 *
 * @example
 * ```ts
 * import { readFile, writeFile } from "node:fs/promises";
 * import { optimizeModel } from "@oncyberio/tools/gltf";
 *
 * const input = await readFile("duck.glb");
 * const { buffer, report } = await optimizeModel(input, { maxTextureSize: 1024 });
 * await writeFile("duck.opt.glb", buffer);
 *
 * if (report.skipCode) console.warn(`left alone: ${report.skipReason}`);
 * else console.log(`${report.percentChange}%`);
 * ```
 */
export async function optimizeModel(
  data: Uint8Array,
  options: SafeOptimizeOptions = {},
): Promise<SafeOptimizeResult> {
  const startedAt = Date.now();
  const input = data.byteLength;

  const finish = (
    report: Omit<OptimizeModelReport, "kind" | "reportVersion" | "elapsedMs">,
  ): OptimizeModelReport => ({
    kind: "gltf-optimize",
    reportVersion: OPTIMIZE_REPORT_VERSION,
    ...report,
    elapsedMs: Date.now() - startedAt,
  });

  const json = gltfJsonOf(data);
  if (!json) {
    return {
      buffer: data,
      report: finish({
        optimized: false,
        changed: false,
        skipCode: "not-a-gltf",
        // The wording matches what space-kit has always put in import notes.
        skipReason: "not a glTF / GLB file",
        bytes: { input, output: input, candidate: null },
        percentChange: 0,
        transforms: EMPTY_TRANSFORMS,
        steps: [],
        extensions: { before: { used: [], required: [] }, after: null },
        textures: { before: emptyTextureStats(), after: null },
        counts: { before: null, after: null },
      }),
    };
  }

  const keepInput = (
    skipCode: OptimizeSkipCode,
    skipReason: string,
    candidate: number | null = null,
    transforms: TransformRecord = EMPTY_TRANSFORMS,
    before: InputFacts = headerOnlyFacts(json),
  ): SafeOptimizeResult => ({
    buffer: data,
    report: finish({
      optimized: false,
      changed: false,
      skipCode,
      skipReason,
      bytes: { input, output: input, candidate },
      percentChange: 0,
      transforms,
      steps: [],
      extensions: { before: before.extensions, after: null },
      textures: { before: before.textures, after: null },
      counts: { before: before.counts, after: null },
    }),
  });

  // Refuse **before** describing the input. `describeInput` decodes the whole
  // document and measures every image, which instantiates the Draco wasm
  // encoder and loads sharp — so deciding the refusal afterwards meant an
  // already-Draco re-import or a VRM paid the entire cost of the work we were
  // about to decline, outside the timeout, on every import.
  const refusal = optimizePrecheck(json);
  if (refusal) return keepInput(refusal.code, refusal.reason);

  const run = options.runTransform ?? optimizeModelBuffer;
  const timeoutMs = options.timeoutMs ?? OPTIMIZE_TIMEOUT_MS;

  let timer: NodeJS.Timeout | undefined;
  const TIMED_OUT = Symbol("timeout");
  try {
    // The cap is started **before** any decoding, and covers everything the
    // caller waits for. Describing the input reads the whole document and runs
    // sharp over every image, so leaving that outside the race — which is where
    // it first sat — meant "time-capped" was not actually true of this call.
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      // Never hold the event loop open for a cap nobody is waiting on.
      timer.unref?.();
    });

    const work = (async () => {
      const before = await describeInput(data, json);
      const out = await run(data, {
        draco: options.draco,
        textures: options.textures,
        maxTextureSize: options.maxTextureSize,
        quality: options.quality,
      });
      return { before, out };
    })();
    // The race abandons the result; it cannot abort the work. Swallow the
    // rejection of the loser so an abandoned failure is not unhandled.
    work.catch(() => {});

    const raced = await Promise.race([work, timeout]);
    if (raced === TIMED_OUT) {
      // No `before` facts: producing them is part of what timed out, and
      // `keepInput` falls back to the header-only ones.
      return keepInput("timeout", "timeout");
    }
    const { before, out } = raced;

    if (out.skipped) {
      const code: OptimizeSkipCode = out.skipped.startsWith(
        "unsupported extension",
      )
        ? "unsupported-extension"
        : out.skipped === "already compressed"
          ? "already-compressed"
          : "failed";
      return keepInput(code, out.skipped, null, out.transforms, before);
    }

    const candidate = out.buffer.byteLength;
    // Never bigger. `>=` on purpose: a candidate that merely ties is churn,
    // and re-encoding textures for no gain is worse than doing nothing.
    if (candidate >= input) {
      return keepInput(
        "not-smaller",
        "not smaller",
        candidate,
        out.transforms,
        before,
      );
    }

    const outJson = gltfJsonOf(out.buffer);
    const outBin = readGlbChunks(out.buffer)?.bin ?? new Uint8Array(0);
    const after = {
      extensions: outJson ? extensionsOf(outJson) : null,
      textures: outJson ? await textureStats(outJson, outBin).catch(() => null) : null,
      counts: await inspectModel(out.buffer)
        .then(countsOf)
        .catch(() => null),
    };

    return {
      buffer: out.buffer,
      report: finish({
        optimized: true,
        changed: true,
        skipCode: null,
        skipReason: null,
        bytes: { input, output: candidate, candidate },
        percentChange: percent(input, candidate),
        transforms: out.transforms,
        steps: out.steps,
        extensions: { before: before.extensions, after: after.extensions },
        textures: { before: before.textures, after: after.textures },
        counts: { before: before.counts, after: after.counts },
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    const code: OptimizeSkipCode = message.startsWith("references external files")
      ? "external-resources"
      : "failed";
    // `before` is scoped to the successful path now; a failure here means the
    // decode itself threw, so the header-only facts are the honest ones.
    return keepInput(code, message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The report with its one nondeterministic field removed, for snapshot tests
 * and for CI jobs that compare two runs.
 */
export function stableReport(
  report: OptimizeModelReport,
): Omit<OptimizeModelReport, "elapsedMs"> {
  const { elapsedMs: _elapsedMs, ...rest } = report;
  return rest;
}

