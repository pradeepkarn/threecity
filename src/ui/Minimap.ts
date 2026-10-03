import type { CityMapImage } from './CityMapImage';

export type MapPoint = { x: number; z: number };

const SIZE = 150;          // on-screen size in CSS pixels
const VIEW_RADIUS = 220;   // world units shown from the centre to the edge

/**
 * The round minimap in the top-right corner. Centred on the player, north up.
 * Shows the player's facing direction and, if one is set, the waypoint
 * (or an arrow on the rim pointing towards it when it's off the map).
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: CityMapImage;
  private readonly pixels: number; // real canvas pixels (sharper on high-density phone screens)

  constructor(map: CityMapImage, onClick: () => void) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.pixels = Math.round(SIZE * Math.min(window.devicePixelRatio, 2));
    this.canvas.width = this.pixels;
    this.canvas.height = this.pixels;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    this.canvas.addEventListener('click', onClick);
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Redraws the minimap. `heading` is the player's rotation (radians, 0 = facing +Z / south). */
  draw(player: MapPoint, heading: number, waypoint: MapPoint | null): void {
    const { ctx, pixels: D, map } = this;
    const half = D / 2;
    ctx.clearRect(0, 0, D, D);

    // Everything inside a circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();

    // Copy the part of the city picture around the player.
    const [mx, my] = map.toMap(player.x, player.z);
    const src = VIEW_RADIUS * map.scale;
    ctx.fillStyle = '#8a8780';
    ctx.fillRect(0, 0, D, D);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map.canvas, mx - src, my - src, src * 2, src * 2, 0, 0, D, D);

    // Waypoint: a pin if it's within range, otherwise an arrow on the rim.
    if (waypoint) {
      const dx = ((waypoint.x - player.x) / VIEW_RADIUS) * half;
      const dy = ((waypoint.z - player.z) / VIEW_RADIUS) * half;
      const dist = Math.hypot(dx, dy);
      if (dist < half - 10) {
        this.pin(half + dx, half + dy);
      } else {
        const angle = Math.atan2(dy, dx);
        const r = half - 12;
        this.triangle(half + Math.cos(angle) * r, half + Math.sin(angle) * r, angle, '#E24B4A', 9);
      }
    }
    ctx.restore();

    // The player: an arrow in the middle pointing the way they face.
    // Facing +Z (heading 0) is "down" on the map, because north (-Z) is up.
    const facing = Math.atan2(Math.cos(heading), Math.sin(heading));
    this.triangle(half, half, facing, '#ffffff', 11, '#2C2C2A');

    // Rim and north marker.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#2C2C2A';
    ctx.font = `bold ${Math.round(D * 0.09)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', half, 6);
  }

  private triangle(x: number, y: number, angle: number, fill: string, size: number, stroke?: string): void {
    const { ctx } = this;
    const s = size * (this.pixels / SIZE);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, s * 0.65);
    ctx.lineTo(-s * 0.35, 0);
    ctx.lineTo(-s * 0.7, -s * 0.65);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    ctx.restore();
  }

  private pin(x: number, y: number): void {
    const { ctx } = this;
    const s = 6 * (this.pixels / SIZE);
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fillStyle = '#E24B4A';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}
