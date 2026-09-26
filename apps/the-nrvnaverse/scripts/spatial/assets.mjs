// @ts-check
/**
 * NRVNAVerse runtime asset registry + provenance / rights gate (M1.0). Pure, dependency-free.
 *
 * A spatial component never names a binary file directly. It names a LOGICAL asset:
 *
 *   scene component  { type: "model", assetRef: "ast_…" }            (authored, spatial/source/)
 *     → registry     assets[assetId].currentRevision → revisions[n]  (authored, spatial/source/)
 *     → artifact     { sha256, bytes, format, storage: { backend, objectKey } }
 *     → runtime URL  resolved by the storage backend at GENERATE time → `url` in the chunk payload
 *
 * Three things are kept apart on purpose (docs/NRVNAVERSE_ASSET_PIPELINE.md):
 * - IDENTITY: `assetId` (`ast_` + 16 chars, random, like destination ids — D-004 pattern). It is not
 *   derived from a file name, a digest, a path or a URL, and survives renames and new revisions.
 * - REVISION / DIGEST: each revision records the full SHA-256 of its runtime artifact. The object
 *   key embeds the first 32 hex chars (the spatial pipeline's content-version length), so a new
 *   revision is a new immutable URL and — because the URL lands in the chunk payload — a new chunk
 *   digest.
 * - STORAGE: `storage.backend` decides where the bytes live and how the URL is formed — the
 *   provider-neutral contract in `storage.mjs`. `repo-public` (the app's `public/` directory) is
 *   implemented; `external-cas` (production art, provider not chosen) validates in the registry but
 *   its runtime resolution is adapter-pending, so a scene cannot reference it yet
 *   (`asset-storage-unresolved`). A provider is a new adapter, never a new identity.
 *
 * The rights gate is NRVNAVerse policy, not a generic AWE licensing system:
 * - a referenced asset must be registered, have a runtime artifact, not be prohibited from web
 *   redistribution, not have restricted rights and not be rejected in review;
 * - `production` use additionally requires cleared rights, web redistribution / commercial use /
 *   modification all `allowed`, no unresolved dependency, a known origin and an APPROVED review that
 *   names its human reviewer and time ({@link productionBlockers}). Nothing ever promotes an asset:
 *   metadata is evidence for the human review, not the approval;
 * - `internal-tracer` use requires the explicit `internal-tracer-accepted` review and is always
 *   reported as a warning;
 * - `repo-public` storage IS publication (a public repository), for cleared internal engineering
 *   assets only: production art never uses it (`repo-public-production`); its bytes need cleared
 *   rights, allowed redistribution, a known origin and no unresolved dependency
 *   ({@link publicationBlockers}); and the publication needs a deliberate, attributed
 *   `internal-tracer-accepted` review ({@link publicationReviewBlockers}). Uncleared or evaluative
 *   art therefore never enters Git, and automation never approves a publication.
 */

import { STORAGE_BACKENDS, isRuntimeResolvable, objectKeyFor, runtimeAssetUrl, storageBackend } from "./storage.mjs";

export const ASSET_REGISTRY_SCHEMA_VERSION = 1;

/** Same alphabet and length as destination ids (`dst_`), different prefix. */
export const ASSET_ID_PATTERN = /^ast_[0-9abcdefghjkmnpqrstvwxyz]{16}$/;
/** Full lowercase SHA-256 of the runtime artifact bytes. */
export const ASSET_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const ASSET_KINDS = Object.freeze(["model"]);
/** Runtime formats per kind. */
export const ASSET_FORMATS = Object.freeze({ model: Object.freeze(["glb"]) });
/** Which spatial component types carry a runtime asset reference, and the asset kind they need. */
export const ASSET_COMPONENT_KINDS = Object.freeze({ model: "model" });

export const ASSET_USAGES = Object.freeze(["internal-tracer", "production"]);
/** `unknown` is recordable (never forced into a wrong claim) but is never production-eligible. */
export const ASSET_ORIGINS = Object.freeze(["self-authored", "commissioned", "licensed-third-party", "partner-supplied", "unknown"]);
/** Optional `provenance.creationContext`: how the work was made. Evidence for review, never a clearance. */
export const CREATION_CONTEXTS = Object.freeze(["original", "tutorial-assisted", "derived", "unknown"]);
export const RIGHTS_STATUSES = Object.freeze(["cleared", "unresolved", "restricted"]);
export const PERMISSIONS = Object.freeze(["allowed", "prohibited", "unknown"]);
export const DEPENDENCY_STATUSES = Object.freeze(["cleared", "unresolved", "removed"]);
export const REVIEW_STATUSES = Object.freeze(["unreviewed", "internal-tracer-accepted", "approved", "rejected"]);

