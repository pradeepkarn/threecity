import type { CharacterAnimation } from './types';

// =============================================================================================
// THE MODEL CATALOG: every GLB file the game uses, with its size and scale.
// The files live in /public/models (KayKit packs by Kay Lousberg, CC0 licence).
//
// Sizes are measured from the files (in the model's own units). The city layout needs them
// BEFORE anything is loaded, to know how much ground each building takes up.
// To add a model: put the .glb in public/models, then add an entry here.
// =============================================================================================

const M = '/models';

// ---------- Buildings (doors and windows face +Z; the backs are plain) ----------
/** One KayKit floor is ~0.5 units; x7.5 makes a floor ~3.5 m and the door fit the player. */
export const BUILDING_SCALE = 7.5;

export type BuildingId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface BuildingInfo { url: string; width: number; height: number; depth: number } // world units

function building(id: BuildingId, w: number, h: number, d: number): BuildingInfo {
  return { url: `${M}/city/building_${id}.glb`, width: w * BUILDING_SCALE, height: h * BUILDING_SCALE, depth: d * BUILDING_SCALE };
}

export const BUILDINGS: Record<BuildingId, BuildingInfo> = {
  A: building('A', 1.21, 1.45, 1.45), // 3 floors, narrow
  B: building('B', 1.61, 1.45, 1.30), // 3 floors, wide
  C: building('C', 1.21, 2.15, 1.30), // 4 floors
  D: building('D', 1.61, 2.15, 1.30),
  E: building('E', 2.01, 2.15, 1.45),
  F: building('F', 2.01, 2.15, 1.30),
  G: building('G', 2.01, 2.15, 1.45),
  H: building('H', 2.01, 2.85, 1.30), // 6 floors, the tallest
};

/** Which buildings each district style picks from. */
export const DOWNTOWN_BUILDINGS: BuildingId[] = ['C', 'D', 'E', 'F', 'G', 'H', 'H'];
export const RESIDENTIAL_BUILDINGS: BuildingId[] = ['A', 'B', 'C', 'D'];
export const SUBURB_BUILDINGS: BuildingId[] = ['A', 'B'];

// ---------- Props: drawn with instancing ----------
export interface PropInfo {
  url: string;
  scale: number;                 // default scale
  size: [number, number, number]; // model units (width, height, depth), for colliders
  sinkIntoGround?: boolean;      // true: base goes slightly below ground (trees, rocks); otherwise it rests on top
}

export type PropId =
  | 'streetlight' | 'bench' | 'bush'
  | 'car_sedan' | 'car_taxi' | 'car_hatchback' | 'car_stationwagon' | 'car_police'
  | 'tree_A' | 'tree_B' | 'rock_A' | 'rock_C' | 'rock_E';

export const PROPS: Record<PropId, PropInfo> = {
  streetlight: { url: `${M}/city/streetlight.glb`, scale: 7.5, size: [0.27, 0.96, 0.07] }, // arm points to -X
  bench: { url: `${M}/city/bench.glb`, scale: 7.5, size: [0.4, 0.1, 0.15] },
  bush: { url: `${M}/city/bush.glb`, scale: 4, size: [0.19, 0.38, 0.2] },
  car_sedan: { url: `${M}/city/car_sedan.glb`, scale: 6, size: [0.42, 0.37, 0.94] },
  car_taxi: { url: `${M}/city/car_taxi.glb`, scale: 6, size: [0.42, 0.43, 0.94] },
  car_hatchback: { url: `${M}/city/car_hatchback.glb`, scale: 6, size: [0.42, 0.37, 0.81] },
  car_stationwagon: { url: `${M}/city/car_stationwagon.glb`, scale: 6, size: [0.42, 0.37, 0.94] },
  car_police: { url: `${M}/city/car_police.glb`, scale: 6, size: [0.42, 0.41, 0.94] },
  tree_A: { url: `${M}/nature/tree_single_A.glb`, scale: 6, size: [0.57, 1.2, 0.55], sinkIntoGround: true },
  tree_B: { url: `${M}/nature/tree_single_B.glb`, scale: 6, size: [0.68, 1.21, 0.72], sinkIntoGround: true },
  rock_A: { url: `${M}/nature/rock_single_A.glb`, scale: 20, size: [0.3, 0.07, 0.28], sinkIntoGround: true },
  rock_C: { url: `${M}/nature/rock_single_C.glb`, scale: 20, size: [0.34, 0.19, 0.34], sinkIntoGround: true },
  rock_E: { url: `${M}/nature/rock_single_E.glb`, scale: 20, size: [0.49, 0.19, 0.35], sinkIntoGround: true },
};

export const CAR_IDS: PropId[] = ['car_sedan', 'car_taxi', 'car_hatchback', 'car_stationwagon', 'car_sedan', 'car_police'];

/** Tree trunk collider, in model units (scaled with the tree). */
export const TREE_TRUNK = { radius: 0.05, height: 0.6 };

// ---------- Furniture (inside houses) ----------
export const FURNITURE_SCALE = 0.75;
export const FURNITURE = {
  bed: `${M}/furniture/bed_double_A.glb`,
  couch: `${M}/furniture/couch_pillows.glb`,
  armchair: `${M}/furniture/armchair_pillows.glb`,
  table: `${M}/furniture/table_medium.glb`,
  chair: `${M}/furniture/chair_A_wood.glb`,
  lamp: `${M}/furniture/lamp_standing.glb`,
  rug: `${M}/furniture/rug_rectangle_stripes_A.glb`,
  cabinet: `${M}/furniture/cabinet_medium_decorated.glb`,
};

// ---------- Characters (face +Z; each has 20 animations, weapons removed) ----------
export const CHARACTERS = {
  rogue: `${M}/characters/Rogue.glb`,
  mage: `${M}/characters/Mage.glb`,
  knight: `${M}/characters/Knight.glb`,
  barbarian: `${M}/characters/Barbarian.glb`,
};
export type CharacterId = keyof typeof CHARACTERS;
export const DEFAULT_CHARACTER: CharacterId = 'rogue';

/** Which animation clip inside the GLB plays for each thing the game asks for. */
export const CHARACTER_CLIPS: Record<CharacterAnimation, string> = {
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  jump: 'Jump_Idle',
};
