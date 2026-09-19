import { createDestinationIndex, destinationsInDistrict } from "./resolve";
import { DESTINATION_SCHEMA_VERSION, spatialUrlFor, type Destination, type DestinationKind, type GateKind } from "./schema";
import { formatValidationErrors, validateDestinationSet } from "./validate";

/**
 * Deterministic runtime views derived from the source manifests.
 *
 * Source manifests are authoritative; these outputs are derived and must never be edited by
 * hand. Running the generator twice on unchanged sources produces byte-identical output:
 * no timestamps, stable (id) ordering, sorted keys, fixed 2-space JSON.
 */

/** `destinations.json` — the full public data set plus lookup indexes. */
export interface DestinationsFile {
  schemaVersion: typeof DESTINATION_SCHEMA_VERSION;
  destinations: GeneratedDestination[];
  index: {
    /** current slug → id (non-archived) */
    bySlug: Record<string, string>;
    /** previous slug → id */
    byPreviousSlug: Record<string, string>;
    /** analyticsId → id (v1: identity mapping, kept explicit for consumers) */
    byAnalyticsId: Record<string, string>;
  };
  hubId: string;
}

export interface GeneratedDestination extends Destination {
  /** Derived spatial deep link (D-003). Derived from `id`, never the identity. */
  spatialUrl: string;
}

/** `directory.json` — navigation view: hub → districts → public destinations. */
export interface DirectoryFile {
  schemaVersion: typeof DESTINATION_SCHEMA_VERSION;
  hub: DirectoryEntry;
  districts: DirectoryDistrict[];
  /** Public non-district destinations with no primary district. */
  unassigned: DirectoryEntry[];
}

export interface DirectoryEntry {
  id: string;
  slug: string;
  kind: DestinationKind;
  name: string;
  description: string;
  categories: string[];
  tags: string[];
  gates: GateKind[];
  minimumAge: number | null;
  webUrl: string;
  spatialUrl: string;
}

export interface DirectoryDistrict extends DirectoryEntry {
  destinations: DirectoryEntry[];
}

export interface GeneratedViews {
  "destinations.json": DestinationsFile;
  "directory.json": DirectoryFile;
}

export const GENERATED_FILE_NAMES = ["destinations.json", "directory.json"] as const;

function compareId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sortedRecord(entries: [string, string][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = v;
  return out;
}

function toEntry(d: Destination): DirectoryEntry {
  return {
    id: d.id,
    slug: d.slug,
    kind: d.kind,
    name: d.name,
    description: d.description,
    categories: [...d.categories],
    tags: [...d.tags],
    gates: d.gates.map((g) => g.kind),
    minimumAge: d.ageRestriction?.minimumAge ?? null,
    webUrl: d.webUrl,
    spatialUrl: spatialUrlFor(d.id),
  };
}

/** Validate then derive all runtime views. Throws on invalid input — derived data is never produced from bad sources. */
export function generateViews(manifests: unknown[], labels?: string[]): GeneratedViews {
  const validation = validateDestinationSet(manifests, labels);
  if (!validation.ok) {
    throw new Error(`manifest validation failed:\n${formatValidationErrors(validation.errors)}`);
  }
  const destinations = (manifests as Destination[]).slice().sort(compareId);
  const index = createDestinationIndex(destinations);

  const destinationsFile: DestinationsFile = {
    schemaVersion: DESTINATION_SCHEMA_VERSION,
    destinations: destinations.map((d) => ({ ...d, spatialUrl: spatialUrlFor(d.id) })),
    index: {
      bySlug: sortedRecord([...index.bySlug.entries()]),
      byPreviousSlug: sortedRecord([...index.byPreviousSlug.entries()]),
      byAnalyticsId: sortedRecord(destinations.map((d) => [d.analyticsId, d.id])),
    },
    hubId: index.hub.id,
  };

  const districts = destinations
    .filter((d) => d.kind === "district" && d.status === "active")
    .map<DirectoryDistrict>((d) => ({ ...toEntry(d), destinations: destinationsInDistrict(index, d.id).map(toEntry) }));

  const unassigned = destinations
    .filter((d) => d.kind !== "district" && d.kind !== "hub" && d.status === "active" && d.primaryDistrictId === null)
    .map(toEntry);

  const directoryFile: DirectoryFile = {
    schemaVersion: DESTINATION_SCHEMA_VERSION,
    hub: toEntry(index.hub),
    districts,
    unassigned,
  };

  return { "destinations.json": destinationsFile, "directory.json": directoryFile };
}

/** Canonical serialization: sorted keys, 2-space indent, trailing newline. */
export function serializeView(view: unknown): string {
  return `${JSON.stringify(sortKeysDeep(view), null, 2)}\n`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
