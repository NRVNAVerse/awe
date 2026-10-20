import {
  Camera,
  Engine,
  type Component3D,
  type Space,
  type EnterSpaceOpts,
  AvatarComponent,
  createInputs,
} from "@oncyberio/engine";
import { FirstPersonCameraRig, Mover, ThirdPersonCameraRig, createMoverAnimStateMachine } from "@oncyberio/engine/controls";
import type { MoverAnimLocomotionState } from "@oncyberio/engine/controls";
import { Euler, Quaternion, Vector3, type Object3D } from "three";
import { cameraPreferences } from "@/lib/camera/camera-preferences";
import { CameraViewController, scaledLook } from "@/lib/camera/camera-view";
import { installCameraDiagnostics } from "@/lib/camera/camera-diagnostics";
import { GAMEPLAY_INPUTS } from "@/lib/input/gameplay-inputs";
import { installInputDiagnostics } from "@/lib/input/input-diagnostics";
import type { ChunkPayload } from "@/lib/spatial/chunk-payload";
import { createComponentBatch } from "@/lib/spatial/component-batch";
import type { SpawnPoint } from "@/lib/spatial/placement-registry";
import { subscribePlayerEnterSensor, subscribePlayerExitSensor, type SensorHost } from "@/lib/spatial/sensor-subscription";
import type { ChunkBatch, ChunkRuntime, SceneStateRuntime, SensorRuntime } from "@/lib/spatial/spatial-runtime";
import { settleTeleportInterpolation, type InterpolatedBody } from "@/lib/spatial/teleport-interpolation";

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
 * - (M1 experience campaign) `onPlayerExitSensor` mirrors the enter seam over the official
 *   `Component3D.onSensorExit`; `hideOnStage` / `setComponentVisible` toggle `Component3D.visible`
 *   (a three.js `Object3D` flag, so the component's subtree stops rendering while its collider
 *   stays), and `schedule` wraps the official `space.schedule`. Still no destination knowledge.
 * - (2B.4A) `dispose()` is asynchronous and idempotent: it destroys the space exactly once and
 *   resolves only after the engine session has settled back to `"void"`, so a replacement
 *   `init()` can never race the old session ("engine already has a session"). The engine offers
 *   no public "session settled" signal; the runtime observes `Engine.sessionState`, which the
 *   upstream destroy handler settles a few microtasks after `space.destroy()`.
 *
 * This file is the only spatial module that imports `@oncyberio/engine` (the input map and the
 * touch-control logic in `src/lib/input/` use `@oncyberio/engine/input` only). It knows nothing
 * about destination ids, gates or chunk selection; the adapter, orchestrator and portal
 * controller own those.
 */

// Input definitions: `@/lib/input/gameplay-inputs` (the starter's set, raw touch look).

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

/**
 * Resolve once `engine.sessionState` is back to `"void"` after `space.destroy()`. Upstream
 * settles the session inside an async destroy handler with no awaited I/O (a few microtask
 * turns today), so this checks on the microtask queue first and then, defensively, on
 * macrotasks with a bound so a shutdown can never hang; if the bound is hit the condition is
 * reported and the promise still resolves (the next `init()` then fails loudly and structurally
 * with "engine already has a session" instead of racing).
 */
