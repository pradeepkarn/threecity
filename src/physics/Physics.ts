import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// A plain {x, y, z}. THREE.Vector3 also fits this shape, so you can pass either.
export type Vec3 = { x: number; y: number; z: number };

// Wraps the Rapier world. Visuals never live here: physics only knows shapes and positions.
export class Physics {
  readonly world: RAPIER.World;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  // Rapier is WebAssembly and must finish loading first, hence the async factory.
  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics(new RAPIER.World({ x: 0, y: -9.81, z: 0 }));
  }

  /** Fixed box. `size` is the FULL size; Rapier wants half sizes, so we convert here. */
  addStaticBox(center: Vec3, size: Vec3, rotation: THREE.Quaternion = new THREE.Quaternion()): RAPIER.Collider {
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
    );
  }

  /** Fixed upright cylinder, e.g. a tree trunk or a lamp post. */
  addStaticCylinder(center: Vec3, height: number, radius: number): RAPIER.Collider {
    return this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(center.x, center.y, center.z)
    );
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }
}
