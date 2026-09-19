import { loadSourceManifests } from "../../src/node/manifests-fs";
import type { Destination } from "../../src/schema";

/** Deep-cloned copy of the committed seven M0 placeholder manifests. */
export function loadSeven(): Destination[] {
  const { manifests } = loadSourceManifests();
  return structuredClone(manifests) as Destination[];
}

export function bySlug(set: Destination[], slug: string): Destination {
  const found = set.find((d) => d.slug === slug);
  if (!found) throw new Error(`fixture has no destination with slug ${slug}`);
  return found;
}

export const SLUGS = {
  hub: "hub",
  music: "music",
  fashion: "fashion-culture",
  cannabis: "cannabis-21",
  artist: "placeholder-artist",
  brand: "placeholder-fashion-culture-brand",
  farms: "nrvna-farms-placeholder",
} as const;
