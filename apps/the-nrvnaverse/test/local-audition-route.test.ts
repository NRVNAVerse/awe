import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "@/app/api/local-audition/[...path]/route";

/**
 * M2 local-only art audition route: candidate models with unresolved rights may be viewed on the
 * owner's machine, but a production build never serves them and nothing outside the configured
 * directory is reachable.
 */

const call = (path: string[]) => GET(new Request("http://localhost/api/local-audition/x"), { params: Promise.resolve({ path }) });
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, NRVNA_AUDITION_DIR: env.NRVNA_AUDITION_DIR };

afterEach(() => {
  env.NODE_ENV = saved.NODE_ENV;
  if (saved.NRVNA_AUDITION_DIR === undefined) delete env.NRVNA_AUDITION_DIR;
  else env.NRVNA_AUDITION_DIR = saved.NRVNA_AUDITION_DIR;
});

describe("local audition route", () => {
  it("serves a .json / .glb file from NRVNA_AUDITION_DIR in development", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nrvna-audition-"));
    try {
      writeFileSync(join(dir, "overlay-lineup.json"), '{"items":[]}');
      env.NRVNA_AUDITION_DIR = dir;
      const res = await call(["overlay-lineup.json"]);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.text()).toBe('{"items":[]}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is 404 in production, whatever is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nrvna-audition-"));
    try {
      writeFileSync(join(dir, "overlay-lineup.json"), "{}");
      env.NRVNA_AUDITION_DIR = dir;
      env.NODE_ENV = "production";
      expect((await call(["overlay-lineup.json"])).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is 404 without a configured directory, for other file types and for any path that is not a plain file name", async () => {
    delete env.NRVNA_AUDITION_DIR;
    expect((await call(["overlay-lineup.json"])).status).toBe(404);
    env.NRVNA_AUDITION_DIR = tmpdir();
    expect((await call(["secret.txt"])).status).toBe(404);
    expect((await call(["..", "x.glb"])).status).toBe(404);
    expect((await call(["sub", "x.glb"])).status).toBe(404);
    expect((await call(["..%2Fx.glb"])).status).toBe(404);
    expect((await call([".hidden.json"])).status).toBe(404);
  });
});
