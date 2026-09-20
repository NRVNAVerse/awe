"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/hooks/use-store";
import type { AppState } from "@/lib/app-state";
import { spatialDiagnostics } from "@/lib/app-store";
import { onPerfMeasurement, perfMeasurements, type PerfMeasurement } from "@/lib/perf";

/**
 * Diagnostics for the spatial layer. Shows the adapter's coordinate-free placement handle, the
 * active chunk key, its last reported phase and the lightweight performance measurements. Never
 * shows a coordinate. The chunk key is diagnostics only — never identity, never in a URL.
 */
export function SpatialPanel({ state }: { state: AppState }) {
  const diagnostics = useStore(spatialDiagnostics);
  const [measures, setMeasures] = useState<readonly PerfMeasurement[]>(() => perfMeasurements());

  useEffect(() => onPerfMeasurement(() => setMeasures([...perfMeasurements()])), []);

  const placement = "placement" in state ? state.placement : null;

  return (
    <section className="rounded border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
      <h3 className="font-semibold text-neutral-300">Spatial travel</h3>
      <p className="mt-1">
        adapter: <code>{diagnostics.adapterName ?? "—"}</code> · runtime ready: <code>{String(diagnostics.runtimeReady)}</code>
      </p>
      <p className="mt-1">
        adapter phase: <code>{diagnostics.phase}</code>
        {diagnostics.destinationId ? (
          <>
            {" "}
            · <code>{diagnostics.destinationId}</code>
          </>
        ) : null}
      </p>
      <p className="mt-1">
        placement: <code>{placement ? `${placement.worldId} / ${placement.placementRef ?? "—"}` : "—"}</code>
      </p>
      <p className="mt-1">
        active chunk: <code data-active-chunk={diagnostics.activeChunkKey ?? ""}>{diagnostics.activeChunkKey ?? "—"}</code>
      </p>
      {measures.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-neutral-300">performance ({measures.length})</summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {measures.slice(-12).map((m, i) => (
              <li key={`${m.name}-${i}`}>
                <code>{m.name}</code> {m.durationMs} ms
                {Object.keys(m.detail).length > 0 ? <span className="text-neutral-500"> {JSON.stringify(m.detail)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
