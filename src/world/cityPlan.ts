import planData from './cityPlan.json';

// =============================================================================================
// THE CITY PLAN: the hand-designed layout of the whole city.
//
// The plan itself lives in cityPlan.json, so it can be edited VISUALLY with the planner
// (open /planner.html while `npm run dev` is running) as well as by hand.
// This file only describes its shape (the types) and loads it.
//
// Coordinates are world units [x, z]. The city spans -3200 .. 3200 on both axes.
// =============================================================================================

/** A point on the map: [x, z]. */
export type Point = [number, number];

export interface MountainPlan {
  x: number;
  z: number;
  radius: number; // how far the slopes reach
  height: number; // peak height above the plains
}

export interface RiverPlan {
  width: number;
  points: Point[]; // smoothed into a curve through these points
}

export interface PondPlan {
  x: number;
  z: number;
  radius: number;
}

export interface RoadPlan {
  name: string;
  width: number;
  points: Point[];  // smoothed into a curve that passes through every point
  closed?: boolean; // true = loops back to the first point (a ring road)
}

export type DistrictStyle = 'downtown' | 'residential' | 'suburb';

export interface DistrictPlan {
  name: string;
  style: DistrictStyle;  // decides what kind of buildings appear
  polygon: Point[];      // the district's outline
  streetAngle: number;   // degrees: each district's streets run at their own angle
  streetSpacing: number; // distance between parallel streets
}

export interface GreenPlan {
  name: string;
  kind: 'forest' | 'park';
  polygon: Point[];
  density: number; // 0 = no trees, 1 = a tree on every possible spot
}

export interface CityPlan {
  spawn: Point;
  borderMountains: { band: number; height: number };
  mountains: MountainPlan[];
  river: RiverPlan;
  ponds: PondPlan[];
  roads: RoadPlan[];
  districts: DistrictPlan[];
  greens: GreenPlan[];
  countrysideTreeDensity: number;
}

/** The current plan. Every part of the game reads this one object. */
export const CITY_PLAN: CityPlan = structuredClone(planData as unknown as CityPlan);

/** Swaps in a new plan (used by the planner to preview edits live). */
export function replaceCityPlan(plan: CityPlan): void {
  Object.assign(CITY_PLAN, structuredClone(plan));
}
