import { Store } from "@/hooks/use-store";

/**
 * Visitor camera preferences (M3 Mission A).
 *
 * Three settings, remembered in the visitor's browser: the view (`third` — the default and the M0–M2
 * feel — or `first`), and two look-sensitivity multipliers, one for the mouse / gamepad and one for
 * touch drags. A multiplier of 1 is exactly the pre-M3 feel on every device; the camera rigs keep
 * their own calibration and only the deltas fed into them are scaled.
 *
 * The persisted shape is tiny and versioned (`{ v: 1, view, mouse, touch }`). Anything unreadable —
 * blocked storage, malformed JSON, an unknown version, an out-of-range number — falls back to the
 * defaults field by field, so a bad value can never strand a visitor in an unusable camera.
 */

export const CAMERA_STORAGE_KEY = "nrvnaverse.camera.v1";

export type CameraView = "third" | "first";

export interface CameraPreferences {
  view: CameraView;
  /** Mouse (pointer-lock) and gamepad look multiplier. */
  mouseSensitivity: number;
  /** Touch-drag look multiplier. */
  touchSensitivity: number;
}

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;
export const SENSITIVITY_STEP = 0.1;

export const DEFAULT_CAMERA_PREFERENCES: Readonly<CameraPreferences> = Object.freeze({
  view: "third",
  mouseSensitivity: 1,
  touchSensitivity: 1,
});

/** Clamp to the slider range and snap to its step (two decimals, so 0.30000000000000004 never persists). */
export function clampSensitivity(value: unknown, fallback = 1): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, n));
  return Number((Math.round(clamped / SENSITIVITY_STEP) * SENSITIVITY_STEP).toFixed(2));
}

export function isCameraView(value: unknown): value is CameraView {
  return value === "third" || value === "first";
}

/** Parse a stored value; every field falls back to its default independently. */
export function parseCameraPreferences(raw: string | null): CameraPreferences {
  if (raw === null) return { ...DEFAULT_CAMERA_PREFERENCES };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CAMERA_PREFERENCES };
  }
  if (typeof data !== "object" || data === null || (data as { v?: unknown }).v !== 1) return { ...DEFAULT_CAMERA_PREFERENCES };
  const record = data as Record<string, unknown>;
  return {
    view: isCameraView(record.view) ? record.view : DEFAULT_CAMERA_PREFERENCES.view,
    mouseSensitivity: clampSensitivity(record.mouse, DEFAULT_CAMERA_PREFERENCES.mouseSensitivity),
    touchSensitivity: clampSensitivity(record.touch, DEFAULT_CAMERA_PREFERENCES.touchSensitivity),
  };
}

export function serializeCameraPreferences(prefs: CameraPreferences): string {
  return JSON.stringify({ v: 1, view: prefs.view, mouse: prefs.mouseSensitivity, touch: prefs.touchSensitivity });
}

/** Where preferences are read from and written to (localStorage in the browser, a map in tests). */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // storage blocked (private mode, sandboxed previews)
  }
}

/**
 * The preference store: one source of truth for the settings UI, the `V` key and the runtime.
 * Starts at the defaults; `load()` reads the stored value (client only, after mount). Every setter
 * persists; a write that fails (quota, blocked storage) still changes the live session.
 */
export class CameraPreferenceStore extends Store<CameraPreferences> {
  constructor(private readonly storage: () => PreferenceStorage | null = browserStorage) {
    super({ ...DEFAULT_CAMERA_PREFERENCES });
  }

  private loaded = false;

  /** Read the stored preferences once (idempotent). */
  load(): CameraPreferences {
    if (this.loaded) return this.state;
    this.loaded = true;
    let raw: string | null = null;
    try {
      raw = this.storage()?.getItem(CAMERA_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    const next = parseCameraPreferences(raw);
    if (!samePreferences(next, this.state)) this.update(next);
    return this.state;
  }

  setView(view: CameraView): void {
    if (!isCameraView(view) || view === this.state.view) return;
    this.commit({ ...this.state, view });
  }

  toggleView(): CameraView {
    this.setView(this.state.view === "third" ? "first" : "third");
    return this.state.view;
  }

  setMouseSensitivity(value: number): void {
    const next = clampSensitivity(value, this.state.mouseSensitivity);
    if (next !== this.state.mouseSensitivity) this.commit({ ...this.state, mouseSensitivity: next });
  }

  setTouchSensitivity(value: number): void {
    const next = clampSensitivity(value, this.state.touchSensitivity);
    if (next !== this.state.touchSensitivity) this.commit({ ...this.state, touchSensitivity: next });
  }

  /** Back to the defaults (third person, both multipliers 1). */
  reset(): void {
    if (!samePreferences(this.state, DEFAULT_CAMERA_PREFERENCES)) this.commit({ ...DEFAULT_CAMERA_PREFERENCES });
  }

  private commit(next: CameraPreferences): void {
    this.loaded = true; // an explicit choice wins over a later load()
    this.update(next);
    try {
      this.storage()?.setItem(CAMERA_STORAGE_KEY, serializeCameraPreferences(next));
    } catch {
      // storage full or blocked: the choice lasts for this session only
    }
  }
}

function samePreferences(a: CameraPreferences, b: CameraPreferences): boolean {
  return a.view === b.view && a.mouseSensitivity === b.mouseSensitivity && a.touchSensitivity === b.touchSensitivity;
}

/** The app-wide preference store. */
export const cameraPreferences = new CameraPreferenceStore();
