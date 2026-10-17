import type { CameraPreferences, CameraView } from "@/lib/camera/camera-preferences";

/**
 * First- / third-person view switching (M3 Mission A), framework-free so it runs under node tests.
 *
 * The runtime owns two official engine rigs — `ThirdPersonCameraRig` (orbit, collision, zoom) and
 * `FirstPersonCameraRig` (eye level, no smoothing) — and exactly one of them is active at a time. This
 * controller decides which, keeps the view continuous across a switch and hides the avatar in first
 * person. It never touches movement: the Mover steers relative to `Camera.current` in both views.
 *
 * Switches:
 * - third → first: the eye rig starts from the camera's current yaw and pitch (you keep looking at
 *   what you were looking at), the avatar is hidden, the orbit distance is remembered;
 * - first → third: the avatar is shown first, the camera is put a short distance behind the eye along
 *   the view direction, the orbit rig re-syncs from that position when it activates (its own
 *   behaviour) and is then asked for the remembered distance — so it dollies out smoothly instead of
 *   cutting, and its collision test applies during the dolly.
 */

/** The parts of `ThirdPersonCameraRig` the controller uses. */
export interface OrbitRigPort {
  active: boolean;
  rotate(deltaX: number, deltaY: number): void;
  zoom(delta: number): void;
  setZoom(distance: number): void;
  readonly currentZoom: number;
  reset(): void;
}

/** The parts of `FirstPersonCameraRig` the controller uses. */
export interface EyeRigPort {
  active: boolean;
  rotate(deltaX: number, deltaY: number): void;
  setRotation(yaw: number, pitch: number): void;
  reset(): void;
}

/** Scene access the controller needs (the runtime implements it over three.js and the avatar). */
export interface ViewHost {
  /** The camera's view direction as YXZ yaw / pitch, radians (pitch > 0 looks up). */
  readCameraAngles(): { yaw: number; pitch: number };
  /**
   * First → third re-entry: move the camera `distance` metres backwards along its view direction and
   * up from the eye to the orbit's pivot height, so the orbit re-syncs with the same view direction.
   */
  moveCameraBack(distance: number): void;
  /**
   * The yaw the orbit rig frames the avatar with after a reset (camera behind the avatar). The engine
   * eye rig's own reset faces the opposite way (it reads the avatar's +Z as "forward", the orbit puts
   * the camera on that side), so the controller re-aims the eye with this after every reset.
   */
  readFramingYaw(): number;
  /** Show or hide the visitor's avatar (the engine's `AvatarComponent.visible`). */
  setAvatarVisible(visible: boolean): void;
}

export interface CameraViewOptions {
  /** How far behind the eye the orbit starts when returning to third person (metres). */
  reentryDistance?: number;
  /** First-person pitch limit (radians) applied when entering from a steep orbit angle. */
  maxEntryPitch?: number;
}

const DEFAULT_REENTRY_DISTANCE = 0.6;
const DEFAULT_MAX_ENTRY_PITCH = 1.2;

export class CameraViewController {
  private _view: CameraView = "third";
  private _active = false;
  private _savedZoom: number;
  /** The camera sits at the eye (last view was first person): re-enter the orbit from behind it. */
  private _reenterFromEye = false;
  private readonly _reentryDistance: number;
  private readonly _maxEntryPitch: number;

  constructor(
    private readonly orbit: OrbitRigPort,
    private readonly eye: EyeRigPort,
    private readonly host: ViewHost,
    options: CameraViewOptions = {},
  ) {
    this._savedZoom = orbit.currentZoom;
    this._reentryDistance = options.reentryDistance ?? DEFAULT_REENTRY_DISTANCE;
    this._maxEntryPitch = options.maxEntryPitch ?? DEFAULT_MAX_ENTRY_PITCH;
    orbit.active = false;
    eye.active = false;
  }

  get view(): CameraView {
    return this._view;
  }

  /** Whether the camera follows input (controls on). */
  get active(): boolean {
    return this._active;
  }

