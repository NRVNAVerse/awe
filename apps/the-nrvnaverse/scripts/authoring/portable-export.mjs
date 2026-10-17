// @ts-check
import { basename, dirname, relative, resolve, sep } from "node:path";

/**
 * Machine-independent copy of an export for committing: paths under the .blend's folder become
 * `//relative`, other absolute paths keep only their file name, triangle arrays are dropped
 * (counts, bounds and the exact-box flag stay).
 * @param {any} source
 */
export function portableExport(source) {
  const blendPath = source.file?.path ?? null;
  const blendDir = blendPath ? dirname(blendPath) : null;
  /** @param {string | null} p */
  const portable = (p) => {
    if (!p) return p;
    if (blendDir && resolve(p).toLowerCase().startsWith(resolve(blendDir).toLowerCase() + sep.toLowerCase())) return "//" + relative(blendDir, p).split(sep).join("/");
    return basename(p);
  };
  return {
    ...source,
    file: { path: blendPath ? basename(blendPath) : null },
    dependencies: (source.dependencies ?? []).map((/** @type {any} */ d) => ({ ...d, path: portable(d.path) })),
    objects: source.objects.map((/** @type {any} */ o) => {
      const out = { ...o };
      if (o.mesh) {
        const { indices: _i, positions: _p, ...mesh } = o.mesh;
        out.mesh = mesh;
      }
      if (o.materials) out.materials = o.materials.map((/** @type {any} */ m) => ({ ...m, textures: (m.textures ?? []).map((/** @type {any} */ t) => ({ ...t, path: portable(t.path) })) }));
      return out;
    }),
  };
}
