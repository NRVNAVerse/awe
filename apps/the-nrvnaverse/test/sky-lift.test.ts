import { afterEach, describe, expect, it, vi } from "vitest";
import { beginSkyLift, liftDirection, skyLiftStore, SKY_LIFT_MIN_MS } from "@/lib/sky-lift";

describe("sky lift presentation (M2)", () => {
  afterEach(() => {
    vi.useRealTimers();
    skyLiftStore.update(() => ({ kind: "none" }));
  });

  it("classifies vertical travel only (Hub ↔ city), never level travel or an unknown position", () => {
    expect(liftDirection(0.5, 141)).toBe("up");
    expect(liftDirection(140.6, 0.5)).toBe("down");
    expect(liftDirection(0.5, 1.5)).toBeNull(); // Fashion → Brand
    expect(liftDirection(0.5, 20)).toBeNull();
    expect(liftDirection(null, 141)).toBeNull();
  });

  it("holds the veil for the minimum ride time, and a newer lift keeps it", () => {
    vi.useFakeTimers();
    let t = 0;
    const clock = () => t;
    const end = beginSkyLift("up", "THE NRVNAVerse Hub", clock);
    expect(skyLiftStore.state).toMatchObject({ kind: "lift", direction: "up", to: "THE NRVNAVerse Hub" });
    t = 300;
    end();
    vi.advanceTimersByTime(SKY_LIFT_MIN_MS - 301);
    expect(skyLiftStore.state.kind).toBe("lift");
    vi.advanceTimersByTime(2);
    expect(skyLiftStore.state.kind).toBe("none");
    // Overlapping lifts: the first ending never clears the second.
    const a = beginSkyLift("down", "Music District", clock);
    beginSkyLift("up", "THE NRVNAVerse Hub", clock);
    a();
    vi.advanceTimersByTime(SKY_LIFT_MIN_MS + 10);
    expect(skyLiftStore.state).toMatchObject({ kind: "lift", direction: "up" });
  });
});
