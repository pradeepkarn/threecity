import * as THREE from 'three';
import {
  WATER_LEVEL, WORLD_HALF, WORLD_SEED, chunkKey, chunkOf, lerp, smoothstep,
} from './config';
import { CITY_PLAN, type DistrictPlan, type DistrictStyle, type GreenPlan, type Point } from './cityPlan';
import { landHeight, mountainAmount, smoothHeight } from './terrain';
import { SpatialGrid } from './SpatialGrid';
import { Random, hash2 } from './random';
import { valueNoise } from './noise';
import type { Vec3 } from '../physics/Physics';
import {
  BUILDINGS, CAR_IDS, DOWNTOWN_BUILDINGS, RESIDENTIAL_BUILDINGS, SUBURB_BUILDINGS,
  type BuildingId, type PropId,
} from '../models/catalog';

// ---------- Tuning ----------
const SAMPLE_STEP = 2;          // roads are stored as points every 2 units
const LOCAL_ROAD_WIDTH = 8;     // district streets (main roads set their own width in the plan)
const SHOULDER = 5;             // ground blends into the road level over this distance
const RIVER_BANK = 12;          // how wide the sloping river banks are
const RIVER_BED = WATER_LEVEL - 1.4;
const BRIDGE_CLEARANCE = 1.6;   // bridge decks stay at least this far above the water
const MAX_BRIDGE_LENGTH = 120;  // longer stretches over water get no road at all (a road running
                                // ALONG a river shouldn't become one endless bridge)
const SETBACK = 3;              // space between road edge and building (the "sidewalk")
const PAD_BLEND = 5;            // ground blends into a building's flat base over this distance
const LOT_EVERY = 6;            // try placing a building every 6 road samples (12 units)
const TREELINE = 70;            // no trees above this height
const LOT_SEED = WORLD_SEED + 50;
const STREET_SEED = WORLD_SEED + 60;
const PROP_SEED = WORLD_SEED + 70;
const STREETLIGHT_EVERY = 15;   // a street light every 15 road samples (30 units)
const CAR_EVERY = 11;           // a chance of a parked car every 22 units
const CAR_CHANCE = 0.35;

// ---------- Data types ----------
export interface RoadSample { x: number; z: number; nx: number; nz: number } // point + sideways direction
export interface Road { id: number; name: string; halfWidth: number; samples: RoadSample[] }
/** The piece of road from samples[index] to samples[index + 1]. */
export interface RoadSegment { road: Road; index: number }
export interface Bridge { x0: number; z0: number; x1: number; z1: number; halfWidth: number; top: number }

/** 'building' = a GLB building from the catalog; 'house' = a house you can walk into. */
export type LotKind = 'building' | 'house';
export interface Lot {
  x: number; z: number;       // centre
  angle: number;              // rotation; the front (+Z side) faces the road
  width: number; depth: number; height: number;
  kind: LotKind;
  building: BuildingId | null; // which GLB, for kind 'building'
  color: number;              // wall colour, for kind 'house'
  padHeight: number;          // height of the flat ground it stands on
  radius: number;             // rough size, for overlap checks
}

/** A street light or parked car placed along a road. */
export interface StreetProp { prop: PropId; x: number; z: number; angle: number; onRoad: boolean }

/** Everything one chunk owns: things whose centre point lies inside it. */
export interface ChunkContent { segments: RoadSegment[]; bridges: Bridge[]; lots: Lot[]; props: StreetProp[] }

interface RiverSegment { ax: number; az: number; bx: number; bz: number; halfWidth: number }
interface Area<T> { plan: T; minX: number; maxX: number; minZ: number; maxZ: number }

const EMPTY_CONTENT: ChunkContent = { segments: [], bridges: [], lots: [], props: [] };

const HOUSE_COLORS = [0xf1efe8, 0xfaeeda, 0xe1f5ee, 0xfbeaf0, 0xe6f1fb];

