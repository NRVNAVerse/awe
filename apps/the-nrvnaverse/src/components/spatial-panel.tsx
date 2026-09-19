"use client";

import { useEffect, useState } from "react";
import type { PlacementResult } from "@nrvnaverse/manifest";
import { PlannedSpatialAdapter } from "@/lib/spatial/planned-spatial-adapter";

/** The spatial adapter is the only object allowed to know where a destination physically is. */
const spatialAdapter = new PlannedSpatialAdapter();

export function SpatialPanel({ destinationId }: { destinationId: string }) {
  const [placement, setPlacement] = useState<PlacementResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlacement(null);
    void spatialAdapter.resolvePlacement(destinationId).then((result) => {
      if (!cancelled) setPlacement(result);
    });
    return () => {
      cancelled = true;
    };
  }, [destinationId]);

  return (
    <section className="rounded border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
      <h3 className="font-semibold text-neutral-300">Spatial travel</h3>
      <p className="mt-1">
        adapter: <code>{spatialAdapter.name}</code> · canTravel: <code>{String(spatialAdapter.canTravel)}</code>
      </p>
      <p className="mt-1">
        placement: <code>{placement ? placement.status : "…"}</code>
        {placement && "reason" in placement ? ` — ${placement.reason}` : null}
      </p>
    </section>
  );
}
