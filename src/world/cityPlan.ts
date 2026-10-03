// =============================================================================================
// THE CITY PLAN: the hand-designed layout of the whole city. Edit this file to shape the city.
//
// Coordinates are world units [x, z]. The city spans -3200 .. 3200 on both axes
// (80 x 80 chunks of 80 units). Spawn is near [0, 0], downtown.
// To find coordinates in-game, look at the on-screen display while walking.
//
// Everything here is plain data. CityLayout.ts turns it into roads, buildings and terrain,
// and the result is identical for every player.
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

export const CITY_PLAN = {
  /** Where players start. */
  spawn: [0, 0] as Point,

  /** Mountains rising along all four edges: a natural border for the city. */
  borderMountains: { band: 500, height: 150 },

  /** Extra mountains inside the city. */
  mountains: [
    { x: -1900, z: -1600, radius: 650, height: 170 },
    { x: 2100, z: 1800, radius: 550, height: 140 },
  ] as MountainPlan[],

  /** The river comes down from the northern mountains, passes east of downtown, and leaves south-east. */
  river: {
    width: 28,
    points: [[0, -3150], [-300, -2000], [200, -1100], [380, -300], [300, 400], [900, 1200], [1500, 2000], [2500, 3150]],
  } as RiverPlan,

  ponds: [
    { x: 210, z: 230, radius: 40 },   // in Central Park, west of the river
    { x: -1200, z: -700, radius: 70 },
  ] as PondPlan[],

  /** Main roads. Each district also gets its own street grid automatically. */
  roads: [
    {
      name: 'East-West Avenue',
      width: 12,
      points: [[-2700, 200], [-1600, 100], [-800, -50], [0, -80], [800, 100], [1600, -100], [2700, 150]],
    },
    {
      name: 'North-South Avenue',
      width: 12,
      points: [[-650, -2700], [-650, -1500], [-300, -700], [0, 0], [-100, 800], [100, 1600], [300, 2700]], // stays west of the river
    },
    {
      name: 'Ring Road',
      width: 12,
      closed: true,
      points: [[-900, -900], [0, -1100], [900, -800], [1150, 0], [800, 900], [0, 1150], [-900, 800], [-1150, 0]],
    },
  ] as RoadPlan[],

  districts: [
    {
      name: 'Downtown',
      style: 'downtown',
      polygon: [[-700, -500], [-200, -750], [500, -650], [750, -100], [600, 500], [0, 700], [-600, 450]],
      streetAngle: 10,
      streetSpacing: 90,
    },
    {
      name: 'Westside',
      style: 'residential',
      polygon: [[-1500, -300], [-750, -450], [-650, 500], [-900, 1100], [-1600, 900]],
      streetAngle: -18,
      streetSpacing: 70,
    },
    {
      name: 'Eastside',
      style: 'residential',
      polygon: [[800, -600], [1600, -500], [1800, 300], [1100, 800], [700, 500]],
      streetAngle: 25,
      streetSpacing: 70,
    },
    {
      name: 'South Hills',
      style: 'suburb',
      polygon: [[-500, 800], [400, 800], [700, 1500], [-200, 1800], [-800, 1400]],
      streetAngle: 5,
      streetSpacing: 85,
    },
  ] as DistrictPlan[],

  greens: [
    { name: 'Central Park', kind: 'park', polygon: [[150, 150], [480, 120], [520, 460], [180, 490]], density: 0.12 },
    { name: 'Old Forest', kind: 'forest', polygon: [[-2600, -2600], [-1300, -2700], [-1100, -1700], [-2300, -1300]], density: 0.65 },
    { name: 'East Woods', kind: 'forest', polygon: [[1400, 1000], [2400, 900], [2650, 2100], [1800, 2400]], density: 0.6 },
    { name: 'Lakeside Woods', kind: 'forest', polygon: [[-1500, -1000], [-900, -1050], [-950, -500], [-1450, -450]], density: 0.4 },
  ] as GreenPlan[],

  /** Trees scattered over open countryside (outside districts and greens). */
  countrysideTreeDensity: 0.05,
};
