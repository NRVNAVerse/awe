/**
 * The joystick half of the mobile multitouch bug.
 *
 * The starter's `TouchJoystick` writes `pointerIdRef.current` on every
 * `pointerdown` it receives, so a *second* contact on the stick silently takes
 * it over — and because touch gives the element implicit capture, that
 * contact keeps steering the stick as it drags away across the screen. A
 * camera-look finger that clips the stick on its way past therefore drives
 * the player. `VirtualJoystick` refuses the second pointer instead.
 *
 * The response numbers below are the ones the starter's joystick ships
 * (`examples/starter/src/components/touch-joystick.tsx`); they are pinned here
 * so adopting the primitive cannot quietly change how walking feels.
 */
import { describe, expect, it } from "vitest";

import { VirtualJoystick } from "../../src/input/virtual-joystick";

/** A 112 px stick in the bottom-left corner, thumb 40 px: the starter's default. */
const GEOMETRY = { centerX: 70, centerY: 700, radius: 36 };

function stick() {
  const joystick = new VirtualJoystick();
  joystick.setGeometry(GEOMETRY);
  return joystick;
}

/** Push `fraction` of the way to the rim, straight up the screen. */
function up(fraction: number) {
  return { x: GEOMETRY.centerX, y: GEOMETRY.centerY - GEOMETRY.radius * fraction };
}

describe("VirtualJoystick — pointer ownership", () => {
  it("is neutral and unowned until something presses it", () => {
    const joystick = stick();
    expect(joystick.pointerId).toBeNull();
    expect(joystick.isHeld).toBe(false);
    expect(joystick.vector).toEqual({ x: 0, y: 0 });
  });

  it("gives the stick to the first pointer and refuses every other one", () => {
    const joystick = stick();

    expect(joystick.press(1, up(1).x, up(1).y)).toBe(true);
    expect(joystick.pointerId).toBe(1);
    const held = joystick.vector;
    expect(held.y).toBeCloseTo(1, 6);

    // The camera finger grazes the stick. It must be refused outright.
    expect(joystick.press(2, GEOMETRY.centerX + GEOMETRY.radius, GEOMETRY.centerY)).toBe(
      false,
    );
    expect(joystick.pointerId).toBe(1);
    expect(joystick.vector).toEqual(held);
  });

  it("ignores moves from a pointer that does not own it", () => {
    const joystick = stick();
    joystick.press(1, up(1).x, up(1).y);
    const held = joystick.vector;

    // Touch gives the element implicit capture, so a stray contact's moves
    // keep arriving here long after it has dragged away.
    expect(joystick.move(2, 400, 120)).toBe(false);
    expect(joystick.vector).toEqual(held);

    expect(joystick.move(1, up(0.5).x, up(0.5).y)).toBe(true);
    expect(joystick.vector.y).toBeGreaterThan(0);
    expect(joystick.vector.y).toBeLessThan(held.y);
  });

  it("ignores a release from a pointer that does not own it", () => {
    const joystick = stick();
    joystick.press(1, up(1).x, up(1).y);

    expect(joystick.release(2)).toBe(false);
    expect(joystick.isHeld).toBe(true);
    expect(joystick.vector.y).toBeCloseTo(1, 6);

    expect(joystick.release(1)).toBe(true);
    expect(joystick.isHeld).toBe(false);
    expect(joystick.vector).toEqual({ x: 0, y: 0 });
  });

  it("frees the stick on cancel, and hands it to the next pointer that asks", () => {
    const joystick = stick();
    joystick.press(1, up(1).x, up(1).y);

    expect(joystick.cancel(2)).toBe(false);
    expect(joystick.cancel(1)).toBe(true);
    expect(joystick.vector).toEqual({ x: 0, y: 0 });

    expect(joystick.press(2, up(1).x, up(1).y)).toBe(true);
    expect(joystick.pointerId).toBe(2);
    expect(joystick.vector.y).toBeCloseTo(1, 6);
  });

  it("survives a lift-and-replace cycle without drift", () => {
    const joystick = stick();
    for (let pointerId = 1; pointerId <= 6; pointerId++) {
      joystick.press(pointerId, up(1).x, up(1).y);
      expect(joystick.vector.y).toBeCloseTo(1, 6);
      joystick.release(pointerId);
      expect(joystick.vector).toEqual({ x: 0, y: 0 });
      expect(joystick.thumb).toEqual({ x: 0, y: 0 });
    }
  });

  it("keeps the owner in control through a full press / move / release by another pointer", () => {
    const joystick = stick();
    joystick.press(1, up(1).x, up(1).y);

    expect(joystick.press(2, 400, 120)).toBe(false);
    expect(joystick.move(2, 420, 140)).toBe(false);
    expect(joystick.release(2)).toBe(false);
    expect(joystick.cancel(2)).toBe(false);

    expect(joystick.pointerId).toBe(1);
    expect(joystick.vector.y).toBeCloseTo(1, 6);
    expect(joystick.thumb.y).toBeCloseTo(-1, 6);

    // The owner still steers.
    expect(joystick.move(1, up(0.63).x, up(0.63).y)).toBe(true);
    expect(joystick.vector.y).toBeCloseTo(((0.63 - 0.26) / 0.74) ** 1.75, 6);
  });

  it("does not queue a refused pointer as the next owner", () => {
    const joystick = stick();
    joystick.press(1, up(1).x, up(1).y);
    expect(joystick.press(2, up(1).x, up(1).y)).toBe(false);

    joystick.release(1);
    expect(joystick.pointerId).toBeNull();
    expect(joystick.vector).toEqual({ x: 0, y: 0 });

    // Pointer 2's earlier refused press left nothing behind: its moves do nothing.
    expect(joystick.move(2, up(1).x, up(1).y)).toBe(false);
    expect(joystick.vector).toEqual({ x: 0, y: 0 });
  });

  it("re-pressing with the same pointer id is not treated as a steal", () => {
    const joystick = stick();
    joystick.press(1, up(1).x, up(1).y);
    expect(joystick.press(1, up(0.5).x, up(0.5).y)).toBe(true);
    expect(joystick.pointerId).toBe(1);
  });
});

