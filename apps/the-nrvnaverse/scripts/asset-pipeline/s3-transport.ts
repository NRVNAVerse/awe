/**
 * ============================================================================================
 * PROVISIONAL UNTIL LIVE-STORAGE SECURITY REVIEW
 *
 * Before real production credentials are used, this implementation must either pass the planned
 * focused security/interoperability review, or be replaced with a maintained S3-compatible client.
 * ============================================================================================
 *
 * A minimal S3-compatible object transport (AWS Signature Version 4 over `fetch`) for the
 * `external-cas` storage backend (M1.1 S1). Standard S3 API — `HeadObject`, `GetObject`, and a
 * conditional `PutObject` (`If-None-Match: *`) — so any S3-compatible store works behind it; the
 * first concrete target is Cloudflare R2 (`r2-config.ts`).
 *
 * Why not an SDK: the app declares no S3 client, and adding one is a lockfile change (D-014) for three
 * signed requests. The signer is checked against AWS's published SigV4 examples
 * (`test/asset-publish.test.ts`). Swapping in `@aws-sdk/client-s3` later means reimplementing
 * {@link ObjectTransport} only; nothing above it changes.
 *
 * The transport moves bytes and reports facts. It never decides policy: write-once, verification
 * and conflicts are the adapter's job (`external-cas-adapter.ts`).
 */
import { createHash, createHmac } from "node:crypto";

export interface ObjectHead {
  bytes: number;
  contentType: string | null;
  cacheControl: string | null;
  /** `x-amz-meta-*` user metadata, keys without the prefix, lower-case. */
  metadata: Record<string, string>;
}

export interface PutObjectOptions {
  contentType: string;
  cacheControl: string;
  metadata: Record<string, string>;
}

/** The substitutable storage boundary: tests use an in-memory implementation. */
export interface ObjectTransport {
  /** Non-secret description of the target, e.g. `s3 https://<account>.r2.cloudflarestorage.com/<bucket>`. */
  readonly description: string;
  head(objectKey: string): Promise<ObjectHead | null>;
  get(objectKey: string): Promise<Uint8Array | null>;
  /** Create the object only if absent (`If-None-Match: *`). `"exists"` = something is already there. */
  putIfAbsent(objectKey: string, body: Uint8Array, options: PutObjectOptions): Promise<"created" | "exists">;
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding of one path segment, as SigV4 requires (`$` → `%24`, `*` → `%2A`, …). */
function encodeSegment(segment: string): string {
  return encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface SignInput {
  method: string;
  url: URL;
  /** Every header to sign, including `host`, `x-amz-date` and `x-amz-content-sha256`. */
  headers: Record<string, string>;
  payloadSha256: string;
  /** `YYYYMMDDTHHMMSSZ` */
  amzDate: string;
  region: string;
  service: string;
  credentials: SigV4Credentials;
}

/** AWS Signature Version 4 (header-based, single-chunk signed payload). */
export function signV4(input: SignInput): { authorization: string; canonicalRequest: string; stringToSign: string; signature: string } {
  const date = input.amzDate.slice(0, 8);
  const headers = Object.entries(input.headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = headers.map(([k]) => k).join(";");
  const canonicalUri = input.url.pathname.split("/").map(encodeSegment).join("/") || "/";
  const canonicalQuery = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [input.method, canonicalUri, canonicalQuery, headers.map(([k, v]) => `${k}:${v}\n`).join(""), signedHeaders, input.payloadSha256].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, date), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
    signature,
  };
}

export interface S3TransportOptions {
  /** e.g. `https://<account>.r2.cloudflarestorage.com` (no bucket, no trailing slash). */
  endpoint: string;
  bucket: string;
  region: string;
  credentials: SigV4Credentials;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** Injected in tests. */
  now?: () => Date;
}

const amzDateOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Path-style S3 requests: `<endpoint>/<bucket>/<objectKey>`. */
export function s3Transport(options: S3TransportOptions): ObjectTransport {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  async function request(method: "HEAD" | "GET" | "PUT", objectKey: string, extra: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const url = new URL(`${options.endpoint}/${options.bucket}/${objectKey}`);
    const payloadSha256 = body ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
    const headers: Record<string, string> = { host: url.host, "x-amz-date": amzDateOf(now()), "x-amz-content-sha256": payloadSha256, ...extra };
    const { authorization } = signV4({ method, url, headers, payloadSha256, amzDate: headers["x-amz-date"], region: options.region, service: "s3", credentials: options.credentials });
    const { host: _host, ...sent } = headers; // fetch sets Host itself
    return doFetch(url, { method, headers: { ...sent, authorization }, body: body as BodyInit | undefined });
  }

  async function failure(op: string, objectKey: string, res: Response): Promise<Error> {
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    return new Error(`${op} ${objectKey} failed: HTTP ${res.status}${code ? ` ${code}` : ""}`);
  }

  return {
    description: `s3 ${options.endpoint}/${options.bucket}`,
    async head(objectKey) {
      const res = await request("HEAD", objectKey);
      if (res.status === 404) return null;
      if (!res.ok) throw await failure("HeadObject", objectKey, res);
      const metadata: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        if (name.toLowerCase().startsWith("x-amz-meta-")) metadata[name.toLowerCase().slice("x-amz-meta-".length)] = value;
      });
      return {
        bytes: Number(res.headers.get("content-length") ?? NaN),
        contentType: res.headers.get("content-type"),
        cacheControl: res.headers.get("cache-control"),
        metadata,
      };
    },
    async get(objectKey) {
      const res = await request("GET", objectKey);
      if (res.status === 404) return null;
      if (!res.ok) throw await failure("GetObject", objectKey, res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async putIfAbsent(objectKey, body, put) {
      const headers: Record<string, string> = { "content-type": put.contentType, "cache-control": put.cacheControl, "if-none-match": "*" };
      for (const [k, v] of Object.entries(put.metadata)) headers[`x-amz-meta-${k.toLowerCase()}`] = v;
      const res = await request("PUT", objectKey, headers, body);
      if (res.status === 412) return "exists";
      if (!res.ok) throw await failure("PutObject", objectKey, res);
      return "created";
    },
  };
}
