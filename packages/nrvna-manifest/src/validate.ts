import {
  AUTH_ROLES,
  CAPABILITIES,
  COMMERCE_REF_KINDS,
  DESTINATION_KINDS,
  DESTINATION_SCHEMA_VERSION,
  DESTINATION_STATUSES,
  DEVICES,
  GATE_KINDS,
  JURISDICTION_POLICIES,
  LABEL_PATTERN,
  SPATIAL_PLATFORMS,
  isDestinationId,
  isSlug,
  type Destination,
} from "./schema";

/** Stable machine-readable error codes. Tests and tooling key on these. */
export type ValidationCode =
  | "not-an-object"
  | "schema-version"
  | "invalid-id"
  | "invalid-slug"
  | "invalid-previous-slugs"
  | "invalid-kind"
  | "invalid-name"
  | "invalid-owner"
  | "invalid-primary-district"
  | "invalid-labels"
  | "invalid-related"
  | "invalid-description"
  | "invalid-web-url"
  | "invalid-spatial-destination"
  | "invalid-platform"
  | "invalid-media"
  | "invalid-status"
  | "invalid-age-restriction"
  | "invalid-jurisdictions"
  | "invalid-capabilities"
  | "invalid-devices"
  | "invalid-commerce-refs"
  | "invalid-analytics-id"
  | "analytics-id-mismatch"
  | "invalid-updated-at"
  | "invalid-auth"
  | "invalid-gates"
  | "auth-gates-confusion"
  | "age-gate-mismatch"
  | "self-reference"
  | "unknown-field"
  // set-level
  | "duplicate-id"
  | "duplicate-slug"
  | "previous-slug-collision"
  | "missing-primary-district"
  | "primary-district-not-district"
  | "district-must-not-have-primary-district"
  | "unknown-related-destination"
  | "hub-count"
  | "gate-inheritance";

