import * as THREE from 'three';
import { CityLayout } from '../world/CityLayout';
import { CityMapImage } from '../ui/CityMapImage';
import { CITY_PLAN, replaceCityPlan, type CityPlan, type Point } from '../world/cityPlan';
import { CHUNK_SIZE, WORLD_HALF, chunkOf } from '../world/config';

// =============================================================================================
// THE CITY PLANNER: draw and edit the city plan with the mouse, on top of a live preview of
// the real generated city, with a coordinate grid. "Save to game" writes cityPlan.json.
// Open it at http://localhost:5173/planner.html while `npm run dev` is running.
// =============================================================================================

type Tool = 'select' | 'road' | 'district' | 'green' | 'pond' | 'mountain';
type Kind = 'road' | 'river' | 'district' | 'green' | 'pond' | 'mountain' | 'spawn';
interface Ref { kind: Kind; index: number }
/** A draggable point. point = index in the shape's points; -1 = the radius handle of a pond/mountain. */
interface Handle { ref: Ref; point: number }

const TOOL_HELP: Record<Tool, string> = {
  select: 'Click a shape to select it. Drag points to move them, or drag a shape to move all of it.',
  road: 'Click to add road points. The road is a smooth curve through them. Enter or double-click to finish.',
  district: 'Click around the district’s outline. Enter or double-click to finish. Streets appear inside it.',
  green: 'Click around a park or forest outline. Enter or double-click to finish.',
  pond: 'Click where the pond’s centre should be.',
  mountain: 'Click where the mountain’s peak should be.',
};

const COLORS: Record<Kind, string> = {
  road: '#2c2c2a', river: '#185FA5', district: '#534AB7', green: '#27500A',
  pond: '#185FA5', mountain: '#712B13', spawn: '#E24B4A',
};

// ---------- State ----------
let plan: CityPlan = structuredClone(CITY_PLAN);
const original = structuredClone(CITY_PLAN);
const history: string[] = [];
let layout = CityLayout.build();
let mapImage = new CityMapImage(layout);

let tool: Tool = 'select';
let selected: Ref | null = null;
let selectedPoint = -2;          // index of the selected point, or -2 for none
let draft: Point[] = [];         // points of the shape being drawn
let cursor: Point = [0, 0];      // world position under the mouse

const view = { x: 0, z: 0, zoom: 0.12 }; // zoom = screen pixels per world unit
const saved = sessionStorage.getItem('planner-view');
if (saved) Object.assign(view, JSON.parse(saved)); // keep the view when the page reloads after saving

// ---------- Elements ----------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const readout = document.getElementById('readout')!;
const busy = document.getElementById('busy')!;
const props = document.getElementById('props')!;
const settings = document.getElementById('settings')!;
const status = document.getElementById('status')!;
const toolHelp = document.getElementById('tool-help')!;
const check = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

// =============================================================================================
// Coordinates
// =============================================================================================

function toScreen(x: number, z: number): [number, number] {
  return [canvas.clientWidth / 2 + (x - view.x) * view.zoom, canvas.clientHeight / 2 + (z - view.z) * view.zoom];
}

function toWorld(sx: number, sy: number): Point {
  return [view.x + (sx - canvas.clientWidth / 2) / view.zoom, view.z + (sy - canvas.clientHeight / 2) / view.zoom];
}

function snap(p: Point): Point {
  const step = check('snap').checked ? 10 : 1;
  const limit = WORLD_HALF;
  const s = (v: number): number => Math.max(-limit, Math.min(limit, Math.round(v / step) * step));
  return [s(p[0]), s(p[1])];
}

function saveView(): void {
  sessionStorage.setItem('planner-view', JSON.stringify(view));
}

// =============================================================================================
// Shapes: every editable thing is a "shape" with points
// =============================================================================================

function allRefs(): Ref[] {
  const refs: Ref[] = [{ kind: 'spawn', index: 0 }, { kind: 'river', index: 0 }];
  plan.roads.forEach((_, i) => refs.push({ kind: 'road', index: i }));
  plan.districts.forEach((_, i) => refs.push({ kind: 'district', index: i }));
  plan.greens.forEach((_, i) => refs.push({ kind: 'green', index: i }));
  plan.ponds.forEach((_, i) => refs.push({ kind: 'pond', index: i }));
  plan.mountains.forEach((_, i) => refs.push({ kind: 'mountain', index: i }));
  return refs;
}

