/**
 * NRVNAVerse asset registration (M1.1): a VERIFIED `asset:publish` report in, the exact committed
 * registry revision out — proposed by default, written only with `--apply`.
 *
 *   asset:prepare → asset:publish (write-once, re-downloaded + re-hashed) → asset:register
 *
 * Registration binds verified bytes to identity in the committed registry. It is NOT placement:
 * it never adds `assetRef` to a scene or a chunk. It never creates or changes a review or rights
 * metadata — the record's human review must already be in the published proposal — and it never
 * contacts storage: the publish report's full-object SHA-256 verification is the evidence, and the
 * staged bytes (same digest) are re-derived locally to prove the recorded stats are the pipeline's.
 *
 * Refused (never applied): unpublished / unverified / dry-run reports; digest, size, key, backend or
 * public-origin disagreement; a revision number already holding other bytes; the same bytes under
 * another revision number; a review carried over from earlier bytes; a record that is not
 * production-eligible or fails the registry schema; stats or pipeline facts that differ from what
 * the pipeline derives from the bytes; a result the spatial validation rejects.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { productionBlockers, validateAssetRegistry, type AssetRecord, type AssetRegistry, type AssetRevision } from "../spatial/assets.mjs";
import { validateSpatialSource, type SpatialSourceInput } from "../spatial/pipeline.mjs";
import { ARTIFACT_CONTENT_TYPES, EXTERNAL_CAS_OBJECT_KEY, IMMUTABLE_OBJECT_CACHE_CONTROL, objectKeyFor, runtimeAssetUrl } from "../spatial/storage.mjs";
import { loadAweGltf } from "./awe-gltf";
import { statsOf, type PrepareReport } from "./prepare-asset";
import type { PublishReport } from "./publish-asset";

export const REGISTER_REPORT_VERSION = 1;
/** Registry file created when the spatial config does not yet declare one. */
export const DEFAULT_REGISTRY_FILE = "asset-registry.json";

export interface RegisterIssue {
  code: string;
  message: string;
}

export interface RegistryChange {
  op: "add-asset" | "add-revision" | "set-current-revision" | "update-field" | "declare-registry";
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface RegisterReport {
  kind: "nrvnaverse-asset-register";
  reportVersion: number;
  mode: "proposal" | "apply";
  status: "proposed" | "applied" | "already-registered" | "blocked";
  assetId: string | null;
  revision: number | null;
  registryFile: string;
  changes: RegistryChange[];
  blockers: RegisterIssue[];
  next: string[];
}

export interface RegisterInputs {
  publishReport: unknown;
  /** The sibling prepare report (`<out>/prepared/<assetId>.r<n>.json`), or null when missing. */
  prepareReport: unknown;
  /** The staged object bytes (`<out>/objects/<objectKey>`), or null when missing. */
  stagedBytes: Uint8Array | null;
  /** The committed spatial source (config, scene, destinations, current registry or undefined). */
  source: SpatialSourceInput;
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]));
  return value;
}
const stableJson = (v: unknown) => JSON.stringify(sortDeep(v));

/** Canonical registry file text: sorted keys, 2-space JSON, trailing newline. */
export function serializeRegistry(registry: AssetRegistry): string {
  return `${JSON.stringify(sortDeep(registry), null, 2)}\n`;
}

export interface RegistrationPlan {
  blockers: RegisterIssue[];
  assetId: string | null;
  revision: number | null;
  changes: RegistryChange[];
  alreadyRegistered: boolean;
  nextRegistry: AssetRegistry | null;
  registryFile: string;
  declareRegistry: boolean;
}

