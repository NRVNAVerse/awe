/**
 * NRVNAVerse production-asset intake (M1.1): one cleared source GLB + authored metadata in, a
 * deterministic "ready for upload" content-addressed artifact + registry revision proposal out.
 *
 *   source GLB
 *     → validate source            (AWE H2 validateModel — structural / runtime facts)
 *     → optimize safely            (AWE H1 optimizeModel — never fails, never bigger)
 *     → validate the result        (AWE H2 again — the bytes that would ship)
 *     → NRVNAVerse policy          (self-contained GLB, runtime-supported extensions, registry schema,
 *                                   provenance / rights / human review, M1 warning bands)
 *     → revision + SHA-256         (registry revision number, full digest, derived stats)
 *     → content-addressed artifact (`external-cas` object key; staged locally, write-once, verified)
 *     → registry binding proposal  (the record + revision a human reviews and commits)
 *
 * What this never does: set or change a review, approve anything, write the committed registry,
 * reference the asset from a scene, target `repo-public` (a public Git commit is a deliberate human
 * publication), upload, or touch a source library. Blockers are reported, never worked around.
 *
 * Deterministic: the same bytes, metadata, registry and options give byte-identical artifacts and a
 * byte-identical prepare report (wall-clock fields from the AWE reports are dropped).
 */
import {
  ASSET_ID_PATTERN,
  assetExperimentalWarnings,
  productionBlockers,
  validateAssetRegistry,
  type AssetRecord,
  type AssetRegistry,
  type AssetRevision,
} from "../spatial/assets.mjs";
import { ARTIFACT_CONTENT_TYPES, objectKeyFor, type StorageAdapter } from "../spatial/storage.mjs";
import { AWE_OPTIMIZE_REPORT_VERSION, AWE_VALIDATE_REPORT_VERSION, loadAweGltf, type AweModelReport, type AweOptimizeOptions } from "./awe-gltf";
import { sha256Of } from "./staging";

export const PREPARE_REPORT_VERSION = 1;

/** Production art is prepared for the external content-addressed store, never for repo-public. */
export const PREPARE_STORAGE_BACKEND = "external-cas";

/**
 * NRVNAVerse's optimiser profile. Draco is OFF by default: which Draco decoder the web runtime
 * loads, and from where, is an open handoff dependency under a self-hosting policy
 * (docs/NRVNAVERSE_ASSET_PIPELINE.md §7). Opt in per asset with `draco: true` once that is settled.
 */
export const NRVNAVERSE_OPTIMIZE_PROFILE: Readonly<Required<Omit<AweOptimizeOptions, "timeoutMs">>> = Object.freeze({
  draco: false,
  textures: "webp",
  maxTextureSize: 2048,
  quality: 90,
});

/** Authored intake metadata: everything about the asset that is NOT derived from its bytes. */
export interface AssetIntakeMetadata {
  assetId: string;
  name: string;
  kind: string;
  usage: string;
  provenance: AssetRecord["provenance"];
  rights: AssetRecord["rights"];
  review: AssetRecord["review"];
  notes?: string;
}

const METADATA_KEYS = ["assetId", "name", "kind", "usage", "provenance", "rights", "review", "notes"];

export interface PrepareIssue {
  code: string;
  message: string;
}

export interface PrepareOptions {
  /** The committed registry, when the asset (or other assets) already exist. */
  registry?: AssetRegistry | null;
  /** Overrides of {@link NRVNAVERSE_OPTIMIZE_PROFILE}. */
  optimize?: Partial<AweOptimizeOptions>;
}

export interface PreparedArtifact {
  sha256: string;
  bytes: number;
  format: "glb";
  contentType: string;
  storage: { backend: string; objectKey: string };
}

export interface PrepareResult {
  report: PrepareReport;
  /** The runtime artifact bytes (null when the input could not be turned into one). */
  artifactBytes: Uint8Array | null;
}

export interface PrepareReport {
  kind: "nrvnaverse-asset-prepare";
  reportVersion: number;
  /** `ready` = no blockers: the artifact may be uploaded and the revision proposed for commit. */
  status: "ready" | "blocked";
  assetId: string | null;
  revision: number | null;
  source: { sha256: string; bytes: number };
  artifact: PreparedArtifact | null;
  blockers: PrepareIssue[];
  warnings: PrepareIssue[];
  optimization: {
    profile: AweOptimizeOptions;
    result: "optimized" | "skipped" | "not-run";
    skipCode: string | null;
    skipReason: string | null;
    transformsApplied: string[];
    bytes: { input: number; output: number; candidate: number | null } | null;
    percentChange: number | null;
  };
  validation: { source: ValidationSummary; output: ValidationSummary | null };
  /** The registry record and revision to commit after upload + verify (a proposal, never applied here). */
  registryProposal: { assetId: string; revision: number; record: AssetRecord } | null;
  /** What remains, in order. */
  next: string[];
}

