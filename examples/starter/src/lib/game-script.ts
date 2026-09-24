import {
  Camera,
  type Space,
  AvatarComponent,
  createInputs,
  Keyboard,
  Gamepad,
  Mouse,
  Touch,
  Custom,
  Interactions,
} from "@oncyberio/engine";
import {
  Mover,
  ThirdPersonCameraRig,
  createMoverAnimStateMachine,
} from "@oncyberio/engine/controls";
import type { MoverAnimLocomotionState } from "@oncyberio/engine/controls";
import { createGame } from "@/lib/utils";
import { gameStore, setStarted, setPaused } from "@/lib/game-store";

// --- Input definitions ---
const GAMEPLAY_INPUTS = {
  Move: {
    type: "vector2" as const,
    bindings: [
      Keyboard.wasd(),
      Keyboard.arrows(),
      Gamepad.leftStick(),
      Gamepad.dpad(),
      Touch.joystick(),
    ],
  },
  Look: {
    type: "vector2" as const,
    bindings: [
      Mouse.pointerLockDelta(),
      Touch.delta(),
      Gamepad.rightStick(),
    ],
  },
  Zoom: {
    type: "value" as const,
    bindings: [Mouse.wheel()],
  },
  Jump: {
    type: "button" as const,
    bindings: [
      Keyboard.button("Space"),
      Gamepad.button("A"),
      Custom.button("jump"),
    ],
    interactions: [Interactions.press()],
  },
  Sprint: {
    type: "button" as const,
    bindings: [
      Keyboard.button("ShiftLeft"),
      Keyboard.button("ShiftRight"),
      Gamepad.button("LB"),
    ],
  },
} as const;

// --- Animation clip names ---
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

function getLandingClip(
  state: MoverAnimLocomotionState,
  velocityY: number,
): string {
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

// --- Movement tuning ---
const SPEED = 15;
const SPRINT_BOOST = 1.5;

// Module-level reference for external control
let scriptInstance: GameScript | null = null;

export function startGame() {
  scriptInstance?.start();
}

export function togglePause() {
  scriptInstance?.togglePause();
}

export class GameScript {
  private space: Space | null = null;
  private cleanup: (() => void) | null = null;
  private _player: AvatarComponent | null = null;

  // Control primitives
  private inputs: ReturnType<typeof createInputs<typeof GAMEPLAY_INPUTS>> | null = null;
  private cameraRig: ThirdPersonCameraRig | null = null;
  private mover: Mover | null = null;
  private animStateMachine: ReturnType<typeof createMoverAnimStateMachine> | null = null;
  private controlsActive = false;

  /**
   * Initialize the game scene.
   * Returns when space is fully loaded and ready.
   */
  async init() {
    scriptInstance = this;

    // Create space - returns when fully loaded
    const { space, reveal } = await createGame({ baseUrl: "" });
    this.space = space;

    // Components are immediately available after await
    this._player = this.space.components.byId("player") as AvatarComponent;

    if (!this._player) {
      console.warn("[Game] Player avatar not found");
      return;
    }

    // Input system
    this.inputs = createInputs(GAMEPLAY_INPUTS);

    // Camera rig
    this.cameraRig = new ThirdPersonCameraRig({
      camera: Camera.current,
      target: this._player,
      distance: 5,
      height: 0,
      collision: true,
      smoothing: 0.15,
      smoothMethod: "orbit",
    });

    // Mover
    this.mover = new Mover({
      body: this._player,
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

    // Animation state machine
    this.animStateMachine = createMoverAnimStateMachine({
      body: this._player,
      mover: this.mover,
      defaultBlendTime: 0.1,
      locomotionClips: {
        idle: ANIMS.idle,
        walk: ANIMS.walk,
        run: ANIMS.run,
        sprint: ANIMS.sprint,
      },
      locomotionThresholds: { walk: 10, sprint: SPEED * SPRINT_BOOST },
      jump: {
        clip: (ctx) => getJumpClip(ctx.jumpTakeoffState),
        toFallWhen: (ctx) => ctx.finished && !ctx.mover.grounded,
      },
      doubleJump: { clip: ANIMS.jump_double },
      fall: { clip: ANIMS.falling },
      landing: {
        clip: (ctx) =>
          getLandingClip(ctx.jumpTakeoffState, ctx.landingVelocityY),
      },
    });

    // Wire jump input
    this.inputs.Jump.onPerformed(() => {
      this.mover?.startJump();
    });

    // Wait for user to start
    this.setActive(false);

    // Reveal the scene now that camera and controls are set up
    await reveal();

    // Reset store state
    gameStore.update({
      started: false,
      paused: false,
    });

    // Register space event handlers
    this.cleanup = this.space.use({
      onFixedUpdate: this.onFixedUpdate,
      onUpdate: this.onUpdate,
      onDispose: this.onDispose,
    });
  }

  dispose() {
    // Clean up space event handlers
    this.cleanup?.();
    this.cleanup = null;

    this.animStateMachine?.dispose();
    this.animStateMachine = null;
    this.mover?.dispose();
    this.mover = null;
    this.cameraRig?.dispose();
    this.cameraRig = null;
    this.inputs?.dispose();
    this.inputs = null;

    // Destroy the space
    this.space?.destroy();
    this.space = null;
    scriptInstance = null;
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

  start() {
    if (!this.space) return;

    this.setActive(true);
    setStarted(true);
    this.space.start();
  }

  togglePause() {
    if (!this.space) return;

    const currentPaused = gameStore.state.paused;

    if (currentPaused) {
      // Resume
      this.setActive(true);
      this.space.start();
      setPaused(false);
    } else {
      // Pause
      this.setActive(false);
      this.space.stop();
      setPaused(true);
    }
  }

  // Called on fixed timestep for physics (via space.use)
  onFixedUpdate = (dt: number) => {
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

  // Called every frame when game is running (via space.use)
  onUpdate = (dt: number) => {
    // Game update logic can go here
  };

  onDispose = () => {
    console.log("[Game] Game disposed");
  };
}