describe("VirtualJoystick — response, as shipped", () => {
  it("reads neutral inside the 0.26 deadzone and lives just outside it", () => {
    const joystick = stick();
    joystick.press(1, up(0.25).x, up(0.25).y);
    expect(joystick.vector).toEqual({ x: 0, y: 0 });
    expect(joystick.thumb).toEqual({ x: 0, y: 0 });

    joystick.move(1, up(0.3).x, up(0.3).y);
    expect(joystick.vector.y).toBeGreaterThan(0);
  });

  it("applies the 1.75 response curve past the deadzone", () => {
    const joystick = stick();
    joystick.press(1, up(0.63).x, up(0.63).y);
    // Halfway past the deadzone: ((0.63 - 0.26) / 0.74) ** 1.75 = 0.2953…
    expect(joystick.vector.y).toBeCloseTo(((0.63 - 0.26) / 0.74) ** 1.75, 6);
  });

  it("clamps at the rim, however far past it the finger goes", () => {
    const joystick = stick();
    joystick.press(1, up(4).x, up(4).y);
    expect(joystick.vector.y).toBeCloseTo(1, 6);
    expect(joystick.thumb.y).toBeCloseTo(-1, 6);
  });

  it("reports forward as +y for the engine and -y for the thumb", () => {
    const joystick = stick();
    joystick.press(1, up(1).x, up(1).y);
    // Screen y grows downward; the movement vector does not.
    expect(joystick.vector.y).toBeCloseTo(1, 6);
    expect(joystick.thumb.y).toBeCloseTo(-1, 6);
  });

  it("snaps a near-cardinal push onto its axis without losing magnitude", () => {
    const joystick = stick();
    // 15 degrees off straight-up: minor/major = 0.27, inside the 0.35 ratio.
    const angle = (Math.PI / 180) * 15;
    joystick.press(
      1,
      GEOMETRY.centerX + Math.sin(angle) * GEOMETRY.radius,
      GEOMETRY.centerY - Math.cos(angle) * GEOMETRY.radius,
    );
    expect(joystick.vector.x).toBe(0);
    expect(joystick.vector.y).toBeCloseTo(1, 6);
  });

  it("leaves a diagonal push diagonal", () => {
    const joystick = stick();
    const d = GEOMETRY.radius / Math.SQRT2;
    joystick.press(1, GEOMETRY.centerX + d, GEOMETRY.centerY - d);
    expect(joystick.vector.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(joystick.vector.y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("reads neutral rather than NaN when it has no geometry", () => {
    const joystick = new VirtualJoystick();
    expect(joystick.press(1, 300, 300)).toBe(true);
    expect(joystick.vector).toEqual({ x: 0, y: 0 });

    joystick.setGeometry({ centerX: 300, centerY: 300, radius: 0 });
    joystick.move(1, 340, 300);
    expect(joystick.vector).toEqual({ x: 0, y: 0 });
  });
});
