import { NRVNAVERSE_SPATIAL_ROOT, NRVNAVERSE_WEB_ROOT } from "@nrvnaverse/manifest";

/**
 * Application identity for the SPATIAL interface (Landmark §2, D-001, D-003).
 * The WEB interface (www.nrvnaverse.com) is a separate application sharing the same manifests.
 */
export const APP_IDENTITY = {
  /** Product name of the spatial interface. */
  name: "THE NRVNAVerse",
  /** Ecosystem name shared with the web interface. */
  ecosystem: "NRVNAVerse",
  spatialRoot: NRVNAVERSE_SPATIAL_ROOT,
  webRoot: NRVNAVERSE_WEB_ROOT,
  /** Visitor-facing line under the product name. */
  tagline: "Explore the NRVNAVerse — districts, artists and culture in one connected world",
  /** Honest engineering milestone label — shown only with diagnostics enabled (`useDebugMode`). */
  milestone: "M0 Foundation — architecture prototype complete",
} as const;
