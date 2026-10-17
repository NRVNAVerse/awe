import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMERA_STORAGE_KEY,
  CameraPreferenceStore,
  DEFAULT_CAMERA_PREFERENCES,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  clampSensitivity,
  parseCameraPreferences,
  serializeCameraPreferences,
  type PreferenceStorage,
} from "@/lib/camera/camera-preferences";
import { CameraViewController, scaledLook, type EyeRigPort, type OrbitRigPort, type ViewHost } from "@/lib/camera/camera-view";

/**
 * M3 Mission A: first- / third-person camera, per-source look sensitivity, local persistence.
 * Everything here runs without a DOM or the engine: the controller drives fakes of the two official
 * rigs, and the preference store writes to an in-memory storage.
 */

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (path: string) => readFileSync(join(APP_ROOT, path), "utf8");

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: PreferenceStorage & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      this.writes++;
      data.set(key, value);
    },
  };
  return storage;
}

describe("camera preferences — parsing and clamping", () => {
  it("defaults to third person with both multipliers at 1 (the pre-M3 feel)", () => {
    expect(DEFAULT_CAMERA_PREFERENCES).toEqual({ view: "third", mouseSensitivity: 1, touchSensitivity: 1 });
    expect(parseCameraPreferences(null)).toEqual(DEFAULT_CAMERA_PREFERENCES);
  });

  it("round-trips the versioned shape", () => {
    const prefs = { view: "first" as const, mouseSensitivity: 1.7, touchSensitivity: 0.6 };
    const raw = serializeCameraPreferences(prefs);
    expect(JSON.parse(raw)).toEqual({ v: 1, view: "first", mouse: 1.7, touch: 0.6 });
    expect(parseCameraPreferences(raw)).toEqual(prefs);
  });

  it("falls back field by field — a bad value never strands the visitor", () => {
    expect(parseCameraPreferences("not json")).toEqual(DEFAULT_CAMERA_PREFERENCES);
    expect(parseCameraPreferences(JSON.stringify({ v: 2, view: "first" }))).toEqual(DEFAULT_CAMERA_PREFERENCES);
    expect(parseCameraPreferences(JSON.stringify({ v: 1, view: "orbit", mouse: "fast", touch: 2 }))).toEqual({ view: "third", mouseSensitivity: 1, touchSensitivity: 2 });
    expect(parseCameraPreferences(JSON.stringify({ v: 1, view: "first", mouse: 99, touch: -4 }))).toEqual({ view: "first", mouseSensitivity: SENSITIVITY_MAX, touchSensitivity: SENSITIVITY_MIN });
    expect(parseCameraPreferences("null")).toEqual(DEFAULT_CAMERA_PREFERENCES);
  });

  it("clamps to the slider range and snaps to its 0.1 step", () => {
    expect(clampSensitivity(0.3000000004)).toBe(0.3);
    expect(clampSensitivity(1.26)).toBe(1.3);
    expect(clampSensitivity(0)).toBe(SENSITIVITY_MIN);
    expect(clampSensitivity(Infinity, 1.5)).toBe(1.5);
    expect(clampSensitivity("2.5")).toBe(2.5);
  });
});