export interface ValidationError {
  code: ValidationCode;
  /** Destination id or slug when known, otherwise the source label (file name). */
  subject: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const KNOWN_FIELDS: ReadonlySet<string> = new Set<keyof Destination>([
  "schemaVersion",
  "id",
  "slug",
  "previousSlugs",
  "kind",
  "name",
  "owner",
  "primaryDistrictId",
  "categories",
  "tags",
  "relatedDestinationIds",
  "description",
  "webUrl",
  "spatialDestination",
  "media",
  "status",
  "ageRestriction",
  "jurisdictions",
  "capabilities",
  "devices",
  "commerceRefs",
  "analyticsId",
  "updatedAt",
  "auth",
  "gates",
]);

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const REGION_PATTERN = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function oneOf<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Validate one manifest structurally. Cross-manifest rules (references, uniqueness)
 * live in {@link validateDestinationSet}.
 */
export function validateDestination(input: unknown, subjectLabel = "manifest"): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ code: "not-an-object", subject: subjectLabel, path: "", message: "manifest must be a JSON object" }] };
  }

  const subject = typeof input.id === "string" ? input.id : subjectLabel;
  const fail = (code: ValidationCode, path: string, message: string) => errors.push({ code, subject, path, message });

  for (const key of Object.keys(input)) {
    if (!KNOWN_FIELDS.has(key)) fail("unknown-field", key, `unknown field "${key}"`);
  }
  for (const key of KNOWN_FIELDS) {
    if (!(key in input)) fail("unknown-field", key, `missing required field "${key}"`);
  }

  if (input.schemaVersion !== DESTINATION_SCHEMA_VERSION) {
    fail("schema-version", "schemaVersion", `schemaVersion must be ${DESTINATION_SCHEMA_VERSION}`);
  }

  if (!isDestinationId(input.id)) fail("invalid-id", "id", "id must match dst_<16 base32 chars>");
  if (!isSlug(input.slug)) fail("invalid-slug", "slug", "slug must be lowercase kebab-case");

  if (!isStringArray(input.previousSlugs) || !input.previousSlugs.every(isSlug) || hasDuplicates(input.previousSlugs)) {
    fail("invalid-previous-slugs", "previousSlugs", "previousSlugs must be an array of unique slugs");
  } else if (typeof input.slug === "string" && input.previousSlugs.includes(input.slug)) {
    fail("invalid-previous-slugs", "previousSlugs", "previousSlugs must not contain the current slug");
  }

  if (!oneOf(DESTINATION_KINDS, input.kind)) fail("invalid-kind", "kind", `kind must be one of ${DESTINATION_KINDS.join(", ")}`);

  if (typeof input.name !== "string" || input.name.trim().length === 0) fail("invalid-name", "name", "name is required");

  if (input.owner !== null) {
    if (
      !isRecord(input.owner) ||
      typeof input.owner.name !== "string" ||
      input.owner.name.trim().length === 0 ||
      !isNullableString(input.owner.organizationId) ||
      !(input.owner.webUrl === null || isHttpsUrl(input.owner.webUrl))
    ) {
      fail("invalid-owner", "owner", "owner must be null or { name, organizationId: string|null, webUrl: https|null }");
    } else if (isDestinationId(input.owner.organizationId)) {
      fail("invalid-owner", "owner.organizationId", "organizationId must not be a destination id");
    }
  }

  if (!(input.primaryDistrictId === null || isDestinationId(input.primaryDistrictId))) {
    fail("invalid-primary-district", "primaryDistrictId", "primaryDistrictId must be null or a destination id");
  } else if (input.primaryDistrictId !== null && input.primaryDistrictId === input.id) {
    fail("self-reference", "primaryDistrictId", "a destination cannot be its own primary district");
  }

  for (const field of ["categories", "tags"] as const) {
    const value = input[field];
    if (!isStringArray(value) || !value.every((v) => LABEL_PATTERN.test(v)) || hasDuplicates(value)) {
      fail("invalid-labels", field, `${field} must be an array of unique kebab-case labels`);
    }
  }

  if (!isStringArray(input.relatedDestinationIds) || !input.relatedDestinationIds.every(isDestinationId) || hasDuplicates(input.relatedDestinationIds)) {
    fail("invalid-related", "relatedDestinationIds", "relatedDestinationIds must be an array of unique destination ids");
  } else if (typeof input.id === "string" && input.relatedDestinationIds.includes(input.id)) {
    fail("self-reference", "relatedDestinationIds", "a destination cannot relate to itself");
  }

  if (typeof input.description !== "string") fail("invalid-description", "description", "description must be a string");

  if (!isHttpsUrl(input.webUrl)) fail("invalid-web-url", "webUrl", "webUrl must be an absolute https URL");

  validateSpatialDestination(input.spatialDestination, fail);

  const media = input.media;
  if (!isRecord(media) || !["thumbnailUrl", "heroUrl", "logoUrl"].every((k) => media[k] === null || isHttpsUrl(media[k]))) {
    fail("invalid-media", "media", "media must be { thumbnailUrl, heroUrl, logoUrl } each https URL or null");
  }

  if (!oneOf(DESTINATION_STATUSES, input.status)) fail("invalid-status", "status", `status must be one of ${DESTINATION_STATUSES.join(", ")}`);

  if (input.ageRestriction !== null) {
    if (!isRecord(input.ageRestriction) || !Number.isInteger(input.ageRestriction.minimumAge) || (input.ageRestriction.minimumAge as number) <= 0) {
      fail("invalid-age-restriction", "ageRestriction", "ageRestriction must be null or { minimumAge: positive integer }");
    }
  }

  if (!isRecord(input.jurisdictions) || !oneOf(JURISDICTION_POLICIES, input.jurisdictions.policy) || !isStringArray(input.jurisdictions.regions) || !isNullableString(input.jurisdictions.note)) {
    fail("invalid-jurisdictions", "jurisdictions", "jurisdictions must be { policy, regions: string[], note: string|null }");
  } else {
    const { policy, regions } = input.jurisdictions;
    const listPolicy = policy === "allow-list" || policy === "deny-list";
    if (listPolicy && (regions.length === 0 || !regions.every((r) => REGION_PATTERN.test(r)))) {
      fail("invalid-jurisdictions", "jurisdictions.regions", `${policy} requires at least one region code like US-CA`);
    }
    if (!listPolicy && regions.length > 0) {
      fail("invalid-jurisdictions", "jurisdictions.regions", `${policy} must not list regions`);
    }
  }

  if (!isStringArray(input.capabilities) || !input.capabilities.every((c) => oneOf(CAPABILITIES, c)) || hasDuplicates(input.capabilities)) {
    fail("invalid-capabilities", "capabilities", `capabilities must be unique values from ${CAPABILITIES.join(", ")}`);
  }
  if (!isStringArray(input.devices) || !input.devices.every((d) => oneOf(DEVICES, d)) || hasDuplicates(input.devices)) {
    fail("invalid-devices", "devices", `devices must be unique values from ${DEVICES.join(", ")}`);
  }

  if (
    !Array.isArray(input.commerceRefs) ||
    !input.commerceRefs.every((c) => isRecord(c) && typeof c.provider === "string" && c.provider.length > 0 && oneOf(COMMERCE_REF_KINDS, c.kind) && typeof c.ref === "string" && c.ref.length > 0)
  ) {
    fail("invalid-commerce-refs", "commerceRefs", "commerceRefs must be an array of { provider, kind, ref }");
  }

  if (typeof input.analyticsId !== "string" || input.analyticsId.length === 0) {
    fail("invalid-analytics-id", "analyticsId", "analyticsId is required");
  } else if (input.analyticsId !== input.id) {
    fail("analytics-id-mismatch", "analyticsId", "schema v1 requires analyticsId to equal the destination id");
  }

  if (typeof input.updatedAt !== "string" || !ISO_8601.test(input.updatedAt) || Number.isNaN(Date.parse(input.updatedAt))) {
    fail("invalid-updated-at", "updatedAt", "updatedAt must be an ISO 8601 UTC timestamp (YYYY-MM-DDTHH:mm:ssZ)");
  }

  validateAuthAndGates(input, fail);

  return { ok: errors.length === 0, errors };
}

