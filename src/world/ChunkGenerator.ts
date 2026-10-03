import * as THREE from 'three';
import type { Physics, Vec3 } from '../physics/Physics';
import type { Chunk } from './Chunk';
import { Random, hash2 } from './random';
import { designChunk, type PlotSpec } from './cityMap';
import { loadBuildingModel } from '../models/BuildingModel';
import { loadHouseModel } from '../models/HouseModel';
import { loadTreeModel, TREE_TRUNK_HEIGHT, TREE_TRUNK_RADIUS } from '../models/PropModels';

// ---------------------------------------------------------------------------------------------
// HOW a chunk is built. WHAT goes in it is decided by cityMap.ts.
//
// Everything here is calculated only from the chunk's coordinates and WORLD_SEED, never from
// Math.random(). So chunk (3, -2) is identical on every device, for every player, every time.
//
// Layout of ONE chunk (seen from above, +X to the right, +Z towards the top):
//
//   +---+--------------------------+
//   | R |  sidewalk                |
//   | O |   +---------+---------+  |      Each chunk has a road on its west and south edge.
//   | A |   | plot 2  | plot 3  |  |      Side by side, those roads join into a grid,
//   | D |   +---------+---------+  |      so every block ends up surrounded by roads.
//   |   |   | plot 0  | plot 1  |  |
//   |   |   +---------+---------+  |      Each of the 4 plots becomes a tower, a house
//   +---+--------------------------+      or a park, as decided by cityMap.ts.
//   |         ROAD                 |
//   +------------------------------+
// ---------------------------------------------------------------------------------------------

export const CHUNK_SIZE = 80;
const WORLD_SEED = 12345;          // changing this changes the whole generated city for everyone
const HALF = CHUNK_SIZE / 2;
const ROAD_W = 10;
const BLOCK_SIZE = CHUNK_SIZE - ROAD_W;
const BLOCK_CENTER = ROAD_W / 2;   // the block is shifted because the roads take the west/south edge
const SIDEWALK = 3;
const PLOT_OFFSET = 17;            // distance from the block centre to each plot centre
const PLOT_HALF = 12;              // usable half-size inside a plot (for trees)

/** On the west road of the spawn chunk, next to a house. */
export const SPAWN_POINT: Vec3 = { x: -HALF + ROAD_W / 2, y: 1.5, z: 5 };

const TOWER_COLORS = [0xf5c4b3, 0xcecbf6, 0xfac775, 0xb5d4f4, 0x9fe1cb, 0xf4c0d1, 0xd3d1c7];
const HOUSE_COLORS = [0xf1efe8, 0xfaeeda, 0xe1f5ee, 0xfbeaf0, 0xe6f1fb];

// ---------- Resources shared by every chunk ----------
// Created once and reused, instead of new copies per chunk. Marked `shared` so that
// Chunk.dispose() doesn't delete them when a chunk is removed.
function shared<T extends THREE.Material | THREE.BufferGeometry>(resource: T): T {
  resource.userData.shared = true;
  return resource;
}
const unitBox = shared(new THREE.BoxGeometry(1, 1, 1)); // scaled to any size with mesh.scale
const groundPlane = shared(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE));
const groundMat = shared(new THREE.MeshStandardMaterial({ color: 0x8fc45a }));
const roadMat = shared(new THREE.MeshStandardMaterial({ color: 0x55534e }));
const lineMat = shared(new THREE.MeshStandardMaterial({ color: 0xfac775 }));
const sidewalkMat = shared(new THREE.MeshStandardMaterial({ color: 0xd3d1c7 }));
const rampMat = shared(new THREE.MeshStandardMaterial({ color: 0xd3d1c7 }));
const platformMat = shared(new THREE.MeshStandardMaterial({ color: 0xb4b2a9 }));

/**
 * Fills a chunk with its city block. Same chunk coordinates always produce the same result.
 */
export async function populateChunk(chunk: Chunk, physics: Physics): Promise<void> {
  const builder = new ChunkBuilder(chunk, physics);
  builder.buildGround();
  builder.buildRoads();
  builder.buildSidewalks();

  const chunkRandom = new Random(hash2(chunk.cx, chunk.cz, WORLD_SEED));
  const design = designChunk(chunk.cx, chunk.cz, chunkRandom);

  // Build all 4 plots in parallel. Each gets its OWN seeded generator, so the result
  // doesn't depend on which plot happens to finish loading first.
  await Promise.all(design.plots.map((spec, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const px = BLOCK_CENTER + (col === 0 ? -PLOT_OFFSET : PLOT_OFFSET);
    const pz = BLOCK_CENTER + (row === 0 ? -PLOT_OFFSET : PLOT_OFFSET);
    const plotRandom = new Random(hash2(chunk.cx, chunk.cz, WORLD_SEED + i + 1));
    return builder.buildPlot(spec, px, pz, col, plotRandom);
  }));
}

