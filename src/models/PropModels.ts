import * as THREE from 'three';
import { enableShadows } from './utils';

// PLACEHOLDER props. Each will become a GLB later, keeping the same function signature.
//
// Origin conventions (keep these when you swap in GLBs, or offset the GLB inside a Group):
//   - Crate and ball: origin at the CENTRE, because their physics body is centred.
//   - Tree: origin at the BASE (ground level), because it's placed on the ground.

export async function loadCrateModel(): Promise<THREE.Object3D> {
  const root = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xba7517 })
  );
  root.add(box);

  // Dark outline on the edges so it reads as a wooden crate.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(box.geometry),
    new THREE.LineBasicMaterial({ color: 0x633806 })
  );
  root.add(edges);

  enableShadows(root);
  return root;
}

export async function loadBallModel(radius: number): Promise<THREE.Object3D> {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xe24b4a })
  ));
  // A white band so you can see the ball rolling.
  root.add(new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.001, radius * 0.1, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  ));
  enableShadows(root);
  return root;
}

export const TREE_TRUNK_HEIGHT = 3;
export const TREE_TRUNK_RADIUS = 0.3;

export async function loadTreeModel(): Promise<THREE.Object3D> {
  const root = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(TREE_TRUNK_RADIUS * 0.8, TREE_TRUNK_RADIUS, TREE_TRUNK_HEIGHT, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4423 })
  );
  trunk.position.y = TREE_TRUNK_HEIGHT / 2;
  root.add(trunk);

  const leaves = new THREE.MeshStandardMaterial({ color: 0x3b6d11 });
  const blobs: [number, number, number, number][] = [
    [0, 4.2, 0, 1.8],
    [0.9, 3.6, 0.3, 1.2],
    [-0.8, 3.7, -0.4, 1.3],
  ];
  for (const [x, y, z, r] of blobs) {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), leaves);
    blob.position.set(x, y, z);
    root.add(blob);
  }

  enableShadows(root);
  return root;
}
