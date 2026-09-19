import {
  createDestinationIndex,
  resolveDeepLink,
  type DeepLinkEntry,
  type Destination,
  type DestinationIndex,
  type DestinationsFile,
} from "@nrvnaverse/manifest";

/**
 * Application state model for THE NRVNAVerse shell.
 *
 * Implemented phases (M0 Step 1): boot → resolvingDestination → ready | error.
 *
 * Planned extension phases (reserved, NOT implemented; see PLANNED_PHASES): loadingGlobals,
 * loadingChunk, traveling, arrived, gateRequired. They will be driven by a SpatialTravelAdapter
 * in M0 Step 2 and must not be pretended to exist before then.
 *
 * Everything in this file is pure so it can be unit-tested without React or a browser.
 */

export const IMPLEMENTED_PHASES = ["boot", "resolvingDestination", "ready", "error"] as const;
export type AppPhase = (typeof IMPLEMENTED_PHASES)[number];

/** Reserved for M0 Step 2 spatial integration. Listed so the extension points are explicit. */
export const PLANNED_PHASES = ["loadingGlobals", "loadingChunk", "traveling", "arrived", "gateRequired"] as const;
export type PlannedPhase = (typeof PLANNED_PHASES)[number];

export type NoticeCode =
  | "unknown-destination"
  | "invalid-destination"
  | "destination-not-public"
  | "deep-link-issue"
  | "spatial-unavailable";

export interface AppNotice {
  code: NoticeCode;
  message: string;
}

export interface LoadedData {
  data: DestinationsFile;
  index: DestinationIndex;
}

export type AppState =
  | { phase: "boot"; notices: AppNotice[] }
  | { phase: "resolvingDestination"; loaded: LoadedData; notices: AppNotice[] }
  | {
      phase: "ready";
      loaded: LoadedData;
      entry: DeepLinkEntry;
      /** The destination currently presented (the hub when a fallback happened). */
      current: Destination;
      notices: AppNotice[];
    }
  | { phase: "error"; message: string; notices: AppNotice[] };

export function bootState(): AppState {
  return { phase: "boot", notices: [] };
}

export function errorState(message: string, notices: AppNotice[] = []): AppState {
  return { phase: "error", message, notices };
}

/** Destination data arrived: build the index and move to resolution. */
export function withData(state: AppState, data: DestinationsFile): AppState {
  try {
    const index = createDestinationIndex(data.destinations);
    return { phase: "resolvingDestination", loaded: { data, index }, notices: state.notices };
  } catch (err) {
    return errorState(err instanceof Error ? err.message : String(err), state.notices);
  }
}

/** Resolve the deep link (hub fallback is non-fatal) and become ready. */
export function withDeepLink(state: AppState, search: string | URLSearchParams | URL): AppState {
  if (state.phase !== "resolvingDestination" && state.phase !== "ready") {
    return errorState(`cannot resolve a destination in phase "${state.phase}"`, state.notices);
  }
  const entry = resolveDeepLink(state.loaded.index, search);
  return {
    phase: "ready",
    loaded: state.loaded,
    entry,
    current: entry.resolution.destination,
    notices: noticesFor(entry),
  };
}

export function noticesFor(entry: DeepLinkEntry): AppNotice[] {
  const notices: AppNotice[] = [];
  const { resolution } = entry;
  if (resolution.fallback) {
    const requested = resolution.requested ?? "";
    switch (resolution.reason) {
      case "unknown":
        notices.push({ code: "unknown-destination", message: `Destination "${requested}" is unknown. Showing the Hub instead.` });
        break;
      case "invalid":
        notices.push({ code: "invalid-destination", message: `"${requested}" is not a destination id. Showing the Hub instead.` });
        break;
      case "not-public":
        notices.push({ code: "destination-not-public", message: "That destination is not open to the public. Showing the Hub instead." });
        break;
    }
  }
  for (const issue of entry.issues) {
    if (issue.code === "ignored-param") continue;
    notices.push({ code: "deep-link-issue", message: `${issue.param}: ${issue.message}` });
  }
  return notices;
}
