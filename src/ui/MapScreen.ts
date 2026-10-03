import type { CityMapImage } from './CityMapImage';
import type { MapPoint } from './Minimap';
import { CITY_PLAN, type Point } from '../world/cityPlan';
import { WORLD_HALF } from '../world/config';

/** A named place for quick travel: the centre of a district, park or forest. */
interface Place { name: string; x: number; z: number }

function centre(points: Point[]): MapPoint {
  const x = points.reduce((s, p) => s + p[0], 0) / points.length;
  const z = points.reduce((s, p) => s + p[1], 0) / points.length;
  return { x, z };
}

const MIN_ZOOM = 0.08; // screen pixels per world unit (whole city visible)
const MAX_ZOOM = 2.5;  // close-up

/**
 * The full-screen city map. Drag to move, pinch / mouse wheel / buttons to zoom.
 * Tap a spot to select it, then "Set waypoint" or "Travel here".
 */
export class MapScreen {
  /** Called when the player chooses to travel somewhere. */
  onTravel: (target: MapPoint) => void = () => {};
  /** Called when the waypoint is set or cleared. */
  onWaypoint: (target: MapPoint | null) => void = () => {};
  /** Turns a world position into a place name (from the city layout). */
  describe: (target: MapPoint) => string = () => '';

  private readonly map: CityMapImage;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private readonly panelTitle: HTMLDivElement;
  private readonly panelInfo: HTMLDivElement;
  private readonly places: Place[];

  private open = false;
  private centerX = 0;   // world point shown in the middle of the screen
  private centerZ = 0;
  private zoom = 0.3;
  private player: MapPoint = { x: 0, z: 0 };
  private heading = 0;
  private waypoint: MapPoint | null = null;
  private selected: MapPoint | null = null;

  // Touch / mouse tracking for dragging and pinching.
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragDistance = 0;
  private pinchStart = 0;
  private zoomAtPinchStart = 1;

