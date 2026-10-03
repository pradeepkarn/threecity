import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { Chunk } from './Chunk';
import type { Bridge, CityLayout, Lot } from './CityLayout';
import { CHUNK_SIZE, WATER_LEVEL } from './config';
import { Random, hash2 } from './random';
import { valueNoise } from './noise';
import { loadBuildingModel } from '../models/BuildingModel';
import { loadHouseModel } from '../models/HouseModel';
import { loadForestTrees, PINE_TRUNK_HEIGHT, PINE_TRUNK_RADIUS, type TreeTransform } from '../models/ForestModel';

// =============================================================================================
// Builds ONE chunk by cutting its 80 x 80 piece out of the city layout.
//
// Ownership rule: every object belongs to the chunk that contains its CENTRE point.
// A house standing across a border is built entirely by its owner chunk (part of it
// overhangs into the neighbour) and disappears entirely when that chunk unloads.
// =============================================================================================

const TERRAIN_CELLS = 40;  // 40 x 40 squares per chunk: one height sample every 2 units
const TREE_CELL = 5;       // one possible tree per 5 x 5 cell, seeded by its world position
const TREE_SEED = 777;
const ROAD_LIFT = 0.08;    // roads sit just above the flattened ground so they don't flicker
const UP = new THREE.Vector3(0, 1, 0);

type XYZ = { x: number; y: number; z: number };

// ---------- Shared resources (one copy for every chunk) ----------
function shared<T extends THREE.Material | THREE.BufferGeometry>(resource: T): T {
  resource.userData.shared = true;
  return resource;
}
const unitBox = shared(new THREE.BoxGeometry(1, 1, 1));
const terrainMat = shared(new THREE.MeshStandardMaterial({ vertexColors: true }));
const roadMat = shared(new THREE.MeshStandardMaterial({ color: 0x55534e }));
const bridgeMat = shared(new THREE.MeshStandardMaterial({ color: 0xb4b2a9 }));
const railMat = shared(new THREE.MeshStandardMaterial({ color: 0x888780 }));
const waterGeometry = shared(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(-Math.PI / 2));
const waterMat = shared(new THREE.MeshStandardMaterial({
  color: 0x378add, transparent: true, opacity: 0.75, roughness: 0.15,
}));

// Ground colours.
const SAND = new THREE.Color(0xd8c99b);
const GRASS = new THREE.Color(0x8fc45a);
const GRASS_DARK = new THREE.Color(0x6fa33f);
const ROCK = new THREE.Color(0x8a8780);
const SNOW = new THREE.Color(0xf4f4f0);

export async function populateChunk(chunk: Chunk, physics: Physics, layout: CityLayout): Promise<void> {
  const builder = new ChunkBuilder(chunk, physics, layout);
  builder.buildTerrain();
  builder.buildWater();
  builder.buildRoads();
  builder.buildBridges();
  await Promise.all([builder.buildLots(), builder.buildTrees()]);
}

class ChunkBuilder {
  private readonly chunk: Chunk;
  private readonly physics: Physics;
  private readonly layout: CityLayout;
  private readonly minX: number;    // world position of the chunk's corner
  private readonly minZ: number;
  private readonly centerX: number; // world position of the chunk's centre (the group's origin)
  private readonly centerZ: number;
  private lowestGround = Infinity;

  constructor(chunk: Chunk, physics: Physics, layout: CityLayout) {
    this.chunk = chunk;
    this.physics = physics;
    this.layout = layout;
    this.minX = chunk.cx * CHUNK_SIZE;
    this.minZ = chunk.cz * CHUNK_SIZE;
    this.centerX = this.minX + CHUNK_SIZE / 2;
    this.centerZ = this.minZ + CHUNK_SIZE / 2;
    chunk.group.position.set(this.centerX, 0, this.centerZ);
    chunk.group.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------------------------------
  // Terrain: a hilly mesh to look at, and a matching heightfield for physics.
  // ---------------------------------------------------------------------------------------
  buildTerrain(): void {
    const cells = TERRAIN_CELLS;
    const n = cells + 1;               // points per side
    const step = CHUNK_SIZE / cells;

    // Sample one extra ring of points around the chunk. Normals (lighting) are computed from
    // neighbouring heights, and the extra ring lets edge points use heights from the next
    // chunk, so lighting matches perfectly across chunk borders.
    const g = n + 2;
    const H = new Float32Array(g * g);
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        H[j * g + i] = this.layout.heightAt(this.minX + (i - 1) * step, this.minZ + (j - 1) * step);
      }
    }

    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const physicsHeights = new Float32Array(n * n);
    const normal = new THREE.Vector3();
    const color = new THREE.Color();

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = H[(j + 1) * g + (i + 1)];
        const v = j * n + i;
        positions.set([i * step - CHUNK_SIZE / 2, h, j * step - CHUNK_SIZE / 2], v * 3);

