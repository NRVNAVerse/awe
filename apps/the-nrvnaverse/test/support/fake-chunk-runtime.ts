import type { ChunkPayload } from "@/lib/spatial/chunk-payload";
import { createComponentBatch } from "@/lib/spatial/component-batch";
import type { SpawnPoint } from "@/lib/spatial/placement-registry";
import { subscribePlayerEnterSensor, subscribePlayerExitSensor, type SensorHost } from "@/lib/spatial/sensor-subscription";
import type { ChunkBatch, ChunkRuntime, SceneStateRuntime, SensorRuntime } from "@/lib/spatial/spatial-runtime";

/**
 * Deterministic in-memory stand-in for `AweSpatialRuntime`. It keeps a "world" of live component
 * ids, records every operation in order (so tests can assert e.g. that the old chunk was retired
 * only after the teleport), and can be told to fail or stall at precise points:
 *
 * - `failCreate[id]`: creating that component rejects (others in the same batch succeed first,
 *   which exercises partial-batch cleanup exactly like the real batch helper does);
 * - `holdStage` / `holdStageEnd`: staging waits until `releaseStage()` is called, before creating
 *   anything or after everything exists (to interleave requests at precise points);
 * - `failPlace`: the next `placeVisitor` throws;
 * - `failRetire`: retiring throws AFTER removing the components (cleanup-failure path).
 *
 * Staging goes through the same `createComponentBatch` helper the real runtime uses, so the
 * all-or-nothing contract is the real one, not a re-implementation. Likewise the sensor seam
 * (`onPlayerEnterSensor`) goes through the real `subscribePlayerEnterSensor` helper over an
 * in-memory emitter per live component; `enterSensor(id, other)` simulates an intersection.
 */
export class FakeChunkRuntime implements ChunkRuntime, SensorRuntime, SceneStateRuntime {
  isReady = true;
  /** Live component ids ("the world"). Global scene components are not modelled. */
  readonly world = new Set<string>();
  /** Live component records (to read collider configuration). */
  readonly records = new Map<string, Record<string, unknown>>();
  /** Sensor-enter listeners per live component id (`other` = the intersecting component id). */
  readonly sensorListeners = new Map<string, Set<(other: string) => void>>();
  /** Sensor-exit listeners per live component id. */
  readonly sensorExitListeners = new Map<string, Set<(other: string) => void>>();
  /** Visibility of live components (true unless hidden on stage or by `setComponentVisible`). */
  readonly visibility = new Map<string, boolean>();
  /** `hideOnStage` declarations per chunk key. */
  readonly hiddenOnStage = new Map<string, readonly string[]>();
  /** Pending `schedule` callbacks in order of registration; `advance(seconds)` runs the due ones. */
  readonly timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  /** Engine-time clock in seconds for `schedule` / `advance`. */
  clock = 0;
  /** The id the sensor seam treats as the player avatar. */
  readonly playerId = "Player";
  /** Ordered operation log: `stage:<key>`, `create:<id>`, `destroy:<id>`, `place:<x,y,z>`, `retire:<key>`. */
  readonly log: string[] = [];
  readonly placed: SpawnPoint[] = [];
  readonly batches = new Map<ChunkBatch, string[]>();

  failCreate: Record<string, string> = {};
  failPlace: string | null = null;
  failRetire: string | null = null;
  /** When set, every stage waits for `releaseStage()` before creating anything. */
  holdStage = false;
  /**
   * When set, a stage waits for `releaseStage()` AFTER all components exist and before the batch
   * is handed back — models components that finished creating before an abort was observed.
   */
  holdStageEnd = false;
  private stageWaiters: Array<() => void> = [];
  /** Per-component creation delay in ms (0 = resolve on the microtask queue). */
  createDelayMs = 0;

  placeVisitor(spawn: SpawnPoint): void {
    if (!this.isReady) throw new Error("runtime is not ready");
    if (this.failPlace) {
      const reason = this.failPlace;
      this.failPlace = null;
      throw new Error(reason);
    }
    this.placed.push(spawn);
    this.log.push(`place:${spawn.position.x},${spawn.position.y},${spawn.position.z}`);
  }

