import * as THREE from 'three';

/** Where one tree stands, in the chunk's local coordinates. `y` is the ground height there. */
export type TreeTransform = { x: number; y: number; z: number; rotation: number; scale: number };

// Size of a pine at scale 1. The forest builder uses these for the trunk colliders.
export const PINE_TRUNK_HEIGHT = 2.5;
export const PINE_TRUNK_RADIUS = 0.3;

// ---------- Shared shapes and materials (one copy for every forest chunk) ----------
// Each geometry is moved up so its origin is at the base of the tree (ground level).
function shared<T extends THREE.Material | THREE.BufferGeometry>(resource: T): T {
  resource.userData.shared = true;
  return resource;
}
const trunkGeometry = shared(new THREE.CylinderGeometry(0.22, PINE_TRUNK_RADIUS, PINE_TRUNK_HEIGHT, 6)
  .translate(0, PINE_TRUNK_HEIGHT / 2, 0));
const lowerCrownGeometry = shared(new THREE.ConeGeometry(1.8, 3.5, 7).translate(0, 3.6, 0));
const upperCrownGeometry = shared(new THREE.ConeGeometry(1.2, 2.6, 7).translate(0, 5.6, 0));
const trunkMaterial = shared(new THREE.MeshStandardMaterial({ color: 0x5a3a1c }));
const darkLeaves = shared(new THREE.MeshStandardMaterial({ color: 0x27500a }));
const lightLeaves = shared(new THREE.MeshStandardMaterial({ color: 0x3b6d11 }));

/**
 * PLACEHOLDER pine forest, drawn with InstancedMesh.
 *
 * Normal meshes: 160 trees x 3 parts = 480 draw calls per chunk. Too slow for phones.
 * InstancedMesh: the GPU draws every copy of one part in a single call, so a whole
 * forest chunk costs 3 draw calls (trunks, lower crowns, upper crowns).
 *
 * To switch to a GLB tree later: load it once, take each mesh's geometry and material,
 * and create one InstancedMesh per part exactly like below.
 */
export async function loadForestTrees(trees: TreeTransform[]): Promise<THREE.Object3D> {
  const group = new THREE.Group();
  if (trees.length === 0) return group;

  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [trunkGeometry, trunkMaterial],
    [lowerCrownGeometry, darkLeaves],
    [upperCrownGeometry, lightLeaves],
  ];

  // Reused while building each tree's transform matrix (position + rotation + scale).
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const [geometry, material] of parts) {
    const mesh = new THREE.InstancedMesh(geometry, material, trees.length);
    trees.forEach((tree, i) => {
      position.set(tree.x, tree.y, tree.z);
      rotation.setFromAxisAngle(up, tree.rotation);
      scale.setScalar(tree.scale);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix); // "copy number i goes here, turned and sized like this"
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // so three.js can skip drawing it when it's off-screen
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
