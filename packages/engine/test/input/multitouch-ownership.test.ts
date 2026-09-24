/**
 * Two fingers, two ownership domains — the real-device multitouch bug.
 *
 * Reported from a phone (Feature Lab station 7, 2026-09-23): while one finger
 * holds the movement joystick, repeatedly lifting and re-placing *only* the
 * camera-look finger makes movement and look interact oddly.
 *
 * The starter's DOM is two surfaces, not one:
 *
 *   - the WebGL canvas (`BrowserInputCapture` -> `TouchState`) owns camera look;
 *   - the on-screen joystick is a `pointer-events: auto` overlay *beside* the
 *     canvas that pushes an analog vector through `touch.setJoystick()`.
 *
 * A finger on the joystick therefore never appears in `TouchState._touches` —
 * but it *is* in every canvas `TouchEvent.touches`, which is a document-wide
 * list "regardless of target". `BrowserInputCapture` passed
 * `event.touches.length` in as the authoritative touch count, so the engine's
 * count and its tracked set diverged the moment a second surface was touched,
 * and never converged again: the joystick finger's `touchend` is delivered to
 * the overlay, so the canvas never hears about it.
 *
 * `Screen` below models the browser faithfully — one document-wide touch list,
 * events routed to the element the touch *started* on — so the sequence in
 * these tests is the sequence a thumb performs.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { createInputs } from "../../src/input/input-map";
import { Touch } from "../../src/input/bindings";
import { BrowserInputCapture, ControlStateManager } from "../../src/input/index";
import { setupNavigatorMock } from "./input-test-utils";

type Listener = (event: unknown) => void;

class MockEventTarget {
  private _listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback =
      typeof listener === "function"
        ? (listener as Listener)
        : (event: unknown) =>
            (listener as EventListenerObject).handleEvent(event as Event);
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(callback);
  }

  removeEventListener() {
    // The capture layer detaches on dispose; nothing to assert here.
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this._listeners.get(type) ?? []) listener(event);
  }
}

type Contact = { id: number; x: number; y: number; target: MockEventTarget };

/**
 * The browser's touch semantics, as they actually are:
 * `TouchEvent.touches` lists every contact on the screen whatever its target,
 * while the event itself is delivered to the element the touch started on
 * (implicit touch capture).
 */
class Screen {
  private _contacts = new Map<number, Contact>();

  private _all() {
    return [...this._contacts.values()].map((c) => ({
      identifier: c.id,
      clientX: c.x,
      clientY: c.y,
    }));
  }

  private _fire(type: string, target: MockEventTarget, changed: unknown[]) {
    target.dispatch(type, {
      type,
      touches: this._all(),
      changedTouches: changed,
      preventDefault() {},
    });
  }

  start(id: number, x: number, y: number, target: MockEventTarget) {
    this._contacts.set(id, { id, x, y, target });
    this._fire("touchstart", target, [
      { identifier: id, clientX: x, clientY: y },
    ]);
  }

  move(id: number, x: number, y: number) {
    const contact = this._contacts.get(id);
    if (!contact) throw new Error(`touch ${id} is not down`);
    contact.x = x;
    contact.y = y;
    this._fire("touchmove", contact.target, [
      { identifier: id, clientX: x, clientY: y },
    ]);
  }

  end(id: number, kind: "touchend" | "touchcancel" = "touchend") {
    const contact = this._contacts.get(id);
    if (!contact) throw new Error(`touch ${id} is not down`);
    this._contacts.delete(id);
    this._fire(kind, contact.target, [
      { identifier: contact.id, clientX: contact.x, clientY: contact.y },
    ]);
  }
}

function harness() {
  const canvas = new MockEventTarget();
  /** The joystick overlay: a sibling of the canvas, so the engine never sees its touches. */
  const joystick = new MockEventTarget();
  const controlState = new ControlStateManager({
    capture: new BrowserInputCapture({
      target: canvas as unknown as EventTarget,
      keyboardTarget: new MockEventTarget() as unknown as EventTarget,
    }),
  });

  const inputs = createInputs(
    {
      Look: { type: "vector2", bindings: [Touch.delta()] },
      Move: { type: "vector2", bindings: [Touch.joystick()] },
      Tap: { type: "button", bindings: [Touch.tap()] },
    } as const,
    { controlState, sampling: "manual" },
  );

  const screen = new Screen();

  /** One render frame: sample the devices, run one fixed update, read the actions. */
  function frame() {
    controlState.processInputFrame(1 / 60, 0);
    controlState.beginFixedUpdates(1);
    inputs.sample();
    inputs.update(1 / 60);
    const snapshot = {
      look: inputs.Look.readValue(),
      move: inputs.Move.readValue(),
      tap: inputs.Tap.isPressed,
      touchCount: controlState.touch.touchCount,
      isTouching: controlState.touch.isTouching,
      lookTouchId: controlState.touch.lookTouchId,
    };
    controlState.endFixedUpdates();
    return snapshot;
  }

  function dispose() {
    inputs.dispose();
    controlState.dispose();
  }

  return { canvas, joystick, controlState, screen, frame, dispose };
}

