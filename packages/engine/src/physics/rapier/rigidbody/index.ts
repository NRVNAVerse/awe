import type RapierPhysicsEngine from "../rapier-physics-engine";
import { RigidBodyOpts, RigidBody, Collider } from "../../types";
import type {
  RigidBody as RapierRawRigidBody,
  RigidBodyDesc,
} from "@dimforge/rapier3d";
import { Component3D } from "../../../space/abstract/component-3d";
import { RapierCollider } from "./collider";
import { Quaternion, Vector3 } from "three";
import { XYZ } from "../../../@types/types";
import { quaternionEq, vec3Eq } from "../../../internal/utils/js";

const tmpVec3 = new Vector3();

const tmpQuat = new Quaternion();

/**
 * @public
 *
 * Wrapper for the Rapier rigidbody, provides a convenient wrapper around the Rapier rigidbody API.
 *
 * This is the type of the {@link Component3D["rigidBody"]} property
 */
export class RapierRigidBody implements RigidBody {
  //
  private _raw: RapierRawRigidBody;

  private _colliders: RapierCollider[] = [];

  private _options: RigidBodyOpts;

  private _enabled = true;

  private _initPos = new Vector3();

  private _initQuat = new Quaternion();

  /**
   * @internal
   *
   * If true, the rigidbody will automatically sync its position and rotation with the component
   */
  _autoSyncTransform = true;

  /**
   * @internal
   *
   * If true, physics system will interpolate the pose of the rigidbody to fix the stutter happening
   * on fixed updates
   */
  _interpolate = false;

  _prevRbPosition = new Vector3();
  _currentRbPosition = new Vector3();
  _rbPosition = new Vector3();

  private _prevRbQuaternion = new Quaternion();
  private _currentRbQuaternion = new Quaternion();
  private _rbQuaternion = new Quaternion();

  private _linearVelocity = new Vector3();
  private _angularVelocity = new Vector3();

  constructor(
    private engine: RapierPhysicsEngine,
    private _component: Component3D,
    _opts: RigidBodyOpts
  ) {
    //
    this._options = structuredClone(_opts);

    this._createRigidBody();

    this._initPos.copy(this._rbPosition);

    this._initQuat.copy(this._rbQuaternion);
  }

  // A reset (construction, teleport, a direct set on a non-kinematic body) is a discontinuity:
  // the previous pose is reset too, so render interpolation before the next fixed step can never
  // blend from the old pose (e.g. a teleport made while the simulation is stopped, followed by a
  // first frame shorter than one fixed step, used to render — and let callers read back — a point
  // between the old and the new position).
  private _resetPosition(pos: Vector3) {
    //
    this._rbPosition.copy(pos);
    this._currentRbPosition.copy(pos);
    this._prevRbPosition.copy(pos);
  }

  private _resetQuaternion(quat: Quaternion) {
    //
    this._rbQuaternion.copy(quat);
    this._currentRbQuaternion.copy(quat);
    this._prevRbQuaternion.copy(quat);
  }

  private _createRigidBody() {
    //
    let rigibodyDesc: RigidBodyDesc;

    const opts = this._options;

    switch (opts.type) {
      //
      case "KINEMATIC":
      case "PLAYER":
        //
        rigibodyDesc =
          this.engine.RAPIER.RigidBodyDesc.kinematicPositionBased();

        rigibodyDesc.setCcdEnabled(true);

        this._interpolate = opts.type === "PLAYER";

        break;
      //

      case "DYNAMIC":
        //
        rigibodyDesc = this.engine.RAPIER.RigidBodyDesc.dynamic();

        rigibodyDesc.setCanSleep(true); // sleeping rigidbodies are not updated by the physics engine

        rigibodyDesc.setSleeping(false);

        rigibodyDesc.setCcdEnabled(true);

        break;

      case "FIXED":
        //
        rigibodyDesc = this.engine.RAPIER.RigidBodyDesc.fixed();

        break;

      default:
        //
        throw new Error(`Unknown RigidBody type: ${opts.type}`);
    }

    rigibodyDesc.setTranslation(
      opts.position.x,
      opts.position.y,
      opts.position.z
    );

    rigibodyDesc.setRotation(opts.quaternion);

    if (opts.linearDamping != null) {
      rigibodyDesc.setLinearDamping(opts.linearDamping);
    }

    if (opts.angularDamping != null) {
      rigibodyDesc.setAngularDamping(opts.angularDamping);
    }

    this._resetPosition(opts.position as any);
    this._resetQuaternion(opts.quaternion as any);

    this._raw = this.engine.world.createRigidBody(rigibodyDesc);

    if (opts.translationLock) {
      this.translationLock = opts.translationLock;
    }

    if (opts.rotationLock) {
      this.rotationLock = opts.rotationLock;
    }

    this._createColliders();

    this._raw.userData = {
      name: this.component.name,
      id: this.component.data.id,
      rigidbodyType: this.options.type,
      colliderType: this.options.colliders[0]?.type,
      mesh: this.component,
      parent: this,
    };

  }