/** The points of a shape (for ponds and mountains: their centre). */
function pointsOf(ref: Ref): Point[] {
  switch (ref.kind) {
    case 'road': return plan.roads[ref.index].points;
    case 'river': return plan.river.points;
    case 'district': return plan.districts[ref.index].polygon;
    case 'green': return plan.greens[ref.index].polygon;
    case 'pond': { const p = plan.ponds[ref.index]; return [[p.x, p.z]]; }
    case 'mountain': { const m = plan.mountains[ref.index]; return [[m.x, m.z]]; }
    case 'spawn': return [plan.spawn];
  }
}

function setPoint(ref: Ref, i: number, p: Point): void {
  switch (ref.kind) {
    case 'pond': plan.ponds[ref.index].x = p[0]; plan.ponds[ref.index].z = p[1]; break;
    case 'mountain': plan.mountains[ref.index].x = p[0]; plan.mountains[ref.index].z = p[1]; break;
    case 'spawn': plan.spawn = p; break;
    default: pointsOf(ref)[i] = p;
  }
}

function radiusOf(ref: Ref): number | null {
  if (ref.kind === 'pond') return plan.ponds[ref.index].radius;
  if (ref.kind === 'mountain') return plan.mountains[ref.index].radius;
  return null;
}

function isClosed(ref: Ref): boolean {
  if (ref.kind === 'district' || ref.kind === 'green') return true;
  if (ref.kind === 'road') return !!plan.roads[ref.index].closed;
  return false;
}

function nameOf(ref: Ref): string {
  switch (ref.kind) {
    case 'road': return plan.roads[ref.index].name;
    case 'district': return plan.districts[ref.index].name;
    case 'green': return plan.greens[ref.index].name;
    case 'river': return 'River';
    case 'pond': return `Pond ${ref.index + 1}`;
    case 'mountain': return `Mountain ${ref.index + 1}`;
    case 'spawn': return 'Spawn point';
  }
}

const sameRef = (a: Ref | null, b: Ref | null): boolean => !!a && !!b && a.kind === b.kind && a.index === b.index;

// =============================================================================================
// Hit testing: what's under the mouse?
// =============================================================================================

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = dx * dx + dz * dz;
  const t = len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

function inside(p: Point, poly: Point[]): boolean {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) result = !result;
  }
  return result;
}

function hitHandle(p: Point): Handle | null {
  const tolerance = 9 / view.zoom;
  let best: Handle | null = null;
  let bestD = tolerance;
  // The selected shape's points win over everything else.
  const refs = selected ? [selected, ...allRefs().filter((r) => !sameRef(r, selected))] : allRefs();
  for (const ref of refs) {
    pointsOf(ref).forEach((q, i) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bestD) { bestD = d; best = { ref, point: i }; }
    });
    const r = radiusOf(ref);
    if (r !== null && sameRef(ref, selected)) {
      const [cx, cz] = pointsOf(ref)[0];
      const d = Math.hypot(cx + r - p[0], cz - p[1]);
      if (d < bestD) { bestD = d; best = { ref, point: -1 }; }
    }
    if (best && sameRef(ref, selected)) return best;
  }
  return best;
}

function hitShape(p: Point): Ref | null {
  const tolerance = 8 / view.zoom;
  // 1. Near a line (roads, river, outlines).
  for (const ref of allRefs()) {
    const pts = pointsOf(ref);
    if (pts.length < 2) continue;
    const n = isClosed(ref) ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      if (distToSegment(p, pts[i], pts[(i + 1) % pts.length]) < tolerance) return ref;
    }
  }
  // 2. Inside something, smallest kinds first: ponds, then parks (they sit inside districts),
  //    then districts, and mountains last, since their circles are huge and cover everything.
  const insideCircle = (ref: Ref): boolean => {
    const [cx, cz] = pointsOf(ref)[0];
    return Math.hypot(cx - p[0], cz - p[1]) < (radiusOf(ref) ?? 0);
  };
  for (const kind of ['pond', 'green', 'district', 'mountain'] as Kind[]) {
    for (const ref of allRefs().filter((r) => r.kind === kind)) {
      if (kind === 'pond' || kind === 'mountain' ? insideCircle(ref) : inside(p, pointsOf(ref))) return ref;
    }
  }
  return null;
}

