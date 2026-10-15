/**
 * Pure "player entered a sensor" subscription (M0 Step 2B.3). Engine-agnostic so it can be unit
 * tested without the AWE engine: the real runtime (`awe-spatial-runtime.ts`) binds it to the
 * official `ComponentManager.byInternalId`, `Collider.isSensor` and `Component3D.onSensorEnter`;
 * the test fake binds it to an in-memory world. Either way the contract is this one:
 *
 * - the component must currently exist and must carry a sensor collider (clear errors otherwise);
 * - the callback fires only when the intersecting `other` component IS the player;
 * - SENSOR ENTER only — one physical entry, one callback (no stay, no timer);
 * - the returned unsubscribe is idempotent and never throws, even after the component (and its
 *   emitter / rigid body) has been disposed with its chunk.
 *
 * The M1 experience campaign adds the mirror image, `subscribePlayerExitSensor` (official
 * `Component3D.onSensorExit`): same contract, SENSOR EXIT only. Enter and exit subscriptions are
 * independent; an experience zone binds one of each.
 */
export interface SensorHost<C> {
  /** Resolve a currently staged component by its data id, or `undefined`. */
  resolve(componentId: string): C | undefined;
  /** True when the component carries an enabled sensor collider. */
  isSensor(component: C): boolean;
  /** Subscribe to the component's sensor-enter events; the listener receives the `other` component. Returns the engine's unsubscribe. */
  onSensorEnter(component: C, listener: (other: C) => void): () => void;
  /** Subscribe to the component's sensor-exit events (same shape). Optional for hosts that only need enter. */
  onSensorExit?(component: C, listener: (other: C) => void): () => void;
}

export function subscribePlayerEnterSensor<C>(host: SensorHost<C>, componentId: string, player: C, callback: () => void): () => void {
  return subscribePlayerSensor(host, componentId, player, callback, "enter");
}

export function subscribePlayerExitSensor<C>(host: SensorHost<C>, componentId: string, player: C, callback: () => void): () => void {
  return subscribePlayerSensor(host, componentId, player, callback, "exit");
}

function subscribePlayerSensor<C>(host: SensorHost<C>, componentId: string, player: C, callback: () => void, edge: "enter" | "exit"): () => void {
  const component = host.resolve(componentId);
  if (component === undefined) throw new Error(`sensor component "${componentId}" is not staged`);
  if (!host.isSensor(component)) throw new Error(`component "${componentId}" has no sensor collider`);
  if (edge === "exit" && typeof host.onSensorExit !== "function") throw new Error("this sensor host does not deliver sensor-exit events");

  const listener = (other: C) => {
    if (other === player) callback();
  };
  const off = edge === "enter" ? host.onSensorEnter(component, listener) : host.onSensorExit!(component, listener);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    try {
      off();
    } catch {
      // The component may already be disposed with its chunk; there is nothing left to unsubscribe from.
    }
  };
}