// Storage backends, object keys and runtime URL resolution are the provider-neutral storage contract
// (`storage.mjs`); re-exported so existing callers keep one import.
export {
  ASSET_OBJECT_TOKEN_LENGTH,
  EXTERNAL_CAS_OBJECT_KEY,
  REPO_PUBLIC_ART_PREFIX,
  REPO_PUBLIC_OBJECT_KEY,
  STORAGE_BACKENDS,
  STORAGE_BACKEND_CONTRACTS,
  isRuntimeResolvable,
  objectKeyFor,
  runtimeAssetUrl,
} from "./storage.mjs";

/**
 * M1 EXPERIMENTAL warning bands — investigation triggers for the representative-art slice, never
 * failures and never production budgets (docs/NRVNAVERSE_ASSET_PIPELINE.md). Final budgets come from
 * measured representative art (M1.4).
 */
export const M1_EXPERIMENTAL_ASSET_WARNINGS = Object.freeze({
  /** One runtime asset larger than this is worth a look (8 MiB). */
  artifactBytes: 8 * 1024 * 1024,
  /** Any texture edge above this (the modern AWE optimizer's own resize ceiling). */
  maxTextureDimension: 2048,
  /** Triangles in one asset. */
  triangles: 150_000,
});

const REGISTRY_KEYS = ["schemaVersion", "assets"];
const ASSET_KEYS = ["name", "kind", "usage", "currentRevision", "provenance", "rights", "review", "revisions"];
const PROVENANCE_KEYS = ["origin", "creationContext", "creator", "source", "dependencies"];
const RIGHTS_KEYS = ["status", "license", "rightsHolder", "attributionRequired", "attributionText", "commercialUse", "webRuntimeRedistribution", "modification", "restrictions"];
const REVIEW_KEYS = ["status", "reviewedBy", "reviewedAt", "notes"];
const DEPENDENCY_KEYS = ["id", "kind", "description", "status", "notes"];
const REVISION_KEYS = ["artifact", "stats", "export", "pipeline", "notes"];
const ARTIFACT_KEYS = ["sha256", "bytes", "format", "storage"];
const STORAGE_KEYS = ["backend", "objectKey"];

/**
 * @typedef {{ backend: string; objectKey: string }} AssetStorage
 * @typedef {{ sha256: string; bytes: number; format: string; storage: AssetStorage }} AssetArtifact
 * @typedef {{
 *   triangles?: number; vertices?: number; meshes?: number; materials?: number; textures?: number;
 *   maxTextureDimension?: number; animations?: number; skins?: number; extensionsUsed?: string[];
 *   [key: string]: unknown;
 * }} AssetStats
 * @typedef {{ artifact: AssetArtifact | null; stats?: AssetStats | null; export?: unknown; pipeline?: unknown; notes?: string }} AssetRevision
 * @typedef {{ id: string; kind: string; description: string; status: string; notes?: string }} AssetDependency
 * @typedef {{
 *   name: string; kind: string; usage: string; currentRevision: number;
 *   provenance: { origin: string; creationContext?: string; creator?: string | null; source?: unknown; dependencies: AssetDependency[] };
 *   rights: {
 *     status: string; license: string | null; rightsHolder: string | null; attributionRequired: boolean;
 *     attributionText: string | null; commercialUse: string; webRuntimeRedistribution: string; modification: string;
 *     restrictions: string[];
 *   };
 *   review: { status: string; reviewedBy: string | null; reviewedAt: string | null; notes?: string };
 *   revisions: Record<string, AssetRevision>;
 * }} AssetRecord
 * @typedef {{ schemaVersion: number; assets: Record<string, AssetRecord> }} AssetRegistry
 * @typedef {{ code: string; path: string; message: string }} AssetIssue
 * @typedef {{ componentId: string; component: Record<string, unknown> }} AssetComponent
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** ISO 8601 date-time with an explicit offset, e.g. `2026-09-24T10:00:00-07:00` or `…Z`. */
const REVIEW_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * A genuinely valid review time: the ISO shape AND a real calendar date, clock time and offset
 * (`Date.parse` alone accepts e.g. `2026-02-30` by rolling it over).
 * @param {unknown} value
 * @returns {value is string}
 */
