"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/hooks/use-store";
import { APP_IDENTITY } from "@/lib/app-identity";
import { appStore, bootApp, disposeApp } from "@/lib/app-store";
import { isInitialLoading, isPlaced, isSettled } from "@/lib/app-state";
import { useInteractionMode } from "@/lib/interaction-mode";
import { DestinationView } from "@/components/destination-view";
import { DirectoryNav } from "@/components/directory-nav";
import { EngineCanvas } from "@/components/engine-canvas";
import { JumpButton } from "@/components/jump-button";
import { Notices } from "@/components/notices";
import { SpatialPanel } from "@/components/spatial-panel";
import { TouchJoystick } from "@/components/touch-joystick";
import { TravelBanner } from "@/components/travel-banner";

/** Desktop line — unchanged since Step 2A. */
export const DESKTOP_INSTRUCTIONS = "WASD / arrows move · Shift sprint · Space jump · click canvas for mouse look, Esc to release";
/** Touch line (2B.4C.2): the controls that actually exist on a coarse pointer. */
export const TOUCH_INSTRUCTIONS = "Joystick to move · drag the world to look · Jump button to jump";

/**
 * Prototype shell (M0 Step 2A/2B.2, mobile shell correction 2B.4C.2): the official AWE canvas
 * fills the viewport; a deliberately plain HUD sits on top. It proves engine mount, deep-link
 * placement, stable-id travel, selective chunk loading and the gate boundary — not visual design.
 *
 * Mobile shell rules (browser-audited in 2B.4C.1, see the runtime doc):
 * - the directory starts CLOSED in touch / narrow-viewport mode (it would cover the world and its
 *   own toggle), OPEN on desktop as before;
 * - the toggle lives at the top-right (safe-area aware), never in the joystick / jump footprint,
 *   and the open directory carries its own close control;
 * - touch controls are not rendered while the directory is open, so they can never intercept a
 *   directory link; they return when it closes (their unmount releases joystick / jump);
 * - travel / gate / notice status is mounted INSIDE the open directory (sticky at its top) and in
 *   the overlay when it is closed, so it is perceivable and dismissable in both states. State,
 *   travel and gate logic are untouched — only the mount point moves.
 */
