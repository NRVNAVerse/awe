import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SPATIAL_WARNING_BUDGETS, countArtifactComponents, formatSpatialBudgetWarning, spatialBudgetWarnings } from "../scripts/spatial/budgets.mjs";
import { checkArtifacts, loadSpatialSource, writeArtifacts } from "../scripts/spatial/cli.mjs";
import { OUTPUT, generateSpatialArtifacts } from "../scripts/spatial/pipeline.mjs";

/**
 * M0 Step 2B.4C.2 — initial spatial WARNING budgets, raised for the M1 Hub composition (2026-10-13):
 * 128 KiB / 96 components per runtime
 * global-scene or chunk artifact, warning-only: `spatial:check` reports them and still succeeds
 * when the artifacts are otherwise valid and current, while stale / missing / unexpected artifacts
 * fail exactly as before. Static-scene.json and spatial-index.json are never budgeted.
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const realSource = loadSpatialSource();
type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function generation(mutate?: (draft: { config: Mutable; scene: Mutable }) => void) {
  const draft = structuredClone(realSource) as { config: Mutable; scene: Mutable; destinations: unknown };
  mutate?.(draft);
  return generateSpatialArtifacts(draft);
}

/** Add `n` valid mesh components to a chunk (or to the global set) so the generation stays valid. */
function addComponents(draft: { config: Mutable; scene: Mutable }, n: number, target: { chunkKey: string } | "global", payloadBytes = 0) {
  const ids: string[] = [];
  const padding = "x".repeat(payloadBytes);
  for (let i = 0; i < n; i++) {
    const id = `budget-test-${target === "global" ? "global" : target.chunkKey}-${i}`;
    draft.scene.components[id] = {
      id,
      type: "mesh",
      name: `Budget test ${i}${padding ? ` ${padding}` : ""}`,
      position: { x: 500 + i, y: 0, z: 500 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    ids.push(id);
  }
  if (target === "global") draft.config.global.componentIds.push(...ids);
  else draft.config.chunks.find((c: Mutable) => c.key === target.chunkKey).componentIds.push(...ids);
}

let out: string;
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "nrvnaverse-spatial-budgets-"));
});
afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("spatial warning budgets (2B.4C.2, raised for M1)", () => {
  it("thresholds are 128 KiB and 96 components per runtime artifact", () => {
    expect(SPATIAL_WARNING_BUDGETS).toEqual({ artifactBytes: 131072, artifactComponents: 96 });
  });

  it("the committed generation emits no warnings (Hub ≈90 KiB / 74 components; other chunks ≈7–10 KiB, 7–9 components)", () => {
    const gen = generation();
    expect(spatialBudgetWarnings(gen)).toEqual([]);
    const bytes = (name: string) => Buffer.byteLength(gen.files[name], "utf8");
    expect(bytes(gen.globalSceneFile)).toBeLessThan(16 * 1024);
    for (const key of gen.chunkKeys) {
      const limitBytes = key === "hub" ? 128 * 1024 : 16 * 1024;
      const limitComponents = key === "hub" ? 96 : 9;
      expect(bytes(gen.chunkFiles[key]), key).toBeLessThan(limitBytes);
      expect(countArtifactComponents(gen.files[gen.chunkFiles[key]]), key).toBeLessThanOrEqual(limitComponents);
    }
    expect(countArtifactComponents(gen.files[gen.globalSceneFile])).toBe(7);
  });

  it("a runtime chunk artifact above 128 KiB warns, naming the chunk, the actual bytes and the threshold", () => {
    // Three padded components push the Music chunk past 128 KiB without exceeding the component budget.
    const gen = generation((d) => addComponents(d, 3, { chunkKey: "music" }, 48 * 1024));
    const warnings = spatialBudgetWarnings(gen);
    expect(warnings).toHaveLength(1);
    const [w] = warnings;
    expect(w.scope).toBe("chunk");
    expect(w.chunkKey).toBe("music");
    expect(w.artifact).toBe(gen.chunkFiles.music);
    expect(w.metric).toBe("bytes");
    expect(w.actual).toBe(Buffer.byteLength(gen.files[gen.chunkFiles.music], "utf8"));
    expect(w.actual).toBeGreaterThan(131072);
    expect(w.threshold).toBe(131072);
    const line = formatSpatialBudgetWarning(w);
    expect(line).toContain('runtime chunk "music"');
    expect(line).toContain(gen.chunkFiles.music);
    expect(line).toContain(`${w.actual} bytes`);
    expect(line).toContain("131072 bytes");
    expect(line).toContain("warning only");
  });

  it("a runtime global-scene artifact above 128 KiB warns as the global scene", () => {
    const gen = generation((d) => addComponents(d, 3, "global", 48 * 1024));
    const warnings = spatialBudgetWarnings(gen);
    expect(warnings.map((w) => [w.scope, w.metric])).toEqual([["global", "bytes"]]);
    expect(warnings[0].artifact).toBe(gen.globalSceneFile);
    expect(formatSpatialBudgetWarning(warnings[0])).toContain("runtime global scene");
  });

  it("more than 96 components in a chunk warns on the component count (and only that chunk)", () => {
    const gen = generation((d) => addComponents(d, 87, { chunkKey: "music" })); // 9 + 87 = 96 → exactly at the limit: no warning
    expect(spatialBudgetWarnings(gen)).toEqual([]);
    const over = generation((d) => addComponents(d, 88, { chunkKey: "music" })); // 97
    const warnings = spatialBudgetWarnings(over);
    expect(warnings.map((w) => [w.scope, w.chunkKey, w.metric, w.actual, w.threshold])).toEqual([["chunk", "music", "components", 97, 96]]);
  });

  it("more than 96 global components warns on the global scene", () => {
    const over = generation((d) => addComponents(d, 90, "global")); // 7 + 90 = 97
    const warnings = spatialBudgetWarnings(over);
    expect(warnings.map((w) => [w.scope, w.metric, w.actual])).toEqual([["global", "components", 97]]);
  });

  it("both metrics can warn for one artifact, ordered global scene first then chunks by key", () => {
    const gen = generation((d) => {
      addComponents(d, 90, { chunkKey: "music" }, 2 * 1024); // 99 components, well over 128 KiB
      addComponents(d, 90, "global");
    });
    const warnings = spatialBudgetWarnings(gen);
    expect(warnings.map((w) => `${w.scope}:${w.chunkKey ?? "-"}:${w.metric}`)).toEqual(["global:-:components", "chunk:music:bytes", "chunk:music:components"]);
  });

  it("static-scene.json and spatial-index.json are never budgeted", () => {
    const gen = generation((d) => addComponents(d, 64, { chunkKey: "music" }, 2 * 1024)); // ≈141 KiB: static scene grows past 128 KiB too
    expect(Buffer.byteLength(gen.files[OUTPUT.compatibilityScene], "utf8")).toBeGreaterThan(131072);
    const warnings = spatialBudgetWarnings(gen);
    expect(warnings.every((w) => w.artifact !== OUTPUT.compatibilityScene && w.artifact !== OUTPUT.spatialIndex)).toBe(true);
    expect(warnings.map((w) => w.chunkKey)).toEqual(["music"]);
  });

  it("countArtifactComponents tolerates malformed text (0) so a budget can never change a check outcome", () => {
    expect(countArtifactComponents("not json")).toBe(0);
    expect(countArtifactComponents('{"components":null}')).toBe(0);
    expect(countArtifactComponents('{"components":{"a":{},"b":{}}}')).toBe(2);
    expect(spatialBudgetWarnings({ files: {}, globalSceneFile: "missing", chunkFiles: { hub: "missing-too" } })).toEqual([]);
  });

  it("warnings do not change a successful check: an over-budget but current generation is up to date", () => {
    const gen = generation((d) => addComponents(d, 3, { chunkKey: "music" }, 48 * 1024));
    writeArtifacts(gen.files, out);
    expect(checkArtifacts(gen.files, out)).toEqual({ upToDate: true, stale: [], unexpected: [] });
    expect(spatialBudgetWarnings(gen)).toHaveLength(1);
  });

  it("stale / missing / unexpected artifacts still fail the check exactly as before, budget or not", () => {
    const gen = generation((d) => addComponents(d, 3, { chunkKey: "music" }, 48 * 1024));
    writeArtifacts(gen.files, out);
    const current = generation(); // the committed shape: the padded Music file is now unexpected and the real one missing
    const check = checkArtifacts(current.files, out);
    expect(check.upToDate).toBe(false);
    expect(check.stale).toContain(current.chunkFiles.music);
    expect(check.unexpected).toEqual([gen.chunkFiles.music]);
  });

  it("the real `spatial:check` exits 0 for the committed artifacts and reports them within budget", () => {
    const result = spawnSync(process.execPath, [join(APP_ROOT, "scripts", "spatial", "cli.mjs"), "check"], { cwd: APP_ROOT, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("within budget");
    expect(result.stderr).not.toContain("budget warning");
  });
});
