import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDeepLinkQuery, parseDeepLink, rebaseWebUrl, resolveDeepLink, type DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { DEPLOYMENT_PROFILES, deploymentByName, resolveDeployment } from "@/lib/deployment/deployment-profile";
import { ART_ORIGIN, ENGINE_THIRD_PARTY_CONNECT_ORIGINS, NOINDEX, RUNTIME_THIRD_PARTY_ORIGINS, contentSecurityPolicy, deploymentHeaderRules, robotsFile, robotsHeaderRules, securityHeaderRules, type HeaderRule } from "@/lib/deployment/http-policy";
import { hasWebContext, webContextIds } from "@/lib/web/web-context-policy";

/**
 * M4 — deployment profiles, indexing, security headers and the WEB ↔ WORLD return contract
 * (docs/NRVNAVERSE_HOSTING.md §2 / §6, docs/NRVNAVERSE_STAGING_AND_RELEASE.md). Route matching uses
 * the module Next 16 uses at request time, like `cache-policy.test.ts`.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string, keys: unknown[], opts: object) => RegExp };
const data = destinationsJson as unknown as DestinationsFile;
const byId = new Map(data.destinations.map((d) => [d.id, d]));
const GATED = data.destinations.filter((d) => d.gates.length > 0).map((d) => d.id);

function headersFor(rules: HeaderRule[], path: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const rule of rules) {
    if (!pathToRegexp(rule.source, [], { strict: true, sensitive: false, delimiter: "/" }).test(path)) continue;
    for (const h of rule.headers) (out[h.key] ??= []).push(h.value);
  }
  return out;
}

describe("deployment profiles (the reviewed origin allowlist)", () => {
  it("pairs each world origin with a website origin; bare origins only, https outside local", () => {
    expect(Object.keys(DEPLOYMENT_PROFILES).sort()).toEqual(["local", "production", "staging"]);
    for (const [name, p] of Object.entries(DEPLOYMENT_PROFILES)) {
      for (const origin of [p.worldOrigin, p.webOrigin]) {
        expect(new URL(origin).origin, `${name} ${origin}`).toBe(origin);
        expect(new URL(origin).protocol, `${name} ${origin}`).toBe(name === "local" ? "http:" : "https:");
      }
      if (name === "local") for (const origin of [p.worldOrigin, p.webOrigin]) expect(new URL(origin).hostname).toBe("localhost");
    }
    expect(DEPLOYMENT_PROFILES.production).toEqual({ worldOrigin: "https://worlds.nrvnaverse.com", webOrigin: "https://www.nrvnaverse.com", indexable: true });
    // Only production may ever be indexed; no two profiles share an origin (a preview can never pose as production).
    expect(Object.entries(DEPLOYMENT_PROFILES).filter(([, p]) => p.indexable).map(([n]) => n)).toEqual(["production"]);
    const origins = Object.values(DEPLOYMENT_PROFILES).flatMap((p) => [p.worldOrigin, p.webOrigin]);
    expect(new Set(origins).size).toBe(origins.length);
  });

  it("is chosen at build time by NRVNA_DEPLOYMENT; unset = production; an unknown name fails the build", () => {
    expect(resolveDeployment({})).toEqual({ name: "production", worldOrigin: "https://worlds.nrvnaverse.com", webOrigin: "https://www.nrvnaverse.com", indexing: false, webPages: true });
    expect(resolveDeployment({ NRVNA_DEPLOYMENT: " staging " }).name).toBe("staging");
    expect(resolveDeployment({ NRVNA_DEPLOYMENT: "local" }).webOrigin).toBe("http://localhost:3000");
    for (const bad of ["prod", "Production", "https://evil.example", "preview", "staging;production"]) {
      expect(() => resolveDeployment({ NRVNA_DEPLOYMENT: bad }), bad).toThrow(/NRVNA_DEPLOYMENT must be one of/);
    }
  });

  it("indexes only a production build with NRVNA_ALLOW_INDEXING=true — never staging or local, never by default", () => {
    expect(resolveDeployment({ NRVNA_DEPLOYMENT: "production", NRVNA_ALLOW_INDEXING: "true" }).indexing).toBe(true);
    expect(resolveDeployment({ NRVNA_ALLOW_INDEXING: "true" }).indexing).toBe(true);
    for (const env of [{}, { NRVNA_ALLOW_INDEXING: "1" }, { NRVNA_ALLOW_INDEXING: "TRUE" }, { NRVNA_DEPLOYMENT: "staging", NRVNA_ALLOW_INDEXING: "true" }, { NRVNA_DEPLOYMENT: "local", NRVNA_ALLOW_INDEXING: "true" }]) {
      expect(resolveDeployment(env).indexing, JSON.stringify(env)).toBe(false);
    }
  });

  it("NRVNA_WEB_PAGES: unset / 1 = the website serves destination pages; 0 = it does not yet; anything else fails the build", () => {
    expect(resolveDeployment({}).webPages).toBe(true);
    expect(resolveDeployment({ NRVNA_WEB_PAGES: "1" }).webPages).toBe(true);
    expect(resolveDeployment({ NRVNA_WEB_PAGES: " 0 " }).webPages).toBe(false);
    for (const bad of ["false", "no", "root", "https://evil.example"]) expect(() => resolveDeployment({ NRVNA_WEB_PAGES: bad }), bad).toThrow(/NRVNA_WEB_PAGES must be 0 or 1/);
  });

  it("without destination pages every world → web link is the website root (no dead /worlds/<slug> link); the return token is kept", async () => {
    const { webUrlOf, withWebPages, returnLabel, currentPageLabel } = await import("@/lib/deployment/web-links");
    const music = data.destinations.find((d) => d.slug === "music")!;
    const index = { byId, bySlug: new Map(), byPreviousSlug: new Map(), hub: data.destinations.find((d) => d.slug === "hub")! } as unknown as Parameters<typeof resolveDeepLink>[0];
    const entry = resolveDeepLink(index, `?destination=${music.id}&return=${music.id}`);
    const before = process.env.NRVNA_WEB_PAGES;
    try {
      process.env.NRVNA_WEB_PAGES = "1";
      expect(webUrlOf(music)).toBe(music.webUrl);
      expect(withWebPages(entry).returnUrl).toBe(music.webUrl);
      expect(returnLabel(index, music.id)).toBe("Back to Music District on nrvnaverse.com");
      process.env.NRVNA_WEB_PAGES = "0";
      expect(webUrlOf(music)).toBe("https://www.nrvnaverse.com/");
      expect(withWebPages(entry)).toMatchObject({ returnUrl: "https://www.nrvnaverse.com/", returnToken: music.id });
      expect(returnLabel(index, music.id)).toBe("Back to nrvnaverse.com");
      expect(currentPageLabel(music)).toBe("More on nrvnaverse.com");
      expect(withWebPages({ ...entry, returnUrl: null, returnToken: null }).returnUrl).toBeNull();
    } finally {
      if (before === undefined) delete process.env.NRVNA_WEB_PAGES;
      else process.env.NRVNA_WEB_PAGES = before;
    }
  });

  it("the runtime lookup never throws and never invents an origin", () => {
    for (const name of [undefined, "", "nope", "__proto__", "constructor", "toString"]) expect(deploymentByName(name).name, String(name)).toBe("production");
    expect(deploymentByName("staging").webOrigin).toBe(DEPLOYMENT_PROFILES.staging.webOrigin);
  });
});

describe("indexing policy", () => {
  const paths = ["/", "/?destination=dst_7g19n1vm9ackw8a0", "/web-context/dst_gm3xs4a3tws7bgh3", "/api/destinations", "/api/health", "/data/spatial/spatial-index.json", "/data/spatial/chunks/hub.0123456789abcdef0123456789abcdef.json", "/assets/art/x.glb", "/robots.txt", "/_next/static/chunks/a.js"];

  it("a non-indexable build sends X-Robots-Tag noindex, nofollow on every response and disallows everything", () => {
    for (const path of paths) expect(headersFor(robotsHeaderRules(false), path)["X-Robots-Tag"], path).toEqual([NOINDEX]);
    expect(robotsFile(false)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("an indexable production build still never indexes the web-context panels, the API, the spatial data or the art", () => {
    const rules = robotsHeaderRules(true);
    for (const path of ["/", "/?destination=dst_7g19n1vm9ackw8a0", "/robots.txt"]) expect(headersFor(rules, path)["X-Robots-Tag"], path).toBeUndefined();
    for (const path of paths.filter((p) => /^\/(web-context|api|data|assets)\//.test(p))) expect(headersFor(rules, path)["X-Robots-Tag"], path).toEqual([NOINDEX]);
    expect(robotsFile(true)).toEqual({ rules: { userAgent: "*", allow: "/", disallow: ["/web-context/", "/api/", "/data/", "/assets/"] } });
  });

  it("the web-context panel exists only for public, ungated destinations (no overview of gated content is published)", () => {
    expect(GATED.length).toBeGreaterThan(0);
    const ids = webContextIds(data.destinations);
    for (const id of GATED) expect(ids, id).not.toContain(id);
    for (const d of data.destinations) expect(ids.includes(d.id), d.slug).toBe(d.status === "active" && d.gates.length === 0);
    for (const id of GATED) expect(hasWebContext(byId.get(id)!)).toBe(false);
    const page = readFileSync(join(APP_ROOT, "src/app/web-context/[id]/page.tsx"), "utf8");
    expect(page).toMatch(/return webContextIds\(data\.destinations\)/);
    expect(page).toMatch(/dynamicParams = false/); // an id outside the list is a 404, never rendered on demand
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
  });

  it("no in-world threshold points at a gated destination (so the shell never asks for such a panel)", () => {
    const index = JSON.parse(readFileSync(join(APP_ROOT, "public/data/spatial/spatial-index.json"), "utf8")) as { thresholds: Record<string, { destinationId: string }> };
    for (const [id, t] of Object.entries(index.thresholds)) expect(GATED, id).not.toContain(t.destinationId);
  });
});

describe("security headers and content-security policy", () => {
  it("every response carries the security headers; production CSP has no eval and no foreign framing", () => {
    const rules = securityHeaderRules({ development: false });
    for (const path of ["/", "/web-context/x", "/api/health", "/data/spatial/spatial-index.json"]) {
      const h = headersFor(rules, path);
      expect(h["X-Content-Type-Options"], path).toEqual(["nosniff"]);
      expect(h["X-Frame-Options"], path).toEqual(["SAMEORIGIN"]);
      expect(h["Referrer-Policy"], path).toEqual(["strict-origin-when-cross-origin"]);
      expect(h["Content-Security-Policy"], path).toHaveLength(1);
    }
    const csp = contentSecurityPolicy({ development: false });
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(csp).toMatch(/frame-ancestors 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
    expect(csp).not.toMatch(/\*/); // no wildcard source anywhere
    expect(contentSecurityPolicy({ development: true })).toMatch(/'unsafe-eval'/);
    // The engine's GPU benchmark origin is a connect-src only (data), never a script / image / frame source.
    for (const origin of ENGINE_THIRD_PARTY_CONNECT_ORIGINS) {
      for (const d of csp.split("; ")) expect(d.includes(origin), d).toBe(d.startsWith("connect-src "));
    }
  });

  it("the CSP admits every external origin the generated spatial data names — and the committed art origin", () => {
    const dir = join(APP_ROOT, "public/data/spatial");
    const files = [join(dir, "spatial-index.json"), ...["", "chunks", "layers"].flatMap((sub) => readdirSync(join(dir, sub)).filter((f) => f.endsWith(".json")).map((f) => join(dir, sub, f)))];
    const origins = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/"(https?:\/\/[^"/]+)/g)) origins.add(new URL(m[1]).origin);
    expect(origins.size).toBeGreaterThan(0);
    const allowed = new Set<string>([...RUNTIME_THIRD_PARTY_ORIGINS, ART_ORIGIN]);
    for (const origin of origins) expect(allowed.has(origin), origin).toBe(true);
    const config = JSON.parse(readFileSync(join(APP_ROOT, "spatial/source/spatial-config.m0.json"), "utf8"));
    expect(config.assetStorage["external-cas"].publicOrigin).toBe(ART_ORIGIN);
    const csp = contentSecurityPolicy({ development: false });
    for (const directive of ["img-src", "connect-src", "media-src"]) {
      const value = csp.split("; ").find((d) => d.startsWith(directive + " "))!;
      for (const origin of allowed) expect(value, directive).toContain(origin);
    }
  });

  it("a deployment's rules are the security headers plus its indexing rules", () => {
    expect(deploymentHeaderRules({ indexing: false }, { development: false })).toEqual([...securityHeaderRules({ development: false }), ...robotsHeaderRules(false)]);
  });
});