describe("camera preference store — persistence", () => {
  it("loads the stored value once and persists every change", () => {
    const storage = memoryStorage({ [CAMERA_STORAGE_KEY]: serializeCameraPreferences({ view: "first", mouseSensitivity: 2, touchSensitivity: 0.5 }) });
    const store = new CameraPreferenceStore(() => storage);
    expect(store.state.view).toBe("third"); // nothing read before load()
    expect(store.load()).toEqual({ view: "first", mouseSensitivity: 2, touchSensitivity: 0.5 });
    expect(storage.writes).toBe(0); // loading never writes

    store.setView("third");
    store.setMouseSensitivity(1.44);
    store.setTouchSensitivity(9);
    expect(store.state).toEqual({ view: "third", mouseSensitivity: 1.4, touchSensitivity: SENSITIVITY_MAX });
    expect(parseCameraPreferences(storage.data.get(CAMERA_STORAGE_KEY)!)).toEqual(store.state);

    // A second store (a reload) sees the same preferences.
    expect(new CameraPreferenceStore(() => storage).load()).toEqual(store.state);
  });

  it("toggles the view (the V key and the HUD button share this) and ignores no-op writes", () => {
    const storage = memoryStorage();
    const store = new CameraPreferenceStore(() => storage);
    let notified = 0;
    store.subscribe(() => notified++);
    expect(store.toggleView()).toBe("first");
    expect(store.toggleView()).toBe("third");
    store.setView("third");
    store.setMouseSensitivity(1);
    expect(notified).toBe(2);
    expect(storage.writes).toBe(2);
  });

  it("an explicit choice made before load() is not overwritten by the stored value", () => {
    const storage = memoryStorage({ [CAMERA_STORAGE_KEY]: serializeCameraPreferences({ view: "third", mouseSensitivity: 1, touchSensitivity: 1 }) });
    const store = new CameraPreferenceStore(() => storage);
    store.setView("first");
    expect(store.load().view).toBe("first");
  });

  it("reset() returns to the defaults and persists them", () => {
    const storage = memoryStorage();
    const store = new CameraPreferenceStore(() => storage);
    store.setView("first");
    store.setTouchSensitivity(2.2);
    store.reset();
    expect(store.state).toEqual(DEFAULT_CAMERA_PREFERENCES);
    expect(parseCameraPreferences(storage.data.get(CAMERA_STORAGE_KEY)!)).toEqual(DEFAULT_CAMERA_PREFERENCES);
  });

  it("blocked storage (private mode) still changes the live session and never throws", () => {
    const store = new CameraPreferenceStore(() => ({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    }));
    expect(store.load()).toEqual(DEFAULT_CAMERA_PREFERENCES);
    store.setView("first");
    expect(store.state.view).toBe("first");
    expect(new CameraPreferenceStore(() => null).load()).toEqual(DEFAULT_CAMERA_PREFERENCES);
  });
});

describe("per-source look sensitivity", () => {
  it("scales mouse / gamepad and touch independently; 1 / 1 is the raw delta", () => {
    const sample = { pointer: { x: 10, y: -4 }, touch: { x: 3, y: 6 } };
    expect(scaledLook(sample, { mouseSensitivity: 1, touchSensitivity: 1 })).toEqual({ x: 13, y: 2 });
    expect(scaledLook(sample, { mouseSensitivity: 2, touchSensitivity: 0.5 })).toEqual({ x: 21.5, y: -5 });
    expect(scaledLook({ pointer: { x: 10, y: 0 }, touch: { x: 0, y: 0 } }, { mouseSensitivity: 1, touchSensitivity: 3 })).toEqual({ x: 10, y: 0 });
  });
});

