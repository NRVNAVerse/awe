import spatialIndex from "../../../../public/data/spatial/spatial-index.json";
import { releaseInfo } from "@/lib/release-info";

/**
 * Deployment health / release-smoke endpoint (docs/NRVNAVERSE_HOSTING.md): 200 + non-sensitive facts
 * (app, environment, optional release id, manifest schema, the spatial content version this build
 * serves). Dynamic and never cached, so a smoke check sees the running deployment, not an edge copy.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(releaseInfo(process.env, spatialIndex), {
    headers: { "Cache-Control": "no-store" },
  });
}
