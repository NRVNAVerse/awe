import type { SensorRuntime } from "@/lib/spatial/spatial-runtime";
import type { SpatialIndexPortal } from "@/lib/spatial/spatial-index";

/**
 * NRVNAVerse portal controller (M0 Step 2B.3, D-004 / D-006 / D-016) — application layer, over
 * the generic `SensorRuntime` seam only. It turns a PHYSICAL sensor entry into a STABLE-ID travel
 * request and nothing else:
 *
 *   player enters sensor component ──▶ componentId → destinationId ──▶ onPortalEntered(destinationId)
 *
 * The supplied callback is the existing `travelToDestination(destinationId)`, so a portal inherits
 * request sequencing, latest-request-wins, rollback, chunk orchestration, gate-before-fetch and the
 * URL contract from the one travel path. This class therefore never: inspects gates, fetches a
 * chunk, teleports, resolves a spawn, touches the URL/history, or holds coordinates — a binding is
 * `{ chunkKey, destinationId }` keyed by the physical component id (from the generated index).
 *
 * Bindings follow the active chunk: `activate(chunkKey)` subscribes exactly the portals owned by
 * that chunk (they exist only while their chunk is staged) and unsubscribes the previous set; the
 * same chunk key again is a no-op so same-chunk travel never rebinds sensors. SENSOR ENTER only:
 * one physical entry → one request; standing inside a portal triggers nothing further and a
 * refused (gated) portal stays bound — the visitor must leave and re-enter to try again.
 *
 * The callback is deferred to a microtask so the travel starts after the engine's physics/event
 * dispatch for the frame has completed rather than inside the sensor emit.
 */

export interface PortalTrigger {
  componentId: string;
  destinationId: string;
}

export interface PortalControllerOptions {
  /** Physical portal bindings from `parseSpatialIndex(...).portals`. */
  portals: Readonly<Record<string, SpatialIndexPortal>>;
  sensors: SensorRuntime;
  /** The stable-id travel entry point, e.g. `(id) => travelToDestination(id)`. May return a promise. */
  onPortalEntered: (destinationId: string) => void | Promise<void>;
  /** Non-fatal problems (a portal that could not be bound, a rejected travel promise). Defaults to `console.warn`. */
  warn?: (message: string, detail?: unknown) => void;
}

export class PortalController {
  private readonly portals: Readonly<Record<string, SpatialIndexPortal>>;
  private readonly sensors: SensorRuntime;
  private readonly onPortalEntered: (destinationId: string) => void | Promise<void>;
  private readonly warn: (message: string, detail?: unknown) => void;

  private active: string | null = null;
  /** componentId → unsubscribe, for the currently bound portal set. */
  private readonly bound = new Map<string, () => void>();
  private last: PortalTrigger | null = null;
  private triggers = 0;
  private disposed = false;

  constructor(options: PortalControllerOptions) {
    this.portals = options.portals;
    this.sensors = options.sensors;
    this.onPortalEntered = options.onPortalEntered;
    this.warn = options.warn ?? ((message, detail) => console.warn(`[portal-controller] ${message}`, detail ?? ""));
  }

  /** Chunk whose portals are currently bound (diagnostics only). */
  get activeChunkKey(): string | null {
    return this.active;
  }

  /** Number of sensor subscriptions currently held (diagnostics only). */
  get boundPortalCount(): number {
    return this.bound.size;
  }

  /** Physical component ids currently bound, in binding order (diagnostics/tests). */
  get boundComponentIds(): string[] {
    return [...this.bound.keys()];
  }

  /** Last portal the player entered (diagnostics only). */
  get lastTrigger(): PortalTrigger | null {
    return this.last;
  }

  /** Total portal entries routed to the callback (diagnostics/tests). */
  get triggerCount(): number {
    return this.triggers;
  }

  /** Portal bindings owned by a chunk, in generated-index (sorted) order. */
  portalsOf(chunkKey: string): Array<PortalTrigger & { chunkKey: string }> {
    const result: Array<PortalTrigger & { chunkKey: string }> = [];
    for (const [componentId, binding] of Object.entries(this.portals)) {
      if (binding.chunkKey === chunkKey) result.push({ componentId, chunkKey, destinationId: binding.destinationId });
    }
    return result;
  }

  /**
   * Bind exactly the portals owned by `chunkKey` (or none for `null`), releasing the previous
   * set first. Same chunk key again → no-op (no duplicate listeners, no rebind). A portal that
   * cannot be bound is reported through `warn` and skipped: portal activation never determines
   * travel success and never throws into the travel path.
   */
  activate(chunkKey: string | null): void {
    if (this.disposed) return;
    if (chunkKey === this.active) return;
    this.release();
    this.active = chunkKey;
    if (chunkKey === null) return;
    for (const portal of this.portalsOf(chunkKey)) {
      try {
        const off = this.sensors.onPlayerEnterSensor(portal.componentId, () => this.trigger(portal));
        this.bound.set(portal.componentId, off);
      } catch (err) {
        this.warn(`could not bind portal "${portal.componentId}" of chunk "${chunkKey}"`, err);
      }
    }
  }

  /** Release every sensor subscription and refuse further activation. Call BEFORE the orchestrator/runtime are disposed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.active = null;
  }

  private release(): void {
    for (const off of this.bound.values()) off();
    this.bound.clear();
  }

  private trigger(portal: PortalTrigger): void {
    if (this.disposed || !this.bound.has(portal.componentId)) return;
    this.triggers++;
    this.last = { componentId: portal.componentId, destinationId: portal.destinationId };
    queueMicrotask(() => {
      if (this.disposed) return;
      try {
        const result = this.onPortalEntered(portal.destinationId);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch((err) => this.warn(`portal travel to "${portal.destinationId}" rejected`, err));
        }
      } catch (err) {
        this.warn(`portal travel to "${portal.destinationId}" threw`, err);
      }
    });
  }
}