/**
 * Helper that builds things inside one chunk.
 * Visuals use LOCAL coordinates (relative to the chunk centre) because they live in chunk.group.
 * Colliders need WORLD coordinates, so `toWorld` adds the chunk's position.
 */
class ChunkBuilder {
  private readonly chunk: Chunk;
  private readonly physics: Physics;
  private readonly originX: number;
  private readonly originZ: number;

  constructor(chunk: Chunk, physics: Physics) {
    this.chunk = chunk;
    this.physics = physics;
    this.originX = chunk.cx * CHUNK_SIZE;
    this.originZ = chunk.cz * CHUNK_SIZE;

    // Place the chunk's group at its centre, and compute its transform now,
    // because houses need it to convert their collider boxes to world space.
    chunk.group.position.set(this.originX, 0, this.originZ);
    chunk.group.updateMatrixWorld(true);
  }

  private toWorld(local: Vec3): Vec3 {
    return { x: this.originX + local.x, y: local.y, z: this.originZ + local.z };
  }

  /** A thin visual-only slab lying on the ground (roads, lines, sidewalks). */
  private flat(material: THREE.Material, x: number, z: number, width: number, depth: number, top: number): void {
    const thickness = 0.02;
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(width, thickness, depth);
    mesh.position.set(x, top - thickness / 2, z);
    mesh.receiveShadow = true;
    this.chunk.group.add(mesh);
  }

  /** A visible box with a matching collider (ramps, platforms, steps). */
  private solidBox(material: THREE.Material, center: Vec3, size: Vec3,
                   rotation: THREE.Quaternion = new THREE.Quaternion()): void {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(size.x, size.y, size.z);
    mesh.position.set(center.x, center.y, center.z);
    mesh.quaternion.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.chunk.group.add(mesh);
    this.chunk.colliders.push(this.physics.addStaticBox(this.toWorld(center), size, rotation));
  }

