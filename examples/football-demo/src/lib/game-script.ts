import {
  Camera,
  type Space,
  type AvatarComponent,
  type Component3D,
  type SpaceScheduleHandle,
  createInputs,
  Keyboard,
  Gamepad,
  Mouse,
  Touch,
  Interactions,
} from "@oncyberio/engine";
import {
  Mover,
  ThirdPersonCameraRig,
  AnimationStateMachine,
} from "@oncyberio/engine/controls";
import { createGame } from "@/lib/utils";
import { updateAI as runAIBrain, type AIConfig } from "@/lib/ai-brain";
import {
  gameStore,
  setStarted,
  setScore,
  setGameOver,
  setGoalScored,
  clearGoalScored,
  setWaitingForKickoff,
  resetGame,
} from "@/lib/game-store";
import { Vector3, Quaternion } from "three";

// --- Tuning constants ---
const KICK_FORCE = 10;
const KICK_RANGE = 3;
const AI_SPEED = 8;
const AI_KICK_FORCE = 9;
const AI_KICK_RANGE = 2.5;
const AI_KICK_COOLDOWN = 0.8;
const GOALS_TO_WIN = 3;
const AI_PLAYER_SEPARATION = 1.5; // minimum distance between AI and player
const GOAL_HALF_WIDTH = 1.8; // half-width of goal opening (posts ~3.6m apart)
const PLAYER_SPEED = 12;

// Field bounds for AI clamping — extend beyond the visible pitch lines so the
// AI can chase the ball into goal areas (goals at Z ±25) and slightly past the
// sidelines.  Without the buffer the AI gets clamped at the edge and appears
// idle when the ball is in or near the goal zone.
const FIELD_X_MIN = -16;
const FIELD_X_MAX = 16;
const FIELD_Z_MIN = -26;
const FIELD_Z_MAX = 26;

// Reusable objects
const _zeroQuat = new Quaternion();
const _playerFacingBallQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const _ballResetPos = new Vector3(0, 1, 0);
const _playerResetPos = new Vector3(0, 0, -10);

// --- Input definitions (no jump) ---
const MOVE_INPUTS = {
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
  Kick: {
    type: "button" as const,
    bindings: [Keyboard.button("KeyE"), Gamepad.button("X")],
    interactions: [Interactions.press()],
  },
} as const;

let scriptInstance: GameScript | null = null;

export function startGame() {
  scriptInstance?.start();
}

export function restartMatch() {
  scriptInstance?.restart();
}

export function kickoff() {
  scriptInstance?.resumeFromKickoff();
}

export class GameScript {
  private space: Space | null = null;
  private cleanup: (() => void) | null = null;

  // Control primitives
  private inputs: ReturnType<typeof createInputs<typeof MOVE_INPUTS>> | null = null;
  private mover: Mover | null = null;
  private cameraRig: ThirdPersonCameraRig | null = null;
  private playerAnimMachine: AnimationStateMachine<{ speed: number }> | null = null;
  private controlsActive = false;

  private player: AvatarComponent | null = null;
  private aiPlayer: AvatarComponent | null = null;
  private ball: Component3D | null = null;
  private goalSensorP: Component3D | null = null;
  private goalSensorA: Component3D | null = null;

  private playerScore = 0;
  private aiScore = 0;
  private isResetting = false;
  private aiKickCooldown = 0;
  private aiWasMoving = false;
  private aiHadBallControl = false;
  private goalResetTask: SpaceScheduleHandle | null = null;
  private aiAnimMachine: AnimationStateMachine<{ speed: number; hasBallControl: boolean }> | null = null;
  private _shiftLockHandler: ((e: KeyboardEvent) => void) | null = null;
  private _shiftLockActive = false;

  // Reusable vectors to avoid GC
  private _tmpVec = new Vector3();
  private _tmpVec3 = new Vector3();

