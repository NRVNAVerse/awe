import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../src/deep-link";
import { generateViews, serializeView } from "../src/generate";
import { generateFromSource, loadSourceManifests } from "../src/node/manifests-fs";

/**
 * `web-destinations.json` — the WEB handoff export (www.nrvnaverse.com Explore). Derived only from
 * the canonical manifests; web-facing fields only; gate policy preserved.
 */
const web = generateFromSource()["web-destinations.json"];
const bySlug = new Map(web.destinations.map((d) => [d.slug, d]));

describe("web destinations export", () => {
  it("lists every active destination, id-ordered, deterministically", () => {
    expect(web.destinations.map((d) => d.id)).toEqual([...web.destinations.map((d) => d.id)].sort());
    expect([...bySlug.keys()].sort()).toEqual(["cannabis-21", "fashion-culture", "hub", "music", "nrvna-farms-placeholder", "placeholder-artist", "placeholder-fashion-culture-brand"]);
    expect(serializeView(generateFromSource()["web-destinations.json"])).toBe(serializeView(web));
    expect(web.spatialRoot).toBe("https://worlds.nrvnaverse.com/");
  });

  it("gives public destinations a web→world deep link that the spatial contract accepts", () => {
    const artist = bySlug.get("placeholder-artist")!;
    expect(artist).toMatchObject({ kind: "artist", listing: "public", gate: null, placeholder: true, primaryDistrict: { slug: "music", name: "Music District" } });
    expect(artist.spatial).toEqual({ enterable: true, deepLink: `https://worlds.nrvnaverse.com/?destination=${artist.id}&from=web&return=web` });
    const parsed = parseDeepLink(new URL(artist.spatial.deepLink!).search);
    expect(parsed.issues).toEqual([]);
    expect(parsed.params).toEqual({ destination: artist.id, from: "web", ref: null, return: "web" });
  });

  it("preserves the gate policy: gated destinations are age-gated listings with NO spatial entry link", () => {
    for (const slug of ["cannabis-21", "nrvna-farms-placeholder"]) {
      const d = bySlug.get(slug)!;
      expect(d.listing, slug).toBe("age-gated");
      expect(d.gate, slug).toEqual({ kinds: ["age21"], minimumAge: 21 });
      expect(d.spatial, slug).toEqual({ enterable: false, deepLink: null });
    }
    expect(JSON.stringify(web)).not.toMatch(/destination=dst_441dtdafq3e3ehjn|destination=dst_vfkz626za0vra89j/);
  });

  it("exposes only web-facing fields (no auth, owner org ids, jurisdiction policy, analytics or internal tags)", () => {
    const keys = new Set(web.destinations.flatMap((d) => Object.keys(d)));
    expect([...keys].sort()).toEqual(["categories", "commerceRefs", "description", "gate", "id", "kind", "listing", "media", "name", "placeholder", "primaryDistrict", "slug", "spatial", "tags", "updatedAt", "webUrl"]);
    for (const d of web.destinations) {
      expect(d.tags).not.toContain("m0");
      expect(d.tags).not.toContain("placeholder");
    }
    expect(JSON.stringify(web)).not.toMatch(/"auth"|"analyticsId"|"jurisdictions"|"organizationId"|"capabilities"/);
  });

  it("excludes non-active destinations", () => {
    const manifests = structuredClone(loadSourceManifests().manifests) as Record<string, unknown>[];
    const target = manifests.find((m) => m.slug === "placeholder-fashion-culture-brand")!;
    target.status = "draft";
    const views = generateViews(manifests);
    expect(views["web-destinations.json"].destinations.map((d) => d.slug)).not.toContain("placeholder-fashion-culture-brand");
  });
});
