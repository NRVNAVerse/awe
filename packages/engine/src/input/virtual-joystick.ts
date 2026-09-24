/**
 * Pointer-owning virtual joystick.
 *
 * An on-screen joystick is a second input surface living *beside* the render
 * canvas, and the two must stay independent: the contact steering the camera
 * must never take the stick over, and the contact holding the stick must never
 * perturb the camera. Getting that right is entirely about pointer identity,
 * which is why it lives here as a framework-free controller rather than inside
 * one app's UI component.
 *
 * The rule this class enforces: **the first pointer to press wins, and it owns
 * the stick until it is released or cancelled.** Every other pointer is
 * refused outright — not queued, not swapped in. A finger that grazes the
 * stick on its way to a camera swipe therefore does nothing at all.
 *
 * Geometry (where the stick is, how big it is) is supplied by the caller, so
 * nothing here knows about any particular layout or screen region.
 *
 * @module virtual-joystick
 */

export interface Vector2Like {
  x: number;
  y: number;
}

/** Where the stick is on screen right now, in client pixels. */
export interface VirtualJoystickGeometry {
  centerX: number;
  centerY: number;
  /** Distance from the centre that counts as full deflection. */
  radius: number;
}

export interface VirtualJoystickOptions {
  /** Fraction of the radius that reads as neutral. Default `0.26`. */
  deadzone?: number;
  /** Curve applied past the deadzone; > 1 favours fine control. Default `1.75`. */
  responseExponent?: number;
  /**
   * How square-on a push must be to snap to a pure axis, as the ratio of the
   * minor component to the major one. Default `0.35`; `0` disables the assist.
   */
  cardinalAssistRatio?: number;
  /** Deflection below which the assist is not applied at all. Default `0.3`. */
  cardinalAssistMin?: number;
}

const DEFAULTS: Required<VirtualJoystickOptions> = {
  deadzone: 0.26,
  responseExponent: 1.75,
  cardinalAssistRatio: 0.35,
  cardinalAssistMin: 0.3,
};

const ZERO: Vector2Like = { x: 0, y: 0 };

/**
 * Snap a near-cardinal push onto its dominant axis, so "forward" on a thumb
 * stick is actually forward. Magnitude is preserved.
 */
function applyCardinalAssist(
  x: number,
  y: number,
  ratio: number,
  min: number,
): Vector2Like {
  if (ratio <= 0) return { x, y };

  const magnitude = Math.hypot(x, y);
  if (magnitude < min) return { x, y };

  const absX = Math.abs(x);
  const absY = Math.abs(y);

  if (absX > absY && absY <= absX * ratio) {
    return { x: Math.sign(x) * magnitude, y: 0 };
  }
  if (absY > absX && absX <= absY * ratio) {
    return { x: 0, y: Math.sign(y) * magnitude };
  }
  return { x, y };
}

export class VirtualJoystick {
  private readonly _options: Required<VirtualJoystickOptions>;

  private _pointerId: number | null = null;
  private _geometry: VirtualJoystickGeometry | null = null;
  private _vector: Vector2Like = ZERO;
  private _thumb: Vector2Like = ZERO;

  constructor(options: VirtualJoystickOptions = {}) {
    this._options = { ...DEFAULTS, ...options };
  }

  /** The pointer that owns the stick, or `null` when it is free. */
  get pointerId(): number | null {
    return this._pointerId;
  }

  /** Whether a pointer is currently holding the stick. */
  get isHeld(): boolean {
    return this._pointerId !== null;
  }

  /**
   * The analog movement vector, in the engine's convention: `+y` is forward
   * (away from the player), which is the *opposite* of screen `y`.
   */
  get vector(): Vector2Like {
    return this._vector;
  }

  /**
   * Where to draw the thumb, as a fraction of the radius in **screen** space
   * (`+y` is down). Raw deflection — the response curve is for the output
   * vector, not for what the finger appears to be doing.
   */
  get thumb(): Vector2Like {
    return this._thumb;
  }

  /** Update the stick's position/size, e.g. after a resize. */
  setGeometry(geometry: VirtualJoystickGeometry): void {
    this._geometry = geometry;
  }

  /**
   * Claim the stick for `pointerId`.
   *
   * @returns `true` if this pointer now owns the stick. A press from any other
   * pointer while one is already held is refused and changes nothing.
   */
  press(
    pointerId: number,
    clientX: number,
    clientY: number,
    geometry?: VirtualJoystickGeometry,
  ): boolean {
    if (this._pointerId !== null && this._pointerId !== pointerId) {
      return false;
    }
    if (geometry) this._geometry = geometry;
    this._pointerId = pointerId;
    this._apply(clientX, clientY);
    return true;
  }

  /**
   * Drag the owning pointer.
   *
   * @returns `true` if the move was applied. Moves from a pointer that does
   * not own the stick are ignored — including a camera finger whose implicit
   * touch capture keeps routing its moves at the stick's element.
   */
  move(
    pointerId: number,
    clientX: number,
    clientY: number,
    geometry?: VirtualJoystickGeometry,
  ): boolean {
    if (this._pointerId !== pointerId) return false;
    if (geometry) this._geometry = geometry;
    this._apply(clientX, clientY);
    return true;
  }

  /**
   * Release the stick. A release from a non-owning pointer is ignored, so a
   * stray finger lifting off cannot stop the player walking.
   *
   * @returns `true` if the stick was actually released.
   */
  release(pointerId: number): boolean {
    if (this._pointerId !== pointerId) return false;
    this.reset();
    return true;
  }

  /** As {@link release}; cancellation and release mean the same thing here. */
  cancel(pointerId: number): boolean {
    return this.release(pointerId);
  }

  /** Drop ownership and centre the stick, whoever was holding it. */
  reset(): void {
    this._pointerId = null;
    this._vector = ZERO;
    this._thumb = ZERO;
  }

  private _apply(clientX: number, clientY: number): void {
    const geometry = this._geometry;
    if (!geometry || geometry.radius <= 0) {
      this._vector = ZERO;
      this._thumb = ZERO;
      return;
    }

    const { deadzone, responseExponent, cardinalAssistRatio, cardinalAssistMin } =
      this._options;

    const dx = clientX - geometry.centerX;
    const dy = clientY - geometry.centerY;
    const distance = Math.hypot(dx, dy);
    const deflection = Math.min(distance / geometry.radius, 1);
    if (deflection <= deadzone) {
      // Short-circuit rather than multiplying by zero: the direction of a
      // neutral stick is still signed, and `-0` leaks out of the arithmetic.
      this._vector = ZERO;
      this._thumb = ZERO;
      return;
    }

    const past = (deflection - deadzone) / (1 - deadzone);
    const curved = past ** responseExponent;
    const shown = deflection;
    const dirX = distance > 0 ? dx / distance : 0;
    const dirY = distance > 0 ? dy / distance : 0;

    this._thumb = applyCardinalAssist(
      dirX * shown,
      dirY * shown,
      cardinalAssistRatio,
      cardinalAssistMin,
    );
    this._vector = applyCardinalAssist(
      dirX * curved,
      -dirY * curved,
      cardinalAssistRatio,
      cardinalAssistMin,
    );
  }
}
