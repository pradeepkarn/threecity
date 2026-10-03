import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

// =============================================================================================
// Loading GLB files.
//
// Each file is downloaded and parsed ONCE; every building, tree or chair after that is a cheap
// copy that shares the original's geometry and materials (GPU memory is used only once).
// Because those are shared, they're marked `shared`, so unloading a chunk never deletes them.
// =============================================================================================

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Loads a GLB file once; later calls with the same URL reuse the same result. */
export function loadGLTF(url: string): Promise<GLTF> {
  let promise = cache.get(url);
  if (!promise) {
    promise = loader.loadAsync(url).then((gltf) => {
      markShared(gltf.scene);
      return gltf;
    });
    cache.set(url, promise);
  }
  return promise;
}

function markShared(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.userData.shared = true;
      const materials: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of materials) m.userData.shared = true;
    }
  });
}

/** A copy of a static model (building, furniture). */
export async function cloneStatic(url: string): Promise<THREE.Object3D> {
  const gltf = await loadGLTF(url);
  return gltf.scene.clone(true);
}

/**
 * A copy of an animated character. Characters need SkeletonUtils.clone, because a normal
 * clone would make every copy share ONE skeleton, and they'd all move together.
 */
export async function cloneSkinned(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const gltf = await loadGLTF(url);
  return { scene: cloneWithSkeleton(gltf.scene), animations: gltf.animations };
}

// ---------- Instancing: drawing many copies of one model in a single draw call ----------

/** Where one copy goes. Rotation is around the vertical axis. */
export interface InstanceTransform { x: number; y: number; z: number; rotation: number; scale: number }

interface InstancePart { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }
/** A model's meshes, plus its lowest point (some models, like the cars, reach below their origin). */
interface InstanceModel { parts: InstancePart[]; bottom: number }
const modelCache = new Map<string, Promise<InstanceModel>>();

/** The meshes inside a model, with their position inside it. Worked out once per file. */
function instanceModel(url: string): Promise<InstanceModel> {
  let promise = modelCache.get(url);
  if (!promise) {
    promise = loadGLTF(url).then((gltf) => {
      const parts: InstancePart[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          parts.push({ geometry: obj.geometry, material: obj.material as THREE.Material, matrix: obj.matrixWorld.clone() });
        }
      });
      const bottom = new THREE.Box3().setFromObject(gltf.scene).min.y;
      return { parts, bottom };
    });
    modelCache.set(url, promise);
  }
  return promise;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Many copies of one model as InstancedMeshes: one draw call per mesh in the model,
 * however many copies there are. Used for trees, rocks, street lights, cars, benches.
 *
 * With `sitOnGround`, each copy is lifted so the model's LOWEST point rests exactly at the
 * given y, even if the file's origin is higher (the cars' wheels reach below their origin).
 * Trees and rocks skip this: their bases are meant to sink slightly into the ground.
 */
export async function createInstances(url: string, items: InstanceTransform[],
                                      sitOnGround = true): Promise<THREE.Object3D> {
  const group = new THREE.Group();
  if (items.length === 0) return group;
  const model = await instanceModel(url);

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const placement = new THREE.Matrix4();

  for (const part of model.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
    items.forEach((item, i) => {
      const lift = sitOnGround ? -model.bottom * item.scale : 0;
      position.set(item.x, item.y + lift, item.z);
      rotation.setFromAxisAngle(UP, item.rotation);
      scale.setScalar(item.scale);
      placement.compose(position, rotation, scale).multiply(part.matrix); // where it goes x where the part sits in the model
      mesh.setMatrixAt(i, placement);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // lets three.js skip it when it's off-screen
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
