/**
 * NRVNAVerse asset intake + publication CLI (M1.1).
 *
 *   pnpm --filter the-nrvnaverse asset:prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]
 *   pnpm --filter the-nrvnaverse asset:publish <out>/prepared/<assetId>.r<n>.json [--dry-run]
 *   pnpm --filter the-nrvnaverse asset:register <out>/published/<assetId>.r<n>.json [--apply]
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
 *
 * register: turns a VERIFIED publication into the exact committed registry revision. Default is a
 * deterministic PROPOSAL (diff printed, report written, nothing changed); `--apply` writes
 * `spatial/source/<registry>.json` (declaring it in the spatial config the first time). Never adds
 * `assetRef` to a scene, never sets a review, never contacts storage.
 * Exit codes: 0 proposed / applied / already registered · 2 blocked · 1 usage / I/O error.
 *
 * place: `asset:place <assetId> --destination <dst_id> --component <id> --position x,y,z [--rotation x,y,z]
 * [--scale x,y,z|s] [--name <text>] [--apply]` puts a registered, production-eligible asset into the
 * destination's chunk as a `model` component with `assetRef` (never a URL). Default: proposal only;
 * `--apply` writes the scene + config, regenerates spatial data and lists what changed.
 * Exit codes: 0 proposed / applied / already placed · 2 blocked · 1 usage / I/O error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssetRegistry } from "../spatial/assets.mjs";
import { DESTINATIONS_FILE, OUTPUT_DIR, SOURCE_CONFIG, SOURCE_DIR, loadSpatialSource, readAssetRegistry, removeStaleArtifacts, writeArtifacts } from "../spatial/cli.mjs";
import { generateSpatialArtifacts, type SpatialSourceInput } from "../spatial/pipeline.mjs";
import { parseVec3, planPlacement, type Vec3 } from "./place-asset";
import { REGISTER_REPORT_VERSION, applyRegistration, describeChanges, planRegistration, siblingsOf, type RegisterReport } from "./register-asset";
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

/** Read a spatial source directory the way `spatial:*` does (config, scene, destinations, declared registry). */
function loadSourceFrom(sourceDir: string, configFile: string): SpatialSourceInput {
  const config = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
  const scene = JSON.parse(readFileSync(join(sourceDir, String(config.scene)), "utf8"));
  const destinations = JSON.parse(readFileSync(DESTINATIONS_FILE, "utf8"));
  if (typeof config.assetRegistry !== "string") return { config, scene, destinations };
  const registryPath = join(sourceDir, config.assetRegistry);
  return { config, scene, destinations, assets: existsSync(registryPath) ? readAssetRegistry(registryPath) : null };
}