type Fail = (code: ValidationCode, path: string, message: string) => void;

function validateSpatialDestination(value: unknown, fail: Fail) {
  if (value === null) return;
  if (!isRecord(value)) {
    fail("invalid-spatial-destination", "spatialDestination", "spatialDestination must be null or an object");
    return;
  }
  if (!oneOf(SPATIAL_PLATFORMS, value.platform)) {
    fail("invalid-platform", "spatialDestination.platform", `platform must be one of ${SPATIAL_PLATFORMS.join(", ")}`);
    return;
  }
  const keys = Object.keys(value).sort();
  const expect = (allowed: string[]) => {
    const sorted = [...allowed].sort();
    if (keys.join() !== sorted.join()) {
      fail("invalid-spatial-destination", "spatialDestination", `platform "${value.platform}" expects exactly fields: ${sorted.join(", ")}`);
    }
  };
  switch (value.platform) {
    case "the-nrvnaverse":
      expect(["platform", "worldId"]);
      if (!isSlug(value.worldId)) fail("invalid-spatial-destination", "spatialDestination.worldId", "worldId must be a slug");
      // Rule G: no coordinates, chunk keys or spawn data here — placement is resolved by the spatial adapter.
      break;
    case "awe-box":
    case "external":
      expect(["platform", "url"]);
      if (!isHttpsUrl(value.url)) fail("invalid-spatial-destination", "spatialDestination.url", "url must be an absolute https URL");
      break;
    case "awe-partner":
      expect(["platform", "url", "partnerId"]);
      if (!isHttpsUrl(value.url)) fail("invalid-spatial-destination", "spatialDestination.url", "url must be an absolute https URL");
      if (!isNullableString(value.partnerId)) fail("invalid-spatial-destination", "spatialDestination.partnerId", "partnerId must be a string or null");
      break;
  }
}

/**
 * AUTH and GATES are separate concepts (D-006). Besides shape checks, this detects the
 * structurally visible confusions: gate kinds used as roles, roles used as gate kinds, and the
 * experimental "auth: string[]" shape that described entry conditions.
 */
