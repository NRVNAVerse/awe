import { Store } from "@/hooks/use-store";

/**
 * Web-context state (M1 experience campaign, D-020): which destination's canonical web context the
 * spatial shell is surfacing right now, and why. Set by the threshold controller while the visitor
 * stands in a threshold sensor (`source: "threshold"`), cleared when they leave, when the chunk
 * switches, when the visitor dismisses the window (`dismissed` remembers the dismissed id so the
 * same threshold does not reopen until it is re-entered) or at teardown. Stable ids only.
 */
export interface WebContextState {
  destinationId: string | null;
  source: "threshold" | null;
  /** Threshold id the visitor dismissed while still inside it (reopens only after leaving and re-entering). */
  dismissedComponentId: string | null;
}

export const IDLE_WEB_CONTEXT: WebContextState = Object.freeze({ destinationId: null, source: null, dismissedComponentId: null });

export const webContextStore = new Store<WebContextState>({ ...IDLE_WEB_CONTEXT });

/** Threshold entered (`destinationId`) or left (`null`). */
export function setThresholdContext(destinationId: string | null, componentId: string | null): void {
  webContextStore.update((state) => {
    if (destinationId === null) return { destinationId: null, source: null, dismissedComponentId: null };
    if (state.dismissedComponentId !== null && state.dismissedComponentId === componentId) return state;
    return { destinationId, source: "threshold", dismissedComponentId: null };
  });
}

/** The visitor closed the window while still inside the threshold. */
export function dismissWebContext(componentId: string | null): void {
  webContextStore.update(() => ({ destinationId: null, source: null, dismissedComponentId: componentId }));
}

export function resetWebContext(): void {
  webContextStore.update(() => ({ ...IDLE_WEB_CONTEXT }));
}

/** Same-origin path of the web-context surface for a destination (see `src/app/web-context/[id]/page.tsx`). */
export function webContextPath(destinationId: string): string {
  return `/web-context/${encodeURIComponent(destinationId)}`;
}
