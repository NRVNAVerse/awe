import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/**
 * LOCAL-ONLY art audition (M2). Serves files from a directory OUTSIDE the repository, named by the
 * `NRVNA_AUDITION_DIR` environment variable, so candidate models whose rights are not cleared can be
 * looked at in the running world on the owner's machine without ever entering Git, a build or a
 * deployment:
 *
 * - production (`NODE_ENV === "production"`) always answers 404 — a deployed build never serves it;
 * - no `NRVNA_AUDITION_DIR` → 404;
 * - only `.json` / `.glb` files directly under that directory, never a path that escapes it.
 *
 * The overlay that uses it is `src/lib/audition/local-audition.ts` (`?audition=lineup|city`).
 * Nothing here is part of the asset contract: auditioned models are not registered, not placed in
 * chunk data and have no colliders (docs/NRVNAVERSE_M2_MEGACITY_CAMPAIGN.md).
 */
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".json": "application/json", ".glb": "model/gltf-binary" };

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const root = process.env.NRVNA_AUDITION_DIR;
  if (process.env.NODE_ENV === "production" || !root) return new Response("not found", { status: 404 });
  const { path } = await context.params;
  const name = (path ?? []).join("/");
  const type = TYPES[extname(name).toLowerCase()];
  if (!type || name.includes("/") || name.includes("\\") || name.startsWith(".")) return new Response("not found", { status: 404 });
  const base = resolve(root);
  const file = resolve(base, name);
  if (!file.startsWith(base + sep)) return new Response("not found", { status: 404 });
  try {
    const bytes = await readFile(file);
    return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
