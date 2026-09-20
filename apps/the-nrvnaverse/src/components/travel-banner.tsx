"use client";

import type { AppState } from "@/lib/app-state";
import { dismissOutcome } from "@/lib/app-store";

/** Transient travel outcome: traveling, arrived, or gate required. Nothing here knows a coordinate. */
export function TravelBanner({ state }: { state: AppState }) {
  if (state.phase === "traveling") {
    return (
      <div role="status" className="rounded border border-sky-800 bg-sky-950/70 px-3 py-2 text-sm text-sky-100" data-phase="traveling">
        Traveling to <strong>{state.target.name}</strong>…
      </div>
    );
  }

  if (state.phase === "loadingChunk" && state.stage === "travel") {
    return (
      <div role="status" className="rounded border border-sky-800 bg-sky-950/70 px-3 py-2 text-sm text-sky-100" data-phase="loadingChunk">
        Loading <strong>{state.target.name}</strong>… <span className="text-sky-300/70">(you stay at {state.current.name} until it is ready)</span>
      </div>
    );
  }

  if (state.phase === "arrived") {
    return (
      <div role="status" className="flex items-center gap-3 rounded border border-emerald-800 bg-emerald-950/70 px-3 py-2 text-sm text-emerald-100" data-phase="arrived">
        <span>
          Arrived at <strong>{state.current.name}</strong> <span className="text-emerald-300/70">({Math.round(state.arrival.durationMs)} ms)</span>
        </span>
        <button type="button" onClick={dismissOutcome} className="ml-auto text-xs underline">
          ok
        </button>
      </div>
    );
  }

  if (state.phase === "gateRequired") {
    const gated = state.loaded.index.byId.get(state.gate.destinationId);
    return (
      <div role="alert" className="flex flex-col gap-1 rounded border border-amber-700 bg-amber-950/70 px-3 py-2 text-sm text-amber-100" data-phase="gateRequired">
        <div className="flex items-center gap-3">
          <span>
            <strong>{gated?.name ?? state.gate.destinationId}</strong> requires a gate: <code>{state.gate.gates.join(", ")}</code>
          </span>
          <button type="button" onClick={dismissOutcome} className="ml-auto text-xs underline">
            ok
          </button>
        </div>
        <p className="text-xs text-amber-200/80">
          Spatial entry is refused at the boundary. Verification is not implemented in this build and there is no bypass. You remain at{" "}
          {state.current.name}.
        </p>
      </div>
    );
  }

  return null;
}
