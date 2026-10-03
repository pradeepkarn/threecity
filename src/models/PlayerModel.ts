import * as THREE from 'three';
import type { CharacterAnimation, CharacterModel } from './types';
import { enableShadows } from './utils';

// PLACEHOLDER player built from boxes, with hand-coded animations.
//
// To switch to a GLB later, replace the inside of this function with:
//   const gltf = await new GLTFLoader().loadAsync('/models/player.glb');
//   const mixer = new THREE.AnimationMixer(gltf.scene);
//   ...and make play() / update() use mixer actions.
// The function signature stays the same, so Player.ts doesn't change.
export async function loadPlayerModel(shirtColor = 0xe24b4a): Promise<CharacterModel> {
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0 });
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2c2c2a });

  // Everything above the hips moves together so we can bob it while walking.
  const upper = new THREE.Group();
  root.add(upper);

  // A limb is a pivot placed at the joint (hip/shoulder) with the mesh hanging below.
  // Rotating the pivot then swings the limb naturally.
  function limb(parent: THREE.Object3D, material: THREE.Material, width: number,
                length: number, x: number, y: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, length, width), material);
    mesh.position.y = -length / 2;
    pivot.add(mesh);
    parent.add(pivot);
    return pivot;
  }

  // Heights: legs 0 to 0.9, torso 0.9 to 1.65, head 1.65 to 2.05 (about 2 units tall).
  const leftLeg = limb(root, pants, 0.28, 0.9, -0.17, 0.9);
  const rightLeg = limb(root, pants, 0.28, 0.9, 0.17, 0.9);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.4), shirt);
  torso.position.y = 1.275;
  upper.add(torso);

  const leftArm = limb(upper, shirt, 0.22, 0.7, -0.5, 1.6);
  const rightArm = limb(upper, shirt, 0.22, 0.7, 0.5, 1.6);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skin);
  head.position.y = 1.85;
  upper.add(head);

  // Eyes on the +Z side, so you can see which way the character faces.
  const eyes = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.07, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x2c2c2a })
  );
  eyes.position.set(0, 1.9, 0.21);
  upper.add(eyes);

  enableShadows(root);

  let current: CharacterAnimation = 'idle';
  let time = 0;

  return {
    root,

    play(animation: CharacterAnimation): void {
      if (animation === current) return;
      current = animation;
      time = 0;
    },

    update(dt: number): void {
      time += dt;
      let legSwing = 0;
      let armSwing = 0;
      let bob = 0;

      if (current === 'walk') {
        legSwing = Math.sin(time * 10) * 0.7;
        armSwing = -legSwing * 0.8;              // arms swing opposite to legs
        bob = Math.abs(Math.sin(time * 10)) * 0.05;
      } else if (current === 'jump') {
        legSwing = 0.4;                          // one leg forward, one back
        armSwing = -2.2;                         // arms up (negative X rotation lifts forward)
      } else {
        armSwing = Math.sin(time * 2) * 0.05;    // idle: gentle breathing sway
        bob = Math.sin(time * 2) * 0.02;
      }

      leftLeg.rotation.x = legSwing;
      rightLeg.rotation.x = current === 'jump' ? -0.3 : -legSwing;
      leftArm.rotation.x = armSwing;
      rightArm.rotation.x = current === 'jump' ? armSwing : -armSwing;
      upper.position.y = bob;
    },
  };
}
