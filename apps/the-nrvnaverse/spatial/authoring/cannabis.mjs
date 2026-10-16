// @ts-check
/**
 * THE NRVNAVerse — the gated 21+ Cannabis District placeholder (M0 data, preserved verbatim).
 *
 * The seven M0 components live in `cannabis-m0.json` in their original M0 coordinates; M2 only
 * moves the whole compound outside the Ring (`CHUNK_ORIGINS["cannabis-21"]` in `city.mjs`). Nothing
 * about the gate changes: the chunk is still refused at the manifest gate before it is fetched, the
 * city never streams it, and the far-field layer never derives anything from it (the compound the
 * city shows is a neutral authored shell).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function composeCannabis() {
  /** @type {Record<string, Record<string, unknown>>} */
  const components = JSON.parse(readFileSync(join(here, "cannabis-m0.json"), "utf8"));
  return { components, componentIds: Object.keys(components) };
}