  async stageChunk(payload: ChunkPayload, signal: AbortSignal): Promise<ChunkBatch> {
    if (!this.isReady) throw new Error("runtime is not ready");
    this.log.push(`stage:${payload.chunkKey}`);
    if (this.holdStage) await new Promise<void>((resolve) => this.stageWaiters.push(resolve));
    const records = Object.values(payload.components);
    const ids = await createComponentBatch<string>(
      records,
      {
        create: async (record, abort) => {
          if (this.createDelayMs > 0) await new Promise((r) => setTimeout(r, this.createDelayMs));
          if (abort.aborted) return null; // official ComponentManager.create resolves null when aborted
          if (record.id in this.failCreate) throw new Error(this.failCreate[record.id]);
          if (this.world.has(record.id)) throw new Error(`duplicate component id "${record.id}"`);
          this.world.add(record.id);
          this.records.set(record.id, record);
          this.visibility.set(record.id, true);
          this.log.push(`create:${record.id}`);
          return record.id;
        },
        destroy: (id) => {
          this.disposeComponent(id);
          this.log.push(`destroy:${id}`);
        },
      },
      signal,
    );
    if (this.holdStageEnd) await new Promise<void>((resolve) => this.stageWaiters.push(resolve));
    // Hidden-on-stage policy, applied exactly like the real runtime: before the batch is handed back.
    for (const id of this.hiddenOnStage.get(payload.chunkKey) ?? []) {
      if (this.world.has(id) && ids.includes(id)) {
        this.visibility.set(id, false);
        this.log.push(`hide-on-stage:${id}`);
      }
    }
    const batch: ChunkBatch = { chunkKey: payload.chunkKey, componentIds: ids };
    this.batches.set(batch, ids);
    return batch;
  }

  hideOnStage(chunkKey: string, componentIds: readonly string[]): void {
    this.hiddenOnStage.set(chunkKey, [...componentIds]);
  }

  setComponentVisible(componentId: string, visible: boolean): boolean {
    if (!this.world.has(componentId)) return false;
    this.visibility.set(componentId, visible);
    this.log.push(`${visible ? "show" : "hide"}:${componentId}`);
    return true;
  }