export function isReviewTimestamp(value) {
  if (typeof value !== "string") return false;
  const m = REVIEW_TIMESTAMP.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 14 || Number(m[8]) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * A human-attestation field (`reviewedBy`): a name with at least one non-space character. It records
 * WHO took the review decision; automation never fills it in.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isAttestedReviewer(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} allowed
 * @param {string} path
 * @param {(code: string, path: string, message: string) => void} fail
 */
function rejectUnexpected(value, allowed, path, fail) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("unexpected-field", `${path}.${key}`, `unexpected field "${key}"`);
  }
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} path
 * @param {string} code
 * @param {(code: string, path: string, message: string) => void} fail
 */
function requireOneOf(value, allowed, path, code, fail) {
  if (typeof value !== "string" || !allowed.includes(value)) fail(code, path, `${JSON.stringify(value)} must be one of ${allowed.join(" | ")}`);
}

/**
 * The content-addressed object key a `repo-public` artifact must use.
 * @param {string} assetId
 * @param {string} sha256 full lowercase hex digest
 * @param {string} format
 */
export function repoPublicObjectKey(assetId, sha256, format) {
  return objectKeyFor("repo-public", assetId, sha256, format);
}

/**
 * The record's current revision, or null when it does not exist.
 * @param {AssetRecord} record
 */
export function currentRevision(record) {
  const revision = record.revisions[String(record.currentRevision)];
  return revision ?? null;
}

/**
 * Structural validation of the whole registry (every asset, referenced or not). Collects all errors.
 * @param {unknown} registry
 * @returns {AssetIssue[]}
 */