  async init() {
    scriptInstance = this;

    const { space, reveal } = await createGame({ baseUrl: "" });
    this.space = space;

    // Get components
    this.player = space.components.byId("player") as AvatarComponent;
    this.aiPlayer = space.components.byId("ai-player") as AvatarComponent;
    this.ball = space.components.byId("ball");
    this.goalSensorP = space.components.byId("goal-sensor-p");
    this.goalSensorA = space.components.byId("goal-sensor-a");

    if (!this.player) {
      console.warn("[Football] Player avatar not found");
      return;
    }

    // --- Setup controls from primitives ---
    this.inputs = createInputs(MOVE_INPUTS);

    this.cameraRig = new ThirdPersonCameraRig({
      camera: Camera.current,
      target: this.player,
      distance: 12,
      height: 8,
      collision: false,
    });
    // Lock camera rotation by default; Shift toggles shift-lock
    this.cameraRig.setLockAxis({ x: true, y: true });
    this._shiftLockHandler = (e: KeyboardEvent) => {
      if (e.key === "Shift" && e.type === "keydown") {
        this._shiftLockActive = !this._shiftLockActive;
        this.cameraRig?.setLockAxis({
          x: !this._shiftLockActive,
          y: !this._shiftLockActive,
        });
        if (this.mover) {
          this.mover.facingMode = this._shiftLockActive ? "target" : "movement";
        }
      }
    };
    window.addEventListener("keydown", this._shiftLockHandler);

    this.mover = new Mover({
      body: this.player,
      target: Camera.current,
      movement: { speed: PLAYER_SPEED, gravity: -9.81, facingMode: "movement" },
      // Minimal jump config — effectively disabled
      jump: { height: 0, maxJumps: 0, duration: 0.01, coyoteTime: 0, maxFallSpeed: 20 },
    });

    // Player locomotion animation (ground only: idle/walk/run/sprint)
    this.playerAnimMachine = new AnimationStateMachine<{ speed: number }>({
      body: this.player,
      initial: "idle",
      context: { speed: 0 },
      defaultBlendTime: 0.15,
      states: {
        idle: { clip: "idle" },
        walk: { clip: "walk" },
        run: { clip: "run" },
      },
      transitions: [
        { from: "idle", to: "walk", when: (ctx) => ctx.speed > 0.5 },
        { from: "walk", to: "run", when: (ctx) => ctx.speed > 6 },
        { from: "run", to: "walk", when: (ctx) => ctx.speed <= 6 },
        { from: "walk", to: "idle", when: (ctx) => ctx.speed <= 0.5 },
        { from: "run", to: "idle", when: (ctx) => ctx.speed <= 0.5 },
      ],
    });

    // Kick input
    this.inputs.Kick.onPerformed(() => this.playerKick());

    this.setControlsActive(false);

    // Setup goal sensors — only count if ball enters through the front
    this.goalSensorP?.onSensorEnter((event) => {
      if (event.other.tag === "ball" && this.isValidGoal("player-end")) {
        this.onGoal("ai");
      }
    });

    this.goalSensorA?.onSensorEnter((event) => {
      if (event.other.tag === "ball" && this.isValidGoal("ai-end")) {
        this.onGoal("player");
      }
    });

    // Setup bounds sensors — reset ball when it leaves the field
    const boundIds = ["bounds-left", "bounds-right", "bounds-end-p", "bounds-end-a"];
    for (const id of boundIds) {
      space.components.byId(id)?.onSensorEnter((event) => {
        if (event.other.tag === "ball") {
          this.resetBall();
        }
      });
    }

    // Setup AI animation state machine
    if (this.aiPlayer) {
      this.aiAnimMachine = new AnimationStateMachine<{ speed: number; hasBallControl: boolean }>({
        body: this.aiPlayer,
        initial: "idle",
        context: { speed: 0, hasBallControl: false },
        defaultBlendTime: 0.15,
        states: {
          idle: { clip: "idle" },
          walk: { clip: "walk" },
          run: { clip: "run" },
        },
        transitions: [
          { from: "idle", to: "run", when: (ctx) => ctx.hasBallControl },
          { from: "idle", to: "walk", when: (ctx) => ctx.speed > 0.05 },
          { from: "walk", to: "run", when: (ctx) => ctx.hasBallControl },
          { from: "walk", to: "run", when: (ctx) => ctx.speed > 4 },
          { from: "run", to: "walk", when: (ctx) => !ctx.hasBallControl && ctx.speed <= 3.5 },
          { from: "walk", to: "idle", when: (ctx) => !ctx.hasBallControl && ctx.speed <= 0.02 },
          { from: "run", to: "idle", when: (ctx) => !ctx.hasBallControl && ctx.speed <= 0.02 },
        ],
      });
    }

    await reveal();

    // Reset store state
    gameStore.update({
      started: false,
      paused: false,
      playerScore: 0,
      aiScore: 0,
      gameOver: null,
    });

    this.cleanup = space.use({
      onFixedUpdate: this.onFixedUpdate,
      onUpdate: this.onUpdate,
      onDispose: this.onDispose,
    });
  }

