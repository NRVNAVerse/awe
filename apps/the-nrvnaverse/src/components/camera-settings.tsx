"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useStore } from "@/hooks/use-store";
import { SENSITIVITY_MAX, SENSITIVITY_MIN, SENSITIVITY_STEP, cameraPreferences, type CameraView } from "@/lib/camera/camera-preferences";

/** `(any-pointer: fine)`: a mouse / trackpad is present (also on touch laptops and tablets with a mouse). */
export const FINE_POINTER_QUERY = "(any-pointer: fine)";

const VIEW_LABEL: Record<CameraView, string> = { third: "Third person", first: "First person" };

function hasFinePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(FINE_POINTER_QUERY).matches;
}

/**
 * Camera controls in the HUD card (M3 Mission A): a quick view toggle (the same switch as the `V`
 * key) and a "Camera" button that opens the settings — view, mouse look sensitivity (when a mouse /
 * trackpad is present) and touch look sensitivity (on touch screens). Every change persists through
 * the preference store and applies to the live camera immediately.
 *
 * Interaction rules, consistent with the directory: the panel is a plain disclosure (button with
 * `aria-expanded` / `aria-controls`), Escape or "Done" closes it and returns focus to its button,
 * and while it is open the shell hides the on-screen joystick / jump button (`onOpenChange`) so a
 * thumb on a slider can never steer the avatar. Keys pressed inside the panel stay inside it — the
 * engine listens on `window`, so without this an arrow key on a slider would also walk the avatar.
 * Opening it releases pointer lock (the cursor is needed for the sliders).
 */
export function CameraSettings({ touch, open, onOpenChange }: { touch: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const prefs = useStore(cameraPreferences);
  const panelId = useId();
  const headingId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const showMouse = !touch || hasFinePointer();

  // The stored preferences are read on the client after mount (the runtime may already have done so).
  useEffect(() => {
    cameraPreferences.load();
  }, []);

  useEffect(() => {
    if (!open) return;
    if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
    firstFieldRef.current?.focus();
  }, [open]);

  // Focus returns to the opener only for keyboard use. After a pointer click it is dropped instead:
  // a focused HUD button would also be "clicked" by the next Space (= jump) in the world.
  const close = (returnFocus: boolean) => {
    onOpenChange(false);
    if (returnFocus) openerRef.current?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation(); // never reaches the engine's window listener
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  };
  // Releases are kept from the engine too, symmetrically (a press it never saw cannot stick).
  const swallow = (event: KeyboardEvent<HTMLDivElement>) => event.stopPropagation();

  const nextView: CameraView = prefs.view === "third" ? "first" : "third";
  /** `detail` is 0 for keyboard activation, ≥ 1 for a pointer click. */
  const byPointer = (event: MouseEvent<HTMLButtonElement>) => event.detail > 0;

  return (
    <div className="mt-1 flex flex-col gap-2" data-camera-settings="">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            cameraPreferences.setView(nextView);
            if (byPointer(event)) event.currentTarget.blur();
          }}
          className="rounded border border-neutral-700 bg-neutral-900/80 px-2.5 py-1.5 text-xs text-neutral-200 touch-manipulation hover:text-white"
          aria-label={`Switch to ${VIEW_LABEL[nextView].toLowerCase()} view${touch ? "" : " (V)"}`}
          data-camera-view-toggle={prefs.view}
        >
          View: {VIEW_LABEL[prefs.view]}
        </button>
        <button
          ref={openerRef}
          type="button"
          onClick={(event) => (open ? close(!byPointer(event)) : onOpenChange(true))}
          className="rounded border border-neutral-700 bg-neutral-900/80 px-2.5 py-1.5 text-xs text-neutral-300 touch-manipulation hover:text-white"
          aria-expanded={open}
          aria-controls={panelId}
          data-camera-settings-toggle={open ? "close" : "open"}
        >
          Camera settings
        </button>
      </div>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={headingId}
          className="flex max-h-[calc(100dvh-10rem)] w-72 max-w-full flex-col gap-3 overflow-y-auto overscroll-contain rounded border border-neutral-700 bg-neutral-950/95 p-3 text-xs text-neutral-200"
          onKeyDown={onPanelKeyDown}
          onKeyUp={swallow}
          data-camera-panel=""
        >
          <h2 id={headingId} className="text-sm font-semibold text-neutral-100">
            Camera
          </h2>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-neutral-400">View</legend>
            {(["third", "first"] as const).map((view, i) => (
              <label key={view} className="flex items-center gap-2 touch-manipulation">
                <input
                  ref={i === 0 ? firstFieldRef : undefined}
                  type="radio"
                  name={`${panelId}-view`}
                  value={view}
                  checked={prefs.view === view}
                  onChange={() => cameraPreferences.setView(view)}
                  data-camera-view-option={view}
                />
                {VIEW_LABEL[view]}
                {view === "third" ? <span className="text-neutral-500">(default)</span> : null}
              </label>
            ))}
            {!touch && <p className="text-neutral-500">Press V in the world to switch.</p>}
          </fieldset>

          {showMouse && (
            <SensitivitySlider
              label="Mouse look sensitivity"
              value={prefs.mouseSensitivity}
              onChange={(v) => cameraPreferences.setMouseSensitivity(v)}
              data="mouse"
            />
          )}
          {touch && (
            <SensitivitySlider
              label="Touch look sensitivity"
              value={prefs.touchSensitivity}
              onChange={(v) => cameraPreferences.setTouchSensitivity(v)}
              data="touch"
            />
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => cameraPreferences.reset()}
              className="rounded border border-neutral-700 px-2.5 py-1.5 text-neutral-300 touch-manipulation hover:text-white"
              data-camera-reset=""
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={(event) => close(!byPointer(event))}
              className="rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-neutral-100 touch-manipulation hover:bg-neutral-700"
              data-camera-done=""
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SensitivitySlider({ label, value, onChange, data }: { label: string; value: number; onChange: (value: number) => void; data: "mouse" | "touch" }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="tabular-nums text-neutral-400" data-camera-sensitivity-value={data}>
          {value.toFixed(1)}×
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={SENSITIVITY_MIN}
        max={SENSITIVITY_MAX}
        step={SENSITIVITY_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-valuetext={`${value.toFixed(1)} times`}
        className="w-full touch-manipulation"
        style={{ touchAction: "pan-y" }}
        data-camera-sensitivity={data}
      />
    </div>
  );
}
