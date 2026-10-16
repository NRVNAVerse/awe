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
  withWalkedInto,
  type AppState,
  type InitialPlacementOutcome,
} from "@/lib/app-state";
import { FetchDestinationSource, type DestinationDataSource } from "@/lib/destination-source";
import { ExperienceController, type ExperienceTrigger } from "@/lib/experience/experience-controller";
import { ThresholdController } from "@/lib/web/threshold-controller";
import { DiscoveryMemory } from "@/lib/discovery/discovery-memory";
import { resetWebContext, setThresholdContext } from "@/lib/web/web-context-store";
import { AweSpatialAdapter } from "@/lib/spatial/awe-spatial-adapter";
import { FetchChunkDataSource, type ChunkDataSource } from "@/lib/spatial/chunk-data-source";
import { ChunkOrchestrator } from "@/lib/spatial/chunk-orchestrator";
import { PortalController, type PortalTrigger } from "@/lib/spatial/portal-controller";
import { placementRefFor, registryFromSpatialIndex, type SpatialIndexFile } from "@/lib/spatial/spatial-index";
import { StreamingController } from "@/lib/spatial/streaming-controller";
import { beginSkyLift, liftDirection } from "@/lib/sky-lift";
import type { CityLayer } from "@/lib/city/city-layer";
import { FetchSpatialIndexSource, type SpatialIndexSource } from "@/lib/spatial/spatial-index-source";
import type { ChunkRuntime, SceneStateRuntime, SensorRuntime } from "@/lib/spatial/spatial-runtime";
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
  /** Experience zones currently bound (those owned by the active chunk). */
  boundZones: number;
  /** Last experience effect applied (zone enter / exit or arrival beat; development diagnostics). */
  lastExperience: ExperienceTrigger | null;
  /** WEB↔SPATIAL thresholds currently bound (those owned by the active chunk). */
  boundThresholds: number;
  /** Sigils remembered by this browser (discovery memory; diagnostics only). */
  remembered: number;
  /** M2: the last streaming handoff ("walk:<chunk>" / "release:<chunk>") and the city layer's stats. */
  lastHandoff: string | null;
  cityLayer: { drawCalls: number; triangles: number; buildings: number; visibleProxies: number } | null;
}
const IDLE_DIAGNOSTICS: SpatialDiagnostics = { adapterName: null, phase: "idle", destinationId: null, runtimeReady: false, activeChunkKey: null, boundPortals: 0, lastPortal: null, boundZones: 0, lastExperience: null, boundThresholds: 0, remembered: 0, lastHandoff: null, cityLayer: null };
export const spatialDiagnostics = new Store<SpatialDiagnostics>(IDLE_DIAGNOSTICS);

/**
 * The engine runtime the store boots. Only the global scene URL, the chunk operations and the
 * player-enters-sensor seam are needed here; the real implementation (`AweSpatialRuntime`) is
 * imported lazily so the shell — and its tests — never load the engine eagerly.
 */
export interface BootableRuntime extends ChunkRuntime, SensorRuntime, SceneStateRuntime {
  init(options: { sceneUrl: string }): Promise<void>;
  /** M2 streaming: the visitor's world position (optional so test runtimes may omit it). */
  getVisitorPosition?(): { x: number; y: number; z: number } | null;
  /** M2 descent: cap the fall speed (m/s) while falling from the Hub; null restores normal falling. */
  setFallSpeedLimit?(metresPerSecond: number | null): void;
  /** M2 descent: whether the avatar stands on the ground. */
  readonly isGrounded?: boolean;
  /** M2 far-field layer: attach an app-owned three.js object; returns a detach function. */
  attachObject?(object: import("three").Object3D): () => void;
  reveal(): Promise<void>;
  /** Destroy the space. May be asynchronous (the real runtime waits for the engine session to settle). */
  dispose(): void | Promise<void>;
}

export interface BootOptions {
  destinationSource?: DestinationDataSource;
  spatialIndexSource?: SpatialIndexSource;
  chunkSource?: ChunkDataSource;
  createRuntime?: () => Promise<BootableRuntime>;
  /** Defaults to `window.location.search`. */
  search?: string;
  /** Discovery-memory storage (defaults to the browser's localStorage; `null` = this visit only). */
  discoveryStorage?: ConstructorParameters<typeof DiscoveryMemory>[0]["storage"];
  /** M2: load and mount the far-field city layer (default true; tests without a renderer pass false). */
  cityLayer?: boolean;
  /** M2: run the streaming controller on a timer (default true; tests drive `currentStreaming()?.tick()`). */
  streamingTimer?: boolean;
}