/** The joystick pushed fully forward, as `TouchJoystick` does on every pointermove. */
const FORWARD = { x: 0, y: 1 };

describe("multitouch: joystick and camera look are independent ownership domains", () => {
  beforeAll(() => {
    setupNavigatorMock();
  });

  it("counts only the touches the engine actually tracks", () => {
    const h = harness();
    try {
      // Finger A holds the joystick overlay. The canvas hears nothing.
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);
      expect(h.frame()).toMatchObject({ touchCount: 0, isTouching: false });

      // Finger B lands on the canvas — one tracked touch, not two.
      h.screen.start(2, 300, 400, h.canvas);
      expect(h.frame()).toMatchObject({ touchCount: 1, isTouching: true });

      // B lifts while A keeps holding: back to zero tracked touches.
      h.screen.end(2);
      expect(h.frame()).toMatchObject({ touchCount: 0, isTouching: false });
    } finally {
      h.dispose();
    }
  });

  it("does not leave a phantom touch behind after the joystick finger lifts", () => {
    const h = harness();
    try {
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);
      h.screen.start(2, 300, 400, h.canvas);
      h.frame();
      h.screen.end(2);
      // The joystick finger's touchend goes to the overlay, never to the canvas.
      h.screen.end(1);
      h.controlState.touch.setJoystick(0, 0);

      const after = h.frame();
      expect(after.touchCount).toBe(0);
      expect(after.isTouching).toBe(false);
      // `Touch.tap()` is a Jump binding in examples/auth-multiplayer: a stuck
      // count here holds jump down for the rest of the session.
      expect(after.tap).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("releases Touch.tap() when the canvas finger ends while the overlay finger is still held", () => {
    const h = harness();
    try {
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);

      for (const kind of ["touchend", "touchcancel"] as const) {
        h.screen.start(2, 300, 400, h.canvas);
        expect(h.frame()).toMatchObject({ tap: true, touchCount: 1 });

        // A is still down on the overlay, so the document-wide `touches`
        // list still holds one contact. The canvas owns none of them.
        h.screen.end(2, kind);
        expect(h.frame()).toMatchObject({
          tap: false,
          isTouching: false,
          touchCount: 0,
          move: FORWARD,
        });
        expect(h.frame().tap).toBe(false);
      }
    } finally {
      h.dispose();
    }
  });

  it("clears tracked contacts and look ownership on reset", () => {
    const h = harness();
    try {
      h.screen.start(2, 300, 400, h.canvas);
      h.screen.start(3, 500, 200, h.canvas);
      expect(h.frame()).toMatchObject({ touchCount: 2, lookTouchId: 2 });

      h.controlState.touch.reset();
      expect(h.controlState.touch.touchCount).toBe(0);
      expect(h.controlState.touch.isTouching).toBe(false);
      expect(h.controlState.touch.lookTouchId).toBeNull();
    } finally {
      h.dispose();
    }
  });

  it("keeps movement steady while the look finger is lifted and re-placed five times", () => {
    const h = harness();
    try {
      // Joystick held forward, and it stays held for the whole test.
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);
      expect(h.frame().move).toEqual(FORWARD);

      let id = 10;
      for (let pass = 0; pass < 5; pass++) {
        const lookId = ++id;
        const startX = 300;

        // A fresh look finger lands. Placing it must not move the camera.
        h.screen.start(lookId, startX, 400, h.canvas);
        const onPlace = h.frame();
        expect(onPlace.look).toEqual({ x: 0, y: 0 });
        expect(onPlace.move).toEqual(FORWARD);
        expect(onPlace.touchCount).toBe(1);
        expect(onPlace.lookTouchId).toBe(lookId);

        // It swipes: the delta is exactly this finger's movement.
        h.screen.move(lookId, startX + 40, 412);
        const onSwipe = h.frame();
        expect(onSwipe.look).toEqual({ x: 40, y: 12 });
        expect(onSwipe.move).toEqual(FORWARD);

        // It lifts. No delta is emitted by the lift itself.
        h.screen.end(lookId);
        const onLift = h.frame();
        expect(onLift.look).toEqual({ x: 0, y: 0 });
        expect(onLift.move).toEqual(FORWARD);
        expect(onLift.touchCount).toBe(0);
        expect(onLift.isTouching).toBe(false);
        expect(onLift.lookTouchId).toBeNull();

        // An idle frame in between: still nothing, still moving.
        expect(h.frame()).toMatchObject({ look: { x: 0, y: 0 }, move: FORWARD });
      }

      // The joystick finger was never disturbed.
      expect(h.frame().move).toEqual(FORWARD);
    } finally {
      h.dispose();
    }
  });

  it("gives a re-placed look finger no stale delta, however far away it lands", () => {
    const h = harness();
    try {
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);

      h.screen.start(2, 300, 400, h.canvas);
      h.frame();
      h.screen.move(2, 340, 400);
      expect(h.frame().look).toEqual({ x: 40, y: 0 });
      h.screen.end(2);
      h.frame();

      // The next finger lands on the far side of the screen. Nothing may jump.
      h.screen.start(3, 20, 60, h.canvas);
      expect(h.frame().look).toEqual({ x: 0, y: 0 });
      h.screen.move(3, 25, 60);
      expect(h.frame().look).toEqual({ x: 5, y: 0 });
    } finally {
      h.dispose();
    }
  });

  it("survives non-sequential and reused touch identifiers", () => {
    const h = harness();
    try {
      h.screen.start(7, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);

      // iOS recycles identifiers aggressively; 7 is the joystick's.
      for (const lookId of [3, 3, 11, 3, 0]) {
        h.screen.start(lookId, 200, 300, h.canvas);
        expect(h.frame().look).toEqual({ x: 0, y: 0 });
        h.screen.move(lookId, 210, 300);
        expect(h.frame()).toMatchObject({ look: { x: 10, y: 0 }, move: FORWARD });
        h.screen.end(lookId);
        expect(h.frame()).toMatchObject({
          look: { x: 0, y: 0 },
          move: FORWARD,
          touchCount: 0,
        });
      }
    } finally {
      h.dispose();
    }
  });

  it("a cancelled look finger releases look ownership and leaves movement alone", () => {
    const h = harness();
    try {
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);

      h.screen.start(2, 300, 400, h.canvas);
      h.frame();
      h.screen.move(2, 330, 400);
      expect(h.frame().look).toEqual({ x: 30, y: 0 });

      h.screen.end(2, "touchcancel");
      expect(h.frame()).toMatchObject({
        look: { x: 0, y: 0 },
        move: FORWARD,
        touchCount: 0,
        isTouching: false,
        lookTouchId: null,
      });

      // And the surface still works afterwards.
      h.screen.start(3, 300, 400, h.canvas);
      h.frame();
      h.screen.move(3, 315, 400);
      expect(h.frame().look).toEqual({ x: 15, y: 0 });
    } finally {
      h.dispose();
    }
  });

  it("ignores a second canvas finger while one already owns look", () => {
    const h = harness();
    try {
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);

      h.screen.start(2, 300, 400, h.canvas);
      h.frame();

      // A stray second contact on the canvas (a resting palm, a passenger).
      h.screen.start(3, 500, 200, h.canvas);
      expect(h.frame()).toMatchObject({
        look: { x: 0, y: 0 },
        touchCount: 2,
        lookTouchId: 2,
      });

      // Only the owner's movement steers the camera.
      h.screen.move(3, 560, 260);
      expect(h.frame().look).toEqual({ x: 0, y: 0 });
      h.screen.move(2, 320, 400);
      expect(h.frame().look).toEqual({ x: 20, y: 0 });

      // When the owner lifts, the stray contact must not silently inherit the
      // camera and fling it by however far it has drifted.
      h.screen.end(2);
      expect(h.frame()).toMatchObject({ look: { x: 0, y: 0 }, lookTouchId: null });
      h.screen.move(3, 600, 300);
      expect(h.frame().look).toEqual({ x: 0, y: 0 });

      // A finger placed after that does own look.
      h.screen.end(3);
      h.screen.start(4, 300, 400, h.canvas);
      h.frame();
      h.screen.move(4, 308, 400);
      expect(h.frame()).toMatchObject({ look: { x: 8, y: 0 }, move: FORWARD });
    } finally {
      h.dispose();
    }
  });

  it("keeps look working when the joystick finger is released first", () => {
    const h = harness();
    try {
      h.screen.start(1, 60, 700, h.joystick);
      h.controlState.touch.setJoystick(FORWARD.x, FORWARD.y);
      h.screen.start(2, 300, 400, h.canvas);
      h.frame();

      // Joystick released mid-swipe; look must carry on untouched.
      h.screen.end(1);
      h.controlState.touch.setJoystick(0, 0);
      h.screen.move(2, 330, 400);
      expect(h.frame()).toMatchObject({
        look: { x: 30, y: 0 },
        move: { x: 0, y: 0 },
        touchCount: 1,
      });

      h.screen.end(2);
      expect(h.frame()).toMatchObject({ touchCount: 0, isTouching: false });
    } finally {
      h.dispose();
    }
  });
});
