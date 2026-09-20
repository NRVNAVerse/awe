import { buildDeepLinkQuery, resolveDeepLink, type Destination, type SpatialTravelPhase } from "@nrvnaverse/manifest";
import { Store } from "@/hooks/use-store";
import {
  beginTravel,
  bootState,
  dismissTravelOutcome,
  errorState,
  isSettled,
  withData,
  withEntry,
  withInitialDeepLink,
  withInitialPlacement,
  withTravelResult,
  type AppState,
  type InitialPlacementOutcome,
} from "@/lib/app-state";
import { FetchDestinationSource, type DestinationDataSource } from "@/lib/destination-source";
import { AweSpatialAdapter } from "@/lib/spatial/awe-spatial-adapter";
import { registryFromSpatialIndex } from "@/lib/spatial/spatial-index";
import { FetchSpatialIndexSource, type SpatialIndexSource } from "@/lib/spatial/spatial-index-source";
import type { AweSpatialRuntime } from "@/lib/spatial/awe-spatial-runtime";
import { now, perfMark, perfMeasure } from "@/lib/perf";

/** Single application store. UI subscribes through `useStore(appStore)`. */
export const appStore = new Store<AppState>(bootState());

/** Diagnostics only: what the spatial adapter last reported through `onPhase`. */
export interface SpatialDiagnostics {
  adapterName: string | null;
  phase: SpatialTravelPhase;
  destinationId: string | null;
  runtimeReady: boolean;
}
export const spatialDiagnostics = new Store<SpatialDiagnostics>({ adapterName: null, phase: "idle", destinationId: null, runtimeReady: false });

let started = false;
let engineLoaded = false;
let runtime: AweSpatialRuntime | null = null;
let adapter: AweSpatialAdapter | null = null;
let unsubscribePhase: (() => void) | null = null;

/**
 * Boot sequence (M0 Step 2A, data source migrated in 2B.1):
 *   load destination data → resolve the deep link → load the generated spatial index (placements)
 *   → mount the official AWE runtime (hidden) → place the visitor through the spatial adapter
 *   (or record a gate refusal and place at the hub) → reveal → ready | gateRequired.
 *
 * The runtime still loads the complete compatibility scene (`static-scene.json`); the index only
 * supplies placements in 2B.1. Selective chunk loading is Step 2B.2.
 */
export async function bootApp(
  source: DestinationDataSource = new FetchDestinationSource(),
  spatialIndexSource: SpatialIndexSource = new FetchSpatialIndexSource(),
): Promise<void> {
  if (started) return;
  started = true;
  perfMark("app-boot");

  try {
    const data = await source.load();
    appStore.update(withData(appStore.state, data));
    if (appStore.state.phase === "error") return;

    appStore.update(withInitialDeepLink(appStore.state, window.location.search));
    const state = appStore.state;
    if (state.phase !== "loadingGlobals") return;

    // The engine bundle is loaded lazily so the shell (and its tests) never import it eagerly.
    // The generated spatial index (the only source of physical placements) loads alongside it.
    const [{ AweSpatialRuntime }, spatialIndex] = await Promise.all([import("@/lib/spatial/awe-spatial-runtime"), spatialIndexSource.load()]);
    runtime = new AweSpatialRuntime();
    adapter = new AweSpatialAdapter({
      registry: registryFromSpatialIndex(spatialIndex),
      getDestination: (id) => state.loaded.index.byId.get(id),
      runtime,
    });
    unsubscribePhase = adapter.onPhase((phase, destinationId) => {
      spatialDiagnostics.update({ adapterName: adapter?.name ?? null, phase, destinationId, runtimeReady: runtime?.isReady ?? false });
    });

    await runtime.init();
    engineLoaded = true;
    if (process.env.NODE_ENV !== "production") {
      // Dev-only handle for browser debugging (never used by application code).
      (globalThis as Record<string, unknown>).__nrvnaverse = { runtime, adapter };
    }
    perfMark("engine-ready");
    perfMeasure("boot→engine-ready", "app-boot", "engine-ready");
    spatialDiagnostics.update({ adapterName: adapter.name, runtimeReady: runtime.isReady });

    // Place first, reveal second: the world is never shown before the initial destination is settled.
    const outcome = await initialPlacement(adapter, state.requested, state.loaded.index.hub);
    await runtime.reveal();
    perfMark("revealed");
    perfMeasure("boot→revealed", "app-boot", "revealed", { destinationId: state.requested.id, outcome: outcome.kind });

    appStore.update(withInitialPlacement(appStore.state, outcome));
    window.addEventListener("popstate", onPopState);
  } catch (err) {
    appStore.update(errorState(err instanceof Error ? err.message : String(err), appStore.state.notices));
  }
}

