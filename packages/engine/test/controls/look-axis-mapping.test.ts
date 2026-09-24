/**
 * One look-axis convention for every camera rig, on every device class.
 *
 * `rotate(dx, dy)` must mean the same thing whatever the UA parser decided the
 * device is: +x looks right, +y looks down — exactly what raw mouse and touch
 * screen deltas already are.
 *
 * It used not to. `applyAxisDampening` and `CameraRig.rotate` negated both
 * deltas when the device was classed as mobile, so games compensated with a
 * `scaleVector2(-1)` on their touch binding, which only cancelled out on
 * devices the parser recognised: a touch device reporting a desktop UA (an
 * iPad in its default desktop mode, a touchscreen laptop) got one flip and
 * looked inverted on both axes. The first-person and fly rigs carried a second
 * mobile-only negation (a negative touch speed in
 * `calculateRotationConversion`) that happened to cancel the first, so they
 * must keep their direction once the dampening flip is gone.
 *
 * Every rig is loaded twice below, once per device class, with the engine's
 * UA-derived constants mocked, and must turn the same way in both.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three";

type DeviceClass = "desktop" | "mobile";

const USER_AGENTS: Record<DeviceClass, string> = {
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  mobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

const DEVICE_CLASSES: DeviceClass[] = ["desktop", "mobile"];

const RIGS = ["third-person", "first-person", "fly", "legacy CameraRig"] as const;
type RigName = (typeof RIGS)[number];

/** Load the rig modules fresh, with the engine's device class forced. */
async function loadRigs(device: DeviceClass) {
  const mobile = device === "mobile";

  // A stubbed `window` from a previous load would make the engine's modules
  // (and the UMD UA parser) evaluate as if they were in a browser.
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doMock("../../src/internal/constants", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
      ...actual,
      IS_MOBILE: mobile,
      IS_TOUCH: mobile,
      IS_DESKTOP: !mobile,
      // The touch rotation is calibrated in portrait.
      ORIENTATION: actual.PORTRAIT,
    };
  });
  // `camera-rig.ts` classifies the device from the UA string itself.
  vi.stubGlobal("navigator", {
    userAgent: USER_AGENTS[device],
    getGamepads: () => [],
  });

  const [physics, thirdPerson, firstPerson, fly, legacy, base] = await Promise.all([
    import("../../src/physics"),
    import("../../src/controls/camera-rigs/third-person-camera-rig"),
    import("../../src/controls/camera-rigs/first-person-camera-rig"),
    import("../../src/controls/camera-rigs/fly-camera-rig"),
    import("../../src/controls/camera-rig"),
    import("../../src/controls/camera-rigs/base-camera-rig"),
  ]);

  vi.spyOn(physics.Physics, "get").mockReturnValue({
    physicsRaycast: () => null,
  } as never);
  // The screen-based rigs size their rotation from the viewport (390x844 is
  // the touch calibration baseline). Stubbed only after the modules loaded,
  // so the engine's constants still see a non-browser environment.
  vi.stubGlobal("window", { innerWidth: 390, innerHeight: 844 });

  return {
    base,
    ThirdPersonCameraRig: thirdPerson.ThirdPersonCameraRig,
    FirstPersonCameraRig: firstPerson.FirstPersonCameraRig,
    FlyCameraRig: fly.FlyCameraRig,
    CameraRig: legacy.CameraRig,
  };
}

type Rigs = Awaited<ReturnType<typeof loadRigs>>;

function makeTarget() {
  const target = new Object3D() as Object3D & { getDimensions: () => { y: number } };
  target.position.set(0, 0, 0);
  target.getDimensions = () => ({ y: 2 });
  return target;
}

function forwardOf(quaternion: Quaternion) {
  return new Vector3(0, 0, -1).applyQuaternion(quaternion);
}

/**
 * How the view turned between two forward vectors, in the camera's own terms:
 * `yaw > 0` is a turn to the right, `pitch > 0` a tilt up. Measured relative
 * to where the rig started, since rigs initialise from their target's facing.
 */
function turnBetween(before: Vector3, after: Vector3) {
  return {
    yaw: -new Vector3().crossVectors(before, after).y,
    pitch: after.y - before.y,
  };
}

type Internals = {
  _camera: PerspectiveCamera;
  _targetQuat: Quaternion;
  _update: (dt: number) => void;
  dispose: () => void;
};

/**
 * How the view turns for one `rotate(dx, dy)`: `yaw > 0` means "turned right",
 * `pitch > 0` "tilted up" (see {@link turnBetween}).
 */
