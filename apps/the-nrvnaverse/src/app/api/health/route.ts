import spatialIndex from "../../../../public/data/spatial/spatial-index.json";
import { releaseInfo } from "@/lib/release-info";

/**
 * Deployment health / release-smoke endpoint (docs/NRVNAVERSE_HOSTING.md): 200 + non-sensitive facts
 * (app, environment, optional release id, manifest schema, the spatial content version this build
 * serves). Dynamic and never cached, so a smoke check sees the running deployment, not an edge copy.
 */
export const dynamic = "force-dynamic";

export function GET() {
  // M4: the deployment profile and indexing decision are what this BUILD was made for (inlined by
  // next.config.ts `env`), never whatever the runtime environment happens to say.
  const env = { ...process.env, NRVNA_DEPLOYMENT: process.env.NRVNA_DEPLOYMENT, NRVNA_INDEXING: process.env.NRVNA_INDEXING };
  return Response.json(releaseInfo(env, spatialIndex), {
    headers: { "Cache-Control": "no-store" },
  });
}
