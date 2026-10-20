// @ts-check
import path from "node:path";

/**
 * The path flavour a path was written in, independent of the OS running this code: a Blender export
 * made on Windows carries Windows paths (`D:\work\a.blend`), and CI runs on Linux, where
 * `node:path` would not split them (M4: this made `authoring-importer.test.ts` fail on every hosted
 * CI run since M3 while passing on Windows).
 * @param {string} p
 */
const flavourOf = (p) => (/^[A-Za-z]:[\\/]|\\/.test(p) ? path.win32 : path.posix);

/**
 * Machine-independent copy of an export for committing: paths under the .blend's folder become
 * `//relative`, other absolute paths keep only their file name, triangle arrays are dropped
 * (counts, bounds and the exact-box flag stay).
 * @param {any} source
 */
export function portableExport(source) {
  const blendPath = source.file?.path ?? null;
  const blendFlavour = blendPath ? flavourOf(blendPath) : null;
  const blendDir = blendPath && blendFlavour ? blendFlavour.dirname(blendPath) : null;
  /** @param {string | null} p */
  const portable = (p) => {
    if (!p) return p;
    const P = flavourOf(p);
    if (blendDir && blendFlavour === P && P.resolve(p).toLowerCase().startsWith(P.resolve(blendDir).toLowerCase() + P.sep)) return "//" + P.relative(blendDir, p).split(P.sep).join("/");
    return P.basename(p);
  };
  return {
    ...source,
    file: { path: blendPath && blendFlavour ? blendFlavour.basename(blendPath) : null },
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
