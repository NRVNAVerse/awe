import { abortError } from "@/lib/spatial/chunk-data-source";
import type { ChunkComponentRecord } from "@/lib/spatial/chunk-payload";

/**
 * Engine-agnostic "all or nothing" component instantiation.
 *
 * The real runtime binds `create` to the official `space.components.create(data, { abort })` and
 * `destroy` to `space.components.destroy(component)`; tests bind fakes. Keeping the batching
 * logic here (instead of inside the engine-importing runtime file) makes the partial-failure
 * cleanup unit-testable without the engine.
 *
 * Contract:
 * - every record is created (in parallel — records inside one chunk are independent);
 * - if ANY creation rejects, resolves `null` (the official API resolves `null` when its abort
 *   signal fires) or the signal is aborted, every component that WAS created is destroyed and
 *   the batch rejects — nothing is left behind;
 * - on success the created components are returned in record order.
 */
export interface ComponentBatchOps<T> {
  create(record: ChunkComponentRecord, signal: AbortSignal): Promise<T | null>;
  destroy(component: T): void;
}

export class ComponentBatchError extends Error {
  readonly failures: Array<{ id: string; reason: unknown }>;
  constructor(message: string, failures: Array<{ id: string; reason: unknown }>) {
    super(message);
    this.name = "ComponentBatchError";
    this.failures = failures;
  }
}

export async function createComponentBatch<T>(records: readonly ChunkComponentRecord[], ops: ComponentBatchOps<T>, signal: AbortSignal): Promise<T[]> {
  if (signal.aborted) throw abortError();

  const settled = await Promise.allSettled(records.map((record) => ops.create(record, signal)));

  const created: T[] = [];
  const failures: Array<{ id: string; reason: unknown }> = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled" && result.value !== null && result.value !== undefined) {
      created.push(result.value);
    } else if (result.status === "rejected") {
      failures.push({ id: records[i].id, reason: result.reason });
    } else {
      failures.push({ id: records[i].id, reason: signal.aborted ? abortError() : new Error("component creation returned nothing") });
    }
  });

  if (failures.length === 0 && !signal.aborted) return created;

  // Roll back whatever did get created; report every cleanup problem but never throw from cleanup.
  for (const component of created) {
    try {
      ops.destroy(component);
    } catch (err) {
      failures.push({ id: "(cleanup)", reason: err });
    }
  }

  if (signal.aborted) throw abortError();
  const first = failures[0]?.reason;
  const detail = first instanceof Error ? first.message : String(first);
  throw new ComponentBatchError(`${failures.length} of ${records.length} components failed to create (${failures[0]?.id}: ${detail})`, failures);
}
