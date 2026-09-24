import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BrowserInputCapture,
  ControlStateManager,
  VirtualJoystick,
  createInputs,
} from "@oncyberio/engine/input";
import { GAMEPLAY_INPUTS } from "@/lib/input/gameplay-inputs";
import { JoystickSurface, PointerOwner, joystickGeometry } from "@/lib/input/touch-controls";

/**
 * Post-M0 input hardening, NRVNAVerse side: the look binding is raw now that the engine's rigs have
 * one axis convention on every device class; the on-screen joystick delegates ownership and response
 * to the engine's `VirtualJoystick`; the jump button is owned by the pointer that pressed it.
 */

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (path: string) => readFileSync(join(APP_ROOT, path), "utf8");

beforeAll(() => {
  // Gamepad bindings sample `navigator.getGamepads()` every frame.
  const nav = ((globalThis as unknown as { navigator?: Record<string, unknown> }).navigator ??= {});
  nav.getGamepads ??= () => [];
});

type Listener = (event: unknown) => void;

class FakeTarget {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener() {}
  dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function touchEvent(type: string, id: number, x: number, y: number) {
  const point = { identifier: id, clientX: x, clientY: y };
  return { type, touches: type === "touchend" ? [] : [point], changedTouches: [point], preventDefault() {} };
}

describe("gameplay Look binding", () => {
  it("passes a canvas touch drag through raw — right is +x, down is +y", () => {
    const canvas = new FakeTarget();
    const controlState = new ControlStateManager({
      capture: new BrowserInputCapture({
        target: canvas as unknown as EventTarget,
        keyboardTarget: new FakeTarget() as unknown as EventTarget,
      }),
    });
    const inputs = createInputs(GAMEPLAY_INPUTS, { controlState, sampling: "manual" });
    const frame = () => {
      controlState.processInputFrame(1 / 60, 0);
      controlState.beginFixedUpdates(1);
      inputs.sample();
      inputs.update(1 / 60);
      const look = inputs.Look.readValue();
      controlState.endFixedUpdates();
      return { x: look.x, y: look.y };
    };

    try {
      canvas.dispatch("touchstart", touchEvent("touchstart", 1, 200, 400));
      frame();
      canvas.dispatch("touchmove", touchEvent("touchmove", 1, 240, 412));
      // The old binding (`scaleVector2(-1)`) read { x: -40, y: -12 } here.
      expect(frame()).toEqual({ x: 40, y: 12 });
      canvas.dispatch("touchend", touchEvent("touchend", 1, 240, 412));
      expect(frame()).toEqual({ x: 0, y: 0 });
    } finally {
      inputs.dispose();
      controlState.dispose();
    }
  });

  it("applies no processor to any Look binding", () => {
    for (const binding of GAMEPLAY_INPUTS.Look.bindings) {
      expect((binding as { processors?: unknown[] }).processors ?? []).toEqual([]);
    }
  });
});

/** An 88 px stick with a 32 px thumb (the ≤390 px metrics), centred at (56, 788). */
const RECT = { left: 12, top: 744, width: 88, height: 88 };
const THUMB = 32;
const GEOMETRY = joystickGeometry(RECT, THUMB);
const UP = { x: GEOMETRY.centerX, y: GEOMETRY.centerY - GEOMETRY.radius };

function recordingSurface(stick?: VirtualJoystick) {
  const published: Array<[number, number]> = [];
  const thumbs: Array<[number, number]> = [];
  const surface = new JoystickSurface(
    {
      publish: (x, y) => published.push([x, y]),
      showThumb: (x, y) => thumbs.push([x, y]),
    },
    stick,
  );
  return { surface, published, thumbs, last: () => published[published.length - 1] };
}

describe("joystick geometry", () => {
  it("centres on the element and reaches full deflection where the thumb meets the rim", () => {
    expect(GEOMETRY).toEqual({ centerX: 56, centerY: 788, radius: 28 });
  });
});

describe("JoystickSurface — ownership", () => {
  it("publishes the owner's vector and refuses a second pointer entirely", () => {
    const { surface, published, last } = recordingSurface();

    expect(surface.down(1, UP.x, UP.y, GEOMETRY)).toBe(true);
    expect(surface.ownerId).toBe(1);
    expect(last()[1]).toBeCloseTo(1, 6);
    const before = published.length;

    // A camera finger grazes the stick: press, drag, lift, cancel — all refused, nothing published.
    expect(surface.down(2, GEOMETRY.centerX + GEOMETRY.radius, GEOMETRY.centerY, GEOMETRY)).toBe(false);
    expect(surface.move(2, 400, 200, GEOMETRY)).toBe(false);
    expect(surface.up(2)).toBe(false);
    expect(surface.cancel(2)).toBe(false);
    expect(published.length).toBe(before);
    expect(surface.ownerId).toBe(1);

    // The owner still steers, then releases to neutral.
    expect(surface.move(1, UP.x, UP.y - 5, GEOMETRY)).toBe(true);
    expect(surface.up(1)).toBe(true);
    expect(last()).toEqual([0, 0]);
    expect(surface.ownerId).toBeNull();
  });

  it("survives five look-finger replacements while the owner holds forward", () => {
    const { surface, last } = recordingSurface();
    surface.down(1, UP.x, UP.y, GEOMETRY);
    for (let finger = 10; finger < 15; finger++) {
      surface.down(finger, GEOMETRY.centerX, GEOMETRY.centerY, GEOMETRY);
      surface.move(finger, GEOMETRY.centerX + 20, GEOMETRY.centerY, GEOMETRY);
      if (finger === 12) surface.cancel(finger);
      else surface.up(finger);
      expect(last()[1]).toBeCloseTo(1, 6);
      expect(surface.ownerId).toBe(1);
    }
  });

  it("frees the stick only on the owner's cancel, then accepts a new owner", () => {
    const { surface, last } = recordingSurface();
    surface.down(1, UP.x, UP.y, GEOMETRY);
    expect(surface.cancel(1)).toBe(true);
    expect(last()).toEqual([0, 0]);
    expect(surface.down(2, UP.x, UP.y, GEOMETRY)).toBe(true);
    expect(surface.ownerId).toBe(2);
  });

  it("dispose drops the owner and publishes neutral", () => {
    const { surface, last, thumbs } = recordingSurface();
    surface.down(1, UP.x, UP.y, GEOMETRY);
    surface.dispose();
    expect(surface.ownerId).toBeNull();
    expect(last()).toEqual([0, 0]);
    expect(thumbs[thumbs.length - 1]).toEqual([0, 0]);
  });
});

describe("JoystickSurface — response is the engine's VirtualJoystick", () => {
  it("publishes exactly what a VirtualJoystick computes for the same pointer path", () => {
    const { surface, published, thumbs } = recordingSurface();
    const reference = new VirtualJoystick();
    const path: Array<[number, number]> = [
      [UP.x, UP.y],
      [GEOMETRY.centerX + 5, GEOMETRY.centerY - 5], // inside the deadzone
      [GEOMETRY.centerX + 20, GEOMETRY.centerY - 3], // near-cardinal
      [GEOMETRY.centerX + 14, GEOMETRY.centerY - 14], // diagonal
      [GEOMETRY.centerX + 400, GEOMETRY.centerY], // past the rim
    ];

    path.forEach(([x, y], i) => {
      if (i === 0) {
        surface.down(1, x, y, GEOMETRY);
        reference.press(1, x, y, GEOMETRY);
      } else {
        surface.move(1, x, y, GEOMETRY);
        reference.move(1, x, y, GEOMETRY);
      }
      expect(published[published.length - 1]).toEqual([reference.vector.x, reference.vector.y]);
      expect(thumbs[thumbs.length - 1]).toEqual([reference.thumb.x, reference.thumb.y]);
    });
  });

  it("delegates every decision to the injected stick", () => {
    const calls: string[] = [];
    const stick = new VirtualJoystick();
    for (const method of ["press", "move", "release", "cancel", "reset"] as const) {
      const original = stick[method].bind(stick) as (...args: unknown[]) => unknown;
      (stick as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        calls.push(method);
        return original(...args);
      };
    }
    const { surface } = recordingSurface(stick);
    surface.down(1, UP.x, UP.y, GEOMETRY);
    surface.move(1, UP.x, UP.y, GEOMETRY);
    surface.up(1);
    surface.down(1, UP.x, UP.y, GEOMETRY);
    surface.cancel(1);
    surface.dispose();
    expect(calls).toEqual(["press", "move", "release", "reset", "press", "cancel", "release", "reset", "reset"]);
  });

  it("the app keeps no second copy of the response constants or math", () => {
    for (const file of ["src/components/touch-joystick.tsx", "src/lib/input/touch-controls.ts"]) {
      const code = src(file);
      expect(code).not.toMatch(
        // (a comma-prefixed literal is a CSS colour channel, e.g. `rgba(0,0,0,0.35)`)
        /(?<!,)0\.26|(?<!,)1\.75|(?<!,)0\.35\b|DEADZONE|RESPONSE_EXPONENT|CARDINAL_ASSIST|applyCardinalAssist|Math\.hypot|Math\.pow|[\w)\]]\s*\*\*\s*[\w(]/,
      );
      expect(code).not.toMatch(/pointerIdRef/);
    }
    expect(src("src/components/touch-joystick.tsx")).toMatch(/new JoystickSurface\(/);
  });
});

describe("jump button ownership", () => {
  it("only the pointer that pressed can release", () => {
    const owner = new PointerOwner();
    expect(owner.claim(7)).toBe(true);
    expect(owner.claim(8)).toBe(false); // a second finger does not re-press or take over
    expect(owner.release(8)).toBe(false); // nor release
    expect(owner.ownerId).toBe(7);
    expect(owner.release(7)).toBe(true);
    expect(owner.ownerId).toBeNull();
    expect(owner.claim(8)).toBe(true);
  });

  it("reset frees the button (unmount)", () => {
    const owner = new PointerOwner();
    owner.claim(3);
    owner.reset();
    expect(owner.ownerId).toBeNull();
    expect(owner.claim(4)).toBe(true);
  });

  it("the component gates press, release and cancel on the owner and has no unguarded leave release", () => {
    const code = src("src/components/jump-button.tsx");
    expect(code).toMatch(/if \(!ownerRef\.current!\.claim\(event\.pointerId\)\)/);
    expect(code.match(/if \(!ownerRef\.current!\.release\(event\.pointerId\)\)/g)).toHaveLength(2);
    expect(code).not.toMatch(/onPointerLeave/);
  });
});