export interface ValidationSummary {
  valid: boolean;
  container: string;
  errors: string[];
  warnings: string[];
  extensionsUsed: string[];
}

const summarize = (r: AweModelReport): ValidationSummary => ({
  valid: r.valid,
  container: r.file.container,
  errors: r.errors.map((e) => e.code),
  warnings: [...new Set(r.warnings.map((w) => w.code))].sort(),
  extensionsUsed: [...r.extensions.used].sort(),
});

/** Derived statistics recorded on the revision (replacing self-declared `stats`). */
export function statsOf(r: AweModelReport): Record<string, unknown> {
  const c = r.counts;
  const edge = Math.max(r.textures.maxWidth ?? 0, r.textures.maxHeight ?? 0);
  return {
    source: `awe-validate-model@${r.reportVersion}`,
    triangles: c.trianglesInstanced ?? c.triangles,
    trianglesUnique: c.triangles,
    vertices: c.vertices,
    meshes: c.meshes,
    primitives: c.primitives,
    materials: c.materials,
    textures: c.textures,
    textureBytes: r.textures.bytes,
    maxTextureDimension: edge > 0 ? edge : null,
    animations: c.animations,
    skins: c.skins,
    morphTargets: c.morphTargets,
    extensionsUsed: [...r.extensions.used].sort(),
    bounds: r.bounds ? { min: r.bounds.min, max: r.bounds.max, size: r.bounds.size } : null,
  };
}

