import { Camera, Object3D, Vector3 } from "three";
import emitter from "../../internal/engine-emitter";
import Mediator from "../../internal/mediator";
import {
  IS_MOBILE,
  IS_TOUCH,
  ORIENTATION,
  PORTRAIT,
  CANVAS,
} from "../../internal/constants";

// Re-export constants for use in specialized rigs
export { IS_MOBILE, IS_TOUCH, ORIENTATION, PORTRAIT };

/**
 * Minimum polar angle to prevent gimbal lock
 */
export const MIN_POLAR_ANGLE = 0.1;

/**
 * Maximum polar angle for orbit cameras
 */
export const MAX_POLAR_ANGLE = Math.PI * 0.9;

/**
 * Fixed sensitivity divisor for consistent feel (used by third-person)
 */
export const SENSITIVITY_DIVISOR = 80;

/**
 * Ratio threshold for axis dampening
 */
export const MIN_RATIO_TO_ROTATE_Y = Math.tan(Math.PI / 6);

/**
 * Base camera rig configuration shared by all camera rigs
 */
export interface BaseCameraRigConfig {
  /** The camera to control */
  camera: Camera;
  /** Look sensitivity */
  sensitivity?: { x: number; y: number };
  /** Whether to use pointer lock for mouse control (default: true) */
  usePointerLock?: boolean;
}

/**
 * Rotation conversion factors for screen-to-radians mapping
 */
export interface RotationConversion {
  dxToRad: number;
  dyToRad: number;
}

/**
 * Result from axis dampening calculation
 */
export interface AxisDampeningResult {
  dx: number;
  dy: number;
  factorX: number;
  factorY: number;
}

/**
 * Calculate rotation conversion factors based on device type.
 * Desktop: Uses screen dimensions for natural feel.
 * Touch: Uses normalized factors for iPhone 12 Pro baseline.
 */
export function calculateRotationConversion(): RotationConversion {
  if (!IS_TOUCH) {
    return {
      dxToRad: Math.PI / window.innerWidth,
      dyToRad: Math.PI / window.innerHeight,
    };
  }

  // Touch sensitivity calibrated to iPhone 12 Pro (390x844). A magnitude only:
  // this used to be negative, a second mobile-only flip that cancelled the one
  // `applyAxisDampening` applied, so the rigs built on it (first-person, fly)
  // must keep a positive factor now that the dampening flip is gone.
  const SPEED = 0.0043;
  const BASE_WIDTH = window.innerWidth / (ORIENTATION === PORTRAIT ? 390 : 844);
  const BASE_HEIGHT = window.innerHeight / (ORIENTATION === PORTRAIT ? 844 : 390);

  return {
    dxToRad: SPEED * BASE_WIDTH,
    dyToRad: (SPEED / (ORIENTATION === PORTRAIT ? 4 : 3)) * BASE_HEIGHT,
  };
}

/**
 * Apply ratio-based axis dampening for smoother diagonal movement.
 * When one axis dominates, the other is reduced to avoid jerky diagonal motion.
 */
export function applyAxisDampening(
  deltaX: number,
  deltaY: number,
  minRatio: number = MIN_RATIO_TO_ROTATE_Y
): AxisDampeningResult {
  const ratioXY = Math.abs(deltaY / (deltaX || 0.001));

  let factorX = 1;
  let factorY = 1;

  if (ratioXY < minRatio) {
    factorY = 0.5; // Reduce Y when X is dominant
  } else {
    factorX = 0.5; // Reduce X when Y is dominant
  }

  // Touch/mobile adjustments for better feel
  if (IS_TOUCH) {
    factorY *= 2;
    factorX *= 3;
  }

  // NOTE: this used to flip both axes when IS_MOBILE, which made `rotate()`
  // mean the opposite thing on phones than on desktop. Games compensated with
  // their own `scaleVector2(-1)` on the touch binding, so the two flips only
  // cancelled on devices the UA parser actually recognised as mobile — an iPad
  // reporting a desktop UA got a single flip and looked inverted on both axes.
  // The device class now scales the deltas but never changes their sign
  // (+x = look right, +y = look down); inversion belongs to the game's input
  // bindings (`Processors.invertVector2`), not to a device quirk.
  const dx = deltaX * factorX;
  const dy = deltaY * factorY;

  return { dx, dy, factorX, factorY };
}

