import { VirtualJoystick, type VirtualJoystickGeometry } from "@oncyberio/engine/input";

/**
 * Framework-free logic behind the on-screen touch controls (post-M0 input hardening).
 *
 * The React components only translate DOM pointer events and render; who owns a control and what
 * it outputs is decided here, so it can be tested in node without a DOM.
 */

/** A client-space rectangle, as `Element.getBoundingClientRect()` returns it. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Stick geometry for the rendered element: full deflection is where the thumb touches the rim. */
export function joystickGeometry(rect: ClientRect, thumbSize: number): VirtualJoystickGeometry {
  return {
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    radius: rect.width / 2 - thumbSize / 2,
  };
}

export interface JoystickSinks {
  /** Movement vector for the engine (`+y` = forward). */
  publish(x: number, y: number): void;
  /** Thumb offset as a fraction of the radius, screen space (`+y` = down). */
  showThumb(x: number, y: number): void;
}

/**
 * The movement stick surface. Ownership, deadzone, response curve and cardinal assist are the
 * engine's `VirtualJoystick`; this class only forwards its accepted results to the sinks. Every
 * method returns whether the event was accepted — a refused event has changed nothing, so the
 * caller must not capture or otherwise act on that pointer.
 */
export class JoystickSurface {
  private readonly _stick: VirtualJoystick;

  constructor(
    private readonly _sinks: JoystickSinks,
    stick: VirtualJoystick = new VirtualJoystick(),
  ) {
    this._stick = stick;
  }

  /** The pointer holding the stick, or `null`. */
  get ownerId(): number | null {
    return this._stick.pointerId;
  }

  down(pointerId: number, clientX: number, clientY: number, geometry: VirtualJoystickGeometry): boolean {
    if (!this._stick.press(pointerId, clientX, clientY, geometry)) return false;
    this._emit();
    return true;
  }

  move(pointerId: number, clientX: number, clientY: number, geometry: VirtualJoystickGeometry): boolean {
    if (!this._stick.move(pointerId, clientX, clientY, geometry)) return false;
    this._emit();
    return true;
  }

  up(pointerId: number): boolean {
    if (!this._stick.release(pointerId)) return false;
    this._emit();
    return true;
  }

  cancel(pointerId: number): boolean {
    if (!this._stick.cancel(pointerId)) return false;
    this._emit();
    return true;
  }

  /** Drop any owner and publish neutral (unmount). */
  dispose(): void {
    this._stick.reset();
    this._emit();
  }

  private _emit(): void {
    const vector = this._stick.vector;
    const thumb = this._stick.thumb;
    this._sinks.publish(vector.x, vector.y);
    this._sinks.showThumb(thumb.x, thumb.y);
  }
}

/**
 * First-pointer ownership for a hold button (the jump button): the first pointer to press holds it
 * until that same pointer lifts or is cancelled; nobody else can press it again or release it.
 */
export class PointerOwner {
  private _ownerId: number | null = null;

  get ownerId(): number | null {
    return this._ownerId;
  }

  /** `true` if `pointerId` now holds the control (a fresh claim, not a repeat). */
  claim(pointerId: number): boolean {
    if (this._ownerId !== null) return false;
    this._ownerId = pointerId;
    return true;
  }

  /** `true` if `pointerId` was the holder and has now let go. */
  release(pointerId: number): boolean {
    if (this._ownerId !== pointerId) return false;
    this._ownerId = null;
    return true;
  }

  reset(): void {
    this._ownerId = null;
  }
}