/** The `register` command. `sourceDir` / `configFile` are injectable for tests (default: the committed source). */
export async function runRegister(argv: string[], inject: { sourceDir?: string; configFile?: string } = {}): Promise<PrepareCommandResult> {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--apply");
  if (unknown.length || positional.length !== 1) {
    return { exitCode: 1, lines: [`${unknown.length ? `unknown option ${unknown[0]}\n` : ""}usage: asset:register <out>/published/<assetId>.r<n>.json [--apply]`], reportPath: null };
  }
  const apply = argv.includes("--apply");
  const reportFile = resolve(positional[0]);
  const sourceDir = inject.sourceDir ?? SOURCE_DIR;
  const configFile = inject.configFile ?? (inject.sourceDir ? join(sourceDir, "spatial-config.m0.json") : SOURCE_CONFIG);
  let publishReport: unknown;
  let source: SpatialSourceInput;
  try {
    publishReport = JSON.parse(readFileSync(reportFile, "utf8"));
    source = inject.sourceDir ? loadSourceFrom(sourceDir, configFile) : (loadSpatialSource() as SpatialSourceInput);
  } catch (error) {
    return { exitCode: 1, lines: [`cannot read input: ${(error as Error).message}`], reportPath: null };
  }
  const siblings = siblingsOf(reportFile, publishReport as never);
  const prepareReport = siblings.prepareReport ? JSON.parse(readFileSync(siblings.prepareReport, "utf8")) : null;
  const stagedBytes = siblings.stagedObject ? new Uint8Array(readFileSync(siblings.stagedObject)) : null;

  const plan = await planRegistration({ publishReport, prepareReport, stagedBytes, source });
  const blocked = plan.blockers.length > 0;
  if (apply && !blocked && !plan.alreadyRegistered) applyRegistration(plan, sourceDir, configFile);
  const status: RegisterReport["status"] = blocked ? "blocked" : plan.alreadyRegistered ? "already-registered" : apply ? "applied" : "proposed";
  const report: RegisterReport = {
    kind: "nrvnaverse-asset-register",
    reportVersion: REGISTER_REPORT_VERSION,
    mode: apply ? "apply" : "proposal",
    status,
    assetId: plan.assetId,
    revision: plan.revision,
    registryFile: plan.registryFile,
    changes: plan.changes,
    blockers: plan.blockers,
    next:
      status === "proposed"
        ? ["review the diff, then run again with --apply"]
        : status === "applied" || status === "already-registered"
          ? ["commit the registry (and spatial config) change", "placement is separate: add a model component with assetRef in the scene, then spatial:generate / spatial:check"]
          : ["resolve every blocker; nothing was changed"],
  };
  const name = `${plan.assetId ?? "unidentified"}.${plan.revision ? `r${plan.revision}` : "invalid"}${apply ? "" : ".proposal"}.json`;
  const reportPath = join(dirname(dirname(reportFile)), "registered", name);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [`${status.toUpperCase()}${apply ? "" : " (proposal — nothing changed; --apply to write)"}: ${plan.assetId ?? "(no asset)"}${plan.revision ? ` revision ${plan.revision}` : ""} → spatial/source/${plan.registryFile}`];
  for (const line of describeChanges(plan.changes)) lines.push(`diff     ${line}`);
  for (const b of plan.blockers) lines.push(`BLOCKER  [${b.code}] ${b.message}`);
  lines.push(`report   ${reportPath}`);
  for (const step of report.next) lines.push(`next     ${step}`);
  return { exitCode: blocked ? 2 : 0, lines, reportPath };
}

