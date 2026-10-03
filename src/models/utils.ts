import * as THREE from 'three';

// Turns on shadows for every mesh inside an object.
// You'll reuse this on loaded GLBs too, since they don't cast shadows by default.
export function enableShadows(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}