  //
  // @internal
  //

  addColliderFromOptions(opts) {
    if (this._wasDisposed) return;
    const collider = new RapierCollider(this.engine, opts, this);

    this.addCollider(collider);
  }

  // samsy

  private _createColliders() {
    //
    const collidersOpts = this._options.colliders;

    for (let i = 0; i < collidersOpts.length; i++) {
      //
      const opts = collidersOpts[i];

      const collider = new RapierCollider(this.engine, opts, this);

      this.addCollider(collider);
    }
  }

  /**
   * @internal
   *
   * Copy the position and rotation from the raw Rapier rigidbody to the component
   */
  _syncFromPhysics() {
    //
    if (this._wasDisposed) return;
    // if (!this.component.quaternionWorld.equals(this._rbQuaternion)) {
    //     debugger;
    // }

    const newPos = tmpVec3.copy(this.raw.translation() as any);

    const newQuat = tmpQuat.copy(this.raw.rotation() as any);

    let hasChanged = false;

    if (!newPos.equals(this._currentRbPosition)) {
      //
      hasChanged = true;

      this._currentRbPosition.copy(newPos);
      this._rbPosition.copy(newPos);
    }

    if (!newQuat.equals(this._rbQuaternion)) {
      //
      // console.log(
      //     "syncFromPhysics quaternion",
      //     this.component.data.script?.identifier,
      //     newQuat.clone()
      // );

      this._currentRbQuaternion.copy(newQuat);
      this._rbQuaternion.copy(newQuat);

      hasChanged = true;
    }

    if (hasChanged) {
      //
      this._component._setWorldPosAndQuat(newPos, newQuat);
    }

    // if (!this.component.quaternionWorld.equals(this._rbQuaternion)) {
    //     debugger;
    // }
  }

  /**
   * @internal
   *
   * Copy the position and rotation from the component to the raw Rapier rigidbody
   */
  _syncFromTransform() {
    //
    if (this._wasDisposed) return;

    // if (!this.component.quaternionWorld.equals(this._rbQuaternion)) {
    //     debugger;
    // }
    const newPos = this.component.positionWorld;

    const newQuat = this.component.quaternionWorld;

    if (!newPos.equals(this._rbPosition)) {
      //
      // console.log("syncFromTransform position", newPos);
      this._setRBPosition(newPos);
    }

    if (!newQuat.equals(this._rbQuaternion)) {
      //
      // console.log("syncFromTransform quaternion", newQuat.clone());
      this._setRBQuaternion(newQuat);
    }

    // if (!this.component.quaternionWorld.equals(this._rbQuaternion)) {
    //     debugger;
    // }
  }

  _preInterpolate() {
    //
    if (this._wasDisposed) return;

    this._prevRbPosition.copy(this._currentRbPosition);

    this._prevRbQuaternion.copy(this._currentRbQuaternion);
  }

