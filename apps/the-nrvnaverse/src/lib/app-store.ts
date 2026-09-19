import { buildDeepLinkQuery } from "@nrvnaverse/manifest";
import { Store } from "@/hooks/use-store";
import { bootState, errorState, withData, withDeepLink, type AppState } from "@/lib/app-state";
import { FetchDestinationSource, type DestinationDataSource } from "@/lib/destination-source";

/** Single application store. UI subscribes through `useStore(appStore)`. */
export const appStore = new Store<AppState>(bootState());

let started = false;

/**
 * Boot sequence: load destination data, then resolve the current URL.
 * Re-resolution happens on in-app navigation and browser back/forward.
 */
export async function bootApp(source: DestinationDataSource = new FetchDestinationSource()): Promise<void> {
  if (started) return;
  started = true;

  try {
    const data = await source.load();
    appStore.update(withData(appStore.state, data));
    if (appStore.state.phase === "error") return;
    resolveCurrentUrl();
    window.addEventListener("popstate", resolveCurrentUrl);
  } catch (err) {
    appStore.update(errorState(err instanceof Error ? err.message : String(err)));
  }
}

function resolveCurrentUrl() {
  appStore.update(withDeepLink(appStore.state, window.location.search));
}

/** In-app navigation: rewrite the canonical `?destination=<id>` query and re-resolve. */
export function navigateToDestination(destinationId: string) {
  const state = appStore.state;
  if (state.phase !== "ready") return;
  const query = buildDeepLinkQuery(destinationId, { from: "spatial", ref: state.entry.ref ?? undefined });
  window.history.pushState(null, "", `${window.location.pathname}${query}`);
  resolveCurrentUrl();
}
