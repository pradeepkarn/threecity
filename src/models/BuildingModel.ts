import * as THREE from 'three';
import { bakeMeshes, enableShadows } from './utils';

// Shared between all buildings, so 100 buildings don't create 100 copies.
const windowGeometry = new THREE.BoxGeometry(1.2, 1.4, 0.06);
const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xb5d4f4, roughness: 0.2 });
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2a10 });
// Mark them as shared, so removing one chunk doesn't delete them for every other building.
windowGeometry.userData.shared = true;
windowMaterial.userData.shared = true;
doorMaterial.userData.shared = true;

// PLACEHOLDER building: walls, roof slab, a door and rows of windows.
// Origin is at the CENTRE OF THE BASE (ground level), the usual convention for GLB buildings.
//
// To switch to GLB later: load the file, clone gltf.scene, and scale it to width/height/depth.
export async function loadBuildingModel(
  width: number, height: number, depth: number, color: number
): Promise<THREE.Object3D> {
  const root = new THREE.Group();

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color })
  );
  walls.position.y = height / 2;
  root.add(walls);

  const roofColor = new THREE.Color(color).multiplyScalar(0.7);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.4, 0.3, depth + 0.4),
    new THREE.MeshStandardMaterial({ color: roofColor })
  );
  roof.position.y = height + 0.15;
  root.add(roof);

  // Door on the front (+Z) face.
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.08), doorMaterial);
  door.position.set(0, 1.2, depth / 2 + 0.04);
  root.add(door);

  // Windows: one row per 3-unit floor, on the front and back faces.
  // A 60-unit tower has hundreds of windows. As separate meshes that would be hundreds of
  // draw calls; as one InstancedMesh it's a single draw call for all of them.
  const floorHeight = 3;
  const spacing = 2.5;
  const columns = Math.max(1, Math.floor((width - 1) / spacing));
  const startX = -((columns - 1) * spacing) / 2;
  const spots: [number, number, number][] = [];
  for (let y = floorHeight + 1; y < height - 0.8; y += floorHeight) {
    for (let c = 0; c < columns; c++) {
      for (const side of [1, -1]) {
        spots.push([startX + c * spacing, y, side * (depth / 2 + 0.03)]);
      }
    }
  }
  if (spots.length > 0) {
    const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, spots.length);
    const matrix = new THREE.Matrix4();
    spots.forEach(([x, y, z], i) => windows.setMatrixAt(i, matrix.makeTranslation(x, y, z)));
    windows.instanceMatrix.needsUpdate = true;
    windows.computeBoundingSphere();
    root.add(windows);
  }

  bakeMeshes(root); // walls, roof and door become one mesh; the instanced windows stay separate
  enableShadows(root);
  return root;
}
