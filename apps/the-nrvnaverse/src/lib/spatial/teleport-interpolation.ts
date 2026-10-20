/**
 * Hub-arrival fall fix (M4, docs/NRVNAVERSE_M4_CAMPAIGN.md §2).
 *
 * The engine interpolates the PLAYER rigid body between its previous and current physics pose on
 * every rendered frame. `RapierRigidBody.teleport()` resets the current pose but not the previous
 * one, and the previous pose is only refreshed at the start of a fixed step. The world is staged
 * and the visitor placed while the simulation is stopped, so at the reveal the previous pose is
 * still the avatar's boot position (y ≈ 0) while the current pose is the deck spawn (y = 141).
 * If the first live frame is shorter than one fixed step (1/60 s — any ordinary 60 Hz frame that
 * comes in a little early, and routinely on 90 / 120 Hz displays), no fixed step runs, the render
 * interpolation writes `lerp(0, 141, α)` (≈ 135 at α = 0.96) into the avatar, and the Mover's
 * first update after `reset()` — its ground-sync probe — restores the body to that component
 * position: the visitor is committed below the 0.5 m deck and falls into The City. Reproduced
 * deterministically by forcing the first physics update to 16 ms (4 / 4 falls, y = 135.36).
 *
 * The cure is to make the teleport a true discontinuity: after the official teleport, copy the
 * current pose into the previous one (`_preInterpolate`, the engine's own per-step routine), so
 * any interpolation before the next fixed step can only produce the spawn itself. The engine
 * method is internal API, so it is feature-checked; if a future engine resets the previous pose
 * in `teleport()` itself (upstream candidate), this is a harmless repeat of the same copy.
 */
export interface InterpolatedBody {
  _preInterpolate?: () => void;
}

/** Make the teleport that just happened a discontinuity for render interpolation. Returns whether it applied. */
export function settleTeleportInterpolation(body: InterpolatedBody | null | undefined): boolean {
  if (!body || typeof body._preInterpolate !== "function") return false;
  body._preInterpolate();
  return true;
}
