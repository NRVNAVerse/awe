/**
 * Minimal `window` for store tests under the node environment: a `location` with `search`, a
 * `history.pushState` that rewrites it, and a `popstate` listener registry with a `back()` helper.
 * Nothing else of the DOM exists — the store touches only these.
 */
export interface FakeWindow {
  location: { pathname: string; search: string };
  history: { pushState(state: unknown, title: string, url: string): void; entries: string[] };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  /** Simulate browser back/forward to a given query (fires `popstate`). */
  navigate(search: string): void;
  listenerCount(type: string): number;
}

export function installFakeWindow(search = ""): FakeWindow {
  const listeners = new Map<string, Set<() => void>>();
  const win: FakeWindow = {
    location: { pathname: "/", search },
    history: {
      entries: [search],
      pushState(_state, _title, url) {
        const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
        win.location.search = query;
        this.entries.push(query);
      },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    navigate(next) {
      win.location.search = next;
      for (const l of listeners.get("popstate") ?? []) l();
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  (globalThis as { window?: unknown }).window = win;
  return win;
}

export function uninstallFakeWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}
