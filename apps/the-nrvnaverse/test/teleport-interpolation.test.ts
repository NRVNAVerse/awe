import { describe, expect, it } from "vitest";
import { settleTeleportInterpolation } from "@/lib/spatial/teleport-interpolation";

/**
 * A faithful model of the engine's PLAYER-body interpolation state (`RapierRigidBody`:
 * `_preInterpolate` copies current → previous at the start of each fixed step, `teleport` resets
 * only the current pose, `_interpolatePose(α)` writes lerp(previous, current, α) into the avatar)
 * and of the physics loop's fixed-step accumulator (`RapierPhysicsEngine.update`).
 */
class ModelBody {
  prev = 0;
  current = 0;
  rendered = 0;
  _preInterpolate() {
    this.prev = this.current;
  }
  teleport(y: number) {
    this.current = y;
    this.rendered = y;
  }
  interpolate(alpha: number) {
    this.rendered = this.prev + (this.current - this.prev) * alpha;
  }
}

const STEP = 1 / 60;

/** One rendered frame of the engine loop: fixed steps while the accumulator allows, then interpolation. */
function frame(body: ModelBody, state: { acc: number }, dt: number) {
  state.acc += dt;
  while (state.acc >= STEP) {
    body._preInterpolate();
    state.acc -= STEP;
  }
  body.interpolate(state.acc / STEP);
}

describe("teleport interpolation (M4 Hub-arrival fall)", () => {
  it("reproduces the fall: a placement teleport while stopped + a first frame shorter than one step renders the avatar below the deck", () => {
    const body = new ModelBody(); // boot pose y = 0, physics never stepped while hidden
    body.teleport(141); // Hub deck spawn
    frame(body, { acc: 0 }, 0.016); // first live frame: 16 ms < 1/60 s → zero fixed steps
    expect(body.rendered).toBeCloseTo(135.36, 2); // the value the browser trace recorded
  });

  it("after settling, any first frame renders exactly the spawn", () => {
    for (const dt of [0, 0.004, 0.008, 0.016, 0.0166, 0.02, 0.1]) {
      const body = new ModelBody();
      body.teleport(141);
      expect(settleTeleportInterpolation(body)).toBe(true);
      frame(body, { acc: 0 }, dt);
      expect(body.rendered).toBe(141);
    }
  });

  it("is a no-op for a body without the engine routine (and for none)", () => {
    expect(settleTeleportInterpolation({})).toBe(false);
    expect(settleTeleportInterpolation(null)).toBe(false);
    expect(settleTeleportInterpolation(undefined)).toBe(false);
  });

  it("the runtime settles right after the official teleport, before the camera is re-seated", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/lib/spatial/awe-spatial-runtime.ts", import.meta.url), "utf8");
    const place = source.slice(source.indexOf("placeVisitor(spawn"), source.indexOf("async stageChunk"));
    const teleport = place.indexOf("this.mover.teleport(");
    const settle = place.indexOf("settleTeleportInterpolation(");
    expect(teleport).toBeGreaterThan(0);
    expect(settle).toBeGreaterThan(teleport);
    expect(place.indexOf("this.cameraView?.reset()")).toBeGreaterThan(settle);
  });
});
