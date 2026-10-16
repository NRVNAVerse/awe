"use client";

import { useRef } from "react";
import { useStore } from "@/hooks/use-store";
import { skyLiftStore } from "@/lib/sky-lift";

/**
 * M2 sky-lift veil: a dusk gradient that sweeps in the travel direction while a vertical travel
 * (Hub ↔ city) is in flight. Presentational only (`pointer-events: none`, under the HUD).
 */
export function SkyLiftVeil() {
  const lift = useStore(skyLiftStore);
  const active = lift.kind === "lift";
  // Keep the last ride on screen while the veil fades out.
  const last = useRef<{ direction: "up" | "down"; to: string } | null>(null);
  if (lift.kind === "lift") last.current = { direction: lift.direction, to: lift.to };
  const shown = last.current;
  const up = shown?.direction === "up";
  return (
    <div
      aria-hidden={!active}
      data-sky-lift={lift.kind === "lift" ? lift.direction : "none"}
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-500"
      style={{
        opacity: active ? 1 : 0,
        background: up
          ? "linear-gradient(to top, rgba(29,28,44,0.97) 0%, rgba(74,56,86,0.94) 55%, rgba(255,190,120,0.88) 100%)"
          : "linear-gradient(to bottom, rgba(29,28,44,0.97) 0%, rgba(74,56,86,0.94) 55%, rgba(255,190,120,0.88) 100%)",
      }}
    >
      {shown && (
        <div className="flex flex-col items-center gap-2 text-center text-amber-100" role="status">
          <span className="text-[11px] tracking-[0.35em] text-amber-200/80">SKY LIFT</span>
          <span className="text-2xl font-semibold tracking-tight">{up ? "↑" : "↓"} {shown.to}</span>
        </div>
      )}
    </div>
  );
}
