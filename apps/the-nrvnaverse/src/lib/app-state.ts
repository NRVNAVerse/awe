import {
  createDestinationIndex,
  resolveDeepLink,
  type DeepLinkEntry,
  type Destination,
  type DestinationIndex,
  type DestinationsFile,
  type SpatialPlacement,
  type TravelResult,
} from "@nrvnaverse/manifest";

/**
 * Application state model for THE NRVNAVerse.
 *
 * Implemented phases (M0 Step 2A):
 *
 *   boot → resolvingDestination → loadingGlobals → ready | gateRequired | error
 *   ready | arrived | gateRequired ── travel ──▶ traveling → arrived | gateRequired | ready(+notice)
 *   arrived | gateRequired ── dismiss ──▶ ready
 *
 * - `loadingGlobals`: the deep link is resolved and the AWE engine/space is initialising; the
 *   world is not revealed until the initial placement (or gate refusal) is known.
 * - `ready`: engine revealed, visitor standing at `current`, idle.
 * - `traveling`: a same-scene travel towards `target` is in progress.
 * - `arrived`: travel completed; `current` is the new destination.
 * - `gateRequired`: travel was refused because the target carries `gates[]`; the visitor stays
 *   at `current` (the hub for an initial deep link). No verification/bypass exists yet.
 *
 * Reserved, NOT implemented: `loadingChunk` (chunk-streamed adapter, M0 Step 2B).
 *
 * Everything in this file is pure so it can be unit-tested without React, a browser or the engine.
 */

export const IMPLEMENTED_PHASES = [
  "boot",
  "resolvingDestination",
  "loadingGlobals",
  "ready",
  "traveling",
  "arrived",
  "gateRequired",
  "error",
] as const;
export type AppPhase = (typeof IMPLEMENTED_PHASES)[number];

/** Reserved for the chunk-streamed adapter (M0 Step 2B). Listed so the extension point is explicit. */
export const PLANNED_PHASES = ["loadingChunk"] as const;
export type PlannedPhase = (typeof PLANNED_PHASES)[number];

/** Phases in which the visitor is placed and may start a new travel. */
export const SETTLED_PHASES = ["ready", "arrived", "gateRequired"] as const;
export type SettledPhase = (typeof SETTLED_PHASES)[number];

export type NoticeCode =
  | "unknown-destination"
  | "invalid-destination"
  | "destination-not-public"
  | "deep-link-issue"
  | "spatial-unavailable"
  | "travel-failed";

export interface AppNotice {
  code: NoticeCode;
  message: string;
}

export interface LoadedData {
  data: DestinationsFile;
  index: DestinationIndex;
}

export interface TravelArrival {
  destinationId: string;
  /** destination resolve → arrived, milliseconds (same-scene travel). */
  durationMs: number;
}

export interface GateRefusal {
  destinationId: string;
  gates: string[];
}

/** Shared payload of every phase in which the visitor is physically placed. */
export interface SettledBase {
  loaded: LoadedData;
  /** The last resolved deep-link entry (drives `from`/`ref`/`return` display). */
  entry: DeepLinkEntry;
  /** Where the visitor physically is. Not necessarily `entry.resolution.destination` (gate refusals). */
  current: Destination;
  /** Coordinate-free placement handle reported by the adapter. */
  placement: SpatialPlacement;
  notices: AppNotice[];
}

export type AppState =
  | { phase: "boot"; notices: AppNotice[] }
  | { phase: "resolvingDestination"; loaded: LoadedData; notices: AppNotice[] }
  | {
      phase: "loadingGlobals";
      loaded: LoadedData;
      entry: DeepLinkEntry;
      /** Initial destination after hub fallback; the engine is loading towards it. */
      requested: Destination;
      notices: AppNotice[];
    }
  | ({ phase: "ready" } & SettledBase)
  | ({ phase: "traveling"; target: Destination } & SettledBase)
  | ({ phase: "arrived"; arrival: TravelArrival } & SettledBase)
  | ({ phase: "gateRequired"; gate: GateRefusal } & SettledBase)
  | { phase: "error"; message: string; notices: AppNotice[] };

export type SettledState = Extract<AppState, { phase: SettledPhase }>;

export function isSettled(state: AppState): state is SettledState {
  return (SETTLED_PHASES as readonly string[]).includes(state.phase);
}

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

