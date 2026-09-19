import { isDestinationId, isPublicStatus, type Destination } from "./schema";

/**
 * In-memory index over a validated destination set. Built from `destinations.json`
 * at runtime (app) or from source manifests (tooling). Identity lookups go through
 * `byId`; slug lookups are conveniences that resolve *to* an id (rule A).
 */
export interface DestinationIndex {
  byId: ReadonlyMap<string, Destination>;
  /** Current slugs of non-archived destinations. */
  bySlug: ReadonlyMap<string, string>;
  /** Previous slugs → current id, for redirects. */
  byPreviousSlug: ReadonlyMap<string, string>;
  /** The single active hub. */
  hub: Destination;
}

export function createDestinationIndex(destinations: Destination[]): DestinationIndex {
  const byId = new Map<string, Destination>();
  const bySlug = new Map<string, string>();
  const byPreviousSlug = new Map<string, string>();
  let hub: Destination | undefined;

  for (const d of destinations) {
    byId.set(d.id, d);
    if (d.status !== "archived") bySlug.set(d.slug, d.id);
    for (const prev of d.previousSlugs) byPreviousSlug.set(prev, d.id);
    if (d.kind === "hub" && d.status === "active") hub = d;
  }

  if (!hub) throw new Error("destination set has no active hub");

  return { byId, bySlug, byPreviousSlug, hub };
}

export type ResolutionReason =
  | "resolved"
  /** No destination parameter was supplied. */
  | "missing"
  /** The value is not a well-formed destination id. */
  | "invalid"
  /** Well-formed id that does not exist in the index. */
  | "unknown"
  /** Exists but is draft/hidden/archived — not entered as a public destination. */
  | "not-public";

export interface DestinationResolution {
  destination: Destination;
  /** True when the requested destination could not be entered and the hub was substituted. */
  fallback: boolean;
  reason: ResolutionReason;
  /** The value that was requested, when any. */
  requested: string | null;
}

/**
 * Resolve a public destination from a stable id. Anything that cannot be entered as a
 * normal public destination falls back to the hub with a non-fatal reason (never throws).
 */
export function resolveDestination(index: DestinationIndex, requested: string | null | undefined): DestinationResolution {
  const hub = index.hub;
  if (requested === null || requested === undefined || requested === "") {
    return { destination: hub, fallback: false, reason: "missing", requested: null };
  }
  if (!isDestinationId(requested)) {
    return { destination: hub, fallback: true, reason: "invalid", requested };
  }
  const destination = index.byId.get(requested);
  if (!destination) {
    return { destination: hub, fallback: true, reason: "unknown", requested };
  }
  if (!isPublicStatus(destination.status)) {
    return { destination: hub, fallback: true, reason: "not-public", requested };
  }
  return { destination, fallback: false, reason: "resolved", requested };
}

export interface SlugResolution {
  destination: Destination | null;
  /** Set when the slug was a previous slug and the caller should redirect to the current slug. */
  redirectToSlug: string | null;
}

/** Resolve a current or previous slug to a destination. Slugs are derived; the id is the identity. */
export function resolveSlug(index: DestinationIndex, slug: string): SlugResolution {
  const currentId = index.bySlug.get(slug);
  if (currentId) return { destination: index.byId.get(currentId) ?? null, redirectToSlug: null };
  const previousId = index.byPreviousSlug.get(slug);
  if (previousId) {
    const destination = index.byId.get(previousId) ?? null;
    return { destination, redirectToSlug: destination?.slug ?? null };
  }
  return { destination: null, redirectToSlug: null };
}

/** Public destinations whose primary district is `districtId`, in stable (id) order. */
export function destinationsInDistrict(index: DestinationIndex, districtId: string): Destination[] {
  return [...index.byId.values()]
    .filter((d) => d.primaryDistrictId === districtId && isPublicStatus(d.status))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
