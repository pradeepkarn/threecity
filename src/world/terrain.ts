import { WORLD_HALF, WORLD_SEED, smoothstep } from './config';
import { CITY_PLAN } from './cityPlan';
import { fbm, ridged } from './noise';

// The natural shape of the land, before roads, buildings and water change it.
// Split in two parts on purpose:
//   smoothHeight -> only big, gentle shapes. Roads and building pads follow THIS,
//                   so roads climb hills gently and two crossing roads always meet at the same height.
//   landHeight   -> smoothHeight plus small bumps and rocky mountain detail. This is the natural ground.

/** 0 on the plains, rising to 1 in the mountains. */
export function mountainAmount(x: number, z: number): number {
  const { band } = CITY_PLAN.borderMountains;
  const edgeDistance = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z));
  let amount = 1 - smoothstep(0, band, edgeDistance);
  for (const m of CITY_PLAN.mountains) {
    amount = Math.max(amount, 1 - smoothstep(0, m.radius, Math.hypot(x - m.x, z - m.z)));
  }
  return amount;
}

/** Big, gentle landscape shape: rolling plains plus the mountain bodies. */
export function smoothHeight(x: number, z: number): number {
  let h = 3 + fbm(x / 600, z / 600, WORLD_SEED + 1, 3) * 10; // plains roll between ~3 and ~13

  const { band, height } = CITY_PLAN.borderMountains;
  const edgeDistance = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z));
  const border = 1 - smoothstep(0, band, edgeDistance);
  h += border * border * height;

  for (const m of CITY_PLAN.mountains) {
    const t = 1 - smoothstep(0, m.radius, Math.hypot(x - m.x, z - m.z));
    h += t * t * m.height;
  }
  return h;
}

/** The natural ground: gentle shape plus small bumps, and rocky ridges in the mountains. */
export function landHeight(x: number, z: number): number {
  let h = smoothHeight(x, z);
  h += (fbm(x / 60, z / 60, WORLD_SEED + 2, 3) - 0.5) * 2.5; // small ups and downs everywhere
  const mountains = mountainAmount(x, z);
  if (mountains > 0) {
    h += mountains * (ridged(x / 160, z / 160, WORLD_SEED + 3, 4) - 0.4) * 70; // peaks and valleys
  }
  return h;
}
