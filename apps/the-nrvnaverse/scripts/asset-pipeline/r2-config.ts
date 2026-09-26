/**
 * Cloudflare R2 — the first concrete adapter behind the provider-neutral `external-cas` backend.
 *
 * Everything R2-specific lives here: the environment contract, the S3 API endpoint
 * (`https://<account>.r2.cloudflarestorage.com`, region `auto`) and validation. The registry, the
 * object keys and the runtime URL contract know nothing about R2 (docs/NRVNAVERSE_R2_STORAGE.md).
 *
 * Configuration comes from the environment only. Secrets are never logged, never written into a
 * report and never committed: {@link describeR2Config} is the only form that leaves this module.
 */
import { validatePublicOrigin } from "../spatial/storage.mjs";
import { s3Transport, type ObjectTransport } from "./s3-transport";

export const R2_ENV = Object.freeze({
  accountId: "NRVNA_ASSET_R2_ACCOUNT_ID",
  bucket: "NRVNA_ASSET_R2_BUCKET",
  accessKeyId: "NRVNA_ASSET_R2_ACCESS_KEY_ID",
  secretAccessKey: "NRVNA_ASSET_R2_SECRET_ACCESS_KEY",
  publicOrigin: "NRVNA_ASSET_PUBLIC_ORIGIN",
});

/** Documented production value of {@link R2_ENV.publicOrigin} (not a default: it must be set). */
export const PRODUCTION_PUBLIC_ORIGIN = "https://assets.nrvnaverse.com";

export interface R2Config {
  accountId: string;
  bucket: string;
  endpoint: string;
  region: "auto";
  accessKeyId: string;
  secretAccessKey: string;
  publicOrigin: string;
}

export type R2ConfigResult = { ok: true; config: R2Config; problems: [] } | { ok: false; config: null; problems: string[] };

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** S3 bucket naming rules as R2 applies them: 3–63 chars, lower-case letters, digits, hyphens. */
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * Read and validate the R2 configuration. Problems name the variable, never its value.
 * @param env usually `process.env`
 * @param options.requireCredentials false for a dry run (credentials are then only reported present / missing)
 */
export function readR2Config(env: Record<string, string | undefined>, options: { requireCredentials?: boolean } = {}): R2ConfigResult {
  const requireCredentials = options.requireCredentials ?? true;
  const problems: string[] = [];
  const get = (name: string) => {
    const v = env[name];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const accountId = get(R2_ENV.accountId);
  const bucket = get(R2_ENV.bucket);
  const accessKeyId = get(R2_ENV.accessKeyId);
  const secretAccessKey = get(R2_ENV.secretAccessKey);
  const origin = validatePublicOrigin(get(R2_ENV.publicOrigin) ?? undefined);

  if (!accountId) problems.push(`${R2_ENV.accountId} is not set`);
  else if (!ACCOUNT_ID.test(accountId)) problems.push(`${R2_ENV.accountId} must be the 32-character lower-case hex Cloudflare account id`);
  if (!bucket) problems.push(`${R2_ENV.bucket} is not set`);
  else if (!BUCKET.test(bucket)) problems.push(`${R2_ENV.bucket} is not a valid bucket name (3-63 lower-case letters, digits, hyphens)`);
  if (requireCredentials) {
    if (!accessKeyId) problems.push(`${R2_ENV.accessKeyId} is not set`);
    else if (/\s/.test(accessKeyId)) problems.push(`${R2_ENV.accessKeyId} contains whitespace`);
    if (!secretAccessKey) problems.push(`${R2_ENV.secretAccessKey} is not set`);
  }
  if (!origin.ok) problems.push(`${R2_ENV.publicOrigin}: ${origin.problem}`);

  if (problems.length) return { ok: false, config: null, problems };
  return {
    ok: true,
    problems: [],
    config: {
      accountId: accountId!,
      bucket: bucket!,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      accessKeyId: accessKeyId ?? "",
      secretAccessKey: secretAccessKey ?? "",
      publicOrigin: origin.origin!,
    },
  };
}

/** The non-secret view of a configuration, safe for logs and reports. */
export function describeR2Config(env: Record<string, string | undefined>): Record<string, string> {
  const present = (name: string) => (env[name] && env[name]!.trim() ? "set" : "missing");
  return {
    adapter: "cloudflare-r2",
    [R2_ENV.accountId]: env[R2_ENV.accountId]?.trim() || "missing",
    [R2_ENV.bucket]: env[R2_ENV.bucket]?.trim() || "missing",
    [R2_ENV.accessKeyId]: present(R2_ENV.accessKeyId),
    [R2_ENV.secretAccessKey]: present(R2_ENV.secretAccessKey),
    [R2_ENV.publicOrigin]: env[R2_ENV.publicOrigin]?.trim() || "missing",
  };
}

/** The S3-compatible transport for a validated R2 configuration. */
export function r2Transport(config: R2Config, inject: { fetch?: typeof fetch; now?: () => Date } = {}): ObjectTransport {
  return s3Transport({
    endpoint: config.endpoint,
    bucket: config.bucket,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    ...inject,
  });
}
