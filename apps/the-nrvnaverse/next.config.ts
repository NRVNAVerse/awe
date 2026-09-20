import type { NextConfig } from "next";

const compiler: NextConfig["compiler"] =
  process.env.NODE_ENV === "production"
    ? {
        removeConsole: {
          exclude: ["error", "warn"],
        },
      }
    : undefined;

/**
 * HTTP cache policy for the generated spatial data (M0 Step 2B.4B.2). See
 * docs/NRVNAVERSE_SPATIAL_DATA_PIPELINE.md §15 and docs/NRVNAVERSE_SPATIAL_RUNTIME.md §15.
 *
 *   spatial-index.json                          version root — fixed URL, short-lived, revalidated
 *   global-scene.<content-version>.json         immutable — the token is in the FILE NAME, so the
 *   chunks/<key>.<content-version>.json         bytes a URL serves are the bytes that hash to it
 *
 * The immutable rules match the exact content-addressed names the pipeline emits
 * (`scripts/spatial/pipeline.mjs`: `<base>.<first 32 lowercase hex chars of SHA-256>.json`). Because
 * the digest is part of the path, a stale URL after a deployment is either the still-present old
 * file or a 404 — never current content under an old name — which is why no query condition is
 * needed (a query-only token was rejected in review for exactly that reason). The unversioned
 * names (`global-scene.json`, `chunks/<key>.json`) are no longer generated and match no rule here.
 * This is delivery policy only: it does not authorise, prefetch or retain any chunk, and
 * gate-before-fetch (D-006) is unchanged.
 */
export const SPATIAL_CONTENT_VERSION = "[0-9a-f]{32}";
export const SPATIAL_INDEX_CACHE_CONTROL = "public, max-age=0, must-revalidate";
export const SPATIAL_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type HeaderRule = Awaited<ReturnType<NonNullable<NextConfig["headers"]>>>[number];

export async function spatialDataHeaders(): Promise<HeaderRule[]> {
  return [
    {
      source: "/data/spatial/spatial-index.json",
      headers: [{ key: "Cache-Control", value: SPATIAL_INDEX_CACHE_CONTROL }],
    },
    {
      source: `/data/spatial/global-scene.:version(${SPATIAL_CONTENT_VERSION}).json`,
      headers: [{ key: "Cache-Control", value: SPATIAL_IMMUTABLE_CACHE_CONTROL }],
    },
    {
      // Chunk keys are lowercase kebab-case (`CHUNK_KEY_PATTERN` in the pipeline).
      source: `/data/spatial/chunks/:chunk([a-z0-9-]+).:version(${SPATIAL_CONTENT_VERSION}).json`,
      headers: [{ key: "Cache-Control", value: SPATIAL_IMMUTABLE_CACHE_CONTROL }],
    },
  ];
}

const nextConfig: NextConfig = {
  transpilePackages: ["@nrvnaverse/manifest", "@oncyberio/engine", "@oncyberio/engine-edit"],
  serverExternalPackages: ["draco3dgltf", "sharp"],
  compiler,
  headers: spatialDataHeaders,
};

export default nextConfig;
