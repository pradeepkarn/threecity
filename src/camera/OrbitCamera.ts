import * as THREE from 'three';

// Third-person camera that orbits around a target. Drag on the 3D view to rotate.
export class OrbitCamera {
  yaw = Math.PI;        // horizontal angle; PI starts the camera behind the player
  pitch = 0.35;         // vertical angle in radians above the horizon
  distance = 9;
  targetDistance = 9;   // set this to zoom; distance eases towards it
  sensitivity = 0.005;
  heightOffset = 1.5;   // look at the upper body, not the feet

  private readonly camera: THREE.PerspectiveCamera;
  private readonly lookAt = new THREE.Vector3();
  private lookPointer: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement) {
    this.camera = camera;

    element.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      element.setPointerCapture(e.pointerId);
    });
    element.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.yaw -= (e.clientX - this.lastX) * this.sensitivity;
      this.pitch += (e.clientY - this.lastY) * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, 0.05, 1.2);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const endLook = (e: PointerEvent): void => {
      if (e.pointerId === this.lookPointer) this.lookPointer = null;
    };
    element.addEventListener('pointerup', endLook);
    element.addEventListener('pointercancel', endLook);
  }

  /** Camera's forward and right directions flattened onto the ground, for movement. */
  getGroundAxes(forward: THREE.Vector3, right: THREE.Vector3): void {
    forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Places the camera on a sphere around `target` (the player's feet). */
  update(target: THREE.Vector3, dt: number): void {
    // Ease towards the target distance instead of snapping, so zooming feels smooth.
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 4);

    this.lookAt.set(target.x, target.y + this.heightOffset, target.z);
    const flat = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.lookAt.x + Math.sin(this.yaw) * flat,
      this.lookAt.y + Math.sin(this.pitch) * this.distance,
      this.lookAt.z + Math.cos(this.yaw) * flat
    );
    this.camera.lookAt(this.lookAt);
  }
}
