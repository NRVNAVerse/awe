import type { SensorRuntime } from "@/lib/spatial/spatial-runtime";
import type { SpatialIndexThreshold } from "@/lib/spatial/spatial-index";

/**
 * NRVNAVerse WEB↔SPATIAL threshold controller (M1 experience campaign, D-020) — application layer,
 * over the generic `SensorRuntime` seam only. A threshold is a physical sensor bound to a STABLE
 * destination id whose canonical WEB context should be surfaced while the visitor stands in it:
 *
 *   player enters threshold sensor ──▶ componentId → destinationId ──▶ onThreshold(destinationId)
 *   player leaves threshold sensor ──▶                              ──▶ onThreshold(null)
 *
 * It is the portal controller's quiet sibling: same binding model (exactly the active chunk's
 * thresholds are bound, released on a chunk switch, same chunk → no-op), same deferred microtask
 * with a binding epoch, and the same refusal to know anything beyond ids — it never travels,
 * never inspects gates, never fetches, never touches the URL / history and never holds a URL to
 * the web: the canonical `webUrl` is resolved by the consumer from the manifest at display time.
 * The pipeline guarantees a threshold sensor is never a portal sensor, so the two cannot collide.
 */

export interface ThresholdTrigger {
  componentId: string;
  destinationId: string;
}

export interface ThresholdControllerOptions {
  thresholds: Readonly<Record<string, SpatialIndexThreshold>>;
  sensors: SensorRuntime;
  /** The web-context consumer: a stable id while the visitor stands in a threshold, `null` when they leave. */
  onThreshold: (destinationId: string | null, trigger: ThresholdTrigger | null) => void;
  warn?: (message: string, detail?: unknown) => void;
}

export class ThresholdController {
  private readonly thresholds: Readonly<Record<string, SpatialIndexThreshold>>;
  private readonly sensors: SensorRuntime;
  private readonly onThreshold: ThresholdControllerOptions["onThreshold"];
  private readonly warn: (message: string, detail?: unknown) => void;

  private active: string | null = null;
  /** componentId → unsubscribe functions (enter + exit) of the bound set. */
  private readonly bound = new Map<string, Array<() => void>>();
  /** The threshold the visitor currently stands in (last entered, not yet left). */
  private inside: ThresholdTrigger | null = null;
  private triggers = 0;
  private dropped = 0;
  private epoch = 0;
  private disposed = false;

  constructor(options: ThresholdControllerOptions) {
    this.thresholds = options.thresholds;
    this.sensors = options.sensors;
    this.onThreshold = options.onThreshold;
    this.warn = options.warn ?? ((message, detail) => console.warn(`[threshold-controller] ${message}`, detail ?? ""));
  }

  get activeChunkKey(): string | null {
    return this.active;
  }

  get boundComponentIds(): string[] {
    return [...this.bound.keys()];
  }

  /** The threshold the visitor is standing in (diagnostics / tests). */
  get current(): ThresholdTrigger | null {
    return this.inside;
  }

  get triggerCount(): number {
    return this.triggers;
  }

  get droppedTriggerCount(): number {
    return this.dropped;
  }

  get bindingEpoch(): number {
    return this.epoch;
  }

  thresholdsOf(chunkKey: string): Array<ThresholdTrigger & { chunkKey: string }> {
    const result: Array<ThresholdTrigger & { chunkKey: string }> = [];
    for (const [componentId, binding] of Object.entries(this.thresholds)) {
      if (binding.chunkKey === chunkKey) result.push({ componentId, chunkKey, destinationId: binding.destinationId });
    }
    return result;
  }

  /**
   * Bind exactly the thresholds owned by `chunkKey` (or none for `null`), releasing the previous
   * set first; same chunk key → no-op. A chunk switch also closes any open web context (the
   * visitor was teleported out of the threshold without a sensor exit).
   */
  activate(chunkKey: string | null): void {
    if (this.disposed) return;
    if (chunkKey === this.active) return;
    this.release();
    this.active = chunkKey;
    if (chunkKey === null) return;
    for (const threshold of this.thresholdsOf(chunkKey)) {
      const offs: Array<() => void> = [];
      try {
        offs.push(this.sensors.onPlayerEnterSensor(threshold.componentId, () => this.trigger(threshold, "enter")));
        offs.push(this.sensors.onPlayerExitSensor(threshold.componentId, () => this.trigger(threshold, "exit")));
        this.bound.set(threshold.componentId, offs);
      } catch (err) {
        for (const off of offs) off();
        this.warn(`could not bind threshold "${threshold.componentId}" of chunk "${chunkKey}"`, err);
      }
    }
  }

  /** Release every subscription, close the web context and refuse further activation. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.active = null;
  }

  private release(): void {
    this.epoch++;
    for (const [componentId, offs] of this.bound) {
      for (const off of offs) {
        try {
          off();
        } catch (err) {
          this.warn(`could not release threshold "${componentId}"`, err);
        }
      }
    }
    this.bound.clear();
    if (this.inside !== null) {
      this.inside = null;
      this.notify(null, null);
    }
  }

  private trigger(threshold: ThresholdTrigger, edge: "enter" | "exit"): void {
    if (this.disposed || !this.bound.has(threshold.componentId)) return;
    const epoch = this.epoch;
    queueMicrotask(() => {
      if (this.disposed || epoch !== this.epoch || !this.bound.has(threshold.componentId)) {
        this.dropped++;
        return;
      }
      this.triggers++;
      if (edge === "enter") {
        this.inside = { componentId: threshold.componentId, destinationId: threshold.destinationId };
        this.notify(threshold.destinationId, this.inside);
      } else if (this.inside?.componentId === threshold.componentId) {
        // Leaving the threshold we are in. Leaving another one (overlapping sensors) changes nothing.
        this.inside = null;
        this.notify(null, null);
      }
    });
  }

  private notify(destinationId: string | null, trigger: ThresholdTrigger | null): void {
    try {
      this.onThreshold(destinationId, trigger);
    } catch (err) {
      this.warn("threshold listener threw", err);
    }
  }
}