export function validateAssetRegistry(registry) {
  /** @type {AssetIssue[]} */
  const errors = [];
  /** @param {string} code @param {string} path @param {string} message */
  const fail = (code, path, message) => {
    errors.push({ code, path, message });
  };

  if (!isRecord(registry)) {
    fail("invalid-asset-registry", "registry", "asset registry must be a JSON object");
    return errors;
  }
  rejectUnexpected(registry, REGISTRY_KEYS, "registry", fail);
  if (registry.schemaVersion !== ASSET_REGISTRY_SCHEMA_VERSION) {
    fail("unsupported-asset-registry-version", "registry.schemaVersion", `unsupported asset registry schema version ${JSON.stringify(registry.schemaVersion)} (expected ${ASSET_REGISTRY_SCHEMA_VERSION})`);
    return errors;
  }
  if (!isRecord(registry.assets)) {
    fail("invalid-asset-registry", "registry.assets", "assets must be an object keyed by assetId");
    return errors;
  }

  for (const [assetId, asset] of Object.entries(registry.assets)) {
    const path = `registry.assets.${assetId}`;
    if (!ASSET_ID_PATTERN.test(assetId)) fail("invalid-asset-id", path, `asset id ${JSON.stringify(assetId)} must match ${ASSET_ID_PATTERN}`);
    if (!isRecord(asset)) {
      fail("invalid-asset", path, "asset must be an object");
      continue;
    }
    rejectUnexpected(asset, ASSET_KEYS, path, fail);
    if (!isNonEmptyString(asset.name)) fail("invalid-asset", `${path}.name`, "name must be a non-empty string");
    requireOneOf(asset.kind, ASSET_KINDS, `${path}.kind`, "invalid-asset-kind", fail);
    requireOneOf(asset.usage, ASSET_USAGES, `${path}.usage`, "invalid-asset-usage", fail);

    // provenance
    if (!isRecord(asset.provenance)) {
      fail("invalid-provenance", `${path}.provenance`, "provenance must be an object");
    } else {
      const p = asset.provenance;
      rejectUnexpected(p, PROVENANCE_KEYS, `${path}.provenance`, fail);
      requireOneOf(p.origin, ASSET_ORIGINS, `${path}.provenance.origin`, "invalid-provenance", fail);
      if (p.creationContext !== undefined) requireOneOf(p.creationContext, CREATION_CONTEXTS, `${path}.provenance.creationContext`, "invalid-provenance", fail);
      if (!Array.isArray(p.dependencies)) {
        fail("invalid-provenance", `${path}.provenance.dependencies`, "dependencies must be an array (empty when the asset has none)");
      } else {
        /** @type {Set<string>} */
        const ids = new Set();
        p.dependencies.forEach((d, i) => {
          const dpath = `${path}.provenance.dependencies[${i}]`;
          if (!isRecord(d)) return fail("invalid-dependency", dpath, "dependency must be an object");
          rejectUnexpected(d, DEPENDENCY_KEYS, dpath, fail);
          if (!isNonEmptyString(d.id)) fail("invalid-dependency", `${dpath}.id`, "dependency id must be a non-empty string");
          else if (ids.has(d.id)) fail("invalid-dependency", `${dpath}.id`, `duplicate dependency id "${d.id}"`);
          else ids.add(d.id);
          if (!isNonEmptyString(d.kind)) fail("invalid-dependency", `${dpath}.kind`, "dependency kind must be a non-empty string");
          if (!isNonEmptyString(d.description)) fail("invalid-dependency", `${dpath}.description`, "dependency description must be a non-empty string");
          requireOneOf(d.status, DEPENDENCY_STATUSES, `${dpath}.status`, "invalid-dependency", fail);
        });
      }
    }

    // rights
    if (!isRecord(asset.rights)) {
      fail("invalid-rights", `${path}.rights`, "rights must be an object");
    } else {
      const r = asset.rights;
      rejectUnexpected(r, RIGHTS_KEYS, `${path}.rights`, fail);
      requireOneOf(r.status, RIGHTS_STATUSES, `${path}.rights.status`, "invalid-rights", fail);
      for (const key of ["commercialUse", "webRuntimeRedistribution", "modification"]) {
        requireOneOf(r[key], PERMISSIONS, `${path}.rights.${key}`, "invalid-rights", fail);
      }
      if (typeof r.attributionRequired !== "boolean") fail("invalid-rights", `${path}.rights.attributionRequired`, "attributionRequired must be a boolean");
      if (r.attributionRequired === true && !isNonEmptyString(r.attributionText)) fail("invalid-rights", `${path}.rights.attributionText`, "attributionText is required when attributionRequired is true");
      if (!Array.isArray(r.restrictions) || !r.restrictions.every(isNonEmptyString)) fail("invalid-rights", `${path}.rights.restrictions`, "restrictions must be an array of strings");
      if (r.status === "cleared" && r.webRuntimeRedistribution !== "allowed") fail("invalid-rights", `${path}.rights.status`, `rights cannot be "cleared" while webRuntimeRedistribution is ${JSON.stringify(r.webRuntimeRedistribution)}`);
    }

    // review
    if (!isRecord(asset.review)) {
      fail("invalid-review", `${path}.review`, "review must be an object");
    } else {
      const rv = asset.review;
      rejectUnexpected(rv, REVIEW_KEYS, `${path}.review`, fail);
      requireOneOf(rv.status, REVIEW_STATUSES, `${path}.review.status`, "invalid-review", fail);
      if (rv.reviewedBy !== null && rv.reviewedBy !== undefined && !isAttestedReviewer(rv.reviewedBy)) fail("invalid-review", `${path}.review.reviewedBy`, "reviewedBy must be a reviewer name (not blank) or null");
      if (rv.reviewedAt !== null && rv.reviewedAt !== undefined && !isReviewTimestamp(rv.reviewedAt)) fail("invalid-review", `${path}.review.reviewedAt`, "reviewedAt must be an ISO 8601 date-time (YYYY-MM-DDTHH:MM[:SS]±HH:MM or Z) or null");
      // An approval is a human review EVENT: it names the reviewer and when. Provenance, licence
      // metadata, passing tests or self-authorship are evidence for that review, never the approval.
      if (rv.status === "approved") {
        if (!isAttestedReviewer(rv.reviewedBy)) fail("review-approval-unattributed", `${path}.review.reviewedBy`, "an approved review must name the human reviewer (reviewedBy)");
        if (!isReviewTimestamp(rv.reviewedAt)) fail("review-approval-unattributed", `${path}.review.reviewedAt`, "an approved review must record when it happened (reviewedAt, ISO 8601 date-time)");
      }
    }

    // revisions
    if (!isNonNegativeInteger(asset.currentRevision) || asset.currentRevision < 1) {
      fail("invalid-revision", `${path}.currentRevision`, "currentRevision must be a positive integer");
    }
    if (!isRecord(asset.revisions)) {
      fail("invalid-revision", `${path}.revisions`, "revisions must be an object keyed by revision number");
      continue;
    }
    for (const [number, revision] of Object.entries(asset.revisions)) {
      const rpath = `${path}.revisions.${number}`;
      if (!/^[1-9][0-9]*$/.test(number)) fail("invalid-revision", rpath, "revision keys must be positive integers");
      if (!isRecord(revision)) {
        fail("invalid-revision", rpath, "revision must be an object");
        continue;
      }
      rejectUnexpected(revision, REVISION_KEYS, rpath, fail);
      if (revision.artifact === null || revision.artifact === undefined) continue; // reported by the gate if referenced
      validateArtifact(assetId, isRecord(asset) ? asset.kind : undefined, revision.artifact, `${rpath}.artifact`, fail);
    }
    if (isNonNegativeInteger(asset.currentRevision) && !(String(asset.currentRevision) in asset.revisions)) {
      fail("invalid-revision", `${path}.currentRevision`, `current revision ${asset.currentRevision} does not exist in revisions`);
    }

    // `repo-public` bytes live in a PUBLIC Git repository and its deployed builds: committing them IS
    // publication, whatever `usage` says and whether or not anything references them yet. It is for
    // cleared INTERNAL ENGINEERING assets only, each published by a deliberate, attributed human review:
    // - production art never uses repo-public (it lives in external content-addressed storage);
    // - uncleared, unresolved or unknown-provenance bytes are never registered there;
    // - the review must be `internal-tracer-accepted` with a named reviewer and a valid review time.
    const publicRevisions = Object.entries(asset.revisions).filter(([, r]) => isRecord(r) && isRecord(r.artifact) && isRecord(r.artifact.storage) && typeof r.artifact.storage.backend === "string" && storageBackend(r.artifact.storage.backend)?.publishesToGit === true);
    for (const [number] of publicRevisions) {
      const spath = `${path}.revisions.${number}.artifact.storage`;
      if (asset.usage === "production") fail("repo-public-production", spath, "production art never uses repo-public storage (the public repository); it needs an external content-addressed backend");
      const blockers = publicationBlockers(asset);
      if (blockers.length) fail("repo-public-uncleared", spath, `repo-public storage publishes the bytes in a public repository, but ${blockers.join("; ")}`);
      const unreviewed = publicationReviewBlockers(asset);
      if (unreviewed.length) fail("repo-public-unreviewed", spath, `repo-public storage is a publication event and needs a deliberate human review, but ${unreviewed.join("; ")}`);
    }
  }
  return errors;
}

