import * as THREE from 'three';
import type { EnterableBuildingModel, LocalBox } from './types';
import { cloneStatic } from './assets';
import { FURNITURE, FURNITURE_SCALE } from './catalog';
import { bakeMeshes, enableShadows } from './utils';

// House dimensions in local space. The front door is in the +Z wall.
const WIDTH = 12;   // along X
const DEPTH = 10;   // along Z
const HEIGHT = 4;   // wall height
const WALL = 0.3;   // wall thickness
const DOOR_W = 2.2;
const DOOR_H = 2.8;
const ROOF_RISE = 1.6;
const FLOOR_TOP = 0.04;

type Tuple3 = [number, number, number];

/** Where each piece of furniture goes inside the house: [x, z, rotation]. */
const FURNITURE_LAYOUT: { url: string; x: number; z: number; turn: number; solid: boolean }[] = [
  { url: FURNITURE.bed, x: -4.4, z: -3.45, turn: 0, solid: true },                 // back-left corner
  { url: FURNITURE.cabinet, x: -1.2, z: -4.25, turn: 0, solid: true },             // against the back wall
  { url: FURNITURE.table, x: 2.5, z: -2.0, turn: 0, solid: true },
  { url: FURNITURE.chair, x: 2.5, z: -3.2, turn: 0, solid: true },                 // facing the table
  { url: FURNITURE.chair, x: 2.5, z: -0.8, turn: Math.PI, solid: true },
  { url: FURNITURE.lamp, x: 5.2, z: -4.2, turn: 0, solid: true },
  { url: FURNITURE.couch, x: 5.05, z: 1.8, turn: -Math.PI / 2, solid: true },      // against the right wall
  { url: FURNITURE.armchair, x: 2.2, z: 3.3, turn: Math.PI / 2, solid: true },     // facing the couch
  { url: FURNITURE.rug, x: 3.7, z: 2.0, turn: 0, solid: false },                   // flat: no collider
];

/**
 * A house you can walk into. The SHELL (walls, roof, windows) is built in code, because it
 * needs a real door opening and an inside. The FURNITURE is loaded from GLB files.
 */
