// @ts-check
/**
 * Spatial checks for an imported authoring scene, answered by Spatial Intelligence Core (M3 Mission B).
 *
 * `planSicChecks` is pure: from the manifest it lists the questions to ask (SIC tool + arguments)
 * and how to read each answer into a finding. The CLI runs the plan against a SIC scene handle
 * loaded from the same export. Every finding keeps the SIC Finding id, tier and exactness as
 * evidence; SIC decides the geometry, this file only decides what matters for NRVNAVerse.
 *
 *   clearance       a visitor capsule fits at every standing marker (spawn, entrance, exit, interact,
 *                   sky lift, drop)                                   → error `marker-blocked`
 *   ground          something physical lies under those markers (a ray 0.5 m above → 1.5 m below)
 *                                                                     → warning `marker-no-ground`
 *   sightlines      every exhibit anchor is in clear line of sight from its gallery's spawn eye
 *                                                                     → warning `anchor-sightline-blocked`
 *   interpenetration  geometry whose bounds overlap is tested exactly → warning `geometry-interpenetration`
 */

import { boundsOverlap } from "./importer.mjs";

/** The visitor capsule (declared from the avatar: ≈ 1.92 m tall, ≈ 0.99 m wide; eye 1.76 m measured in the browser). */
export const VISITOR_AGENT = Object.freeze({
  id: "visitor",
  shape: { type: "capsule", radius: 0.4, height: 1.9 },
  origin: "feet",
  eye_height: 1.75,
  max_step: 0.3,
  max_slope_deg: 45,
});

const STANDING_KINDS = new Set(["spawn", "entrance", "exit", "interact", "skylift", "drop"]);
/** Kinds where a blocked capsule is an error (the visitor is placed or must pass there). */
const BLOCKING_IS_ERROR = new Set(["spawn", "entrance", "exit", "interact"]);

/**
 * @typedef {import("./importer.mjs").Finding} Finding
 * @typedef {{ id: string; tool: "clearance" | "query_relation"; args: Record<string, unknown>; read: (finding: any) => Finding | null }} SicCheck
 */

/** @param {any} f */
const evidence = (f) => ({ sicFinding: f?.id ?? null, tier: f?.tier ?? null, exact: f?.exact ?? null, conclusive: f?.result?.conclusive ?? null });

/**
 * @param {any} manifest an `nrvna.authoring-manifest/1`
 * @returns {SicCheck[]}
 */
