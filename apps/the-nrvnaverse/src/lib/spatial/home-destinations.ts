import type { SpatialIndexFile } from "@/lib/spatial/spatial-index";

/**
 * M2: chunk key → the destination that names that place. A chunk with placed destinations is named
 * by its district (else its first placement, id order); a placement-less city cell is named by the
 * destination of the origin cell (The City / Skyfall Plaza).
 *
 * M3: a streaming city cell is named ONLY by a district / hub placed in it. A venue that merely
 * stands in a cell (Gallery One on South Row) must not rename the whole cell, nor rewrite the URL of
 * someone who walks past it; the cell keeps the origin cell's name.
 */
export function homeDestinations(index: SpatialIndexFile, byId: ReadonlyMap<string, { kind: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const placed = Object.entries(index.destinations).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const streamed = new Set(Object.values(index.streaming?.cells ?? {}));
  for (const chunkKey of Object.keys(index.chunks)) {
    const here = placed.filter(([, d]) => d.chunkKey === chunkKey).map(([id]) => id);
    const district = here.find((id) => byId.get(id)?.kind === "district" || byId.get(id)?.kind === "hub");
    const name = streamed.has(chunkKey) ? district : (district ?? here[0]);
    if (name) out.set(chunkKey, name);
  }
  const origin = index.streaming?.cells["0,0"];
  const fallback = origin ? out.get(origin) : undefined;
  if (fallback) for (const chunkKey of Object.values(index.streaming?.cells ?? {})) if (!out.has(chunkKey)) out.set(chunkKey, fallback);
  return out;
}