async function initialPlacement(spatial: AweSpatialAdapter, requested: Destination, hub: Destination): Promise<InitialPlacementOutcome> {
  const result = await spatial.travelTo(requested.id);
  if (result.status === "arrived") return { kind: "placed", placement: result.placement };

  const fallbackResult = requested.id === hub.id ? null : await spatial.travelTo(hub.id);
  const fallback = fallbackResult?.status === "arrived" ? { destination: hub, placement: fallbackResult.placement } : null;

  if (result.status === "gate-required") {
    if (!fallback) return { kind: "failed", message: `"${requested.name}" requires a gate and the Hub is unavailable`, fallback: null };
    return { kind: "gate-required", gates: result.gates, fallback };
  }
  return { kind: "failed", message: result.reason, fallback };
}

export interface TravelOptions {
  /** Rewrite `?destination=<id>` after a successful arrival (false for browser back/forward). */
  updateUrl?: boolean;
}

/**
 * In-app travel: the only way UI moves the visitor. UI passes a stable destination id; the
 * adapter alone knows the placement. On arrival the URL becomes `?destination=<id>` — never a
 * chunk key or a coordinate.
 */
export async function travelToDestination(destinationId: string, options: TravelOptions = {}): Promise<void> {
  const state = appStore.state;
  if (!isSettled(state) || !adapter) return;
  const target = state.loaded.index.byId.get(destinationId);
  if (!target) return;

  appStore.update(beginTravel(state, target));
  const startedAt = now();
  const result = await adapter.travelTo(target.id);
  const durationMs = now() - startedAt;
  appStore.update(withTravelResult(appStore.state, result, durationMs));

  if (result.status === "arrived" && options.updateUrl !== false) {
    const query = buildDeepLinkQuery(target.id, { from: "spatial", ref: state.entry.ref ?? undefined });
    if (window.location.search !== query) {
      window.history.pushState(null, "", `${window.location.pathname}${query}`);
    }
    appStore.update(withEntry(appStore.state, window.location.search));
  }
}

/** Browser back/forward: travel to the destination the URL now names (no new history entry). */
function onPopState() {
  const state = appStore.state;
  if (!isSettled(state)) return;
  const entry = resolveDeepLink(state.loaded.index, window.location.search);
  const target = entry.resolution.destination;
  if (target.id !== state.current.id) {
    void travelToDestination(target.id, { updateUrl: false });
  } else {
    appStore.update(withEntry(state, window.location.search));
  }
}

/** Acknowledge an arrival / gate-required banner. */
export function dismissOutcome(): void {
  appStore.update(dismissTravelOutcome(appStore.state));
}

/**
 * Tear the runtime down on real unmount. Skipped while the engine is still loading so React
 * Strict Mode's simulated unmount cannot abort the initial load (upstream starter pattern).
 */
export function disposeApp(): void {
  if (!engineLoaded) return;
  window.removeEventListener("popstate", onPopState);
  unsubscribePhase?.();
  unsubscribePhase = null;
  adapter?.dispose();
  adapter = null;
  runtime?.dispose();
  runtime = null;
  engineLoaded = false;
  started = false;
  spatialDiagnostics.update({ adapterName: null, phase: "idle", destinationId: null, runtimeReady: false });
  appStore.update(bootState());
}

/** Diagnostics for the prototype panel. */
export function currentAdapter(): AweSpatialAdapter | null {
  return adapter;
}