  /**
   * Controls on / off (reveal, travel, dispose). Off deactivates both rigs; on activates the rig of
   * the current view. The avatar's visibility always follows the view.
   */
  setActive(active: boolean): void {
    if (active === this._active) return;
    this._active = active;
    this.host.setAvatarVisible(this._view === "third");
    if (!active) {
      if (this.orbit.active) this._savedZoom = this.orbit.currentZoom;
      this.orbit.active = false;
      this.eye.active = false;
    } else if (this._view === "third") {
      this.activateOrbit();
    } else {
      this.eye.active = true;
    }
  }

  /** Switch view. A no-op for the current view. Works while inactive too (it is then applied on activation). */
  setView(view: CameraView): void {
    if (view === this._view) return;
    if (view === "first") this.enterFirst();
    else this.enterThird();
  }

  /** Look input, already scaled by the visitor's sensitivity (see `scaledLook`). */
  rotate(deltaX: number, deltaY: number): void {
    if (!this._active || (deltaX === 0 && deltaY === 0)) return;
    if (this._view === "third") this.orbit.rotate(deltaX, deltaY);
    else this.eye.rotate(deltaX, deltaY);
  }

  /** Wheel zoom: third person only (first person has no distance). */
  zoom(delta: number): void {
    if (!this._active || this._view !== "third" || delta === 0) return;
    this.orbit.zoom(delta);
  }

  /** After a teleport: frame the new place from the avatar's facing (both rigs' own reset). */
  reset(): void {
    if (this._view === "third") {
      // The orbit reset places the camera at the requested distance: no eye re-entry needed after it.
      if (this.orbit.active) this._savedZoom = this.orbit.currentZoom;
      else this.orbit.setZoom(this._savedZoom);
      this.orbit.reset();
      this._reenterFromEye = false;
    } else {
      this.eye.reset();
      this.eye.setRotation(this.host.readFramingYaw(), 0);
    }
  }

  private enterFirst(): void {
    if (this.orbit.active) this._savedZoom = this.orbit.currentZoom;
    const { yaw, pitch } = this.host.readCameraAngles();
    this.orbit.active = false;
    this._view = "first";
    this.eye.setRotation(yaw, Math.max(-this._maxEntryPitch, Math.min(this._maxEntryPitch, pitch)));
    this.eye.active = this._active;
    this.host.setAvatarVisible(false);
  }

  private enterThird(): void {
    // Avatar first: the orbit rig frames a visible target.
    this.host.setAvatarVisible(true);
    this.eye.active = false;
    this._view = "third";
    this._reenterFromEye = true;
    if (this._active) this.activateOrbit();
  }

  /**
   * The orbit rig re-syncs its orbit from wherever the camera is when it activates (its own
   * behaviour). Coming from the eye, the camera is first moved back along the view so the orbit
   * keeps the view direction; then the remembered distance is requested and the rig eases out to it.
   */
  private activateOrbit(): void {
    if (this._reenterFromEye) this.host.moveCameraBack(this._reentryDistance);
    this._reenterFromEye = false;
    this.orbit.active = true;
    this.orbit.setZoom(this._savedZoom);
  }
}

/** Raw look deltas per source, as the input map reads them this step. */
export interface LookSample {
  /** Mouse (pointer lock) and gamepad right stick. */
  pointer: { x: number; y: number };
  /** Canvas touch drag. */
  touch: { x: number; y: number };
}

/** Apply the visitor's per-source multipliers and sum (the rigs take one delta). */
export function scaledLook(sample: LookSample, prefs: Pick<CameraPreferences, "mouseSensitivity" | "touchSensitivity">): { x: number; y: number } {
  return {
    x: sample.pointer.x * prefs.mouseSensitivity + sample.touch.x * prefs.touchSensitivity,
    y: sample.pointer.y * prefs.mouseSensitivity + sample.touch.y * prefs.touchSensitivity,
  };
}
