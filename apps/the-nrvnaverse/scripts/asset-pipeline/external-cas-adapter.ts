/**
 * Write-once, verified publication to the `external-cas` backend over any {@link ObjectTransport}.
 *
 * Semantics (docs/NRVNAVERSE_R2_STORAGE.md):
 * - object absent  → conditional create (`If-None-Match: *`), then verify;
 * - object present → verify it is EXACTLY the expected artifact (bytes, full SHA-256, Content-Type,
 *   Cache-Control): an exact match is idempotent success, anything else FAILS HARD. There is no
 *   overwrite path — no unconditional PUT is ever issued;
 * - verification re-downloads the whole object and re-hashes it locally. An S3 / R2 ETag is never
 *   treated as a SHA-256 (multipart ETags are not content digests at all).
 *
 * Object metadata (`sha256`, `asset-id`) is informational; the registry stays the source of truth.
 */
import { createHash } from "node:crypto";

import { ARTIFACT_CONTENT_TYPES, EXTERNAL_CAS_OBJECT_KEY, IMMUTABLE_OBJECT_CACHE_CONTROL, type StorageAdapter } from "../spatial/storage.mjs";
import type { ObjectTransport } from "./s3-transport";

export type PublishErrorCode = "invalid-artifact" | "conflict" | "metadata-mismatch" | "verify-failed" | "transport";

export class PublishError extends Error {
  constructor(
    readonly code: PublishErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublishableArtifact {
  objectKey: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface RemoteVerification {
  method: "full-object-get-sha256";
  bytes: number;
  sha256: string;
  contentType: string | null;
  cacheControl: string | null;
}

export interface PublishOutcome {
  status: "created" | "already-present";
  verification: RemoteVerification;
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The object headers every published artifact carries. */
export function objectHeadersFor(artifact: PublishableArtifact): { contentType: string; cacheControl: string; metadata: Record<string, string> } {
  const assetId = EXTERNAL_CAS_OBJECT_KEY.exec(artifact.objectKey)?.[1] ?? "";
  return { contentType: artifact.contentType, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, metadata: { sha256: artifact.sha256, "asset-id": assetId } };
}

/** Local preconditions: a well-formed content-addressed key whose digest IS these bytes. */
export function checkPublishable(artifact: PublishableArtifact, body: Uint8Array): string[] {
  const problems: string[] = [];
  const m = EXTERNAL_CAS_OBJECT_KEY.exec(artifact.objectKey);
  if (!m) problems.push(`${JSON.stringify(artifact.objectKey)} is not an external-cas object key (art/<assetId>/<sha256>.glb)`);
  else if (m[2] !== artifact.sha256) problems.push(`object key digest ${m[2]} does not match the artifact sha256 ${artifact.sha256}`);
  if (artifact.contentType !== ARTIFACT_CONTENT_TYPES.glb) problems.push(`content type must be ${ARTIFACT_CONTENT_TYPES.glb}, got ${JSON.stringify(artifact.contentType)}`);
  if (body.byteLength !== artifact.bytes) problems.push(`body is ${body.byteLength} bytes, artifact says ${artifact.bytes}`);
  else if (sha256Hex(body) !== artifact.sha256) problems.push("body sha256 does not match the artifact");
  return problems;
}

/** Re-download the whole object and compare size, SHA-256 and delivery headers. */
export async function verifyRemote(transport: ObjectTransport, artifact: PublishableArtifact): Promise<{ ok: boolean; problems: string[]; verification: RemoteVerification | null }> {
  const head = await transport.head(artifact.objectKey);
  const body = await transport.get(artifact.objectKey);
  if (!head || !body) return { ok: false, problems: [`${artifact.objectKey} is not present in ${transport.description}`], verification: null };
  const verification: RemoteVerification = { method: "full-object-get-sha256", bytes: body.byteLength, sha256: sha256Hex(body), contentType: head.contentType, cacheControl: head.cacheControl };
  const problems: string[] = [];
  if (verification.bytes !== artifact.bytes) problems.push(`remote object is ${verification.bytes} bytes, expected ${artifact.bytes}`);
  if (verification.sha256 !== artifact.sha256) problems.push(`remote object sha256 is ${verification.sha256}, expected ${artifact.sha256}`);
  if (Number.isFinite(head.bytes) && head.bytes !== verification.bytes) problems.push(`remote Content-Length ${head.bytes} disagrees with the downloaded ${verification.bytes} bytes`);
  const expected = objectHeadersFor(artifact);
  if (head.contentType !== expected.contentType) problems.push(`remote Content-Type is ${JSON.stringify(head.contentType)}, expected ${expected.contentType}`);
  if (head.cacheControl !== expected.cacheControl) problems.push(`remote Cache-Control is ${JSON.stringify(head.cacheControl)}, expected ${expected.cacheControl}`);
  return { ok: problems.length === 0, problems, verification };
}

const wrap = async <T>(op: () => Promise<T>): Promise<T> => {
  try {
    return await op();
  } catch (error) {
    if (error instanceof PublishError) throw error;
    throw new PublishError("transport", (error as Error).message);
  }
};

/**
 * Publish one artifact write-once and verify it. Resolves only after a successful remote
 * verification; throws {@link PublishError} otherwise.
 */
export async function publishObject(transport: ObjectTransport, artifact: PublishableArtifact, body: Uint8Array): Promise<PublishOutcome> {
  const local = checkPublishable(artifact, body);
  if (local.length) throw new PublishError("invalid-artifact", local.join("; "));

  const existingBefore = await wrap(() => transport.head(artifact.objectKey));
  let status: PublishOutcome["status"] = "already-present";
  if (!existingBefore) {
    const put = await wrap(() => transport.putIfAbsent(artifact.objectKey, body, objectHeadersFor(artifact)));
    status = put === "created" ? "created" : "already-present"; // "exists" = a concurrent writer won: verify it below
  }

  const check = await wrap(() => verifyRemote(transport, artifact));
  if (!check.ok) {
    if (status === "created") throw new PublishError("verify-failed", `uploaded, but verification failed: ${check.problems.join("; ")}`);
    const bytesDiffer = !check.verification || check.verification.sha256 !== artifact.sha256 || check.verification.bytes !== artifact.bytes;
    throw new PublishError(
      bytesDiffer ? "conflict" : "metadata-mismatch",
      `${artifact.objectKey} already exists and does not match — it is never overwritten: ${check.problems.join("; ")}`,
    );
  }
  return { status, verification: check.verification! };
}

/** The same semantics behind the generic {@link StorageAdapter} boundary. */
export function externalCasStorageAdapter(transport: ObjectTransport): StorageAdapter {
  return {
    backend: "external-cas",
    async put(objectKey, bytes, meta) {
      const outcome = await publishObject(transport, { objectKey, sha256: meta.sha256, bytes: bytes.byteLength, contentType: meta.contentType }, bytes);
      return { created: outcome.status === "created", location: `${transport.description}/${objectKey}` };
    },
    async verify(objectKey, expected) {
      const check = await verifyRemote(transport, { objectKey, sha256: expected.sha256, bytes: expected.bytes, contentType: ARTIFACT_CONTENT_TYPES.glb });
      return { ok: check.ok, problem: check.ok ? null : check.problems.join("; ") };
    },
  };
}
