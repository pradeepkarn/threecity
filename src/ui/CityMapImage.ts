import * as THREE from 'three';
import type { CityLayout } from '../world/CityLayout';
import { CITY_PLAN, type Point } from '../world/cityPlan';
import { WORLD_HALF } from '../world/config';
import { landHeight, mountainAmount } from '../world/terrain';

/** Resolution of the map picture: 2048 pixels for 6400 world units (about 3 units per pixel). */
export const MAP_SIZE = 2048;
const TERRAIN_GRID = 256; // terrain colours are sampled on a 256 x 256 grid, then smoothly enlarged

type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;
const browserCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/**
 * A picture of the whole city, drawn ONCE at startup from the same layout the world is built
 * from, so the map always matches the city exactly. The minimap and the big map both show
 * parts of this one picture.
 */
export class CityMapImage {
  readonly canvas: HTMLCanvasElement;
  /** Map pixels per world unit. */
  readonly scale = MAP_SIZE / (2 * WORLD_HALF);

  constructor(layout: CityLayout, createCanvas: CanvasFactory = browserCanvas) {
    this.canvas = createCanvas(MAP_SIZE, MAP_SIZE);
    const ctx = this.canvas.getContext('2d')!;
    this.drawTerrain(ctx, createCanvas);
    this.drawGreens(ctx);
    this.drawWater(ctx);
    this.drawRoads(ctx, layout);
    this.drawBuildings(ctx, layout);
  }

  /** World position -> map pixel. North (-Z) is up, like a normal map. */
  toMap(x: number, z: number): [number, number] {
    return [(x + WORLD_HALF) * this.scale, (z + WORLD_HALF) * this.scale];
  }

  /** Map pixel -> world position. */
  toWorld(px: number, py: number): [number, number] {
    return [px / this.scale - WORLD_HALF, py / this.scale - WORLD_HALF];
  }

  // ---------- Drawing (runs once) ----------

  private drawTerrain(ctx: CanvasRenderingContext2D, createCanvas: CanvasFactory): void {
    const small = createCanvas(TERRAIN_GRID, TERRAIN_GRID);
    const sctx = small.getContext('2d')!;
    const image = sctx.createImageData(TERRAIN_GRID, TERRAIN_GRID);
    const cell = (2 * WORLD_HALF) / TERRAIN_GRID;
    for (let j = 0; j < TERRAIN_GRID; j++) {
      for (let i = 0; i < TERRAIN_GRID; i++) {
        const x = -WORLD_HALF + (i + 0.5) * cell;
        const z = -WORLD_HALF + (j + 0.5) * cell;
        const h = landHeight(x, z);
        const rocky = mountainAmount(x, z);
        let r: number, g: number, b: number;
        if (h > 95) [r, g, b] = [244, 244, 240];                       // snow
        else if (h > 60 || rocky > 0.6) [r, g, b] = [150, 148, 140];   // rock
        else {
          const t = Math.min(1, Math.max(0, (h - 2) / 20));            // greener low, drier high
          [r, g, b] = [150 - 25 * t, 200 - 35 * t, 100 - 25 * t];
        }
        const k = (j * TERRAIN_GRID + i) * 4;
        image.data[k] = r;
        image.data[k + 1] = g;
        image.data[k + 2] = b;
        image.data[k + 3] = 255;
      }
    }
    sctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true; // blend the coarse grid smoothly when enlarging
    ctx.drawImage(small, 0, 0, MAP_SIZE, MAP_SIZE);
  }

  private polygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
    ctx.beginPath();
    points.forEach(([x, z], i) => {
      const [px, py] = this.toMap(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  private drawGreens(ctx: CanvasRenderingContext2D): void {
    for (const green of CITY_PLAN.greens) {
      ctx.fillStyle = green.kind === 'forest' ? 'rgba(39, 80, 10, 0.45)' : 'rgba(99, 153, 34, 0.45)';
      this.polygon(ctx, green.polygon);
      ctx.fill();
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#378ADD';
    ctx.fillStyle = '#378ADD';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const curve = new THREE.CatmullRomCurve3(
      CITY_PLAN.river.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal'
    );
    ctx.lineWidth = Math.max(3, CITY_PLAN.river.width * this.scale * 1.3);
    ctx.beginPath();
    curve.getSpacedPoints(400).forEach((p, i) => {
      const [px, py] = this.toMap(p.x, p.z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    for (const pond of CITY_PLAN.ponds) {
      const [px, py] = this.toMap(pond.x, pond.z);
      ctx.beginPath();
      ctx.arc(px, py, pond.radius * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRoads(ctx: CanvasRenderingContext2D, layout: CityLayout): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Streets first, main roads on top (wider and lighter, like a real map).
    const sorted = [...layout.roads].sort((a, b) => a.halfWidth - b.halfWidth);
    for (const road of sorted) {
      const main = road.halfWidth > 4.5;
      ctx.strokeStyle = main ? '#fbf6e9' : '#6f6d66';
      ctx.lineWidth = Math.max(main ? 3 : 1.4, road.halfWidth * 2 * this.scale);
      ctx.beginPath();
      road.samples.forEach((s, i) => {
        if (i % 3 !== 0 && i !== road.samples.length - 1) return; // every 6 units is plenty
        const [px, py] = this.toMap(s.x, s.z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = '#FAC775';
    ctx.lineWidth = 3;
    for (const b of layout.bridges) {
      const [x0, y0] = this.toMap(b.x0, b.z0);
      const [x1, y1] = this.toMap(b.x1, b.z1);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  private drawBuildings(ctx: CanvasRenderingContext2D, layout: CityLayout): void {
    for (const lot of layout.lots) {
      ctx.fillStyle = lot.kind === 'house' ? '#f3e3c4' : '#c9704a';
      const cos = Math.cos(lot.angle);
      const sin = Math.sin(lot.angle);
      ctx.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i) => {
        const lx = (sx * lot.width) / 2;
        const lz = (sz * lot.depth) / 2;
        const [px, py] = this.toMap(lot.x + lx * cos + lz * sin, lot.z - lx * sin + lz * cos);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    }
  }
}
