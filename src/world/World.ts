import * as THREE from 'three';
import type { Physics, Vec3 } from '../physics/Physics';
import { Chunk } from './Chunk';
import { CityLayout } from './CityLayout';
import { populateChunk } from './ChunkGenerator';
import { CHUNK_SIZE, MAX_CHUNK, MIN_CHUNK, WORLD_HALF, chunkOf } from './config';

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
 * The city, streamed in pieces. The whole city LAYOUT (roads, buildings, rivers as plain data)
 * is worked out once at startup. Only the 3 x 3 chunks around the player are actually BUILT
 * (meshes and colliders); the rest exists only as data until the player gets close.
 */
export class World {
  spawnPoint: Vec3 = { x: 0, y: 0, z: 0 };

  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private layout!: CityLayout; // created in build()
  private readonly chunks = new Map<string, Chunk>();
  private readonly loadQueue: Chunk[] = [];
  private readonly localPoint = new THREE.Vector3();

  private centerX = 0;  // grid coordinates of the middle chunk (chunk 5)
  private centerZ = 0;
  private playerX = 0;  // last known player position, for the on-screen display
  private playerZ = 0;

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene = scene;
    this.physics = physics;
  }

  /** Centre of chunk `c` in world units. */
  private static chunkCenter(c: number): number {
    return (c + 0.5) * CHUNK_SIZE;
  }

  /** Works out the city layout, then builds the first 3 x 3 chunks around the spawn point. */
  async build(): Promise<void> {
    const started = performance.now();
    this.layout = CityLayout.build();
    console.log(
      `City layout ready in ${Math.round(performance.now() - started)} ms: ` +
      `${this.layout.roads.length} roads, ${this.layout.lots.length} buildings, ${this.layout.bridges.length} bridges`
    );

    this.spawnPoint = this.layout.spawnPoint();
    this.addWorldEdges();

    this.centerX = chunkOf(this.spawnPoint.x);
    this.centerZ = chunkOf(this.spawnPoint.z);
    const initial = this.refreshChunks();
    await Promise.all(initial.map((chunk) => this.loadChunk(chunk)));
  }

  /** Call every frame with the player's position. */
  update(playerFeet: THREE.Vector3): void {
    this.playerX = playerFeet.x;
    this.playerZ = playerFeet.z;
    const limit = CHUNK_SIZE / 2 + SWITCH_MARGIN;
    let changed = false;

    // Has the player gone clearly past the edge of the middle chunk?
    if (Math.abs(playerFeet.x - World.chunkCenter(this.centerX)) > limit) {
      this.centerX = chunkOf(playerFeet.x);
      changed = true;
    }
    if (Math.abs(playerFeet.z - World.chunkCenter(this.centerZ)) > limit) {
      this.centerZ = chunkOf(playerFeet.z);
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

  /** Short status line for the on-screen display. */
  get debugText(): string {
    let ready = 0;
    for (const chunk of this.chunks.values()) if (chunk.isReady) ready++;
    const place = this.layout.placeName(this.playerX, this.playerZ);
    const x = Math.round(this.playerX);
    const z = Math.round(this.playerZ);
    return `${place}  ·  x ${x}, z ${z}  ·  chunk (${this.centerX}, ${this.centerZ})  ·  loaded ${ready}/${this.chunks.size}`;
  }

  /** Invisible walls at the city's outer edge (behind the border mountains). */
  private addWorldEdges(): void {
    const h = 400;
    const len = WORLD_HALF * 2;
    this.physics.addStaticBox({ x: 0, y: h / 2, z: WORLD_HALF + 1 }, { x: len, y: h, z: 2 });
    this.physics.addStaticBox({ x: 0, y: h / 2, z: -WORLD_HALF - 1 }, { x: len, y: h, z: 2 });
    this.physics.addStaticBox({ x: WORLD_HALF + 1, y: h / 2, z: 0 }, { x: 2, y: h, z: len });
    this.physics.addStaticBox({ x: -WORLD_HALF - 1, y: h / 2, z: 0 }, { x: 2, y: h, z: len });
  }

  /**
   * Makes the kept chunks match the 3 x 3 grid around the middle chunk (only inside the city).
   * Deletes chunks outside the grid, creates missing ones, and returns the new ones to load.
   */
  private refreshChunks(): Chunk[] {
    const wanted = new Set<string>();
    const created: Chunk[] = [];

    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const cx = this.centerX + dx;
        const cz = this.centerZ + dz;
        if (cx < MIN_CHUNK || cx > MAX_CHUNK || cz < MIN_CHUNK || cz > MAX_CHUNK) continue; // outside the city
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

    await populateChunk(chunk, this.physics, this.layout);

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
