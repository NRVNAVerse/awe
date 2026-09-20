import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { COARSE_POINTER_QUERY, NARROW_VIEWPORT_QUERY, detectInteractionMode, isNarrowViewport, isTouchScreen } from "../src/lib/interaction-mode";

/**
 * M0 Step 2B.4C.2 — mobile shell contract. The vitest environment is node (no DOM), so the
 * interaction-mode predicates are exercised against a minimal fake `window`/`navigator`, and the
 * shell / layout / CSS contracts that the 2B.4C.1 browser audit proved necessary are pinned by
 * source scan (the same technique the delivery suite uses). The real layout is verified in the
 * browser matrix (runtime doc §16), not here.
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (file: string) => readFileSync(join(APP_ROOT, file), "utf8");
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

type G = { window?: unknown; navigator?: unknown };
const g = globalThis as unknown as G;
const saved = { window: g.window, navigator: g.navigator };

function fakeBrowser(opts: { maxTouchPoints?: number; coarse?: boolean; ontouchstart?: boolean; narrow?: boolean }) {
  const win: Record<string, unknown> = {
    matchMedia: (query: string) => ({ matches: query === COARSE_POINTER_QUERY ? !!opts.coarse : query === NARROW_VIEWPORT_QUERY ? !!opts.narrow : false }),
  };
  if (opts.ontouchstart) win.ontouchstart = null;
  g.window = win;
  Object.defineProperty(g, "navigator", { value: { maxTouchPoints: opts.maxTouchPoints ?? 0 }, configurable: true, writable: true });
}

afterEach(() => {
  g.window = saved.window;
  Object.defineProperty(g, "navigator", { value: saved.navigator, configurable: true, writable: true });
});

describe("interaction mode — one canonical touch / narrow answer for the shell", () => {
  it("is all-false without a window (server render)", () => {
    g.window = undefined;
    expect(detectInteractionMode()).toEqual({ touch: false, narrow: false, mobile: false });
    expect(isTouchScreen()).toBe(false);
    expect(isNarrowViewport()).toBe(false);
  });

  it("keeps the starter's touch detection semantics: maxTouchPoints, coarse pointer or ontouchstart", () => {
    fakeBrowser({});
    expect(isTouchScreen()).toBe(false);
    fakeBrowser({ maxTouchPoints: 5 });
    expect(isTouchScreen()).toBe(true);
    fakeBrowser({ coarse: true });
    expect(isTouchScreen()).toBe(true);
    fakeBrowser({ ontouchstart: true });
    expect(isTouchScreen()).toBe(true);
  });

  it("narrow is the viewport class below Tailwind sm; mobile is touch OR narrow", () => {
    expect(NARROW_VIEWPORT_QUERY).toBe("(max-width: 639px)");
    fakeBrowser({ narrow: true });
    expect(detectInteractionMode()).toEqual({ touch: false, narrow: true, mobile: true });
    fakeBrowser({ maxTouchPoints: 5, narrow: false });
    expect(detectInteractionMode()).toEqual({ touch: true, narrow: false, mobile: true });
    fakeBrowser({ narrow: false });
    expect(detectInteractionMode()).toEqual({ touch: false, narrow: false, mobile: false });
  });
});

describe("mobile shell contract (source scan)", () => {
  const shell = stripComments(src("src/components/app-shell.tsx"));

  it("the directory default derives from the shared interaction mode: closed on mobile, open otherwise; the visitor's explicit choice wins", () => {
    expect(shell).toMatch(/useInteractionMode\(\)/);
    expect(shell).toMatch(/panelChoice \?\? !mode\.mobile/);
  });

  it("touch controls are not rendered while the directory is open (they cannot intercept links) and return when it closes", () => {
    expect(shell).toMatch(/settled && !panelOpen && <TouchJoystick \/>/);
    expect(shell).toMatch(/settled && !panelOpen && <JumpButton \/>/);
  });

  it("the open directory carries its own close control and the closed state a top-right, safe-area-aware opener — neither in the joystick footprint", () => {
    expect(shell).toMatch(/data-panel-toggle="close"/);
    expect(shell).toMatch(/data-panel-toggle="open"/);
    expect(shell).toMatch(/top: "calc\(0\.75rem \+ env\(safe-area-inset-top, 0px\)\)", right: "calc\(0\.75rem \+ env\(safe-area-inset-right, 0px\)\)"/);
    expect(shell).not.toMatch(/bottom-\d.*data-panel-toggle/);
  });

  it("travel / gate / notice status is mounted inside the open directory and in the overlay when closed", () => {
    expect(shell).toMatch(/data-status-layer="panel"[\s\S]*<TravelBanner state=\{state\} \/>[\s\S]*<Notices notices=\{state\.notices\} \/>/);
    expect(shell).toMatch(/\{!panelOpen && \([\s\S]*data-status-layer="overlay"[\s\S]*<TravelBanner state=\{state\} \/>/);
  });

  it("instructions are touch-aware", () => {
    expect(shell).toMatch(/mode\.touch \? TOUCH_INSTRUCTIONS : DESKTOP_INSTRUCTIONS/);
    expect(shell).toContain("WASD / arrows move");
    expect(shell).toContain("Joystick to move");
  });

  it("the aside pads its bottom with the safe-area inset so the last links stay reachable", () => {
    expect(shell).toMatch(/paddingBottom: "calc\(3rem \+ env\(safe-area-inset-bottom, 0px\)\)"/);
  });

  it("joystick and jump button use the shared mode (no duplicated detection) and safe-area offsets", () => {
    for (const file of ["src/components/touch-joystick.tsx", "src/components/jump-button.tsx"]) {
      const text = stripComments(src(file));
      expect(text, file).toMatch(/useInteractionMode\(\)\.touch/);
      expect(text, file).not.toMatch(/function isTouchScreen/);
      expect(text, file).toMatch(/env\(safe-area-inset-bottom, 0px\)/);
    }
    expect(stripComments(src("src/components/touch-joystick.tsx"))).toMatch(/sharedControlState\.touch\.setJoystick\(0, 0\)/); // cleanup on unmount kept
    expect(stripComments(src("src/components/jump-button.tsx"))).toMatch(/releaseButton\("jump"\)/);
  });

  it("the root layout exports the Next viewport with viewport-fit=cover (no hand-written meta tag)", () => {
    const layout = stripComments(src("src/app/layout.tsx"));
    expect(layout).toMatch(/export const viewport: Viewport = \{[\s\S]*viewportFit: "cover"/);
    expect(layout).not.toMatch(/<meta name="viewport"/);
  });

  it("long destination URLs wrap inside the card so the open directory never scrolls horizontally", () => {
    const view = src("src/components/destination-view.tsx");
    expect(view).toMatch(/grid-cols-\[max-content_minmax\(0,1fr\)\]/);
    expect(view.match(/<dd className="min-w-0 break-words">/g)?.length).toBe(2); // web + return URLs
    expect(src("src/components/spatial-panel.tsx")).toMatch(/className="break-all text-neutral-500"/); // diagnostics JSON wraps too
  });

  it("the canvas surface disables browser touch gestures and the viewport does not overscroll; the aside keeps its own scrolling", () => {
    const css = src("src/app/globals.css");
    expect(css).toMatch(/#canvas-container\s*\{\s*touch-action: none;\s*\}/);
    expect(css).toMatch(/html,\s*body\s*\{\s*overscroll-behavior: none;\s*\}/);
    expect(shell).toMatch(/overflow-y-auto overscroll-contain/);
  });
});
