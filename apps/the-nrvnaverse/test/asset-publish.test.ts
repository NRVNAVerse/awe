import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runPrepare, runPublish } from "../scripts/asset-pipeline/cli";
import { PublishError, externalCasStorageAdapter, publishObject, type PublishableArtifact } from "../scripts/asset-pipeline/external-cas-adapter";
import { describeR2Config, readR2Config, r2Transport } from "../scripts/asset-pipeline/r2-config";
import { EMPTY_PAYLOAD_SHA256, s3Transport, signV4, type ObjectHead, type ObjectTransport, type PutObjectOptions } from "../scripts/asset-pipeline/s3-transport";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "../scripts/spatial/storage.mjs";

/**
 * S1 production storage: the `external-cas` publication path and its first adapter (Cloudflare R2
 * over the S3 API) WITHOUT any cloud credentials. Storage is an in-memory {@link ObjectTransport};
 * the S3 transport is exercised through an injected `fetch` that records requests; the SigV4 signer
 * is checked against AWS's published examples. Synthetic GLBs only.
 */

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const ID = "ast_fx7k2m9q4w8r3t6y";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ENV = {
  NRVNA_ASSET_R2_ACCOUNT_ID: ACCOUNT,
  NRVNA_ASSET_R2_BUCKET: "nrvnaverse-assets",
  NRVNA_ASSET_R2_ACCESS_KEY_ID: "test-access-key",
  NRVNA_ASSET_R2_SECRET_ACCESS_KEY: "test-secret-never-printed",
  NRVNA_ASSET_PUBLIC_ORIGIN: "https://assets.nrvnaverse.com",
};
const COMMITTED = { "external-cas": { publicOrigin: "https://assets.nrvnaverse.com" } };

/** In-memory object store with S3 conditional-put semantics and a call log. */
function memoryTransport(behaviour: { corruptOnPut?: boolean; failHead?: boolean } = {}) {
  const objects = new Map<string, { body: Uint8Array; head: ObjectHead }>();
  const calls: string[] = [];
  const transport: ObjectTransport & { objects: typeof objects; calls: string[] } = {
    description: "memory://test-bucket",
    objects,
    calls,
    async head(key) {
      calls.push(`HEAD ${key}`);
      if (behaviour.failHead) throw new Error("HeadObject failed: HTTP 403 AccessDenied");
      const o = objects.get(key);
      return o ? { ...o.head, metadata: { ...o.head.metadata } } : null;
    },
    async get(key) {
      calls.push(`GET ${key}`);
      return objects.get(key)?.body.slice() ?? null;
    },
    async putIfAbsent(key, body, options: PutObjectOptions) {
      calls.push(`PUT ${key}`);
      if (objects.has(key)) return "exists";
      const stored = behaviour.corruptOnPut ? body.slice(0, -1) : body.slice();
      objects.set(key, { body: stored, head: { bytes: stored.byteLength, contentType: options.contentType, cacheControl: options.cacheControl, metadata: { ...options.metadata } } });
      return "created";
    },
  };
  return transport;
}

const BODY = new TextEncoder().encode("glTF synthetic publication bytes — never a real model");
const artifactOf = (body = BODY): PublishableArtifact => ({ objectKey: `art/${ID}/${sha(body)}.glb`, sha256: sha(body), bytes: body.byteLength, contentType: "model/gltf-binary" });

describe("SigV4 signer — AWS published S3 examples", () => {
  const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };

  it("GET Object (range) example", () => {
    const signed = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256, "x-amz-date": "20130524T000000Z" },
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      amzDate: "20130524T000000Z",
      region: "us-east-1",
      service: "s3",
      credentials,
    });
    expect(signed.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("PUT Object example (path segment encoding: $ → %24)", () => {
    const payload = sha("Welcome to Amazon S3.");
    expect(payload).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const signed = signV4({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-date": "20130524T000000Z",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
        "x-amz-content-sha256": payload,
      },
      payloadSha256: payload,
      amzDate: "20130524T000000Z",
      region: "us-east-1",
      service: "s3",
      credentials,
    });
    expect(signed.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(signed.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });
});

