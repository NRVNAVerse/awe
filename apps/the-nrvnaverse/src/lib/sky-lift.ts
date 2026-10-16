import { Store } from "@/hooks/use-store";

/**
 * M2 sky-lift transition state. A travel whose target spawn is more than `SKY_LIFT_MIN_RISE` metres
 * above or below the visitor (Hub ↔ city lifts, directory jumps between them) is presented as a
 * lift: a full-screen dusk veil with the direction and the destination name, held for at least
 * `SKY_LIFT_MIN_MS` so the jump-cut reads as a ride. Purely presentational: it never changes the
 * travel outcome, never blocks input to the HUD and is cleared whatever the result.
 */
export const SKY_LIFT_MIN_RISE = 40;
export const SKY_LIFT_MIN_MS = 1400;

export type SkyLiftState = { kind: "none" } | { kind: "lift"; direction: "up" | "down"; to: string; seq: number };

export const skyLiftStore = new Store<SkyLiftState>({ kind: "none" });

let seq = 0;

/** Classify a travel by vertical distance; returns null for an ordinary (level) travel. */
export function liftDirection(fromY: number | null, toY: number): "up" | "down" | null {
  if (fromY === null || !Number.isFinite(fromY)) return null;
  const dy = toY - fromY;
  if (Math.abs(dy) < SKY_LIFT_MIN_RISE) return null;
  return dy > 0 ? "up" : "down";
}

/** Begin a lift presentation; returns the function that ends it (after the minimum hold). */
export function beginSkyLift(direction: "up" | "down", to: string, now: () => number = () => performance.now()): () => void {
  const mine = ++seq;
  const started = now();
  skyLiftStore.update(() => ({ kind: "lift", direction, to, seq: mine }));
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const rest = Math.max(0, SKY_LIFT_MIN_MS - (now() - started));
    setTimeout(() => {
      // A newer lift owns the veil now; leave it.
      if (skyLiftStore.state.kind === "lift" && skyLiftStore.state.seq === mine) skyLiftStore.update(() => ({ kind: "none" }));
    }, rest);
  };
}