// =============================================================================================
// Editing
// =============================================================================================

function pushHistory(): void {
  history.push(JSON.stringify(plan));
  if (history.length > 60) history.shift();
}

function undo(): void {
  const previous = history.pop();
  if (!previous) return;
  plan = JSON.parse(previous);
  selected = null;
  selectedPoint = -2;
  changed();
}

function select(ref: Ref | null, point = -2): void {
  selected = ref;
  selectedPoint = point;
  renderProps();
  draw();
}

function deleteSelection(): void {
  if (!selected || selected.kind === 'spawn') return;
  const pts = pointsOf(selected);
  const minimum = selected.kind === 'district' || selected.kind === 'green' ? 3 : 2;
  pushHistory();
  if (selectedPoint >= 0 && pts.length > minimum && selected.kind !== 'pond' && selected.kind !== 'mountain') {
    pts.splice(selectedPoint, 1);           // remove one point
    selectedPoint = -2;
  } else if (selected.kind === 'river') {
    return;                                 // the river can be reshaped, not deleted
  } else {
    const lists: Record<string, unknown[]> = {
      road: plan.roads, district: plan.districts, green: plan.greens, pond: plan.ponds, mountain: plan.mountains,
    };
    lists[selected.kind].splice(selected.index, 1);  // remove the whole shape
    selected = null;
    selectedPoint = -2;
  }
  changed();
}

/** Adds a point to the selected shape on the edge nearest to p. */
function insertPoint(p: Point): void {
  if (!selected || selected.kind === 'pond' || selected.kind === 'mountain' || selected.kind === 'spawn') return;
  const pts = pointsOf(selected);
  const n = isClosed(selected) ? pts.length : pts.length - 1;
  let bestI = -1;
  let bestD = 12 / view.zoom;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI < 0) return;
  pushHistory();
  pts.splice(bestI + 1, 0, snap(p));
  selectedPoint = bestI + 1;
  changed();
}

function finishDraft(): void {
  const pts = draft;
  draft = [];
  if (tool === 'road' && pts.length >= 2) {
    pushHistory();
    plan.roads.push({ name: `Road ${plan.roads.length + 1}`, width: 12, points: pts });
    select({ kind: 'road', index: plan.roads.length - 1 });
  } else if (tool === 'district' && pts.length >= 3) {
    pushHistory();
    plan.districts.push({ name: `District ${plan.districts.length + 1}`, style: 'residential', polygon: pts, streetAngle: 0, streetSpacing: 70 });
    select({ kind: 'district', index: plan.districts.length - 1 });
  } else if (tool === 'green' && pts.length >= 3) {
    pushHistory();
    plan.greens.push({ name: `Park ${plan.greens.length + 1}`, kind: 'park', polygon: pts, density: 0.15 });
    select({ kind: 'green', index: plan.greens.length - 1 });
  } else {
    draw();
    return;
  }
  changed();
}

// ---------- Rebuilding the preview ----------
let rebuildTimer = 0;

/** Something in the plan changed: redraw now, rebuild the real city layout shortly after. */
function changed(): void {
  renderProps();
  draw();
  status.textContent = 'Unsaved changes';
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(rebuild, 350);
}

function rebuild(): void {
  busy.style.display = 'block';
  // Let the "Rebuilding" label appear before the (blocking) rebuild starts.
  window.setTimeout(() => {
    replaceCityPlan(plan);
    layout = CityLayout.build();
    mapImage = new CityMapImage(layout);
    busy.style.display = 'none';
    draw();
  }, 20);
}

// =============================================================================================
// Mouse and keyboard
// =============================================================================================

type Drag = { mode: 'pan' | 'point' | 'shape' | 'none'; startX: number; startY: number; moved: boolean; last: Point; handle?: Handle };
let drag: Drag = { mode: 'none', startX: 0, startY: 0, moved: false, last: [0, 0] };

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toWorld(e.offsetX, e.offsetY);
  drag = { mode: 'pan', startX: e.offsetX, startY: e.offsetY, moved: false, last: p };
  if (e.button !== 0 || tool !== 'select') return; // other tools add points on click (pointerup)

  const handle = hitHandle(p);
  if (handle) {
    drag.mode = 'point';
    drag.handle = handle;
    select(handle.ref, handle.point);
    return;
  }
  const shape = hitShape(p);
  if (shape) {
    drag.mode = sameRef(shape, selected) ? 'shape' : 'pan';
    if (!sameRef(shape, selected)) select(shape);
    return;
  }
  select(null);
});