export async function loadHouseModel(wallColor = 0xf1efe8): Promise<EnterableBuildingModel> {
  const root = new THREE.Group();
  const roof = new THREE.Group();
  root.add(roof);
  const colliders: LocalBox[] = [];

  const mat = (color: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color });
  const wallMat = mat(wallColor);
  const roofMat = mat(0x993c1d);
  const wood = mat(0x8a5a2b);
  const floorMat = mat(0xc9a27a);
  const glass = mat(0xb5d4f4);

  // Adds one box-shaped part. If `solid`, also records an identical collider box.
  function part(size: Tuple3, pos: Tuple3, material: THREE.Material,
                solid: boolean, parent: THREE.Object3D = root): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    parent.add(mesh);
    if (solid) colliders.push({ center: new THREE.Vector3(...pos), size: new THREE.Vector3(...size) });
    return mesh;
  }

  const halfW = WIDTH / 2;
  const halfD = DEPTH / 2;

  // ---------- Walls ----------
  part([WIDTH, HEIGHT, WALL], [0, HEIGHT / 2, -halfD + WALL / 2], wallMat, true);              // back
  part([WALL, HEIGHT, DEPTH - 2 * WALL], [-halfW + WALL / 2, HEIGHT / 2, 0], wallMat, true);   // left
  part([WALL, HEIGHT, DEPTH - 2 * WALL], [halfW - WALL / 2, HEIGHT / 2, 0], wallMat, true);    // right

  // Front wall = left piece + right piece + beam above the door, leaving a gap to walk through.
  const sideW = halfW - DOOR_W / 2;
  const frontZ = halfD - WALL / 2;
  part([sideW, HEIGHT, WALL], [-(DOOR_W / 2 + sideW / 2), HEIGHT / 2, frontZ], wallMat, true);
  part([sideW, HEIGHT, WALL], [DOOR_W / 2 + sideW / 2, HEIGHT / 2, frontZ], wallMat, true);
  part([DOOR_W, HEIGHT - DOOR_H, WALL], [0, DOOR_H + (HEIGHT - DOOR_H) / 2, frontZ], wallMat, true);

  // The door itself, swung open against the inside of the wall.
  const doorLen = DOOR_W - 0.2;
  part([0.08, DOOR_H - 0.05, doorLen], [-DOOR_W / 2 + 0.04, (DOOR_H - 0.05) / 2, halfD - WALL - doorLen / 2], wood, true);

  // ---------- Windows (visual only, on both faces of the wall) ----------
  for (const z of [-2.5, 2.5]) {
    for (const x of [halfW + 0.01, halfW - WALL - 0.01, -halfW - 0.01, -halfW + WALL + 0.01]) {
      part([0.04, 1.3, 1.6], [x, 2.2, z], glass, false);
    }
  }
  for (const x of [-3, 3]) {
    for (const z of [-halfD - 0.01, -halfD + WALL + 0.01]) {
      part([1.6, 1.3, 0.04], [x, 2.2, z], glass, false);
    }
  }

  // ---------- Floor ----------
  part([WIDTH - 2 * WALL, FLOOR_TOP, DEPTH - 2 * WALL], [0, FLOOR_TOP / 2, 0], floorMat, false);

  // ---------- Roof (a separate group so it can be hidden) ----------
  const run = halfD + 0.4;
  const slopeLen = Math.hypot(run, ROOF_RISE);
  const slopeAngle = Math.atan2(ROOF_RISE, run);
  for (const side of [1, -1]) {
    const slope = part([WIDTH + 0.6, 0.2, slopeLen], [0, HEIGHT + ROOF_RISE / 2, side * run / 2], roofMat, false, roof);
    slope.rotation.x = side * slopeAngle;
  }

  // Triangular gable walls filling the ends under the roof.
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-halfD, 0);
  gableShape.lineTo(halfD, 0);
  gableShape.lineTo(0, ROOF_RISE);
  gableShape.closePath();
  const gableGeometry = new THREE.ExtrudeGeometry(gableShape, { depth: WALL, bevelEnabled: false });
  for (const x of [halfW - WALL, -halfW]) {
    const gable = new THREE.Mesh(gableGeometry, wallMat);
    gable.rotation.y = Math.PI / 2;
    gable.position.set(x, HEIGHT, 0);
    roof.add(gable);
  }

  // Bake the shell's ~30 boxes into 2 meshes: the house body, and the roof.
  // (Done BEFORE adding furniture: baking would strip the furniture's textures.)
  bakeMeshes(root, roof);
  bakeMeshes(roof);

  // ---------- Furniture (GLB) ----------
  const furnishings = new THREE.Group();
  furnishings.visible = false; // only drawn while the player is inside
  root.add(furnishings);

  const pieces = await Promise.all(FURNITURE_LAYOUT.map(async (item) => {
    const piece = await cloneStatic(item.url);
    piece.scale.setScalar(FURNITURE_SCALE);
    piece.rotation.y = item.turn;
    piece.position.set(item.x, FLOOR_TOP, item.z);
    furnishings.add(piece);
    return { piece, solid: item.solid };
  }));

  // Each solid piece of furniture gets a collider box matching its size.
  root.updateMatrixWorld(true);
  for (const { piece, solid } of pieces) {
    if (!solid) continue;
    const box = new THREE.Box3().setFromObject(piece);
    colliders.push({ center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) });
  }

  enableShadows(root);

  // Inside = within the inner faces of the walls.
  const interior = new THREE.Box3(
    new THREE.Vector3(-halfW + WALL, -1, -halfD + WALL),
    new THREE.Vector3(halfW - WALL, HEIGHT, halfD - WALL)
  );

  return { root, roof, furnishings, colliders, interior };
}
