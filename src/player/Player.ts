import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics, Vec3 } from '../physics/Physics';
import type { Input } from '../input/Input';
import type { OrbitCamera } from '../camera/OrbitCamera';
import type { CharacterModel } from '../models/types';
import { loadPlayerModel } from '../models/PlayerModel';
import { DEFAULT_CHARACTER, type CharacterId } from '../models/catalog';

// Capsule size: total height = 2 * (HALF_HEIGHT + RADIUS) = 2 units.
const RADIUS = 0.5;
const HALF_HEIGHT = 0.5;
// The physics body sits at the capsule's CENTRE, the model's origin is at its FEET.
// This is the distance between the two.
const FEET_OFFSET = HALF_HEIGHT + RADIUS;

const WALK_SPEED = 2.5;     // gentle push on the joystick
const RUN_SPEED = 6;       // full push, or the keyboard
const RUN_THRESHOLD = 0.6; // how far the joystick must be pushed to run
const TURN_SPEED = 12;
const GRAVITY = -25;
const JUMP_SPEED = 9;

export class Player {
  /** Feet position, updated every frame. The camera follows this. */
  readonly position = new THREE.Vector3();

  private readonly model: CharacterModel;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly spawn: Vec3;

  private verticalVelocity = 0;
  private grounded = false;
  private moving = false;
  private running = false;

  // Reused every frame instead of creating new vectors (avoids garbage on phones).
  private readonly input = new THREE.Vector2();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();

  private constructor(physics: Physics, model: CharacterModel, spawn: Vec3) {
    this.model = model;
    this.spawn = { ...spawn }; // keep our own copy for respawning
    const world = physics.world;

    // Kinematic: our code moves it; the controller stops it going through things.
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z)
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);

    this.controller = world.createCharacterController(0.02);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(45));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(30));
    this.controller.enableAutostep(0.4, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(70);
  }

  // Async because loading the model (later a GLB) is async.
  // `spawn` is where the capsule's centre starts; World decides where that is.
  static async create(scene: THREE.Scene, physics: Physics, spawn: Vec3,
                      character: CharacterId = DEFAULT_CHARACTER): Promise<Player> {
    const model = await loadPlayerModel(character);
    scene.add(model.root);
    return new Player(physics, model, spawn);
  }

  /** Step 1 of the frame: work out where the player wants to go and ask physics. */
  update(dt: number, input: Input, camera: OrbitCamera): void {
    input.getMove(this.input);
    camera.getGroundAxes(this.forward, this.right);
    this.move.set(0, 0, 0)
      .addScaledVector(this.forward, this.input.y)
      .addScaledVector(this.right, this.input.x);
    // How hard the stick is pushed (0..1) decides walking or running.
    const strength = Math.min(1, this.input.length());
    this.moving = strength > 0.05 && this.move.lengthSq() > 1e-6;
    this.running = strength >= RUN_THRESHOLD;
    const speed = this.running ? RUN_SPEED : WALK_SPEED;
    if (this.moving) this.move.normalize().multiplyScalar(speed);
    else this.move.set(0, 0, 0);

    // Always read the jump so a press in mid-air doesn't fire on landing.
    const wantsJump = input.consumeJump();
    if (wantsJump && this.grounded) this.verticalVelocity = JUMP_SPEED;
    this.verticalVelocity += GRAVITY * dt;

    const desired = {
      x: this.move.x * dt,
      y: this.verticalVelocity * dt,
      z: this.move.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = 0;
    if (this.verticalVelocity > 0 && corrected.y < desired.y - 1e-4) this.verticalVelocity = 0; // hit a ceiling

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + corrected.x, y: t.y + corrected.y, z: t.z + corrected.z });
  }

  /** Step 3 of the frame (after physics.step): move the model and pick its animation. */
  syncVisual(dt: number): void {
    const p = this.body.translation();

    if (p.y < -10) {
      this.body.setTranslation(this.spawn, true);
      this.verticalVelocity = 0;
    }

    this.position.set(p.x, p.y - FEET_OFFSET, p.z);
    this.model.root.position.copy(this.position);

    if (this.moving) {
      const targetAngle = Math.atan2(this.move.x, this.move.z);
      let diff = targetAngle - this.model.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest way round
      this.model.root.rotation.y += diff * Math.min(1, TURN_SPEED * dt);
    }

    if (!this.grounded) this.model.play('jump');
    else if (this.moving) this.model.play(this.running ? 'run' : 'walk');
    else this.model.play('idle');
    this.model.update(dt);
  }
}
