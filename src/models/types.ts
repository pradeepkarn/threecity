import type * as THREE from 'three';

// Animations the game asks for. catalog.ts maps each one to a clip name inside the GLB.
export type CharacterAnimation = 'idle' | 'walk' | 'run' | 'jump';

// The contract every character model follows.
// The game only talks to this interface, so swapping the model never touches game code.
export interface CharacterModel {
  /** Add this to the scene. Its origin is at the character's FEET. */
  readonly root: THREE.Object3D;
  /** Switch to an animation (smoothly blended). Calling it again with the same name does nothing. */
  play(animation: CharacterAnimation): void;
  /** Advance the animation. Call once per frame. */
  update(dt: number): void;
}

/** A box in a model's LOCAL space, i.e. relative to the model's own origin. */
export type LocalBox = { center: THREE.Vector3; size: THREE.Vector3 };

// The contract for buildings you can walk into.
export interface EnterableBuildingModel {
  /** Add this to the scene. Origin is at the centre of the base; the door faces +Z. */
  readonly root: THREE.Object3D;
  /** Hidden while the player is inside, so the camera can see in. */
  readonly roof: THREE.Object3D;
  /** Furniture: only shown while the player is inside (nobody can see it from outside anyway). */
  readonly furnishings: THREE.Object3D;
  /** Solid parts (walls, furniture) as local boxes. The chunk turns these into physics colliders. */
  readonly colliders: LocalBox[];
  /** Local-space area that counts as "inside the building". */
  readonly interior: THREE.Box3;
}