async function createAweRuntime(): Promise<BootableRuntime> {
  const { AweSpatialRuntime } = await import("@/lib/spatial/awe-spatial-runtime");
  return new AweSpatialRuntime();
}

/**
 * Application lifecycle (M0 Step 2B.4A). One `AppRun` exists from the moment `bootApp()` starts
 * until its teardown has completed; the module holds at most one. Its status is explicit:
 *
 *   idle ── bootApp() ──▶ booting ──▶ running ── disposeApp() ──▶ disposing ──▶ idle
 *                            │                                        ▲
 *                            ├─ boot failure ─▶ (resources unwound) ──┘  (app state stays `error`)
 *                            └─ disposeApp() while booting: the request is RECORDED and honoured
 *                               at the boot's next await boundary (the boot then unwinds itself);
 *                               a bootApp() that follows synchronously — React Strict Mode's
 *                               simulated cleanup + re-setup — rescinds the request and adopts
 *                               the in-flight boot instead of starting a second runtime.
 *
 * Every boot call while a run exists returns that run's boot promise (never two runtimes); every
 * dispose call returns the run's `settled` promise (resolves once the teardown is complete).
 * A boot requested while a run is disposing waits for `settled` before creating anything, so a
 * new Space is never created while the old one is still shutting down.
 */
type RunStatus = "booting" | "running" | "disposing";

interface AppRun {
  readonly id: number;
  status: RunStatus;
  /** Set by `disposeApp()` while booting; observed at the boot's next await boundary. */
  disposeRequested: boolean;
  runtime: BootableRuntime | null;
  orchestrator: ChunkOrchestrator | null;
  portals: PortalController | null;
  experience: ExperienceController | null;
  thresholds: ThresholdController | null;
  discovery: DiscoveryMemory | null;
  streaming: StreamingController | null;
  cityLayer: CityLayer | null;
  detachCityLayer: (() => void) | null;
  /** M2 local audition overlay (development only). */
  detachAudition: (() => void) | null;
  /** M2: chunk key → the destination that names that place (location after a walking handoff). */
  homeOf: Map<string, string>;
  /** M2: destination id → spawn height (sky-lift presentation of vertical travel). */
  spawnY: Map<string, number>;
  adapter: AweSpatialAdapter | null;
  unsubscribePhase: (() => void) | null;
  popstateBound: boolean;
  /** Resolves when the boot procedure has returned (running, failed or unwound). Never rejects. */
  booted: Promise<void>;
  /** Resolves when the run has been fully torn down. Never rejects. */
  settled: Promise<void>;
  resolveSettled: () => void;
}

let run: AppRun | null = null;
/** M2: the Drop's terminal speed (m/s) — ≈6 s from the Hub to Skyfall Plaza, readable, steerable. */
const DESCENT_SPEED = 22;
let runSeq = 0;
/** Store-level travel sequence: only the newest request may settle state or touch the URL. */
let travelSeq = 0;
/** Shutdown problems are reported here (diagnostics); shutdown always continues. Overridable for tests. */
let reportShutdownError: (step: string, err: unknown) => void = defaultShutdownReporter;

function defaultShutdownReporter(step: string, err: unknown): void {
  console.error(`[app-store] shutdown step "${step}" failed`, err);
}

/** Diagnostics/tests: the explicit lifecycle status (`idle` when no run exists). */
export function lifecycleStatus(): "idle" | RunStatus {
  return run?.status ?? "idle";
}

if (process.env.NODE_ENV !== "production") {
  // Dev-only handle so browser validation can exercise the real teardown / re-boot against the
  // real engine without unmounting React (never used by application code).
  (globalThis as Record<string, unknown>).__nrvnaverseLifecycle = { bootApp, disposeApp, lifecycleStatus };
}

/**
 * Boot sequence (M0 Step 2B.2 + 2B.3):
 *   load destination data → resolve the deep link → load the generated spatial index
 *   → initialise the official AWE runtime from the GLOBAL scene (hidden)
 *   → evaluate the requested destination's gate → load its chunk (or the Hub's as fallback)
 *   → place the visitor → bind the active chunk's portal sensors → reveal → ready | gateRequired.
 *
 * The runtime never requests the compatibility full scene; exactly one chunk is active, and only
 * that chunk's physical portals are bound (`syncPortals`, on every committed arrival).
 *
 * Lifecycle (2B.4A): a call while a run is booting or running returns that run's boot promise
 * (a pending dispose request on a booting run is rescinded — Strict Mode); a call while a run is
 * disposing waits for the teardown to settle first. A boot that fails, or that is disposed while
 * in progress, unwinds whatever it allocated so the next call boots cleanly.
 */
