// @ts-check
/**
 * Provider-neutral storage contract for runtime asset bytes (M1.1). Pure, dependency-free.
 *
 * The registry records WHERE an artifact's bytes live as `storage: { backend, objectKey }` — a logical
 * backend name and a content-addressed key, never a URL, a bucket name or a credential. This module
 * owns, per backend, everything the registry and the generator may assume:
 *
 * - the ONE content-addressed object key the validator accepts (`objectKeyFor`, exact match);
 * - whether storing there is a publication in the public Git repository, and whether production art
 *   may use it;
 * - how a runtime URL is resolved at generate time (deterministic, environment-independent);
 * - whether the backend is implemented or still adapter-pending.
 *
 * Moving bytes, verifying them and talking to a provider is I/O behind the {@link StorageAdapter}
 * boundary (`scripts/asset-pipeline/`); nothing here performs I/O. Choosing a provider later
 * (S3-compatible, a CDN origin, …) means implementing an adapter and fixing the backend's public base
 * — never reshaping the registry, re-keying objects or changing an `assetId`.
 */

/** A `repo-public` object key: `assets/art/<assetId>.<first 32 hex of sha256>.<format>`. */
export const REPO_PUBLIC_OBJECT_KEY = /^assets\/art\/(ast_[0-9abcdefghjkmnpqrstvwxyz]{16})\.([0-9a-f]{32})\.(glb)$/;
/** `repo-public` object keys live under `public/assets/art/` and are served from `/assets/art/`. */
export const REPO_PUBLIC_ART_PREFIX = "assets/art";
/** An `external-cas` object key: `art/<assetId>/<full 64-hex sha256>.<format>` (write-once). */
export const EXTERNAL_CAS_OBJECT_KEY = /^art\/(ast_[0-9abcdefghjkmnpqrstvwxyz]{16})\/([0-9a-f]{64})\.(glb)$/;
/** Length of the digest prefix embedded in `repo-public` keys (matches the spatial content-version token). */
export const ASSET_OBJECT_TOKEN_LENGTH = 32;

/**
 * @typedef {"implemented" | "adapter-pending"} StorageBackendStatus
 * @typedef {{ publicOrigin?: string }} StorageBackendConfig
 * @typedef {Record<string, StorageBackendConfig>} AssetStorageConfig
 *   Committed, NON-SECRET per-backend configuration (the spatial config's `assetStorage`): today only
 *   `external-cas.publicOrigin`. Credentials never live here.
 * @typedef {{
 *   status: StorageBackendStatus;
 *   publishesToGit: boolean;
 *   allowsProduction: boolean;
 *   requiresPublicOrigin: boolean;
 *   adapters: readonly string[];
 *   keyPattern: RegExp;
 *   objectKey: (assetId: string, sha256: string, format: string) => string;
 *   runtimeUrl: (objectKey: string, config: StorageBackendConfig | undefined) => string;
 *   description: string;
 * }} StorageBackendContract
 */

/** @type {Readonly<Record<string, Readonly<StorageBackendContract>>>} */
export const STORAGE_BACKEND_CONTRACTS = Object.freeze({
  "repo-public": Object.freeze({
    status: "implemented",
    publishesToGit: true,
    allowsProduction: false,
    requiresPublicOrigin: false,
    adapters: Object.freeze(["repository"]),
    keyPattern: REPO_PUBLIC_OBJECT_KEY,
    objectKey: /** @type {StorageBackendContract["objectKey"]} */ ((assetId, sha256, format) => `${REPO_PUBLIC_ART_PREFIX}/${assetId}.${sha256.slice(0, ASSET_OBJECT_TOKEN_LENGTH)}.${format}`),
    runtimeUrl: /** @type {StorageBackendContract["runtimeUrl"]} */ ((objectKey) => `/${objectKey}`),
    description: "the app's public/ directory in the public repository — cleared internal engineering assets only",
  }),
  "external-cas": Object.freeze({
    status: "implemented",
    publishesToGit: false,
    allowsProduction: true,
    requiresPublicOrigin: true,
    // Concrete adapters behind this logical backend. The registry never names one.
    adapters: Object.freeze(["cloudflare-r2"]),
    keyPattern: EXTERNAL_CAS_OBJECT_KEY,
    objectKey: /** @type {StorageBackendContract["objectKey"]} */ ((assetId, sha256, format) => `art/${assetId}/${sha256}.${format}`),
    // Runtime URL = `<committed public origin>/<objectKey>`. No origin configured → refused (fail
    // closed): nothing can generate a chunk that points at bytes nobody serves.
    runtimeUrl: /** @type {StorageBackendContract["runtimeUrl"]} */ ((objectKey, config) => {
      const origin = validatePublicOrigin(config?.publicOrigin);
      if (!origin.ok) throw new Error(`external-cas runtime URL needs a configured public origin: ${origin.problem}`);
      return `${origin.origin}/${objectKey}`;
    }),
    description: "provider-neutral external content-addressed store for production art (first adapter: Cloudflare R2)",
  }),
});

/** Every backend the registry may name. */
export const STORAGE_BACKENDS = Object.freeze(Object.keys(STORAGE_BACKEND_CONTRACTS));

/**
 * @param {string} backend
 * @returns {Readonly<StorageBackendContract> | null}
 */
export function storageBackend(backend) {
  return Object.hasOwn(STORAGE_BACKEND_CONTRACTS, backend) ? STORAGE_BACKEND_CONTRACTS[backend] : null;
}

/**
 * The content-addressed object key an artifact must use on `backend`.
 * @param {string} backend
 * @param {string} assetId
 * @param {string} sha256 full lowercase hex digest
 * @param {string} format
 */