/**
 * Why an asset's bytes may NOT be published (public repository / public web runtime). Empty = may be.
 * Tolerates a structurally invalid record (the structural errors are reported separately).
 * @param {Record<string, unknown>} asset
 * @returns {string[]}
 */
export function publicationBlockers(asset) {
  /** @type {string[]} */
  const reasons = [];
  const rights = isRecord(asset.rights) ? asset.rights : {};
  const provenance = isRecord(asset.provenance) ? asset.provenance : {};
  if (rights.status !== "cleared") reasons.push(`rights status is ${JSON.stringify(rights.status)}`);
  if (rights.webRuntimeRedistribution !== "allowed") reasons.push(`webRuntimeRedistribution is ${JSON.stringify(rights.webRuntimeRedistribution)}`);
  if (provenance.origin === "unknown") reasons.push(`provenance origin is "unknown"`);
  const unresolved = Array.isArray(provenance.dependencies) ? provenance.dependencies.filter((d) => !isRecord(d) || (d.status !== "cleared" && d.status !== "removed")) : [];
  if (unresolved.length) reasons.push(`${unresolved.length} unresolved dependenc${unresolved.length === 1 ? "y" : "ies"} (${unresolved.map((d) => (isRecord(d) ? String(d.id) : "?")).join(", ")})`);
  return reasons;
}

/**
 * Why a `repo-public` publication is not backed by a deliberate human review. Empty = it is.
 * Publishing an internal engineering asset needs the explicit `internal-tracer-accepted` review that
 * names its human reviewer (`reviewedBy`, a human-attestation field) and a genuinely valid time.
 * Nothing automated may fill these in: a script that sets them forges the attestation.
 * @param {Record<string, unknown>} asset
 * @returns {string[]}
 */
export function publicationReviewBlockers(asset) {
  /** @type {string[]} */
  const reasons = [];
  const review = isRecord(asset.review) ? asset.review : {};
  if (review.status !== "internal-tracer-accepted") reasons.push(`review status is ${JSON.stringify(review.status)} (needs "internal-tracer-accepted")`);
  if (!isAttestedReviewer(review.reviewedBy)) reasons.push("the review does not name its human reviewer (reviewedBy)");
  if (!isReviewTimestamp(review.reviewedAt)) reasons.push("the review does not record a valid review time (reviewedAt, ISO 8601 date-time)");
  return reasons;
}

/**
 * Why an asset is NOT production-eligible. Empty = eligible. Production needs every publication
 * condition, commercial use and modification explicitly `allowed`, and an attributed human approval.
 * Nothing here ever promotes an asset: `usage: "production"` is an authored claim this function checks.
 * @param {Record<string, unknown>} asset
 * @returns {string[]}
 */
export function productionBlockers(asset) {
  const reasons = publicationBlockers(asset);
  const rights = isRecord(asset.rights) ? asset.rights : {};
  const review = isRecord(asset.review) ? asset.review : {};
  if (rights.commercialUse !== "allowed") reasons.push(`commercialUse is ${JSON.stringify(rights.commercialUse)}`);
  if (rights.modification !== "allowed") reasons.push(`modification is ${JSON.stringify(rights.modification)}`);
  if (review.status !== "approved") reasons.push(`review status is ${JSON.stringify(review.status)}`);
  else if (!isAttestedReviewer(review.reviewedBy) || !isReviewTimestamp(review.reviewedAt)) reasons.push("the approval does not name a human reviewer and a review time");
  return reasons;
}

