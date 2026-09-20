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
 */
export interface SensorHost<C> {
  /** Resolve a currently staged component by its data id, or `undefined`. */
  resolve(componentId: string): C | undefined;
  /** True when the component carries an enabled sensor collider. */
  isSensor(component: C): boolean;
  /** Subscribe to the component's sensor-enter events; the listener receives the `other` component. Returns the engine's unsubscribe. */
  onSensorEnter(component: C, listener: (other: C) => void): () => void;
}

export function subscribePlayerEnterSensor<C>(host: SensorHost<C>, componentId: string, player: C, callback: () => void): () => void {
  const component = host.resolve(componentId);
  if (component === undefined) throw new Error(`sensor component "${componentId}" is not staged`);
  if (!host.isSensor(component)) throw new Error(`component "${componentId}" has no sensor collider`);

  const off = host.onSensorEnter(component, (other) => {
    if (other === player) callback();
  });

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
