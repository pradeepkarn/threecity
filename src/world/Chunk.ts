import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import type { EnterableBuildingModel } from '../models/types';

// Life of a chunk:
//   pending   -> created and waiting in the load queue
//   loading   -> its buildings and trees are being created
//   ready     -> fully built and visible
//   cancelled -> the player moved away while it was still loading; it gets cleaned up when loading ends
//   disposed  -> removed from the scene and physics; gone
type ChunkState = 'pending' | 'loading' | 'ready' | 'cancelled' | 'disposed';

/**
 * One square piece of the city. Keeps track of everything it created,
 * so that it can remove all of it again when the player walks away.
 */
export class Chunk {
  readonly cx: number;   // chunk grid coordinates, e.g. (0, 0) is the spawn chunk
  readonly cz: number;
  readonly key: string;  // "cx,cz", used as the Map key

  /** All visuals of this chunk. Positioned at the chunk's centre, children use local coordinates. */
  readonly group = new THREE.Group();
  /** Every physics collider this chunk created. */
  readonly colliders: RAPIER.Collider[] = [];
  /** Buildings in this chunk that the player can walk into. */
  readonly enterables: EnterableBuildingModel[] = [];

  private state: ChunkState = 'pending';

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.key = Chunk.keyOf(cx, cz);
    this.group.name = `chunk ${this.key}`; // shows up nicely when debugging
  }

  static keyOf(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  get isLoading(): boolean { return this.state === 'loading'; }
  get isReady(): boolean { return this.state === 'ready'; }
  get cancelled(): boolean { return this.state === 'cancelled'; }

  /** Returns false if this chunk shouldn't be loaded (already loading, or no longer needed). */
  startLoading(): boolean {
    if (this.state !== 'pending') return false;
    this.state = 'loading';
    return true;
  }

  finishLoading(): void {
    this.state = 'ready';
  }

  /** Player left while this chunk was loading. World will dispose it once loading finishes. */
  cancel(): void {
    this.state = 'cancelled';
  }

  /** Removes everything this chunk created: visuals, colliders and GPU memory. */
  dispose(scene: THREE.Scene, physics: Physics): void {
    scene.remove(this.group);

    for (const collider of this.colliders) physics.removeCollider(collider);
    this.colliders.length = 0;
    this.enterables.length = 0;

    // Geometries and materials hold GPU memory that JavaScript's garbage collector can't free.
    // Without this, every chunk you walk past would leak memory until the phone runs out.
    // Resources marked `shared` are reused by every chunk, so we leave those alone.
    this.group.traverse((obj) => {
      // InstancedMesh (forests) also holds a buffer of per-tree positions on the GPU.
      if (obj instanceof THREE.InstancedMesh) obj.dispose();
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        if (!obj.geometry.userData.shared) obj.geometry.dispose();
        const materials: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
          if (!material.userData.shared) material.dispose();
        }
      }
    });

    this.state = 'disposed';
  }
}