/**
 * @param {string} assetId
 * @param {unknown} kind
 * @param {unknown} artifact
 * @param {string} path
 * @param {(code: string, path: string, message: string) => void} fail
 */
function validateArtifact(assetId, kind, artifact, path, fail) {
  if (!isRecord(artifact)) return fail("invalid-artifact", path, "artifact must be an object or null");
  rejectUnexpected(artifact, ARTIFACT_KEYS, path, fail);
  const { sha256, bytes, format, storage } = artifact;
  if (typeof sha256 !== "string" || !ASSET_SHA256_PATTERN.test(sha256)) fail("invalid-artifact", `${path}.sha256`, "sha256 must be the full 64-char lowercase hex digest");
  if (!isNonNegativeInteger(bytes) || bytes === 0) fail("invalid-artifact", `${path}.bytes`, "bytes must be a positive integer");
  const formats = typeof kind === "string" && kind in ASSET_FORMATS ? ASSET_FORMATS[/** @type {keyof typeof ASSET_FORMATS} */ (kind)] : [];
  requireOneOf(format, formats, `${path}.format`, "invalid-artifact", fail);
  if (!isRecord(storage)) return fail("invalid-storage", `${path}.storage`, "storage must be an object { backend, objectKey }");
  rejectUnexpected(storage, STORAGE_KEYS, `${path}.storage`, fail);
  if (typeof storage.backend !== "string" || !storageBackend(storage.backend)) {
    return fail("unsupported-storage-backend", `${path}.storage.backend`, `storage backend ${JSON.stringify(storage.backend)} is not supported (supported: ${STORAGE_BACKENDS.join(", ")})`);
  }
  if (typeof sha256 === "string" && ASSET_SHA256_PATTERN.test(sha256) && typeof format === "string") {
    const expected = objectKeyFor(storage.backend, assetId, sha256, format);
    if (storage.objectKey !== expected) fail("invalid-object-key", `${path}.storage.objectKey`, `${storage.backend} object key must be the content-addressed "${expected}", got ${JSON.stringify(storage.objectKey)}`);
  }
}

/**
 * Every scene component that carries a runtime asset: any component with `assetRef`, and every
 * component whose type is an asset-bearing type (`model`) even without one (so a raw URL cannot slip
 * through).
 * @param {Record<string, Record<string, unknown>>} components
 * @returns {AssetComponent[]}
 */
export function assetBearingComponents(components) {
  /** @type {AssetComponent[]} */
  const found = [];
  for (const [componentId, component] of Object.entries(components)) {
    if ("assetRef" in component || (typeof component.type === "string" && component.type in ASSET_COMPONENT_KINDS)) found.push({ componentId, component });
  }
  return found;
}

/**
 * The rights / provenance gate for the assets the scene actually references.
 * `registry` must already have passed {@link validateAssetRegistry}.
 *
 * @param {{ components: Record<string, Record<string, unknown>>; registry: AssetRegistry | null }} input
 * @returns {{ errors: AssetIssue[]; warnings: AssetIssue[]; referencedAssetIds: string[] }}
 */
