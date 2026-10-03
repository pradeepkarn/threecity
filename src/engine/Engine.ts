import * as THREE from 'three';

// Owns everything needed to draw: renderer, scene, camera and lights.
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fd3f2);
    this.scene.fog = new THREE.Fog(0x9fd3f2, 60, 160);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);

    this.addLights();
    window.addEventListener('resize', this.onResize);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8a4a, 1.5));

    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    this.scene.add(sun);
  }

  // Arrow function so `this` still points at the Engine when called as an event handler.
  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
