import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GET, dynamic } from "../src/app/api/health/route";
import { releaseInfo } from "../src/lib/release-info";

/**
 * First-live hosting readiness (docs/NRVNAVERSE_HOSTING.md): the health endpoint reveals only
 * non-sensitive facts, the production build fails closed on stale generated data, the client
 * bundle reads no configuration beyond NODE_ENV, and the app has no multiplayer endpoint.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = JSON.parse(readFileSync(join(APP_ROOT, "public/data/spatial/spatial-index.json"), "utf8"));

describe("/api/health", () => {
  it("answers 200, no-store, with deployment identity only", async () => {
    expect(dynamic).toBe("force-dynamic");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["app", "environment", "manifestSchemaVersion", "release", "spatial", "status"]);
    expect(body).toMatchObject({ status: "ok", app: "the-nrvnaverse", manifestSchemaVersion: 1, spatial: { worldId: "the-nrvnaverse", indexSchemaVersion: 1 } });
    expect(body.spatial.globalSceneVersion).toMatch(/^[0-9a-f]{32}$/);
    expect(INDEX.globalSceneUrl).toContain(body.spatial.globalSceneVersion);
    expect(body.spatial.chunks).toBe(Object.keys(INDEX.chunks).length);
  });

  it("echoes NRVNA_RELEASE_ID only when it is a plain identifier, and never other environment", () => {
    const env = {
      NODE_ENV: "production",
      NRVNA_RELEASE_ID: "c2db328",
      NRVNA_ASSET_R2_SECRET_ACCESS_KEY: "must-never-appear",
      HOME: "/home/runner",
      PATH: "/usr/bin",
    };
    const info = releaseInfo(env, INDEX);
    expect(info).toMatchObject({ environment: "production", release: "c2db328" });
    expect(JSON.stringify(info)).not.toMatch(/must-never-appear|home\/runner|usr\/bin/);
    for (const bad of ["../../etc", "<script>", "a b", "x".repeat(65), ""]) expect(releaseInfo({ NRVNA_RELEASE_ID: bad }, INDEX).release, bad).toBeNull();
    expect(releaseInfo({}, INDEX)).toMatchObject({ environment: "development", release: null });
  });
});

describe("production build + runtime configuration", () => {
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));

  it("the production build fails closed on stale spatial or manifest generated data", () => {
    expect(pkg.scripts.build).toBe("pnpm run release:check && next build --turbopack");
    expect(pkg.scripts["release:check"]).toBe("node scripts/spatial/cli.mjs check && tsx ../../packages/nrvna-manifest/src/node/cli.ts check");
  });

  it("app code reads no environment beyond NODE_ENV outside the server-only health route, and no NEXT_PUBLIC value", () => {
    const files = ["src/lib/app-store.ts", "src/lib/debug-mode.ts", "src/lib/perf.ts", "src/components/app-shell.tsx", "next.config.ts"];
    for (const f of files) {
      const text = readFileSync(join(APP_ROOT, f), "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) expect(m[1], f).toBe("NODE_ENV");
      expect(text, f).not.toMatch(/NEXT_PUBLIC_/);
    }
  });

  it("has no multiplayer / localhost endpoint in the shipped app (first live does not need multiplayer)", () => {
    expect(Object.keys(pkg.dependencies)).not.toEqual(expect.arrayContaining([expect.stringMatching(/colyseus|multiplayer/)]));
    for (const f of ["src/lib/app-store.ts", "src/lib/spatial/awe-spatial-adapter.ts", "src/components/engine-canvas.tsx", "next.config.ts"]) {
      expect(readFileSync(join(APP_ROOT, f), "utf8"), f).not.toMatch(/localhost|:2567|wss?:\/\/|colyseus/i);
    }
  });
});