/** Runtime-extension policy: what the AWE runtime cannot load (or loads on some platforms only) blocks. */
function runtimeIssues(r: AweModelReport, blockers: PrepareIssue[], warnings: PrepareIssue[]) {
  for (const ext of [...r.extensions.used].sort()) {
    const fact = r.extensions.runtime[ext];
    if (!fact) {
      blockers.push({ code: "runtime-unknown-extension", message: `the artifact uses ${ext}, which the AWE runtime does not know` });
    } else if (fact.support === "unsupported" || fact.support === "partial") {
      blockers.push({ code: "runtime-unsupported-extension", message: `the artifact uses ${ext} (${fact.support} in the AWE runtime: ${fact.note})` });
    } else if (fact.support === "ignored") {
      warnings.push({ code: "runtime-ignored-extension", message: `${ext} is ignored by the AWE runtime: ${fact.note}` });
    }
  }
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortedJson((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** Deterministic JSON for the prepare report (sorted keys, trailing newline). */
export function stablePrepareJson(report: PrepareReport): string {
  return `${JSON.stringify(sortedJson(report), null, 2)}\n`;
}

/**
 * Prepare one source GLB. Pure with respect to storage: returns the artifact bytes and the report;
 * {@link stagePrepared} writes them through a {@link StorageAdapter}.
 */
export async function prepareAsset(sourceBytes: Uint8Array, metadataInput: unknown, options: PrepareOptions = {}): Promise<PrepareResult> {
  const { validateModel, optimizeModel } = await loadAweGltf();
  const blockers: PrepareIssue[] = [];
  const warnings: PrepareIssue[] = [];
  const profile: AweOptimizeOptions = { ...NRVNAVERSE_OPTIMIZE_PROFILE, ...options.optimize };
  const source = { sha256: sha256Of(sourceBytes), bytes: sourceBytes.byteLength };

  // --- metadata shape (full schema validation happens on the proposed registry below) ---
  const metadata = (metadataInput && typeof metadataInput === "object" && !Array.isArray(metadataInput) ? metadataInput : {}) as Record<string, unknown>;
  if (metadataInput !== metadata) blockers.push({ code: "metadata-invalid", message: "metadata must be a JSON object" });
  for (const key of Object.keys(metadata)) {
    if (!METADATA_KEYS.includes(key)) blockers.push({ code: "metadata-invalid", message: `unexpected metadata field "${key}" (derived facts such as digests, sizes and stats are never authored)` });
  }
  const assetId = typeof metadata.assetId === "string" && ASSET_ID_PATTERN.test(metadata.assetId) ? metadata.assetId : null;
  if (!assetId) blockers.push({ code: "metadata-invalid", message: `assetId ${JSON.stringify(metadata.assetId)} must be an asset id (${ASSET_ID_PATTERN}); generate one once and keep it` });

  const blocked = (report: Partial<PrepareReport>): PrepareResult => ({
    artifactBytes: null,
    report: finish({ assetId, revision: null, artifact: null, registryProposal: null, ...report }),
  });
  const optimizationNotRun: PrepareReport["optimization"] = { profile, result: "not-run", skipCode: null, skipReason: null, transformsApplied: [], bytes: null, percentChange: null };
  const finish = (partial: Partial<PrepareReport>): PrepareReport => {
    const status = blockers.length ? "blocked" : "ready";
    return {
      kind: "nrvnaverse-asset-prepare",
      reportVersion: PREPARE_REPORT_VERSION,
      status,
      assetId: null,
      revision: null,
      source,
      artifact: null,
      blockers,
      warnings,
      optimization: optimizationNotRun,
      validation: { source: sourceSummary, output: null },
      registryProposal: null,
      next: status === "ready"
        ? [
            `upload objects/${partial.artifact?.storage.objectKey} to the ${PREPARE_STORAGE_BACKEND} store and verify size + sha256 there (adapter pending)`,
            "commit the proposed registry record + revision after that verify, then reference the asset (assetRef) and run spatial:generate / spatial:check",
          ]
        : ["resolve every blocker, then run prepare again (nothing was proposed for upload)"],
      ...partial,
    };
  };

  // --- 1. validate the source (AWE H2) ---
  const sourceReport = await validateModel(sourceBytes);
  const sourceSummary = summarize(sourceReport);
  if (!sourceReport.valid) {
    blockers.push({ code: "source-invalid", message: `the source is not a structurally valid glTF: ${sourceReport.errors.map((e) => `${e.code} (${e.message})`).join("; ")}` });
    return blocked({});
  }
  if (sourceReport.file.container !== "glb") {
    blockers.push({ code: "source-not-glb", message: `the source is a ${sourceReport.file.container} document; runtime assets are self-contained GLB files` });
  }
  if (!sourceReport.resources.selfContained) {
    blockers.push({ code: "source-external-resources", message: "the source references external files; export a self-contained GLB (external URIs are never fetched)" });
  }
  if (blockers.some((b) => b.code.startsWith("source-"))) return blocked({});

  // --- 2. optimise safely (AWE H1: never fails, never bigger; a skip returns the exact input) ---
  const optimized = await optimizeModel(sourceBytes, profile);
  const opt = optimized.report;
  const optimization: PrepareReport["optimization"] = {
    profile,
    result: opt.optimized ? "optimized" : "skipped",
    skipCode: opt.skipCode,
    skipReason: opt.skipReason,
    transformsApplied: [...opt.transforms.applied],
    bytes: { ...opt.bytes },
    percentChange: opt.percentChange,
  };
  if (!opt.optimized) warnings.push({ code: "optimizer-skipped", message: `the optimiser returned the source unchanged (${opt.skipCode}: ${opt.skipReason})` });
  const artifactBytes = optimized.buffer;

  // --- 3. validate what would ship (AWE H2 on the output) ---
  const outputReport = opt.changed ? await validateModel(artifactBytes) : sourceReport;
  const outputSummary = summarize(outputReport);
  if (!outputReport.valid) {
    blockers.push({ code: "output-invalid", message: `the optimised output failed validation: ${outputReport.errors.map((e) => e.code).join(", ")}` });
    return { artifactBytes: null, report: finish({ assetId, optimization, validation: { source: sourceSummary, output: outputSummary } }) };
  }

  // --- 4. NRVNAVerse policy on the shipping bytes ---
  runtimeIssues(outputReport, blockers, warnings);

  // --- 5. revision + digest + content-addressed key ---
  const sha256 = sha256Of(artifactBytes);
  const existing = assetId && options.registry ? options.registry.assets[assetId] ?? null : null;
  const revisionNumbers = existing ? Object.keys(existing.revisions).map(Number).filter(Number.isInteger) : [];
  const revision = revisionNumbers.length ? Math.max(...revisionNumbers) + 1 : 1;
  const duplicate = existing ? Object.entries(existing.revisions).find(([, r]) => r?.artifact?.sha256 === sha256) : undefined;
  if (duplicate) blockers.push({ code: "revision-exists", message: `these exact bytes are already revision ${duplicate[0]} of ${assetId}; nothing to prepare` });

  const artifact: PreparedArtifact | null = assetId
    ? { sha256, bytes: artifactBytes.byteLength, format: "glb", contentType: ARTIFACT_CONTENT_TYPES.glb, storage: { backend: PREPARE_STORAGE_BACKEND, objectKey: objectKeyFor(PREPARE_STORAGE_BACKEND, assetId, sha256, "glb") } }
    : null;

  const revisionEntry: AssetRevision = {
    artifact: artifact ? { sha256: artifact.sha256, bytes: artifact.bytes, format: artifact.format, storage: artifact.storage } : null,
    stats: statsOf(outputReport) as AssetRevision["stats"],
    pipeline: {
      optimization: opt.optimized ? "optimized" : "skipped",
      optimizer: `awe-safe-optimize@${AWE_OPTIMIZE_REPORT_VERSION}`,
      profile,
      skipCode: opt.skipCode,
      transformsApplied: [...opt.transforms.applied],
      validator: `awe-validate-model@${AWE_VALIDATE_REPORT_VERSION} (${outputReport.level})`,
      source: { sha256: source.sha256, bytes: source.bytes },
    },
    ...(typeof metadata.notes === "string" ? { notes: metadata.notes } : {}),
  };

  // --- 6. registry binding proposal + NRVNAVerse rights / review policy ---
  let registryProposal: PrepareReport["registryProposal"] = null;
  if (assetId && artifact) {
    if (existing && existing.kind !== metadata.kind) blockers.push({ code: "registry-conflict", message: `${assetId} is registered as a ${existing.kind}, metadata says ${JSON.stringify(metadata.kind)}` });
    // A new revision is new bytes: a review recorded for earlier bytes does not cover it. The tool
    // never re-dates a review — a human re-reviews and updates reviewedBy / reviewedAt.
    if (existing && !duplicate && JSON.stringify(existing.review) === JSON.stringify(metadata.review) && existing.review.status !== "unreviewed") {
      blockers.push({ code: "review-predates-revision", message: `the ${existing.review.status} review on record was given for earlier bytes; revision ${revision} needs a fresh human review (update reviewedBy / reviewedAt)` });
    }
    const record = {
      name: metadata.name,
      kind: metadata.kind,
      usage: metadata.usage,
      currentRevision: revision,
      provenance: metadata.provenance,
      rights: metadata.rights,
      review: metadata.review,
      revisions: { ...(existing?.revisions ?? {}), [String(revision)]: revisionEntry },
    } as unknown as AssetRecord;
    const proposed = { schemaVersion: 1, assets: { ...(options.registry?.assets ?? {}), [assetId]: record } };
    for (const e of validateAssetRegistry(proposed)) {
      if (e.path.startsWith(`registry.assets.${assetId}`)) blockers.push({ code: "metadata-invalid", message: `[${e.code}] ${e.path}: ${e.message}` });
    }
    if (record.usage === "production") {
      const reasons = productionBlockers(record as unknown as Record<string, unknown>);
      if (reasons.length) blockers.push({ code: "production-unresolved", message: `not production-eligible: ${reasons.join("; ")}` });
    } else if (record.usage === "internal-tracer") {
      warnings.push({ code: "internal-tracer", message: "prepared as an INTERNAL TRACER, not production art" });
      if (record.review?.status !== "internal-tracer-accepted") blockers.push({ code: "internal-tracer-unaccepted", message: `internal tracer review status is ${JSON.stringify(record.review?.status)} (needs "internal-tracer-accepted")` });
    }
    for (const w of assetExperimentalWarnings(proposed as unknown as AssetRegistry, [assetId])) warnings.push({ code: w.code, message: w.message });
    registryProposal = { assetId, revision, record };
  }

  return { artifactBytes, report: finish({ assetId, revision, artifact, optimization, validation: { source: sourceSummary, output: outputSummary }, registryProposal }) };
}

/**
 * Stage a prepared artifact at its content-addressed key through a storage adapter, then verify it.
 * Staging is local and write-once; it is NOT an upload and makes nothing ready by itself.
 */
export async function stagePrepared(result: PrepareResult, adapter: StorageAdapter): Promise<{ created: boolean; location: string; verified: boolean; problem: string | null } | null> {
  const { artifact } = result.report;
  if (!artifact || !result.artifactBytes) return null;
  if (adapter.backend !== artifact.storage.backend) throw new Error(`adapter is for ${adapter.backend}, artifact is for ${artifact.storage.backend}`);
  const put = await adapter.put(artifact.storage.objectKey, result.artifactBytes, { sha256: artifact.sha256, contentType: artifact.contentType });
  const check = await adapter.verify(artifact.storage.objectKey, { sha256: artifact.sha256, bytes: artifact.bytes });
  return { ...put, verified: check.ok, problem: check.problem };
}
