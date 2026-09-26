/**
 * NRVNAVerse production-asset publication (M1.1 S1): a READY prepare report + its staged object in,
 * a write-once, remotely verified `external-cas` object + a publication report out.
 *
 *   asset:prepare → staged, verified object → asset:publish → conditional put / idempotent existing
 *     → full re-download + SHA-256 → publication report
 *
 * The prepare report is not trusted on its word: the policy (registry schema, production
 * eligibility, key ↔ digest, staged bytes) is re-evaluated here, and an ineligible artifact is refused
 * BEFORE any storage call. Publication never creates or changes a review or rights metadata, never
 * edits the committed registry or a scene, never deploys and never touches DNS — the registry
 * revision in the report is committed by a human afterwards.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { productionBlockers, validateAssetRegistry, type AssetRecord } from "../spatial/assets.mjs";
import { EXTERNAL_CAS_OBJECT_KEY, objectKeyFor, runtimeAssetUrl, validatePublicOrigin } from "../spatial/storage.mjs";
import { PublishError, objectHeadersFor, publishObject, type RemoteVerification } from "./external-cas-adapter";
import type { PrepareReport } from "./prepare-asset";
import { describeR2Config, readR2Config, r2Transport, type R2Config } from "./r2-config";
import type { ObjectTransport } from "./s3-transport";

export const PUBLISH_REPORT_VERSION = 1;

export interface PublishIssue {
  code: string;
  message: string;
}

export interface PublishPlan {
  assetId: string;
  revision: number;
  backend: "external-cas";
  adapter: "cloudflare-r2";
  objectKey: string;
  bytes: number;
  sha256: string;
  headers: { contentType: string; cacheControl: string; metadata: Record<string, string> };
  target: Record<string, string>;
  runtimeUrl: string | null;
  operations: string[];
}

export interface PublishReport {
  kind: "nrvnaverse-asset-publish";
  reportVersion: number;
  mode: "dry-run" | "publish";
  status: "planned" | "published" | "already-published" | "blocked" | "failed";
  plan: PublishPlan | null;
  verification: RemoteVerification | null;
  blockers: PublishIssue[];
  failure: PublishIssue | null;
  /** The registry revision to commit (unchanged from the prepare proposal). Never applied here. */
  registryRevision: { assetId: string; revision: number; record: AssetRecord } | null;
  next: string[];
}

