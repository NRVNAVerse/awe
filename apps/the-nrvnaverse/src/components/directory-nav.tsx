"use client";

import type { MouseEvent } from "react";
import { buildDeepLinkQuery, destinationsInDistrict, type Destination, type DestinationIndex } from "@nrvnaverse/manifest";
import { travelToDestination } from "@/lib/app-store";

interface DirectoryNavProps {
  index: DestinationIndex;
  currentId: string;
}

/**
 * Hub → districts → destinations navigation, built from the runtime index. Links carry stable ids
 * only. This is the travel control: a click asks the spatial adapter to travel; the adapter
 * decides whether the destination is enterable (gates) and where it physically is. Clicking while
 * a travel is in flight is allowed — the newest request wins (M0 Step 2B.2).
 */
export function DirectoryNav({ index, currentId }: DirectoryNavProps) {
  const districts = [...index.byId.values()]
    .filter((d) => d.kind === "district" && d.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <nav className="rounded border border-neutral-800 p-4" aria-label="directory">
      <h3 className="font-semibold text-neutral-300">Directory</h3>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        <li>
          <DestinationLink destination={index.hub} currentId={currentId} />
        </li>
        {districts.map((district) => (
          <li key={district.id}>
            <DestinationLink destination={district} currentId={currentId} />
            <ul className="ml-4 mt-1 flex flex-col gap-1">
              {destinationsInDistrict(index, district.id).map((d) => (
                <li key={d.id}>
                  <DestinationLink destination={d} currentId={currentId} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DestinationLink({ destination, currentId }: { destination: Destination; currentId: string }) {
  const isCurrent = destination.id === currentId;
  const gated = destination.gates.length > 0;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void travelToDestination(destination.id);
  };
  return (
    <a
      href={buildDeepLinkQuery(destination.id)}
      onClick={onClick}
      aria-current={isCurrent ? "page" : undefined}
      data-destination-id={destination.id}
      data-gated={gated || undefined}
      className={`inline-block touch-manipulation py-0.5 ${isCurrent ? "font-semibold text-white" : "text-neutral-300 underline hover:text-white"}`}
    >
      {destination.name}
      {gated && (
        <span className="ml-2 text-xs text-amber-400" title="Gate required — spatial entry refused in this build">
          {destination.gates.map((g) => g.kind).join(", ")} · gated
        </span>
      )}
    </a>
  );
}