/** Everything registration would change, and every reason it must not. Pure apart from the H2 re-derivation. */
export async function planRegistration(inputs: RegisterInputs): Promise<RegistrationPlan> {
  const blockers: RegisterIssue[] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  const config = inputs.source.config as Record<string, unknown>;
  const declared = typeof config.assetRegistry === "string" ? config.assetRegistry : null;
  const registryFile = declared ?? DEFAULT_REGISTRY_FILE;
  const empty = (): RegistrationPlan => ({ blockers, assetId: null, revision: null, changes: [], alreadyRegistered: false, nextRegistry: null, registryFile, declareRegistry: declared === null });

  // --- 1. a VERIFIED publication ---
  const pub = inputs.publishReport as Partial<PublishReport> | null;
  if (!pub || pub.kind !== "nrvnaverse-asset-publish" || pub.reportVersion !== 1) {
    block("invalid-publish-report", "not an asset:publish report (kind nrvnaverse-asset-publish, reportVersion 1)");
    return empty();
  }
  if (pub.mode !== "publish" || (pub.status !== "published" && pub.status !== "already-published")) {
    block("not-published", `the publish report is ${JSON.stringify(pub.mode)} / ${JSON.stringify(pub.status)}; only a completed publication is registered`);
    return empty();
  }
  const plan = pub.plan;
  const v = pub.verification;
  const proposal = pub.registryRevision;
  if (!plan || !v || !proposal || (pub.blockers?.length ?? 0) > 0 || pub.failure) {
    block("unverified", "the publish report carries no verification / registry revision, or has blockers / a failure");
    return empty();
  }
  const { assetId, revision } = plan;
  const record = proposal.record;
  const entry: AssetRevision | undefined = record?.revisions?.[String(revision)];
  const artifact = entry?.artifact;

  // --- 2. artifact facts agree everywhere ---
  if (v.method !== "full-object-get-sha256") block("unverified", `verification method ${JSON.stringify(v.method)} is not a full-object SHA-256`);
  if (v.sha256 !== plan.sha256 || v.bytes !== plan.bytes) block("digest-mismatch", "the remote verification does not match the published artifact");
  if (v.contentType !== ARTIFACT_CONTENT_TYPES.glb || v.cacheControl !== IMMUTABLE_OBJECT_CACHE_CONTROL) block("delivery-headers", "the verified object does not carry the immutable GLB delivery headers");
  if (proposal.assetId !== assetId || proposal.revision !== revision) block("proposal-mismatch", "the registry revision in the report names another asset / revision");
  if (!artifact || artifact.sha256 !== plan.sha256 || artifact.bytes !== plan.bytes || artifact.format !== "glb") block("digest-mismatch", "the registry revision's artifact is not the published bytes");
  if (!artifact || artifact.storage?.backend !== "external-cas" || plan.backend !== "external-cas") block("backend-mismatch", "only external-cas artifacts are registered by this command");
  const expectedKey = objectKeyFor("external-cas", assetId, plan.sha256, "glb");
  if (plan.objectKey !== expectedKey || artifact?.storage?.objectKey !== expectedKey || !EXTERNAL_CAS_OBJECT_KEY.test(expectedKey)) block("object-key-mismatch", `object key must be ${expectedKey}`);
  const storage = (config.assetStorage ?? null) as Record<string, { publicOrigin?: string }> | null;
  const committedOrigin = storage?.["external-cas"]?.publicOrigin;
  if (!committedOrigin) block("origin-mismatch", "the committed spatial config declares no external-cas public origin");
  else if (plan.runtimeUrl !== runtimeAssetUrl({ backend: "external-cas", objectKey: expectedKey }, storage)) {
    block("origin-mismatch", `published for ${JSON.stringify(plan.runtimeUrl)}, but the committed origin resolves to ${committedOrigin}/${expectedKey}`);
  }

  // --- 3. derived facts are the pipeline's, not hand-edited ---
  const prep = inputs.prepareReport as Partial<PrepareReport> | null;
  if (!prep || prep.kind !== "nrvnaverse-asset-prepare") block("prepare-report-missing", "the prepare report next to the publication is required to check derived facts");
  else if (!same(prep.registryProposal, proposal)) block("derived-facts-edited", "the registry revision differs from the one asset:prepare produced");
  if (!inputs.stagedBytes) block("staged-object-missing", "the staged object is required to re-derive the H2 statistics");
  else if (sha256Hex(inputs.stagedBytes) !== plan.sha256) block("digest-mismatch", "the staged object is not the published bytes");
  else if (entry) {
    const { validateModel } = await loadAweGltf();
    const derived = statsOf(await validateModel(inputs.stagedBytes));
    if (!same(derived, entry.stats)) block("derived-facts-edited", "the revision stats differ from what AWE H2 derives from the bytes");
  }

  // --- 4. NRVNAVerse policy: production-eligible, human review present ---
  if (record?.usage !== "production") block("not-production", `usage is ${JSON.stringify(record?.usage)}`);
  else {
    const reasons = productionBlockers(record as unknown as Record<string, unknown>);
    if (reasons.length) block("not-production-eligible", reasons.join("; "));
  }

  // --- 5. conflicts with the committed registry ---
  const current = (inputs.source.assets ?? null) as AssetRegistry | null;
  if (declared && !current) block("registry-missing", `config declares ${declared} but it does not exist`);
  const existing = current?.assets?.[assetId] ?? null;
  let alreadyRegistered = false;
  if (existing && entry) {
    const atNumber = existing.revisions[String(revision)];
    if (atNumber) {
      if (same(atNumber, entry)) alreadyRegistered = true;
      else block("revision-conflict", `revision ${revision} of ${assetId} is already registered with different content (sha256 ${atNumber.artifact?.sha256 ?? "none"}); revisions are immutable`);
    }
    for (const [n, r] of Object.entries(existing.revisions)) {
      if (n !== String(revision) && r?.artifact?.sha256 === plan.sha256) block("duplicate-bytes", `these bytes are already revision ${n} of ${assetId}`);
    }
    for (const [n, r] of Object.entries(existing.revisions)) {
      const inProposal = record.revisions[n];
      if (n !== String(revision) && inProposal && !same(inProposal, r)) block("revision-conflict", `the proposal rewrites existing revision ${n}; revisions are immutable`);
    }
    if (existing.kind !== record.kind) block("registry-conflict", `${assetId} is registered as a ${existing.kind}, the proposal says ${record.kind}`);
    const hasOtherBytes = Object.entries(existing.revisions).some(([n, r]) => n !== String(revision) && r?.artifact?.sha256 !== plan.sha256);
    const staleReview = same(existing.review, record.review) || (typeof existing.review.reviewedAt === "string" && typeof record.review.reviewedAt === "string" && Date.parse(record.review.reviewedAt) < Date.parse(existing.review.reviewedAt));
    if (!alreadyRegistered && hasOtherBytes && staleReview) {
      block("stale-review", `the review (${record.review.reviewedBy}, ${record.review.reviewedAt}) was given before or for earlier bytes; revision ${revision} needs a fresh human review`);
    }
  }
  if (current) {
    for (const [id, a] of Object.entries(current.assets)) {
      if (id !== assetId && Object.values(a.revisions).some((r) => r?.artifact?.storage?.objectKey === expectedKey)) block("registry-conflict", `object key already registered by ${id}`);
    }
  }

  // --- 6. the next registry, validated as a whole and against the spatial source ---
  let nextRegistry: AssetRegistry | null = null;
  const changes: RegistryChange[] = [];
  if (entry && record && !blockers.length) {
    const nextRecord: AssetRecord = {
      ...record,
      currentRevision: revision,
      revisions: { ...(existing?.revisions ?? {}), [String(revision)]: entry },
    };
    nextRegistry = { schemaVersion: 1, assets: { ...(current?.assets ?? {}), [assetId]: nextRecord } };
    for (const e of validateAssetRegistry(nextRegistry)) block("registry-invalid", `[${e.code}] ${e.path}: ${e.message}`);
    const spatial = validateSpatialSource({ ...inputs.source, config: { ...config, assetRegistry: registryFile }, assets: nextRegistry });
    if (!spatial.ok) for (const e of spatial.errors) block("spatial-invalid", `[${e.code}] ${e.path}: ${e.message}`);

    if (declared === null) changes.push({ op: "declare-registry", path: "config.assetRegistry", before: undefined, after: registryFile });
    if (!existing) changes.push({ op: "add-asset", path: `assets.${assetId}`, after: { name: record.name, usage: record.usage, currentRevision: revision } });
    else {
      for (const key of ["name", "usage", "provenance", "rights", "review"] as const) {
        if (!same(existing[key], record[key])) changes.push({ op: "update-field", path: `assets.${assetId}.${key}`, before: existing[key], after: record[key] });
      }
      if (existing.currentRevision !== revision) changes.push({ op: "set-current-revision", path: `assets.${assetId}.currentRevision`, before: existing.currentRevision, after: revision });
    }
    if (!alreadyRegistered) changes.push({ op: "add-revision", path: `assets.${assetId}.revisions.${revision}`, after: entry });
  }
  if (blockers.length) nextRegistry = null;
  return { blockers, assetId, revision, changes, alreadyRegistered: alreadyRegistered && !blockers.length, nextRegistry, registryFile, declareRegistry: declared === null };
}