export function assetGate({ components, registry }) {
  /** @type {AssetIssue[]} */
  const errors = [];
  /** @type {AssetIssue[]} */
  const warnings = [];
  /** @type {Set<string>} */
  const referenced = new Set();

  for (const { componentId, component } of assetBearingComponents(components)) {
    const path = `scene.components.${componentId}`;
    const ref = component.assetRef;
    if (ref === undefined) {
      errors.push({ code: "unregistered-asset-url", path, message: `"${componentId}" is a ${String(component.type)} component without assetRef — runtime assets must be referenced through the asset registry, never by a raw URL` });
      continue;
    }
    if (!(typeof component.type === "string" && component.type in ASSET_COMPONENT_KINDS)) {
      errors.push({ code: "asset-ref-unsupported-component", path: `${path}.assetRef`, message: `"${componentId}" is a ${JSON.stringify(component.type)} component, which cannot carry a runtime asset (asset-bearing types: ${Object.keys(ASSET_COMPONENT_KINDS).join(", ")})` });
      continue;
    }
    if ("url" in component) errors.push({ code: "asset-ref-with-url", path: `${path}.url`, message: `"${componentId}" declares both assetRef and url — the URL is resolved from the registry at generate time` });
    if (typeof ref !== "string" || !ASSET_ID_PATTERN.test(ref)) {
      errors.push({ code: "invalid-asset-ref", path: `${path}.assetRef`, message: `assetRef ${JSON.stringify(ref)} is not an asset id (${ASSET_ID_PATTERN})` });
      continue;
    }
    if (registry === null) {
      errors.push({ code: "missing-asset-registry", path: `${path}.assetRef`, message: `"${componentId}" references ${ref} but the spatial config declares no assetRegistry` });
      continue;
    }
    const record = registry.assets[ref];
    if (!record) {
      errors.push({ code: "unknown-asset-ref", path: `${path}.assetRef`, message: `asset ${ref} is not registered` });
      continue;
    }
    const neededKind = typeof component.type === "string" ? ASSET_COMPONENT_KINDS[/** @type {keyof typeof ASSET_COMPONENT_KINDS} */ (component.type)] : undefined;
    if (neededKind !== undefined && record.kind !== neededKind) {
      errors.push({ code: "asset-kind-mismatch", path: `${path}.assetRef`, message: `${component.type} component "${componentId}" needs a ${neededKind} asset, ${ref} is a ${record.kind}` });
    }
    referenced.add(ref);
  }

  for (const assetId of [...referenced].sort()) {
    const record = /** @type {AssetRegistry} */ (registry).assets[assetId];
    const path = `registry.assets.${assetId}`;
    const revision = currentRevision(record);
    if (!revision || !revision.artifact) {
      errors.push({ code: "asset-missing-artifact", path: `${path}.revisions.${record.currentRevision}.artifact`, message: `${assetId} (${record.name}) is referenced but its current revision has no runtime artifact` });
    } else if (!isRuntimeResolvable(revision.artifact.storage.backend)) {
      // Registered and valid, but no runtime URL can be formed yet: refuse rather than generate a
      // chunk that points at bytes nobody serves.
      errors.push({ code: "asset-storage-unresolved", path: `${path}.revisions.${record.currentRevision}.artifact.storage.backend`, message: `${assetId} (${record.name}) is stored on "${revision.artifact.storage.backend}", whose runtime URL resolution is adapter-pending — it cannot be referenced by the runtime yet` });
    }
    if (record.rights.webRuntimeRedistribution === "prohibited") {
      errors.push({ code: "asset-redistribution-prohibited", path: `${path}.rights.webRuntimeRedistribution`, message: `${assetId} (${record.name}) may not be redistributed in a web runtime` });
    }
    const unresolvedDependencies = record.provenance.dependencies.filter((d) => d.status === "unresolved");
    if (record.review.status === "rejected") {
      errors.push({ code: "asset-review-rejected", path: `${path}.review.status`, message: `${assetId} (${record.name}) was rejected in review` });
    }
    if (record.rights.status === "restricted") {
      errors.push({ code: "asset-rights-restricted", path: `${path}.rights.status`, message: `${assetId} (${record.name}) has restricted rights and may not be referenced by the runtime` });
    }
    if (record.usage === "production") {
      const reasons = productionBlockers(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (record)));
      if (reasons.length) {
        errors.push({ code: "asset-production-unresolved", path, message: `${assetId} (${record.name}) is marked production but ${reasons.join("; ")}` });
      }
    } else {
      // Internal tracer: an explicit, recorded acceptance for engineering use — never implied.
      if (record.review.status !== "internal-tracer-accepted") {
        errors.push({ code: "asset-internal-tracer-unaccepted", path: `${path}.review.status`, message: `${assetId} (${record.name}) is an internal tracer but its review status is "${record.review.status}" (needs "internal-tracer-accepted")` });
      }
      /** @type {string[]} */
      const open = [];
      if (record.rights.status !== "cleared") open.push(`rights ${record.rights.status}`);
      if (unresolvedDependencies.length) open.push(`unresolved: ${unresolvedDependencies.map((d) => d.id).join(", ")}`);
      warnings.push({ code: "asset-internal-tracer", path, message: `${assetId} (${record.name}) ships as INTERNAL TRACER ONLY${open.length ? ` — ${open.join("; ")}` : ""}; not production-cleared` });
    }
  }
  return { errors, warnings, referencedAssetIds: [...referenced].sort() };
}

/**
 * M1 EXPERIMENTAL warning bands for referenced assets (investigation triggers only).
 * @param {AssetRegistry} registry
 * @param {string[]} assetIds
 * @returns {AssetIssue[]}
 */
