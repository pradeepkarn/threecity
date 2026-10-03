import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics, Vec3 } from '../physics/Physics';
import { loadBuildingModel } from '../models/BuildingModel';
import { loadHouseModel } from '../models/HouseModel';
import type { EnterableBuildingModel } from '../models/types';
import {
  loadBallModel, loadCrateModel, loadTreeModel, TREE_TRUNK_HEIGHT, TREE_TRUNK_RADIUS,
} from '../models/PropModels';

export const WORLD_HALF = 50;

// A physics body plus the model that follows it.
type DynamicObject = { body: RAPIER.RigidBody; visual: THREE.Object3D };

// Builds the level. Pattern used everywhere: load a MODEL for looks, add a simple COLLIDER for physics.
export class World {
  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly dynamics: DynamicObject[] = [];
  private readonly enterables: EnterableBuildingModel[] = [];
  private readonly localPoint = new THREE.Vector3();

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene = scene;
    this.physics = physics;
  }

  async build(): Promise<void> {
    this.createGround();
    this.createRampAndStairs();
    // Loading in parallel: with real GLBs this makes startup much faster.
    await Promise.all([
      this.createBuildings(), this.createHouse(), this.createTrees(), this.createProps(),
    ]);
  }

  /**
   * Hides the roof of any building the player is inside.
   * Returns true if the player is inside one, so the camera can zoom in.
   */
  updateInteriors(playerFeet: THREE.Vector3): boolean {
    let insideAny = false;
    for (const building of this.enterables) {
      // Convert the player's world position into the building's own local space,
      // so the check works no matter where the building is placed or how it's rotated.
      this.localPoint.copy(playerFeet);
      building.root.worldToLocal(this.localPoint);
      const inside = building.interior.containsPoint(this.localPoint);
      building.roof.visible = !inside;
      if (inside) insideAny = true;
    }
    return insideAny;
  }

  private async createHouse(): Promise<void> {
    const house = await loadHouseModel();
    house.root.position.set(-28, 0, -12);
    house.root.rotation.y = Math.PI / 2; // door (local +Z) now faces +X, towards the town centre
    house.root.updateMatrixWorld(true);  // make sure its transform is ready before we use it
    this.scene.add(house.root);

    // Turn each local collider box into a world-space physics collider.
    const worldCenter = new THREE.Vector3();
    for (const box of house.colliders) {
      worldCenter.copy(box.center).applyMatrix4(house.root.matrixWorld);
      this.physics.addStaticBox(worldCenter, box.size, house.root.quaternion);
    }

    this.enterables.push(house);
  }

  /** Copy each dynamic body's position and rotation onto its model. Call after physics.step(). */
  syncDynamics(): void {
    for (const { body, visual } of this.dynamics) {
      const p = body.translation();
      const r = body.rotation();
      visual.position.set(p.x, p.y, p.z);
      visual.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private createGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x8fc45a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Thick slab whose top is at y = 0, plus invisible walls at the edges.
    this.physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: WORLD_HALF * 2, y: 1, z: WORLD_HALF * 2 });
    const h = 10;
    const len = WORLD_HALF * 2;
    this.physics.addStaticBox({ x: 0, y: h / 2, z: WORLD_HALF + 0.5 }, { x: len, y: h, z: 1 });
    this.physics.addStaticBox({ x: 0, y: h / 2, z: -WORLD_HALF - 0.5 }, { x: len, y: h, z: 1 });
    this.physics.addStaticBox({ x: WORLD_HALF + 0.5, y: h / 2, z: 0 }, { x: 1, y: h, z: len });
    this.physics.addStaticBox({ x: -WORLD_HALF - 0.5, y: h / 2, z: 0 }, { x: 1, y: h, z: len });
  }

  private async createBuildings(): Promise<void> {
    const buildings = [
      { x: -12, z: -10, w: 8, d: 8, h: 6, color: 0xf5c4b3 },
      { x: 12, z: -12, w: 10, d: 7, h: 9, color: 0xcecbf6 },
      { x: -14, z: 14, w: 7, d: 10, h: 5, color: 0xfac775 },
      { x: 15, z: 12, w: 9, d: 9, h: 12, color: 0xb5d4f4 },
    ];

    await Promise.all(buildings.map(async (b) => {
      const model = await loadBuildingModel(b.w, b.h, b.d, b.color);
      model.position.set(b.x, 0, b.z); // origin is at the base, so y = 0
      this.scene.add(model);
      this.physics.addStaticBox({ x: b.x, y: b.h / 2, z: b.z }, { x: b.w, y: b.h, z: b.d });
    }));
  }

  private async createTrees(): Promise<void> {
    const spots = [[-30, -30], [-25, 30], [30, -30], [35, 30], [-35, 0], [0, 35], [-5, -38], [40, -15]];

    await Promise.all(spots.map(async ([x, z]) => {
      const tree = await loadTreeModel();
      tree.position.set(x, 0, z);
      tree.rotation.y = Math.random() * Math.PI * 2; // variety for free
      this.scene.add(tree);
      // Only the trunk is solid; you can walk under the leaves.
      this.physics.addStaticCylinder({ x, y: TREE_TRUNK_HEIGHT / 2, z }, TREE_TRUNK_HEIGHT, TREE_TRUNK_RADIUS);
    }));
  }

  private async createProps(): Promise<void> {
    const crates: Vec3[] = [
      { x: 6, y: 0.5, z: 8 },
      { x: 6, y: 1.51, z: 8 },
      { x: 6, y: 2.52, z: 8 },
      { x: 7.2, y: 0.5, z: 8 },
      { x: 4.8, y: 0.5, z: 8 },
    ];
    for (const pos of crates) {
      const crate = await loadCrateModel();
      this.addDynamic(pos, RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(0.5), crate);
    }

    const ballRadius = 0.6;
    const ball = await loadBallModel(ballRadius);
    this.addDynamic(
      { x: -5, y: 1, z: 6 },
      RAPIER.ColliderDesc.ball(ballRadius).setDensity(0.3).setRestitution(0.6),
      ball,
      0.3
    );
  }

  // Level geometry that stays simple boxes even later (ramps, steps, platforms).
  private createRampAndStairs(): void {
    const rampTilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(20)
    );
    this.addBlock({ x: -2, y: 1.5, z: -25 }, { x: 10, y: 0.5, z: 4 }, 0xd3d1c7, rampTilt);
    this.addBlock({ x: 5.7, y: 1.7, z: -25 }, { x: 6, y: 3.4, z: 6 }, 0xb4b2a9);

    const stepH = 0.3;
    const stepD = 0.6;
    for (let i = 0; i < 8; i++) {
      const h = (i + 1) * stepH;
      this.addBlock({ x: 25 + i * stepD, y: h / 2, z: 0 }, { x: stepD, y: h, z: 3 }, 0xd3d1c7);
    }
    this.addBlock({ x: 31, y: 1.2, z: 0 }, { x: 3, y: 2.4, z: 3 }, 0xb4b2a9);
  }

  /** A visible box with a matching static collider. */
  private addBlock(center: Vec3, size: Vec3, color: number,
                   rotation: THREE.Quaternion = new THREE.Quaternion()): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color })
    );
    mesh.position.set(center.x, center.y, center.z);
    mesh.quaternion.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.physics.addStaticBox(center, size, rotation);
  }

  /** A physics-driven object: Rapier moves the body, syncDynamics() moves the model. */
  private addDynamic(position: Vec3, collider: RAPIER.ColliderDesc,
                     visual: THREE.Object3D, damping = 0): void {
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(damping)
        .setAngularDamping(damping)
    );
    this.physics.world.createCollider(collider, body);
    this.scene.add(visual);
    this.dynamics.push({ body, visual });
  }
}