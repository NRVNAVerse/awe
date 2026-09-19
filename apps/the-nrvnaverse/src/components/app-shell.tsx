"use client";

import { useEffect } from "react";
import { useStore } from "@/hooks/use-store";
import { APP_IDENTITY } from "@/lib/app-identity";
import { appStore, bootApp } from "@/lib/app-store";
import { DestinationView } from "@/components/destination-view";
import { DirectoryNav } from "@/components/directory-nav";
import { Notices } from "@/components/notices";
import { SpatialPanel } from "@/components/spatial-panel";

/**
 * Prototype shell: deliberately plain. It proves identity, data loading, deep-link resolution,
 * state boundaries and the spatial adapter seam — not visual design (M0).
 */
export function AppShell() {
  const state = useStore(appStore);

  useEffect(() => {
    void bootApp();
  }, []);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1 border-b border-neutral-800 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">{APP_IDENTITY.name}</h1>
        <p className="text-sm text-neutral-400">{APP_IDENTITY.milestone}</p>
        <p className="text-xs text-neutral-500">
          phase: <code>{state.phase}</code>
        </p>
      </header>

      <Notices notices={state.notices} />

      {state.phase === "boot" && <p className="text-neutral-400">Loading destination data…</p>}

      {state.phase === "resolvingDestination" && <p className="text-neutral-400">Resolving destination…</p>}

      {state.phase === "error" && (
        <section className="rounded border border-red-800 bg-red-950/40 p-4">
          <h2 className="font-semibold text-red-300">Could not start {APP_IDENTITY.name}</h2>
          <p className="mt-1 text-sm text-red-200">{state.message}</p>
          <a className="mt-3 inline-block text-sm underline" href={APP_IDENTITY.webRoot}>
            Return to {APP_IDENTITY.ecosystem} web
          </a>
        </section>
      )}

      {state.phase === "ready" && (
        <>
          <DestinationView destination={state.current} entry={state.entry} index={state.loaded.index} />
          <SpatialPanel destinationId={state.current.id} />
          <DirectoryNav index={state.loaded.index} currentId={state.current.id} />
        </>
      )}
    </div>
  );
}