canvas.addEventListener('pointermove', (e) => {
  cursor = toWorld(e.offsetX, e.offsetY);
  updateReadout();
  if (drag.mode === 'none' || !(e.buttons & 7)) {
    if (draft.length) draw(); // rubber band line while drawing
    return;
  }
  if (!drag.moved && Math.hypot(e.offsetX - drag.startX, e.offsetY - drag.startY) > 4) {
    drag.moved = true;
    if (drag.mode !== 'pan') pushHistory(); // one undo step per drag
  }
  if (!drag.moved) return;

  if (drag.mode === 'pan') {
    view.x -= e.movementX / view.zoom;
    view.z -= e.movementY / view.zoom;
    saveView();
  } else if (drag.mode === 'point' && drag.handle) {
    const { ref, point } = drag.handle;
    if (point === -1) {
      const [cx, cz] = pointsOf(ref)[0];
      const r = Math.max(10, Math.round(Math.hypot(cursor[0] - cx, cursor[1] - cz)));
      if (ref.kind === 'pond') plan.ponds[ref.index].radius = r;
      else plan.mountains[ref.index].radius = r;
    } else {
      setPoint(ref, point, snap(cursor));
    }
    renderProps();
  } else if (drag.mode === 'shape' && selected) {
    const dx = cursor[0] - drag.last[0];
    const dz = cursor[1] - drag.last[1];
    pointsOf(selected).forEach((q, i) => setPoint(selected!, i, [q[0] + dx, q[1] + dz]));
  }
  drag.last = cursor;
  draw();
});

canvas.addEventListener('pointerup', (e) => {
  const wasDrag = drag.moved;
  const mode = drag.mode;
  drag = { mode: 'none', startX: 0, startY: 0, moved: false, last: [0, 0] };

  if ((mode === 'point' || mode === 'shape') && wasDrag && selected) {
    // Round the moved shape's points neatly, then rebuild.
    pointsOf(selected).forEach((q, i) => setPoint(selected!, i, snap(q)));
    changed();
    return;
  }
  if (wasDrag || e.button !== 0) return;

  const p = snap(toWorld(e.offsetX, e.offsetY));
  if (tool === 'road' || tool === 'district' || tool === 'green') {
    draft.push(p);
    draw();
  } else if (tool === 'pond') {
    pushHistory();
    plan.ponds.push({ x: p[0], z: p[1], radius: 40 });
    select({ kind: 'pond', index: plan.ponds.length - 1 });
    changed();
  } else if (tool === 'mountain') {
    pushHistory();
    plan.mountains.push({ x: p[0], z: p[1], radius: 500, height: 140 });
    select({ kind: 'mountain', index: plan.mountains.length - 1 });
    changed();
  }
});

canvas.addEventListener('dblclick', (e) => {
  const p = toWorld(e.offsetX, e.offsetY);
  if (draft.length) {
    draft.pop(); // the double-click's second click added a duplicate point
    finishDraft();
  } else if (tool === 'select') {
    insertPoint(p);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Zoom around the mouse, so the point under it stays put.
  const before = toWorld(e.offsetX, e.offsetY);
  view.zoom = Math.min(4, Math.max(0.05, view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const after = toWorld(e.offsetX, e.offsetY);
  view.x += before[0] - after[0];
  view.z += before[1] - after[1];
  saveView();
  draw();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'Enter') finishDraft();
  else if (e.key === 'Escape') { draft = []; select(null); }
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
  else {
    const keys: Record<string, Tool> = { v: 'select', r: 'road', d: 'district', g: 'green', p: 'pond', m: 'mountain' };
    const t = keys[e.key.toLowerCase()];
    if (t) setTool(t);
  }
});

function setTool(t: Tool): void {
  tool = t;
  draft = [];
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  toolHelp.textContent = TOOL_HELP[t];
  canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
  draw();
}
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
  b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));

function updateReadout(): void {
  const [x, z] = cursor;
  readout.textContent = `x ${Math.round(x)}, z ${Math.round(z)}  ·  chunk (${chunkOf(x)}, ${chunkOf(z)})  ·  ${layout.placeName(x, z)}`;
}

