import { describe, expect, it } from "vitest";
import { validateDestination, validateDestinationSet, type ValidationCode } from "../src/validate";
import { SLUGS, bySlug, loadSeven } from "./support/helpers";

function codes(set: unknown[]): ValidationCode[] {
  return validateDestinationSet(set).errors.map((e) => e.code);
}

function singleCodes(manifest: unknown): ValidationCode[] {
  return validateDestination(manifest).errors.map((e) => e.code);
}

describe("seven M0 placeholder manifests", () => {
  it("are exactly seven and valid as a set", () => {
    const seven = loadSeven();
    expect(seven).toHaveLength(7);
    const result = validateDestinationSet(seven);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("carry the locked relationships", () => {
    const seven = loadSeven();
    const hub = bySlug(seven, SLUGS.hub);
    const music = bySlug(seven, SLUGS.music);
    const fashion = bySlug(seven, SLUGS.fashion);
    const cannabis = bySlug(seven, SLUGS.cannabis);

    expect(hub.kind).toBe("hub");
    expect(hub.relatedDestinationIds).toEqual([music.id, fashion.id, cannabis.id]);
    expect(bySlug(seven, SLUGS.artist).primaryDistrictId).toBe(music.id);
    expect(bySlug(seven, SLUGS.brand).primaryDistrictId).toBe(fashion.id);
    expect(bySlug(seven, SLUGS.farms).primaryDistrictId).toBe(cannabis.id);
  });

  it("model the age21 gate on the cannabis district and NRVNA Farms placeholder only", () => {
    const seven = loadSeven();
    const gated = seven.filter((d) => d.gates.some((g) => g.kind === "age21")).map((d) => d.slug).sort();
    expect(gated).toEqual([SLUGS.cannabis, SLUGS.farms].sort());
    for (const slug of gated) {
      const d = bySlug(seven, slug);
      expect(d.ageRestriction).toEqual({ minimumAge: 21 });
      expect(d.jurisdictions.policy).toBe("placeholder");
      expect(d.auth.roles).toEqual([]);
    }
  });

  it("use the analytics identity rule (analyticsId === id)", () => {
    for (const d of loadSeven()) expect(d.analyticsId).toBe(d.id);
  });
});

describe("set-level validation", () => {
  it("rejects duplicate destination ids", () => {
    const seven = loadSeven();
    const artist = bySlug(seven, SLUGS.artist);
    artist.id = bySlug(seven, SLUGS.brand).id;
    artist.analyticsId = artist.id;
    expect(codes(seven)).toContain("duplicate-id");

    const sloppyCopy = loadSeven();
    bySlug(sloppyCopy, SLUGS.artist).id = bySlug(sloppyCopy, SLUGS.brand).id;
    expect(codes(sloppyCopy)).toContain("duplicate-id");
  });

  it("rejects duplicate active slugs", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.artist).slug = SLUGS.brand;
    expect(codes(seven)).toContain("duplicate-slug");
  });

  it("releases the slug of an archived destination", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.brand).status = "archived";
    bySlug(seven, SLUGS.artist).slug = SLUGS.brand;
    expect(codes(seven)).not.toContain("duplicate-slug");
  });

  it("rejects a previous slug that is the current slug of another destination", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.artist).previousSlugs = [SLUGS.brand];
    expect(codes(seven)).toContain("previous-slug-collision");
  });

  it("rejects a broken primary district reference", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.artist).primaryDistrictId = "dst_0000000000000000";
    expect(codes(seven)).toContain("missing-primary-district");
  });

  it("rejects a primary district that is not a district", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.artist).primaryDistrictId = bySlug(seven, SLUGS.hub).id;
    expect(codes(seven)).toContain("primary-district-not-district");
  });

  it("rejects a district with a primary district", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.music).primaryDistrictId = bySlug(seven, SLUGS.fashion).id;
    expect(codes(seven)).toContain("district-must-not-have-primary-district");
  });

  it("rejects a broken related destination", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.hub).relatedDestinationIds.push("dst_0000000000000000");
    expect(codes(seven)).toContain("unknown-related-destination");
  });

  it("rejects self-referential relationships", () => {
    const seven = loadSeven();
    const artist = bySlug(seven, SLUGS.artist);
    artist.relatedDestinationIds.push(artist.id);
    expect(codes(seven)).toContain("self-reference");

    const fresh = loadSeven();
    const brand = bySlug(fresh, SLUGS.brand);
    brand.primaryDistrictId = brand.id;
    expect(codes(fresh)).toContain("self-reference");
  });

  it("requires exactly one active hub", () => {
    const seven = loadSeven();
    bySlug(seven, SLUGS.hub).status = "hidden";
    expect(codes(seven)).toContain("hub-count");
  });

  it("requires destinations inside an age21 district to declare the gate", () => {
    const seven = loadSeven();
    const farms = bySlug(seven, SLUGS.farms);
    farms.gates = [];
    farms.ageRestriction = null;
    expect(codes(seven)).toContain("gate-inheritance");
  });
});

