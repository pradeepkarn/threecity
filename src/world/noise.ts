import { hash2 } from './random';

// Smooth noise: random values on a grid, blended smoothly in between.
// Like everything in world generation, it's seeded, so the same (x, z) always gives the same value.

const fade = (t: number): number => t * t * (3 - 2 * t);

function lattice(ix: number, iz: number, seed: number): number {
  return hash2(ix, iz, seed) / 4294967296; // 0..1
}

/** Smooth noise between 0 and 1. Changes slowly: one "bump" per 1 unit of input. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * "Fractal" noise: several layers of noise, each twice as detailed and half as strong.
 * Big gentle shapes plus smaller bumps, like real landscapes. Result is 0..1.
 */
export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * frequency, z * frequency, seed + o * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/** Like fbm, but folded into sharp ridges: good for mountain crests. Result is 0..1. */
export function ridged(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2 * valueNoise(x * frequency, z * frequency, seed + o * 131) - 1);
    sum += n * n * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}
