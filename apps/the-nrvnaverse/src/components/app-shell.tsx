"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/hooks/use-store";
import { APP_IDENTITY } from "@/lib/app-identity";
import { appStore, bootApp, disposeApp } from "@/lib/app-store";
import { isSettled } from "@/lib/app-state";
import { DestinationView } from "@/components/destination-view";
import { DirectoryNav } from "@/components/directory-nav";
import { EngineCanvas } from "@/components/engine-canvas";
import { JumpButton } from "@/components/jump-button";
import { Notices } from "@/components/notices";
import { SpatialPanel } from "@/components/spatial-panel";
import { TouchJoystick } from "@/components/touch-joystick";
import { TravelBanner } from "@/components/travel-banner";

/**
 * Prototype shell (M0 Step 2A): the official AWE canvas fills the viewport; a deliberately plain
 * HUD sits on top. It proves engine mount, deep-link placement, stable-id travel and the gate
 * boundary — not visual design.
 */
export function AppShell() {
  const state = useStore(appStore);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    void bootApp();
    return () => {
      disposeApp();
    };
  }, []);

  const settled = isSettled(state);
  const loading = state.phase === "boot" || state.phase === "resolvingDestination" || state.phase === "loadingGlobals";

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-neutral-100">
      <EngineCanvas />

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-neutral-950">
          <h1 className="text-2xl font-bold tracking-tight">{APP_IDENTITY.name}</h1>
          <p className="text-sm text-neutral-400">
            {state.phase === "boot" && "Loading destination data…"}
            {state.phase === "resolvingDestination" && "Resolving destination…"}
            {state.phase === "loadingGlobals" && `Loading the world for ${state.requested.name}…`}
          </p>
          <p className="text-xs text-neutral-600">
            phase: <code>{state.phase}</code>
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-950 p-6">
          <section className="max-w-lg rounded border border-red-800 bg-red-950/40 p-4">
            <h2 className="font-semibold text-red-300">Could not start {APP_IDENTITY.name}</h2>
            <p className="mt-1 text-sm text-red-200">{state.message}</p>
            <Notices notices={state.notices} />
            <a className="mt-3 inline-block text-sm underline" href={APP_IDENTITY.webRoot}>
              Return to {APP_IDENTITY.ecosystem} web
            </a>
          </section>
        </div>
      )}

      {(settled || state.phase === "traveling") && (
        <>
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
            <header className="pointer-events-auto m-3 flex w-fit flex-col gap-0.5 rounded bg-neutral-950/80 px-3 py-2 backdrop-blur">
              <h1 className="text-base font-bold tracking-tight">{APP_IDENTITY.name}</h1>
              <p className="text-[11px] text-neutral-400">{APP_IDENTITY.milestone}</p>
              <p className="text-[11px] text-neutral-500">
                phase: <code>{state.phase}</code> · at: <span className="text-neutral-300">{state.current.name}</span>
              </p>
              <p className="text-[11px] text-neutral-500">WASD / arrows move · Shift sprint · Space jump · click canvas for mouse look, Esc to release</p>
            </header>

            <div className="pointer-events-auto mx-3 flex max-w-xl flex-col gap-2">
              <TravelBanner state={state} />
              <Notices notices={state.notices} />
            </div>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              className="pointer-events-auto m-3 w-fit rounded border border-neutral-700 bg-neutral-950/80 px-3 py-1 text-xs text-neutral-300 backdrop-blur hover:text-white"
              aria-expanded={panelOpen}
              aria-controls="nrvna-panel"
            >
              {panelOpen ? "Hide directory" : "Show directory"}
            </button>
          </div>

          {panelOpen && (
            <aside
              id="nrvna-panel"
              className="absolute right-0 top-0 z-20 flex h-full w-full max-w-sm flex-col gap-3 overflow-y-auto border-l border-neutral-800 bg-neutral-950/90 p-4 backdrop-blur sm:w-96"
            >
              <DestinationView destination={state.current} entry={state.entry} index={state.loaded.index} />
              <SpatialPanel state={state} />
              <DirectoryNav index={state.loaded.index} currentId={state.current.id} busy={state.phase === "traveling"} />
            </aside>
          )}

          {settled && <TouchJoystick />}
          {settled && <JumpButton />}
        </>
      )}
    </div>
  );
}
