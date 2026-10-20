import type { DeploymentProfile } from "./deployment-profile";

/**
 * HTTP response policy for every deployment (M4): search indexing, security headers and the
 * content-security policy. Pure data, consumed by `next.config.ts` (`headers()`), `app/robots.ts`
 * and the layout metadata, so the policy is one reviewed table and can be reproduced on any host
 * that serves the same paths (docs/NRVNAVERSE_HOSTING.md §6).
 *
 * Indexing (docs/NRVNAVERSE_HOSTING.md §6.2):
 * - A build is indexable only when its profile allows it AND `NRVNA_ALLOW_INDEXING=true`
 *   (`resolveDeployment`). Every other build — staging, local, a production build without the flag —
 *   sends `X-Robots-Tag: noindex, nofollow` on EVERY response, a `Disallow: /` robots.txt and
 *   `noindex` page metadata.
 * - Even an indexable build never indexes its machine surfaces: the in-world web-context panels
 *   (`/web-context/*`, whose canonical counterpart is the website), the data API, the generated
 *   spatial data and the runtime art.
 */

/** Response-header rule shape accepted by `next.config.ts` `headers()`. */
export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

export const NOINDEX = "noindex, nofollow";

/** Paths that are never indexed, in any build (Next `source` patterns). */
export const NEVER_INDEXED_SOURCES = ["/web-context/:path*", "/api/:path*", "/data/:path*", "/assets/:path*"] as const;

/** The same paths as robots.txt prefixes. */
export const NEVER_INDEXED_PREFIXES = ["/web-context/", "/api/", "/data/", "/assets/"] as const;

export function robotsHeaderRules(indexing: boolean): HeaderRule[] {
  const header = [{ key: "X-Robots-Tag", value: NOINDEX }];
  if (!indexing) return [{ source: "/(.*)", headers: header }];
  return NEVER_INDEXED_SOURCES.map((source) => ({ source, headers: header }));
}

export interface RobotsFile {
  rules: { userAgent: string; allow?: string; disallow: string | string[] };
}

/** `robots.txt` content (Next `MetadataRoute.Robots` shape). No sitemap: the world has one page. */
export function robotsFile(indexing: boolean): RobotsFile {
  if (!indexing) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: [...NEVER_INDEXED_PREFIXES] } };
}

/**
 * Third-party origins the runtime loads from today, all named by committed data: the engine's
 * default asset base (`cdn.oncyber.xyz/engine-assets` — avatar VRM, terrain textures, decoders,
 * environment maps) and the IPFS gateway of the default animation set (`cyber.mypinata.cloud`),
 * both referenced by the generated global scene. A test (`test/http-policy.test.ts`) fails if the
 * generated spatial data names an origin missing here. Launch risk recorded in the M4 campaign
 * record: availability of these hosts is outside NRVNAVerse control.
 */
export const RUNTIME_THIRD_PARTY_ORIGINS = ["https://cdn.oncyber.xyz", "https://cyber.mypinata.cloud"] as const;

/**
 * Third-party DATA origin of the engine itself: `getGPUTier()` (detect-gpu, `world-web.ts`) fetches
 * its GPU benchmark tables from `unpkg.com` on every boot to choose the quality tier. Found by the M4
 * release probe (the first CSP blocked it). Allowed for `connect-src` only so the tier decision is
 * unchanged; self-hosting the tables needs an engine option (upstream candidate).
 */
export const ENGINE_THIRD_PARTY_CONNECT_ORIGINS = ["https://unpkg.com"] as const;

/** First-party content-addressed art origin (`spatial-config.m0.json` → `assetStorage["external-cas"].publicOrigin`). */
export const ART_ORIGIN = "https://assets.nrvnaverse.com";

/**
 * Content-security policy. `'unsafe-inline'` scripts are required by the statically prerendered
 * App Router payload (nonces need per-request rendering, which a static world does not do);
 * `'wasm-unsafe-eval'` by the Rapier physics and Draco decoders; `blob:` workers / media by the
 * engine's decoders and loaders. Development adds what `next dev` needs (eval for React refresh,
 * the HMR websocket). Everything else is closed: no plugins, no foreign frames or framing, no base
 * or form retargeting, connections only to the world itself and the named asset origins.
 */
export function contentSecurityPolicy({ development }: { development: boolean }): string {
  const assets = [...RUNTIME_THIRD_PARTY_ORIGINS, ART_ORIGIN].join(" ");
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'unsafe-inline' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""}`],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", `'self' data: blob: ${assets}`],
    ["media-src", `'self' data: blob: ${assets}`],
    ["font-src", "'self' data:"],
    ["connect-src", `'self' data: blob: ${assets} ${ENGINE_THIRD_PARTY_CONNECT_ORIGINS.join(" ")}${development ? " ws: wss:" : ""}`],
    ["worker-src", "'self' blob:"],
    ["frame-src", "'self'"],
    ["frame-ancestors", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
  ];
  return directives.map(([k, v]) => `${k} ${v}`).join("; ");
}

/**
 * Security headers on every response. Same-origin framing only (the world frames its own
 * web-context panels; nothing else may frame the world). Gamepad, fullscreen and motion sensors
 * stay available to the world itself.
 */
export function securityHeaderRules({ development }: { development: boolean }): HeaderRule[] {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy({ development }) },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), browsing-topics=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ],
    },
  ];
}

/** Everything a deployment adds on top of the delivery (cache) rules. */
export function deploymentHeaderRules(profile: Pick<DeploymentProfile, "indexing">, { development }: { development: boolean }): HeaderRule[] {
  return [...securityHeaderRules({ development }), ...robotsHeaderRules(profile.indexing)];
}