describe("S3-compatible transport (R2 endpoint) — request shapes through an injected fetch", () => {
  type Seen = { method: string; url: string; headers: Record<string, string>; body: Uint8Array | null };
  function fakeFetch(respond: (req: Seen) => Response) {
    const seen: Seen[] = [];
    const f = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
      const req = { method: init?.method ?? "GET", url: String(input), headers, body: init?.body ? new Uint8Array(init.body as Uint8Array) : null };
      seen.push(req);
      return respond(req);
    }) as typeof fetch;
    return { f, seen };
  }
  const config = readR2Config(ENV);
  if (!config.ok) throw new Error("fixture config invalid");
  const now = () => new Date("2026-09-25T12:00:00Z");

  it("conditional PUT: path-style URL, signed payload, If-None-Match, content type, cache control, metadata", async () => {
    const { f, seen } = fakeFetch(() => new Response(null, { status: 200 }));
    const t = r2Transport(config.config, { fetch: f, now });
    const a = artifactOf();
    expect(await t.putIfAbsent(a.objectKey, BODY, { contentType: a.contentType, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, metadata: { sha256: a.sha256, "asset-id": ID } })).toBe("created");
    const [put] = seen;
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com/nrvnaverse-assets/${a.objectKey}`);
    expect(put.headers).toMatchObject({
      "if-none-match": "*",
      "content-type": "model/gltf-binary",
      "cache-control": "public, max-age=31536000, immutable",
      "x-amz-meta-sha256": a.sha256,
      "x-amz-meta-asset-id": ID,
      "x-amz-content-sha256": a.sha256,
      "x-amz-date": "20260925T120000Z",
    });
    expect(put.headers.authorization).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=test-access-key/20260925/auto/s3/aws4_request, SignedHeaders=cache-control;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date;x-amz-meta-asset-id;x-amz-meta-sha256, Signature=[0-9a-f]{64}$`));
    expect(JSON.stringify(put.headers)).not.toContain("test-secret-never-printed");
    expect(Buffer.from(put.body!).equals(Buffer.from(BODY))).toBe(true);
  });

  it("maps 412 to exists, 404 to absent, and surfaces S3 error codes", async () => {
    const statuses = [412, 404, 404, 403];
    const { f } = fakeFetch(() => {
      const status = statuses.shift()!;
      return new Response(status === 403 ? "<Error><Code>AccessDenied</Code></Error>" : null, { status });
    });
    const t = r2Transport(config.config, { fetch: f, now });
    expect(await t.putIfAbsent("k", BODY, { contentType: "x", cacheControl: "y", metadata: {} })).toBe("exists");
    expect(await t.head("k")).toBeNull();
    expect(await t.get("k")).toBeNull();
    await expect(t.get("k")).rejects.toThrow(/HTTP 403 AccessDenied/);
  });

  it("HEAD reads size, delivery headers and user metadata", async () => {
    const { f, seen } = fakeFetch(
      () => new Response(null, { status: 200, headers: { "content-length": "54", "content-type": "model/gltf-binary", "cache-control": IMMUTABLE_OBJECT_CACHE_CONTROL, "x-amz-meta-sha256": "abc" } }),
    );
    const head = await s3Transport({ endpoint: "https://s3.example.test", bucket: "b1", region: "auto", credentials: { accessKeyId: "a", secretAccessKey: "s" }, fetch: f, now }).head("art/x.glb");
    expect(head).toEqual({ bytes: 54, contentType: "model/gltf-binary", cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, metadata: { sha256: "abc" } });
    expect(seen[0].headers["x-amz-content-sha256"]).toBe(EMPTY_PAYLOAD_SHA256);
  });
});

