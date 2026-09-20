"use client";

import { useEffect, useState } from "react";

/**
 * One canonical answer for "is the shell in touch / mobile interaction mode?" (M0 Step 2B.4C.2).
 *
 * `touch` keeps the exact detection the official starter joystick / jump button used
 * (`navigator.maxTouchPoints`, `(pointer: coarse)`, `ontouchstart`), now shared by the shell so the
 * controls, the panel default and the instruction line agree. `narrow` is the phone-width class
 * (below Tailwind's `sm` breakpoint) — a narrow desktop window gets the mobile panel default too,
 * because the directory aside is full-width there. `mobile` is the union the shell keys layout on.
 *
 * Server rendering and the first client render report `false` for everything (there is no window);
 * the real answer arrives in an effect, long before the world is placed and the HUD is shown.
 */
export interface InteractionMode {
  /** Coarse pointer / touch screen: show touch controls, touch instructions. */
  touch: boolean;
  /** Viewport narrower than Tailwind `sm` (640 px): the directory aside would cover the world. */
  narrow: boolean;
  /** `touch || narrow` — the directory starts closed, touch-aware layout applies. */
  mobile: boolean;
}

export const COARSE_POINTER_QUERY = "(pointer: coarse)";
/** Tailwind `sm` breakpoint (640 px) minus one: the aside is `w-full` below it. */
export const NARROW_VIEWPORT_QUERY = "(max-width: 639px)";

const SERVER_MODE: InteractionMode = Object.freeze({ touch: false, narrow: false, mobile: false });

export function isTouchScreen(): boolean {
  if (typeof window === "undefined") return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia(COARSE_POINTER_QUERY).matches || "ontouchstart" in window;
}

export function isNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

export function detectInteractionMode(): InteractionMode {
  const touch = isTouchScreen();
  const narrow = isNarrowViewport();
  return { touch, narrow, mobile: touch || narrow };
}

/** Live interaction mode; re-evaluated on pointer-type change, viewport-class change and resize. */
export function useInteractionMode(): InteractionMode {
  const [mode, setMode] = useState<InteractionMode>(SERVER_MODE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia(COARSE_POINTER_QUERY);
    const narrow = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const update = () => {
      const next = detectInteractionMode();
      setMode((prev) => (prev.touch === next.touch && prev.narrow === next.narrow ? prev : next));
    };
    update();
    coarse.addEventListener("change", update);
    narrow.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      coarse.removeEventListener("change", update);
      narrow.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return mode;
}
