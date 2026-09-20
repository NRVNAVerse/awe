import { describe, expect, it } from "vitest";
import type { ChunkComponentRecord } from "@/lib/spatial/chunk-payload";
import { ComponentBatchError, createComponentBatch, type ComponentBatchOps } from "@/lib/spatial/component-batch";

const records: ChunkComponentRecord[] = [
  { id: "a", type: "mesh" },
  { id: "b", type: "mesh" },
  { id: "c", type: "text" },
];

/** Fake engine: `create` resolves the id (or fails / returns null per record); `destroy` records. */
function fakeOps(opts: { fail?: Record<string, string>; nulls?: string[]; destroyThrows?: string[]; onCreate?: (id: string) => void } = {}) {
  const live = new Set<string>();
  const destroyed: string[] = [];
  const ops: ComponentBatchOps<string> = {
    async create(record) {
      await Promise.resolve();
      opts.onCreate?.(record.id);
      if (opts.fail && record.id in opts.fail) throw new Error(opts.fail[record.id]);
      if (opts.nulls?.includes(record.id)) return null;
      live.add(record.id);
      return record.id;
    },
    destroy(id) {
      if (opts.destroyThrows?.includes(id)) throw new Error(`cannot destroy ${id}`);
      live.delete(id);
      destroyed.push(id);
    },
  };
  return { ops, live, destroyed };
}

describe("createComponentBatch — all-or-nothing component instantiation", () => {
  it("creates every record and returns the components in record order", async () => {
    const { ops, live } = fakeOps();
    const created = await createComponentBatch(records, ops, new AbortController().signal);
    expect(created).toEqual(["a", "b", "c"]);
    expect([...live]).toEqual(["a", "b", "c"]);
  });

  it("destroys everything that was created when one creation fails, and reports which failed", async () => {
    const { ops, live, destroyed } = fakeOps({ fail: { b: "shader exploded" } });
    const err = await createComponentBatch(records, ops, new AbortController().signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComponentBatchError);
    expect((err as ComponentBatchError).message).toMatch(/1 of 3 components failed to create \(b: shader exploded\)/);
    expect((err as ComponentBatchError).failures.map((f) => f.id)).toEqual(["b"]);
    expect(live.size).toBe(0);
    expect(destroyed.sort()).toEqual(["a", "c"]);
  });

  it("treats a null result (the official API's aborted answer) as a failure of that record", async () => {
    const { ops, live, destroyed } = fakeOps({ nulls: ["c"] });
    await expect(createComponentBatch(records, ops, new AbortController().signal)).rejects.toBeInstanceOf(ComponentBatchError);
    expect(live.size).toBe(0);
    expect(destroyed.sort()).toEqual(["a", "b"]);
  });

  it("rejects immediately with AbortError when the signal is already aborted (nothing is created)", async () => {
    const seen: string[] = [];
    const { ops } = fakeOps({ onCreate: (id) => seen.push(id) });
    const controller = new AbortController();
    controller.abort();
    await expect(createComponentBatch(records, ops, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([]);
  });

  it("rolls back and rejects with AbortError when aborted mid-flight even if every create resolved", async () => {
    const controller = new AbortController();
    const { ops, live, destroyed } = fakeOps({ onCreate: (id) => id === "b" && controller.abort() });
    await expect(createComponentBatch(records, ops, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(live.size).toBe(0);
    expect(destroyed.length).toBeGreaterThan(0);
  });

  it("never throws from cleanup itself: a failing destroy is appended to the failures", async () => {
    const { ops } = fakeOps({ fail: { c: "nope" }, destroyThrows: ["a"] });
    const err = (await createComponentBatch(records, ops, new AbortController().signal).catch((e: unknown) => e)) as ComponentBatchError;
    expect(err).toBeInstanceOf(ComponentBatchError);
    expect(err.failures.map((f) => f.id)).toEqual(["c", "(cleanup)"]);
  });
});