  schedule(delaySeconds: number, callback: () => void): () => void {
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) throw new Error("schedule requires a non-negative finite delay");
    const timer = { at: this.clock + delaySeconds, callback, cancelled: false };
    this.timers.push(timer);
    this.log.push(`schedule:${delaySeconds}`);
    return () => {
      timer.cancelled = true;
    };
  }

  /** Advance engine time and run every due, uncancelled timer in time order (ties in registration order). */
  advance(seconds: number): void {
    this.clock += seconds;
    for (;;) {
      const due = this.timers.filter((t) => !t.cancelled && t.at <= this.clock).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cancelled = true;
      due.callback();
    }
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].cancelled) this.timers.splice(i, 1);
  }

  /** Pending (uncancelled, not yet due) timers. */
  get pendingTimerCount(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }

  /** Visibility of a live component (`undefined` when it is not live). */
  visibleOf(componentId: string): boolean | undefined {
    return this.visibility.get(componentId);
  }

  retireChunk(batch: ChunkBatch): void {
    const ids = this.batches.get(batch);
    if (!ids) return;
    this.batches.delete(batch);
    this.log.push(`retire:${batch.chunkKey}`);
    for (const id of ids) {
      this.disposeComponent(id);
      this.log.push(`destroy:${id}`);
    }
    if (this.failRetire) {
      const reason = this.failRetire;
      this.failRetire = null;
      throw new Error(reason);
    }
  }

  /** Real subscription helper over the in-memory world (see `sensor-subscription.ts`). */
  onPlayerEnterSensor(componentId: string, callback: () => void): () => void {
    if (!this.isReady) throw new Error("runtime is not ready");
    const host: SensorHost<string> = {
      resolve: (id) => (this.world.has(id) ? id : undefined),
      isSensor: (id) => {
        const collider = this.records.get(id)?.collider as Record<string, unknown> | undefined;
        return collider?.enabled === true && collider?.isSensor === true;
      },
      onSensorEnter: (id, listener) => {
        if (!this.sensorListeners.has(id)) this.sensorListeners.set(id, new Set());
        this.sensorListeners.get(id)!.add(listener);
        this.log.push(`sensor-on:${id}`);
        return () => {
          // Mirrors an engine emitter that is gone once the component was disposed.
          if (!this.world.has(id)) throw new Error(`component "${id}" is disposed`);
          this.sensorListeners.get(id)?.delete(listener);
          this.log.push(`sensor-off:${id}`);
        };
      },
      onSensorExit: (id, listener) => {
        if (!this.sensorExitListeners.has(id)) this.sensorExitListeners.set(id, new Set());
        this.sensorExitListeners.get(id)!.add(listener);
        this.log.push(`sensor-exit-on:${id}`);
        return () => {
          if (!this.world.has(id)) throw new Error(`component "${id}" is disposed`);
          this.sensorExitListeners.get(id)?.delete(listener);
          this.log.push(`sensor-exit-off:${id}`);
        };
      },
    };
    return subscribePlayerEnterSensor(host, componentId, this.playerId, callback);
  }

  onPlayerExitSensor(componentId: string, callback: () => void): () => void {
    if (!this.isReady) throw new Error("runtime is not ready");
    const host: SensorHost<string> = {
      resolve: (id) => (this.world.has(id) ? id : undefined),
      isSensor: (id) => {
        const collider = this.records.get(id)?.collider as Record<string, unknown> | undefined;
        return collider?.enabled === true && collider?.isSensor === true;
      },
      onSensorEnter: () => () => {},
      onSensorExit: (id, listener) => {
        if (!this.sensorExitListeners.has(id)) this.sensorExitListeners.set(id, new Set());
        this.sensorExitListeners.get(id)!.add(listener);
        this.log.push(`sensor-exit-on:${id}`);
        return () => {
          if (!this.world.has(id)) throw new Error(`component "${id}" is disposed`);
          this.sensorExitListeners.get(id)?.delete(listener);
          this.log.push(`sensor-exit-off:${id}`);
        };
      },
    };
    return subscribePlayerExitSensor(host, componentId, this.playerId, callback);
  }

  /** Simulate `other` entering the sensor of a live component (the player by default). */
  enterSensor(componentId: string, other: string = this.playerId): void {
    if (!this.world.has(componentId)) throw new Error(`component "${componentId}" is not live`);
    this.log.push(`enter:${componentId}:${other}`);
    for (const listener of this.sensorListeners.get(componentId) ?? []) listener(other);
  }

  /** Simulate `other` leaving the sensor of a live component (the player by default). */
  exitSensor(componentId: string, other: string = this.playerId): void {
    if (!this.world.has(componentId)) throw new Error(`component "${componentId}" is not live`);
    this.log.push(`exit:${componentId}:${other}`);
    for (const listener of this.sensorExitListeners.get(componentId) ?? []) listener(other);
  }

  /** Number of sensor listeners on a component (0 once it is disposed). */
  sensorListenerCount(componentId: string): number {
    return this.sensorListeners.get(componentId)?.size ?? 0;
  }

  /** Number of sensor-exit listeners on a component (0 once it is disposed). */
  sensorExitListenerCount(componentId: string): number {
    return this.sensorExitListeners.get(componentId)?.size ?? 0;
  }

  private disposeComponent(id: string): void {
    this.world.delete(id);
    this.records.delete(id);
    this.sensorListeners.delete(id);
    this.sensorExitListeners.delete(id);
    this.visibility.delete(id);
  }

  /** Let every held stage proceed. */
  releaseStage(): void {
    const waiters = this.stageWaiters;
    this.stageWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Ids of live components that belong to the given chunk payload. */
  liveOf(payload: ChunkPayload): string[] {
    return Object.keys(payload.components).filter((id) => this.world.has(id));
  }
}

/** Let pending microtasks / timers run (the orchestrator has several await boundaries). */
export async function flush(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
