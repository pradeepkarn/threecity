import * as THREE from 'three';
import type { EnterableBuildingModel, LocalBox } from './types';
import { bakeMeshes, enableShadows } from './utils';

// House dimensions in local space. The front door is in the +Z wall.
const WIDTH = 12;   // along X
const DEPTH = 10;   // along Z
const HEIGHT = 4;   // wall height
const WALL = 0.3;   // wall thickness
const DOOR_W = 2.2;
const DOOR_H = 2.8;
const ROOF_RISE = 1.6;

type Tuple3 = [number, number, number];

// PLACEHOLDER enterable house. To switch to a GLB later:
//   - load the house GLB as `root`
//   - find its roof by name, e.g. gltf.scene.getObjectByName('Roof')
//   - list collider boxes by hand, or read them from hidden boxes named "Collider_*" in the GLB
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
  const glass = new THREE.MeshStandardMaterial({ color: 0xb5d4f4, roughness: 0.2 });

  // Adds one box-shaped part. If `solid`, also records an identical collider box,
  // so what you see and what you bump into can never drift apart.
  function part(size: Tuple3, pos: Tuple3, material: THREE.Material,
                solid: boolean, parent: THREE.Object3D = root): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    parent.add(mesh);
    if (solid) colliders.push({ center: new THREE.Vector3(...pos), size: new THREE.Vector3(...size) });
    return mesh;
  }

  // A collider with no mesh, for objects made of several small pieces (like a table).
  function solidVolume(size: Tuple3, pos: Tuple3): void {
    colliders.push({ center: new THREE.Vector3(...pos), size: new THREE.Vector3(...size) });
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

  // ---------- Floor and rug (thin, no collider needed) ----------
  part([WIDTH - 2 * WALL, 0.04, DEPTH - 2 * WALL], [0, 0.02, 0], floorMat, false);
  part([4, 0.01, 3], [0.5, 0.045, 1.5], mat(0x534ab7), false);

  // ---------- Bed (back-left corner) ----------
  const bedX = -halfW + WALL + 1.3;
  const bedZ = -halfD + WALL + 1.7;
  part([2.2, 0.45, 3.0], [bedX, 0.225, bedZ], wood, true);
  part([2.0, 0.2, 2.8], [bedX, 0.55, bedZ], mat(0xf1efe8), true);
  part([2.02, 0.05, 1.6], [bedX, 0.67, bedZ + 0.6], mat(0x378add), false);   // blanket
  part([1.4, 0.15, 0.5], [bedX, 0.72, bedZ - 1.05], mat(0xffffff), false);   // pillow
  part([2.2, 1.2, 0.15], [bedX, 0.6, bedZ - 1.575], wood, true);             // headboard

  // ---------- Table (several small pieces, one collider) ----------
  const tableX = 2.5;
  const tableZ = -1.5;
  part([2, 0.1, 1.2], [tableX, 0.85, tableZ], wood, false);
  for (const dx of [-0.85, 0.85]) {
    for (const dz of [-0.5, 0.5]) {
      part([0.1, 0.8, 0.1], [tableX + dx, 0.4, tableZ + dz], wood, false);
    }
  }
  solidVolume([2, 0.9, 1.2], [tableX, 0.45, tableZ]);

  // ---------- Sofa (against the right wall, facing into the room) ----------
  const sofaMat = mat(0x0f6e56);
  const sofaX = halfW - WALL - 0.5;
  part([1.0, 0.45, 2.6], [sofaX, 0.225, 1.5], sofaMat, true);                      // seat
  part([0.25, 0.6, 2.6], [halfW - WALL - 0.125, 0.75, 1.5], sofaMat, true);        // back
  part([1.0, 0.3, 0.2], [sofaX, 0.6, 0.3], sofaMat, false);                        // arm
  part([1.0, 0.3, 0.2], [sofaX, 0.6, 2.7], sofaMat, false);                        // arm

  // ---------- Ceiling lamp ----------
  // It glows by itself (emissive) instead of using a real PointLight. In a streaming city,
  // houses constantly load and unload, and every time the number of lights changes, three.js
  // must recompile its shaders, which causes a visible stutter. A glowing material costs nothing.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfac775, emissive: 0xffd27a, emissiveIntensity: 1.5 });
  part([0.6, 0.15, 0.6], [0, HEIGHT - 0.1, 0], lampMat, false);

  // ---------- Roof (a separate group so it can be hidden) ----------
  const run = halfD + 0.4;                          // how far each slope reaches past the wall
  const slopeLen = Math.hypot(run, ROOF_RISE);
  const slopeAngle = Math.atan2(ROOF_RISE, run);
  for (const side of [1, -1]) {
    const slope = part([WIDTH + 0.6, 0.2, slopeLen], [0, HEIGHT + ROOF_RISE / 2, side * run / 2], roofMat, false, roof);
    slope.rotation.x = side * slopeAngle;           // tilt so the outer edge is lower
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
    gable.rotation.y = Math.PI / 2;                 // turn the triangle to face along X
    gable.position.set(x, HEIGHT, 0);
    roof.add(gable);
  }

  // Bake ~40 boxes into 2 meshes: the house body, and the roof (kept separate so it can hide).
  bakeMeshes(root, roof);
  bakeMeshes(roof);
  enableShadows(root);

  // Inside = within the inner faces of the walls.
  const interior = new THREE.Box3(
    new THREE.Vector3(-halfW + WALL, -1, -halfD + WALL),
    new THREE.Vector3(halfW - WALL, HEIGHT, halfD - WALL)
  );

  return { root, roof, colliders, interior };
}
