import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDebugMode } from "../src/lib/debug-mode";

/**
 * First-live launch shell: visitors see a product, diagnostics stay available behind an explicit
 * gate. The gate decision is tested directly; the shell wiring is pinned by source scan (the vitest
 * environment has no DOM — same technique as mobile-shell.test.ts). The rendered result is checked
 * by the production-build browser smoke.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (file: string) => readFileSync(join(APP_ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("diagnostics gate", () => {
  it("is on in development and off for production visitors by default", () => {
    expect(resolveDebugMode({ nodeEnv: "development", search: "", stored: null })).toEqual({ enabled: true, persist: undefined });
    expect(resolveDebugMode({ nodeEnv: "production", search: "", stored: null })).toEqual({ enabled: false, persist: undefined });
    expect(resolveDebugMode({ nodeEnv: "production", search: "?destination=dst_x&from=web", stored: null }).enabled).toBe(false);
  });

  it("?debug=1 opts in and persists (travel rewrites the URL); ?debug=0 opts out and clears", () => {
    expect(resolveDebugMode({ nodeEnv: "production", search: "?debug=1", stored: null })).toEqual({ enabled: true, persist: "1" });
    expect(resolveDebugMode({ nodeEnv: "production", search: "?destination=dst_x", stored: "1" })).toEqual({ enabled: true, persist: undefined });
    expect(resolveDebugMode({ nodeEnv: "production", search: "?debug=0", stored: "1" })).toEqual({ enabled: false, persist: null });
    expect(resolveDebugMode({ nodeEnv: "production", search: "?debug=true", stored: null }).enabled).toBe(false);
  });
});

describe("visitor shell — engineering presentation only behind the gate", () => {
  const shell = src("src/components/app-shell.tsx");
  const card = src("src/components/destination-view.tsx");

  it("renders the milestone label, phase readouts, raw error text and the spatial panel only when debug", () => {
    expect(shell).toMatch(/const debug = useDebugMode\(\)/);
    expect(shell).toMatch(/\{debug && \(\s*<>\s*<p[^>]*data-debug="milestone">\{APP_IDENTITY\.milestone\}/);
    expect(shell).toMatch(/\{debug && \(\s*<p[^>]*data-debug="loading-phase"/);
    expect(shell).toMatch(/\{debug && <p[^>]*data-debug="error-message">\{state\.message\}/);
    expect(shell).toMatch(/\{debug && <SpatialPanel state=\{state\} \/>\}/);
    // No ungated occurrence of the milestone or a phase readout remains.
    expect(shell.match(/APP_IDENTITY\.milestone/g)).toHaveLength(1);
    expect(shell.match(/phase: <code>/g)).toHaveLength(2);
  });

  it("keeps machine-readable hooks for the browser probes regardless of the gate", () => {
    expect(shell).toMatch(/<header[^>]*data-app-phase=\{state\.phase\}/);
    for (const probe of ["scripts/browser/perf-probe.mjs", "scripts/browser/touch-regression.mjs"]) {
      expect(src(probe)).toContain(`document.querySelector("header[data-app-phase]")?.getAttribute("data-app-phase")`);
      expect(src(probe)).not.toContain(`querySelector("header code")`);
    }
  });

  it("offers visitors a retry and a way back on error, and shows the current destination by name", () => {
    expect(shell).toMatch(/Try again/);
    expect(shell).toMatch(/window\.location\.reload\(\)/);
    expect(shell).toMatch(/data-current-destination=\{state\.current\.id\}/);
  });

  it("the destination card hides manifest ids / slug / capabilities from visitors", () => {
    expect(card).toMatch(/\{debug && \(\s*<dl data-debug="destination"/);
    expect(card).toMatch(/data-visitor-gate/);
    expect(src("src/lib/app-identity.ts")).toMatch(/tagline:/);
  });
});