/** Fakes of the two official rigs: `active` mirrors the engine's own setter semantics. */
function harness() {
  const log: string[] = [];
  const camera = { distanceFromTarget: 5 };
  const orbit: OrbitRigPort & { _active: boolean; zoomed: number } = {
    _active: true, // the engine rigs activate themselves on construction
    zoomed: 5,
    get active() {
      return this._active;
    },
    set active(v: boolean) {
      if (v && !this._active) {
        // ThirdPersonCameraRig re-syncs its orbit (and zoom) from the camera position on activation.
        this.zoomed = camera.distanceFromTarget;
        log.push(`orbit:on@${camera.distanceFromTarget}`);
      }
      if (!v && this._active) log.push("orbit:off");
      this._active = v;
    },
    rotate: (dx, dy) => log.push(`orbit:rotate ${dx},${dy}`),
    zoom(delta) {
      this.zoomed += delta;
      log.push(`orbit:zoom ${delta}`);
    },
    setZoom(d) {
      this.zoomed = d;
      log.push(`orbit:setZoom ${d}`);
    },
    get currentZoom() {
      return this.zoomed;
    },
    reset: () => log.push("orbit:reset"),
  };
  const eye: EyeRigPort & { _active: boolean } = {
    _active: true,
    get active() {
      return this._active;
    },
    set active(v: boolean) {
      if (v !== this._active) log.push(v ? "eye:on" : "eye:off");
      if (v) camera.distanceFromTarget = 0;
      this._active = v;
    },
    rotate: (dx, dy) => log.push(`eye:rotate ${dx},${dy}`),
    setRotation: (yaw, pitch) => log.push(`eye:setRotation ${yaw.toFixed(2)},${pitch.toFixed(2)}`),
    reset: () => log.push("eye:reset"),
  };
  let avatarVisible = true;
  const host: ViewHost = {
    readCameraAngles: () => ({ yaw: 0.5, pitch: -1.5 }),
    readFramingYaw: () => 0.25,
    moveCameraBack: (d) => {
      camera.distanceFromTarget += d;
      log.push(`camera:back ${d}`);
    },
    setAvatarVisible: (v) => {
      avatarVisible = v;
      log.push(`avatar:${v ? "shown" : "hidden"}`);
    },
  };
  const controller = new CameraViewController(orbit, eye, host);
  log.length = 0;
  return { controller, orbit, eye, log, avatar: () => avatarVisible };
}

describe("first / third-person view controller", () => {
  it("starts with both rigs off until controls are on; then exactly the orbit rig runs (third person default)", () => {
    const h = harness();
    expect(h.orbit.active).toBe(false);
    expect(h.eye.active).toBe(false);
    expect(h.controller.view).toBe("third");
    h.controller.setActive(true);
    expect([h.orbit.active, h.eye.active, h.avatar()]).toEqual([true, false, true]);
    expect(h.orbit.currentZoom).toBe(5);
  });

  it("third → first: keeps the view direction (pitch clamped), hides the avatar, never runs both rigs", () => {
    const h = harness();
    h.controller.setActive(true);
    h.log.length = 0;
    h.controller.setView("first");
    expect(h.log).toEqual(["orbit:off", "eye:setRotation 0.50,-1.20", "eye:on", "avatar:hidden"]);
    expect([h.orbit.active, h.eye.active, h.avatar()]).toEqual([false, true, false]);
  });

  it("first → third: shows the avatar first, re-enters behind the eye and dollies out to the remembered distance", () => {
    const h = harness();
    h.controller.setActive(true);
    h.controller.zoom(-20); // the visitor zoomed in to 3 m (delta × 0.1 is the rig's own scaling; the fake adds raw)
    const zoomBefore = h.orbit.currentZoom;
    h.controller.setView("first");
    h.log.length = 0;
    h.controller.setView("third");
    expect(h.log).toEqual(["avatar:shown", "eye:off", "camera:back 0.6", "orbit:on@0.6", `orbit:setZoom ${zoomBefore}`]);
    expect([h.orbit.active, h.eye.active, h.avatar()]).toEqual([true, false, true]);
    expect(h.orbit.currentZoom).toBe(zoomBefore);
  });

  it("routes look and zoom to the live rig only; zoom is ignored in first person and while inactive", () => {
    const h = harness();
    h.controller.rotate(1, 1);
    h.controller.zoom(1);
    expect(h.log).toEqual([]);
    h.controller.setActive(true);
    h.log.length = 0;
    h.controller.rotate(2, 3);
    h.controller.setView("first");
    h.log.length = 0;
    h.controller.rotate(4, 5);
    h.controller.zoom(1);
    h.controller.rotate(0, 0);
    expect(h.log).toEqual(["eye:rotate 4,5"]);
  });

  it("a view chosen before the reveal (stored preference) applies on activation; the avatar is hidden throughout", () => {
    const h = harness();
    h.controller.setView("first");
    expect([h.orbit.active, h.eye.active, h.avatar()]).toEqual([false, false, false]);
    h.controller.reset(); // placeVisitor before the reveal
    h.controller.setActive(true);
    expect([h.orbit.active, h.eye.active, h.avatar()]).toEqual([false, true, false]);
    // The engine eye rig's own reset faces away from the orbit's framing: the controller re-aims it.
    expect(h.log.slice(h.log.indexOf("eye:reset"), h.log.indexOf("eye:reset") + 2)).toEqual(["eye:reset", "eye:setRotation 0.25,0.00"]);
    expect(h.log).not.toContain("orbit:reset");
  });

  it("teleport reset frames the new place with the live rig and keeps the visitor's orbit distance", () => {
    const h = harness();
    h.controller.setActive(true);
    h.controller.zoom(-10);
    const zoom = h.orbit.currentZoom;
    h.log.length = 0;
    h.controller.reset();
    expect(h.log).toEqual(["orbit:reset"]);
    expect(h.orbit.currentZoom).toBe(zoom);
  });

  it("controls off and on again (travel / reveal) restores the remembered distance, not a collision-clipped one", () => {
    const h = harness();
    h.controller.setActive(true);
    h.controller.setActive(false);
    expect([h.orbit.active, h.eye.active]).toEqual([false, false]);
    h.controller.setActive(true);
    expect(h.orbit.currentZoom).toBe(5);
  });

  it("switching back to third person while inactive re-enters from behind the eye on activation", () => {
    const h = harness();
    h.controller.setActive(true);
    h.controller.setView("first");
    h.controller.setActive(false);
    h.controller.setView("third");
    expect(h.avatar()).toBe(true);
    h.log.length = 0;
    h.controller.setActive(true);
    expect(h.log).toEqual(["avatar:shown", "camera:back 0.6", "orbit:on@0.6", "orbit:setZoom 5"]);
  });
});