export function planSicChecks(manifest) {
  /** @type {SicCheck[]} */
  const checks = [];
  /** @type {Array<import("./importer.mjs").MarkerRecord>} */
  const markers = manifest.markers;
  /** @type {Array<import("./importer.mjs").ObjectRecord>} */
  const objects = manifest.objects;

  for (const m of markers) {
    if (!STANDING_KINDS.has(m.kind)) continue;
    const [x, y, z] = m.position;
    checks.push({
      id: `clearance:${m.name}`,
      tool: "clearance",
      args: { agent: VISITOR_AGENT.id, at: [x, y, z] },
      read: (f) => {
        const r = f?.result;
        if (!r || r.fits !== false) return null;
        return {
          code: "marker-blocked",
          level: BLOCKING_IS_ERROR.has(m.kind) ? "error" : "warning",
          subject: m.name,
          message: `a visitor (capsule r ${VISITOR_AGENT.shape.radius} m, ${VISITOR_AGENT.shape.height} m tall) does not fit here: blocked by ${(r.blockers ?? []).join(", ")} (clearance ${r.clearance_m} m)`,
          evidence: { ...evidence(f), blockers: r.blockers, clearance_m: r.clearance_m },
        };
      },
    });
    checks.push({
      id: `ground:${m.name}`,
      tool: "query_relation",
      args: { op: "line_of_sight", args: { from_point: [x, y + 0.5, z], to_point: [x, y - 1.5, z], occluders: "physical" } },
      read: (f) => {
        const r = f?.result;
        if (!r || r.clear !== true) return null;
        return { code: "marker-no-ground", level: "warning", subject: m.name, message: "nothing physical within 1.5 m below: the visitor would fall", evidence: evidence(f) };
      },
    });
  }

  // Sightlines: each anchor from its gallery's spawn eye, to a point just in front of the work.
  for (const a of markers.filter((m) => m.kind === "anchor")) {
    const spawn = markers.find((m) => m.kind === "spawn" && m.slug === a.gallery);
    if (!spawn) continue;
    const eye = [spawn.position[0], spawn.position[1] + VISITOR_AGENT.eye_height, spawn.position[2]];
    const yaw = a.yaw ?? 0;
    const front = [-Math.sin(yaw) * 0.15, 0, -Math.cos(yaw) * 0.15];
    const floor = a.position[1] < eye[1] - 1.2; // a floor anchor: look at the middle of the work
    const target = [a.position[0] + front[0], a.position[1] + (floor ? 1 : 0), a.position[2] + front[2]];
    checks.push({
      id: `sightline:${a.name}`,
      tool: "query_relation",
      args: { op: "line_of_sight", args: { from_point: eye, to_point: target, occluders: "physical" } },
      read: (f) => {
        const r = f?.result;
        if (!r || r.clear !== false) return null;
        return { code: "anchor-sightline-blocked", level: "warning", subject: a.name, message: `not in clear sight from ${spawn.name}: first hit ${r.first_hit} at ${r.hit_distance_m} m`, evidence: { ...evidence(f), firstHit: r.first_hit } };
      },
    });
  }

  // Interpenetration: exact test for every pair whose bounds strictly overlap.
  const solids = objects.filter((o) => o.bounds !== null);
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i];
      const b = solids[j];
      if (!a.bounds || !b.bounds || !boundsOverlap(a.bounds, b.bounds, 0.002)) continue;
      checks.push({
        id: `intersects:${a.name}+${b.name}`,
        tool: "query_relation",
        args: { op: "intersects", args: { a: a.name, b: b.name } },
        read: (f) => {
          const r = f?.result;
          if (!r || r.intersects !== true || (r.penetration_m ?? 0) < 0.005) return null;
          return { code: "geometry-interpenetration", level: "warning", subject: `${a.name} + ${b.name}`, message: `interpenetrate by ${r.penetration_m} m (unintended overlap, or two objects modelled in one place)`, evidence: { ...evidence(f), penetration_m: r.penetration_m } };
        },
      });
    }
  return checks;
}

/**
 * Drop what SIC cannot load (objects the importer already refused with `degenerate-transform`) from a
 * copy of the export; the original export is never changed.
 * @param {any} source @param {Finding[]} findings
 */
export function sicLoadableExport(source, findings) {
  const refused = new Set(findings.filter((f) => f.code === "degenerate-transform").map((f) => f.subject));
  return { ...source, objects: source.objects.filter((/** @type {{ name: string }} */ o) => !refused.has(o.name)) };
}

/**
 * Run a plan on a loaded handle.
 * @param {{ call: (name: string, args: Record<string, unknown>) => Promise<any> }} sic
 * @param {string} handle
 * @param {SicCheck[]} checks
 */
export async function runSicChecks(sic, handle, checks) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Array<{ id: string; status: string; sicFinding: string | null }>} */
  const log = [];
  for (const c of checks) {
    try {
      const out = await sic.call(c.tool, { handle, ...c.args });
      const f = out?.finding;
      log.push({ id: c.id, status: f?.status ?? "unknown", sicFinding: f?.id ?? null });
      if (f?.status === "unanswerable") {
        findings.push({ code: "sic-unanswerable", level: "info", subject: c.id, message: `SIC could not answer (${f?.result?.code ?? f?.code ?? "unanswerable"})`, evidence: { sicFinding: f?.id ?? null } });
        continue;
      }
      const finding = c.read(f);
      if (finding) findings.push(finding);
    } catch (err) {
      log.push({ id: c.id, status: "error", sicFinding: null });
      findings.push({ code: "sic-error", level: "info", subject: c.id, message: String(err instanceof Error ? err.message : err).slice(0, 300) });
    }
  }
  return { findings, log };
}