  buildGround(): void {
    // Visual only. Physically, the whole world stands on one infinite ground plane (see World).
    const ground = new THREE.Mesh(groundPlane, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.chunk.group.add(ground);
  }

  buildRoads(): void {
    const roadX = -HALF + ROAD_W / 2;
    const roadZ = -HALF + ROAD_W / 2;
    this.flat(roadMat, roadX, 0, ROAD_W, CHUNK_SIZE, 0.02);                    // west road (full length)
    this.flat(roadMat, BLOCK_CENTER, roadZ, BLOCK_SIZE, ROAD_W, 0.02);        // south road (stops at the crossing)

    // Dashed centre lines, skipping the crossing in the corner.
    for (let z = -HALF + ROAD_W + 2; z < HALF - 3; z += 7) {
      this.flat(lineMat, roadX, z + 1.5, 0.3, 3, 0.03);
    }
    for (let x = -HALF + ROAD_W + 2; x < HALF - 3; x += 7) {
      this.flat(lineMat, x + 1.5, roadZ, 3, 0.3, 0.03);
    }
  }

  buildSidewalks(): void {
    // Four strips forming a ring around the block. The middle stays as the green ground.
    const near = BLOCK_CENTER - BLOCK_SIZE / 2 + SIDEWALK / 2;
    const far = BLOCK_CENTER + BLOCK_SIZE / 2 - SIDEWALK / 2;
    const inner = BLOCK_SIZE - 2 * SIDEWALK;
    this.flat(sidewalkMat, BLOCK_CENTER, near, BLOCK_SIZE, SIDEWALK, 0.02);
    this.flat(sidewalkMat, BLOCK_CENTER, far, BLOCK_SIZE, SIDEWALK, 0.02);
    this.flat(sidewalkMat, near, BLOCK_CENTER, SIDEWALK, inner, 0.02);
    this.flat(sidewalkMat, far, BLOCK_CENTER, SIDEWALK, inner, 0.02);
  }

  async buildPlot(spec: PlotSpec, px: number, pz: number, col: number, random: Random): Promise<void> {
    switch (spec.type) {
      case 'tower': return this.buildTower(spec, px, pz, random);
      case 'house': return this.buildHouse(spec, px, pz, col, random);
      case 'park': return this.buildPark(spec, px, pz, random);
      case 'playground': return this.buildPlayground(px, pz);
      case 'empty': return; // nothing but grass
    }
  }

  // Note on the builders below: they ALWAYS draw the same random values in the same order,
  // even when the spec overrides some of them. That way, setting e.g. a tower's color by hand
  // doesn't shift the random sequence and accidentally change the rest of the plot.

  private async buildTower(spec: Extract<PlotSpec, { type: 'tower' }>, px: number, pz: number,
                           random: Random): Promise<void> {
    // Draw all random values first, then let the spec override them.
    const rolled = {
      width: random.int(12, 24),
      depth: random.int(12, 24),
      height: random.int(8, 32),
      color: random.pick(TOWER_COLORS),
    };
    const w = spec.width ?? rolled.width;
    const d = spec.depth ?? rolled.depth;
    const h = spec.height ?? rolled.height;
    const color = spec.color ?? rolled.color;
    const model = await loadBuildingModel(w, h, d, color);
    model.position.set(px, 0, pz);
    this.chunk.group.add(model);
    this.chunk.colliders.push(
      this.physics.addStaticBox(this.toWorld({ x: px, y: h / 2, z: pz }), { x: w, y: h, z: d })
    );
  }

  private async buildHouse(spec: Extract<PlotSpec, { type: 'house' }>, px: number, pz: number,
                           col: number, random: Random): Promise<void> {
    const randomColor = random.pick(HOUSE_COLORS);
    const house = await loadHouseModel(spec.color ?? randomColor);
    house.root.position.set(px, 0, pz);
    // Turn the door (local +Z) towards the nearest road: west for the left column, east for the right.
    house.root.rotation.y = col === 0 ? -Math.PI / 2 : Math.PI / 2;
    this.chunk.group.add(house.root);
    house.root.updateMatrixWorld(true);

    // Convert the house's local collider boxes into world-space colliders.
    const worldCenter = new THREE.Vector3();
    const worldRotation = house.root.getWorldQuaternion(new THREE.Quaternion());
    for (const box of house.colliders) {
      worldCenter.copy(box.center).applyMatrix4(house.root.matrixWorld);
      this.chunk.colliders.push(this.physics.addStaticBox(worldCenter, box.size, worldRotation));
    }
    this.chunk.enterables.push(house);
  }

  private async buildPark(spec: Extract<PlotSpec, { type: 'park' }>, px: number, pz: number,
                          random: Random): Promise<void> {
    const randomCount = random.int(3, 6);
    const count = spec.trees ?? randomCount;
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      // Pick all random values BEFORE awaiting, so the order of random numbers never changes.
      const x = px + random.range(-PLOT_HALF, PLOT_HALF);
      const z = pz + random.range(-PLOT_HALF, PLOT_HALF);
      const turn = random.range(0, Math.PI * 2);
      jobs.push(loadTreeModel().then((tree) => {
        tree.position.set(x, 0, z);
        tree.rotation.y = turn;
        this.chunk.group.add(tree);
        this.chunk.colliders.push(this.physics.addStaticCylinder(
          this.toWorld({ x, y: TREE_TRUNK_HEIGHT / 2, z }), TREE_TRUNK_HEIGHT, TREE_TRUNK_RADIUS
        ));
      }));
    }
    await Promise.all(jobs);
  }

  /** The ramp and stairs from before, for testing the character controller. */
  private async buildPlayground(px: number, pz: number): Promise<void> {
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(20));
    this.solidBox(rampMat, { x: px - 5, y: 1.5, z: pz - 6 }, { x: 10, y: 0.5, z: 4 }, tilt);
    this.solidBox(platformMat, { x: px + 2.7, y: 1.7, z: pz - 6 }, { x: 6, y: 3.4, z: 6 });

    const stepH = 0.3;
    const stepD = 0.6;
    const startX = px - 6;
    for (let i = 0; i < 8; i++) {
      const h = (i + 1) * stepH;
      this.solidBox(rampMat, { x: startX + i * stepD, y: h / 2, z: pz + 6 }, { x: stepD, y: h, z: 3 });
    }
    this.solidBox(platformMat, { x: startX + 6, y: 1.2, z: pz + 6 }, { x: 3, y: 2.4, z: 3 });
  }
}
