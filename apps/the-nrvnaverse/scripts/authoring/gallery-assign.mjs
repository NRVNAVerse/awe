// @ts-check
/**
 * Switch the exhibition a permanent gallery shows (M3 Mission C; local fixtures, no event backend).
 *
 *   pnpm gallery:assign                         list galleries, exhibitions and the current assignment
 *   pnpm gallery:assign <gallery> <exhibition>  assign by exhibition id or slug ("none" empties the room)
 *
 * Writes `spatial/source/gallery-assignments.json`, recomposes the spatial source and regenerates the
 * runtime artifacts (the same two steps a world edit always takes). Only the gallery's exhibition
 * components change; its shell, entrance, placement and destination id do not (tested).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSIGNMENTS_PATH, GALLERIES, loadAssignments, loadExhibitions } from "../../spatial/authoring/gallery.mjs";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [galleryKey, wanted] = process.argv.slice(2);
const exhibitions = loadExhibitions();
const assignments = loadAssignments();

if (!galleryKey) {
  for (const g of GALLERIES) {
    const current = exhibitions.get(assignments[g.key] ?? "");
    console.log(`${g.key} (${g.destinationId}): ${current ? `${current.slug} — ${current.title}` : "between exhibitions"}`);
  }
  console.log(`exhibitions: ${[...exhibitions.values()].map((e) => `${e.slug} (${e.id})`).join(", ")}`);
  process.exit(0);
}
const gallery = GALLERIES.find((g) => g.key === galleryKey);
if (!gallery) {
  console.error(`unknown gallery "${galleryKey}" (known: ${GALLERIES.map((g) => g.key).join(", ")})`);
  process.exit(2);
}
const ex = wanted === "none" ? null : [...exhibitions.values()].find((e) => e.id === wanted || e.slug === wanted);
if (wanted !== "none" && !ex) {
  console.error(`unknown exhibition "${wanted}" (known: ${[...exhibitions.values()].map((e) => e.slug).join(", ")}, or "none")`);
  process.exit(2);
}

const doc = JSON.parse(readFileSync(ASSIGNMENTS_PATH, "utf8"));
const next = { ...doc.assignments };
if (ex) next[gallery.key] = ex.id;
else delete next[gallery.key];
doc.assignments = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(ASSIGNMENTS_PATH, JSON.stringify(doc, null, 2) + "\n");
console.log(`${gallery.key}: ${ex ? `${ex.slug} (${ex.id})` : "between exhibitions"}`);

for (const step of [
  ["spatial/authoring/compose.mjs"],
  ["scripts/spatial/cli.mjs", "generate"],
]) {
  const res = spawnSync(process.execPath, step, { cwd: APP_DIR, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
console.log("done: reload the page under `next dev`; rebuild for `next start`");
