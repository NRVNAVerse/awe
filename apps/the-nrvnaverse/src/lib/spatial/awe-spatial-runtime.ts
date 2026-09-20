import {
  Camera,
  Engine,
  type Component3D,
  type Space,
  type EnterSpaceOpts,
  AvatarComponent,
  createInputs,
  Keyboard,
  Gamepad,
  Mouse,
  Touch,
  Custom,
  Interactions,
  Processors,
  withProcessors,
} from "@oncyberio/engine";
import { Mover, ThirdPersonCameraRig, createMoverAnimStateMachine } from "@oncyberio/engine/controls";
import type { MoverAnimLocomotionState } from "@oncyberio/engine/controls";
import { Quaternion, Vector3 } from "three";
import type { ChunkPayload } from "@/lib/spatial/chunk-payload";
import { createComponentBatch } from "@/lib/spatial/component-batch";
import type { SpawnPoint } from "@/lib/spatial/placement-registry";
import { subscribePlayerEnterSensor, type SensorHost } from "@/lib/spatial/sensor-subscription";
import type { ChunkBatch, ChunkRuntime, SensorRuntime } from "@/lib/spatial/spatial-runtime";

/**
 * Official AWE runtime mount for THE NRVNAVerse (M0 Step 2A; chunk operations added in 2B.2;
 * generic player-enters-sensor seam added in 2B.3).
 *
 * Adapted from `examples/starter/src/lib/game-script.ts` + `utils.ts` (upstream lifecycle:
 * create space → player/controls → camera/mover → reveal → start → dispose). Deviations from the
 * starter, all deliberate:
 *
 * - `init({ sceneUrl })` loads the GLOBAL scene only (`spatialIndex.globalSceneUrl`: avatar,
 *   animations, environment, ground). Destination geometry arrives later as chunk batches; the
 *   compatibility full scene (`static-scene.json`) is never requested by the runtime.
 * - `init()` does NOT reveal. The application reveals (`reveal()`) only after the initial chunk
 *   and destination placement are settled, so the world is never shown at the wrong place.
 * - No "click to start" screen and no pause toggle: the space starts when revealed. Pointer
 *   lock still engages on the first canvas click through the camera rig (upstream Mediator).
 * - Adds `placeVisitor(spawn)` — teleport via the official `Mover.teleport` / rigid-body API
 *   followed by a camera-rig reset. This is the only movement primitive the spatial layer uses.
 * - Adds `stageChunk` / `retireChunk` — thin wrappers over the official
 *   `space.components.create(data, { abort })` and `space.components.destroy(component)`. The
 *   engine `Component3D` handles never leave this file: callers hold an opaque `ChunkBatch`.
 * - Adds `onPlayerEnterSensor(componentId, cb)` — the official `Component3D.onSensorEnter` on a
 *   staged component whose collider is a sensor, filtered to the player's avatar (`event.other`).
 *   Portal-neutral: it knows component ids, not destinations (the `PortalController` does).
 *
 * This file is the only application module that imports `@oncyberio/engine`. It knows nothing
 * about destination ids, gates or chunk selection; the adapter, orchestrator and portal
 * controller own those.
 */

