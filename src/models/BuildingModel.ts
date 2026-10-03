import * as THREE from 'three';
import { cloneStatic } from './assets';
import { BUILDINGS, BUILDING_SCALE, type BuildingId } from './catalog';
import { enableShadows } from './utils';

// Where each building file's base centre is, worked out once per file.
const offsets = new Map<BuildingId, THREE.Vector3>();

/**
 * A building from the KayKit city pack, scaled to city size.
 * Origin is moved to the CENTRE OF THE BASE, front (+Z) facing the street,
 * whatever the original file's origin was.
 */
export async function loadBuildingModel(id: BuildingId): Promise<THREE.Object3D> {
  const model = await cloneStatic(BUILDINGS[id].url);
  model.scale.setScalar(BUILDING_SCALE);

  let offset = offsets.get(id);
  if (!offset) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
    offsets.set(id, offset);
  }
  model.position.copy(offset);

  const root = new THREE.Group();
  root.add(model);
  enableShadows(root);
  return root;
}
