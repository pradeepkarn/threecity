import * as THREE from 'three';
import type { Physics, Vec3 } from '../physics/Physics';
import { Chunk } from './Chunk';
import { CHUNK_SIZE, SPAWN_POINT, populateChunk } from './ChunkGenerator';

// How many chunks to keep around the player in each direction.
// 1 means a 3 x 3 grid (9 chunks) with the player always in the middle one:
//
//    7 | 8 | 9
//    4 | 5 | 6        5 = the chunk the player is in
//    1 | 2 | 3
const VIEW_RADIUS = 1;

// The middle chunk only changes once the player is this far past its edge.
// Without it, walking along a border would load and delete chunks over and over.
const SWITCH_MARGIN = 4;

/**
 * The streaming city. Keeps a 3 x 3 grid of chunks around the player:
 * when the player crosses into another chunk, chunks that fall outside the grid are
 * deleted and the new ones ahead are loaded, so the player is always in the middle.
 */
export class World {
  readonly spawnPoint: Vec3 = SPAWN_POINT;

  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly chunks = new Map<string, Chunk>();  // every chunk currently kept, by "cx,cz"
  private readonly loadQueue: Chunk[] = [];            // chunks waiting to be built
  private readonly localPoint = new THREE.Vector3();

  private centerX = 0;  // grid coordinates of the middle chunk (chunk 5)
  private centerZ = 0;

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene = scene;
    this.physics = physics;
  }

  /** World X or Z position -> chunk grid coordinate. Chunk 0 spans -40..40, chunk 1 spans 40..120, etc. */
  static toChunk(position: number): number {
    return Math.floor(position / CHUNK_SIZE + 0.5);
  }

  /** Loads the first 3 x 3 chunks around the spawn point and waits for all of them. */
  async build(): Promise<void> {
    // One infinite flat floor for the whole world, so the ground never has gaps or seams.
    this.physics.addGroundPlane();

    this.centerX = World.toChunk(this.spawnPoint.x);
    this.centerZ = World.toChunk(this.spawnPoint.z);
    const initial = this.refreshChunks();
    // At startup we wait for every chunk, so the player never spawns into empty space.
    await Promise.all(initial.map((chunk) => this.loadChunk(chunk)));
  }

  /** Call every frame with the player's position. */
  update(playerFeet: THREE.Vector3): void {
    const limit = CHUNK_SIZE / 2 + SWITCH_MARGIN;
    let changed = false;

    // Has the player gone clearly past the edge of the middle chunk?
    if (Math.abs(playerFeet.x - this.centerX * CHUNK_SIZE) > limit) {
      this.centerX = World.toChunk(playerFeet.x);
      changed = true;
    }
    if (Math.abs(playerFeet.z - this.centerZ * CHUNK_SIZE) > limit) {
      this.centerZ = World.toChunk(playerFeet.z);
      changed = true;
    }

    if (changed) this.loadQueue.push(...this.refreshChunks());

    // Build at most one new chunk per frame, spreading the work out so the game doesn't stutter.
    const next = this.loadQueue.shift();
    if (next) void this.loadChunk(next);
  }

  /**
   * Hides the roof of any building the player is inside.
   * Returns true if the player is inside one, so the camera can zoom in.
   */
  updateInteriors(playerFeet: THREE.Vector3): boolean {
    let insideAny = false;
    for (const chunk of this.chunks.values()) {
      if (!chunk.isReady) continue;
      for (const building of chunk.enterables) {
        this.localPoint.copy(playerFeet);
        building.root.worldToLocal(this.localPoint);
        const inside = building.interior.containsPoint(this.localPoint);
        building.roof.visible = !inside;
        if (inside) insideAny = true;
      }
    }
    return insideAny;
  }

  /** Short status line for the on-screen debug display. */
  get debugText(): string {
    let ready = 0;
    for (const chunk of this.chunks.values()) if (chunk.isReady) ready++;
    return `Chunk (${this.centerX}, ${this.centerZ})  ·  loaded ${ready}/${this.chunks.size}`;
  }

  /**
   * Makes the kept chunks match the 3 x 3 grid around the current middle chunk.
   * Deletes chunks outside the grid, creates missing ones, and returns the new ones to load.
   */
  private refreshChunks(): Chunk[] {
    const wanted = new Set<string>();
    const created: Chunk[] = [];

    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const cx = this.centerX + dx;
        const cz = this.centerZ + dz;
        const key = Chunk.keyOf(cx, cz);
        wanted.add(key);
        if (!this.chunks.has(key)) {
          const chunk = new Chunk(cx, cz);
          this.chunks.set(key, chunk);
          created.push(chunk);
        }
      }
    }

    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) {
        this.unloadChunk(chunk);
        this.chunks.delete(key);
      }
    }

    return created;
  }

  private async loadChunk(chunk: Chunk): Promise<void> {
    if (!chunk.startLoading()) return; // already removed before its turn came

    await populateChunk(chunk, this.physics);

    // The player may have walked away while this chunk was loading.
    if (chunk.cancelled) {
      chunk.dispose(this.scene, this.physics);
      return;
    }

    chunk.finishLoading();
    this.scene.add(chunk.group); // only shown once fully built, so it never appears half-done
  }

  private unloadChunk(chunk: Chunk): void {
    if (chunk.isLoading) {
      chunk.cancel(); // can't stop it mid-way; loadChunk cleans it up when it finishes
    } else {
      chunk.dispose(this.scene, this.physics);
    }
  }
}
