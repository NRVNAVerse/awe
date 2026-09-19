import type { DestinationsFile } from "@nrvnaverse/manifest";
import { DESTINATION_SCHEMA_VERSION } from "@nrvnaverse/manifest";

/**
 * Runtime source of the generated destination data. The shell depends on this interface, not on
 * where the data comes from, so the JSON can later be served from a CDN or CMS without touching
 * application state.
 */
export interface DestinationDataSource {
  load(): Promise<DestinationsFile>;
}

/** Default: fetch the generated `destinations.json` served by this app's own route handler. */
export const DESTINATIONS_ENDPOINT = "/api/destinations";

export class FetchDestinationSource implements DestinationDataSource {
  constructor(private readonly url: string = DESTINATIONS_ENDPOINT) {}

  async load(): Promise<DestinationsFile> {
    const res = await fetch(this.url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`destination data request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as DestinationsFile;
    if (data.schemaVersion !== DESTINATION_SCHEMA_VERSION) {
      throw new Error(`unsupported destination schema version ${String(data.schemaVersion)} (expected ${DESTINATION_SCHEMA_VERSION})`);
    }
    if (!Array.isArray(data.destinations) || typeof data.hubId !== "string") {
      throw new Error("destination data is malformed");
    }
    return data;
  }
}
