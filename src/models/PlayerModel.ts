import * as THREE from 'three';
import type { CharacterAnimation, CharacterModel } from './types';
import { cloneSkinned } from './assets';
import { CHARACTERS, CHARACTER_CLIPS, DEFAULT_CHARACTER, type CharacterId } from './catalog';
import { enableShadows } from './utils';

const FADE = 0.2; // seconds to blend from one animation into the next

/**
 * An animated character from a GLB file (KayKit Adventurers).
 * The animations are inside the file; an AnimationMixer plays them.
 */
export async function loadPlayerModel(character: CharacterId = DEFAULT_CHARACTER): Promise<CharacterModel> {
  const { scene, animations } = await cloneSkinned(CHARACTERS[character]);
  enableShadows(scene);

  const root = new THREE.Group();
  root.add(scene);

  // The mixer plays animation clips on this character's skeleton.
  const mixer = new THREE.AnimationMixer(scene);
  const actions = {} as Record<CharacterAnimation, THREE.AnimationAction>;
  for (const [name, clipName] of Object.entries(CHARACTER_CLIPS) as [CharacterAnimation, string][]) {
    const clip = THREE.AnimationClip.findByName(animations, clipName);
    if (!clip) throw new Error(`Animation "${clipName}" not found in ${CHARACTERS[character]}`);
    actions[name] = mixer.clipAction(clip);
  }

  let current = actions.idle;
  current.play();

  return {
    root,

    play(animation: CharacterAnimation): void {
      const next = actions[animation];
      if (next === current) return;
      // Cross-fade: the new animation fades in while the old one fades out, so there's no snap.
      next.reset().fadeIn(FADE).play();
      current.fadeOut(FADE);
      current = next;
    },

    update(dt: number): void {
      mixer.update(dt);
    },
  };
}