  private setControlsActive(active: boolean) {
    this.controlsActive = active;
    if (active) {
      this.inputs?.enable();
      this.mover?.reset();
      this.playerAnimMachine?.forceState("idle");
    } else {
      this.inputs?.disable();
      this.playerAnimMachine?.forceState("idle");
    }
    if (this.cameraRig) this.cameraRig.active = active;
    if (this.playerAnimMachine) this.playerAnimMachine.enabled = active;
  }

  start() {
    if (!this.space) return;
    this.setControlsActive(true);
    this.cameraRig?.requestPointerLock();
    setStarted(true);
    this.space.start();
  }

  restart() {
    this.goalResetTask?.cancel();
    this.goalResetTask = null;
    this.playerScore = 0;
    this.aiScore = 0;
    this.isResetting = false;
    resetGame();
    this.resetPositions();
    this.setControlsActive(true);
  }

  resumeFromKickoff() {
    this.isResetting = false;
    setWaitingForKickoff(false);
    this.setControlsActive(true);
  }

  dispose() {
    this.goalResetTask?.cancel();
    this.goalResetTask = null;
    this.cleanup?.();
    this.cleanup = null;
    this.inputs?.dispose();
    this.inputs = null;
    this.mover?.dispose();
    this.mover = null;
    this.cameraRig?.dispose();
    this.cameraRig = null;
    this.playerAnimMachine?.dispose();
    this.playerAnimMachine = null;
    this.aiAnimMachine?.dispose();
    this.aiAnimMachine = null;
    if (this._shiftLockHandler) {
      window.removeEventListener("keydown", this._shiftLockHandler);
      this._shiftLockHandler = null;
    }
    this.space?.destroy();
    this.space = null;
    scriptInstance = null;
  }

  // --- Ball reset (out of bounds) ---

  private resetBall() {
    if (!this.ball?.rigidBody) return;
    this.ball.rigidBody.resetVelocities();
    this.ball.rigidBody.teleport(_ballResetPos, _zeroQuat);
  }

  // --- Goal validation ---
  // Only count a goal if the ball is within goal-post width and moving toward the goal
  private isValidGoal(end: "player-end" | "ai-end"): boolean {
    if (!this.ball?.rigidBody) return false;

    const ballX = this.ball.position.x;
    if (Math.abs(ballX) > GOAL_HALF_WIDTH) return false;

    const vel = this.ball.rigidBody.linearVelocity;
    // player-end goal is at -z, ball must be moving in -z direction
    // ai-end goal is at +z, ball must be moving in +z direction
    if (end === "player-end" && vel.z > 0) return false;
    if (end === "ai-end" && vel.z < 0) return false;

    return true;
  }

  // --- Kick mechanics ---

  private playerKick() {
    if (!this.player || !this.ball) return;

    const playerPos = this.player.position;
    const ballPos = this.ball.position;
    const diff = this._tmpVec.subVectors(ballPos, playerPos);
    diff.y = 0;
    const dist = diff.length();

    if (dist > KICK_RANGE) return;

    const dir = diff.normalize();
    dir.y = 0.3;
    dir.normalize();

    const rb = this.ball.rigidBody;
    if (rb) {
      rb.resetVelocities();
      // Apply at a point below center to generate realistic spin
      rb.applyImpulse(
        { x: dir.x * KICK_FORCE, y: dir.y * KICK_FORCE, z: dir.z * KICK_FORCE },
        { x: 0, y: -0.15, z: 0 },
      );
    }
  }

  // --- Goal handling ---

  private onGoal(scorer: "player" | "ai") {
    if (this.isResetting) return;
    this.isResetting = true;

    if (scorer === "player") {
      this.playerScore++;
    } else {
      this.aiScore++;
    }

    setScore(this.playerScore, this.aiScore);

    // Freeze controls during goal celebration
    this.setControlsActive(false);

    // Show goal animation
    setGoalScored(scorer);

    // After animation, check for game over or wait for kickoff
    this.goalResetTask?.cancel();
    this.goalResetTask = this.space?.schedule(2.5, () => {
      this.goalResetTask = null;
      clearGoalScored();

      if (this.playerScore >= GOALS_TO_WIN || this.aiScore >= GOALS_TO_WIN) {
        setGameOver(this.playerScore >= GOALS_TO_WIN ? "win" : "lose");
        document.exitPointerLock();
        return;
      }

      this.resetPositions();
      setWaitingForKickoff(true);
    }) ?? null;
  }

