/**
 * Lightweight runtime-lifecycle instrumentation (M0 Step 2A). Wraps `performance.mark` /
 * `performance.measure` so the beginning of the P1/P2 measurements exists without any
 * analytics infrastructure. Nothing is sent anywhere; in development each measure is also
 * logged to the console. Safe to call in non-browser environments (no-ops).
 */

export const PERF_PREFIX = "nrvna:";

export interface PerfMeasurement {
  name: string;
  durationMs: number;
  /** Extra detail, e.g. the destination id or outcome. Never contains coordinates. */
  detail: Record<string, string | number | boolean | null>;
}

const measurements: PerfMeasurement[] = [];
const listeners = new Set<(m: PerfMeasurement) => void>();

function perf(): Performance | null {
  return typeof performance !== "undefined" && typeof performance.mark === "function" ? performance : null;
}

export function perfMark(name: string): void {
  try {
    perf()?.mark(PERF_PREFIX + name);
  } catch {
    /* marks are best-effort */
  }
}

/** Measure `name` between two earlier marks (or from a mark to now). Returns the duration in ms, or null. */
export function perfMeasure(name: string, startMark: string, endMark?: string, detail: PerfMeasurement["detail"] = {}): number | null {
  const p = perf();
  if (!p) return null;
  try {
    const entry = endMark
      ? p.measure(PERF_PREFIX + name, PERF_PREFIX + startMark, PERF_PREFIX + endMark)
      : p.measure(PERF_PREFIX + name, PERF_PREFIX + startMark);
    const durationMs = Math.round((entry?.duration ?? 0) * 10) / 10;
    record({ name, durationMs, detail });
    return durationMs;
  } catch {
    return null;
  }
}

/** Record a duration measured by hand (e.g. from `performance.now()` deltas). */
export function perfRecord(name: string, durationMs: number, detail: PerfMeasurement["detail"] = {}): void {
  record({ name, durationMs: Math.round(durationMs * 10) / 10, detail });
}

function record(m: PerfMeasurement) {
  measurements.push(m);
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    console.debug(`[perf] ${m.name}: ${m.durationMs} ms`, m.detail);
  }
  for (const l of listeners) l(m);
}

export function perfMeasurements(): readonly PerfMeasurement[] {
  return measurements;
}

export function onPerfMeasurement(listener: (m: PerfMeasurement) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function now(): number {
  return perf()?.now() ?? Date.now();
}
