import { buildDeepLinkQuery, resolveDeepLink, type Destination, type SpatialTravelPhase } from "@nrvnaverse/manifest";
import { Store } from "@/hooks/use-store";
import {
  beginTravel,
  bootState,
  canBeginTravel,
  dismissTravelOutcome,
  errorState,
  withChunkLoading,
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
import { FetchChunkDataSource, type ChunkDataSource } from "@/lib/spatial/chunk-data-source";
import { ChunkOrchestrator } from "@/lib/spatial/chunk-orchestrator";
import { PortalController, type PortalTrigger } from "@/lib/spatial/portal-controller";
import { registryFromSpatialIndex } from "@/lib/spatial/spatial-index";
import { FetchSpatialIndexSource, type SpatialIndexSource } from "@/lib/spatial/spatial-index-source";
import type { ChunkRuntime, SensorRuntime } from "@/lib/spatial/spatial-runtime";
import { now, perfMark, perfMeasure } from "@/lib/perf";

/** Single application store. UI subscribes through `useStore(appStore)`. */
export const appStore = new Store<AppState>(bootState());

/** Diagnostics only: what the spatial adapter last reported through `onPhase`. */
export interface SpatialDiagnostics {
  adapterName: string | null;
  phase: SpatialTravelPhase;
  destinationId: string | null;
  runtimeReady: boolean;
  /** Chunk currently instantiated (diagnostics; never identity, never in a URL). */
  activeChunkKey: string | null;
  /** Physical portal sensors currently bound (those owned by the active chunk). */
  boundPortals: number;
  /** Last portal sensor the player entered and the stable id it routed to (development diagnostics). */
  lastPortal: PortalTrigger | null;
}
const IDLE_DIAGNOSTICS: SpatialDiagnostics = { adapterName: null, phase: "idle", destinationId: null, runtimeReady: false, activeChunkKey: null, boundPortals: 0, lastPortal: null };
export const spatialDiagnostics = new Store<SpatialDiagnostics>(IDLE_DIAGNOSTICS);

/**
 * The engine runtime the store boots. Only the global scene URL, the chunk operations and the
 * player-enters-sensor seam are needed here; the real implementation (`AweSpatialRuntime`) is
 * imported lazily so the shell — and its tests — never load the engine eagerly.
 */
export interface BootableRuntime extends ChunkRuntime, SensorRuntime {
  init(options: { sceneUrl: string }): Promise<void>;
  reveal(): Promise<void>;
  dispose(): void;
}

export interface BootOptions {
  destinationSource?: DestinationDataSource;
  spatialIndexSource?: SpatialIndexSource;
  chunkSource?: ChunkDataSource;
  createRuntime?: () => Promise<BootableRuntime>;
  /** Defaults to `window.location.search`. */
  search?: string;
}

async function createAweRuntime(): Promise<BootableRuntime> {
  const { AweSpatialRuntime } = await import("@/lib/spatial/awe-spatial-runtime");
  return new AweSpatialRuntime();
}

let started = false;
let engineLoaded = false;
let runtime: BootableRuntime | null = null;
let orchestrator: ChunkOrchestrator | null = null;
let portals: PortalController | null = null;
let adapter: AweSpatialAdapter | null = null;
let unsubscribePhase: (() => void) | null = null;
/** Store-level travel sequence: only the newest request may settle state or touch the URL. */
let travelSeq = 0;

/**
 * Boot sequence (M0 Step 2B.2 + 2B.3):
 *   load destination data → resolve the deep link → load the generated spatial index
 *   → initialise the official AWE runtime from the GLOBAL scene (hidden)
 *   → evaluate the requested destination's gate → load its chunk (or the Hub's as fallback)
 *   → place the visitor → bind the active chunk's portal sensors → reveal → ready | gateRequired.
 *
 * The runtime never requests the compatibility full scene; exactly one chunk is active, and only
 * that chunk's physical portals are bound (`syncPortals`, on every committed arrival).
 */
export async function bootApp(options: BootOptions = {}): Promise<void> {
  if (started) return;
  started = true;
  perfMark("app-boot");

  const destinationSource = options.destinationSource ?? new FetchDestinationSource();
  const spatialIndexSource = options.spatialIndexSource ?? new FetchSpatialIndexSource();
  const chunkSource = options.chunkSource ?? new FetchChunkDataSource();
  const createRuntime = options.createRuntime ?? createAweRuntime;

  try {
    const data = await destinationSource.load();
    appStore.update(withData(appStore.state, data));
    if (appStore.state.phase === "error") return;

    appStore.update(withInitialDeepLink(appStore.state, options.search ?? window.location.search));
    const state = appStore.state;
    if (state.phase !== "loadingGlobals") return;

    const [bootRuntime, spatialIndex] = await Promise.all([createRuntime(), spatialIndexSource.load()]);
    runtime = bootRuntime;
    orchestrator = new ChunkOrchestrator({ runtime: bootRuntime, chunkSource, worldId: spatialIndex.worldId, chunks: spatialIndex.chunks });
    adapter = new AweSpatialAdapter({
      registry: registryFromSpatialIndex(spatialIndex),
      getDestination: (id) => state.loaded.index.byId.get(id),
      orchestrator,
    });
    unsubscribePhase = adapter.onPhase(onSpatialPhase);
    // Physical portal sensor → stable id → the SAME travel entry point the directory uses.
    portals = new PortalController({ portals: spatialIndex.portals, sensors: bootRuntime, onPortalEntered: (destinationId) => travelToDestination(destinationId) });

    // Official AWE boots from the global scene only (avatar, animations, environment, ground).
    await bootRuntime.init({ sceneUrl: spatialIndex.globalSceneUrl });
    engineLoaded = true;
    if (process.env.NODE_ENV !== "production") {
      // Dev-only handle for browser debugging (never used by application code).
      (globalThis as Record<string, unknown>).__nrvnaverse = { runtime, adapter, orchestrator, portals };
    }
    perfMark("engine-ready");
    perfMeasure("boot→engine-ready", "app-boot", "engine-ready");
    refreshDiagnostics();

    // Gate → chunk → place first, reveal second: the world is never shown before the initial destination is settled.
    const outcome = await initialPlacement(adapter, state.requested, state.loaded.index.hub);
    if (outcome.kind !== "failed" || outcome.fallback) await bootRuntime.reveal();
    perfMark("revealed");
    perfMeasure("boot→revealed", "app-boot", "revealed", { destinationId: state.requested.id, outcome: outcome.kind });

    appStore.update(withInitialPlacement(appStore.state, outcome));
    window.addEventListener("popstate", onPopState);
  } catch (err) {
    appStore.update(errorState(err instanceof Error ? err.message : String(err), appStore.state.notices));
  }
}

/**
 * Initial placement while hidden. The gate is evaluated inside `travelTo` BEFORE any chunk is
 * requested: a gated deep link never fetches its chunk; the Hub chunk is loaded as the fallback.
 * If the requested chunk fails and the Hub cannot load either, the app enters its error state
 * rather than continuing with a half-loaded world.
 */
async function initialPlacement(spatial: AweSpatialAdapter, requested: Destination, hub: Destination): Promise<InitialPlacementOutcome> {
  const result = await spatial.travelTo(requested.id);
  if (result.status === "arrived") return { kind: "placed", placement: result.placement };

  const fallbackResult = requested.id === hub.id ? null : await spatial.travelTo(hub.id);
  const fallback = fallbackResult?.status === "arrived" ? { destination: hub, placement: fallbackResult.placement } : null;

  if (result.status === "gate-required") {
    if (!fallback) return { kind: "failed", message: `"${requested.name}" requires a gate and the Hub is unavailable`, fallback: null };
    return { kind: "gate-required", gates: result.gates, fallback };
  }
  const message = result.status === "superseded" ? "the initial placement was interrupted" : result.reason;
  return { kind: "failed", message, fallback };
}

/**
 * Adapter phase stream → diagnostics, `loadingChunk` for real cross-chunk work (stale reports are
 * ignored by the pure transition), and portal re-binding on every committed arrival.
 */
function onSpatialPhase(phase: SpatialTravelPhase, destinationId: string | null) {
  if (phase === "loadingChunk" && destinationId) appStore.update(withChunkLoading(appStore.state, destinationId));
  if (phase === "arrived") syncPortals();
  refreshDiagnostics(phase, destinationId);
}

/**
 * Bind the portal set of the chunk the orchestrator has committed as active. Runs after every
 * arrival (initial placement incl. the gated Hub fallback, directory / history / portal travel):
 * a cross-chunk arrival switches the bindings, a same-chunk arrival is a no-op inside the
 * controller, and failed / gated / superseded travel never reaches here (the active chunk and its
 * bindings are unchanged). Portal activation never influences the travel outcome.
 */
function syncPortals() {
  portals?.activate(orchestrator?.activeChunkKey ?? null);
}

function refreshDiagnostics(phase?: SpatialTravelPhase, destinationId?: string | null) {
  spatialDiagnostics.update((prev) => ({
    adapterName: adapter?.name ?? null,
    phase: phase ?? prev.phase,
    destinationId: destinationId === undefined ? prev.destinationId : destinationId,
    runtimeReady: runtime?.isReady ?? false,
    activeChunkKey: orchestrator?.activeChunkKey ?? null,
    boundPortals: portals?.boundPortalCount ?? 0,
    lastPortal: portals?.lastTrigger ?? null,
  }));
}

export interface TravelOptions {
  /** Rewrite `?destination=<id>` after a successful arrival (false for browser back/forward). */
  updateUrl?: boolean;
}

/**
 * In-app travel: the only way the visitor moves — the directory, browser history and the physical
 * portals (via `PortalController`) all call this. The caller passes a stable destination id; the
 * adapter alone knows the placement. A request made while another is in flight supersedes it
 * (latest request wins): the superseded request can no longer change state or the URL, whatever
 * the adapter returns for it. On arrival the URL becomes `?destination=<id>` — never a chunk
 * key or a coordinate — and only after the arrival is committed.
 */
export async function travelToDestination(destinationId: string, options: TravelOptions = {}): Promise<void> {
  const state = appStore.state;
  if (!canBeginTravel(state) || !adapter) return;
  const target = state.loaded.index.byId.get(destinationId);
  if (!target) return;

  const requestId = ++travelSeq;
  appStore.update(beginTravel(state, target));
  const startedAt = now();
  const result = await adapter.travelTo(target.id);
  refreshDiagnostics();
  // Stale: a newer travel owns the state now. The adapter also reports `superseded`, but the
  // store guards independently so no ordering of adapter results can leak an old outcome.
  if (requestId !== travelSeq || result.status === "superseded") return;

  appStore.update(withTravelResult(appStore.state, result, now() - startedAt));

  if (result.status === "arrived" && options.updateUrl !== false) {
    const query = buildDeepLinkQuery(target.id, { from: "spatial", ref: state.entry.ref ?? undefined });
    if (window.location.search !== query) {
      window.history.pushState(null, "", `${window.location.pathname}${query}`);
    }
    appStore.update(withEntry(appStore.state, window.location.search));
  }
}

/** Browser back/forward: travel to the destination the URL now names (no new history entry; supersedes in-flight travel). */
function onPopState() {
  const state = appStore.state;
  if (!canBeginTravel(state)) return;
  const entry = resolveDeepLink(state.loaded.index, window.location.search);
  const target = entry.resolution.destination;
  if (target.id !== state.current.id || state.phase === "traveling" || state.phase === "loadingChunk") {
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
 * Tear everything down on real unmount, in dependency order: supersede pending travel, release
 * portal sensor subscriptions (before the components they listen to are destroyed), abort
 * in-flight chunk work and retire the active chunk (orchestrator), drop listeners, then destroy
 * the space. Skipped while the engine is still loading so React Strict Mode's simulated unmount
 * cannot abort the initial load (upstream starter pattern).
 */
export function disposeApp(): void {
  if (!engineLoaded) return;
  travelSeq++;
  window.removeEventListener("popstate", onPopState);
  unsubscribePhase?.();
  unsubscribePhase = null;
  portals?.dispose();
  portals = null;
  adapter?.dispose();
  adapter = null;
  orchestrator?.dispose();
  orchestrator = null;
  runtime?.dispose();
  runtime = null;
  engineLoaded = false;
  started = false;
  spatialDiagnostics.update(IDLE_DIAGNOSTICS);
  appStore.update(bootState());
}

/** Diagnostics for the prototype panel. */
export function currentAdapter(): AweSpatialAdapter | null {
  return adapter;
}

/** Diagnostics/tests: the portal controller of the booted app. */
export function currentPortals(): PortalController | null {
  return portals;
}

/** Test-only: reset module state without an engine (mirrors `disposeApp` for a never-booted or fake-booted store). */
export function resetAppForTests(): void {
  if (engineLoaded) {
    disposeApp();
    return;
  }
  started = false;
  travelSeq++;
  portals?.dispose();
  portals = null;
  adapter = null;
  orchestrator = null;
  runtime = null;
  spatialDiagnostics.update(IDLE_DIAGNOSTICS);
  appStore.update(bootState());
}
