import type { MetadataRoute } from "next";
import { robotsFile } from "@/lib/deployment/http-policy";

/**
 * `/robots.txt` (M4, docs/NRVNAVERSE_HOSTING.md §6.2): `Disallow: /` for every non-indexable build
 * (staging, local, production without `NRVNA_ALLOW_INDEXING=true`); an indexable production build
 * allows the world's entry page and still disallows its machine surfaces. Static at build time.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return robotsFile(process.env.NRVNA_INDEXING === "1");
}