  /**
   * @internal
   */
  _interpolatePose(alpha: number) {
    //
    if (this._wasDisposed) return;

    const prevX = this._rbPosition.x;

    this._rbPosition.lerpVectors(
      this._prevRbPosition,
      this._currentRbPosition,
      alpha
    );

    this._rbQuaternion.slerpQuaternions(
      this._prevRbQuaternion,
      this._currentRbQuaternion,
      alpha
    );

    // if (this.isKinematic && this._currentRbPosition.y > 1) {
    //     //
    //     //
    // }

    // if (this._autoSyncTransform) {
    this._component._setWorldPosAndQuat(
      this._rbPosition,
      this._currentRbQuaternion
    );
    // }
  }

  private _setRBPosition(pos: Vector3) {
    //
    if (this.isKinematic) {
      //
      this._currentRbPosition.copy(pos);
      this._rbPosition.copy(pos);

      this.raw.setNextKinematicTranslation(pos);
      //
    } else {
      //
      this._resetPosition(pos);
      this.raw.setTranslation(pos, true);
    }
  }

  private _setRBQuaternion(quat: Quaternion) {
    //
    if (this.isKinematic) {
      //
      this._currentRbQuaternion.copy(quat);
      this._rbQuaternion.copy(quat);

      this.raw.setNextKinematicRotation(quat);
    } else {
      //
      this._resetQuaternion(quat);
      this.raw.setRotation(quat, true);
    }
  }

  /**
   * @internal
   */
  _wasDisposed = false;

  dispose() {
    //
    if (this._wasDisposed) return;

    this._wasDisposed = true;

    this.colliders.forEach((collider) => collider.dispose());

    this.engine.world.removeRigidBody(this._raw);

    this._raw = null;

    this._colliders = [];
  }

  __updateActiveEvents() {
    //
    if (this._wasDisposed) return;

    for (let i = 0; i < this.colliders.length; i++) {
      //
      this.colliders[i].__updateActiveEvents();
    }
  }

  addCollider(collider: RapierCollider) {
    //
    if (this._wasDisposed) return;

    if (this._colliders.includes(collider)) return;

    this._colliders.push(collider);
  }

  removeCollider(collider: RapierCollider) {
    //
    if (this._wasDisposed) return;

    const index = this._colliders.indexOf(collider);

    if (index === -1) return;

    this._colliders.splice(index, 1);
  }

  get colliders() {
    //
    return this._colliders;
  }

  /**
   * Returns the component that owns this rigidbody
   */
  get component(): Component3D {
    return this._component;
  }

  /**
   * Returns the raw Rapier rigidbody
   */
  get raw(): RapierRawRigidBody {
    return this._raw;
  }

  /**
   * Returns the options used to create this rigidbody
   */
  get options() {
    return this._options;
  }

  /**
   * Is this rigidbody a fixed rigidbody?
   */
  get isFixed() {
    //
    return this._options.type === "FIXED";
  }

  /**
   * Is this rigidbody a dynamic rigidbody?
   */
  get isDynamic() {
    //
    return this._options.type === "DYNAMIC";
  }

  /**
   * Is this rigidbody a kinematic rigidbody?
   */
  get isKinematic() {
    //
    return (
      this._options.type === "KINEMATIC" || this._options.type === "PLAYER"
    );
  }

  /**
   * Is this rigidbody enabled?
   */
  get enabled() {
    return this._enabled;
  }

  /**
   * Use this to enable or disable the rigidbody
   */
  set enabled(value: boolean) {
    this._enabled = value;
    this._raw.setEnabled(value);
  }

  get position() {
    //
    return this._rbPosition;
  }

  get quaternion() {
    //
    return this._rbQuaternion;
  }

  /**
   * Returns the linear velocity of the rigidbody
   */
  get linearVelocity(): Vector3 {
    const vel = this._raw.linvel();
    return this._linearVelocity.set(vel.x, vel.y, vel.z);
  }

  /**
   * Returns the angular velocity of the rigidbody
   */
  get angularVelocity(): Vector3 {
    const vel = this._raw.angvel();
    return this._angularVelocity.set(vel.x, vel.y, vel.z);
  }

  set position(pos: Vector3) {
    //
    if (this._wasDisposed) return;

    this._setRBPosition(pos);

    this.component._setWorldPosition(pos);
  }

