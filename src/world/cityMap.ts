import type { Random } from './random';

// =============================================================================================
// THE CITY MAP: decides what every chunk contains, using only its coordinates.
//
// The city is FIXED: the same coordinates always give the same chunk, on every device, for
// every player. Nothing here uses Math.random(). Each chunk is decided in this order:
//
//   1. HAND_MADE_CHUNKS  -> if you designed this chunk yourself, use your design
//   2. districtOf()      -> otherwise, its district (by coordinate) sets the style
//   3. designChunk()     -> the district's rules fill the 4 plots, using the chunk's own seed
//
// Rule: once players are using the city, only ADD hand-made chunks or new districts far away.
// Changing rules for existing areas changes those chunks for everyone (which is fine, as long
// as it's intentional and everyone runs the same game version).
// =============================================================================================

/**
 * What goes on one plot. Every number is optional: anything you leave out is filled in
 * by the chunk's seeded random, so it's still the same for every player.
 */
export type PlotSpec =
  | { type: 'tower'; width?: number; depth?: number; height?: number; color?: number }
  | { type: 'house'; color?: number }
  | { type: 'park'; trees?: number }
  | { type: 'playground' }
  | { type: 'empty' };

/**
 * One chunk's design. The 4 plots, seen from above (+X right, +Z up):
 *
 *     plot 2 | plot 3
 *     -------+-------
 *     plot 0 | plot 1
 */
export interface ChunkDesign {
  plots: [PlotSpec, PlotSpec, PlotSpec, PlotSpec];
}

// ---------------------------------------------------------------------------------------------
// 1. HAND-MADE CHUNKS. Key = "cx,cz". Add your own designs here.
//    To find a chunk's coordinates, walk there and read the top-left display.
// ---------------------------------------------------------------------------------------------
export const HAND_MADE_CHUNKS: Record<string, ChunkDesign> = {
  // Spawn chunk: a house to walk into, the ramp/stairs test area, a park and a landmark tower.
  '0,0': {
    plots: [
      { type: 'house', color: 0xfaeeda },
      { type: 'playground' },
      { type: 'park', trees: 5 },
      { type: 'tower', width: 18, depth: 18, height: 30, color: 0xb5d4f4 },
    ],
  },

  // Example: a "central park" chunk right next to spawn, all trees.
  '1,0': {
    plots: [
      { type: 'park', trees: 6 },
      { type: 'park', trees: 6 },
      { type: 'park', trees: 6 },
      { type: 'park', trees: 6 },
    ],
  },

  // Example: a street of four houses north of spawn.
  '0,1': {
    plots: [
      { type: 'house' },
      { type: 'house' },
      { type: 'house' },
      { type: 'house' },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// 2. DISTRICTS. Decide the style of an area from its coordinates.
//    Here they're rings around the centre, but any rule works:
//    e.g. `if (cx > 20) return 'industrial'` makes everything east of chunk 20 industrial.
// ---------------------------------------------------------------------------------------------
export type District = 'downtown' | 'residential' | 'outskirts';

export function districtOf(cx: number, cz: number): District {
  const ring = Math.max(Math.abs(cx), Math.abs(cz)); // how many chunks away from the centre
  if (ring <= 2) return 'downtown';
  if (ring <= 6) return 'residential';
  return 'outskirts';
}

// ---------------------------------------------------------------------------------------------
// 3. FILL RULES. What each district's plots tend to contain.
// ---------------------------------------------------------------------------------------------
function plotFor(district: District, random: Random): PlotSpec {
  const roll = random.next();
  switch (district) {
    case 'downtown':     // mostly tall towers
      if (roll < 0.75) return { type: 'tower', height: random.int(18, 40) };
      return { type: 'park', trees: random.int(2, 4) };

    case 'residential':  // mostly houses, some parks and small buildings
      if (roll < 0.6) return { type: 'house' };
      if (roll < 0.8) return { type: 'park' };
      return { type: 'tower', height: random.int(8, 14) };

    case 'outskirts':    // open, green, a few buildings
      if (roll < 0.5) return { type: 'park', trees: random.int(2, 6) };
      if (roll < 0.8) return { type: 'house' };
      return { type: 'empty' };
  }
}

/** The design for any chunk in the infinite city. `random` must be seeded from the chunk's coordinates. */
export function designChunk(cx: number, cz: number, random: Random): ChunkDesign {
  const handMade = HAND_MADE_CHUNKS[`${cx},${cz}`];
  if (handMade) return handMade;

  const district = districtOf(cx, cz);
  return {
    plots: [plotFor(district, random), plotFor(district, random), plotFor(district, random), plotFor(district, random)],
  };
}
