import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { Chunk } from './Chunk';
import type { Bridge, CityLayout, Lot } from './CityLayout';
import { mountainAmount } from './terrain';
import { CHUNK_SIZE, WATER_LEVEL } from './config';
import { Random, hash2 } from './random';
import { valueNoise } from './noise';
import { loadBuildingModel } from '../models/BuildingModel';
import { loadHouseModel } from '../models/HouseModel';
import { createInstances, type InstanceTransform } from '../models/assets';
import { PROPS, TREE_TRUNK, type PropId } from '../models/catalog';

// =============================================================================================
// Builds ONE chunk by cutting its 80 x 80 piece out of the city layout.
//
// Ownership rule: every object belongs to the chunk that contains its CENTRE point.
// A house standing across a border is built entirely by its owner chunk (part of it
// overhangs into the neighbour) and disappears entirely when that chunk unloads.
// =============================================================================================

const TERRAIN_CELLS = 40;  // 40 x 40 squares per chunk: one height sample every 2 units
const NATURE_CELL = 5;     // one possible tree/bush/rock per 5 x 5 cell, seeded by its world position
const NATURE_SEED = 777;
const BUSH_DENSITY = 0.08;   // bushes in parks
const BENCH_DENSITY = 0.012; // benches in parks
const ROCK_DENSITY = 0.05;   // boulders in the mountains
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
  await Promise.all([builder.buildLots(), builder.buildStreetProps(), builder.buildNature()]);
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
  // Copies of each prop to draw in this chunk, collected first, then drawn with instancing.
  private readonly instances = new Map<PropId, InstanceTransform[]>();

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
    await Promise.all(lots.map((lot) => (lot.kind === 'house' ? this.buildHouse(lot) : this.buildBuilding(lot))));
  }

  private async buildBuilding(lot: Lot): Promise<void> {
    if (!lot.building) return;
    const model = await loadBuildingModel(lot.building);
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
  // Street lights and parked cars that the city layout placed in this chunk.
  // ---------------------------------------------------------------------------------------
  async buildStreetProps(): Promise<void> {
    for (const item of this.layout.contentFor(this.chunk.cx, this.chunk.cz).props) {
      const y = item.onRoad ? this.layout.roadHeight(item.x, item.z) + ROAD_LIFT : this.layout.heightAt(item.x, item.z);
      const info = PROPS[item.prop];
      this.addInstance(item.prop, item.x, y, item.z, item.angle, info.scale);

      if (item.prop === 'streetlight') {
        const height = info.size[1] * info.scale;
        this.chunk.colliders.push(this.physics.addStaticCylinder({ x: item.x, y: y + height / 2, z: item.z }, height, 0.15));
      } else {
        this.addPropBox(item.prop, item.x, y, item.z, item.angle, info.scale); // cars are solid
      }
    }
    await this.flushInstances();
  }

  // ---------------------------------------------------------------------------------------
  // Nature: trees (forests, parks, countryside), bushes and benches in parks, rocks in the
  // mountains. Each spot is a 5 x 5 cell seeded by its WORLD position, so forests flow
  // seamlessly across chunk borders.
  // ---------------------------------------------------------------------------------------
  async buildNature(): Promise<void> {
    const cellsPerSide = CHUNK_SIZE / NATURE_CELL;
    const firstCellX = Math.round(this.minX / NATURE_CELL);
    const firstCellZ = Math.round(this.minZ / NATURE_CELL);

    for (let iz = 0; iz < cellsPerSide; iz++) {
      for (let ix = 0; ix < cellsPerSide; ix++) {
        const cellX = firstCellX + ix;
        const cellZ = firstCellZ + iz;
        const random = new Random(hash2(cellX, cellZ, NATURE_SEED));
        // Draw every random value up front, always in the same order.
        const treeRoll = random.next();
        const extraRoll = random.next();
        const x = cellX * NATURE_CELL + random.range(0.5, NATURE_CELL - 0.5);
        const z = cellZ * NATURE_CELL + random.range(0.5, NATURE_CELL - 0.5);
        const turn = random.range(0, Math.PI * 2);
        const size = random.range(0.8, 1.3);
        const treeType: PropId = random.next() < 0.5 ? 'tree_A' : 'tree_B';
        const rockType = random.pick<PropId>(['rock_A', 'rock_C', 'rock_E']);

        if (!this.layout.isSpotClear(x, z)) continue;
        const density = this.layout.belowTreeline(x, z) ? this.layout.treeDensityAt(x, z) : 0;
        const inPark = this.layout.isPark(x, z);
        const ground = this.layout.heightAt(x, z);

        if (treeRoll < density) {
          const scale = PROPS[treeType].scale * size;
          this.addInstance(treeType, x, ground, z, turn, scale);
          const trunk = TREE_TRUNK.height * scale;
          this.chunk.colliders.push(this.physics.addStaticCylinder(
            { x, y: ground + trunk / 2, z }, trunk, TREE_TRUNK.radius * scale
          ));
        } else if (inPark && extraRoll < BENCH_DENSITY) {
          this.addInstance('bench', x, ground, z, turn, PROPS.bench.scale);
          this.addPropBox('bench', x, ground, z, turn, PROPS.bench.scale);
        } else if (inPark && extraRoll < BUSH_DENSITY) {
          this.addInstance('bush', x, ground, z, turn, PROPS.bush.scale * size); // walk-through
        } else if (extraRoll < ROCK_DENSITY * mountainAmount(x, z)) {
          const scale = PROPS[rockType].scale * size;
          this.addInstance(rockType, x, ground - 0.3, z, turn, scale); // slightly sunk into the slope
          this.addPropBox(rockType, x, ground - 0.3, z, turn, scale);
        }
      }
    }
    await this.flushInstances();
  }

  /** Remembers one copy of a prop; flushInstances() draws them all together. */
  private addInstance(prop: PropId, x: number, y: number, z: number, rotation: number, scale: number): void {
    let list = this.instances.get(prop);
    if (!list) {
      list = [];
      this.instances.set(prop, list);
    }
    list.push({ x: x - this.centerX, y, z: z - this.centerZ, rotation, scale });
  }

  /** Draws every collected prop type as instanced meshes (a few draw calls per type). */
  private async flushInstances(): Promise<void> {
    const batches = [...this.instances.entries()];
    this.instances.clear();
    const groups = await Promise.all(batches.map(([prop, items]) =>
      createInstances(PROPS[prop].url, items, !PROPS[prop].sinkIntoGround)));
    for (const group of groups) this.chunk.group.add(group);
  }

  /** A box collider matching a prop's size, standing on the ground at (x, y, z). */
  private addPropBox(prop: PropId, x: number, y: number, z: number, rotation: number, scale: number): void {
    const [w, h, d] = PROPS[prop].size;
    this.chunk.colliders.push(this.physics.addStaticBox(
      { x, y: y + (h * scale) / 2, z },
      { x: w * scale, y: h * scale, z: d * scale },
      new THREE.Quaternion().setFromAxisAngle(UP, rotation)
    ));
  }
}