export function assetExperimentalWarnings(registry, assetIds) {
  /** @type {AssetIssue[]} */
  const warnings = [];
  const bands = M1_EXPERIMENTAL_ASSET_WARNINGS;
  for (const assetId of assetIds) {
    const record = registry.assets[assetId];
    const revision = record ? currentRevision(record) : null;
    if (!record || !revision || !revision.artifact) continue;
    const path = `registry.assets.${assetId}.revisions.${record.currentRevision}`;
    const { bytes } = revision.artifact;
    if (bytes > bands.artifactBytes) warnings.push({ code: "m1-asset-bytes", path, message: `${assetId}: ${bytes} bytes exceeds the M1 experimental warning band of ${bands.artifactBytes} bytes` });
    const stats = revision.stats ?? null;
    if (stats && typeof stats.maxTextureDimension === "number" && stats.maxTextureDimension > bands.maxTextureDimension) {
      warnings.push({ code: "m1-texture-dimension", path, message: `${assetId}: largest texture edge ${stats.maxTextureDimension}px exceeds the M1 experimental warning band of ${bands.maxTextureDimension}px` });
    }
    if (stats && typeof stats.triangles === "number" && stats.triangles > bands.triangles) {
      warnings.push({ code: "m1-triangles", path, message: `${assetId}: ${stats.triangles} triangles exceeds the M1 experimental warning band of ${bands.triangles}` });
    }
    const pipeline = isRecord(revision.pipeline) ? revision.pipeline : null;
    if (pipeline && pipeline.optimization !== "optimized") {
      warnings.push({ code: "m1-unoptimized", path, message: `${assetId}: runtime artifact is not optimized (${JSON.stringify(pipeline.optimization ?? "unknown")}) — pending the generic AWE optimizer (H1)` });
    }
  }
  return warnings;
}

/**
 * Resolve every `assetRef` to the current revision's runtime URL. Returns NEW component objects
 * (`assetRef` removed, `url` set) and leaves every other component untouched. Throws on an
 * unresolvable reference; callers run {@link assetGate} first.
 *
 * @param {Record<string, Record<string, unknown>>} components
 * @param {AssetRegistry | null} registry
 * @returns {Record<string, Record<string, unknown>>}
 */
export function resolveAssetRefs(components, registry) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const [componentId, component] of Object.entries(components)) {
    if (!("assetRef" in component)) {
      out[componentId] = component;
      continue;
    }
    const assetId = String(component.assetRef);
    const record = registry?.assets[assetId];
    const revision = record ? currentRevision(record) : null;
    if (!revision || !revision.artifact) throw new Error(`cannot resolve assetRef ${assetId} of "${componentId}"`);
    /** @type {Record<string, unknown>} */
    const resolved = {};
    for (const [key, value] of Object.entries(component)) {
      if (key === "assetRef") resolved.url = runtimeAssetUrl(revision.artifact.storage);
      else resolved[key] = value;
    }
    out[componentId] = resolved;
  }
  return out;
}

/**
 * Duplicate object keys in raw JSON text. `JSON.parse` silently keeps the LAST duplicate, so a registry
 * that declares the same asset id (or revision) twice cannot be detected after parsing; the registry
 * read boundary (`cli.mjs`) runs this on the raw text first. A small scanner, not a parser: it assumes
 * the text is otherwise valid JSON (`JSON.parse` reports syntax errors).
 * @param {string} text
 * @returns {string[]} JSON-pointer-like paths of every repeated key, e.g. `/assets/ast_…`
 */
export function findDuplicateJsonKeys(text) {
  /** @type {string[]} */
  const duplicates = [];
  /** @type {Array<{ keys: Set<string> | null; path: string; pending: string | null }>} one frame per open object / array */
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const value = /** @type {string} */ (JSON.parse(text.slice(i, j + 1)));
      i = j + 1;
      let k = i;
      while (k < text.length && /\s/.test(text[k])) k++;
      const top = stack[stack.length - 1];
      if (text[k] === ":" && top && top.keys) {
        if (top.keys.has(value)) duplicates.push(`${top.path}/${value}`);
        top.keys.add(value);
        top.pending = value;
      }
      continue;
    }
    if (ch === "{" || ch === "[") {
      const parent = stack[stack.length - 1];
      const path = parent ? `${parent.path}/${parent.keys ? parent.pending ?? "" : "#"}` : "";
      stack.push({ keys: ch === "{" ? new Set() : null, path, pending: null });
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
    i++;
  }
  return duplicates;
}

/**
 * Human-readable issue list.
 * @param {AssetIssue[]} issues
 */
export function formatAssetIssues(issues) {
  return issues.map((i) => `[${i.code}] ${i.path}: ${i.message}`).join("\n");
}