describe("WEB ↔ WORLD return contract (M4)", () => {
  const hub = data.destinations.find((d) => d.slug === "hub")!;
  const music = data.destinations.find((d) => d.slug === "music")!;
  const index = { byId, bySlug: new Map(), byPreviousSlug: new Map(), hub } as unknown as Parameters<typeof resolveDeepLink>[0];

  it("travel keeps the resolved return token in the URL (and only the allow-listed parameters)", () => {
    const entry = resolveDeepLink(index, `?destination=${music.id}&from=web&return=${music.id}`);
    const query = buildDeepLinkQuery(hub.id, { from: "spatial", ref: entry.ref ?? undefined, return: entry.returnToken ?? undefined });
    expect(parseDeepLink(query)).toEqual({ params: { destination: hub.id, from: "spatial", ref: null, return: music.id }, issues: [] });
    // An unresolvable return never survives into the next URL.
    const bad = resolveDeepLink(index, `?destination=${music.id}&return=dst_0000000000000000`);
    expect(buildDeepLinkQuery(hub.id, { from: "spatial", return: bad.returnToken ?? undefined })).toBe(`?destination=${hub.id}&from=spatial`);
  });

  it("the store writes the return token on travel and on walk-in handoffs", () => {
    const store = readFileSync(join(APP_ROOT, "src/lib/app-store.ts"), "utf8");
    const writes = [...store.matchAll(/buildDeepLinkQuery\(([^)]*)\)/g)].map((m) => m[1]);
    expect(writes).toHaveLength(2);
    for (const w of writes) expect(w).toContain("return: state.entry.returnToken ?? undefined");
  });

  it("a staging build sends every web link to the staging website with the canonical path — never to production", () => {
    const staging = deploymentByName("staging").webOrigin;
    for (const d of data.destinations) {
      const url = rebaseWebUrl(d.webUrl, staging);
      expect(url.startsWith(`${staging}/`), d.slug).toBe(true);
      expect(new URL(url).pathname).toBe(new URL(d.webUrl).pathname);
    }
    const entry = resolveDeepLink(index, `?destination=${music.id}&return=web`, { webRoot: staging });
    expect(entry.returnUrl).toBe(`${staging}/`);
  });
});