async function settleEngineSession(engine: Engine): Promise<void> {
  const MICROTASK_TURNS = 64;
  const MACROTASK_TURNS = 250;
  for (let i = 0; i < MICROTASK_TURNS; i++) {
    if (engine.sessionState === "void") return;
    await Promise.resolve();
  }
  for (let i = 0; i < MACROTASK_TURNS; i++) {
    if (engine.sessionState === "void") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  console.warn(`[awe-spatial-runtime] engine session did not settle after space.destroy() (state "${engine.sessionState}")`);
}

const _spawnPosition = new Vector3();
const _spawnQuaternion = new Quaternion();
const _viewEuler = new Euler(0, 0, 0, "YXZ");
const _viewDirection = new Vector3();

/** First-person eye height as a fraction of the avatar's height (its `getDimensions().y` is the top of the head). */
const EYE_HEIGHT_FRACTION = 0.92;

export interface AweSpatialRuntimeInitOptions {
  /** The global scene JSON (`spatialIndex.globalSceneUrl`, same origin). Required: there is no default scene. */
  sceneUrl: string;
  /** Base URL for asset resolution; "" keeps the app's own `public/`. */
  assetsBaseUrl?: string;
}

export class AweSpatialRuntime implements ChunkRuntime, SensorRuntime, SceneStateRuntime {
  private space: Space | null = null;
  /** Engine components per staged batch. Private: the opaque handle is all callers get. */
  private readonly batches = new Map<ChunkBatch, Component3D[]>();
  /** Components to hide as soon as their chunk is staged (`hideOnStage`), per chunk key. */
  private readonly hiddenOnStage = new Map<string, ReadonlySet<string>>();
  private revealFn: (() => Promise<void>) | null = null;
  private cleanup: (() => void) | null = null;
  private player: AvatarComponent | null = null;

  private inputs: ReturnType<typeof createInputs<typeof GAMEPLAY_INPUTS>> | null = null;
  private cameraRig: ThirdPersonCameraRig | null = null;
  /** M3 first-person rig; exactly one of the two rigs is active (`CameraViewController`). */
  private eyeRig: FirstPersonCameraRig | null = null;
  private cameraView: CameraViewController | null = null;
  private unsubscribeCameraPreferences: (() => void) | null = null;
  private uninstallCameraDiagnostics: (() => void) | null = null;
  private mover: Mover | null = null;
  private animStateMachine: ReturnType<typeof createMoverAnimStateMachine> | null = null;
  private controlsActive = false;
  private revealed = false;
  /** M2 descent cap in metres per second, or null (normal falling). */
  private fallSpeedLimit: number | null = null;
  /** The one disposal promise (`dispose()` is idempotent; the space is destroyed exactly once). */
  private disposal: Promise<void> | null = null;

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
    installInputDiagnostics();

    // M3: the first-person rig is created BEFORE the orbit rig — each rig places the camera on
    // construction, and the orbit's placement (behind the avatar) must be the one that stands.
    this.eyeRig = new FirstPersonCameraRig({ camera: Camera.current, target: player });

    this.cameraRig = new ThirdPersonCameraRig({
      camera: Camera.current,
      target: player,
      distance: 5,
      height: 0,
      collision: true,
      smoothing: 0.15,
      smoothMethod: "orbit",
    });

    // M3: eye level, and the controller that keeps exactly one of the two rigs active. The
    // visitor's stored view applies before the reveal, so the first frame is already right.
    const eyeHeight = player.getDimensions?.().y;
    if (eyeHeight && eyeHeight > 0) this.eyeRig.height = eyeHeight * EYE_HEIGHT_FRACTION;
    this.cameraView = new CameraViewController(this.cameraRig, this.eyeRig, {
      readCameraAngles: () => {
        _viewEuler.setFromQuaternion(Camera.current.quaternion, "YXZ");
        return { yaw: _viewEuler.y, pitch: _viewEuler.x };
      },
      moveCameraBack: (distance) => {
        Camera.current.getWorldDirection(_viewDirection);
        Camera.current.position.addScaledVector(_viewDirection, -distance);
        // From the eye up to the orbit pivot (the top of the avatar, `height: 0` below).
        const top = this.player?.getDimensions?.().y;
        if (top && top > 0 && this.eyeRig) Camera.current.position.y += Math.max(0, top - this.eyeRig.height);
        Camera.current.updateMatrixWorld();
      },
      readFramingYaw: () => {
        // The orbit's reset puts the camera along the avatar's +Z, looking back along −Z:
        // camera forward (−sin yaw, 0, −cos yaw) = −dir  ⇒  yaw = atan2(dir.x, dir.z).
        this.player?.getWorldDirection(_viewDirection);
        return Math.atan2(_viewDirection.x, _viewDirection.z);
      },
      setAvatarVisible: (visible) => {
        if (this.player && this.player.visible !== visible) this.player.visible = visible;
      },
    });
    this.cameraView.setView(cameraPreferences.load().view);
    this.unsubscribeCameraPreferences = cameraPreferences.subscribe(() => this.cameraView?.setView(cameraPreferences.state.view));
    this.uninstallCameraDiagnostics = installCameraDiagnostics(() => this.cameraSnapshot());

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
    this.inputs.ToggleView.onPerformed(() => {
      cameraPreferences.toggleView();
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
    // M4: no render interpolation from the pre-teleport pose (the Hub-arrival fall).
    settleTeleportInterpolation((this.player as unknown as { rigidBody?: InterpolatedBody }).rigidBody);
    this.cameraView?.reset();
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
    // Hidden-on-stage policy BEFORE the batch is handed back (and so before the visitor is
    // teleported into it): state geometry that must start invisible never renders a frame.
    const hidden = this.hiddenOnStage.get(payload.chunkKey);
    if (hidden && hidden.size > 0) {
      for (const component of components) if (hidden.has(component.data.id)) component.visible = false;
    }
    const batch: ChunkBatch = { chunkKey: payload.chunkKey, componentIds: components.map((c) => c.data.id) };
    this.batches.set(batch, components);
    return batch;
  }

  hideOnStage(chunkKey: string, componentIds: readonly string[]): void {
    this.hiddenOnStage.set(chunkKey, new Set(componentIds));
  }

  /** `Component3D` is an `Object3D`: `visible` hides the whole subtree (mesh, text, plugins) while physics is untouched. */
  setComponentVisible(componentId: string, visible: boolean): boolean {
    const component = this.space?.components.byInternalId(componentId) as Component3D | undefined;
    if (!component || component.wasDisposed) return false;
    component.visible = visible;
    return true;
  }

  /** Official `space.schedule` (engine time; paused with the space). The cancel is idempotent and safe after the space is gone. */
  schedule(delaySeconds: number, callback: () => void): () => void {
    const space = this.space;
    if (!space) throw new Error("runtime is not ready");
    const handle = space.schedule(delaySeconds, callback);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      try {
        handle.cancel();
      } catch {
        // The space may already be destroyed; there is nothing left to cancel.
      }
    };
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

  /** Same seam over the official `Component3D.onSensorExit` (M1 experience campaign). */
  onPlayerExitSensor(componentId: string, callback: () => void): () => void {
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
      onSensorExit: (component, listener) => component.onSensorExit((event) => listener(event.other)),
    };
    return subscribePlayerExitSensor(host, componentId, player as Component3D, callback);
  }

  /**
   * M2 descent: cap the visitor's fall speed (metres per second) while falling from the Hub, or
   * `null` to restore normal falling. The official Mover integrates `velocity.y` as a per-step
   * displacement with an effective gravity of ≈108 m/s² (a 130 m drop lasts ≈1.5 s); the cap turns
   * the Drop into a readable skydive. Applied in the fixed update before the Mover moves.
   */
  setFallSpeedLimit(metresPerSecond: number | null): void {
    this.fallSpeedLimit = metresPerSecond !== null && metresPerSecond > 0 ? metresPerSecond : null;
  }

  /** True while the Mover reports the avatar on the ground (M2 descent bookkeeping). */
  get isGrounded(): boolean {
    return this.mover?.grounded ?? false;
  }

  /** The visitor's avatar position in world space (M2 streaming), or null before the runtime is ready. */
  getVisitorPosition(): { x: number; y: number; z: number } | null {
    const player = this.player as unknown as { position?: { x: number; y: number; z: number } } | null;
    const p = player?.position;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  /**
   * Attach an application-owned three.js object to the space (M2 far-field city layer) — the
   * upstream pattern `space.add(object3D)` used by `examples/zombie-survival`. The object is removed
   * by the returned function (idempotent) or with the space. Never a component: no physics, no data.
   */
  attachObject(object: Object3D): () => void {
    const space = this.space;
    if (!space) throw new Error("runtime is not ready");
    space.add(object);
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      object.removeFromParent();
    };
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

  /**
   * Tear the runtime down. Synchronously (before the first await): space hooks removed, batch
   * handles dropped, controls / camera / inputs / animation disposed, `isReady` false, and the
   * space destroyed (exactly once). Then waits for the engine session to settle to `"void"` so
   * the next `init()` cannot observe the old session. Idempotent: repeated calls return the same
   * promise; after it resolved, further calls resolve immediately. Never rejects.
   *
   * The caller (the store) must have settled the chunk orchestrator first: destroying the space
   * while `ComponentManager.create` is still resolving is exactly the race 2B.4A removes.
   */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    const space = this.space;
    this.space = null;

    this.cleanup?.();
    this.cleanup = null;
    // Any batch still held is destroyed with the space below; drop the handles.
    this.batches.clear();
    this.hiddenOnStage.clear();

    this.animStateMachine?.dispose();
    this.animStateMachine = null;
    this.mover?.dispose();
    this.mover = null;
    this.unsubscribeCameraPreferences?.();
    this.unsubscribeCameraPreferences = null;
    this.uninstallCameraDiagnostics?.();
    this.uninstallCameraDiagnostics = null;
    this.cameraView = null;
    this.eyeRig?.dispose();
    this.eyeRig = null;
    this.cameraRig?.dispose();
    this.cameraRig = null;
    this.inputs?.dispose();
    this.inputs = null;

    this.player = null;
    this.revealFn = null;
    this.revealed = false;

    if (space) space.destroy();
    this.disposal = space ? settleEngineSession(Engine.getInstance()) : Promise.resolve();
    return this.disposal;
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
    this.cameraView?.setActive(val);
    if (this.animStateMachine) this.animStateMachine.enabled = val;
  }

  // Fixed timestep: input polling, mover physics, animation state (upstream pattern).
  private onFixedUpdate = (dt: number) => {
    if (!this.controlsActive || !this.inputs || !this.mover) return;

    this.inputs.update(dt);

    const moveDir = this.inputs.Move.readValue();
    const isSprinting = this.inputs.Sprint.isPressed;
    const speed = isSprinting ? SPEED * SPRINT_BOOST : SPEED;

    // M3: per-source look sensitivity (1 = the pre-M3 feel), then the active rig of the current view.
    const look = scaledLook({ pointer: this.inputs.Look.readValue(), touch: this.inputs.TouchLook.readValue() }, cameraPreferences.state);
    const zoomDelta = this.inputs.Zoom.readValue();

    this.cameraView?.rotate(look.x, look.y);
    this.cameraView?.zoom(zoomDelta * 0.1);
    this.mover.move(moveDir.x, moveDir.y, speed);

    if (this.inputs.Jump.wasJustPressed) {
      this.mover.startJump();
    }

    // M2 descent cap (per-step displacement units, see `setFallSpeedLimit`).
    if (this.fallSpeedLimit !== null) {
      const v = this.mover.velocity; // a copy; written back through the official setVelocity
      const floor = -this.fallSpeedLimit * dt;
      if (v.y < floor) {
        v.y = floor;
        this.mover.setVelocity(v);
      }
    }

    this.mover.update(dt);
    this.animStateMachine?.update(dt);
  };

  /** Read-only camera state for diagnostics and the browser probes (`window.__nrvnaverseCamera`). */
  private cameraSnapshot() {
    const camera = Camera.current;
    const player = this.player as unknown as { position?: { x: number; y: number; z: number }; visible?: boolean } | null;
    _viewEuler.setFromQuaternion(camera.quaternion, "YXZ");
    const p = player?.position;
    return {
      view: this.cameraView?.view ?? null,
      active: this.cameraView?.active ?? false,
      avatarVisible: player?.visible ?? null,
      orbitActive: this.cameraRig?.active ?? false,
      eyeActive: this.eyeRig?.active ?? false,
      orbitZoom: this.cameraRig?.currentZoom ?? null,
      yaw: _viewEuler.y,
      pitch: _viewEuler.x,
      camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      avatar: p ? { x: p.x, y: p.y, z: p.z } : null,
    };
  }

  private onSpaceDisposed = () => {
    this.controlsActive = false;
  };
}