// ---------- Small geometry helpers ----------
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function pointInPolygon(x: number, z: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function makeArea<T extends { polygon: Point[] }>(plan: T): Area<T> {
  const xs = plan.polygon.map((p) => p[0]);
  const zs = plan.polygon.map((p) => p[1]);
  return { plan, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function areaAt<T extends { polygon: Point[] }>(areas: Area<T>[], x: number, z: number): T | undefined {
  for (const a of areas) {
    if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue; // quick box check first
    if (pointInPolygon(x, z, a.plan.polygon)) return a.plan;
  }
  return undefined;
}

/**
 * Where an infinite straight line crosses a polygon. The line is base + dir * t;
 * returns the [tStart, tEnd] stretches that are inside the polygon.
 */
function clipLineToPolygon(polygon: Point[], baseX: number, baseZ: number,
                           dirX: number, dirZ: number): [number, number][] {
  const hits: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const [px, pz] = polygon[i];
    const [qx, qz] = polygon[(i + 1) % polygon.length];
    const ex = qx - px;
    const ez = qz - pz;
    const denom = dirX * ez - dirZ * ex;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    const wx = px - baseX;
    const wz = pz - baseZ;
    const t = (wx * ez - wz * ex) / denom;
    const s = (wx * dirZ - wz * dirX) / denom;
    if (s >= 0 && s < 1) hits.push(t);
  }
  hits.sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) spans.push([hits[i], hits[i + 1]]);
  return spans;
}

/**
 * The whole city, worked out once at startup from CITY_PLAN.
 * It holds only light data (points and numbers), never meshes. Chunks ask it what to build.
 */
export class CityLayout {
  readonly roads: Road[] = [];
  readonly lots: Lot[] = [];
  readonly bridges: Bridge[] = [];

  private readonly roadGrid = new SpatialGrid<RoadSegment>(32);
  private readonly riverGrid = new SpatialGrid<RiverSegment>(32);
  private readonly lotGrid = new SpatialGrid<Lot>(64);
  private readonly content = new Map<string, ChunkContent>();
  private readonly districts = CITY_PLAN.districts.map((d) => makeArea<DistrictPlan>(d));
  private readonly greens = CITY_PLAN.greens.map((g) => makeArea<GreenPlan>(g));
  private maxRoadHalfWidth = 0;
  private maxLotRadius = 0;

  // Reused result arrays for grid queries (avoids creating garbage thousands of times per chunk).
  private readonly roadHits: RoadSegment[] = [];
  private readonly riverHits: RiverSegment[] = [];
  private readonly lotHits: Lot[] = [];

  private constructor() {}

  /** Builds the full layout. Takes a moment, so it's done once while the game loads. */
  static build(): CityLayout {
    const layout = new CityLayout();
    layout.buildRiver();
    layout.buildMainRoads();
    layout.buildDistrictStreets();
    layout.assignRoadsAndBridges();
    layout.buildLots();
    layout.buildStreetProps();
    return layout;
  }

  // =========================================================================================
  // Queries used while building chunks
  // =========================================================================================

  /** What a chunk owns. */
  contentFor(cx: number, cz: number): ChunkContent {
    return this.content.get(chunkKey(cx, cz)) ?? EMPTY_CONTENT;
  }

  /** 0 = dry land, 1 = fully in the river or a pond, in between = sloping bank. */
  waterFactor(x: number, z: number): number {
    let factor = 0;
    const reach = CITY_PLAN.river.width / 2 + RIVER_BANK;
    for (const s of this.riverGrid.query(x - reach, z - reach, x + reach, z + reach, this.riverHits)) {
      const d = distToSegment(x, z, s.ax, s.az, s.bx, s.bz);
      factor = Math.max(factor, 1 - smoothstep(s.halfWidth, s.halfWidth + RIVER_BANK, d));
    }
    for (const p of CITY_PLAN.ponds) {
      const d = Math.hypot(x - p.x, z - p.z);
      factor = Math.max(factor, 1 - smoothstep(p.radius * 0.75, p.radius + 10, d));
    }
    return factor;
  }

  /** The road surface height at a point: it follows the gentle shape of the land. */
  roadHeight(x: number, z: number): number {
    return Math.max(smoothHeight(x, z), WATER_LEVEL + BRIDGE_CLEARANCE);
  }

  /** Distance from a point to the EDGE of the nearest road (negative = on the road). */
  roadEdgeDistance(x: number, z: number, searchRadius: number, ignoreRoad?: Road): number {
    const r = searchRadius + this.maxRoadHalfWidth;
    let best = Infinity;
    for (const seg of this.roadGrid.query(x - r, z - r, x + r, z + r, this.roadHits)) {
      if (seg.road === ignoreRoad) continue;
      const a = seg.road.samples[seg.index];
      const b = seg.road.samples[seg.index + 1];
      const edge = distToSegment(x, z, a.x, a.z, b.x, b.z) - seg.road.halfWidth;
      if (edge < best) best = edge;
    }
    return best;
  }

  /** How strongly a point is pulled to a building's flat base (0..1), and that base's height. */
  buildingPad(x: number, z: number): { weight: number; height: number } {
    const r = this.maxLotRadius + PAD_BLEND;
    let weight = 0;
    let height = 0;
    for (const lot of this.lotGrid.query(x - r, z - r, x + r, z + r, this.lotHits)) {
      // Turn the point into the lot's own coordinates, so a rotated rectangle becomes a simple one.
      const dx = x - lot.x;
      const dz = z - lot.z;
      const cos = Math.cos(lot.angle);
      const sin = Math.sin(lot.angle);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const outX = Math.max(Math.abs(localX) - (lot.width / 2 + 1), 0);
      const outZ = Math.max(Math.abs(localZ) - (lot.depth / 2 + 1), 0);
      const w = 1 - smoothstep(0, PAD_BLEND, Math.hypot(outX, outZ));
      if (w > weight) {
        weight = w;
        height = lot.padHeight;
      }
    }
    return { weight, height };
  }

  /**
   * THE final ground height anywhere in the city. Starts from the natural land, then:
   * carves the river and ponds, flattens the ground under roads, and under buildings.
   */
  heightAt(x: number, z: number): number {
    const water = this.waterFactor(x, z);
    let h = lerp(landHeight(x, z), RIVER_BED, water);

    const dry = 1 - water; // never fill in the river: roads cross it on bridges instead
    const edge = this.roadEdgeDistance(x, z, SHOULDER);
    if (edge < SHOULDER) {
      const w = (1 - smoothstep(0.5, SHOULDER, edge)) * dry;
      if (w > 0) h = lerp(h, smoothHeight(x, z), w);
    }

    const pad = this.buildingPad(x, z);
    if (pad.weight > 0) h = lerp(h, pad.height, pad.weight * dry);
    return h;
  }

  /** Lowest the carved ground gets (river bed); used to decide whether a chunk needs water. */
  get riverBed(): number {
    return RIVER_BED;
  }

  /** How many trees grow here: forests and parks from the plan, a few in the countryside. */
  treeDensityAt(x: number, z: number): number {
    const green = areaAt(this.greens, x, z);
    if (green) return green.density;
    if (areaAt(this.districts, x, z)) return 0;
    return CITY_PLAN.countrysideTreeDensity;
  }

  /** True inside a park from the plan (where benches and bushes go). */
  isPark(x: number, z: number): boolean {
    return areaAt(this.greens, x, z)?.kind === 'park';
  }

  /** False if something placed here would stand in water, on a road, or on a building lot. */
  isSpotClear(x: number, z: number): boolean {
    if (this.waterFactor(x, z) > 0.001) return false;
    if (this.roadEdgeDistance(x, z, 2) < 2) return false;
    return this.buildingPad(x, z).weight === 0;
  }

  /** True if trees grow at this height (they stop at the treeline; rocks don't). */
  belowTreeline(x: number, z: number): boolean {
    return landHeight(x, z) < TREELINE;
  }

  /** Readable name of the place at a point, for the on-screen display. */
  placeName(x: number, z: number): string {
    const green = areaAt(this.greens, x, z);
    if (green) return green.name;
    const district = areaAt(this.districts, x, z);
    if (district) return district.name;
    if (mountainAmount(x, z) > 0.4) return 'Mountains';
    return 'Countryside';
  }

  /** Start position: on the road at the plan's spawn point, capsule centre just above ground. */
  spawnPoint(): Vec3 {
    const [x, z] = CITY_PLAN.spawn;
    return { x, y: this.heightAt(x, z) + 1.5, z };
  }

  // =========================================================================================
  // Building the layout (runs once)
  // =========================================================================================

  private buildRiver(): void {
    const { width, points } = CITY_PLAN.river;
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const count = Math.ceil(curve.getLength() / 8);
    const pts = curve.getSpacedPoints(count);
    const halfWidth = width / 2;
    const reach = halfWidth + RIVER_BANK;
    for (let i = 0; i < pts.length - 1; i++) {
      const s: RiverSegment = { ax: pts[i].x, az: pts[i].z, bx: pts[i + 1].x, bz: pts[i + 1].z, halfWidth };
      this.riverGrid.insert(s, Math.min(s.ax, s.bx) - reach, Math.min(s.az, s.bz) - reach,
        Math.max(s.ax, s.bx) + reach, Math.max(s.az, s.bz) + reach);
    }
  }

  /** Turns a list of points into a road: stores sample points, sideways directions, and indexes it. */
  private addRoad(name: string, width: number, points: { x: number; z: number }[]): void {
    if (points.length < 2) return;
    const road: Road = { id: this.roads.length, name, halfWidth: width / 2, samples: [] };
    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      road.samples.push({ x: points[i].x, z: points[i].z, nx: -tz, nz: tx }); // sideways = tangent turned 90°
    }
    this.roads.push(road);
    this.maxRoadHalfWidth = Math.max(this.maxRoadHalfWidth, road.halfWidth);

    for (let i = 0; i < road.samples.length - 1; i++) {
      const a = road.samples[i];
      const b = road.samples[i + 1];
      const hw = road.halfWidth;
      this.roadGrid.insert({ road, index: i }, Math.min(a.x, b.x) - hw, Math.min(a.z, b.z) - hw,
        Math.max(a.x, b.x) + hw, Math.max(a.z, b.z) + hw);
    }
  }

  private buildMainRoads(): void {
    for (const plan of CITY_PLAN.roads) {
      const curve = new THREE.CatmullRomCurve3(
        plan.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), plan.closed ?? false, 'centripetal'
      );
      const count = Math.max(2, Math.ceil(curve.getLength() / SAMPLE_STEP));
      this.addRoad(plan.name, plan.width, curve.getSpacedPoints(count).map((v) => ({ x: v.x, z: v.z })));
    }
  }

  /**
   * Each district gets a grid of streets at its own angle and spacing, cut to its outline.
   * The streets wobble gently, so they're "planned but not perfectly straight".
   */
  private buildDistrictStreets(): void {
    this.districts.forEach(({ plan }, districtIndex) => {
      const angle = THREE.MathUtils.degToRad(plan.streetAngle);
      const ux = Math.cos(angle);
      const uz = Math.sin(angle);
      const families: [number, number, number, number][] = [
        [ux, uz, -uz, ux],  // streets running along u, spaced along v
        [-uz, ux, ux, uz],  // the crossing streets
      ];

      families.forEach(([dirX, dirZ, offX, offZ], familyIndex) => {
        // How far the district reaches in the spacing direction.
        const offsets = plan.polygon.map(([x, z]) => x * offX + z * offZ);
        const first = Math.ceil(Math.min(...offsets) / plan.streetSpacing) * plan.streetSpacing;
        const last = Math.max(...offsets);
        const seed = STREET_SEED + districtIndex * 10 + familyIndex;

        for (let offset = first; offset <= last; offset += plan.streetSpacing) {
          const baseX = offX * offset;
          const baseZ = offZ * offset;
          for (const [t0, t1] of clipLineToPolygon(plan.polygon, baseX, baseZ, dirX, dirZ)) {
            if (t1 - t0 < 40) continue; // skip tiny leftovers at corners
            const start = t0 + 2;
            const end = t1 - 2;
            const steps = Math.ceil((end - start) / SAMPLE_STEP);
            let points: { x: number; z: number }[] = [];
            for (let k = 0; k <= steps; k++) {
              const t = start + ((end - start) * k) / steps;
              const wobble = (valueNoise(t / 80, offset / 50, seed) - 0.5) * 8;
              const x = baseX + offX * wobble + dirX * t;
              const z = baseZ + offZ * wobble + dirZ * t;
              // Parks and forests stay free of streets: cut the street where it enters one.
              if (areaAt(this.greens, x, z)) {
                if (points.length >= 10) this.addRoad(`${plan.name} street`, LOCAL_ROAD_WIDTH, points);
                points = [];
                continue;
              }
              points.push({ x, z });
            }
            if (points.length >= 10) this.addRoad(`${plan.name} street`, LOCAL_ROAD_WIDTH, points);
          }
        }
      });
    });
  }

  private contentOf(x: number, z: number): ChunkContent {
    const key = chunkKey(chunkOf(x), chunkOf(z));
    let c = this.content.get(key);
    if (!c) {
      c = { segments: [], bridges: [], lots: [], props: [] };
      this.content.set(key, c);
    }
    return c;
  }

  /** Gives every road piece to its owner chunk, and turns stretches over water into bridges. */
  private assignRoadsAndBridges(): void {
    for (const road of this.roads) {
      const s = road.samples;
      let bridgeStart = -1;
      for (let i = 0; i < s.length - 1; i++) {
        const midX = (s[i].x + s[i + 1].x) / 2;
        const midZ = (s[i].z + s[i + 1].z) / 2;
        const overWater = this.waterFactor(midX, midZ) > 0.02;

        if (overWater) {
          if (bridgeStart < 0) bridgeStart = i;
        } else {
          if (bridgeStart >= 0) this.addBridge(road, bridgeStart, i);
          bridgeStart = -1;
          this.contentOf(midX, midZ).segments.push({ road, index: i });
        }
      }
      if (bridgeStart >= 0) this.addBridge(road, bridgeStart, s.length - 1);
    }
  }

  private addBridge(road: Road, from: number, to: number): void {
    if ((to - from) * SAMPLE_STEP > MAX_BRIDGE_LENGTH) return; // runs along the water: leave it out
    const a = road.samples[from];
    const b = road.samples[to];
    // Extend 2 units past both ends so the deck overlaps the road on each bank.
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const ex = ((b.x - a.x) / len) * 2;
    const ez = ((b.z - a.z) / len) * 2;
    const top = (this.roadHeight(a.x, a.z) + this.roadHeight(b.x, b.z)) / 2 + 0.1;
    const bridge: Bridge = { x0: a.x - ex, z0: a.z - ez, x1: b.x + ex, z1: b.z + ez, halfWidth: road.halfWidth, top };
    this.bridges.push(bridge);
    this.contentOf((a.x + b.x) / 2, (a.z + b.z) / 2).bridges.push(bridge);
  }

  /** Places buildings along the roads inside districts, facing the street, without overlapping. */
  private buildLots(): void {
    for (const road of this.roads) {
      for (let i = LOT_EVERY; i < road.samples.length - LOT_EVERY; i += LOT_EVERY) {
        for (const side of [1, -1]) {
          this.tryPlaceLot(road, i, side);
        }
      }
    }
  }

  private tryPlaceLot(road: Road, sampleIndex: number, side: number): void {
    const s = road.samples[sampleIndex];
    const random = new Random(hash2(road.id * 4096 + sampleIndex, side + 7, LOT_SEED));
    const nx = s.nx * side;
    const nz = s.nz * side;

    // Peek at the district at a rough spot beside the road to pick a building style.
    const probe = road.halfWidth + SETBACK + 8;
    const district = areaAt(this.districts, s.x + nx * probe, s.z + nz * probe);
    if (!district) return;

    const spec = chooseBuilding(district.style, random);
    const along = road.halfWidth + SETBACK + spec.depth / 2;
    const x = s.x + nx * along;
    const z = s.z + nz * along;
    if (Math.abs(x) > WORLD_HALF - 100 || Math.abs(z) > WORLD_HALF - 100) return;
    if (areaAt(this.districts, x, z) !== district) return;
    if (areaAt(this.greens, x, z)) return; // keep parks and forests free

    // Face the road: the building's front (+Z) points back towards the street.
    const angle = Math.atan2(-nx, -nz);
    const radius = Math.hypot(spec.width, spec.depth) / 2 + 1;

    // Must not overlap another building.
    for (const other of this.lotGrid.query(x - radius, z - radius, x + radius, z + radius, this.lotHits)) {
      if (Math.hypot(other.x - x, other.z - z) < radius + other.radius) return;
    }

    // Check the corners: dry land, off every road, and not on a steep slope.
    const padHeight = smoothHeight(x, z);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]]) {
      const lx = (cx * spec.width) / 2;
      const lz = (cz * spec.depth) / 2;
      const px = x + lx * cos + lz * sin;   // local -> world
      const pz = z - lx * sin + lz * cos;
      if (this.waterFactor(px, pz) > 0.001) return;
      if (this.roadEdgeDistance(px, pz, 1) < 0.8) return;
      if (Math.abs(landHeight(px, pz) - padHeight) > 5) return;
    }

    const lot: Lot = { x, z, angle, ...spec, padHeight, radius };
    this.lots.push(lot);
    this.maxLotRadius = Math.max(this.maxLotRadius, radius);
    const r = radius + PAD_BLEND;
    this.lotGrid.insert(lot, x - r, z - r, x + r, z + r);
    this.contentOf(x, z).lots.push(lot);
  }

  /**
   * Street lights along roads inside districts, and cars parked along district streets.
   * Like everything else, decided once from fixed seeds: the same for every player.
   */
  private buildStreetProps(): void {
    for (const road of this.roads) {
      const s = road.samples;
      const isStreet = road.halfWidth * 2 === LOCAL_ROAD_WIDTH;

      for (let i = 4; i < s.length - 4; i++) {
        const random = new Random(hash2(road.id * 4096 + i, 3, PROP_SEED));
        const roll = random.next();
        const side = random.next() < 0.5 ? 1 : -1;
        const carType = random.pick(CAR_IDS);

        // ---------- Street lights: alternate sides, on the sidewalk ----------
        if (i % STREETLIGHT_EVERY === 0) {
          const lightSide = (i / STREETLIGHT_EVERY) % 2 === 0 ? 1 : -1;
          const nx = s[i].nx * lightSide;
          const nz = s[i].nz * lightSide;
          const x = s[i].x + nx * (road.halfWidth + 1.2);
          const z = s[i].z + nz * (road.halfWidth + 1.2);
          if (this.isGoodStreetSpot(x, z, road, 0.8)) {
            // The light's arm points along its local -X; turn it to hang over the road.
            this.contentOf(x, z).props.push({ prop: 'streetlight', x, z, angle: Math.atan2(-nz, nx), onRoad: false });
          }
        }

        // ---------- Parked cars: along district streets, in the kerb lane ----------
        if (isStreet && i % CAR_EVERY === 5 && roll < CAR_CHANCE) {
          const nx = s[i].nx * side;
          const nz = s[i].nz * side;
          const x = s[i].x + nx * (road.halfWidth - 1.4);
          const z = s[i].z + nz * (road.halfWidth - 1.4);
          // Keep clear of crossings: no other road within 6 units.
          if (this.isGoodStreetSpot(x, z, road, 6)) {
            const angle = Math.atan2(s[i].nz, -s[i].nx); // the car's front (+Z) points along the road
            this.contentOf(x, z).props.push({ prop: carType, x, z, angle, onRoad: true });
          }
        }
      }
    }
  }

  /** Inside a district, on dry land, clear of buildings and at least `clearance` from other roads. */
  private isGoodStreetSpot(x: number, z: number, road: Road, clearance: number): boolean {
    if (!areaAt(this.districts, x, z)) return false;
    if (this.waterFactor(x, z) > 0.001) return false;
    if (this.roadEdgeDistance(x, z, clearance, road) < clearance) return false;
    return this.buildingPad(x, z).weight < 0.99;
  }
}

/** What to build on a lot, by district style. All random values are drawn every time, in the same order. */
function chooseBuilding(style: DistrictStyle, random: Random):
  { kind: LotKind; building: BuildingId | null; width: number; depth: number; height: number; color: number } {
  const roll = random.next();
  const downtown = random.pick(DOWNTOWN_BUILDINGS);
  const residential = random.pick(RESIDENTIAL_BUILDINGS);
  const suburb = random.pick(SUBURB_BUILDINGS);
  const houseColor = random.pick(HOUSE_COLORS);

  const fromCatalog = (id: BuildingId) => {
    const b = BUILDINGS[id];
    return { kind: 'building' as const, building: id, width: b.width, depth: b.depth, height: b.height, color: 0 };
  };
  const house = { kind: 'house' as const, building: null, width: 12, depth: 10, height: 6, color: houseColor }; // matches HouseModel

  switch (style) {
    case 'downtown':
      return fromCatalog(downtown);
    case 'residential':
      return roll < 0.5 ? house : fromCatalog(residential);
    case 'suburb':
      return roll < 0.8 ? house : fromCatalog(suburb);
  }
}
