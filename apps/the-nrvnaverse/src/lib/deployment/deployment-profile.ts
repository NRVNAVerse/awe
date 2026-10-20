/**
 * Deployment profiles (M4, docs/NRVNAVERSE_HOSTING.md §2 and docs/NRVNAVERSE_STAGING_AND_RELEASE.md).
 *
 * A build of THE NRVNAVerse is one of a FIXED, REVIEWED set of environments. The profile pairs the
 * world's own origin with the website origin its web links go to, so a staging world sends people
 * back to the staging website and never to production — and production never to a preview.
 *
 * - The set below is the allowlist. Adding or changing an origin is a reviewed code change; there
 *   is no URL, query or runtime override, so no visitor input can choose where a link points
 *   (no open redirect, no origin injection).
 * - The profile is chosen at BUILD time by `NRVNA_DEPLOYMENT` (`production` when unset — the
 *   canonical identity, exactly the pre-M4 behaviour). An unknown name fails the build.
 * - Search indexing is off unless the profile allows it AND `NRVNA_ALLOW_INDEXING=true` at build
 *   time: forgetting the flag yields a non-indexed production build (noticed at the release smoke),
 *   never an indexed preview.
 * - The client bundle receives only the profile NAME (inlined by `next.config.ts`), and resolves it
 *   through this same table, falling back to `production` for anything else.
 *
 * The staging origins are PROPOSED names (`staging.` / `worlds-staging.` under nrvnaverse.com):
 * they exist only once the owner creates them (Governance rule 8). `local` pairs the two apps'
 * default local ports (the WEB app on :3000, the world on :3100 — docs/WORLD_HARNESS.md in WEB).
 */
export const DEPLOYMENT_PROFILES = {
  production: {
    worldOrigin: "https://worlds.nrvnaverse.com",
    webOrigin: "https://www.nrvnaverse.com",
    indexable: true,
  },
  staging: {
    worldOrigin: "https://worlds-staging.nrvnaverse.com",
    webOrigin: "https://staging.nrvnaverse.com",
    indexable: false,
  },
  local: {
    worldOrigin: "http://localhost:3100",
    webOrigin: "http://localhost:3000",
    indexable: false,
  },
} as const;

export type DeploymentName = keyof typeof DEPLOYMENT_PROFILES;

export interface DeploymentProfile {
  name: DeploymentName;
  /** The world's own origin (no trailing slash). */
  worldOrigin: string;
  /** The website origin web links go to (no trailing slash). */
  webOrigin: string;
  /** Whether this build may be indexed by search engines. */
  indexing: boolean;
}

export const DEFAULT_DEPLOYMENT: DeploymentName = "production";

export function isDeploymentName(value: unknown): value is DeploymentName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEPLOYMENT_PROFILES, value);
}

/**
 * Build-time resolution (used by `next.config.ts`). Throws on an unknown `NRVNA_DEPLOYMENT` so a
 * misconfigured host fails its build instead of publishing links to the wrong website.
 */
export function resolveDeployment(env: Record<string, string | undefined>): DeploymentProfile {
  const raw = env.NRVNA_DEPLOYMENT?.trim();
  const name = raw ? raw : DEFAULT_DEPLOYMENT;
  if (!isDeploymentName(name)) {
    throw new Error(`NRVNA_DEPLOYMENT must be one of ${Object.keys(DEPLOYMENT_PROFILES).join(", ")} (got "${raw}")`);
  }
  const profile = DEPLOYMENT_PROFILES[name];
  return {
    name,
    worldOrigin: profile.worldOrigin,
    webOrigin: profile.webOrigin,
    indexing: profile.indexable && env.NRVNA_ALLOW_INDEXING === "true",
  };
}

/**
 * Runtime resolution from the inlined profile name (client and server). Never throws: anything that
 * is not a known name resolves to the canonical production pairing. Indexing is a build/HTTP-layer
 * concern and is not decided here.
 */
export function deploymentByName(name: string | undefined): Omit<DeploymentProfile, "indexing"> {
  const key: DeploymentName = isDeploymentName(name) ? name : DEFAULT_DEPLOYMENT;
  const profile = DEPLOYMENT_PROFILES[key];
  return { name: key, worldOrigin: profile.worldOrigin, webOrigin: profile.webOrigin };
}

/** The profile this bundle was built for (`NRVNA_DEPLOYMENT` is inlined at build time by `next.config.ts`). */
export function currentDeployment(): Omit<DeploymentProfile, "indexing"> {
  return deploymentByName(process.env.NRVNA_DEPLOYMENT);
}