  set quaternion(quat: Quaternion) {
    //
    if (this._wasDisposed) return;

    this._setRBQuaternion(quat);

    this.component._setWorldQuaternion(quat);
  }

  teleport(position: Vector3, quaternion: Quaternion) {
    //
    if (this._wasDisposed) return;
    if (position) {
      //
      this._resetPosition(position);

      this.raw.setTranslation(position, true);

      this.component._setWorldPosition(position);

      if (this.isDynamic) {
        //
        this.resetVelocities();

        this.resetForces();
      }
    }

    if (quaternion) {
      //
      this._resetQuaternion(quaternion);

      this.raw.setRotation(quaternion, true);

      this.component._setWorldQuaternion(quaternion);
    }
  }

  /**
   * Returns the current translation lock state
   */
  get translationLock() {
    return this._options.translationLock;
  }

  /**
   * Use this to lock the rigidbody's translation on a specific axes (x, y, z)
   */
  set translationLock(lock: [boolean, boolean, boolean]) {
    //
    if (this._wasDisposed) return;

    this._options.translationLock = lock.slice() as any;

    this._raw.lockTranslations(true, true);

    this._raw.setEnabledTranslations(!lock[0], !lock[1], !lock[2], true);
  }

  /**
   * Returns the current rotation lock state
   */
  get rotationLock() {
    return this._options.rotationLock;
  }

  /**
   * Use this to lock the rigidbody's rotation on a specific axes (x, y, z)
   */
  set rotationLock(lock: [boolean, boolean, boolean]) {
    //
    if (this._wasDisposed) return;

    this._options.rotationLock = lock.slice() as any;

    this._raw?.lockRotations(true, true);

    this._raw?.setEnabledRotations(!lock[0], !lock[1], !lock[2], true);
  }

  reset() {
    //
    if (this._wasDisposed) return;

    this.teleport(this._initPos, this._initQuat);

    this.resetForces();

    this.resetTorques();
  }

  /**
   * Add a force to the rigidbody. The force is applied at the center of mass by default
   * unless a relative point is provided
   */
  addForce(force: Partial<XYZ>, relativePoint?: XYZ) {
    //
    if (this._wasDisposed) return;

    tmpVec3.set(force.x ?? 0, force.y ?? 0, force.z ?? 0);

    if (relativePoint) {
      this.raw.addForceAtPoint(tmpVec3, relativePoint, true);
    } else {
      this.raw.addForce(tmpVec3, true);
    }
  }

  /**
   * Reset all forces applied to the rigidbody to zero
   */
  resetForces() {
    //
    if (this._wasDisposed) return;

    this.raw.resetForces(true);
  }

  resetVelocities() {
    //
    if (this._wasDisposed) return;

    this.raw.setLinvel({ x: 0, y: 0, z: 0 }, true);

    this.raw.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  setLinearDamping(damping: number) {
    //
    if (this._wasDisposed) return;

    this._options.linearDamping = damping;
    this.raw.setLinearDamping(damping);
  }

  setAngularDamping(damping: number) {
    //
    if (this._wasDisposed) return;

    this._options.angularDamping = damping;
    this.raw.setAngularDamping(damping);
  }

  /**
   * Add a torque to the rigidbody
   */
  addTorque(torque: XYZ) {
    //
    if (this._wasDisposed) return;

    this.raw.addTorque(torque, true);
  }

  /**
   * Reset all torques applied to the rigidbody to zero
   */
  resetTorques() {
    //
    if (this._wasDisposed) return;

    this.raw.resetTorques(true);
  }

  /**
   * Apply an impulse to the rigidbody. The impulse is applied at the center of mass by default
   * unless a relative point is provided
   */
  applyImpulse(impulse: Partial<XYZ>, relativePoint?: XYZ) {
    //
    if (this._wasDisposed) return;

    tmpVec3.set(impulse.x ?? 0, impulse.y ?? 0, impulse.z ?? 0);

    if (relativePoint) {
      this.raw.applyImpulseAtPoint(tmpVec3, relativePoint, true);
    } else {
      this.raw.applyImpulse(tmpVec3, true);
    }
  }
}