function validateAuthAndGates(input: Record<string, unknown>, fail: Fail) {
  const gateKinds = GATE_KINDS as readonly string[];
  const authRoles = AUTH_ROLES as readonly string[];

  const auth = input.auth;
  if (Array.isArray(auth)) {
    fail("auth-gates-confusion", "auth", "auth must be { roles: [...] }; a bare string array is the experimental gate-like shape and is rejected");
  } else if (!isRecord(auth) || !Array.isArray(auth.roles)) {
    fail("invalid-auth", "auth", "auth must be { roles: AuthRoleAssignment[] }");
  } else {
    if ("gates" in auth || "entry" in auth) fail("auth-gates-confusion", "auth", "auth must not contain gate/entry fields");
    const seen = new Set<string>();
    auth.roles.forEach((assignment, i) => {
      if (!isRecord(assignment) || typeof assignment.role !== "string" || !isStringArray(assignment.principalIds)) {
        fail("invalid-auth", `auth.roles[${i}]`, "role assignment must be { role, principalIds: string[] }");
        return;
      }
      if (gateKinds.includes(assignment.role)) {
        fail("auth-gates-confusion", `auth.roles[${i}].role`, `"${assignment.role}" is a gate kind, not an auth role`);
      } else if (!authRoles.includes(assignment.role)) {
        fail("invalid-auth", `auth.roles[${i}].role`, `role must be one of ${authRoles.join(", ")}`);
      }
      if (seen.has(assignment.role)) fail("invalid-auth", `auth.roles[${i}].role`, `duplicate role "${assignment.role}"`);
      seen.add(assignment.role);
    });
  }

  const gates = input.gates;
  if (!Array.isArray(gates)) {
    fail("invalid-gates", "gates", "gates must be an array of { kind, config }");
  } else {
    const seen = new Set<string>();
    gates.forEach((gate, i) => {
      if (typeof gate === "string") {
        if (authRoles.includes(gate)) fail("auth-gates-confusion", `gates[${i}]`, `"${gate}" is an auth role, not a gate`);
        else fail("invalid-gates", `gates[${i}]`, "gate must be an object { kind, config }");
        return;
      }
      if (!isRecord(gate) || typeof gate.kind !== "string" || !isRecord(gate.config)) {
        fail("invalid-gates", `gates[${i}]`, "gate must be { kind, config: object }");
        return;
      }
      if (authRoles.includes(gate.kind)) {
        fail("auth-gates-confusion", `gates[${i}].kind`, `"${gate.kind}" is an auth role, not a gate kind`);
      } else if (!gateKinds.includes(gate.kind)) {
        fail("invalid-gates", `gates[${i}].kind`, `gate kind must be one of ${gateKinds.join(", ")}`);
      }
      if (!Object.values(gate.config).every((v) => ["string", "number", "boolean"].includes(typeof v))) {
        fail("invalid-gates", `gates[${i}].config`, "gate config values must be strings, numbers or booleans");
      }
      if (seen.has(gate.kind)) fail("invalid-gates", `gates[${i}].kind`, `duplicate gate "${gate.kind}"`);
      seen.add(gate.kind);
    });

    // Structural consistency between the age21 gate and ageRestriction (not legal policy).
    const hasAge21 = gates.some((g) => isRecord(g) && g.kind === "age21");
    const minimumAge = isRecord(input.ageRestriction) ? input.ageRestriction.minimumAge : null;
    if (hasAge21 && !(typeof minimumAge === "number" && minimumAge >= 21)) {
      fail("age-gate-mismatch", "ageRestriction", "an age21 gate requires ageRestriction.minimumAge >= 21");
    }
    if (!hasAge21 && typeof minimumAge === "number" && minimumAge >= 21) {
      fail("age-gate-mismatch", "gates", "ageRestriction.minimumAge >= 21 requires an age21 gate");
    }
  }
}

/**
 * Validate a whole manifest set: every manifest individually plus cross-manifest identity,
 * slug and reference rules. The seven M0 placeholders must pass this.
 */