// =============================================================================================
// Side panel: properties of the selected shape, and city-wide settings
// =============================================================================================

function field(parent: HTMLElement, label: string, input: HTMLElement): void {
  const row = document.createElement('div');
  row.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  row.append(l, input);
  parent.appendChild(row);
}

function numberInput(value: number, onChange: (v: number) => void, step = 1): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) { pushHistory(); onChange(v); changed(); }
  });
  return input;
}

function textInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => { pushHistory(); onChange(input.value); changed(); });
  return input;
}

function selectInput<T extends string>(value: T, options: T[], onChange: (v: T) => void): HTMLSelectElement {
  const select = document.createElement('select');
  for (const o of options) {
    const option = document.createElement('option');
    option.value = o;
    option.textContent = o;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener('change', () => { pushHistory(); onChange(select.value as T); changed(); });
  return select;
}

function renderProps(): void {
  props.innerHTML = '';
  if (!selected) {
    props.textContent = 'Nothing selected. Click a road, district, park, river, pond or mountain.';
    return;
  }
  const title = document.createElement('div');
  title.innerHTML = `<b>${nameOf(selected)}</b> <span style="color:#5f5e5a">(${selected.kind})</span>`;
  props.appendChild(title);

  const ref = selected;
  switch (ref.kind) {
    case 'road': {
      const r = plan.roads[ref.index];
      field(props, 'Name', textInput(r.name, (v) => (r.name = v)));
      field(props, 'Width', numberInput(r.width, (v) => (r.width = Math.max(4, v))));
      const loop = document.createElement('input');
      loop.type = 'checkbox';
      loop.checked = !!r.closed;
      loop.addEventListener('change', () => { pushHistory(); r.closed = loop.checked; changed(); });
      field(props, 'Loop (ring road)', loop);
      break;
    }
    case 'river':
      field(props, 'Width', numberInput(plan.river.width, (v) => (plan.river.width = Math.max(6, v))));
      break;
    case 'district': {
      const d = plan.districts[ref.index];
      field(props, 'Name', textInput(d.name, (v) => (d.name = v)));
      field(props, 'Style', selectInput(d.style, ['downtown', 'residential', 'suburb'], (v) => (d.style = v)));
      field(props, 'Street angle °', numberInput(d.streetAngle, (v) => (d.streetAngle = v)));
      field(props, 'Street spacing', numberInput(d.streetSpacing, (v) => (d.streetSpacing = Math.max(40, v)), 5));
      break;
    }
    case 'green': {
      const g = plan.greens[ref.index];
      field(props, 'Name', textInput(g.name, (v) => (g.name = v)));
      field(props, 'Kind', selectInput(g.kind, ['park', 'forest'], (v) => (g.kind = v)));
      field(props, 'Tree density', numberInput(g.density, (v) => (g.density = Math.min(1, Math.max(0, v))), 0.05));
      break;
    }
    case 'pond': {
      const p = plan.ponds[ref.index];
      field(props, 'Radius', numberInput(p.radius, (v) => (p.radius = Math.max(10, v))));
      break;
    }
    case 'mountain': {
      const m = plan.mountains[ref.index];
      field(props, 'Radius', numberInput(m.radius, (v) => (m.radius = Math.max(50, v)), 10));
      field(props, 'Height', numberInput(m.height, (v) => (m.height = Math.max(10, v)), 10));
      break;
    }
    case 'spawn':
      break;
  }

  // Coordinates of the selected point, editable for exact placement.
  const pts = pointsOf(ref);
  const i = selectedPoint >= 0 ? selectedPoint : 0;
  if (pts[i]) {
    const label = selectedPoint >= 0 ? `Point ${i + 1} of ${pts.length}` : ref.kind === 'pond' || ref.kind === 'mountain' || ref.kind === 'spawn' ? 'Position' : `First point (of ${pts.length})`;
    const sub = document.createElement('div');
    sub.style.cssText = 'margin-top:8px;color:#5f5e5a';
    sub.textContent = label;
    props.appendChild(sub);
    field(props, 'x', numberInput(pts[i][0], (v) => setPoint(ref, i, [v, pointsOf(ref)[i][1]])));
    field(props, 'z', numberInput(pts[i][1], (v) => setPoint(ref, i, [pointsOf(ref)[i][0], v])));
  }

  if (ref.kind !== 'spawn' && ref.kind !== 'river') {
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = selectedPoint >= 0 && pts.length > 1 ? 'Delete point' : 'Delete shape';
    del.style.marginTop = '8px';
    del.addEventListener('click', deleteSelection);
    props.appendChild(del);
  }
}

function renderSettings(): void {
  settings.innerHTML = '';
  field(settings, 'Border mountains band', numberInput(plan.borderMountains.band, (v) => (plan.borderMountains.band = Math.max(100, v)), 50));
  field(settings, 'Border mountains height', numberInput(plan.borderMountains.height, (v) => (plan.borderMountains.height = Math.max(0, v)), 10));
  field(settings, 'Countryside trees', numberInput(plan.countrysideTreeDensity, (v) => (plan.countrysideTreeDensity = Math.min(1, Math.max(0, v))), 0.01));
}

// =============================================================================================
// Drawing
// =============================================================================================

function draw(): void {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#3d3d3a';
  ctx.fillRect(0, 0, w, h);

  // The generated city (exactly what the game builds).
  const [left, top] = toScreen(-WORLD_HALF, -WORLD_HALF);
  const size = 2 * WORLD_HALF * view.zoom;
  if (check('show-preview').checked) {
    ctx.imageSmoothingEnabled = view.zoom < 0.5;
    ctx.drawImage(mapImage.canvas, left, top, size, size);
  } else {
    ctx.fillStyle = '#9cc46a';
    ctx.fillRect(left, top, size, size);
  }

  if (check('show-grid').checked) drawGrid(w, h);
  if (check('show-outlines').checked) drawPlan();
  drawDraft();
}

function drawGrid(w: number, h: number): void {
  // Pick a line spacing that stays readable at this zoom: chunk lines when zoomed in.
  const steps = [80, 160, 400, 800, 1600];
  const step = steps.find((s) => s * view.zoom >= 45) ?? 1600;
  const [x0, z0] = toWorld(0, 0);
  const [x1, z1] = toWorld(w, h);

  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, monospace';
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    if (Math.abs(x) > WORLD_HALF) continue;
    const [sx] = toScreen(x, 0);
    ctx.strokeStyle = x === 0 ? 'rgba(226,75,74,0.9)' : x % 400 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    ctx.fillStyle = 'rgba(44,44,42,0.8)';
    ctx.fillRect(sx + 2, 2, ctx.measureText(String(x)).width + 6, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(x), sx + 5, 13);
  }
  for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) {
    if (Math.abs(z) > WORLD_HALF) continue;
    const [, sy] = toScreen(0, z);
    ctx.strokeStyle = z === 0 ? 'rgba(226,75,74,0.9)' : z % 400 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    ctx.fillStyle = 'rgba(44,44,42,0.8)';
    ctx.fillRect(2, sy + 2, ctx.measureText(String(z)).width + 6, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(z), 5, sy + 13);
  }
  // Labels for the axes and the city's edge.
  const [ox, oz] = toScreen(0, 0);
  ctx.fillStyle = '#E24B4A';
  ctx.fillText('origin (0, 0)', ox + 5, oz - 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.setLineDash([6, 4]);
  const [ex, ez] = toScreen(-WORLD_HALF, -WORLD_HALF);
  ctx.strokeRect(ex, ez, 2 * WORLD_HALF * view.zoom, 2 * WORLD_HALF * view.zoom);
  ctx.setLineDash([]);
  if (step === CHUNK_SIZE) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('grid = chunk borders (80 units)', w - 220, h - 12);
  }
}

