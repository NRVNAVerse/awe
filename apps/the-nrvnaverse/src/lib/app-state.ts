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
 * Implemented phases (M0 Step 2B.2):
 *
 *   boot → resolvingDestination → loadingGlobals → loadingChunk(initial) → ready | gateRequired | error
 *   ready | arrived | gateRequired ── travel ──▶ traveling ─[cross-chunk only]─▶ loadingChunk(travel)
 *                                                          ──▶ arrived | gateRequired | ready(+notice)
 *   traveling | loadingChunk(travel) ── newer travel ──▶ traveling            (latest request wins)
 *   arrived | gateRequired ── dismiss ──▶ ready
 *
 * - `loadingGlobals`: the deep link is resolved and the AWE engine/space is initialising from the
 *   global scene; the world is not revealed until the initial chunk and placement are settled.
 * - `loadingChunk` (stage `initial`): the engine is up and the first chunk is being fetched and
 *   instantiated; still hidden.
 * - `ready`: engine revealed, visitor standing at `current`, idle.
 * - `traveling`: a travel towards `target` is in progress; the visitor is still at `current`.
 * - `loadingChunk` (stage `travel`): the travel needs a different chunk, which is being fetched /
 *   staged while the current chunk stays alive. Same-chunk travel never enters this phase.
 * - `arrived`: travel completed; `current` is the new destination.
 * - `gateRequired`: travel was refused because the target carries `gates[]`; the visitor stays
 *   at `current` (the hub for an initial deep link). No verification/bypass exists yet; no gated
 *   chunk was fetched.
 *
 * A travel result whose request was superseded by a newer one leaves the state untouched.
 *
 * Everything in this file is pure so it can be unit-tested without React, a browser or the engine.
 */

export const IMPLEMENTED_PHASES = [
  "boot",
  "resolvingDestination",
  "loadingGlobals",
  "loadingChunk",
  "ready",
  "traveling",
  "arrived",
  "gateRequired",
  "error",
] as const;
export type AppPhase = (typeof IMPLEMENTED_PHASES)[number];

/** No phase is reserved any more: `loadingChunk` became real in M0 Step 2B.2. */
export const PLANNED_PHASES = [] as const;
export type PlannedPhase = (typeof PLANNED_PHASES)[number];

/** Phases from which a (new) travel may start: settled, or an in-flight travel that the new one supersedes. */
export const TRAVEL_START_PHASES = ["ready", "arrived", "gateRequired", "traveling", "loadingChunk"] as const;

/** Phases in which the visitor is placed and no travel is in flight. */
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
  /** travel request → arrived, milliseconds (includes chunk fetch/staging for cross-chunk travel). */
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
  | {
      phase: "loadingChunk";
      stage: "initial";
      loaded: LoadedData;
      entry: DeepLinkEntry;
      requested: Destination;
      notices: AppNotice[];
    }
  | ({ phase: "ready" } & SettledBase)
  | ({ phase: "traveling"; target: Destination } & SettledBase)
  | ({ phase: "loadingChunk"; stage: "travel"; target: Destination } & SettledBase)
  | ({ phase: "arrived"; arrival: TravelArrival } & SettledBase)
  | ({ phase: "gateRequired"; gate: GateRefusal } & SettledBase)
  | { phase: "error"; message: string; notices: AppNotice[] };

export type SettledState = Extract<AppState, { phase: SettledPhase }>;
/** States that carry a `current` placement: settled, or a travel in flight (the visitor has not moved yet). */
export type PlacedState = Extract<AppState, SettledBase>;
/** Boot-time states that precede the first placement. */
export type InitialLoadingState = Extract<AppState, { phase: "loadingGlobals" } | { phase: "loadingChunk"; stage: "initial" }>;

export function isSettled(state: AppState): state is SettledState {
  return (SETTLED_PHASES as readonly string[]).includes(state.phase);
}

/** True while the visitor is physically placed (settled or mid-travel). */
export function isPlaced(state: AppState): state is PlacedState {
  return "current" in state;
}

/** True if a new travel may be requested from this state (it supersedes an in-flight one). */
export function canBeginTravel(state: AppState): state is PlacedState {
  return isPlaced(state) && (TRAVEL_START_PHASES as readonly string[]).includes(state.phase);
}

export function isInitialLoading(state: AppState): state is InitialLoadingState {
  return state.phase === "loadingGlobals" || (state.phase === "loadingChunk" && state.stage === "initial");
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

/**
 * The adapter reported real cross-chunk work for `destinationId`. During boot this moves
 * `loadingGlobals → loadingChunk(initial)`; during travel `traveling → loadingChunk(travel)` but
 * only if the loading destination is still the current target — a stale report changes nothing.
 */
export function withChunkLoading(state: AppState, destinationId: string): AppState {
  if (state.phase === "loadingGlobals") {
    const { loaded, entry, requested, notices } = state;
    return { phase: "loadingChunk", stage: "initial", loaded, entry, requested, notices };
  }
  if (state.phase === "traveling" && state.target.id === destinationId) {
    const { loaded, entry, current, placement, notices, target } = state;
    return { phase: "loadingChunk", stage: "travel", loaded, entry, current, placement, notices, target };
  }
  return state;
}

/** Engine and initial placement are done: become ready (or gateRequired at the fallback, or error). */
export function withInitialPlacement(state: AppState, outcome: InitialPlacementOutcome): AppState {
  if (!isInitialLoading(state)) {
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

/**
 * Start a travel from any settled phase — or from an in-flight travel, which the new one
 * supersedes (latest request wins). `current` never changes here: the visitor has not moved.
 */
export function beginTravel(state: AppState, target: Destination): AppState {
  if (!canBeginTravel(state)) return state;
  const { loaded, entry, current, placement } = state;
  return { phase: "traveling", loaded, entry, current, placement, notices: [], target };
}

/**
 * Apply the adapter's travel result. Only meaningful while a travel is in flight; a `superseded`
 * result is not an outcome at all and leaves the state untouched (the newer request will settle it).
 */
export function withTravelResult(state: AppState, result: TravelResult, durationMs: number): AppState {
  if (state.phase !== "traveling" && !(state.phase === "loadingChunk" && state.stage === "travel")) return state;
  const { loaded, entry, current, placement, target } = state;
  switch (result.status) {
    case "superseded":
      return state;
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
