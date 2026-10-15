import type { SceneStateRuntime, SensorRuntime } from "@/lib/spatial/spatial-runtime";
import type { ExperienceEffect, SpatialIndexArrival, SpatialIndexExperience, SpatialIndexZone } from "@/lib/spatial/spatial-index";

/**
 * NRVNAVerse experience controller (M1 experience campaign) — application layer, over the generic
 * `SensorRuntime` + `SceneStateRuntime` seams only. It makes the authored world REACT: a physical
 * sensor zone the player enters / leaves, or an arrival at a destination, becomes a sequence of
 * visibility toggles over authored component ids (state A / state B geometry):
 *
 *   player enters zone sensor ──▶ zone.enter { show[], hide[] }
 *   player leaves zone sensor ──▶ zone.exit  { show[], hide[] }
 *   arrival at destination    ──▶ beats[] { afterSeconds, show[], hide[] }   (engine-time schedule)
 *
 * Everything it knows comes from the generated spatial index (`experience`, validated by the
 * pipeline): component ids, chunk keys, destination ids. It never holds a coordinate, never
 * inspects gates, never fetches, never teleports, never touches the URL, and never targets a
 * portal sensor (the pipeline refuses that), so navigation stays exactly the M0 contract.
 *
 * Bindings follow the active chunk like the portal controller: `activate(chunkKey)` subscribes
 * exactly the zones owned by that chunk and releases the previous set (same chunk → no-op). The
 * `hideOnStage` policy for EVERY chunk is declared once at `install()` so a chunk is staged with
 * its state-B geometry already invisible; a chunk retire resets everything because its components
 * are recreated on the next visit. Sensor callbacks are deferred to a microtask with the binding
 * epoch (a stale trigger after a chunk switch / dispose is dropped, as for portals). Arrival beats
 * run on the engine clock (`schedule`); a new arrival cancels the pending beats of the previous one
 * so two sequences never interleave, and `dispose()` cancels everything.
 */

export interface ExperienceArrival {
  destinationId: string;
  /** The chunk the visitor is now in (the active chunk after the committed arrival). */
  chunkKey: string;
  /** The chunk the visitor came from (`null` for the initial placement). */
  fromChunkKey: string | null;
}

export interface ExperienceTrigger {
  kind: "zone-enter" | "zone-exit" | "arrival";
  id: string;
}

export interface ExperienceControllerOptions {
  experience: SpatialIndexExperience;
  runtime: SensorRuntime & SceneStateRuntime;
  /** Non-fatal problems (a zone that could not be bound, a component that was not staged). Defaults to `console.warn`. */
  warn?: (message: string, detail?: unknown) => void;
  /** Invoked after every applied trigger (diagnostics refresh); never influences the effect. */
  onTrigger?: (trigger: ExperienceTrigger) => void;
}

export class ExperienceController {
  private readonly experience: SpatialIndexExperience;
  private readonly runtime: SensorRuntime & SceneStateRuntime;
  private readonly warn: (message: string, detail?: unknown) => void;
  private readonly onTrigger: ((trigger: ExperienceTrigger) => void) | null;

  private active: string | null = null;
  /** zoneId → unsubscribe functions (enter and / or exit) for the currently bound zone set. */
  private readonly bound = new Map<string, Array<() => void>>();
  /** Cancel functions of the arrival beats still pending. */
  private pendingBeats: Array<() => void> = [];
  private last: ExperienceTrigger | null = null;
  private triggers = 0;
  private dropped = 0;
  private epoch = 0;
  private installed = false;
  private disposed = false;

  constructor(options: ExperienceControllerOptions) {
    this.experience = options.experience;
    this.runtime = options.runtime;
    this.warn = options.warn ?? ((message, detail) => console.warn(`[experience-controller] ${message}`, detail ?? ""));
    this.onTrigger = options.onTrigger ?? null;
  }

  /** Chunk whose zones are currently bound (diagnostics only). */
  get activeChunkKey(): string | null {
    return this.active;
  }

  /** Zone ids currently bound, in binding (sorted) order (diagnostics / tests). */
  get boundZoneIds(): string[] {
    return [...this.bound.keys()];
  }

  /** Arrival beats still pending (diagnostics / tests). */
  get pendingBeatCount(): number {
    return this.pendingBeats.length;
  }

  /** Last effect trigger applied (diagnostics only). */
  get lastTrigger(): ExperienceTrigger | null {
    return this.last;
  }

  /** Total triggers applied (diagnostics / tests). */
  get triggerCount(): number {
    return this.triggers;
  }

  /** Deferred zone triggers dropped because their binding was gone by the time the microtask ran. */
  get droppedTriggerCount(): number {
    return this.dropped;
  }

  /** Current binding epoch (diagnostics / tests). */
  get bindingEpoch(): number {
    return this.epoch;
  }

  /** Zones owned by a chunk, in generated-index (sorted) order. */
  zonesOf(chunkKey: string): Array<{ id: string } & SpatialIndexZone> {
    const result: Array<{ id: string } & SpatialIndexZone> = [];
    for (const [id, zone] of Object.entries(this.experience.zones)) {
      if (zone.chunkKey === chunkKey) result.push({ id, ...zone });
    }
    return result;
  }

