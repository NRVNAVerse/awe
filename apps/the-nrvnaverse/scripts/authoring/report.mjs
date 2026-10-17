// @ts-check
/**
 * Human-readable dry-run report (Markdown) for `pnpm authoring:inspect` (M3 Mission B).
 * Pure: report + manifest in, text out.
 */

/** @param {number[] | null | undefined} v */
const fmt = (v) => (v ? `(${v.map((x) => +x.toFixed(3)).join(", ")})` : "—");
/** @param {number | null} r */
const degs = (r) => (r === null ? "—" : `${+((r * 180) / Math.PI).toFixed(1)}°`);

/**
 * @param {any} report
 * @param {any} manifest
 */
export function renderReport(report, manifest) {
  const L = [];
  L.push(`# Authoring dry run — ${manifest?.source?.file ?? report.input}`);
  L.push("");
  L.push(`DRY RUN: nothing was published, nothing in the .blend or the world changed. Source SHA-256 \`${report.blendSha256 ?? "n/a (export input)"}\`.`);
  L.push("");
  L.push(`**${report.summary.errors} errors · ${report.summary.warnings} warnings · ${report.summary.info} notes** — SIC: ${report.sic}`);
  L.push("");
  if (report.findings.length > 0) {
    L.push("## Findings");
    L.push("");
    L.push("| Level | Code | Subject | What |");
    L.push("|---|---|---|---|");
    for (const f of report.findings) L.push(`| ${f.level} | \`${f.code}\` | ${f.subject ? `\`${f.subject}\`` : ""} | ${String(f.message).replace(/\|/g, "\\|")} |`);
    L.push("");
  }
  if (manifest) {
    L.push("## Frame");
    L.push("");
    L.push(`Blender ${manifest.source.blenderVersion ?? "?"} · units ${manifest.source.unitSettings.system ?? "?"} / ${manifest.source.unitSettings.lengthUnit ?? "?"} × ${manifest.source.unitSettings.scaleLength} → NRVNAVerse metres, +Y up, north −Z (Blender (x, y, z) → (x, z, −y)).`);
    L.push("");
    L.push("## Collections");
    L.push("");
    for (const [name, ids] of Object.entries(manifest.collections)) L.push(`- **${name}** (${/** @type {string[]} */ (ids).length}): ${/** @type {string[]} */ (ids).map((i) => `\`${i}\``).join(", ") || "—"}`);
    L.push("");
    L.push("## Markers");
    L.push("");
    L.push("| Marker | Kind | Position (m) | Facing | Volume size (m) |");
    L.push("|---|---|---|---|---|");
    for (const m of manifest.markers) L.push(`| \`${m.name}\` | ${m.kind} | ${fmt(m.position)} | ${degs(m.yaw)} | ${m.volume ? fmt(m.volume.size) : ""} |`);
    L.push("");
    if (manifest.galleries.length > 0) {
      L.push("## Galleries");
      L.push("");
      for (const g of manifest.galleries) L.push(`- **${g.slug}**: spawn \`${g.spawn ?? "—"}\`, entrance \`${g.entrance ?? "—"}\`, exit \`${g.exit ?? "—"}\`, anchors ${g.anchors.map((/** @type {string} */ a) => `\`${a}\``).join(", ") || "—"}`);
      L.push("");
    }
    L.push("## Objects (placement, scale and materials as authored)");
    L.push("");
    L.push("| Object | Collection | Position (m) | Yaw | Scale | Box size (m) | Materials (variant) / textures |");
    L.push("|---|---|---|---|---|---|---|");
    for (const o of manifest.objects) {
      const mats = o.materials.map((/** @type {any} */ m) => `${m.name}${m.textures.length ? ` [${m.textures.map((/** @type {any} */ t) => `${t.image}${t.loaded ? "" : " MISSING"}`).join(", ")}]` : ""}`).join("; ");
      L.push(`| \`${o.id}\`${o.id !== o.name ? ` (${o.name})` : ""} | ${o.collection ?? "—"} | ${fmt(o.transform.position)} | ${degs(o.transform.yaw)} | ${fmt(o.transform.scale)} | ${o.box ? fmt(o.box.size) : "not a box"} | ${mats || "—"} |`);
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}