/** Human-readable, deterministic diff lines for a plan. */
export function describeChanges(changes: RegistryChange[]): string[] {
  const fmt = (v: unknown) => (v === undefined ? "∅" : JSON.stringify(sortDeep(v)));
  return changes.map((c) => {
    if (c.op === "add-revision") {
      const r = c.after as AssetRevision;
      return `+ ${c.path}  sha256 ${r.artifact?.sha256} · ${r.artifact?.bytes} bytes · ${r.artifact?.storage.backend}:${r.artifact?.storage.objectKey}`;
    }
    if (c.op === "add-asset" || c.op === "declare-registry") return `+ ${c.path}  ${fmt(c.after)}`;
    return `~ ${c.path}  ${fmt(c.before)} → ${fmt(c.after)}`;
  });
}

/**
 * Write the registry (and, first time, declare it in the spatial config) atomically. Only called for
 * an explicit `--apply` with no blockers.
 */
export function applyRegistration(plan: RegistrationPlan, sourceDir: string, configFile: string): void {
  if (!plan.nextRegistry || plan.blockers.length) throw new Error("refusing to apply a blocked registration");
  const registryPath = join(sourceDir, plan.registryFile);
  const tmp = `${registryPath}.partial`;
  writeFileSync(tmp, serializeRegistry(plan.nextRegistry));
  renameSync(tmp, registryPath);
  if (plan.declareRegistry) {
    const text = readFileSync(configFile, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const anchor = /("scene":\s*"[^"]+",)/;
    if (!anchor.test(text)) throw new Error(`cannot find the scene entry in ${configFile} to declare assetRegistry`);
    writeFileSync(configFile, text.replace(anchor, `$1${eol}  "assetRegistry": ${JSON.stringify(plan.registryFile)},`));
  }
}

/** Sibling paths of a publish report written by `asset:publish` (`<out>/published/<file>.json`). */
export function siblingsOf(publishReportPath: string, publish: Partial<PublishReport> | null): { prepareReport: string | null; stagedObject: string | null } {
  const root = dirname(dirname(publishReportPath));
  const plan = publish?.plan;
  if (!plan) return { prepareReport: null, stagedObject: null };
  const prepareReport = join(root, "prepared", `${plan.assetId}.r${plan.revision}.json`);
  const stagedObject = join(root, "objects", ...plan.objectKey.split("/"));
  return { prepareReport: existsSync(prepareReport) ? prepareReport : null, stagedObject: existsSync(stagedObject) ? stagedObject : null };
}