export interface PublishOptions {
  env: Record<string, string | undefined>;
  dryRun: boolean;
  /** The committed `config.assetStorage` (public origin consistency). */
  committedStorage?: Record<string, { publicOrigin?: string }> | null;
  /** Injected in tests; defaults to the R2 S3-compatible transport. */
  transportFor?: (config: R2Config) => ObjectTransport;
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Staging root of a prepare report written by `asset:prepare` (`<out>/prepared/<file>.json`). */
export const stagingRootOf = (reportPath: string) => dirname(dirname(reportPath));

/** Everything publication would do, and every reason it must not — without any network call. */
export function planPublication(report: unknown, stagingRoot: string, options: Pick<PublishOptions, "env" | "dryRun" | "committedStorage">): {
  blockers: PublishIssue[];
  plan: PublishPlan | null;
  body: Uint8Array | null;
  registryRevision: PublishReport["registryRevision"];
} {
  const blockers: PublishIssue[] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  const r = report as Partial<PrepareReport> | null;
  if (!r || r.kind !== "nrvnaverse-asset-prepare" || r.reportVersion !== 1) {
    block("invalid-prepare-report", "not an asset:prepare report (kind nrvnaverse-asset-prepare, reportVersion 1)");
    return { blockers, plan: null, body: null, registryRevision: null };
  }
  if (r.status !== "ready" || (r.blockers?.length ?? 0) > 0) block("prepare-not-ready", `the prepare report is ${JSON.stringify(r.status)} with ${r.blockers?.length ?? 0} blocker(s)`);
  const artifact = r.artifact;
  const proposal = r.registryProposal;
  if (!artifact || !proposal || !r.assetId || !r.revision) {
    block("prepare-incomplete", "the prepare report has no artifact or registry proposal");
    return { blockers, plan: null, body: null, registryRevision: null };
  }

  // Identity, key and digest agree.
  if (artifact.storage.backend !== "external-cas") block("wrong-backend", `artifact backend is ${JSON.stringify(artifact.storage.backend)}; only external-cas is published`);
  const expectedKey = objectKeyFor("external-cas", r.assetId, artifact.sha256, artifact.format);
  if (artifact.storage.objectKey !== expectedKey || !EXTERNAL_CAS_OBJECT_KEY.test(artifact.storage.objectKey)) block("invalid-object-key", `object key must be ${expectedKey}`);
  const record = proposal.record;
  const revisionEntry = record?.revisions?.[String(r.revision)];
  const recorded = revisionEntry?.artifact;
  if (proposal.assetId !== r.assetId || proposal.revision !== r.revision || !recorded || recorded.sha256 !== artifact.sha256 || recorded.bytes !== artifact.bytes || recorded.storage?.objectKey !== artifact.storage.objectKey) {
    block("proposal-mismatch", "the registry proposal does not describe this artifact");
  }

  // NRVNAVerse policy, re-evaluated: production art only, every production condition met.
  const schema = validateAssetRegistry({ schemaVersion: 1, assets: { [r.assetId]: record } });
  for (const e of schema) block("registry-invalid", `[${e.code}] ${e.path}: ${e.message}`);
  if (record?.usage !== "production") block("not-production", `usage is ${JSON.stringify(record?.usage)}; only production art is published to external storage`);
  else {
    const reasons = productionBlockers(record as unknown as Record<string, unknown>);
    if (reasons.length) block("not-production-eligible", reasons.join("; "));
  }

  // The staged bytes are exactly the artifact.
  const stagedPath = join(stagingRoot, "objects", ...artifact.storage.objectKey.split("/"));
  let body: Uint8Array | null = null;
  if (!existsSync(stagedPath)) block("staged-object-missing", `no staged object at objects/${artifact.storage.objectKey} (run asset:prepare with the same --out)`);
  else {
    body = new Uint8Array(readFileSync(stagedPath));
    if (body.byteLength !== artifact.bytes || sha256Hex(body) !== artifact.sha256) {
      block("staged-object-mismatch", "the staged object does not match the artifact size / sha256");
      body = null;
    }
  }

  // Configuration (credentials only reported present / missing on a dry run).
  const cfg = readR2Config(options.env, { requireCredentials: !options.dryRun });
  for (const p of cfg.problems) block("storage-config", p);
  const committedOrigin = options.committedStorage?.["external-cas"]?.publicOrigin;
  const envOrigin = validatePublicOrigin(options.env.NRVNA_ASSET_PUBLIC_ORIGIN?.trim() || undefined);
  if (committedOrigin !== undefined && envOrigin.ok && envOrigin.origin !== committedOrigin) {
    block("public-origin-mismatch", `NRVNA_ASSET_PUBLIC_ORIGIN (${envOrigin.origin}) differs from the committed config.assetStorage origin (${committedOrigin})`);
  }

  const headers = objectHeadersFor({ objectKey: artifact.storage.objectKey, sha256: artifact.sha256, bytes: artifact.bytes, contentType: artifact.contentType });
  const runtimeUrl = envOrigin.ok ? runtimeAssetUrl(artifact.storage, { "external-cas": { publicOrigin: envOrigin.origin } }) : null;
  const plan: PublishPlan = {
    assetId: r.assetId,
    revision: r.revision,
    backend: "external-cas",
    adapter: "cloudflare-r2",
    objectKey: artifact.storage.objectKey,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    headers,
    target: describeR2Config(options.env),
    runtimeUrl,
    operations: [
      `HEAD ${artifact.storage.objectKey}`,
      `if absent: PUT ${artifact.storage.objectKey} (If-None-Match: *, ${artifact.bytes} bytes, Content-Type ${headers.contentType}, Cache-Control ${headers.cacheControl})`,
      "if present (or the conditional PUT reports 412): never overwrite — verify it is exactly this artifact",
      `GET ${artifact.storage.objectKey} → verify size ${artifact.bytes} + sha256 ${artifact.sha256} + headers`,
    ],
  };
  return { blockers, plan, body, registryRevision: { assetId: r.assetId, revision: r.revision, record } };
}

/** Plan, then (unless dry-run or blocked) publish write-once and verify. */
export async function publishPrepared(report: unknown, stagingRoot: string, options: PublishOptions): Promise<PublishReport> {
  const { blockers, plan, body, registryRevision } = planPublication(report, stagingRoot, options);
  const base = { kind: "nrvnaverse-asset-publish" as const, reportVersion: PUBLISH_REPORT_VERSION, mode: options.dryRun ? ("dry-run" as const) : ("publish" as const), plan, blockers, registryRevision };
  const commitNext = registryRevision
    ? [
        `commit the registry record + revision ${registryRevision.revision} for ${registryRevision.assetId} (from this report) to the committed asset registry`,
        "reference it with assetRef, then spatial:generate / spatial:check and a browser smoke against the public origin",
      ]
    : [];

  if (blockers.length) return { ...base, status: "blocked", verification: null, failure: null, next: ["resolve every blocker; nothing was sent to storage"] };
  if (options.dryRun) return { ...base, status: "planned", verification: null, failure: null, next: ["run again without --dry-run to publish", ...commitNext] };

  const cfg = readR2Config(options.env);
  if (!cfg.ok || !plan || !body) return { ...base, status: "blocked", verification: null, failure: null, next: [] };
  const transport = (options.transportFor ?? ((c) => r2Transport(c)))(cfg.config);
  try {
    const outcome = await publishObject(transport, { objectKey: plan.objectKey, sha256: plan.sha256, bytes: plan.bytes, contentType: plan.headers.contentType }, body);
    return { ...base, status: outcome.status === "created" ? "published" : "already-published", verification: outcome.verification, failure: null, next: commitNext };
  } catch (error) {
    const failure = error instanceof PublishError ? { code: error.code, message: error.message } : { code: "transport", message: (error as Error).message };
    return { ...base, status: "failed", verification: null, failure, next: ["investigate; the object was never overwritten and nothing was committed"] };
  }
}
