"use client";

import type { DestinationIndex } from "@nrvnaverse/manifest";
import { useStore } from "@/hooks/use-store";
import { dismissWebContext, webContextPath, webContextStore } from "@/lib/web/web-context-store";
import { currentThresholds } from "@/lib/app-store";

/**
 * WEB↔SPATIAL web window (M1 experience campaign, D-020): while the visitor stands in a threshold,
 * the canonical web context of the threshold's destination is shown in a same-origin frame
 * (`/web-context/<id>`, derived from the manifests). The frame is application-owned: it never
 * embeds the public website (its frame policy is not ours to rely on) and never duplicates it —
 * the canonical link inside opens www.nrvnaverse.com in a new tab, so the world stays exactly
 * where the visitor is (explicit return context: nothing to return to, they never left).
 * Dismissing keeps the window closed until the visitor leaves and re-enters the threshold.
 */
export function WebWindow({ index }: { index: DestinationIndex }) {
  const state = useStore(webContextStore);
  if (!state.destinationId) return null;
  const destination = index.byId.get(state.destinationId);
  if (!destination) return null;
  const district = destination.primaryDistrictId ? index.byId.get(destination.primaryDistrictId) : null;
  const onDismiss = () => dismissWebContext(currentThresholds()?.current?.componentId ?? null);

  return (
    <aside
      className="pointer-events-auto fixed bottom-0 left-0 z-30 flex w-full max-w-md flex-col overflow-hidden rounded-tr-lg border border-amber-300/30 bg-neutral-950/95 shadow-2xl backdrop-blur sm:bottom-4 sm:left-4 sm:rounded-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)" }}
      data-web-window={destination.id}
      data-web-window-source={state.source ?? ""}
      aria-label={`Web context: ${destination.name}`}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200/70">
            on the web · {destination.kind}
            {district && district.id !== destination.id ? ` · ${district.name}` : ""}
          </p>
          <h2 className="truncate text-base font-semibold text-neutral-100">{destination.name}</h2>
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 touch-manipulation hover:text-white" data-web-window-dismiss>
          close
        </button>
      </header>
      <iframe
        title={`${destination.name} — web context`}
        src={webContextPath(destination.id)}
        className="h-56 w-full border-0 bg-neutral-950"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="same-origin"
        data-web-window-frame
      />
      <footer className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-2 text-xs text-neutral-400">
        <span>Step out of the threshold to close.</span>
        <a className="underline hover:text-white" href={destination.webUrl} target="_blank" rel="noopener noreferrer" data-web-window-canonical>
          Open on nrvnaverse.com ↗
        </a>
      </footer>
    </aside>
  );
}
