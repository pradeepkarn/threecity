// Seeded random numbers.
//
// Math.random() gives different numbers every time, so a chunk would look different each
// time it loads. A SEEDED generator gives the same sequence for the same seed. If the seed
// comes from the chunk's coordinates, chunk (3, -2) is built identically every time.

/** Mixes two integers and a seed into one well-scrambled 32-bit number. */
export function hash2(x: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A small, fast seeded generator (the "mulberry32" algorithm). */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number from 0 (inclusive) to 1 (exclusive), like Math.random(). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A decimal number between min and max. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** A whole number between min and max, both included. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** A random item from a list. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}