  constructor(map: CityMapImage) {
    this.map = map;
    this.places = [
      { name: 'Spawn', x: CITY_PLAN.spawn[0], z: CITY_PLAN.spawn[1] },
      ...CITY_PLAN.districts.map((d) => ({ name: d.name, ...centre(d.polygon) })),
      ...CITY_PLAN.greens.map((g) => ({ name: g.name, ...centre(g.polygon) })),
    ];

    this.root = document.createElement('div');
    this.root.id = 'map-screen';
    this.root.innerHTML = `
      <div class="map-top">
        <span class="map-title">City map</span>
        <div class="map-zoom">
          <button data-zoom="out" aria-label="Zoom out">−</button>
          <button data-zoom="in" aria-label="Zoom in">+</button>
          <button data-zoom="me">Me</button>
          <button data-close aria-label="Close map">✕</button>
        </div>
      </div>
      <canvas></canvas>
      <div class="map-places"></div>
      <div class="map-panel">
        <div class="map-panel-title"></div>
        <div class="map-panel-info"></div>
        <div class="map-panel-buttons">
          <button data-action="waypoint">Set waypoint</button>
          <button data-action="travel" class="primary">Travel here</button>
          <button data-action="cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);

    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.panel = this.root.querySelector('.map-panel')!;
    this.panelTitle = this.root.querySelector('.map-panel-title')!;
    this.panelInfo = this.root.querySelector('.map-panel-info')!;

    // Quick-travel chips.
    const chips = this.root.querySelector('.map-places')!;
    for (const place of this.places) {
      const chip = document.createElement('button');
      chip.textContent = place.name;
      chip.addEventListener('click', () => this.select({ x: place.x, z: place.z }, place.name, true));
      chips.appendChild(chip);
    }

    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    this.root.querySelector('[data-zoom="in"]')!.addEventListener('click', () => this.zoomBy(1.6));
    this.root.querySelector('[data-zoom="out"]')!.addEventListener('click', () => this.zoomBy(1 / 1.6));
    this.root.querySelector('[data-zoom="me"]')!.addEventListener('click', () => {
      this.centerX = this.player.x;
      this.centerZ = this.player.z;
      this.draw();
    });
    this.root.querySelector('[data-action="waypoint"]')!.addEventListener('click', () => {
      if (!this.selected) return;
      this.waypoint = { ...this.selected };
      this.onWaypoint(this.waypoint);
      this.close();
    });
    this.root.querySelector('[data-action="travel"]')!.addEventListener('click', () => {
      if (!this.selected) return;
      const target = { ...this.selected };
      this.close();
      this.onTravel(target);
    });
    this.root.querySelector('[data-action="cancel"]')!.addEventListener('click', () => this.select(null));

    this.setupGestures();
    window.addEventListener('resize', () => this.open && this.draw());
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(player: MapPoint, heading: number, waypoint: MapPoint | null): void {
    this.player = player;
    this.heading = heading;
    this.waypoint = waypoint;
    this.centerX = player.x;
    this.centerZ = player.z;
    this.open = true;
    this.root.classList.add('open');
    this.select(null);
    this.draw();
  }

  close(): void {
    this.open = false;
    this.root.classList.remove('open');
  }

  // ---------- Selecting a spot ----------

  private select(point: MapPoint | null, name?: string, centreOnIt = false): void {
    this.selected = point;
    if (point) {
      const distance = Math.round(Math.hypot(point.x - this.player.x, point.z - this.player.z));
      this.panelTitle.textContent = name ?? this.describe(point);
      this.panelInfo.textContent = `${distance} m away  ·  x ${Math.round(point.x)}, z ${Math.round(point.z)}`;
      this.panel.classList.add('open');
      if (centreOnIt) {
        this.centerX = point.x;
        this.centerZ = point.z;
      }
    } else {
      this.panel.classList.remove('open');
    }
    this.draw();
  }

  // ---------- Coordinates ----------

  private screenToWorld(sx: number, sy: number): MapPoint {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: this.centerX + (sx - w / 2) / this.zoom, z: this.centerZ + (sy - h / 2) / this.zoom };
  }

  private worldToScreen(x: number, z: number): [number, number] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return [w / 2 + (x - this.centerX) * this.zoom, h / 2 + (z - this.centerZ) * this.zoom];
  }

  private zoomBy(factor: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.draw();
  }

  // ---------- Dragging, pinching, tapping ----------

  private setupGestures(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragDistance = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAtPinchStart = this.zoom;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragDistance += Math.hypot(dx, dy);
        this.centerX -= dx / this.zoom;
        this.centerZ -= dy / this.zoom;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const now = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoomAtPinchStart * (now / this.pinchStart)));
        this.dragDistance = 999; // a pinch is never a tap
      }
      this.draw();
    });
    const end = (e: PointerEvent): void => {
      const wasTap = this.pointers.size === 1 && this.dragDistance < 8;
      this.pointers.delete(e.pointerId);
      if (wasTap) {
        const rect = c.getBoundingClientRect();
        this.select(this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top));
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  }

  // ---------- Drawing ----------

  private draw(): void {
    if (!this.open) return;
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    // Keep the view inside the city.
    this.centerX = Math.min(WORLD_HALF, Math.max(-WORLD_HALF, this.centerX));
    this.centerZ = Math.min(WORLD_HALF, Math.max(-WORLD_HALF, this.centerZ));

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#5f5e5a';
    ctx.fillRect(0, 0, w, h);

    // The city picture, positioned and scaled.
    const [left, top] = this.worldToScreen(-WORLD_HALF, -WORLD_HALF);
    const size = 2 * WORLD_HALF * this.zoom;
    ctx.imageSmoothingEnabled = this.zoom < 0.6;
    ctx.drawImage(this.map.canvas, left, top, size, size);

    // Place names.
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const place of this.places) {
      if (place.name === 'Spawn') continue;
      const [x, y] = this.worldToScreen(place.x, place.z);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(place.name, x, y);
      ctx.fillStyle = '#2C2C2A';
      ctx.fillText(place.name, x, y);
    }

    if (this.waypoint) this.marker(this.waypoint, '#E24B4A');
    if (this.selected) this.marker(this.selected, '#185FA5');

    // The player.
    const [px, py] = this.worldToScreen(this.player.x, this.player.z);
    const facing = Math.atan2(Math.cos(this.heading), Math.sin(this.heading));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(facing);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, -8);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#2C2C2A';
    ctx.stroke();
    ctx.restore();
  }

  private marker(point: MapPoint, color: string): void {
    const [x, y] = this.worldToScreen(point.x, point.z);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y - 16, 8, Math.PI * 0.75, Math.PI * 2.25);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 16, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}
