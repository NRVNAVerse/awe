// ── legacy ────────────────────────────────────────────────────────────────
// `optimizeGLTF` is the OLD multi-variant path: one input → three outputs
// (`high` / `low` / `lowCompressed`), applying structure-changing transforms
// (`join`, `palette`, `dequantize`, meshopt `simplify`). It is still what the
// studio upload path and `cli.ts optimize-model` (without `--modern`) use, and
// its contract is unchanged. Note that `lowCompressed` produces **no KTX2** —
// the `toktx` call is commented out — so the name overpromises.
//
// New code should use `optimizeModel` below.
export { optimizeGLTF } from "./optimize-gltf";
export type { CompressionOptions, OptimizedVariant } from "./optimize-gltf";

// ── the transform pipeline ────────────────────────────────────────────────
// Conservative, single-variant, no safety policy: throws on unreadable input
// and does not compare sizes. Use it directly only when you are supplying your
// own policy; otherwise use `optimizeModel`.
export {
  optimizeModelBuffer,
  inspectModel,
  gltfJsonOf,
  optimizerIO,
  OPTIMIZE_SUPPORTED_EXTENSIONS,
} from "./optimize-model";
export type {
  OptimizeModelOptions,
  OptimizeModelOutput,
  ModelInfo,
  TransformId,
  TransformSkipCode,
  SkippedTransform,
  TransformRecord,
} from "./optimize-model";

// ── the safe optimiser (start here) ───────────────────────────────────────
// Never fails, never returns bigger bytes, time-capped, and reports a
// deterministic versioned JSON document with stable skip codes.
export {
  optimizeModel,
  optimizePrecheck,
  stableReport,
  describeSavings,
  formatBytes,
  OPTIMIZE_REPORT_VERSION,
  VRM_EXTENSIONS,
} from "./safe-optimize";
export type {
  SafeOptimizeOptions,
  SafeOptimizeResult,
  OptimizePrecheck,
  OptimizeModelReport,
  OptimizeSkipCode,
  ModelCounts,
} from "./safe-optimize";

// ── container / statistics primitives ─────────────────────────────────────
// The one GLB parser in the package. Cheap: bytes and the JSON header only.
export {
  GLB_MAGIC,
  isGlb,
  readGlb,
  readGlbChunks,
  gltfTextJson,
  emptyTextureStats,
  declaredExtensions,
  OPTIMIZE_TIMEOUT_MS,
  resourceRefs,
  externalRefs,
  imageBytes,
  textureStats,
  textureStatsOf,
  extensionsOf,
  sortKeys,
} from "./gltf-container";
export { boundsFromJson, boundsOf } from "./gltf-container";
export type {
  GlbChunks,
  GlbProblem,
  GlbReadResult,
  ResourceRef,
  ImageStat,
  TextureStats,
  Bounds,
} from "./gltf-container";

// ── validation + statistics ───────────────────────────────────────────────
// Structural and runtime validation, not full Khronos conformance — read the
// module note before quoting what it proves.
export {
  validateModel,
  stableModelReport,
  describeModelReport,
  AWE_RUNTIME_EXTENSIONS,
  VALIDATE_REPORT_VERSION,
} from "./validate-model";
export type {
  ModelReport,
  ModelStatCounts,
  ResourceSummary,
  RuntimeExtensionFact,
  RuntimeSupport,
  ValidateModelOptions,
  ValidationErrorCode,
  ValidationIssue,
  ValidationLevel,
  ValidationWarningCode,
} from "./validate-model";