export function validateDestinationSet(inputs: unknown[], labels?: string[]): ValidationResult {
  const errors: ValidationError[] = [];
  const valid: Destination[] = [];

  inputs.forEach((input, i) => {
    const result = validateDestination(input, labels?.[i] ?? `manifest[${i}]`);
    errors.push(...result.errors);
    if (result.ok) valid.push(input as Destination);
  });

  // Identity uniqueness is checked over every manifest with a well-formed id, even ones that
  // failed other structural checks, so a copy-pasted id is always reported.
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const input of inputs) {
    if (!isRecord(input) || !isDestinationId(input.id)) continue;
    if (seenIds.has(input.id)) duplicateIds.add(input.id);
    seenIds.add(input.id);
  }
  for (const id of duplicateIds) {
    errors.push({ code: "duplicate-id", subject: id, path: "id", message: `duplicate destination id ${id}` });
  }

  const byId = new Map<string, Destination>();
  for (const d of valid) {
    if (duplicateIds.has(d.id)) continue;
    byId.set(d.id, d);
  }

  // Active slugs are unique among non-archived destinations; archived slugs are released.
  const live = [...byId.values()].filter((d) => d.status !== "archived");
  const slugOwner = new Map<string, string>();
  for (const d of live) {
    const other = slugOwner.get(d.slug);
    if (other) {
      errors.push({ code: "duplicate-slug", subject: d.id, path: "slug", message: `slug "${d.slug}" is already used by ${other}` });
    } else {
      slugOwner.set(d.slug, d.id);
    }
  }
  const previousOwner = new Map<string, string>();
  for (const d of byId.values()) {
    for (const prev of d.previousSlugs) {
      const liveOwner = slugOwner.get(prev);
      if (liveOwner && liveOwner !== d.id) {
        errors.push({ code: "previous-slug-collision", subject: d.id, path: "previousSlugs", message: `previous slug "${prev}" is the current slug of ${liveOwner}` });
      }
      const other = previousOwner.get(prev);
      if (other && other !== d.id) {
        errors.push({ code: "previous-slug-collision", subject: d.id, path: "previousSlugs", message: `previous slug "${prev}" is also claimed by ${other}` });
      }
      previousOwner.set(prev, d.id);
    }
  }

  const hubs = [...byId.values()].filter((d) => d.kind === "hub" && d.status === "active");
  if (byId.size > 0 && hubs.length !== 1) {
    errors.push({ code: "hub-count", subject: "set", path: "", message: `exactly one active hub is required, found ${hubs.length}` });
  }

  for (const d of byId.values()) {
    if (d.kind === "hub" || d.kind === "district") {
      if (d.primaryDistrictId !== null) {
        errors.push({ code: "district-must-not-have-primary-district", subject: d.id, path: "primaryDistrictId", message: `${d.kind} must have primaryDistrictId null` });
      }
    } else if (d.primaryDistrictId !== null) {
      const district = byId.get(d.primaryDistrictId);
      if (!district) {
        errors.push({ code: "missing-primary-district", subject: d.id, path: "primaryDistrictId", message: `primary district ${d.primaryDistrictId} does not exist` });
      } else if (district.kind !== "district") {
        errors.push({ code: "primary-district-not-district", subject: d.id, path: "primaryDistrictId", message: `${d.primaryDistrictId} is a ${district.kind}, not a district` });
      } else if (district.gates.some((g) => g.kind === "age21") && !d.gates.some((g) => g.kind === "age21")) {
        errors.push({ code: "gate-inheritance", subject: d.id, path: "gates", message: `primary district ${district.id} has an age21 gate; the destination must declare it too` });
      }
    }
    for (const related of d.relatedDestinationIds) {
      if (!byId.has(related)) {
        errors.push({ code: "unknown-related-destination", subject: d.id, path: "relatedDestinationIds", message: `related destination ${related} does not exist` });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `[${e.code}] ${e.subject}${e.path ? ` · ${e.path}` : ""}: ${e.message}`).join("\n");
}