        // Slope from neighbours -> surface normal.
        const dx = (H[(j + 1) * g + (i + 2)] - H[(j + 1) * g + i]) / (2 * step);
        const dz = (H[(j + 2) * g + (i + 1)] - H[j * g + (i + 1)]) / (2 * step);
        normal.set(-dx, 1, -dz).normalize();
        normals.set([normal.x, normal.y, normal.z], v * 3);

        this.groundColor(h, normal.y, this.minX + i * step, this.minZ + j * step, color);
        colors.set([color.r, color.g, color.b], v * 3);

        physicsHeights[i * n + j] = h; // Rapier's order: X index first, then Z
        this.lowestGround = Math.min(this.lowestGround, h);
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d); // counter-clockwise seen from above, so faces point up
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, terrainMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true; // mountains shade the valleys
    this.chunk.group.add(mesh);

    this.chunk.colliders.push(this.physics.addHeightfield(
      { x: this.centerX, y: 0, z: this.centerZ }, cells, physicsHeights, CHUNK_SIZE, CHUNK_SIZE
    ));
  }

  /** Picks a ground colour from height and steepness: sand by water, grass, rock, snow. */
  private groundColor(h: number, upness: number, worldX: number, worldZ: number, out: THREE.Color): void {
    if (h < WATER_LEVEL + 0.8) {
      out.copy(SAND);
    } else if (h > 95) {
      out.copy(SNOW);
    } else if (upness < 0.8 || h > 60) {
      out.copy(ROCK); // steep slopes and high ground are rocky
    } else {
      // Patches of lighter and darker grass so big fields don't look flat.
      out.copy(GRASS).lerp(GRASS_DARK, valueNoise(worldX / 35, worldZ / 35, 5));
    }
  }

  // ---------------------------------------------------------------------------------------
  // Water: one flat transparent surface. The carved river bed and ponds show through it;
  // everywhere else the ground is higher and simply hides it.
  // ---------------------------------------------------------------------------------------
  buildWater(): void {
    if (this.lowestGround >= WATER_LEVEL) return; // no water in this chunk
    const water = new THREE.Mesh(waterGeometry, waterMat);
    water.position.y = WATER_LEVEL;
    this.chunk.group.add(water);
  }

  // ---------------------------------------------------------------------------------------
  // Roads: all road pieces this chunk owns, merged into ONE mesh (one draw call).
  // ---------------------------------------------------------------------------------------
  buildRoads(): void {
    const { segments } = this.layout.contentFor(this.chunk.cx, this.chunk.cz);
    if (segments.length === 0) return;

    const positions: number[] = [];
    const pushTriangle = (a: number[], b: number[], c: number[]): void => {
      // Make sure the triangle faces up, whichever way the road runs.
      const crossY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      for (const q of crossY >= 0 ? [a, b, c] : [a, c, b]) positions.push(q[0], q[1], q[2]);
    };

    for (const { road, index } of segments) {
      const s0 = road.samples[index];
      const s1 = road.samples[index + 1];
      const hw = road.halfWidth;
      // The four corners: left/right of each end, using each end's own sideways direction,
      // so neighbouring pieces share edges and curves have no gaps.
      const corner = (s: typeof s0, side: number): number[] => {
        const x = s.x + s.nx * hw * side;
        const z = s.z + s.nz * hw * side;
        return [x - this.centerX, this.layout.roadHeight(x, z) + ROAD_LIFT, z - this.centerZ];
      };
      const l0 = corner(s0, 1);
      const r0 = corner(s0, -1);
      const l1 = corner(s1, 1);
      const r1 = corner(s1, -1);
      pushTriangle(l0, l1, r0);
      pushTriangle(r0, l1, r1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, roadMat);
    mesh.receiveShadow = true;
    this.chunk.group.add(mesh);
  }

  // ---------------------------------------------------------------------------------------
  // Bridges: a deck with railings wherever a road crosses water.
  // ---------------------------------------------------------------------------------------
  buildBridges(): void {
    for (const bridge of this.layout.contentFor(this.chunk.cx, this.chunk.cz).bridges) {
      this.buildBridge(bridge);
    }
  }

  private buildBridge(b: Bridge): void {
    const dx = b.x1 - b.x0;
    const dz = b.z1 - b.z0;
    const length = Math.hypot(dx, dz);
    const heading = Math.atan2(dx, dz); // turns local +Z to point along the bridge
    const turn = new THREE.Quaternion().setFromAxisAngle(UP, heading);
    const midX = (b.x0 + b.x1) / 2;
    const midZ = (b.z0 + b.z1) / 2;
    const deckThickness = 0.6;
    const width = b.halfWidth * 2 + 1;

    this.solidBox(bridgeMat, { x: midX, y: b.top - deckThickness / 2, z: midZ },
      { x: width, y: deckThickness, z: length }, turn);

    // Railings on both sides, so players don't walk off into the river.
    for (const side of [1, -1]) {
      const offset = (width / 2 - 0.15) * side;
      const sideX = Math.cos(heading) * offset; // the bridge's local +X direction in world space
      const sideZ = -Math.sin(heading) * offset;
      this.solidBox(railMat, { x: midX + sideX, y: b.top + 0.5, z: midZ + sideZ },
        { x: 0.3, y: 1, z: length }, turn);
    }
  }

  /** A box with a matching collider. Position is in WORLD coordinates. */
  private solidBox(material: THREE.Material, center: XYZ, size: XYZ, rotation: THREE.Quaternion): void {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(size.x, size.y, size.z);
    mesh.position.set(center.x - this.centerX, center.y, center.z - this.centerZ);
    mesh.quaternion.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.chunk.group.add(mesh);
    this.chunk.colliders.push(this.physics.addStaticBox(center, size, rotation));
  }

  // ---------------------------------------------------------------------------------------
  // Buildings this chunk owns.
  // ---------------------------------------------------------------------------------------
  async buildLots(): Promise<void> {
    const { lots } = this.layout.contentFor(this.chunk.cx, this.chunk.cz);
    await Promise.all(lots.map((lot) => (lot.kind === 'house' ? this.buildHouse(lot) : this.buildTower(lot))));
  }

  private async buildTower(lot: Lot): Promise<void> {
    const model = await loadBuildingModel(lot.width, lot.height, lot.depth, lot.color);
    model.position.set(lot.x - this.centerX, lot.padHeight, lot.z - this.centerZ);
    model.rotation.y = lot.angle;
    this.chunk.group.add(model);
    this.chunk.colliders.push(this.physics.addStaticBox(
      { x: lot.x, y: lot.padHeight + lot.height / 2, z: lot.z },
      { x: lot.width, y: lot.height, z: lot.depth },
      new THREE.Quaternion().setFromAxisAngle(UP, lot.angle)
    ));
  }

  private async buildHouse(lot: Lot): Promise<void> {
    const house = await loadHouseModel(lot.color);
    house.root.position.set(lot.x - this.centerX, lot.padHeight, lot.z - this.centerZ);
    house.root.rotation.y = lot.angle;
    this.chunk.group.add(house.root);
    house.root.updateMatrixWorld(true);

    const worldCenter = new THREE.Vector3();
    const worldRotation = house.root.getWorldQuaternion(new THREE.Quaternion());
    for (const box of house.colliders) {
      worldCenter.copy(box.center).applyMatrix4(house.root.matrixWorld);
      this.chunk.colliders.push(this.physics.addStaticBox(worldCenter, box.size, worldRotation));
    }
    this.chunk.enterables.push(house);
  }

  // ---------------------------------------------------------------------------------------
  // Trees: forests, parks and countryside, drawn as one InstancedMesh per tree part.
  // ---------------------------------------------------------------------------------------
  async buildTrees(): Promise<void> {
    const trees: TreeTransform[] = [];
    const cellsPerSide = CHUNK_SIZE / TREE_CELL;
    const firstCellX = Math.round(this.minX / TREE_CELL);
    const firstCellZ = Math.round(this.minZ / TREE_CELL);

    for (let iz = 0; iz < cellsPerSide; iz++) {
      for (let ix = 0; ix < cellsPerSide; ix++) {
        const cellX = firstCellX + ix;
        const cellZ = firstCellZ + iz;
        // Seeded by the cell's WORLD position, so forests flow seamlessly across chunk borders.
        const random = new Random(hash2(cellX, cellZ, TREE_SEED));
        const roll = random.next();
        const x = cellX * TREE_CELL + random.range(0.5, TREE_CELL - 0.5);
        const z = cellZ * TREE_CELL + random.range(0.5, TREE_CELL - 0.5);
        const turn = random.range(0, Math.PI * 2);
        const size = random.range(0.8, 1.4);

        if (roll > this.layout.treeDensityAt(x, z)) continue;
        if (!this.layout.isTreeSpotFree(x, z)) continue;

        const ground = this.layout.heightAt(x, z);
        trees.push({ x: x - this.centerX, y: ground, z: z - this.centerZ, rotation: turn, scale: size });
        const trunk = PINE_TRUNK_HEIGHT * size;
        this.chunk.colliders.push(this.physics.addStaticCylinder(
          { x, y: ground + trunk / 2, z }, trunk, PINE_TRUNK_RADIUS * size
        ));
      }
    }
    if (trees.length > 0) this.chunk.group.add(await loadForestTrees(trees));
  }
}
