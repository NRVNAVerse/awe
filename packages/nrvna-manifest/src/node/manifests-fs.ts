import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_FILE_NAMES, generateViews, serializeView, type GeneratedViews } from "../generate";
import { validateDestinationSet, type ValidationResult } from "../validate";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Source manifests (authoritative). One JSON file per destination; file names are not identity. */
export const MANIFESTS_DIR = join(PACKAGE_ROOT, "manifests");
/** Derived outputs. Never edit by hand. */
export const GENERATED_DIR = join(PACKAGE_ROOT, "generated");

export interface LoadedManifests {
  labels: string[];
  manifests: unknown[];
}

/** Read every `*.json` in the manifests directory in sorted file-name order. */
export function loadSourceManifests(dir: string = MANIFESTS_DIR): LoadedManifests {
  const labels = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const manifests = labels.map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown);
  return { labels, manifests };
}

export function validateSourceManifests(dir: string = MANIFESTS_DIR): ValidationResult {
  const { labels, manifests } = loadSourceManifests(dir);
  return validateDestinationSet(manifests, labels);
}

export function generateFromSource(dir: string = MANIFESTS_DIR): GeneratedViews {
  const { labels, manifests } = loadSourceManifests(dir);
  return generateViews(manifests, labels);
}

export interface WriteResult {
  written: string[];
  unchanged: string[];
}

/**
 * Line endings only (CRLF and lone CR become LF), used solely when comparing an on-disk file with
 * fresh canonical output. A Git checkout with core.autocrlf=true (Windows) rewrites committed LF
 * text as CRLF; that is not a content change. Nothing else is normalised (whitespace and content
 * differences still count) and the generator always writes canonical LF.
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function readExisting(path: string): string | null {
  return existsSync(path) ? normalizeLineEndings(readFileSync(path, "utf8")) : null;
}

/** Write the derived views to `outDir`, only touching files whose content changed. */
export function writeGeneratedViews(views: GeneratedViews, outDir: string = GENERATED_DIR): WriteResult {
  mkdirSync(outDir, { recursive: true });
  const result: WriteResult = { written: [], unchanged: [] };
  for (const name of GENERATED_FILE_NAMES) {
    const path = join(outDir, name);
    const next = serializeView(views[name]);
    const prev = readExisting(path);
    if (prev === next) {
      result.unchanged.push(name);
    } else {
      writeFileSync(path, next, "utf8");
      result.written.push(name);
    }
  }
  return result;
}

export interface CheckResult {
  upToDate: boolean;
  stale: string[];
}

/** Compare the on-disk derived files with a fresh generation. Used by CI and the determinism test. */
export function checkGeneratedViews(views: GeneratedViews, outDir: string = GENERATED_DIR): CheckResult {
  const stale: string[] = [];
  for (const name of GENERATED_FILE_NAMES) {
    const path = join(outDir, name);
    const expected = serializeView(views[name]);
    const actual = readExisting(path);
    if (actual !== expected) stale.push(name);
  }
  return { upToDate: stale.length === 0, stale };
}