export async function bootApp(options: BootOptions = {}): Promise<void> {
  while (run) {
    if (run.status === "booting") {
      run.disposeRequested = false; // Strict Mode: cleanup → immediate re-setup adopts the boot
      return run.booted;
    }
    if (run.status === "running") return run.booted;
    await run.settled; // disposing: never race the old Space; re-check, another boot may have started
  }

  const current = createRun();
  run = current;
  current.booted = executeBoot(current, options);
  return current.booted;
}

function createRun(): AppRun {
  let resolveSettled = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  return {
    id: ++runSeq,
    status: "booting",
    disposeRequested: false,
    runtime: null,
    orchestrator: null,
    portals: null,
    experience: null,
    thresholds: null,
    discovery: null,
    streaming: null,
    cityLayer: null,
    detachCityLayer: null,
    detachAudition: null,
    homeOf: new Map(),
    spawnY: new Map(),
    adapter: null,
    unsubscribePhase: null,
    popstateBound: false,
    booted: Promise.resolve(),
    settled,
    resolveSettled,
  };
}

async function executeBoot(current: AppRun, options: BootOptions): Promise<void> {
  perfMark("app-boot");
  appStore.update(bootState());

  const destinationSource = options.destinationSource ?? new FetchDestinationSource();
  const spatialIndexSource = options.spatialIndexSource ?? new FetchSpatialIndexSource();
  const chunkSource = options.chunkSource ?? new FetchChunkDataSource();
  const createRuntime = options.createRuntime ?? createAweRuntime;
  let failed = false;

  try {
    const data = await destinationSource.load();
    if (current.disposeRequested) return;
    appStore.update(withData(appStore.state, data));
    if (appStore.state.phase === "error") {
      failed = true;
      return;
    }

    appStore.update(withInitialDeepLink(appStore.state, options.search ?? window.location.search));
    const state = appStore.state;
    if (state.phase !== "loadingGlobals") {
      failed = true;
      return;
    }

    const [bootRuntime, spatialIndex] = await Promise.all([createRuntime(), spatialIndexSource.load()]);
    current.runtime = bootRuntime; // registered before any further await so an unwind can dispose it
    if (current.disposeRequested) return;
    const orchestrator = new ChunkOrchestrator({ runtime: bootRuntime, chunkSource, worldId: spatialIndex.worldId, chunks: spatialIndex.chunks });
    current.orchestrator = orchestrator;
    const adapter = new AweSpatialAdapter({
      registry: registryFromSpatialIndex(spatialIndex),
      getDestination: (id) => state.loaded.index.byId.get(id),
      orchestrator,
    });
    current.adapter = adapter;
    current.unsubscribePhase = adapter.onPhase(onSpatialPhase);
    // Physical portal sensor → stable id → the SAME travel entry point the directory uses.
    current.portals = new PortalController({ portals: spatialIndex.portals, sensors: bootRuntime, onPortalEntered: (destinationId) => travelToDestination(destinationId) });
    // Experience bindings (zones, arrival beats, hidden-on-stage sets) — visibility only, never travel.
    const experience = new ExperienceController({
      experience: spatialIndex.experience,
      runtime: bootRuntime,
      onTrigger: (trigger) => {
        current.discovery?.onTrigger(trigger);
        refreshDiagnostics();
      },
    });
    current.experience = experience;
    experience.install();
    // Discovery memory: finds remembered in this browser; answers through the same visibility effects.
    current.discovery = new DiscoveryMemory({ storage: options.discoveryStorage, applyEffect: (effect, label) => experience.applyEffect(effect, label), onFound: () => refreshDiagnostics() });
    // WEB↔SPATIAL thresholds (D-020): a sensor → the stable id whose canonical web context the shell surfaces. Never travel.
    current.thresholds = new ThresholdController({ thresholds: spatialIndex.thresholds, sensors: bootRuntime, onThreshold: (destinationId, trigger) => setThresholdContext(destinationId, trigger?.componentId ?? null) });

    // Official AWE boots from the global scene only (avatar, animations, environment, ground).
    await bootRuntime.init({ sceneUrl: spatialIndex.globalSceneUrl });
    if (current.disposeRequested) return;
    if (process.env.NODE_ENV !== "production") {
      // Dev-only handle for browser debugging (never used by application code).
      (globalThis as Record<string, unknown>).__nrvnaverse = { runtime: bootRuntime, adapter, orchestrator, portals: current.portals, experience: current.experience, thresholds: current.thresholds, run: current };
    }
    // M2 far-field city: decoration only — a failure is reported and the world still boots.
    if (options.cityLayer !== false && spatialIndex.layers.city && bootRuntime.attachObject) {
      try {
        const res = await fetch(spatialIndex.layers.city.dataUrl, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`city layer request failed: ${res.status}`);
        const layerData: unknown = await res.json();
        if (current.disposeRequested) return;
        const { CityLayer } = await import("@/lib/city/city-layer");
        const layer = new CityLayer(layerData);
        current.cityLayer = layer;
        current.detachCityLayer = bootRuntime.attachObject(layer.root);
      } catch (err) {
        console.warn("[app-store] city layer unavailable", err);
      }
      if (current.disposeRequested) return;
    }
    // M2 LOCAL-ONLY art audition (development builds only; the serving route is 404 in production).
    if (process.env.NODE_ENV !== "production" && bootRuntime.attachObject) {
      const audition = new URLSearchParams(options.search ?? window.location.search).get("audition");
      if (audition) {
        try {
          const { loadAudition } = await import("@/lib/audition/local-audition");
          const result = await loadAudition(audition);
          if (result && !current.disposeRequested) {
            current.detachAudition = bootRuntime.attachObject(result.root);
            if (result.hideCityBuildings) current.cityLayer?.setBuildingsVisible(false);
            (globalThis as Record<string, unknown>).__nrvnaverseAudition = { loaded: result.loaded, failed: result.failed };
            console.info("[audition]", result.loaded, result.failed);
          }
        } catch (err) {
          console.warn("[app-store] local audition unavailable", err);
        }
      }
    }
    current.spawnY = new Map(Object.entries(spatialIndex.destinations).map(([id, d]) => [id, d.spawn.position.y]));
    // M2 streaming: walking between city cells / falling off the Hub hands the visitor to the next chunk.
    if (spatialIndex.streaming) {
      current.homeOf = homeDestinations(spatialIndex, state.loaded.index.byId);
      const gatedChunks = gatedChunkKeys(spatialIndex, state.loaded.index.byId);
      const rescueTo = current.homeOf.get(spatialIndex.streaming.cells["0,0"] ?? "") ?? state.loaded.index.hub.id;
      current.streaming = new StreamingController({
        streaming: spatialIndex.streaming,
        position: () => bootRuntime.getVisitorPosition?.() ?? null,
        activeChunk: () => orchestrator.activeChunkKey,
        isBusy: () => orchestrator.isTransitioning || appStore.state.phase === "traveling" || appStore.state.phase === "loadingChunk",
        isStreamable: (chunkKey) => !gatedChunks.has(chunkKey),
        handoff: (chunkKey, reason) => void handoffToChunk(current, chunkKey, reason),
        rescue: () => void travelToDestination(rescueTo),
        descent: bootRuntime.setFallSpeedLimit ? { speed: DESCENT_SPEED, set: (mps) => bootRuntime.setFallSpeedLimit?.(mps), grounded: () => bootRuntime.isGrounded ?? true } : undefined,
      });
    }
    perfMark("engine-ready");
    perfMeasure("boot→engine-ready", "app-boot", "engine-ready");
    refreshDiagnostics();

    // Gate → chunk → place first, reveal second: the world is never shown before the initial destination is settled.
    const outcome = await initialPlacement(adapter, state.requested, state.loaded.index.hub);
    if (current.disposeRequested) return;
    if (outcome.kind !== "failed" || outcome.fallback) await bootRuntime.reveal();
    if (current.disposeRequested) return;
    perfMark("revealed");
    perfMeasure("boot→revealed", "app-boot", "revealed", { destinationId: state.requested.id, outcome: outcome.kind });

    const placedState = withInitialPlacement(appStore.state, outcome);
    appStore.update(placedState);
    if (placedState.phase === "error") {
      failed = true;
      return;
    }
    window.addEventListener("popstate", onPopState);
    current.popstateBound = true;
    current.status = "running";
    if (options.streamingTimer !== false) current.streaming?.start();
  } catch (err) {
    failed = true;
    if (!current.disposeRequested) appStore.update(errorState(err instanceof Error ? err.message : String(err), appStore.state.notices));
  } finally {
    if (current.status !== "running") {
      // Disposed while booting, or the boot failed: unwind whatever was allocated. A failed boot
      // keeps the `error` state for the UI; a disposed boot resets to `boot`.
      await teardown(current, { keepAppState: failed && !current.disposeRequested });
    }
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
  if (phase === "arrived") {
    const fromChunkKey = spatialDiagnostics.state.activeChunkKey;
    syncPortals();
    syncExperience(destinationId, fromChunkKey);
  }
  refreshDiagnostics(phase, destinationId);
}

/**
 * After every committed arrival: bind the active chunk's experience zones (same chunk → no-op
 * inside the controller) and play the arrival beats of the destination. `fromChunkKey` is the
 * chunk that was active BEFORE this arrival (null on the initial placement) — physical context
 * for "return" beats, never identity. Experience never influences the travel outcome.
 */
function syncExperience(destinationId: string | null, fromChunkKey: string | null) {
  const current = run;
  const chunkKey = current?.orchestrator?.activeChunkKey ?? null;
  current?.cityLayer?.setActiveChunk(chunkKey);
  current?.experience?.activate(chunkKey);
  current?.thresholds?.activate(chunkKey);
  if (destinationId && chunkKey) current?.experience?.onArrival({ destinationId, chunkKey, fromChunkKey });
  if (chunkKey) current?.discovery?.onArrival(chunkKey);
}

/**
 * Bind the portal set of the chunk the orchestrator has committed as active. Runs after every
 * arrival (initial placement incl. the gated Hub fallback, directory / history / portal travel):
 * a cross-chunk arrival switches the bindings, a same-chunk arrival is a no-op inside the
 * controller, and failed / gated / superseded travel never reaches here (the active chunk and its
 * bindings are unchanged). Portal activation never influences the travel outcome.
 */
function syncPortals() {
  run?.portals?.activate(run.orchestrator?.activeChunkKey ?? null);
}

function refreshDiagnostics(phase?: SpatialTravelPhase, destinationId?: string | null) {
  const current = run;
  spatialDiagnostics.update((prev) => ({
    adapterName: current?.adapter?.name ?? null,
    phase: phase ?? prev.phase,
    destinationId: destinationId === undefined ? prev.destinationId : destinationId,
    runtimeReady: current?.runtime?.isReady ?? false,
    activeChunkKey: current?.orchestrator?.activeChunkKey ?? null,
    boundPortals: current?.portals?.boundPortalCount ?? 0,
    lastPortal: current?.portals?.lastTrigger ?? null,
    boundZones: current?.experience?.boundZoneIds.length ?? 0,
    lastExperience: current?.experience?.lastTrigger ?? null,
    boundThresholds: current?.thresholds?.boundComponentIds.length ?? 0,
    remembered: current?.discovery?.remembered.length ?? 0,
    lastHandoff: prev.lastHandoff,
    cityLayer: current?.cityLayer ? { drawCalls: current.cityLayer.stats.drawCalls, triangles: current.cityLayer.stats.triangles, buildings: current.cityLayer.stats.buildings, visibleProxies: current.cityLayer.visibleProxies.length } : null,
  }));
}

/**
 * M2: chunk key → the destination that names that place. A chunk with placed destinations is named
 * by its district (else its first placement, id order); a placement-less city cell is named by the
 * destination of the origin cell (The City / Skyfall Plaza).
 */
function homeDestinations(index: SpatialIndexFile, byId: ReadonlyMap<string, { kind: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const placed = Object.entries(index.destinations).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const chunkKey of Object.keys(index.chunks)) {
    const here = placed.filter(([, d]) => d.chunkKey === chunkKey).map(([id]) => id);
    const district = here.find((id) => byId.get(id)?.kind === "district" || byId.get(id)?.kind === "hub");
    if (district ?? here[0]) out.set(chunkKey, (district ?? here[0]) as string);
  }
  const origin = index.streaming?.cells["0,0"];
  const fallback = origin ? out.get(origin) : undefined;
  if (fallback) for (const chunkKey of Object.values(index.streaming?.cells ?? {})) if (!out.has(chunkKey)) out.set(chunkKey, fallback);
  return out;
}

/** M2: chunks that serve any gated destination (manifest gate truth) — never streamed by proximity. */
function gatedChunkKeys(index: SpatialIndexFile, byId: ReadonlyMap<string, { gates?: readonly unknown[] }>): Set<string> {
  const out = new Set<string>();
  for (const [id, d] of Object.entries(index.destinations)) if ((byId.get(id)?.gates?.length ?? 0) > 0) out.add(d.chunkKey);
  return out;
}

/**
 * M2: position-preserving handoff (walked into the next cell / fell off the Hub). Same orchestrator,
 * same safety rules as travel; the visitor is not moved. On arrival the chunk's portals, zones and
 * thresholds are bound, the city layer swaps stand-ins, and the location becomes the place's
 * destination (no banner; the URL is REPLACED so a reload returns here, history is not spammed).
 */
async function handoffToChunk(current: AppRun, chunkKey: string, reason: "walk" | "release"): Promise<void> {
  const orchestrator = current.orchestrator;
  if (!orchestrator || current.status !== "running") return;
  const fromChunkKey = orchestrator.activeChunkKey;
  const result = await orchestrator.transitionTo({ chunkKey, spawn: null, destinationId: `handoff:${chunkKey}` });
  if (run !== current || current.status !== "running" || result.status !== "arrived" || result.kind !== "cross-chunk") return;
  syncPortals();
  syncExperience(null, fromChunkKey);
  spatialDiagnostics.update((prev) => ({ ...prev, lastHandoff: `${reason}:${chunkKey}` }));
  const homeId = current.homeOf.get(chunkKey);
  const state = appStore.state;
  const home = homeId && "loaded" in state ? state.loaded.index.byId.get(homeId) : undefined;
  if (home && "current" in state) {
    const placement = { destinationId: home.id, platform: state.placement.platform, worldId: state.placement.worldId, placementRef: placementRefFor(chunkKey) };
    appStore.update(withWalkedInto(state, home, placement));
    const query = buildDeepLinkQuery(home.id, { from: "spatial", ref: state.entry.ref ?? undefined });
    if (window.location.search !== query) window.history.replaceState(null, "", `${window.location.pathname}${query}`);
    appStore.update(withEntry(appStore.state, window.location.search));
  }
  refreshDiagnostics();
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
  const current = run;
  const state = appStore.state;
  // No travel once disposal has begun (portal callbacks / history events can still arrive).
  if (!current || current.status !== "running" || !current.adapter || !canBeginTravel(state)) return;
  const target = state.loaded.index.byId.get(destinationId);
  if (!target) return;

  const requestId = ++travelSeq;
  appStore.update(beginTravel(state, target));
  const startedAt = now();
  // M2: vertical travel (Hub ↔ city) is presented as a sky lift; presentation only, never the outcome.
  const targetY = current.spawnY.get(target.id);
  const direction = targetY === undefined ? null : liftDirection(current.runtime?.getVisitorPosition?.()?.y ?? null, targetY);
  const endLift = direction && !(target.gates?.length) ? beginSkyLift(direction, target.name) : null;
  const result = await current.adapter.travelTo(target.id).finally(() => endLift?.());
  // Stale: a newer travel owns the state now, or the run was disposed (disposal bumps the
  // sequence). The adapter also reports `superseded`, but the store guards independently so no
  // ordering of adapter results can leak an old outcome into state, diagnostics or the URL.
  if (requestId !== travelSeq || run !== current || current.status !== "running" || result.status === "superseded") return;
  refreshDiagnostics();

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
 * Tear the application down (real unmount). Returns a promise that resolves once the teardown is
 * complete; idempotent (repeated calls share it). While a boot is in progress the request is
 * recorded and honoured at the boot's next await boundary — see `bootApp` for why it is not
 * applied immediately (React Strict Mode). With no run (never booted, or a failed boot already
 * unwound) it only resets the stores.
 */
export function disposeApp(): Promise<void> {
  const current = run;
  if (!current) {
    resetStores();
    return Promise.resolve();
  }
  if (current.status === "booting") {
    current.disposeRequested = true;
    return current.settled;
  }
  if (current.status === "running") void teardown(current, { keepAppState: false });
  return current.settled;
}

/**
 * Hardened shutdown order (2B.4A). Synchronously, before the first await:
 *   1. status `disposing` + travel sequence bumped → no new travel; pending travel results can
 *      no longer settle state or write the URL; `popstate` listener removed;
 *   2. adapter phase listener removed → no late `loadingChunk` / `arrived` / portal re-sync;
 *   3. portals disposed → sensor subscriptions released (while their components still exist),
 *      deferred portal triggers invalidated;
 *   4. adapter disposed → further travel `unavailable`, listeners cleared.
 * Then, asynchronously:
 *   5. orchestrator disposed and AWAITED → in-flight work aborted, mutation queue settled, stale
 *      staged batches cleaned, active chunk retired exactly once;
 *   6. runtime disposed and AWAITED → controls/inputs/camera/animation disposed, Space destroyed
 *      exactly once, engine session settled;
 *   7. references dropped, stores reset (unless the run keeps its `error` state), run cleared.
 * Every step is best-effort: a failing step is reported and the following steps still run, so
 * the lifecycle can never remain `disposing`. Never rejects.
 */
async function teardown(current: AppRun, options: { keepAppState: boolean }): Promise<void> {
  current.status = "disposing";
  travelSeq++;
  if (current.popstateBound) {
    attempt("remove popstate listener", () => window.removeEventListener("popstate", onPopState));
    current.popstateBound = false;
  }
  attempt("unsubscribe adapter phases", () => current.unsubscribePhase?.());
  current.unsubscribePhase = null;
  attempt("dispose portals", () => current.portals?.dispose());
  current.portals = null;
  attempt("dispose experience", () => current.experience?.dispose());
  current.experience = null;
  attempt("dispose thresholds", () => current.thresholds?.dispose());
  current.thresholds = null;
  attempt("dispose discovery", () => current.discovery?.dispose());
  current.discovery = null;
  attempt("dispose streaming", () => current.streaming?.dispose());
  current.streaming = null;
  attempt("detach audition", () => current.detachAudition?.());
  current.detachAudition = null;
  attempt("detach city layer", () => current.detachCityLayer?.());
  attempt("dispose city layer", () => current.cityLayer?.dispose());
  current.detachCityLayer = null;
  current.cityLayer = null;
  attempt("dispose adapter", () => current.adapter?.dispose());
  current.adapter = null;
  await attemptAsync("dispose orchestrator", () => current.orchestrator?.dispose());
  current.orchestrator = null;
  await attemptAsync("dispose runtime", () => current.runtime?.dispose());
  current.runtime = null;
  if (process.env.NODE_ENV !== "production") delete (globalThis as Record<string, unknown>).__nrvnaverse;
  if (run === current) run = null;
  if (options.keepAppState) spatialDiagnostics.update(IDLE_DIAGNOSTICS);
  else resetStores();
  current.resolveSettled();
}

function attempt(step: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    reportShutdownError(step, err);
  }
}

async function attemptAsync(step: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    reportShutdownError(step, err);
  }
}

