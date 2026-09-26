/**
 * NRVNAVerse asset intake + publication CLI (M1.1).
 *
 *   pnpm --filter the-nrvnaverse asset:prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]
 *   pnpm --filter the-nrvnaverse asset:publish <out>/prepared/<assetId>.r<n>.json [--dry-run]
 *
 * prepare:
 * Validates the source, optimises it safely, validates the result, applies NRVNAVerse policy,
 * computes the revision / SHA-256 / content-addressed key, stages the bytes write-once under
 * `<out>/objects/<objectKey>` and writes the deterministic prepare report to
 * `<out>/prepared/<assetId>.r<revision>.json`. Default `<out>`: `.asset-staging/` in the app (ignored
 * by Git). It never uploads, never edits the committed registry or scene, and never sets a review.
 *
 * Exit codes: 0 ready for upload · 2 blocked (report written, blockers listed) · 1 usage / I/O error.
 *
 * publish: re-checks the prepare report's policy, then publishes the staged object write-once to
 * `external-cas` (Cloudflare R2, configured from NRVNA_ASSET_* environment variables) and verifies it
 * by full re-download. Writes `<out>/published/<assetId>.r<n>.json` (`.dry-run.json` with --dry-run,
 * which makes no network call at all). Never edits the registry, scenes, DNS or deployments.
 * Exit codes: 0 published / already published / planned · 2 blocked (nothing sent) · 1 failure.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssetRegistry } from "../spatial/assets.mjs";
import { loadSpatialSource, readAssetRegistry } from "../spatial/cli.mjs";
import { prepareAsset, stablePrepareJson, stagePrepared } from "./prepare-asset";
import { publishPrepared, stagingRootOf, type PublishOptions } from "./publish-asset";
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

/** The `publish` command, callable from tests with an injected environment and transport. */
export async function runPublish(argv: string[], inject: Partial<Pick<PublishOptions, "env" | "transportFor" | "committedStorage">> = {}): Promise<PrepareCommandResult> {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flags = argv.filter((a) => a.startsWith("--"));
  const unknown = flags.filter((f) => f !== "--dry-run");
  if (unknown.length || positional.length !== 1) {
    return { exitCode: 1, lines: [`${unknown.length ? `unknown option ${unknown[0]}\n` : ""}usage: asset:publish <out>/prepared/<assetId>.r<n>.json [--dry-run]`], reportPath: null };
  }
  const dryRun = flags.includes("--dry-run");
  const reportFile = resolve(positional[0]);
  let prepareReport: unknown;
  try {
    prepareReport = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch (error) {
    return { exitCode: 1, lines: [`cannot read prepare report: ${(error as Error).message}`], reportPath: null };
  }
  const committedStorage = inject.committedStorage !== undefined ? inject.committedStorage : ((loadSpatialSource().config as { assetStorage?: PublishOptions["committedStorage"] }).assetStorage ?? null);
  const report = await publishPrepared(prepareReport, stagingRootOf(reportFile), { env: inject.env ?? process.env, dryRun, committedStorage, transportFor: inject.transportFor });

  const plan = report.plan;
  const name = `${plan?.assetId ?? "unidentified"}.${plan ? `r${plan.revision}` : "invalid"}${dryRun ? ".dry-run" : ""}.json`;
  const reportPath = join(stagingRootOf(reportFile), "published", name);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [`${report.status.toUpperCase()}${dryRun ? " (dry run — no network calls)" : ""}: ${plan?.assetId ?? "(no asset)"}${plan ? ` revision ${plan.revision}` : ""}`];
  if (plan) {
    lines.push(`object   external-cas (${plan.adapter}) ${plan.objectKey}  ${plan.bytes} bytes  sha256 ${plan.sha256}`);
    lines.push(`headers  Content-Type ${plan.headers.contentType} · Cache-Control ${plan.headers.cacheControl}`);
    lines.push(`target   ${Object.entries(plan.target).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    lines.push(`url      ${plan.runtimeUrl ?? "(no valid public origin)"}`);
    if (dryRun) for (const op of plan.operations) lines.push(`would    ${op}`);
  }
  if (report.verification) lines.push(`verified ${report.verification.method}: ${report.verification.bytes} bytes sha256 ${report.verification.sha256}`);
  for (const b of report.blockers) lines.push(`BLOCKER  [${b.code}] ${b.message}`);
  if (report.failure) lines.push(`FAILED   [${report.failure.code}] ${report.failure.message}`);
  lines.push(`report   ${reportPath}`);
  for (const step of report.next) lines.push(`next     ${step}`);
  const exitCode = report.status === "blocked" ? 2 : report.status === "failed" ? 1 : 0;
  return { exitCode, lines, reportPath };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "prepare" && command !== "publish") {
    console.error("usage: cli.ts prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]\n       cli.ts publish <prepare-report.json> [--dry-run]");
    process.exit(1);
  }
  (command === "prepare" ? runPrepare(rest) : runPublish(rest)).then(
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