/** The `place` command. `sourceDir` / `outputDir` are injectable for tests (default: the committed source + public/data). */
export async function runPlace(argv: string[], inject: { sourceDir?: string; outputDir?: string } = {}): Promise<PrepareCommandResult> {
  const USAGE = "usage: asset:place <assetId> --destination <dst_id> --component <component-id> --position x,y,z [--rotation x,y,z] [--scale x,y,z|s] [--name <text>] [--apply]";
  const VALUED = ["--destination", "--component", "--position", "--rotation", "--scale", "--name"];
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (VALUED.includes(a)) {
      const v = argv[++i];
      if (v === undefined || opts[a] !== undefined) return { exitCode: 1, lines: [`${a} needs exactly one value`, USAGE], reportPath: null };
      opts[a] = v;
    } else if (a.startsWith("--")) return { exitCode: 1, lines: [`unknown option ${a} (placement never takes a URL)`, USAGE], reportPath: null };
    else positional.push(a);
  }
  if (positional.length !== 1 || !opts["--destination"] || !opts["--component"] || !opts["--position"]) return { exitCode: 1, lines: [USAGE], reportPath: null };
  const vec = (flag: string, uniform = false) => (opts[flag] === undefined ? undefined : parseVec3(opts[flag], { uniform }));
  const position = vec("--position");
  const rotation = vec("--rotation");
  const scale = vec("--scale", true);
  if (position === null || rotation === null || scale === null) return { exitCode: 2, lines: ["BLOCKED: [invalid-transform] --position / --rotation / --scale must be x,y,z finite numbers (scale may be one uniform number)"], reportPath: null };

  const sourceDir = inject.sourceDir ?? SOURCE_DIR;
  const configFile = inject.sourceDir ? join(sourceDir, "spatial-config.m0.json") : SOURCE_CONFIG;
  const outputDir = inject.outputDir ?? OUTPUT_DIR;
  let source: SpatialSourceInput;
  let configText: string;
  let sceneText: string;
  try {
    source = loadSourceFrom(sourceDir, configFile);
    configText = readFileSync(configFile, "utf8");
    sceneText = readFileSync(join(sourceDir, String((source.config as Record<string, unknown>).scene)), "utf8");
  } catch (error) {
    return { exitCode: 1, lines: [`cannot read the spatial source: ${(error as Error).message}`], reportPath: null };
  }
  const plan = planPlacement({
    source,
    sceneText,
    configText,
    request: { assetId: positional[0], destinationId: opts["--destination"], componentId: opts["--component"], position: position!, rotation, scale, name: opts["--name"] },
  });

  const p = plan.proposal;
  const blocked = plan.blockers.length > 0;
  const status = blocked ? "BLOCKED" : plan.alreadyPlaced ? "ALREADY-PLACED" : apply ? "APPLIED" : "PROPOSED (proposal — nothing changed; --apply to write)";
  const lines = [`${status}: ${positional[0]}${p ? ` revision ${p.revision} → ${p.destinationName} (${p.destinationId}), chunk "${p.chunkKey}", component "${p.componentId}"` : ""}`];
  if (p) {
    const c = p.component as { position: Vec3; rotation: Vec3; scale: Vec3; name: string };
    const v = (t: Vec3) => `${t.x},${t.y},${t.z}`;
    lines.push(`asset    sha256 ${p.sha256}`);
    lines.push(`url      ${p.runtimeUrl || "(unresolved)"}  (resolved at generate time from assetRef; never written to the source)`);
    lines.push(`transform position ${v(c.position)} · rotation ${v(c.rotation)} rad · scale ${v(c.scale)} · name ${JSON.stringify(c.name)}`);
  }
  for (const s of plan.sourceChanges) lines.push(`source   ${s}`);
  for (const g of plan.generatedChanges) lines.push(`generate ${g}`);
  for (const b of plan.blockers) lines.push(`BLOCKER  [${b.code}] ${b.message}`);

  if (!blocked && !plan.alreadyPlaced && apply && plan.nextSceneText && plan.nextConfigText && plan.nextFiles) {
    writeFileSync(join(sourceDir, String((source.config as Record<string, unknown>).scene)), plan.nextSceneText);
    writeFileSync(configFile, plan.nextConfigText);
    // Regenerate from what is now on disk and prove it is exactly the planned generation.
    const regenerated = generateSpatialArtifacts(loadSourceFrom(sourceDir, configFile));
    if (JSON.stringify(regenerated.files) !== JSON.stringify(plan.nextFiles)) {
      lines.push("FAILED   the regenerated spatial data differs from the plan — inspect the source change");
      return { exitCode: 1, lines, reportPath: null };
    }
    const { written } = writeArtifacts(regenerated.files, outputDir);
    const { removed } = removeStaleArtifacts(regenerated.files, outputDir);
    for (const w of written) lines.push(`wrote    ${w}`);
    for (const r of removed) lines.push(`removed  ${r} (previous content version)`);
    lines.push("next     spatial:check, then build and ASSET_COMPONENT=" + (p?.componentId ?? "<id>") + " browser:perf; commit source + generated data");
  } else if (!blocked && !plan.alreadyPlaced) lines.push("next     review, then run again with --apply");
  return { exitCode: blocked ? 2 : 0, lines, reportPath: null };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "prepare" && command !== "publish" && command !== "register" && command !== "place") {
    console.error("usage: cli.ts prepare <source.glb> <metadata.json> [--registry <registry.json>] [--out <dir>] [--draco]\n       cli.ts publish <prepare-report.json> [--dry-run]\n       cli.ts register <publish-report.json> [--apply]");
    process.exit(1);
  }
  (command === "prepare" ? runPrepare(rest) : command === "publish" ? runPublish(rest) : command === "register" ? runRegister(rest) : runPlace(rest)).then(
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
