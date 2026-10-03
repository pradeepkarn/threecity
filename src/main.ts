import './style.css';
import { Engine } from './engine/Engine';
import { Physics } from './physics/Physics';
import { World } from './world/World';
import { Player } from './player/Player';
import { Input } from './input/Input';
import { OrbitCamera } from './camera/OrbitCamera';

async function main(): Promise<void> {
  const engine = new Engine();
  const physics = await Physics.create();

  const world = new World(engine.scene, physics);
  await world.build();

  const player = await Player.create(engine.scene, physics);
  const input = new Input();
  const orbit = new OrbitCamera(engine.camera, engine.renderer.domElement);

  let last = performance.now();

  function tick(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    player.update(dt, input, orbit); // 1. decide where the player wants to go
    physics.step(dt);                // 2. simulate the physics world
    player.syncVisual(dt);           // 3. move the visible model to the physics body
    world.syncDynamics();            // 4. same for crates, balls, etc.

    // 5. Indoors: hide that building's roof and pull the camera in closer.
    const inside = world.updateInteriors(player.position);
    orbit.targetDistance = inside ? 5 : 9;
    orbit.update(player.position, dt); //    camera follows the player

    engine.render();                 // 6. draw the frame

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

main();