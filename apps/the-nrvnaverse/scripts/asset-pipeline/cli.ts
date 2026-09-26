/**
 * NRVNAVerse asset intake CLI (M1.1).
 *
 *   pnpm --filter the-nrvnaverse asset:prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]
 *
 * Validates the source, optimises it safely, validates the result, applies NRVNAVerse policy,
 * computes the revision / SHA-256 / content-addressed key, stages the bytes write-once under
 * `<out>/objects/<objectKey>` and writes the deterministic prepare report to
 * `<out>/prepared/<assetId>.r<revision>.json`. Default `<out>`: `.asset-staging/` in the app (ignored
 * by Git). It never uploads, never edits the committed registry or scene, and never sets a review.
 *
 * Exit codes: 0 ready for upload · 2 blocked (report written, blockers listed) · 1 usage / I/O error.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssetRegistry } from "../spatial/assets.mjs";
import { readAssetRegistry } from "../spatial/cli.mjs";
import { prepareAsset, stablePrepareJson, stagePrepared } from "./prepare-asset";
import { localStagingAdapter } from "./staging";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_STAGING_DIR = join(APP_ROOT, ".asset-staging");

export interface PrepareCommandResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
  reportPath: string | null;
}

/** The `prepare` command, callable from tests without spawning a process. */
export async function runPrepare(argv: string[]): Promise<PrepareCommandResult> {
  const positional: string[] = [];
  let registryPath: string | null = null;
  let out = DEFAULT_STAGING_DIR;
  let draco = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--registry") registryPath = argv[++i] ?? null;
    else if (arg === "--out") out = argv[++i] ?? out;
    else if (arg === "--draco") draco = true;
    else if (arg.startsWith("--")) return { exitCode: 1, lines: [`unknown option ${arg}`], reportPath: null };
    else positional.push(arg);
  }
  if (positional.length !== 2) {
    return { exitCode: 1, lines: ["usage: asset:prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]"], reportPath: null };
  }
  const [sourcePath, metadataPath] = positional.map((p) => resolve(p));

  let sourceBytes: Uint8Array;
  let metadata: unknown;
  try {
    sourceBytes = new Uint8Array(readFileSync(sourcePath));
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    return { exitCode: 1, lines: [`cannot read input: ${(error as Error).message}`], reportPath: null };
  }
  let registry: AssetRegistry | null = null;
  if (registryPath) {
    try {
      registry = readAssetRegistry(resolve(registryPath)) as AssetRegistry;
    } catch (error) {
      return { exitCode: 1, lines: [`cannot read registry: ${(error as Error).message}`], reportPath: null };
    }
  }

  const result = await prepareAsset(sourceBytes, metadata, { registry, optimize: draco ? { draco: true } : {} });
  const { report } = result;
  const lines: string[] = [];
  const staged = await stagePrepared(result, localStagingAdapter(out, report.artifact?.storage.backend));
  if (staged && !staged.verified) {
    report.blockers.push({ code: "staging-verify-failed", message: staged.problem ?? "staged bytes did not verify" });
    report.status = "blocked";
  }

  const name = `${report.assetId ?? "unidentified"}.${report.revision ? `r${report.revision}` : "invalid"}.json`;
  const reportPath = join(out, "prepared", name);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stablePrepareJson(report));

  lines.push(`${report.status.toUpperCase()}: ${report.assetId ?? "(no asset id)"}${report.revision ? ` revision ${report.revision}` : ""}`);
  lines.push(`source   ${report.source.bytes} bytes  sha256 ${report.source.sha256}`);
  if (report.artifact) {
    const o = report.optimization;
    lines.push(`artifact ${report.artifact.bytes} bytes  sha256 ${report.artifact.sha256}  (${o.result}${o.skipCode ? `: ${o.skipCode}` : ""}${o.percentChange !== null ? `, ${o.percentChange}%` : ""})`);
    lines.push(`key      ${report.artifact.storage.backend}:${report.artifact.storage.objectKey}`);
  }
  if (staged) lines.push(`staged   ${staged.location} (${staged.created ? "written" : "already present, identical"}; verified ${staged.verified})`);
  for (const b of report.blockers) lines.push(`BLOCKER  [${b.code}] ${b.message}`);
  for (const w of report.warnings) lines.push(`warning  [${w.code}] ${w.message}`);
  lines.push(`report   ${reportPath}`);
  for (const step of report.next) lines.push(`next     ${step}`);
  return { exitCode: report.status === "ready" ? 0 : 2, lines, reportPath };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "prepare") {
    console.error("usage: cli.ts prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]");
    process.exit(1);
  }
  runPrepare(rest).then(
    (r) => {
      (r.exitCode === 0 ? console.log : console.error)(r.lines.join("\n"));
      process.exit(r.exitCode);
    },
    (error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exit(1);
    },
  );
}