export function AppShell() {
  const state = useStore(appStore);
  const mode = useInteractionMode();
  // `null` = no explicit choice yet → the mode default (closed on touch / narrow, open on desktop).
  const [panelChoice, setPanelChoice] = useState<boolean | null>(null);
  const panelOpen = panelChoice ?? !mode.mobile;

  // Boot on mount, tear down on unmount. Both are idempotent and coordinate with each other in
  // the store (2B.4A): Strict Mode's simulated cleanup + re-setup adopts the in-flight boot
  // instead of destroying it, a real unmount unwinds even a boot that is still in progress, and
  // a remount waits for the previous asynchronous teardown before creating a new Space.
  useEffect(() => {
    void bootApp();
    return () => {
      void disposeApp();
    };
  }, []);

  const settled = isSettled(state);
  const loading = state.phase === "boot" || state.phase === "resolvingDestination" || isInitialLoading(state);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-neutral-100">
      <EngineCanvas />

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-neutral-950 p-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{APP_IDENTITY.name}</h1>
          <p className="text-sm text-neutral-400">
            {state.phase === "boot" && "Loading destination data…"}
            {state.phase === "resolvingDestination" && "Resolving destination…"}
            {state.phase === "loadingGlobals" && `Loading the world for ${state.requested.name}…`}
            {state.phase === "loadingChunk" && state.stage === "initial" && `Loading ${state.requested.name}…`}
          </p>
          <p className="text-xs text-neutral-600">
            phase: <code>{state.phase}</code>
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-neutral-950 p-6">
          <section className="max-w-lg rounded border border-red-800 bg-red-950/40 p-4">
            <h2 className="font-semibold text-red-300">Could not start {APP_IDENTITY.name}</h2>
            <p className="mt-1 text-sm break-words text-red-200">{state.message}</p>
            <Notices notices={state.notices} />
            <a className="mt-3 inline-block text-sm underline" href={APP_IDENTITY.webRoot}>
              Return to {APP_IDENTITY.ecosystem} web
            </a>
          </section>
        </div>
      )}

      {isPlaced(state) && (
        <>
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)" }}>
            <header className="pointer-events-auto m-3 flex w-fit max-w-[calc(100%-1.5rem)] flex-col gap-0.5 rounded bg-neutral-950/80 px-3 py-2 backdrop-blur" data-interaction-mode={mode.touch ? "touch" : "pointer"}>
              <h1 className="text-base font-bold tracking-tight">{APP_IDENTITY.name}</h1>
              <p className="text-[11px] text-neutral-400">{APP_IDENTITY.milestone}</p>
              <p className="text-[11px] text-neutral-500">
                phase: <code>{state.phase}</code> · at: <span className="text-neutral-300">{state.current.name}</span>
              </p>
              <p className="text-[11px] text-neutral-500" data-instructions={mode.touch ? "touch" : "desktop"}>
                {mode.touch ? TOUCH_INSTRUCTIONS : DESKTOP_INSTRUCTIONS}
              </p>
            </header>

            {!panelOpen && (
              <div className="pointer-events-auto mx-3 flex max-w-xl flex-col gap-2" data-status-layer="overlay">
                <TravelBanner state={state} />
                <Notices notices={state.notices} />
              </div>
            )}
          </div>

          {!panelOpen && (
            <button
              type="button"
              onClick={() => setPanelChoice(true)}
              className="pointer-events-auto fixed z-40 rounded border border-neutral-700 bg-neutral-950/80 px-3 py-2 text-xs text-neutral-300 backdrop-blur touch-manipulation hover:text-white"
              style={{ top: "calc(0.75rem + env(safe-area-inset-top, 0px))", right: "calc(0.75rem + env(safe-area-inset-right, 0px))" }}
              aria-expanded={false}
              aria-controls="nrvna-panel"
              data-panel-toggle="open"
            >
              Show directory
            </button>
          )}

          {panelOpen && (
            <aside
              id="nrvna-panel"
              className="absolute right-0 top-0 z-30 flex h-full w-full max-w-sm flex-col gap-3 overflow-y-auto overscroll-contain border-l border-neutral-800 bg-neutral-950/90 px-4 backdrop-blur sm:w-96"
              style={{
                paddingTop: "env(safe-area-inset-top, 0px)",
                paddingRight: "calc(1rem + env(safe-area-inset-right, 0px))",
                // Bottom padding keeps the last directory links clear of the device safe area / browser chrome.
                paddingBottom: "calc(3rem + env(safe-area-inset-bottom, 0px))",
              }}
              data-interaction-mode={mode.mobile ? "mobile" : "desktop"}
            >
              <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-2 bg-neutral-950/95 px-4 pt-3 pb-2 backdrop-blur" data-status-layer="panel">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-neutral-300">Directory</h2>
                  <button
                    type="button"
                    onClick={() => setPanelChoice(false)}
                    className="rounded border border-neutral-700 bg-neutral-950/80 px-3 py-2 text-xs text-neutral-300 touch-manipulation hover:text-white"
                    aria-expanded={true}
                    aria-controls="nrvna-panel"
                    data-panel-toggle="close"
                  >
                    Hide directory
                  </button>
                </div>
                <TravelBanner state={state} />
                <Notices notices={state.notices} />
              </div>
              <DestinationView destination={state.current} entry={state.entry} index={state.loaded.index} />
              <SpatialPanel state={state} />
              <DirectoryNav index={state.loaded.index} currentId={state.current.id} />
            </aside>
          )}

          {settled && !panelOpen && <TouchJoystick />}
          {settled && !panelOpen && <JumpButton />}
        </>
      )}
    </div>
  );
}
