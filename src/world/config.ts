// World-wide settings shared by every part of the city.

/** Size of one chunk in world units. */
export const CHUNK_SIZE = 80;

/** The city is WORLD_CHUNKS x WORLD_CHUNKS chunks: 80 x 80 chunks = 6400 x 6400 units. */
export const WORLD_CHUNKS = 80;

/** The world spans from -WORLD_HALF to +WORLD_HALF on both X and Z. */
export const WORLD_HALF = (CHUNK_SIZE * WORLD_CHUNKS) / 2;

/** Chunk coordinates run from MIN_CHUNK to MAX_CHUNK on both axes (-40 .. 39). */
export const MIN_CHUNK = -WORLD_CHUNKS / 2;
export const MAX_CHUNK = WORLD_CHUNKS / 2 - 1;

/** Height of the river and pond surfaces. */
export const WATER_LEVEL = 0;

/** Changing this changes every generated detail (bumps, tree spots, building choices). */
export const WORLD_SEED = 12345;

/** Which chunk a world X or Z position falls in. Chunk c covers [c * 80, (c + 1) * 80). */
export function chunkOf(position: number): number {
  return Math.floor(position / CHUNK_SIZE);
}

/** Map key for a chunk, e.g. "3,-2". */
export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