describe("camera wiring (source scan)", () => {
  const runtime = src("src/lib/spatial/awe-spatial-runtime.ts");
  const shell = src("src/components/app-shell.tsx");
  const settings = src("src/components/camera-settings.tsx");

  it("the runtime uses the official rigs and leaves the movement tuning untouched", () => {
    expect(runtime).toMatch(/new FirstPersonCameraRig\(/);
    expect(runtime).toMatch(/new ThirdPersonCameraRig\(\{[\s\S]*distance: 5,[\s\S]*collision: true,/);
    // The first-person rig is built first: the orbit's construction-time camera placement must stand.
    expect(runtime.indexOf("new FirstPersonCameraRig(")).toBeLessThan(runtime.indexOf("new ThirdPersonCameraRig("));
    expect(runtime).toMatch(/const SPEED = 15;/);
    expect(runtime).toMatch(/speed: SPEED,\s*gravity: -1\.81,\s*acceleration: 100,\s*deceleration: 50,\s*airControl: 1,\s*facingMode: "movement",/);
    expect(runtime).toMatch(/scaledLook\(\{ pointer: this\.inputs\.Look\.readValue\(\), touch: this\.inputs\.TouchLook\.readValue\(\) \}, cameraPreferences\.state\)/);
    expect(runtime).toMatch(/this\.cameraView\?\.reset\(\);/);
    expect(runtime).not.toMatch(/this\.cameraRig\?\.rotate\(/);
  });

  it("the settings keep keys away from the engine and the HUD controls stay out of the touch-control footprint", () => {
    expect(settings).toMatch(/event\.stopPropagation\(\); \/\/ never reaches the engine's window listener/);
    expect(settings).toMatch(/aria-expanded=\{open\}/);
    expect(settings).toMatch(/event\.key === "Escape"/);
    expect(settings).toMatch(/document\.exitPointerLock\(\)/);
    expect(shell).toMatch(/<CameraSettings touch=\{mode\.touch\} open=\{cameraOpen\} onOpenChange=\{setCameraOpen\} \/>/);
  });
});