/**
 * Base class providing common functionality for all camera rigs.
 * Handles pointer lock management, event subscriptions, and basic state.
 */
export abstract class BaseCameraRig {
  protected _camera: Camera;
  protected _active = false;
  protected _disposed = false;
  protected _sensitivity: { x: number; y: number };
  protected _usePointerLock: boolean;
  protected _pointerLockBound = false;
  protected _canvas: HTMLCanvasElement | null = null;

  constructor(config: BaseCameraRigConfig) {
    this._camera = config.camera;
    this._sensitivity = config.sensitivity ?? { x: 0.5, y: 0.5 };
    this._usePointerLock = config.usePointerLock ?? true;

    this._camera.rotation.order = "YXZ";
  }

  /** Whether the camera rig is active */
  get active(): boolean {
    return this._active;
  }

  set active(value: boolean) {
    if (this._active === value) return;
    this._active = value;

    if (value) {
      this._addEvents();
    } else {
      this._removeEvents();
    }
  }

  /** The forward direction the camera is facing */
  get forward(): Vector3 {
    const forward = new Vector3(0, 0, -1);
    forward.applyQuaternion(this._camera.quaternion);
    return forward;
  }

  /** The right direction from the camera */
  get right(): Vector3 {
    const right = new Vector3(1, 0, 0);
    right.applyQuaternion(this._camera.quaternion);
    return right;
  }

  /** Look sensitivity */
  get sensitivity(): { x: number; y: number } {
    return { ...this._sensitivity };
  }

  set sensitivity(value: { x: number; y: number }) {
    this._sensitivity = value;
  }

  /** Whether pointer lock is enabled */
  get usePointerLock(): boolean {
    return this._usePointerLock;
  }

  set usePointerLock(value: boolean) {
    this._usePointerLock = value;
    if (value) {
      this._setupPointerLock();
    } else {
      this._cleanupPointerLock();
    }
  }

  /** Whether pointer is currently locked */
  get isPointerLocked(): boolean {
    return document.pointerLockElement === this._canvas;
  }

  /** Request pointer lock */
  requestPointerLock(): void {
    if (this._usePointerLock && this._canvas) {
      this._canvas.requestPointerLock();
    }
  }

  /** Exit pointer lock */
  exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  /** Dispose the camera rig */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.active = false;
    this._cleanupPointerLock();
  }

  /** Rotate the camera - to be implemented by subclasses */
  abstract rotate(deltaX: number, deltaY: number): void;

  /** Add event listeners - to be implemented by subclasses */
  protected abstract _addEvents(): void;

  /** Remove event listeners - to be implemented by subclasses */
  protected abstract _removeEvents(): void;

  protected _setupPointerLock(): void {
    if (this._pointerLockBound || !this._usePointerLock) return;

    this._canvas = CANVAS;
    if (!this._canvas) return;

    this._canvas.addEventListener("click", this._onCanvasClick);
    Mediator.requestPointerLockOnClick = true;
    this._pointerLockBound = true;
  }

  protected _cleanupPointerLock(): void {
    if (!this._pointerLockBound) return;

    if (this._canvas) {
      this._canvas.removeEventListener("click", this._onCanvasClick);
    }
    Mediator.requestPointerLockOnClick = false;
    this._pointerLockBound = false;

    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  protected _onCanvasClick = (): void => {
    if (this._active && this._usePointerLock && this._canvas) {
      this._canvas.requestPointerLock();
    }
  };
}