  private resetPositions() {
    // Reset ball
    if (this.ball?.rigidBody) {
      this.ball.rigidBody.resetVelocities();
      this.ball.rigidBody.teleport(_ballResetPos, _zeroQuat);
    }

    // Reset player (facing toward ball)
    if (this.player?.rigidBody) {
      this.player.rigidBody.resetVelocities();
      this.player.rigidBody.teleport(_playerResetPos, _playerFacingBallQuat);
    }

    // Reset AI (kinematic body)
    if (this.aiPlayer?.rigidBody) {
      this.aiPlayer.rigidBody.position = new Vector3(0, 0, 10);
    }
    this.aiWasMoving = false;
    this.aiHadBallControl = false;
    this.aiAnimMachine?.forceState("idle");

    // Reset camera rig to default distance/position
    this.cameraRig?.reset();

    this.aiKickCooldown = 0;
  }

  // --- AI logic ---

  private static readonly AI_CONFIG: AIConfig = {
    speed: AI_SPEED,
    kickForce: AI_KICK_FORCE,
    kickRange: AI_KICK_RANGE,
    kickCooldown: AI_KICK_COOLDOWN,
    playerSeparation: AI_PLAYER_SEPARATION,
    fieldBounds: { xMin: FIELD_X_MIN, xMax: FIELD_X_MAX, zMin: FIELD_Z_MIN, zMax: FIELD_Z_MAX },
    targetGoalZ: -25,
  };

  private updateAI(dt: number) {
    if (!this.aiPlayer || !this.ball) return;

    const rb = this.aiPlayer.rigidBody;
    if (!rb) return;

    const currentPos = rb.position;
    const ballPos = this.ball.position;

    const result = runAIBrain(
      {
        aiPos: { x: currentPos.x, z: currentPos.z },
        ballPos: { x: ballPos.x, z: ballPos.z },
        playerPos: this.player
          ? { x: this.player.position.x, z: this.player.position.z }
          : null,
        kickCooldown: this.aiKickCooldown,
        isResetting: this.isResetting,
        wasMoving: this.aiWasMoving,
        hadBallControl: this.aiHadBallControl,
      },
      dt,
      GameScript.AI_CONFIG,
    );

    this.aiKickCooldown = result.kickCooldown;
    this.aiWasMoving = result.isMoving;
    this.aiHadBallControl = result.hasBallControl;

    // Apply kick impulse
    if (result.kick) {
      const ballRb = this.ball.rigidBody;
      if (ballRb) {
        ballRb.applyImpulse(
          { x: result.kick.dirX, y: result.kick.dirY, z: result.kick.dirZ },
          { x: 0, y: -0.15, z: 0 },
        );
      }
    }

    // Apply position
    rb.position = this._tmpVec3.set(result.position.x, 0, result.position.z);

    // Apply animation
    if (this.aiAnimMachine) {
      this.aiAnimMachine.setContext({
        speed: result.moveSpeed,
        hasBallControl: result.hasBallControl,
      });
      if (result.hasBallControl) {
        this.aiAnimMachine.forceState("run");
      }
      this.aiAnimMachine.update(dt);
    }

    // Apply facing
    if (result.facingAngle !== null) {
      this.aiPlayer.rotation.y = result.facingAngle;
    }
  }

  // --- Fixed update (physics tick) ---

  onFixedUpdate = (dt: number) => {
    if (!this.controlsActive || !this.inputs || !this.mover || !this.cameraRig) return;

    this.inputs.update(dt);

    const moveDir = this.inputs.Move.readValue();

    const lookDelta = this.inputs.Look.readValue();
    const zoomDelta = this.inputs.Zoom.readValue();

    this.cameraRig.rotate(lookDelta.x, lookDelta.y);
    this.cameraRig.zoom(zoomDelta * 0.1);
    this.mover.move(moveDir.x, moveDir.y, PLAYER_SPEED);

    this.mover.update(dt);

    // Update player animation based on mover speed
    if (this.playerAnimMachine) {
      this.playerAnimMachine.setContext({ speed: this.mover.speed });
      this.playerAnimMachine.update(dt);
    }
  };

  // --- Frame update ---

  onUpdate = (dt: number) => {
    this.updateAI(dt);

    // Reset ball if it falls off the field
    if (this.ball?.rigidBody && this.ball.position.y < -5) {
      this.ball.rigidBody.resetVelocities();
      this.ball.rigidBody.teleport(_ballResetPos, _zeroQuat);
    }
  };

  onDispose = () => {
    console.log("[Football] Game disposed");
  };
}