describe("R2 environment contract", () => {
  it("accepts the documented contract and derives the S3 endpoint", () => {
    const r = readR2Config(ENV);
    expect(r.ok && r.config).toMatchObject({ endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`, region: "auto", bucket: "nrvnaverse-assets", publicOrigin: "https://assets.nrvnaverse.com" });
  });

  it("reports every missing variable by name, never by value", () => {
    const r = readR2Config({});
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/NRVNA_ASSET_R2_ACCOUNT_ID is not set[\s\S]*NRVNA_ASSET_R2_BUCKET[\s\S]*NRVNA_ASSET_R2_ACCESS_KEY_ID[\s\S]*NRVNA_ASSET_R2_SECRET_ACCESS_KEY[\s\S]*NRVNA_ASSET_PUBLIC_ORIGIN/);
    const described = describeR2Config(ENV);
    expect(JSON.stringify(described)).not.toContain("test-secret-never-printed");
    expect(JSON.stringify(described)).not.toContain("test-access-key");
    expect(described).toMatchObject({ NRVNA_ASSET_R2_SECRET_ACCESS_KEY: "set", NRVNA_ASSET_R2_ACCESS_KEY_ID: "set" });
  });

  it("refuses an invalid account id, bucket or public origin", () => {
    expect(readR2Config({ ...ENV, NRVNA_ASSET_R2_ACCOUNT_ID: "not-an-account" }).problems).toEqual([expect.stringMatching(/32-character/)]);
    expect(readR2Config({ ...ENV, NRVNA_ASSET_R2_BUCKET: "Bad_Bucket" }).problems).toEqual([expect.stringMatching(/valid bucket name/)]);
    for (const origin of ["http://assets.nrvnaverse.com", "https://pub-abc.r2.dev", "https://assets.nrvnaverse.com/art", "https://assets.nrvnaverse.com/"]) {
      expect(readR2Config({ ...ENV, NRVNA_ASSET_PUBLIC_ORIGIN: origin }).problems, origin).toEqual([expect.stringMatching(/^NRVNA_ASSET_PUBLIC_ORIGIN: /)]);
    }
  });

  it("a dry run needs no credentials", () => {
    const { NRVNA_ASSET_R2_ACCESS_KEY_ID: _a, NRVNA_ASSET_R2_SECRET_ACCESS_KEY: _s, ...noCreds } = ENV;
    expect(readR2Config(noCreds, { requireCredentials: false }).ok).toBe(true);
    expect(readR2Config(noCreds).ok).toBe(false);
  });
});

describe("write-once publication semantics", () => {
  it("uploads a new object with immutable delivery headers, then verifies it by full re-download", async () => {
    const t = memoryTransport();
    const a = artifactOf();
    const outcome = await publishObject(t, a, BODY);
    expect(outcome).toEqual({ status: "created", verification: { method: "full-object-get-sha256", bytes: BODY.byteLength, sha256: a.sha256, contentType: "model/gltf-binary", cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL } });
    expect(t.calls).toEqual([`HEAD ${a.objectKey}`, `PUT ${a.objectKey}`, `HEAD ${a.objectKey}`, `GET ${a.objectKey}`]);
    expect(t.objects.get(a.objectKey)!.head).toMatchObject({ contentType: "model/gltf-binary", cacheControl: "public, max-age=31536000, immutable", metadata: { sha256: a.sha256, "asset-id": ID } });
  });

  it("an exact existing object is idempotent success, with no second PUT", async () => {
    const t = memoryTransport();
    const a = artifactOf();
    await publishObject(t, a, BODY);
    t.calls.length = 0;
    expect((await publishObject(t, a, BODY)).status).toBe("already-present");
    expect(t.calls.filter((c) => c.startsWith("PUT"))).toEqual([]);
  });

  it("a conflicting existing object fails hard and is never overwritten", async () => {
    const t = memoryTransport();
    const a = artifactOf();
    const squatter = new TextEncoder().encode("different bytes at the same key");
    t.objects.set(a.objectKey, { body: squatter, head: { bytes: squatter.byteLength, contentType: "model/gltf-binary", cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, metadata: {} } });
    const error = await publishObject(t, a, BODY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect((error as PublishError).code).toBe("conflict");
    expect((error as PublishError).message).toMatch(/never overwritten/);
    expect(t.objects.get(a.objectKey)!.body).toEqual(squatter);
    expect(t.calls.filter((c) => c.startsWith("PUT"))).toEqual([]);
  });

  it("same bytes but wrong delivery headers is a metadata mismatch, still never overwritten", async () => {
    const t = memoryTransport();
    const a = artifactOf();
    t.objects.set(a.objectKey, { body: BODY.slice(), head: { bytes: BODY.byteLength, contentType: "application/octet-stream", cacheControl: "no-cache", metadata: {} } });
    const error = (await publishObject(t, a, BODY).catch((e: unknown) => e)) as PublishError;
    expect(error.code).toBe("metadata-mismatch");
    expect(error.message).toMatch(/Content-Type[\s\S]*Cache-Control/);
  });

  it("a race (412 on the conditional PUT) is resolved by verification, not by overwriting", async () => {
    const t = memoryTransport();
    const a = artifactOf();
    const realHead = t.head.bind(t);
    let first = true;
    t.head = async (key) => {
      if (first) {
        first = false;
        t.objects.set(key, { body: BODY.slice(), head: { bytes: BODY.byteLength, contentType: a.contentType, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, metadata: {} } });
        return null; // another writer lands between our HEAD and PUT
      }
      return realHead(key);
    };
    expect((await publishObject(t, a, BODY)).status).toBe("already-present");
  });

  it("reports success only after verification: a store that corrupts bytes fails", async () => {
    const error = (await publishObject(memoryTransport({ corruptOnPut: true }), artifactOf(), BODY).catch((e: unknown) => e)) as PublishError;
    expect(error.code).toBe("verify-failed");
    expect(error.message).toMatch(/bytes, expected/);
  });

  it("validates key, digest, size and content type before touching storage", async () => {
    const t = memoryTransport();
    const a = artifactOf();
    for (const bad of [
      { ...a, objectKey: `art/${ID}/../../escape.glb` },
      { ...a, objectKey: `art/${ID}/${"0".repeat(64)}.glb` },
      { ...a, objectKey: `assets/art/${ID}.${a.sha256.slice(0, 32)}.glb` },
      { ...a, contentType: "application/octet-stream" },
      { ...a, bytes: a.bytes + 1 },
    ]) {
      expect(((await publishObject(t, bad, BODY).catch((e: unknown) => e)) as PublishError).code, JSON.stringify(bad)).toBe("invalid-artifact");
    }
    expect(t.calls).toEqual([]);
  });

  it("transport failures surface as transport errors", async () => {
    expect(((await publishObject(memoryTransport({ failHead: true }), artifactOf(), BODY).catch((e: unknown) => e)) as PublishError).code).toBe("transport");
  });

  it("implements the generic StorageAdapter boundary with the same semantics", async () => {
    const t = memoryTransport();
    const adapter = externalCasStorageAdapter(t);
    const a = artifactOf();
    expect(await adapter.put(a.objectKey, BODY, { sha256: a.sha256, contentType: a.contentType })).toEqual({ created: true, location: `memory://test-bucket/${a.objectKey}` });
    expect((await adapter.put(a.objectKey, BODY, { sha256: a.sha256, contentType: a.contentType })).created).toBe(false);
    expect(await adapter.verify(a.objectKey, { sha256: a.sha256, bytes: a.bytes })).toEqual({ ok: true, problem: null });
    expect((await adapter.verify(a.objectKey, { sha256: "0".repeat(64), bytes: a.bytes })).ok).toBe(false);
  });
});

describe("asset:publish — from a real synthetic asset:prepare run", () => {
  type Fixtures = { bigTexturedCube(): Promise<Buffer> };
  const FIXTURES = new URL("../../../packages/tools/test/support/gltf-fixtures.ts", import.meta.url).href;
  let glb: Buffer;
  beforeAll(async () => {
    glb = await ((await import(/* @vite-ignore */ FIXTURES)) as Fixtures).bigTexturedCube();
  }, 60_000);

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nrvnaverse-publish-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function metadata(overrides: Record<string, unknown> = {}) {
    return {
      assetId: ID,
      name: "Synthetic publication cube",
      kind: "model",
      usage: "production",
      provenance: { origin: "self-authored", creationContext: "original", creator: "NRVNAVerse test suite", dependencies: [] },
      rights: { status: "cleared", license: "test fixture", rightsHolder: "NRVNAVerse", attributionRequired: false, attributionText: null, commercialUse: "allowed", webRuntimeRedistribution: "allowed", modification: "allowed", restrictions: [] },
      review: { status: "approved", reviewedBy: "Fixture Reviewer", reviewedAt: "2026-09-24T10:00:00-07:00" },
      ...overrides,
    };
  }

  async function prepared(overrides: Record<string, unknown> = {}) {
    writeFileSync(join(dir, "source.glb"), glb);
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata(overrides)));
    const run = await runPrepare([join(dir, "source.glb"), join(dir, "metadata.json"), "--out", join(dir, "staging")]);
    return { run, reportPath: run.reportPath!, report: JSON.parse(readFileSync(run.reportPath!, "utf8")) };
  }

  const spyTransport = () => {
    const t = memoryTransport();
    const constructed: string[] = [];
    return { t, constructed, transportFor: (c: { bucket: string }) => (constructed.push(c.bucket), t) };
  };

  it("publishes write-once, verifies remotely, reports the runtime URL, and leaves the registry proposal unchanged", async () => {
    const { reportPath, report: prep } = await prepared();
    const { t, transportFor } = spyTransport();
    const run = await runPublish([reportPath], { env: ENV, transportFor, committedStorage: COMMITTED });
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    const pub = JSON.parse(readFileSync(run.reportPath!, "utf8"));
    expect(pub).toMatchObject({ kind: "nrvnaverse-asset-publish", mode: "publish", status: "published", blockers: [], failure: null });
    expect(pub.verification).toMatchObject({ method: "full-object-get-sha256", sha256: prep.artifact.sha256, bytes: prep.artifact.bytes });
    expect(pub.plan.runtimeUrl).toBe(`https://assets.nrvnaverse.com/${prep.artifact.storage.objectKey}`);
    expect(pub.registryRevision).toEqual(prep.registryProposal);
    expect(JSON.stringify(pub)).not.toContain("test-secret-never-printed");
    expect(t.objects.has(prep.artifact.storage.objectKey)).toBe(true);
    expect(run.reportPath).toBe(join(dir, "staging", "published", `${ID}.r1.json`));
    // Publishing again is idempotent.
    const again = await runPublish([reportPath], { env: ENV, transportFor, committedStorage: COMMITTED });
    expect(again.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(again.reportPath!, "utf8")).status).toBe("already-published");
  });

  it("--dry-run makes the whole operation inspectable and never constructs a transport (no credentials needed)", async () => {
    const { reportPath } = await prepared();
    const { constructed, transportFor } = spyTransport();
    const { NRVNA_ASSET_R2_ACCESS_KEY_ID: _a, NRVNA_ASSET_R2_SECRET_ACCESS_KEY: _s, ...noCreds } = ENV;
    const run = await runPublish([reportPath, "--dry-run"], { env: noCreds, transportFor, committedStorage: COMMITTED });
    expect(run.exitCode, run.lines.join("\n")).toBe(0);
    expect(constructed).toEqual([]);
    expect(run.lines[0]).toMatch(/^PLANNED \(dry run — no network calls\)/);
    expect(run.lines.join("\n")).toMatch(/would {4}if absent: PUT art\/ast_fx7k2m9q4w8r3t6y\/[0-9a-f]{64}\.glb \(If-None-Match: \*/);
    expect(run.reportPath).toMatch(/\.r1\.dry-run\.json$/);
    const plan = JSON.parse(readFileSync(run.reportPath!, "utf8"));
    expect(plan.plan.headers).toMatchObject({ contentType: "model/gltf-binary", cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
    expect(plan.plan.target).toMatchObject({ NRVNA_ASSET_R2_ACCESS_KEY_ID: "missing", NRVNA_ASSET_R2_BUCKET: "nrvnaverse-assets" });
  });

  it("an ineligible artifact is refused before storage is contacted", async () => {
    // An internal tracer can be prepared READY, but only production art is published.
    const { reportPath } = await prepared({ usage: "internal-tracer", review: { status: "internal-tracer-accepted", reviewedBy: "Fixture Reviewer", reviewedAt: "2026-09-24T10:00:00Z" } });
    const { t, constructed, transportFor } = spyTransport();
    const run = await runPublish([reportPath], { env: ENV, transportFor, committedStorage: COMMITTED });
    expect(run.exitCode).toBe(2);
    expect(run.lines.join("\n")).toMatch(/\[not-production\]/);
    expect(constructed).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  it("re-evaluates policy rather than trusting the report: a hand-edited 'ready' report with an unapproved review is refused", async () => {
    const { reportPath, report } = await prepared();
    report.registryProposal.record.review = { status: "unreviewed", reviewedBy: null, reviewedAt: null };
    writeFileSync(reportPath, JSON.stringify(report));
    const { t, transportFor } = spyTransport();
    const run = await runPublish([reportPath], { env: ENV, transportFor, committedStorage: COMMITTED });
    expect(run.exitCode).toBe(2);
    expect(run.lines.join("\n")).toMatch(/\[not-production-eligible\] review status is "unreviewed"/);
    expect(t.calls).toEqual([]);
  });

  it("refuses a blocked prepare report, tampered staged bytes, missing config and an origin that disagrees with the committed one", async () => {
    const { reportPath, report } = await prepared();
    const { t, transportFor } = spyTransport();
    const codes = async (env: Record<string, string | undefined>, committed: Record<string, { publicOrigin?: string }> | null = COMMITTED) => {
      const run = await runPublish([reportPath], { env, transportFor, committedStorage: committed });
      return JSON.parse(readFileSync(run.reportPath!, "utf8")).blockers.map((b: { code: string }) => b.code);
    };
    expect(await codes({})).toEqual(["storage-config", "storage-config", "storage-config", "storage-config", "storage-config"]);
    expect(await codes({ ...ENV, NRVNA_ASSET_PUBLIC_ORIGIN: "https://cdn.example.com" })).toEqual(["public-origin-mismatch"]);

    const staged = join(dir, "staging", "objects", ...report.artifact.storage.objectKey.split("/"));
    const bytes = readFileSync(staged);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(staged, bytes);
    expect(await codes(ENV)).toEqual(["staged-object-mismatch"]);
    rmSync(staged);
    expect(await codes(ENV)).toEqual(["staged-object-missing"]);

    report.status = "blocked";
    report.blockers = [{ code: "production-unresolved", message: "x" }];
    writeFileSync(reportPath, JSON.stringify(report));
    expect(await codes(ENV)).toContain("prepare-not-ready");
    expect(t.calls).toEqual([]);
  });

  it("a storage conflict fails the command (exit 1) and overwrites nothing", async () => {
    const { reportPath, report } = await prepared();
    const { t, transportFor } = spyTransport();
    const squatter = new TextEncoder().encode("squatter");
    t.objects.set(report.artifact.storage.objectKey, { body: squatter, head: { bytes: squatter.byteLength, contentType: "model/gltf-binary", cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, metadata: {} } });
    const run = await runPublish([reportPath], { env: ENV, transportFor, committedStorage: COMMITTED });
    expect(run.exitCode).toBe(1);
    expect(run.lines.join("\n")).toMatch(/FAILED {3}\[conflict\]/);
    expect(t.objects.get(report.artifact.storage.objectKey)!.body).toEqual(squatter);
  });

  it("usage errors exit 1", async () => {
    expect((await runPublish([])).exitCode).toBe(1);
    expect((await runPublish(["a.json", "--force"])).exitCode).toBe(1);
    expect((await runPublish([join(dir, "missing.json")], { env: ENV })).exitCode).toBe(1);
    expect(existsSync(join(dir, "published"))).toBe(false);
  });
});
