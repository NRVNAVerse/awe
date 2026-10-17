// @ts-check
/**
 * Blender authoring dry run (M3 Mission B). Dependency-free Node ESM.
 *
 *   pnpm authoring:inspect <scene.blend | blender-export.json> [--out <dir>] [--no-sic]
 *       DRY RUN: export the .blend through SIC's read-only Blender bridge, import it with the
 *       contract (`contract.mjs` / `importer.mjs`), ask SIC the spatial questions (`sic-checks.mjs`)
 *       and write an inspection report. Publishes nothing, edits nothing: the .blend's SHA-256 is
 *       taken before and after and a change is reported as an error; outputs go to --out (default:
 *       the OS temp folder) and never into this repository. Exit 0 = no errors, 1 = errors found,
 *       2 = environment missing (no SIC / Blender).
 *
 *   pnpm authoring:fixture <spec-name>
 *       Rebuild a committed synthetic fixture: Blender builds `spatial/authoring/blender/<name>.spec.json`
 *       into a scratch .blend (`build-authoring-fixture.py`), SIC exports it, and the PORTABLE export
 *       (machine paths made relative, triangle arrays dropped) is written next to the spec as
 *       `<name>.blender-export.json`. The .blend itself is never committed.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { importBlenderExport, summarize } from "./importer.mjs";
import { planSicChecks, runSicChecks, sicLoadableExport, VISITOR_AGENT } from "./sic-checks.mjs";
import { sicRoot, startSic } from "./sic-client.mjs";
import { renderReport } from "./report.mjs";
import { portableExport } from "./portable-export.mjs";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_DIR = resolve(APP_DIR, "../..");
const FIXTURE_DIR = join(APP_DIR, "spatial", "authoring", "blender");

/** @param {string} file */
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The newest installed Blender (SIC's own lookup order: $SIC_BLENDER, then Program Files). */
function findBlender() {
  if (process.env.SIC_BLENDER && existsSync(process.env.SIC_BLENDER)) return process.env.SIC_BLENDER;
  const base = "C:/Program Files/Blender Foundation";
  if (!existsSync(base)) return null;
  const versions = readdirSync(base)
    .filter((d) => /^Blender \d+\.\d+$/.test(d))
    .sort((a, b) => Number(b.split(" ")[1].split(".")[0]) - Number(a.split(" ")[1].split(".")[0]) || Number(b.split(".")[1]) - Number(a.split(".")[1]));
  for (const v of versions) {
    const exe = join(base, v, "blender.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}

/**
 * SIC's read-only export of a .blend (its CLI: `adapt blender --export-out`).
 * @param {string} root @param {string} blend @param {string} outDir
 */
function sicExport(root, blend, outDir) {
  const exportPath = join(outDir, "blender-export.json");
  const scenePath = join(outDir, "scene.sic.json");
  const res = spawnSync(process.execPath, ["src/cli/main.ts", "adapt", "blender", blend, "--out", scenePath, "--export-out", exportPath], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!existsSync(exportPath)) throw new Error(`SIC export failed: ${(res.stderr || res.stdout || "").slice(-800)}`);
  /** @type {any} */
  let adapt = null;
  try {
    adapt = JSON.parse(res.stdout);
  } catch {}
  return { exportPath, adapt };
}

/** @param {string[]} argv */
async function inspect(argv) {
  const input = argv.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("usage: pnpm authoring:inspect <scene.blend | blender-export.json> [--out <dir>] [--no-sic]");
    return 2;
  }
  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    console.error(`not found: ${inputPath}`);
    return 2;
  }
  const outFlag = argv.indexOf("--out");
  const outDir = resolve(outFlag >= 0 ? argv[outFlag + 1] : join(tmpdir(), "nrvnaverse-authoring", basename(inputPath).replace(/\.[^.]+$/, "")));
  if ((outDir + sep).toLowerCase().startsWith((REPO_DIR + sep).toLowerCase())) {
    console.error(`refusing to write the dry-run report inside the repository (${outDir}); pass --out outside it`);
    return 2;
  }
  mkdirSync(outDir, { recursive: true });
  const useSic = !argv.includes("--no-sic");
  const root = sicRoot();
  const isBlend = inputPath.toLowerCase().endsWith(".blend");
  if (isBlend && !root) {
    console.error("a .blend needs Spatial Intelligence Core's Blender bridge: set SIC_ROOT (default C:/Dev/spatial-intelligence-core)");
    return 2;
  }

  /** @type {import("./importer.mjs").Finding[]} */
  const extra = [];
  let exportPath = inputPath;
  let blendSha = null;
  if (isBlend) {
    blendSha = sha256(inputPath);
    console.log(`exporting ${inputPath} through SIC (read-only)…`);
    exportPath = sicExport(/** @type {string} */ (root), inputPath, outDir).exportPath;
    const after = sha256(inputPath);
    if (after !== blendSha) extra.push({ code: "source-modified", level: "error", subject: basename(inputPath), message: "the .blend changed while it was being read — stop and investigate", evidence: { before: blendSha, after } });
  }
  const source = JSON.parse(readFileSync(exportPath, "utf8"));
  const { manifest, findings } = importBlenderExport(source, { blendSha256: blendSha });
  findings.push(...extra);

  /** @type {Array<{ id: string; status: string; sicFinding: string | null }>} */
  let sicLog = [];
  let sicStatus = "skipped (--no-sic)";
  if (manifest && useSic) {
    if (!root) {
      sicStatus = "skipped (SIC not found: set SIC_ROOT)";
    } else {
      const loadable = join(outDir, "blender-export.sic-input.json");
      writeFileSync(loadable, JSON.stringify(sicLoadableExport(source, findings)));
      const sic = await startSic(root);
      try {
        const load = await sic.call("blender_scene", { action: "load", export_path: loadable, agents: [VISITOR_AGENT] });
        const checks = planSicChecks(manifest);
        const run = await runSicChecks(sic, load.handle, checks);
        findings.push(...run.findings);
        sicLog = run.log;
        sicStatus = `${checks.length} questions answered by SIC (scene ${load.scene?.hash ?? load.handle})`;
      } catch (err) {
        findings.push({ code: "sic-unavailable", level: "warning", subject: null, message: `SIC checks did not run: ${String(err instanceof Error ? err.message : err).slice(0, 400)}` });
        sicStatus = "failed (see findings)";
      } finally {
        sic.close();
      }
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level] || (a.subject ?? "").localeCompare(b.subject ?? "") || a.code.localeCompare(b.code));
  const summary = summarize(findings);
  const report = {
    format: "nrvna.authoring-report/1",
    dryRun: true,
    input: inputPath,
    blendSha256: blendSha,
    sic: sicStatus,
    summary,
    findings,
    sicLog,
  };
  if (manifest) writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(outDir, "report.md"), renderReport(report, manifest));
  console.log(`${summary.errors} errors · ${summary.warnings} warnings · ${summary.info} notes · SIC: ${sicStatus}`);
  for (const f of findings.filter((x) => x.level !== "info")) console.log(`  ${f.level.toUpperCase().padEnd(7)} ${f.code.padEnd(28)} ${f.subject ?? ""}  ${f.message}`);
  console.log(`report: ${join(outDir, "report.md")}`);
  return summary.errors > 0 ? 1 : 0;
}

/** @param {string[]} argv */
async function fixture(argv) {
  const name = argv[0];
  const spec = name ? join(FIXTURE_DIR, `${name}.spec.json`) : "";
  if (!name || !existsSync(spec)) {
    console.error(`usage: pnpm authoring:fixture <name>   (one of: ${readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".spec.json")).map((f) => f.replace(".spec.json", "")).join(", ")})`);
    return 2;
  }
  const blender = findBlender();
  const root = sicRoot();
  if (!blender || !root) {
    console.error("needs Blender (SIC_BLENDER or C:/Program Files/Blender Foundation) and SIC (SIC_ROOT)");
    return 2;
  }
  const work = join(tmpdir(), "nrvnaverse-authoring-fixtures", name);
  mkdirSync(work, { recursive: true });
  const blend = join(work, `${name}.blend`);
  const build = spawnSync(blender, ["-b", "--factory-startup", "--disable-autoexec", "--python", join(APP_DIR, "scripts", "blender", "build-authoring-fixture.py"), "--", spec, blend], { encoding: "utf8" });
  if (!existsSync(blend)) {
    console.error(build.stdout.slice(-1500), build.stderr.slice(-1500));
    return 1;
  }
  const { exportPath } = sicExport(root, blend, work);
  const out = join(FIXTURE_DIR, `${name}.blender-export.json`);
  writeFileSync(out, JSON.stringify(portableExport(JSON.parse(readFileSync(exportPath, "utf8"))), null, 1) + "\n");
  console.log(`wrote ${relative(APP_DIR, out)} (from ${blend}; Blender ${basename(dirname(blender))})`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const code = command === "inspect" ? await inspect(rest) : command === "fixture" ? await fixture(rest) : (console.error("usage: cli.mjs inspect|fixture …"), 2);
process.exit(code);
