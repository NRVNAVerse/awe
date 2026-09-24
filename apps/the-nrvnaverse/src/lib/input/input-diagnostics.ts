import { sharedControlState } from "@oncyberio/engine/input";

/**
 * Read-only touch-input snapshot for browser regression checks (post-M0 input hardening).
 *
 * The production bundle hides the app's dev handles, but a CDP regression (`pnpm browser:touch`)
 * has to see whether the canvas still thinks a finger is down after it lifted. This exposes plain
 * values copied from the shared control state the gameplay inputs read — never the live objects,
 * and nothing that can write input. The engine itself already exposes `$space` / `$cam` the same way.
 */
export interface TouchInputSnapshot {
  /** Contacts the canvas capture is tracking (not the document-wide touch list). */
  touchCount: number;
  isTouching: boolean;
  /** Canvas contact that owns camera look, or `null`. */
  lookTouchId: number | null;
  /** Latest movement vector the on-screen joystick published. */
  joystick: { x: number; y: number };
  /** Whether the on-screen jump button currently holds the `jump` custom button. */
  jumpHeld: boolean;
}

export function touchInputSnapshot(): TouchInputSnapshot {
  const touch = sharedControlState.touch;
  return {
    touchCount: touch.touchCount,
    isTouching: touch.isTouching,
    lookTouchId: touch.lookTouchId,
    joystick: { x: touch.joystickX, y: touch.joystickY },
    jumpHeld: sharedControlState.custom.isButtonDown("jump"),
  };
}

/** Install `window.__nrvnaverseInput` once (browser only). */
export function installInputDiagnostics(): void {
  if (typeof window === "undefined") return;
  const target = window as typeof window & { __nrvnaverseInput?: { touch: () => TouchInputSnapshot } };
  target.__nrvnaverseInput ??= Object.freeze({ touch: touchInputSnapshot });
}