function resetStores(): void {
  spatialDiagnostics.update(IDLE_DIAGNOSTICS);
  resetWebContext();
  appStore.update(bootState());
}

/** Diagnostics for the prototype panel. */
export function currentAdapter(): AweSpatialAdapter | null {
  return run?.adapter ?? null;
}

/** Diagnostics/tests: the portal controller of the booted app. */
export function currentPortals(): PortalController | null {
  return run?.portals ?? null;
}

/** Diagnostics/tests: the experience controller of the booted app. */
export function currentExperience(): ExperienceController | null {
  return run?.experience ?? null;
}

/** Diagnostics/tests/UI: the threshold controller of the booted app. */
export function currentThresholds(): ThresholdController | null {
  return run?.thresholds ?? null;
}

/** Diagnostics/tests: the streaming controller of the booted app (M2). */
export function currentStreaming(): StreamingController | null {
  return run?.streaming ?? null;
}

/** Diagnostics/tests: the far-field city layer of the booted app (M2). */
export function currentCityLayer(): CityLayer | null {
  return run?.cityLayer ?? null;
}

/** Diagnostics/tests: the discovery memory of the booted app. */
export function currentDiscovery(): DiscoveryMemory | null {
  return run?.discovery ?? null;
}

/** Test-only: full teardown of whatever run exists (booting, running or disposing) and store reset. */
export async function resetAppForTests(options: { reportShutdownError?: (step: string, err: unknown) => void } = {}): Promise<void> {
  reportShutdownError = options.reportShutdownError ?? defaultShutdownReporter;
  await disposeApp();
  resetStores();
}
