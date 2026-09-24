import { Custom, Gamepad, Interactions, Keyboard, Mouse, Touch } from "@oncyberio/engine/input";

/**
 * Gameplay input map for the AWE runtime (the official starter's set).
 *
 * Look bindings are raw: the engine's camera rigs read +x as "look right" and +y as "look down" on
 * every device class, which is exactly what mouse and touch screen deltas already are. The
 * `scaleVector2(-1)` the starter used to put on `Touch.delta()` compensated for a rig flip that only
 * happened on UA-detected mobile devices; with that flip gone from the engine, keeping the
 * compensation would invert touch look everywhere (post-M0 input hardening).
 */
export const GAMEPLAY_INPUTS = {
  Move: {
    type: "vector2" as const,
    bindings: [Keyboard.wasd(), Keyboard.arrows(), Gamepad.leftStick(), Gamepad.dpad(), Touch.joystick()],
  },
  Look: {
    type: "vector2" as const,
    bindings: [Mouse.pointerLockDelta(), Touch.delta(), Gamepad.rightStick()],
  },
  Zoom: {
    type: "value" as const,
    bindings: [Mouse.wheel()],
  },
  Jump: {
    type: "button" as const,
    bindings: [Keyboard.button("Space"), Gamepad.button("A"), Custom.button("jump")],
    interactions: [Interactions.press()],
  },
  Sprint: {
    type: "button" as const,
    bindings: [Keyboard.button("ShiftLeft"), Keyboard.button("ShiftRight"), Gamepad.button("LB")],
  },
} as const;