describe("single-manifest validation", () => {
  it("rejects analytics identity mismatch", () => {
    const d = bySlug(loadSeven(), SLUGS.hub);
    d.analyticsId = "hub";
    expect(singleCodes(d)).toContain("analytics-id-mismatch");
  });

  it("rejects an invalid status", () => {
    const d = bySlug(loadSeven(), SLUGS.hub);
    (d as { status: string }).status = "published";
    expect(singleCodes(d)).toContain("invalid-status");
  });

  it("rejects an invalid spatial platform variant", () => {
    const d = bySlug(loadSeven(), SLUGS.hub);
    (d as { spatialDestination: unknown }).spatialDestination = { platform: "roblox", url: "https://example.com/" };
    expect(singleCodes(d)).toContain("invalid-platform");
  });

  it("accepts every planned platform variant", () => {
    const base = bySlug(loadSeven(), SLUGS.artist);
    const variants: unknown[] = [
      { platform: "the-nrvnaverse", worldId: "the-nrvnaverse" },
      { platform: "awe-box", url: "https://awe.box/example" },
      { platform: "awe-partner", url: "https://partner.example/world", partnerId: "partner-1" },
      { platform: "external", url: "https://example.com/space" },
      null,
    ];
    for (const spatialDestination of variants) {
      const d = structuredClone(base);
      (d as { spatialDestination: unknown }).spatialDestination = spatialDestination;
      expect(validateDestination(d).errors).toEqual([]);
    }
  });

  it("rejects coordinates or chunk keys inside a the-nrvnaverse spatial destination", () => {
    const d = bySlug(loadSeven(), SLUGS.hub);
    (d as { spatialDestination: unknown }).spatialDestination = {
      platform: "the-nrvnaverse",
      worldId: "the-nrvnaverse",
      chunk: "0_0_0",
    };
    expect(singleCodes(d)).toContain("invalid-spatial-destination");
  });

  it("rejects a slug used as an id", () => {
    const d = bySlug(loadSeven(), SLUGS.hub);
    d.id = "hub";
    d.analyticsId = "hub";
    expect(singleCodes(d)).toContain("invalid-id");
  });

  it("detects auth/gates confusion", () => {
    const experimentalShape = bySlug(loadSeven(), SLUGS.cannabis);
    (experimentalShape as { auth: unknown }).auth = ["age21"];
    expect(singleCodes(experimentalShape)).toContain("auth-gates-confusion");

    const gateAsRole = bySlug(loadSeven(), SLUGS.cannabis);
    (gateAsRole.auth.roles as unknown[]).push({ role: "age21", principalIds: [] });
    expect(singleCodes(gateAsRole)).toContain("auth-gates-confusion");

    const roleAsGate = bySlug(loadSeven(), SLUGS.cannabis);
    (roleAsGate.gates as unknown[]).push({ kind: "administrator", config: {} });
    expect(singleCodes(roleAsGate)).toContain("auth-gates-confusion");

    const stringGate = bySlug(loadSeven(), SLUGS.cannabis);
    (stringGate.gates as unknown[]).push("build");
    expect(singleCodes(stringGate)).toContain("auth-gates-confusion");
  });

  it("keeps the age21 gate and ageRestriction consistent", () => {
    const noRestriction = bySlug(loadSeven(), SLUGS.cannabis);
    noRestriction.ageRestriction = null;
    expect(singleCodes(noRestriction)).toContain("age-gate-mismatch");

    const noGate = bySlug(loadSeven(), SLUGS.cannabis);
    noGate.gates = [];
    expect(singleCodes(noGate)).toContain("age-gate-mismatch");
  });

  it("rejects unknown and missing fields", () => {
    const extra = bySlug(loadSeven(), SLUGS.hub);
    (extra as unknown as Record<string, unknown>).chunkKey = "0_0_0";
    expect(singleCodes(extra)).toContain("unknown-field");

    const missing = bySlug(loadSeven(), SLUGS.hub);
    delete (missing as Partial<typeof missing>).gates;
    expect(singleCodes(missing)).toContain("unknown-field");
  });

  it("rejects a non-https webUrl", () => {
    const d = bySlug(loadSeven(), SLUGS.hub);
    d.webUrl = "javascript:alert(1)";
    expect(singleCodes(d)).toContain("invalid-web-url");
  });

  it("rejects a wrong schema version", () => {
    const d = bySlug(loadSeven(), SLUGS.hub);
    (d as { schemaVersion: number }).schemaVersion = 2;
    expect(singleCodes(d)).toContain("schema-version");
  });
});
