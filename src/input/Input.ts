import * as THREE from 'three';

// Collects keyboard, joystick and button input into simple values the game can read.
export class Input {
  private readonly keys = new Set<string>();
  private readonly joy = new THREE.Vector2();
  private joyPointer: number | null = null;
  private jumpQueued = false;

  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;

  constructor() {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    // Joystick
    this.joyBase = document.createElement('div');
    this.joyBase.id = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.id = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    document.body.appendChild(this.joyBase);

    this.joyBase.addEventListener('pointerdown', (e) => {
      this.joyPointer = e.pointerId;
      this.joyBase.setPointerCapture(e.pointerId);
      this.updateJoystick(e);
    });
    this.joyBase.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyPointer) this.updateJoystick(e);
    });
    this.joyBase.addEventListener('pointerup', this.resetJoystick);
    this.joyBase.addEventListener('pointercancel', this.resetJoystick);

    // Jump button
    const jumpBtn = document.createElement('button');
    jumpBtn.id = 'jump-btn';
    jumpBtn.textContent = 'Jump';
    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.jumpQueued = true;
    });
    document.body.appendChild(jumpBtn);
  }

  /** Writes the movement direction (-1..1 on each axis) into `out`. Y is forward. */
  getMove(out: THREE.Vector2): THREE.Vector2 {
    out.copy(this.joy);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) out.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) out.y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) out.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) out.x += 1;
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  /** True once per jump press; reading it clears it. */
  consumeJump(): boolean {
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return jump;
  }

  private updateJoystick(e: PointerEvent): void {
    const rect = this.joyBase.getBoundingClientRect();
    const max = rect.width / 2;
    let dx = e.clientX - (rect.left + max);
    let dy = e.clientY - (rect.top + max);
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.joy.set(dx / max, -dy / max); // screen Y points down, forward is up
  }

  private resetJoystick = (): void => {
    this.joyPointer = null;
    this.joy.set(0, 0);
    this.joyKnob.style.transform = 'translate(0px, 0px)';
  };
}
