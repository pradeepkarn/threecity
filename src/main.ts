import './style.css';
import { Engine } from './engine/Engine';
import { Physics } from './physics/Physics';
import { World } from './world/World';
import { Player } from './player/Player';
import { Input } from './input/Input';
import { OrbitCamera } from './camera/OrbitCamera';
import { CityMapImage } from './ui/CityMapImage';
import { Minimap, type MapPoint } from './ui/Minimap';
import { MapScreen } from './ui/MapScreen';

const NORMAL_FOV = 60;
const RUNNING_FOV = 67;   // the view widens a little while running, so speed feels like speed
const ARRIVED_DISTANCE = 12; // the waypoint clears itself when you get this close

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

  // ---------- Maps ----------
  hud.textContent = 'Drawing map…';
  const cityMap = new CityMapImage(world.layout); // the whole city as one picture, drawn once
  const mapScreen = new MapScreen(cityMap);
  mapScreen.describe = (p) => world.layout.placeName(p.x, p.z);

  let waypoint: MapPoint | null = null;
  let travelling = false;

  const openMap = (): void => {
    if (travelling) return;
    mapScreen.show({ x: player.position.x, z: player.position.z }, player.heading, waypoint);
  };
  const minimap = new Minimap(cityMap, openMap);

  const mapButton = document.createElement('button');
  mapButton.id = 'map-btn';
  mapButton.textContent = 'Map';
  mapButton.addEventListener('click', openMap);
  document.body.appendChild(mapButton);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyM') {
      if (mapScreen.isOpen) mapScreen.close();
      else openMap();
    }
    // C copies where you're standing as [x, z], ready to paste into the city plan.
    if (e.code === 'KeyC') {
      const spot = `[${Math.round(player.position.x)}, ${Math.round(player.position.z)}]`;
      void navigator.clipboard?.writeText(spot);
      copiedUntil = performance.now() + 1500;
      copiedText = `Copied ${spot}`;
    }
  });
  let copiedUntil = 0;
  let copiedText = '';

  mapScreen.onWaypoint = (target) => {
    waypoint = target;
  };

  // Travelling: find a safe spot, build the chunks there, then move the player.
  const travelOverlay = document.createElement('div');
  travelOverlay.id = 'travel-overlay';
  document.body.appendChild(travelOverlay);

  mapScreen.onTravel = async (target) => {
    travelling = true;
    const spot = world.findSafeSpot(target.x, target.z);
    travelOverlay.textContent = `Travelling to ${world.layout.placeName(spot.x, spot.z)}…`;
    travelOverlay.classList.add('open');
    await world.prepareArea(spot.x, spot.z);
    player.teleport(spot);
    travelOverlay.classList.remove('open');
    travelling = false;
  };

  let last = performance.now();

  function tick(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // While the map is open or we're travelling, the player stands still.
    input.enabled = !mapScreen.isOpen && !travelling;

    if (!travelling) {
      player.update(dt, input, orbit);   // 1. decide where the player wants to go
      physics.step(dt);                  // 2. simulate the physics world
      player.syncVisual(dt);             // 3. move the visible model to the physics body
      world.update(player.position);     // 4. stream chunks so the player stays in the middle one
    }

    // 5. Indoors: hide that building's roof and pull the camera in closer.
    const inside = world.updateInteriors(player.position);
    orbit.targetDistance = inside ? 5 : 9;
    orbit.update(player.position, dt);
    engine.followTarget(player.position);

    // Widen the view a little while running.
    const fov = player.isRunning ? RUNNING_FOV : NORMAL_FOV;
    if (Math.abs(engine.camera.fov - fov) > 0.05) {
      engine.camera.fov += (fov - engine.camera.fov) * Math.min(1, dt * 6);
      engine.camera.updateProjectionMatrix();
    }

    // Waypoint: show the distance, and clear it on arrival.
    let status = world.debugText;
    if (waypoint) {
      const distance = Math.hypot(waypoint.x - player.position.x, waypoint.z - player.position.z);
      if (distance < ARRIVED_DISTANCE) waypoint = null;
      else status += `  ·  waypoint ${Math.round(distance)} m`;
    }
    if (now < copiedUntil) status = copiedText;
    hud.textContent = status;
    minimap.draw({ x: player.position.x, z: player.position.z }, player.heading, waypoint);

    engine.render();                   // 6. draw the frame
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

main();
