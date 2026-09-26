/**
 * The ONE seam through which NRVNAVerse consumes the generic AWE glTF capabilities (M1.1):
 * H1 `optimizeModel()` and H2 `validateModel()` from `packages/tools/src/gltf`
 * (adopted from the consumer-reference baseline TheCannaMan/awe@120ec0c).
 *
 * AWE owns GLB / glTF structural and runtime facts, generic optimisation and generic statistics.
 * NRVNAVerse owns identity, provenance, rights, review, budgets, revisions, digests, storage and
 * spatial binding (`prepare-asset.ts`). This file only states WHICH generic facts NRVNAVerse reads —
 * a narrow structural contract — and loads the implementation at run time.
 *
 * Why a run-time import instead of a package dependency: the app does not declare
 * `@oncyberio/tools` (D-014, no dependency change in this slice), and a static import would pull the
 * tools sources into the app's strict type-check under different compiler settings. The report
 * versions below are asserted at load, and the pipeline tests run the real implementation, so drift
 * fails loudly. Declaring `@oncyberio/tools` and importing `@oncyberio/tools/gltf` later replaces
 * only {@link loadAweGltf}.
 *
 * Node only (sharp + draco3dgltf, resolved from the tools package).
 */

/** Report schema versions this seam was written against. A bump is a deliberate re-read, not drift. */
export const AWE_OPTIMIZE_REPORT_VERSION = 1;
export const AWE_VALIDATE_REPORT_VERSION = 1;

const TOOLS_GLTF_ENTRY = new URL("../../../../packages/tools/src/gltf/index.ts", import.meta.url).href;

export interface AweIssue {
  code: string;
  message: string;
  pointer?: string;
}

export interface AweRuntimeFact {
  support: "supported" | "ignored" | "partial" | "unsupported";
  note: string;
}

export interface AweTextureStats {
  textures: number;
  images: number;
  bytes: number;
  maxWidth: number | null;
  maxHeight: number | null;
  byMimeType: Record<string, number>;
}

/** The subset of H2's `ModelReport` NRVNAVerse reads. */
export interface AweModelReport {
  kind: "gltf-validate";
  reportVersion: number;
  level: string;
  valid: boolean;
  errors: AweIssue[];
  warnings: AweIssue[];
  file: { bytes: number; container: "glb" | "gltf-json" | "unknown" };
  extensions: {
    used: string[];
    required: string[];
    unknown: string[];
    notRoundTrippable: string[];
    runtime: Record<string, AweRuntimeFact>;
  };
  resources: { selfContained: boolean; external: unknown[] };
  counts: {
    scenes: number;
    nodes: number;
    meshes: number;
    primitives: number;
    triangles: number | null;
    trianglesInstanced: number | null;
    vertices: number | null;
    materials: number;
    textures: number;
    images: number;
    animations: number;
    skins: number;
    morphTargets: number | null;
    lights: number;
  };
  bounds: { min: number[]; max: number[]; size: number[] } | null;
  textures: AweTextureStats;
  statsSource: "document" | "header" | "none";
  elapsedMs: number;
}

/** H1's optimiser options (`SafeOptimizeOptions`, minus the test seam). */
export interface AweOptimizeOptions {
  draco?: boolean;
  textures?: "webp" | "keep";
  maxTextureSize?: number;
  quality?: number;
  timeoutMs?: number;
}

/** The subset of H1's `OptimizeModelReport` NRVNAVerse reads. */
export interface AweOptimizeReport {
  kind: "gltf-optimize";
  reportVersion: number;
  optimized: boolean;
  changed: boolean;
  skipCode: string | null;
  skipReason: string | null;
  bytes: { input: number; output: number; candidate: number | null };
  percentChange: number;
  transforms: { attempted: string[]; applied: string[]; skipped: Array<{ id: string; code: string; reason: string }> };
  steps: string[];
  elapsedMs: number;
}

export interface AweGltf {
  validateModel(bytes: Uint8Array, options?: { headerOnly?: boolean }): Promise<AweModelReport>;
  optimizeModel(bytes: Uint8Array, options?: AweOptimizeOptions): Promise<{ buffer: Uint8Array; report: AweOptimizeReport }>;
}

let loaded: Promise<AweGltf> | null = null;

/** Load the generic AWE glTF module once, refusing a report-version mismatch. */
export function loadAweGltf(): Promise<AweGltf> {
  loaded ??= import(/* @vite-ignore */ TOOLS_GLTF_ENTRY).then((mod: Record<string, unknown>) => {
    if (typeof mod.optimizeModel !== "function" || typeof mod.validateModel !== "function") {
      throw new Error("the AWE glTF module does not export optimizeModel / validateModel");
    }
    if (mod.OPTIMIZE_REPORT_VERSION !== AWE_OPTIMIZE_REPORT_VERSION || mod.VALIDATE_REPORT_VERSION !== AWE_VALIDATE_REPORT_VERSION) {
      throw new Error(
        `AWE glTF report versions changed (optimize ${String(mod.OPTIMIZE_REPORT_VERSION)}, validate ${String(mod.VALIDATE_REPORT_VERSION)}; ` +
          `this seam expects ${AWE_OPTIMIZE_REPORT_VERSION} / ${AWE_VALIDATE_REPORT_VERSION}) — re-read the reports before adopting`,
      );
    }
    return mod as unknown as AweGltf;
  });
  return loaded;
}
