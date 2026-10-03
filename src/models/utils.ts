import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

// One material for every baked model: colours come from the vertices, not the material.
const bakedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
bakedMaterial.userData.shared = true;

/**
 * "Bakes" all the separate meshes inside `container` into ONE mesh.
 *
 * A house built from 40 boxes costs 40 draw calls; baked, it costs 1. Each piece keeps its
 * colour by writing its material colour into its vertices. Use this for static parts only:
 * once baked, the pieces can't move separately. InstancedMeshes are left as they are, and
 * anything inside `skip` (e.g. a roof that must hide on its own) is left out.
 */
export function bakeMeshes(container: THREE.Object3D, skip?: THREE.Object3D): void {
  container.updateMatrixWorld(true);
  const toContainer = container.matrixWorld.clone().invert();

  const meshes: THREE.Mesh[] = [];
  container.traverse((obj) => {
    if (obj instanceof THREE.InstancedMesh || !(obj instanceof THREE.Mesh)) return;
    for (let p: THREE.Object3D | null = obj; p; p = p.parent) if (p === skip) return;
    meshes.push(obj);
  });
  if (meshes.length < 2) return;

  const parts: THREE.BufferGeometry[] = [];
  const color = new THREE.Color();
  for (const mesh of meshes) {
    // Copy the piece's shape and keep only position + normal, so every piece matches.
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    // Move it to where the piece sits inside the container.
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toContainer, mesh.matrixWorld));

    // Store the material's colour in every vertex (glowing parts get their glow added).
    const material = mesh.material as THREE.MeshStandardMaterial;
    color.copy(material.color);
    if (material.emissive) color.add(material.emissive.clone().multiplyScalar(material.emissiveIntensity ?? 1));
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  }

  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) return;

  // Remove the original pieces and free their memory (unless shared with other models).
  for (const mesh of meshes) {
    mesh.removeFromParent();
    if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material;
    if (!material.userData.shared) material.dispose();
  }

  container.add(new THREE.Mesh(merged, bakedMaterial));
}
