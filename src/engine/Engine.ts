import * as THREE from 'three';

/**
 * Engine
 * ------
 * Sets up everything needed to DRAW the game on screen. It knows nothing about
 * gameplay, physics or input; it only shows whatever is in the scene.
 *
 * Think of it like filming a movie:
 *   - scene    = the movie set, holding every object, character and light
 *   - camera   = the camera filming that set
 *   - renderer = the projector that turns what the camera sees into pixels on screen
 */
export class Engine {
  // `readonly` means these are created once here and never replaced.
  // Other files can still use them, e.g. World adds chunks to `engine.scene`.
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  // The sun is kept so it can follow the player around the infinite city.
  private readonly sun: THREE.DirectionalLight;

  constructor() {
    // ---------- Renderer: draws the 3D scene onto a <canvas> using the GPU (WebGL) ----------
    // antialias smooths jagged edges on diagonal lines.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });

    // Phones have high-density screens (devicePixelRatio of 3 or more). Rendering at full
    // density looks sharp but is very slow, so we cap it at 2 for a good balance.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Make the canvas fill the whole browser window.
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Turn on shadows. Each light and object must also opt in (castShadow / receiveShadow).
    this.renderer.shadowMap.enabled = true;

    // The renderer creates a <canvas> element; adding it to the page makes it visible.
    document.body.appendChild(this.renderer.domElement);

    // ---------- Scene: the container for everything in the 3D world ----------
    this.scene = new THREE.Scene();

    // Sky color shown wherever there's no object.
    this.scene.background = new THREE.Color(0x9fd3f2);

    // Fog fades distant objects into the sky color: it starts 35 units from the camera
    // and is fully foggy at 85. In the streaming city, the nearest unloaded area is at least
    // one chunk (80 units) away, so fog hides chunks appearing and disappearing.
    // Using the same color as the sky makes far objects blend in smoothly.
    this.scene.fog = new THREE.Fog(0x9fd3f2, 35, 85);

    // ---------- Camera: the player's view into the world ----------
    // PerspectiveCamera makes far things smaller, like a real eye. Its parameters:
    //   60     = field of view in degrees (how wide the view is)
    //   aspect = screen width / height, so the picture isn't stretched
    //   0.1    = nearest distance it can see (anything closer is cut off)
    //   150    = farthest distance it can see; beyond the fog there's nothing to see anyway
    // Its position is set every frame by OrbitCamera, not here.
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 150);

    this.sun = this.addLights();

    // When the window size changes (or a phone is rotated), resize everything to match.
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Draws one frame: "take a picture of the scene through the camera".
   * Called once per frame, at the end of the game loop in main.ts.
   */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Moves the sun along with the player. Shadows are only calculated inside a box around
   * the sun's target, so in an infinite world that box has to travel with the player,
   * otherwise shadows would disappear once you walk away from the start.
   */
  followTarget(target: THREE.Vector3): void {
    this.sun.position.set(target.x + 30, 50, target.z + 20); // same angle as before, just shifted
    this.sun.target.position.set(target.x, 0, target.z);
    this.sun.target.updateMatrixWorld(); // the target isn't in the scene, so update it by hand
  }

  /** Adds the lights. Without lights, every MeshStandardMaterial object would be black. */
  private addLights(): THREE.DirectionalLight {
    // HemisphereLight: soft light from all around, like daylight on a cloudy day.
    // Surfaces facing up get the sky color (white), surfaces facing down get the
    // ground color (greenish), as if light bounces off the grass. 1.5 = brightness.
    // It casts no shadows; it just stops shaded sides from being pitch black.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8a4a, 1.5));

    // DirectionalLight: the sun. Its rays are parallel, coming from its position
    // toward its target. This is the light that creates shadows.
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(30, 50, 20); // high up and off to one side, like an afternoon sun
    sun.castShadow = true;

    // Shadow quality: shadows are drawn into a 2048 x 2048 pixel image (shadow map).
    // Bigger is sharper but slower; lower it to 1024 if phones struggle.
    sun.shadow.mapSize.set(2048, 2048);

    // The area the sun calculates shadows for: a 120 x 120 box around its target
    // (the player). Objects outside this box won't cast shadows, but they're in the fog anyway.
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;

    this.scene.add(sun);
    return sun;
  }

  /**
   * Runs whenever the window is resized.
   *
   * It's written as an arrow function (`= () => {}`) on purpose. A normal method passed
   * to addEventListener would lose track of `this` and crash. An arrow function always
   * keeps `this` pointing at the Engine.
   */
  private onResize = (): void => {
    // Tell the camera the new screen shape, otherwise the picture looks stretched.
    this.camera.aspect = window.innerWidth / window.innerHeight;
    // The camera caches its settings for speed, so it must be told to recalculate.
    this.camera.updateProjectionMatrix();
    // Resize the canvas itself to the new window size.
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
