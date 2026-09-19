import { describe, expect, it } from "vitest";
import { buildDeepLinkQuery, parseDeepLink, type DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { M0_PLACEMENTS } from "@/lib/spatial/placements.m0";

const data = destinationsJson as unknown as DestinationsFile;
const musicId = data.index.bySlug["music"];

/**
 * The URL the store writes after a successful travel is exactly `buildDeepLinkQuery(id, …)`.
 * These tests pin the contract: stable id only — never a chunk key, placement ref or coordinate.
 */
describe("URL contract after travel", () => {
  it("writes ?destination=<stable-id> with only the allow-listed handoff parameters", () => {
    const query = buildDeepLinkQuery(musicId, { from: "spatial", ref: "abc" });
    const params = new URLSearchParams(query);
    expect(params.get("destination")).toBe(musicId);
    expect([...params.keys()].sort()).toEqual(["destination", "from", "ref"]);
  });

  it("never carries chunk keys, placement refs or coordinates", () => {
    for (const id of Object.keys(M0_PLACEMENTS)) {
      const query = buildDeepLinkQuery(id, { from: "spatial" });
      expect(query).not.toMatch(/chunk|placement|spawn|position|[?&][xyz]=/i);
      expect(query).not.toContain(M0_PLACEMENTS[id].placementRef);
    }
  });

  it("ignores a legacy ?chunk= parameter on the way in", () => {
    const parsed = parseDeepLink(`?destination=${musicId}&chunk=0_0_0`);
    expect(parsed.params.destination).toBe(musicId);
    expect(parsed.issues.map((i) => i.code)).toEqual(["ignored-param"]);
    expect(JSON.stringify(parsed.params)).not.toContain("chunk");
  });
});