function drawPlan(): void {
  for (const ref of allRefs()) {
    const isSel = sameRef(ref, selected);
    const pts = pointsOf(ref);
    const color = COLORS[ref.kind];
    const r = radiusOf(ref);

    ctx.lineWidth = isSel ? 3 : 1.6;
    ctx.strokeStyle = color;
    ctx.setLineDash(ref.kind === 'road' || ref.kind === 'river' ? [] : [6, 4]);

    if (r !== null) {
      const [sx, sy] = toScreen(pts[0][0], pts[0][1]);
      ctx.beginPath();
      ctx.arc(sx, sy, r * view.zoom, 0, Math.PI * 2);
      ctx.stroke();
      if (isSel) {
        const [hx, hy] = toScreen(pts[0][0] + r, pts[0][1]);
        handleDot(hx, hy, '#ffffff', color, false);
      }
    } else if (pts.length > 1) {
      ctx.beginPath();
      smoothed(ref, pts).forEach(([x, z], i) => {
        const [sx, sy] = toScreen(x, z);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      if (isClosed(ref) && ref.kind !== 'road') ctx.closePath();
      if (isSel && (ref.kind === 'district' || ref.kind === 'green')) {
        ctx.fillStyle = ref.kind === 'district' ? 'rgba(83,74,183,0.15)' : 'rgba(39,80,10,0.18)';
        ctx.fill();
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Points: always for the selected shape; small ones for the others.
    pts.forEach(([x, z], i) => {
      const [sx, sy] = toScreen(x, z);
      if (isSel) handleDot(sx, sy, i === selectedPoint ? '#EF9F27' : '#ffffff', color, true);
      else if (ref.kind === 'spawn') handleDot(sx, sy, '#E24B4A', '#ffffff', true);
      else { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fill(); }
    });

    // Name label.
    if (ref.kind === 'district' || ref.kind === 'green' || (ref.kind === 'road' && view.zoom > 0.15) || ref.kind === 'spawn') {
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const [sx, sy] = ref.kind === 'road' ? toScreen(...pts[Math.floor(pts.length / 2)]) : toScreen(cx, cz);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(nameOf(ref), sx, sy - (ref.kind === 'spawn' ? 12 : 0));
      ctx.fillStyle = color;
      ctx.fillText(nameOf(ref), sx, sy - (ref.kind === 'spawn' ? 12 : 0));
      ctx.textAlign = 'left';
    }
  }
}

/**
 * Roads and the river are drawn as the same smooth curve the game builds through their points
 * (so the outline matches the real road). Areas keep their straight edges.
 */
function smoothed(ref: Ref, pts: Point[]): Point[] {
  if ((ref.kind !== 'road' && ref.kind !== 'river') || pts.length < 2) return pts;
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), isClosed(ref), 'centripetal'
  );
  return curve.getSpacedPoints(Math.min(400, pts.length * 24)).map((v) => [v.x, v.z] as Point);
}

function handleDot(sx: number, sy: number, fill: string, stroke: string, round: boolean): void {
  ctx.beginPath();
  if (round) ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
  else ctx.rect(sx - 5, sy - 5, 10, 10);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawDraft(): void {
  if (!draft.length) return;
  const closed = tool === 'district' || tool === 'green';
  ctx.strokeStyle = '#EF9F27';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  [...draft, snap(cursor)].forEach(([x, z], i) => {
    const [sx, sy] = toScreen(x, z);
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  if (closed && draft.length >= 2) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, z] of draft) {
    const [sx, sy] = toScreen(x, z);
    handleDot(sx, sy, '#EF9F27', '#ffffff', true);
  }
}

// =============================================================================================
// Saving
// =============================================================================================

/** JSON with each [x, z] pair on one line, so the file stays readable. */
function formatPlan(p: CityPlan): string {
  return JSON.stringify(p, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]') + '\n';
}

document.getElementById('save')!.addEventListener('click', async () => {
  try {
    const response = await fetch('/__save-plan', { method: 'POST', body: formatPlan(plan) });
    if (!response.ok) throw new Error(await response.text());
    status.textContent = 'Saved to src/world/cityPlan.json. The game reloads with it.';
  } catch {
    status.textContent = 'Could not save (is vite.config.ts in place?). Use Download JSON instead.';
  }
});

document.getElementById('download')!.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([formatPlan(plan)], { type: 'application/json' }));
  link.download = 'cityPlan.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById('undo')!.addEventListener('click', undo);
document.getElementById('revert')!.addEventListener('click', () => {
  if (!confirm('Throw away all changes since the planner opened?')) return;
  pushHistory();
  plan = structuredClone(original);
  select(null);
  renderSettings();
  changed();
});

for (const id of ['show-preview', 'show-grid', 'show-outlines']) check(id).addEventListener('change', draw);

// ---------- Start ----------
window.addEventListener('resize', draw);
setTool('select');
renderSettings();
renderProps();
draw();
