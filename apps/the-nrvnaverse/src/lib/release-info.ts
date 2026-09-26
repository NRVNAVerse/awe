import { DESTINATION_SCHEMA_VERSION } from "@nrvnaverse/manifest";

/**
 * Non-sensitive deployment facts for `/api/health` (docs/NRVNAVERSE_HOSTING.md). Everything here is
 * already public (the spatial index and manifests are served to every visitor); nothing reads a
 * secret, a path or a token. `NRVNA_RELEASE_ID` is OPTIONAL, server-only, and echoed only when it is
 * a plain identifier (a Git SHA, a tag, a host deployment id).
 */
export const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface SpatialIndexFacts {
  schemaVersion: unknown;
  worldId: unknown;
  globalSceneUrl: unknown;
  chunks: Record<string, unknown>;
}

export interface ReleaseInfo {
  status: "ok";
  app: "the-nrvnaverse";
  environment: "production" | "development" | "test";
  /** From `NRVNA_RELEASE_ID`, or null when unset / not a plain identifier. */
  release: string | null;
  manifestSchemaVersion: number;
  spatial: {
    worldId: string | null;
    indexSchemaVersion: number | null;
    /** The content version of the global scene this build serves (public: it is in a served URL). */
    globalSceneVersion: string | null;
    chunks: number;
  };
}

export function releaseInfo(env: Record<string, string | undefined>, index: SpatialIndexFacts): ReleaseInfo {
  const releaseRaw = env.NRVNA_RELEASE_ID?.trim();
  const nodeEnv = env.NODE_ENV === "production" || env.NODE_ENV === "test" ? env.NODE_ENV : "development";
  const version = typeof index.globalSceneUrl === "string" ? /\.([0-9a-f]{32})\.json$/.exec(index.globalSceneUrl)?.[1] ?? null : null;
  return {
    status: "ok",
    app: "the-nrvnaverse",
    environment: nodeEnv,
    release: releaseRaw && RELEASE_ID_PATTERN.test(releaseRaw) ? releaseRaw : null,
    manifestSchemaVersion: DESTINATION_SCHEMA_VERSION,
    spatial: {
      worldId: typeof index.worldId === "string" ? index.worldId : null,
      indexSchemaVersion: typeof index.schemaVersion === "number" ? index.schemaVersion : null,
      globalSceneVersion: version,
      chunks: index.chunks && typeof index.chunks === "object" ? Object.keys(index.chunks).length : 0,
    },
  };
}
