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

  // Small display in the top-left corner: loading status, then where you are.
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.textContent = 'Loading city…';
  document.body.appendChild(hud);

  const world = new World(engine.scene, physics);
  await world.build(); // plans the city, then loads its models and the 3 x 3 chunks around the spawn point

  const player = await Player.create(engine.scene, physics, world.spawnPoint);
  const input = new Input();
  const orbit = new OrbitCamera(engine.camera, engine.renderer.domElement);


  let last = performance.now();

  function tick(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    player.update(dt, input, orbit);   // 1. decide where the player wants to go
    physics.step(dt);                  // 2. simulate the physics world
    player.syncVisual(dt);             // 3. move the visible model to the physics body

    world.update(player.position);     // 4. stream chunks so the player stays in the middle one

    // 5. Indoors: hide that building's roof and pull the camera in closer.
    const inside = world.updateInteriors(player.position);
    orbit.targetDistance = inside ? 5 : 9;
    orbit.update(player.position, dt); //    camera follows the player
    engine.followTarget(player.position); // sunlight and shadows follow too

    hud.textContent = world.debugText;
    engine.render();                   // 6. draw the frame

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

main();