function turnAfterRotate(rigs: Rigs, name: RigName, dx: number, dy: number) {
  const camera = new PerspectiveCamera(75, 390 / 844, 0.1, 1000);
  const target = makeTarget();

  let rig: Internals;
  switch (name) {
    case "third-person":
      rig = new rigs.ThirdPersonCameraRig({
        camera,
        target,
        distance: 5,
        height: 0,
        collision: false,
        smoothing: 1,
        smoothMethod: "orbit",
        usePointerLock: false,
      }) as unknown as Internals;
      break;
    case "first-person":
      rig = new rigs.FirstPersonCameraRig({
        camera,
        target,
        height: 1.6,
        usePointerLock: false,
      }) as unknown as Internals;
      break;
    case "fly":
      rig = new rigs.FlyCameraRig({ camera, usePointerLock: false }) as unknown as Internals;
      break;
    case "legacy CameraRig":
      rig = new rigs.CameraRig({
        camera,
        target,
        mode: "orbit",
        distance: 5,
        height: 0,
        collision: false,
        smoothing: 1,
        usePointerLock: false,
      }) as unknown as Internals;
      break;
  }

  // First-person and fly slerp toward a target orientation, so read the
  // target; the orbit rigs are read from the camera after one full update.
  const slerped = name === "first-person" || name === "fly";
  const view = () => {
    if (slerped) {
      return forwardOf(rig._targetQuat ?? rig._camera.quaternion);
    }
    rig._update(1);
    return forwardOf(rig._camera.quaternion);
  };

  try {
    const before = view();
    (rig as unknown as { rotate: (x: number, y: number) => void }).rotate(dx, dy);
    return turnBetween(before, view());
  } finally {
    rig.dispose();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/internal/constants");
  vi.resetModules();
});

describe.each(DEVICE_CLASSES)("look-axis convention on a %s device class", (device) => {
  it.each(RIGS)("%s: +x looks right, -x looks left", async (name) => {
    const rigs = await loadRigs(device);
    expect(turnAfterRotate(rigs, name, 40, 0).yaw).toBeGreaterThan(0);
    expect(turnAfterRotate(rigs, name, -40, 0).yaw).toBeLessThan(0);
  });

  // The legacy `CameraRig` orbit mode has always tilted up for +y with its
  // default `invertY` (the reverse of `ThirdPersonCameraRig`). That is its
  // desktop behaviour and is left alone; it is held to device-class
  // independence below instead.
  it.each(RIGS.filter((name) => name !== "legacy CameraRig"))(
    "%s: +y looks down, -y looks up",
    async (name) => {
      const rigs = await loadRigs(device);
      expect(turnAfterRotate(rigs, name, 0, 40).pitch).toBeLessThan(0);
      expect(turnAfterRotate(rigs, name, 0, -40).pitch).toBeGreaterThan(0);
    },
  );

  it("applyAxisDampening scales but never changes a sign", async () => {
    const { base } = await loadRigs(device);
    for (const [dx, dy] of [
      [40, 0],
      [-40, 0],
      [0, 40],
      [0, -40],
      [20, 30],
      [-20, -30],
    ]) {
      const { dx: outX, dy: outY } = base.applyAxisDampening(dx, dy);
      if (dx !== 0) expect(Math.sign(outX)).toBe(Math.sign(dx));
      if (dy !== 0) expect(Math.sign(outY)).toBe(Math.sign(dy));
    }
  });

  it("calculateRotationConversion yields positive magnitudes", async () => {
    const { base } = await loadRigs(device);
    const { dxToRad, dyToRad } = base.calculateRotationConversion();
    expect(dxToRad).toBeGreaterThan(0);
    expect(dyToRad).toBeGreaterThan(0);
  });
});

describe("device class changes magnitude only", () => {
  it.each(RIGS)("%s turns the same way on desktop and mobile", async (name) => {
    const drags: Array<[number, number]> = [
      [40, 0],
      [-40, 0],
      [0, 40],
      [0, -40],
      [30, 20],
      [-30, -20],
    ];
    const signs = async (device: DeviceClass) => {
      const rigs = await loadRigs(device);
      return drags.map(([dx, dy]) => {
        const turn = turnAfterRotate(rigs, name, dx, dy);
        return [
          Math.sign(Number(turn.yaw.toFixed(6))),
          Math.sign(Number(turn.pitch.toFixed(6))),
        ];
      });
    };
    const desktop = await signs("desktop");
    const mobile = await signs("mobile");
    expect(mobile).toEqual(desktop);
  });

  it("keeps the touch rotation magnitude of the screen-based rigs", async () => {
    // iPhone 12 Pro portrait baseline: 0.0043 rad per px horizontally and a
    // quarter of that vertically, as before — only the sign moved.
    const { base } = await loadRigs("mobile");
    const { dxToRad, dyToRad } = base.calculateRotationConversion();
    expect(dxToRad).toBeCloseTo(0.0043, 10);
    expect(dyToRad).toBeCloseTo(0.0043 / 4, 10);
  });
});