// --- Input definitions (identical to the official starter) ---
const GAMEPLAY_INPUTS = {
  Move: {
    type: "vector2" as const,
    bindings: [Keyboard.wasd(), Keyboard.arrows(), Gamepad.leftStick(), Gamepad.dpad(), Touch.joystick()],
  },
  Look: {
    type: "vector2" as const,
    bindings: [Mouse.pointerLockDelta(), withProcessors(Touch.delta(), Processors.scaleVector2(-1)), Gamepad.rightStick()],
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

// --- Animation clip names (starter set; clips ship in public/assets/anims) ---
const ANIMS = {
  idle: "idle",
  walk: "walk",
  run: "run",
  sprint: "sprint",
  jump_idle: "jump_idle",
  jump_walking: "jump_walking",
  jump_running: "jump_running",
  jump_sprinting: "jump_sprinting",
  jump_double: "jump_double",
  falling: "falling",
  drop_idle: "drop_idle",
  drop_walking: "drop_walking",
  drop_walking_roll: "drop_walking_roll",
  drop_running: "drop_running",
  drop_running_roll: "drop_running_roll",
  drop_sprinting: "drop_sprinting",
  drop_sprinting_roll: "drop_sprinting_roll",
};

function getJumpClip(state: MoverAnimLocomotionState): string {
  switch (state) {
    case "walk":
      return ANIMS.jump_walking;
    case "run":
      return ANIMS.jump_running;
    case "sprint":
      return ANIMS.jump_sprinting;
    default:
      return ANIMS.jump_idle;
  }
}

function getLandingClip(state: MoverAnimLocomotionState, velocityY: number): string {
  const roll = velocityY < -0.6;
  switch (state) {
    case "walk":
      return roll ? ANIMS.drop_walking_roll : ANIMS.drop_walking;
    case "run":
      return roll ? ANIMS.drop_running_roll : ANIMS.drop_running;
    case "sprint":
      return roll ? ANIMS.drop_sprinting_roll : ANIMS.drop_sprinting;
    default:
      return ANIMS.drop_idle;
  }
}

// --- Movement tuning (starter values) ---
const SPEED = 15;
const SPRINT_BOOST = 1.5;

const Y_AXIS = new Vector3(0, 1, 0);
const _spawnPosition = new Vector3();
const _spawnQuaternion = new Quaternion();

export interface AweSpatialRuntimeInitOptions {
  /** The global scene JSON (`spatialIndex.globalSceneUrl`, same origin). Required: there is no default scene. */
  sceneUrl: string;
  /** Base URL for asset resolution; "" keeps the app's own `public/`. */
  assetsBaseUrl?: string;
}

export class AweSpatialRuntime implements ChunkRuntime, SensorRuntime {
  private space: Space | null = null;
  /** Engine components per staged batch. Private: the opaque handle is all callers get. */
  private readonly batches = new Map<ChunkBatch, Component3D[]>();
  private revealFn: (() => Promise<void>) | null = null;
  private cleanup: (() => void) | null = null;
  private player: AvatarComponent | null = null;

  private inputs: ReturnType<typeof createInputs<typeof GAMEPLAY_INPUTS>> | null = null;
  private cameraRig: ThirdPersonCameraRig | null = null;
  private mover: Mover | null = null;
  private animStateMachine: ReturnType<typeof createMoverAnimStateMachine> | null = null;
  private controlsActive = false;
  private revealed = false;

  get isReady(): boolean {
    return this.space !== null && this.player !== null && this.mover !== null;
  }

  get isRevealed(): boolean {
    return this.revealed;
  }

  /** Create the space and wire the official controls. Resolves when the space is fully loaded (hidden). */
  async init(options: AweSpatialRuntimeInitOptions): Promise<void> {
    const sceneUrl = options.sceneUrl;
    if (typeof sceneUrl !== "string" || sceneUrl.length === 0) throw new Error("runtime init requires the global scene url");
    const baseUrl = options.assetsBaseUrl ?? "";

    const res = await fetch(sceneUrl, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`scene request failed: ${res.status} ${res.statusText}`);
    const game = (await res.json()) as EnterSpaceOpts["game"];

    const engine = Engine.getInstance();
    if (engine.sessionState !== "void") {
      throw new Error(`engine already has a session (${engine.sessionState}); dispose it before mounting again`);
    }

    const result = await engine.createSpace({
      mode: "game",
      game,
      assets: { baseUrl },
      userReady: Promise.resolve({ id: "visitor", name: "Visitor" }),
    });
    if (!result) throw new Error("space creation was aborted");

    const space = result.space;
    this.space = space;
    this.revealFn = result.reveal;

    const player = space.components.byId("player") as AvatarComponent | undefined;
    if (!player) throw new Error('scene has no avatar with script.identifier "player"');
    this.player = player;

    this.inputs = createInputs(GAMEPLAY_INPUTS);

    this.cameraRig = new ThirdPersonCameraRig({
      camera: Camera.current,
      target: player,
      distance: 5,
      height: 0,
      collision: true,
      smoothing: 0.15,
      smoothMethod: "orbit",
    });

    this.mover = new Mover({
      body: player,
      target: Camera.current,
      movement: {
        speed: SPEED,
        gravity: -1.81,
        acceleration: 100,
        deceleration: 50,
        airControl: 1,
        facingMode: "movement",
      },
      jump: {
        height: 5,
        duration: 1,
        maxJumps: 2,
        coyoteTime: Infinity,
        maxFallSpeed: 20,
      },
    });

    this.animStateMachine = createMoverAnimStateMachine({
      body: player,
      mover: this.mover,
      defaultBlendTime: 0.1,
      locomotionClips: { idle: ANIMS.idle, walk: ANIMS.walk, run: ANIMS.run, sprint: ANIMS.sprint },
      locomotionThresholds: { walk: 10, sprint: SPEED * SPRINT_BOOST },
      jump: {
        clip: (ctx) => getJumpClip(ctx.jumpTakeoffState),
        toFallWhen: (ctx) => ctx.finished && !ctx.mover.grounded,
      },
      doubleJump: { clip: ANIMS.jump_double },
      fall: { clip: ANIMS.falling },
      landing: { clip: (ctx) => getLandingClip(ctx.jumpTakeoffState, ctx.landingVelocityY) },
    });

    this.inputs.Jump.onPerformed(() => {
      this.mover?.startJump();
    });

    // Controls stay off until the world is revealed.
    this.setActive(false);

    this.cleanup = space.use({
      onFixedUpdate: this.onFixedUpdate,
      onDispose: this.onSpaceDisposed,
    });
  }

  /**
   * Teleport. Uses the official Mover → rigid-body teleport (clears velocity) and re-seats the
   * third-person camera behind the avatar so the new place is framed immediately.
   */
  placeVisitor(spawn: SpawnPoint): void {
    if (!this.mover || !this.player) throw new Error("runtime is not ready");
    _spawnPosition.set(spawn.position.x, spawn.position.y, spawn.position.z);
    _spawnQuaternion.setFromAxisAngle(Y_AXIS, spawn.yaw);
    this.mover.teleport(_spawnPosition, _spawnQuaternion);
    this.cameraRig?.reset();
  }

  /**
   * Instantiate every component of a validated chunk payload through the official
   * `ComponentManager.create` (with its `abort` signal). All-or-nothing: `createComponentBatch`
   * destroys whatever was created if any creation fails or the signal fires, then rejects.
   * Whatever chunk is already loaded is untouched.
   */
  async stageChunk(payload: ChunkPayload, signal: AbortSignal): Promise<ChunkBatch> {
    const space = this.space;
    if (!space) throw new Error("runtime is not ready");
    const records = Object.values(payload.components);
    const components = await createComponentBatch<Component3D>(
      records,
      {
        create: (record, abort) => space.components.create(record as Parameters<typeof space.components.create>[0], { abort }),
        destroy: (component) => {
          space.components.destroy(component);
        },
      },
      signal,
    );
    const batch: ChunkBatch = { chunkKey: payload.chunkKey, componentIds: components.map((c) => c.data.id) };
    this.batches.set(batch, components);
    return batch;
  }

  /**
   * Destroy every component of a staged batch via the official `ComponentManager.destroy`.
   * Unknown / already retired batches are a no-op. Throws only after attempting every component.
   */
  retireChunk(batch: ChunkBatch): void {
    const components = this.batches.get(batch);
    if (!components) return;
    this.batches.delete(batch);
    const space = this.space;
    if (!space) return; // space already destroyed → components are gone with it
    let failures = 0;
    for (const component of components) {
      try {
        if (!component.wasDisposed) space.components.destroy(component);
      } catch (err) {
        failures++;
        console.warn(`[awe-spatial-runtime] failed to destroy component "${component.data?.id}" of chunk "${batch.chunkKey}"`, err);
      }
    }
    if (failures > 0) throw new Error(`${failures} of ${components.length} components of chunk "${batch.chunkKey}" could not be destroyed`);
  }

  /**
   * Player-enters-sensor subscription over the official APIs: `ComponentManager.byInternalId`
   * resolves the staged component by its data id, `Collider.isSensor` confirms the sensor, and
   * `Component3D.onSensorEnter` delivers the intersection whose `other` must be the player avatar.
   * The unsubscribe is idempotent and safe after the component was retired with its chunk.
   */
  onPlayerEnterSensor(componentId: string, callback: () => void): () => void {
    const space = this.space;
    const player = this.player;
    if (!space || !player) throw new Error("runtime is not ready");
    const host: SensorHost<Component3D> = {
      resolve: (id) => {
        const component = space.components.byInternalId(id) as Component3D | undefined;
        return component && !component.wasDisposed ? component : undefined;
      },
      isSensor: (component) => component.collider?.isSensor === true,
      onSensorEnter: (component, listener) => component.onSensorEnter((event) => listener(event.other)),
    };
    return subscribePlayerEnterSensor(host, componentId, player as Component3D, callback);
  }

  /** Diagnostics/tests: number of chunk batches this runtime currently holds. */
  get stagedBatchCount(): number {
    return this.batches.size;
  }

  /** Fade the intro out and start the simulation with controls enabled. Idempotent. */
  async reveal(): Promise<void> {
    if (!this.space || this.revealed) return;
    this.revealed = true;
    await this.revealFn?.();
    this.setActive(true);
    this.space.start();
  }

  dispose(): void {
    this.cleanup?.();
    this.cleanup = null;
    // Any batch still held is destroyed with the space below; drop the handles.
    this.batches.clear();

    this.animStateMachine?.dispose();
    this.animStateMachine = null;
    this.mover?.dispose();
    this.mover = null;
    this.cameraRig?.dispose();
    this.cameraRig = null;
    this.inputs?.dispose();
    this.inputs = null;

    this.player = null;
    this.revealFn = null;
    this.revealed = false;

    this.space?.destroy();
    this.space = null;
  }

  private setActive(val: boolean) {
    this.controlsActive = val;
    if (val) {
      this.inputs?.enable();
      this.mover?.reset();
      this.animStateMachine?.forceState("idle");
    } else {
      this.inputs?.disable();
      this.animStateMachine?.forceState("idle");
    }
    if (this.cameraRig) this.cameraRig.active = val;
    if (this.animStateMachine) this.animStateMachine.enabled = val;
  }

  // Fixed timestep: input polling, mover physics, animation state (upstream pattern).
  private onFixedUpdate = (dt: number) => {
    if (!this.controlsActive || !this.inputs || !this.mover) return;

    this.inputs.update(dt);

    const moveDir = this.inputs.Move.readValue();
    const isSprinting = this.inputs.Sprint.isPressed;
    const speed = isSprinting ? SPEED * SPRINT_BOOST : SPEED;

    const lookDelta = this.inputs.Look.readValue();
    const zoomDelta = this.inputs.Zoom.readValue();

    this.cameraRig?.rotate(lookDelta.x, lookDelta.y);
    this.cameraRig?.zoom(zoomDelta * 0.1);
    this.mover.move(moveDir.x, moveDir.y, speed);

    if (this.inputs.Jump.wasJustPressed) {
      this.mover.startJump();
    }

    this.mover.update(dt);
    this.animStateMachine?.update(dt);
  };

  private onSpaceDisposed = () => {
    this.controlsActive = false;
  };
}