export function objectKeyFor(backend, assetId, sha256, format) {
  const contract = storageBackend(backend);
  if (!contract) throw new Error(`unsupported storage backend ${JSON.stringify(backend)}`);
  return contract.objectKey(assetId, sha256, format);
}

/**
 * A public runtime origin: `https://<host>` exactly — no path, query, fragment, credentials, port or
 * trailing slash, and never a `*.r2.dev` development URL (production art is served from a custom
 * domain with a cache rule, docs/NRVNAVERSE_R2_STORAGE.md).
 * @param {unknown} value
 * @returns {{ ok: true; origin: string; problem: null } | { ok: false; origin: null; problem: string }}
 */
export function validatePublicOrigin(value) {
  const bad = (/** @type {string} */ problem) => /** @type {const} */ ({ ok: false, origin: null, problem });
  if (value === undefined || value === null || value === "") return bad("no public origin is configured");
  if (typeof value !== "string") return bad(`public origin must be a string, got ${typeof value}`);
  let url;
  try {
    url = new URL(value);
  } catch {
    return bad(`${JSON.stringify(value)} is not a URL`);
  }
  if (url.protocol !== "https:") return bad(`${JSON.stringify(value)} must use https`);
  if (url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/" || value.endsWith("/")) {
    return bad(`${JSON.stringify(value)} must be a bare origin like https://assets.example.com (no path, query, port, credentials or trailing slash)`);
  }
  if (url.hostname === "r2.dev" || url.hostname.endsWith(".r2.dev")) return bad(`${JSON.stringify(value)} is an r2.dev development URL; production art uses a custom domain`);
  if (url.origin !== value) return bad(`${JSON.stringify(value)} is not in canonical form (${url.origin})`);
  return { ok: true, origin: url.origin, problem: null };
}

/**
 * Why a runtime URL cannot be resolved for `backend` with this configuration; null = it can.
 * @param {string} backend
 * @param {AssetStorageConfig | null | undefined} [storageConfig]
 * @returns {string | null}
 */
export function runtimeResolutionProblem(backend, storageConfig) {
  const contract = storageBackend(backend);
  if (!contract) return `unsupported storage backend ${JSON.stringify(backend)}`;
  if (!contract.requiresPublicOrigin) return null;
  const origin = validatePublicOrigin(storageConfig?.[backend]?.publicOrigin);
  return origin.ok ? null : origin.problem;
}

/**
 * Whether a runtime URL can be resolved for this backend with this configuration.
 * @param {string} backend
 * @param {AssetStorageConfig | null | undefined} [storageConfig]
 */
export function isRuntimeResolvable(backend, storageConfig) {
  return runtimeResolutionProblem(backend, storageConfig) === null;
}

/**
 * Runtime URL for a stored artifact. Storage decides the URL; identity never does. Throws (fails
 * closed) for an unknown backend and for a backend whose public origin is not configured.
 * @param {{ backend: string; objectKey: string }} storage
 * @param {AssetStorageConfig | null | undefined} [storageConfig]
 */
export function runtimeAssetUrl(storage, storageConfig) {
  const contract = storageBackend(storage.backend);
  if (!contract) throw new Error(`unsupported storage backend ${JSON.stringify(storage.backend)}`);
  return contract.runtimeUrl(storage.objectKey, storageConfig?.[storage.backend]);
}

/**
 * Structural validation of a committed `assetStorage` block. Returns problems (empty = valid).
 * @param {unknown} value
 * @returns {Array<{ path: string; message: string }>}
 */
export function validateAssetStorageConfig(value) {
  /** @type {Array<{ path: string; message: string }>} */
  const problems = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [{ path: "config.assetStorage", message: "assetStorage must be an object keyed by storage backend" }];
  for (const [backend, cfg] of Object.entries(value)) {
    const path = `config.assetStorage.${backend}`;
    const contract = storageBackend(backend);
    if (!contract) {
      problems.push({ path, message: `unsupported storage backend ${JSON.stringify(backend)}` });
      continue;
    }
    if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
      problems.push({ path, message: "backend configuration must be an object" });
      continue;
    }
    for (const key of Object.keys(cfg)) {
      if (key !== "publicOrigin" || !contract.requiresPublicOrigin) problems.push({ path: `${path}.${key}`, message: `unexpected field "${key}" (credentials and bucket names never belong in committed config)` });
    }
    if (contract.requiresPublicOrigin) {
      const origin = validatePublicOrigin(/** @type {Record<string, unknown>} */ (cfg).publicOrigin);
      if (!origin.ok) problems.push({ path: `${path}.publicOrigin`, message: origin.problem });
    }
  }
  return problems;
}

/**
 * The I/O boundary every storage provider implements (upload tooling, never the runtime). Objects
 * are WRITE-ONCE: `put` of identical bytes to an existing key is a no-op, different bytes are an
 * error. `verify` re-reads the stored object and checks size + full SHA-256 — the registry revision
 * is committed only after a successful verify.
 *
 * @typedef {{
 *   backend: string;
 *   put(objectKey: string, bytes: Uint8Array, meta: { sha256: string; contentType: string }): Promise<{ created: boolean; location: string }>;
 *   verify(objectKey: string, expected: { sha256: string; bytes: number }): Promise<{ ok: boolean; problem: string | null }>;
 * }} StorageAdapter
 */

/** Content type per artifact format. */
export const ARTIFACT_CONTENT_TYPES = Object.freeze({ glb: "model/gltf-binary" });

/** Cache-Control for content-addressed, write-once runtime objects (same value as the spatial chunks). */
export const IMMUTABLE_OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";
