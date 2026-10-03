import type * as THREE from 'three';

// Animation names the game asks for. A GLB character will have clips with these names
// (or you map its clip names to these in the loader).
export type CharacterAnimation = 'idle' | 'walk' | 'jump';

// The contract every character model follows, placeholder or GLB.
// The game only talks to this interface, so swapping the model never touches game code.
export interface CharacterModel {
  /** Add this to the scene. Its origin is at the character's FEET, like most GLB characters. */
  readonly root: THREE.Object3D;
  /** Switch to an animation. Calling it again with the same name does nothing. */
  play(animation: CharacterAnimation): void;
  /** Advance the animation. Call once per frame. With a GLB this calls mixer.update(dt). */
  update(dt: number): void;
}

/** A box in a model's LOCAL space, i.e. relative to the model's own origin. */
export type LocalBox = { center: THREE.Vector3; size: THREE.Vector3 };

// The contract for buildings you can walk into, placeholder or GLB.
export interface EnterableBuildingModel {
  /** Add this to the scene. Origin is at the centre of the base; the door faces +Z. */
  readonly root: THREE.Object3D;
  /** Hidden while the player is inside, so the camera can see in. */
  readonly roof: THREE.Object3D;
  /** Solid parts (walls, furniture) as local boxes. World turns these into physics colliders. */
  readonly colliders: LocalBox[];
  /** Local-space area that counts as "inside the building". */
  readonly interior: THREE.Box3;
}