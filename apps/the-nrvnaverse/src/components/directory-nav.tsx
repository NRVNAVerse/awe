"use client";

import type { MouseEvent } from "react";
import { buildDeepLinkQuery, destinationsInDistrict, type Destination, type DestinationIndex } from "@nrvnaverse/manifest";
import { navigateToDestination } from "@/lib/app-store";

interface DirectoryNavProps {
  index: DestinationIndex;
  currentId: string;
}

/** Hub → districts → destinations navigation, built from the runtime index. Links carry stable ids only. */
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
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    navigateToDestination(destination.id);
  };
  return (
    <a
      href={buildDeepLinkQuery(destination.id)}
      onClick={onClick}
      aria-current={isCurrent ? "page" : undefined}
      className={isCurrent ? "font-semibold text-white" : "text-neutral-300 underline hover:text-white"}
    >
      {destination.name}
      {destination.gates.length > 0 && <span className="ml-2 text-xs text-amber-400">{destination.gates.map((g) => g.kind).join(", ")}</span>}
    </a>
  );
}
