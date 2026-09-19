/**
 * NRVNAVerse destination manifest contract — schema version 1.
 *
 * This file is the canonical, versioned data contract shared by the WEB
 * (www.nrvnaverse.com) and SPATIAL (THE NRVNAVerse, worlds.nrvnaverse.com)
 * interfaces (D-001). It intentionally has no runtime dependencies so it can
 * be consumed by the Next.js app, tooling and, later, the web interface.
 *
 * Locked model rules (see docs/NRVNAVERSE_LANDMARK.md, docs/DECISIONS.md):
 *
 *  A. Stable `id` is identity. Coordinates, chunk keys, slugs and URLs never are (D-004).
 *  B. Districts are navigation, not exclusive taxonomy (D-005).
 *  C. `auth` (permissions/roles) and `gates` (visitor entry requirements) are separate (D-006).
 *  D. Events are cross-network objects, not a spatial district (D-008).
 *  E. Entertainment/Education/Commerce are capabilities, not destination types (D-007).
 *  F. `analyticsId` resolves consistently to destination identity (v1: it equals `id`).
 *  G. `spatialDestination` supports platform variants without coupling identity to AWE coordinates.
 */

export const DESTINATION_SCHEMA_VERSION = 1 as const;
export type DestinationSchemaVersion = typeof DESTINATION_SCHEMA_VERSION;

/** Stable ID format: `dst_` + 16 Crockford-base32 characters (lowercase). Opaque; never derived from names or placement. */
export const DESTINATION_ID_PATTERN = /^dst_[0-9a-hjkmnp-tv-z]{16}$/;
export const DESTINATION_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Slugs are lowercase kebab-case, 1–64 chars. Slugs are derived, replaceable attributes (rule A). */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Categories and tags share the slug grammar. */
export const LABEL_PATTERN = SLUG_PATTERN;

export const DESTINATION_KINDS = [
  "hub",
  "district",
  "brand",
  "artist",
  "venue",
  "event",
  "experience",
] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DESTINATION_STATUSES = ["draft", "active", "hidden", "archived"] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

/** Only `active` destinations are entered as normal public destinations. */
export const PUBLIC_STATUSES: readonly DestinationStatus[] = ["active"];

export const SPATIAL_PLATFORMS = ["the-nrvnaverse", "awe-box", "awe-partner", "external"] as const;
export type SpatialPlatform = (typeof SPATIAL_PLATFORMS)[number];

/** AUTH — permissions / roles (rule C). Never used for entry conditions. */
export const AUTH_ROLES = ["administrator", "moderate", "speak", "build"] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

/** GATES — visitor entry requirements (rule C). Never used for permissions. */
export const GATE_KINDS = ["age21", "ticket", "member", "invite"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export const CAPABILITIES = [
  "entertainment",
  "education",
  "commerce",
  "discovery",
  "info-cards",
  "video",
  "audio",
  "commerce-redirect",
  "events",
  "multiplayer",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const DEVICES = ["desktop", "mobile", "tablet", "xr"] as const;
export type Device = (typeof DEVICES)[number];

export const JURISDICTION_POLICIES = ["unrestricted", "allow-list", "deny-list", "placeholder"] as const;
export type JurisdictionPolicy = (typeof JURISDICTION_POLICIES)[number];

export const COMMERCE_REF_KINDS = ["storefront", "collection", "product", "ticketing"] as const;
export type CommerceRefKind = (typeof COMMERCE_REF_KINDS)[number];

export type JsonPrimitive = string | number | boolean;

export interface DestinationOwner {
  /** Display name of the owning organization / creator. */
  name: string;
  /** Optional reference to an organization record (future registry); not a destination id. */
  organizationId: string | null;
  webUrl: string | null;
}

/**
 * Where a destination physically lives. Identity (`id`) is never derived from this.
 * For `the-nrvnaverse`, physical placement (world chunk, spawn, …) is NOT stored in the
 * manifest; it is resolved by a spatial placement registry keyed by destination id (M0 Step 2).
 */
export type SpatialDestination =
  | {
      platform: "the-nrvnaverse";
      /** Logical world identifier inside THE NRVNAVerse. Placement resolution is the spatial adapter's job. */
      worldId: string;
    }
  | {
      platform: "awe-box";
      /** Hosted awe.box world URL (a different runtime from this repository — see Landmark §13). */
      url: string;
    }
  | {
      platform: "awe-partner";
      url: string;
      partnerId: string | null;
    }
  | {
      platform: "external";
      url: string;
    };

export interface DestinationMedia {
  thumbnailUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
}

export interface AgeRestriction {
  minimumAge: number;
}

export interface Jurisdictions {
  policy: JurisdictionPolicy;
  /** Region codes (e.g. ISO 3166 `US-CA`). Empty for `unrestricted` and `placeholder`. */
  regions: string[];
  note: string | null;
}

export interface CommerceRef {
  provider: string;
  kind: CommerceRefKind;
  ref: string;
}

export interface AuthRoleAssignment {
  role: AuthRole;
  /** Opaque principal identifiers (user/organization ids in a future identity system). */
  principalIds: string[];
}

/** AUTH block — permissions / roles only. */
export interface DestinationAuth {
  roles: AuthRoleAssignment[];
}

/** GATE block — one visitor entry requirement. Policy evaluation is application-layer (Landmark §9). */
export interface DestinationGate {
  kind: GateKind;
  /** Placeholder/configurable values. Not legal truth. */
  config: Record<string, JsonPrimitive>;
}

export interface Destination {
  schemaVersion: DestinationSchemaVersion;
  /** Immutable stable identity. Generated once, committed, never regenerated. */
  id: string;
  slug: string;
  previousSlugs: string[];
  kind: DestinationKind;
  name: string;
  owner: DestinationOwner | null;
  /** Primary spatial district for navigation (D-005). `null` for hubs and districts. */
  primaryDistrictId: string | null;
  categories: string[];
  tags: string[];
  relatedDestinationIds: string[];
  description: string;
  /** Web-interface counterpart (D-001, D-003). */
  webUrl: string;
  spatialDestination: SpatialDestination | null;
  media: DestinationMedia;
  status: DestinationStatus;
  ageRestriction: AgeRestriction | null;
  jurisdictions: Jurisdictions;
  capabilities: Capability[];
  devices: Device[];
  commerceRefs: CommerceRef[];
  /** Analytics identity. Schema v1 rule: must equal `id` (rule F). */
  analyticsId: string;
  /** ISO 8601 timestamp of the last manifest edit. */
  updatedAt: string;
  auth: DestinationAuth;
  gates: DestinationGate[];
}

/** Canonical web root (D-001) and spatial root (D-003). */
export const NRVNAVERSE_WEB_ROOT = "https://www.nrvnaverse.com/";
export const NRVNAVERSE_SPATIAL_ROOT = "https://worlds.nrvnaverse.com/";

/** Deep-link query parameter carrying the stable destination id (D-004). */
export const DESTINATION_QUERY_PARAM = "destination";

export function isDestinationId(value: unknown): value is string {
  return typeof value === "string" && DESTINATION_ID_PATTERN.test(value);
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

export function isPublicStatus(status: DestinationStatus): boolean {
  return PUBLIC_STATUSES.includes(status);
}

/** Derived spatial deep link for a destination. Derived from identity — never the identity itself. */
export function spatialUrlFor(id: string, spatialRoot: string = NRVNAVERSE_SPATIAL_ROOT): string {
  return `${spatialRoot}?${DESTINATION_QUERY_PARAM}=${encodeURIComponent(id)}`;
}