  /** Arrival rules that apply to an arrival, in generated-index (sorted) order. */
  arrivalsFor(arrival: ExperienceArrival): Array<{ id: string } & SpatialIndexArrival> {
    const result: Array<{ id: string } & SpatialIndexArrival> = [];
    for (const [id, rule] of Object.entries(this.experience.arrivals)) {
      if (rule.destinationId !== arrival.destinationId) continue;
      if (rule.fromChunkKey !== undefined && rule.fromChunkKey !== arrival.fromChunkKey) continue;
      result.push({ id, ...rule });
    }
    return result;
  }

  /**
   * Declare the hidden-on-stage policy of every chunk to the runtime. Call once, before the first
   * chunk is staged (the store does this right after the runtime is created). Idempotent.
   */
  install(): void {
    if (this.disposed || this.installed) return;
    this.installed = true;
    for (const [chunkKey, ids] of Object.entries(this.experience.hidden)) {
      try {
        this.runtime.hideOnStage(chunkKey, ids);
      } catch (err) {
        this.warn(`could not declare the hidden set of chunk "${chunkKey}"`, err);
      }
    }
  }

  /**
   * Bind exactly the zones owned by `chunkKey` (or none for `null`), releasing the previous set
   * first. Same chunk key again → no-op. A zone that cannot be bound is reported and skipped:
   * experience activation never influences travel.
   */
  activate(chunkKey: string | null): void {
    if (this.disposed) return;
    if (chunkKey === this.active) return;
    this.release();
    this.active = chunkKey;
    if (chunkKey === null) return;
    for (const zone of this.zonesOf(chunkKey)) {
      const offs: Array<() => void> = [];
      try {
        if (zone.enter) offs.push(this.runtime.onPlayerEnterSensor(zone.sensorId, () => this.trigger({ kind: "zone-enter", id: zone.id }, zone.enter!)));
        if (zone.exit) offs.push(this.runtime.onPlayerExitSensor(zone.sensorId, () => this.trigger({ kind: "zone-exit", id: zone.id }, zone.exit!)));
        this.bound.set(zone.id, offs);
      } catch (err) {
        for (const off of offs) off();
        this.warn(`could not bind zone "${zone.id}" of chunk "${chunkKey}"`, err);
      }
    }
  }

  /**
   * The visitor has arrived (committed by the orchestrator). Cancels the beats of any previous
   * arrival still pending, then schedules the matching rules' beats on the engine clock. A beat at
   * 0 s is applied immediately (synchronously), so an arrival state is never one frame late.
   */
  onArrival(arrival: ExperienceArrival): void {
    if (this.disposed) return;
    this.cancelBeats();
    for (const rule of this.arrivalsFor(arrival)) {
      for (const [i, beat] of rule.beats.entries()) {
        const apply = () => {
          this.pendingBeats = this.pendingBeats.filter((c) => c !== cancel);
          this.apply({ kind: "arrival", id: `${rule.id}#${i}` }, beat);
        };
        if (beat.afterSeconds === 0) {
          apply();
          continue;
        }
        let cancel: () => void = () => {};
        try {
          cancel = this.runtime.schedule(beat.afterSeconds, apply);
        } catch (err) {
          this.warn(`could not schedule beat ${i} of arrival "${rule.id}"`, err);
          continue;
        }
        this.pendingBeats.push(cancel);
      }
    }
  }

  /**
   * Apply a visibility effect to the currently staged world on behalf of another app-layer system
   * (the discovery memory): same hide-before-show semantics as a zone or beat, reported as an
   * `arrival`-kind trigger labelled by the caller. Never travels, never schedules.
   */
  applyEffect(effect: ExperienceEffect, label: string): void {
    if (this.disposed) return;
    this.apply({ kind: "arrival", id: label }, effect);
  }

  /** Release every subscription, cancel pending beats and refuse further activation. Call BEFORE the orchestrator / runtime are disposed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelBeats();
    this.release();
    this.active = null;
  }

  private release(): void {
    this.epoch++;
    for (const [zoneId, offs] of this.bound) {
      for (const off of offs) {
        try {
          off();
        } catch (err) {
          this.warn(`could not release zone "${zoneId}"`, err);
        }
      }
    }
    this.bound.clear();
  }

  private cancelBeats(): void {
    const pending = this.pendingBeats;
    this.pendingBeats = [];
    for (const cancel of pending) {
      try {
        cancel();
      } catch (err) {
        this.warn("could not cancel a pending arrival beat", err);
      }
    }
  }

  private trigger(trigger: ExperienceTrigger, effect: ExperienceEffect): void {
    if (this.disposed || !this.bound.has(trigger.id)) return;
    const epoch = this.epoch;
    queueMicrotask(() => {
      if (this.disposed || epoch !== this.epoch || !this.bound.has(trigger.id)) {
        this.dropped++;
        return;
      }
      this.apply(trigger, effect);
    });
  }

  private apply(trigger: ExperienceTrigger, effect: ExperienceEffect): void {
    if (this.disposed) return;
    this.triggers++;
    this.last = trigger;
    for (const id of effect.hide ?? []) this.setVisible(id, false, trigger);
    for (const id of effect.show ?? []) this.setVisible(id, true, trigger);
    try {
      this.onTrigger?.(trigger);
    } catch (err) {
      this.warn("trigger listener threw", err);
    }
  }

  private setVisible(componentId: string, visible: boolean, trigger: ExperienceTrigger): void {
    try {
      if (!this.runtime.setComponentVisible(componentId, visible)) {
        this.warn(`${trigger.kind} "${trigger.id}": component "${componentId}" is not staged`);
      }
    } catch (err) {
      this.warn(`${trigger.kind} "${trigger.id}": could not ${visible ? "show" : "hide"} "${componentId}"`, err);
    }
  }
}
