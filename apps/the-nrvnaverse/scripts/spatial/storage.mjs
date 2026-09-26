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
 * @typedef {{
 *   status: StorageBackendStatus;
 *   publishesToGit: boolean;
 *   allowsProduction: boolean;
 *   keyPattern: RegExp;
 *   objectKey: (assetId: string, sha256: string, format: string) => string;
 *   runtimeUrl: ((objectKey: string) => string) | null;
 *   description: string;
 * }} StorageBackendContract
 */

/** @type {Readonly<Record<string, Readonly<StorageBackendContract>>>} */
export const STORAGE_BACKEND_CONTRACTS = Object.freeze({
  "repo-public": Object.freeze({
    status: "implemented",
    publishesToGit: true,
    allowsProduction: false,
    keyPattern: REPO_PUBLIC_OBJECT_KEY,
    objectKey: /** @type {StorageBackendContract["objectKey"]} */ ((assetId, sha256, format) => `${REPO_PUBLIC_ART_PREFIX}/${assetId}.${sha256.slice(0, ASSET_OBJECT_TOKEN_LENGTH)}.${format}`),
    runtimeUrl: /** @type {(objectKey: string) => string} */ ((objectKey) => `/${objectKey}`),
    description: "the app's public/ directory in the public repository — cleared internal engineering assets only",
  }),
  "external-cas": Object.freeze({
    status: "adapter-pending",
    publishesToGit: false,
    allowsProduction: true,
    keyPattern: EXTERNAL_CAS_OBJECT_KEY,
    objectKey: /** @type {StorageBackendContract["objectKey"]} */ ((assetId, sha256, format) => `art/${assetId}/${sha256}.${format}`),
    // Runtime URL = `<one committed, non-secret public base for this backend>/<objectKey>`. The base
    // (a same-origin path mapped by hosting, or a CDN origin) is not chosen yet, so resolution is
    // refused rather than guessed: nothing can generate a chunk that points at bytes nobody serves.
    runtimeUrl: null,
    description: "provider-neutral external content-addressed store for production art (provider not chosen)",
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
 * Whether a runtime URL can be resolved for this backend today.
 * @param {string} backend
 */
export function isRuntimeResolvable(backend) {
  return storageBackend(backend)?.runtimeUrl != null;
}

/**
 * Runtime URL for a stored artifact. Storage decides the URL; identity never does. Throws for an
 * unknown backend and for one whose runtime resolution is adapter-pending.
 * @param {{ backend: string; objectKey: string }} storage
 */
export function runtimeAssetUrl(storage) {
  const contract = storageBackend(storage.backend);
  if (!contract) throw new Error(`unsupported storage backend ${JSON.stringify(storage.backend)}`);
  if (!contract.runtimeUrl) throw new Error(`storage backend ${JSON.stringify(storage.backend)} has no runtime URL resolver yet (adapter pending)`);
  return contract.runtimeUrl(storage.objectKey);
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
