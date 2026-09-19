import destinations from "@nrvnaverse/manifest/generated/destinations.json";

/**
 * Serves the generated destination data (derived from the source manifests in
 * packages/nrvna-manifest/manifests). Static at build time; the client loads it at runtime.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(destinations);
}
