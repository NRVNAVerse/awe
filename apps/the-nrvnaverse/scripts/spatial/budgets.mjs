// @ts-check
/**
 * Initial M0 spatial WARNING budgets (M0 Step 2B.4C.2). Pure, dependency-free; consumed by
 * `spatial:check` (cli.mjs) and the vitest suite.
 *
 * These are warning guardrails, not hard limits and not production / world-capacity claims. They
 * only cover the runtime artifacts the browser actually fetches: the global scene and each chunk
 * file (`spatial/global-scene.<token>.json`, `spatial/chunks/<key>.<token>.json`). The compatibility
 * full scene (`static-scene.json`) and the spatial index are deliberately not budgeted.
 *
 * Evidence basis (2B.4C.1 audit, 2026-09-20): the committed M0 placeholder artifacts are ≈7–10 KiB
 * and 7–9 components each. 64 KiB / 64 components is deliberately generous early-warning headroom
 * (roughly 6–9× the current placeholder baseline, depending on metric and artifact) meant to expose
 * accidental growth during M0. The thresholds are warning-only; they are NOT network round-trip
 * guarantees (the budget is raw serialized bytes, while transfer depends on compression, protocol,
 * RTT and cache state), NOT staging-time guarantees (component count does not predict staging cost
 * once real GLBs, materials, textures, scripts or more expensive component types arrive), NOT
 * production capacity limits and NOT representative-art budgets. The audit's staging observations
 * (≈8–15 ms warm, ≈28–48 ms under a 4× CPU slowdown for a 9-component placeholder chunk) describe
 * the current placeholder components only. Re-evaluate at the first representative art vertical
 * slice.
 */

/** Warning thresholds. Bytes are the serialized (LF) artifact text; counts are top-level components. */
export const SPATIAL_WARNING_BUDGETS = Object.freeze({
  /** 64 KiB per runtime global-scene / chunk artifact. */
  artifactBytes: 64 * 1024,
  /** 64 components per runtime global-scene / chunk artifact. */
  artifactComponents: 64,
});

/**
 * @typedef {{
 *   artifact: string;
 *   scope: "global" | "chunk";
 *   chunkKey: string | null;
 *   metric: "bytes" | "components";
 *   actual: number;
 *   threshold: number;
 * }} SpatialBudgetWarning
 * @typedef {{ files: Record<string, string>; globalSceneFile: string; chunkFiles: Record<string, string> }} BudgetedArtifacts
 */

/**
 * Number of top-level components in a serialized scene / chunk artifact (both envelopes carry a
 * `components` record keyed by component id). Malformed text counts as zero components rather than
 * throwing: budgets never turn a check failure into a different failure.
 * @param {string} serialized
 */
export function countArtifactComponents(serialized) {
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(serialized));
    if (typeof parsed !== "object" || parsed === null) return 0;
    const components = /** @type {Record<string, unknown>} */ (parsed).components;
    if (typeof components !== "object" || components === null) return 0;
    return Array.isArray(components) ? components.length : Object.keys(components).length;
  } catch {
    return 0;
  }
}

/**
 * Evaluate the warning budgets against a generation. Returns one entry per exceeded metric, in a
 * stable order (global scene first, then chunks by key). Never throws for a well-formed generation.
 * @param {BudgetedArtifacts} artifacts
 * @param {{ artifactBytes?: number; artifactComponents?: number }} [budgets]
 * @returns {SpatialBudgetWarning[]}
 */
export function spatialBudgetWarnings(artifacts, budgets = SPATIAL_WARNING_BUDGETS) {
  const bytesLimit = budgets.artifactBytes ?? SPATIAL_WARNING_BUDGETS.artifactBytes;
  const componentsLimit = budgets.artifactComponents ?? SPATIAL_WARNING_BUDGETS.artifactComponents;
  /** @type {SpatialBudgetWarning[]} */
  const warnings = [];
  /** @type {Array<{ artifact: string; scope: "global" | "chunk"; chunkKey: string | null }>} */
  const targets = [{ artifact: artifacts.globalSceneFile, scope: "global", chunkKey: null }];
  for (const chunkKey of Object.keys(artifacts.chunkFiles).sort()) targets.push({ artifact: artifacts.chunkFiles[chunkKey], scope: "chunk", chunkKey });
  for (const target of targets) {
    const text = artifacts.files[target.artifact];
    if (typeof text !== "string") continue;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > bytesLimit) warnings.push({ ...target, metric: "bytes", actual: bytes, threshold: bytesLimit });
    const components = countArtifactComponents(text);
    if (components > componentsLimit) warnings.push({ ...target, metric: "components", actual: components, threshold: componentsLimit });
  }
  return warnings;
}

/**
 * Human-readable line for one warning, naming the artifact / chunk, the actual value and the threshold.
 * @param {SpatialBudgetWarning} warning
 */
export function formatSpatialBudgetWarning(warning) {
  const what = warning.scope === "global" ? "runtime global scene" : `runtime chunk "${warning.chunkKey}"`;
  const unit = warning.metric === "bytes" ? "bytes" : "components";
  return `budget warning: ${what} ${warning.artifact} is ${warning.actual} ${unit} (initial M0 warning threshold ${warning.threshold} ${unit}) — warning only, check still succeeds`;
}
