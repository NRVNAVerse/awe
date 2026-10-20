/**
 * A teleport is a discontinuity for render interpolation.
 *
 * Rigid bodies are rendered at lerp(previous pose, current pose, alpha) between fixed steps. A
 * teleport must reset the previous pose too; otherwise, when no fixed step runs before the next
 * interpolation (a teleport while the simulation is stopped, followed by a first frame shorter than
 * one fixed step), the component is placed between the old and the new position — and anything that
 * reads the component position back (a character controller's ground probe) commits that point.
 */

import { Quaternion, Vector3 } from "three";
import { EngineHeadless } from "../src/engine-headless";

const scene = {
  "mesh-teleport": {
    type: "mesh",
    id: "mesh-teleport",
    kit: "cyber",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    geometry: { type: "box", boxParams: { width: 1, height: 1, depth: 1 } },
    collider: { enabled: true, rigidbodyType: "KINEMATIC", colliderType: "CUBE" },
  },
};

describe("rigid body teleport and render interpolation", () => {
  let engine: EngineHeadless;

  beforeEach(() => {
    engine = EngineHeadless.getInstance();
  });

  afterEach(async () => {
    for (let i = 0; i < 20 && engine.sessionState !== "void"; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it("interpolating right after a teleport (no fixed step in between) yields exactly the teleport target", async () => {
    const { space } = await engine.createSpace({
      runtime: "headless",
      game: { id: "teleport-interpolation", creatorId: "test", editors: ["test"], components: scene },
    });
    const component = space.components.byType("mesh")[0];
    const body = component.rigidBody as unknown as {
      teleport(p: Vector3, q: Quaternion): void;
      _interpolatePose(alpha: number): void;
    };
    expect(body).toBeTruthy();

    // The simulation has not started: no fixed step has run since the body was created at y = 0.
    body.teleport(new Vector3(3, 141, -2), new Quaternion());
    for (const alpha of [0, 0.25, 0.5, 0.96]) {
      body._interpolatePose(alpha);
      expect(component.position.x).toBeCloseTo(3, 6);
      expect(component.position.y).toBeCloseTo(141, 6);
      expect(component.position.z).toBeCloseTo(-2, 6);
    }

    space.destroy();
  });
});
