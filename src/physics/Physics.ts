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

  /**
   * Hilly ground for one chunk, covering sizeX by sizeZ and centred on `center`.
   * `cells` is how many squares the grid has per side, so there are (cells + 1) x (cells + 1)
   * height values. Rapier's order (verified with raycasts): index = xIndex * (cells + 1) + zIndex.
   */
  addHeightfield(center: Vec3, cells: number, heights: Float32Array, sizeX: number, sizeZ: number): RAPIER.Collider {
    return this.world.createCollider(
      RAPIER.ColliderDesc.heightfield(cells, cells, heights, { x: sizeX, y: 1, z: sizeZ })
        .setTranslation(center.x, center.y, center.z)
    );
  }

  /** An infinite flat floor at y = 0 (a "half-space": everything below y = 0 is solid). */
  addGroundPlane(): RAPIER.Collider {
    // There's no shortcut like ColliderDesc.cuboid() for this shape, so we build the shape directly.
    return this.world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })));
  }

  /** Removes a collider, e.g. when its chunk is unloaded. */
  removeCollider(collider: RAPIER.Collider): void {
    this.world.removeCollider(collider, false);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }
}
