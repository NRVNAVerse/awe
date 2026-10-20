import { describe, expect, it } from "vitest";
import type { DestinationsFile } from "@nrvnaverse/manifest";
import destinationsJson from "../../../packages/nrvna-manifest/generated/destinations.json";
import { presentDescription } from "@/lib/present-description";

const data = destinationsJson as unknown as DestinationsFile;

describe("visitor-facing descriptions (M4, display only — the WEB's rule)", () => {
  it("removes the leading engineering milestone marker and nothing else", () => {
    expect(presentDescription("M0 placeholder. Arrival point of THE NRVNAVerse.")).toBe("Arrival point of THE NRVNAVerse.");
    expect(presentDescription("M3 placeholder. A permanent gallery on South Row.")).toBe("A permanent gallery on South Row.");
    expect(presentDescription("M0 placeholder artist destination inside the Music District.")).toBe("Placeholder artist destination inside the Music District.");
    expect(presentDescription("An intimate venue room.")).toBe("An intimate venue room.");
    expect(presentDescription("Mid-city M0 placeholder.")).toBe("Mid-city M0 placeholder."); // only a LEADING marker
  });

  it("no committed destination shows a milestone marker to visitors", () => {
    for (const d of data.destinations) expect(presentDescription(d.description), d.slug).not.toMatch(/^M\d+\b/);
  });
});