/** Resolve the initial deep link (hub fallback is non-fatal) and start loading the engine. */
export function withInitialDeepLink(state: AppState, search: string | URLSearchParams | URL): AppState {
  if (state.phase !== "resolvingDestination") {
    return errorState(`cannot resolve the initial destination in phase "${state.phase}"`, state.notices);
  }
  const entry = resolveDeepLink(state.loaded.index, search);
  return {
    phase: "loadingGlobals",
    loaded: state.loaded,
    entry,
    requested: entry.resolution.destination,
    notices: noticesFor(entry),
  };
}

/** Outcome of the initial placement performed while the world is still hidden. */
export type InitialPlacementOutcome =
  | { kind: "placed"; placement: SpatialPlacement }
  | { kind: "gate-required"; gates: string[]; fallback: { destination: Destination; placement: SpatialPlacement } }
  | { kind: "failed"; message: string; fallback: { destination: Destination; placement: SpatialPlacement } | null };

/** Engine and initial placement are done: become ready (or gateRequired at the fallback, or error). */
export function withInitialPlacement(state: AppState, outcome: InitialPlacementOutcome): AppState {
  if (state.phase !== "loadingGlobals") {
    return errorState(`cannot complete initial placement in phase "${state.phase}"`, state.notices);
  }
  const { loaded, entry, requested, notices } = state;
  switch (outcome.kind) {
    case "placed":
      return { phase: "ready", loaded, entry, current: requested, placement: outcome.placement, notices };
    case "gate-required":
      return {
        phase: "gateRequired",
        loaded,
        entry,
        current: outcome.fallback.destination,
        placement: outcome.fallback.placement,
        notices,
        gate: { destinationId: requested.id, gates: outcome.gates },
      };
    case "failed":
      if (!outcome.fallback) return errorState(outcome.message, notices);
      return {
        phase: "ready",
        loaded,
        entry,
        current: outcome.fallback.destination,
        placement: outcome.fallback.placement,
        notices: [
          ...notices,
          {
            code: "travel-failed",
            message: `Could not enter "${requested.name}": ${outcome.message}. Showing ${outcome.fallback.destination.name} instead.`,
          },
        ],
      };
  }
}

/** Start a travel from any settled phase. */
export function beginTravel(state: AppState, target: Destination): AppState {
  if (!isSettled(state)) return state;
  const { loaded, entry, current, placement } = state;
  return { phase: "traveling", loaded, entry, current, placement, notices: [], target };
}

/** Apply the adapter's travel result. */
export function withTravelResult(state: AppState, result: TravelResult, durationMs: number): AppState {
  if (state.phase !== "traveling") return state;
  const { loaded, entry, current, placement, target } = state;
  switch (result.status) {
    case "arrived":
      return {
        phase: "arrived",
        loaded,
        entry,
        current: target,
        placement: result.placement,
        notices: [],
        arrival: { destinationId: target.id, durationMs },
      };
    case "gate-required":
      return {
        phase: "gateRequired",
        loaded,
        entry,
        current,
        placement,
        notices: [],
        gate: { destinationId: result.destinationId, gates: result.gates },
      };
    case "failed":
      return {
        phase: "ready",
        loaded,
        entry,
        current,
        placement,
        notices: [{ code: "travel-failed", message: `Could not travel to "${target.name}": ${result.reason}` }],
      };
    case "unavailable":
      return { phase: "ready", loaded, entry, current, placement, notices: [{ code: "spatial-unavailable", message: result.reason }] };
  }
}

/** Re-resolve the deep-link entry (after the URL changed) without moving anyone. */
export function withEntry(state: AppState, search: string | URLSearchParams | URL): AppState {
  if (!isSettled(state)) return state;
  const entry = resolveDeepLink(state.loaded.index, search);
  return { ...state, entry, notices: [...state.notices, ...noticesFor(entry)] };
}

/** Acknowledge an arrival or gate refusal and return to idle. */
export function dismissTravelOutcome(state: AppState): AppState {
  if (state.phase !== "arrived" && state.phase !== "gateRequired") return state;
  const { loaded, entry, current, placement, notices } = state;
  return { phase: "ready", loaded, entry, current, placement, notices };
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
