"use client";

import { useEffect, useState } from "react";

/**
 * Explicit developer / diagnostics gate for the visitor shell (first-live launch shell).
 *
 * Visitors see a product; engineers keep every diagnostic. Diagnostics (phase readouts, the
 * milestone label, adapter / chunk / portal / performance panel, raw error text, manifest ids) are
 * shown when:
 * - the build is not a production build (`next dev`), or
 * - the visitor opted in with `?debug=1` — remembered in `localStorage` so it survives travel
 *   (travel rewrites the URL) — and `?debug=0` turns it off again.
 *
 * Nothing sensitive is behind this gate (no secret exists in the client); it only hides engineering
 * presentation. Machine-readable hooks for the browser probes (`data-app-phase`, `data-*`) are always
 * present and never depend on it.
 */
export const DEBUG_STORAGE_KEY = "nrvnaverse:debug";

export interface DebugInputs {
  nodeEnv: string | undefined;
  /** `window.location.search` */
  search: string;
  /** The stored flag, or null. */
  stored: string | null;
}

/** Pure decision + what to persist (`"1"` store, `null` clear, `undefined` leave as is). */
export function resolveDebugMode({ nodeEnv, search, stored }: DebugInputs): { enabled: boolean; persist: "1" | null | undefined } {
  const param = new URLSearchParams(search).get("debug");
  if (param === "1") return { enabled: true, persist: "1" };
  if (param === "0") return { enabled: nodeEnv !== "production", persist: null };
  if (stored === "1") return { enabled: true, persist: undefined };
  return { enabled: nodeEnv !== "production", persist: undefined };
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: "1" | null) {
  try {
    if (value === null) window.localStorage.removeItem(DEBUG_STORAGE_KEY);
    else window.localStorage.setItem(DEBUG_STORAGE_KEY, value);
  } catch {
    // storage blocked (private mode, previews): the flag simply does not persist
  }
}

/** Resolved once on mount (the shell is client-only). */
export function useDebugMode(): boolean {
  const [enabled, setEnabled] = useState(() => process.env.NODE_ENV !== "production");
  useEffect(() => {
    const decision = resolveDebugMode({ nodeEnv: process.env.NODE_ENV, search: window.location.search, stored: readStored() });
    if (decision.persist !== undefined) writeStored(decision.persist);
    setEnabled(decision.enabled);
  }, []);
  return enabled;
}
