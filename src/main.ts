import * as THREE from 'three';
import { AssetLibrary } from './render/assets';
import { PhysicsClient } from './physics/client';
import { buildPolygon } from './game/polygon';
import { heightAt } from './game/terrain';
import type { PlayerInput } from './shared/types';

const $ = (id: string) => document.getElementById(id)!;
const Q0 = new URLSearchParams(location.search);
const canvas = $('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q0.has('lowres') ? 0.5 : Math.min(devicePixelRatio, 1.5));
const Q = new URLSearchParams(location.search);
renderer.shadowMap.enabled = !Q.has('noshadow'); renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fb4c8'); scene.fog = new THREE.Fog('#9fb4c8', 120, 420);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1200); scene.add(camera);
scene.add(new THREE.HemisphereLight('#cfe0ff', '#4a4a3a', 1.3));
const sun = new THREE.DirectionalLight('#fff1d6', 2.6); sun.position.set(60, 90, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 300; sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const lib = new AssetLibrary(); const phys = new PhysicsClient();
let started = false, yaw = 0, pitch = 0;
const keys = new Set<string>(); let toggledCrouch = false, toggledProne = false;
let viewmodel: THREE.Object3D | null = null;
const SPAWN: [number, number, number] = [0, 1.0, 100];

async function boot() {
  const load = $('load');
  await lib.init((d, t, n) => { load.textContent = `Загрузка моделей ${d}/${t}: ${n}`; });
  await phys.ready;
  buildPolygon(scene, lib, phys);
  // viewmodel: настоящий АКМ из ассетов (никаких подмен — если файла нет, будет заглушка АКМ)
  const vm = lib.make('akm'); viewmodel = vm.object; camera.add(viewmodel);
  viewmodel.scale.setScalar(0.8); viewmodel.position.set(0.17, -0.2, -0.42); viewmodel.rotation.y = 0.04;
  phys.post({ type: 'spawnPlayer', pos: SPAWN });
  const real = lib.all().filter(i => !i.placeholder).length;
  load.innerHTML = `Готово. Реальных моделей: <b class="ok">${real}</b> · заглушек: <b class="ph">${lib.all().length - real}</b> · физ. тел: …`;
  ($('play') as HTMLButtonElement).disabled = false; ($('regbtn') as HTMLButtonElement).disabled = false;
  buildRegistry(); requestAnimationFrame(frame);
}
function buildRegistry() {
  const rows = lib.all().map(i => `<tr><td>${i.id}</td><td>${i.name}</td><td>${i.category}</td><td>${i.faction}</td><td class="${i.placeholder ? 'ph' : 'ok'}">${i.placeholder ? 'ЗАГЛУШКА (' + (i.placeholderSpec?.builder ?? '?') + ')' : 'МОДЕЛЬ'}</td><td>${i.source ?? '—'}</td><td>${i.size ? i.size.join(' × ') + ' м' : '—'}</td><td>${i.tris ?? ''}</td><td>${i.note ?? ''}</td></tr>`).join('');
  $('reg').innerHTML = `<h2 style="margin-top:0">Реестр ассетов (assets/manifest.json) — <span class="ok">${lib.all().filter(i => !i.placeholder).length} моделей</span> / <span class="ph">${lib.all().filter(i => i.placeholder).length} заглушек</span> · Tab — закрыть</h2><table><tr><th>id</th><th>Название</th><th>Категория</th><th>Сторона</th><th>Источник</th><th>Файл</th><th>Габариты</th><th>Треуг.</th><th>Примечание</th></tr>${rows}</table>`;
}
function toggleReg(force?: boolean) { const r = $('reg'); const show = force ?? r.style.display !== 'block'; r.style.display = show ? 'block' : 'none'; if (show && document.pointerLockElement) document.exitPointerLock(); }
$('regbtn').onclick = () => toggleReg(true);
$('play').onclick = () => { $('menu').style.display = 'none'; $('hud').style.display = 'block'; started = true; canvas.requestPointerLock(); };
canvas.addEventListener('click', () => { if (started && !document.pointerLockElement && $('reg').style.display !== 'block') canvas.requestPointerLock(); });
document.addEventListener('mousemove', e => {
  if (!document.pointerLockElement) return;
  yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022));
});
addEventListener('keydown', e => {
  if (e.code === 'Tab') { e.preventDefault(); if (started || $('menu').style.display !== 'none') toggleReg(); return; }
  if (e.repeat) return; keys.add(e.code);
  if (!started) return;
  if (e.code === 'KeyC') { toggledCrouch = !toggledCrouch; toggledProne = false; }
  if (e.code === 'KeyZ') { toggledProne = !toggledProne; toggledCrouch = false; }
  if (e.code === 'KeyR') phys.post({ type: 'spawnPlayer', pos: SPAWN });
  if (e.code === 'KeyF') throwCrate();
  if (e.code === 'KeyG') blast();
});
addEventListener('keyup', e => keys.delete(e.code));

function lookDir() { return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')); }
function throwCrate() {
  const c = lib.make('crate'); const d = lookDir(); const p = camera.position.clone().addScaledVector(d, 1.5);
  scene.add(c.object); c.object.position.copy(p);
  const id = phys.add({ kind: 'dynamic', pos: [p.x, p.y, p.z], mass: 25, shapes: [lib.colliderFor('crate', c.object)] }, c.object);
  phys.post({ type: 'impulse', id, imp: [d.x * 220, d.y * 220 + 40, d.z * 220] });
}
function blast() {
  // точка прицела: шагаем лучом до пересечения с рельефом (в зоне полигона рельеф плоский y=0)
  const d = lookDir(); const o = camera.position.clone(); let t = 1, hit: THREE.Vector3 | null = null;
  for (; t < 160; t += 0.5) { const p = o.clone().addScaledVector(d, t); if (p.y <= heightAt(p.x, p.z) + 0.2) { hit = p; break; } }
  hit ??= o.clone().addScaledVector(d, 40);
  phys.post({ type: 'explosion', pos: [hit.x, hit.y, hit.z], radius: 18, impulse: 900 });
  spawnBlastFx(hit);
}
const fx: { m: THREE.Mesh; age: number }[] = [];
function spawnBlastFx(p: THREE.Vector3) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.copy(p); scene.add(m); fx.push({ m, age: 0 });
  const l = new THREE.PointLight('#ffa040', 400, 40); l.position.copy(p).add(new THREE.Vector3(0, 2, 0)); scene.add(l); setTimeout(() => scene.remove(l), 150);
}

let lastT = performance.now(), fps = 60, eyeY = 1.65, bob = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  const inp: PlayerInput = {
    yaw, pitch, fwd: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), right: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    jump: keys.has('Space'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), crouch: toggledCrouch || keys.has('ControlLeft'), prone: toggledProne,
  };
  if (started) phys.sendInput(inp);
  const pl = phys.interpolate();
  if (pl && phys.player) {
    const p = phys.player; eyeY += (p.eye - eyeY) * Math.min(1, dt * 12);
    const spd = Math.hypot(p.vel[0], p.vel[2]); bob += dt * spd * 1.7; const b = p.grounded ? Math.sin(bob) * Math.min(spd, 8) * 0.0045 : 0;
    camera.position.set(pl.pos.x, pl.pos.y + eyeY + b, pl.pos.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (freecam) { camera.position.set(...freecam.pos); camera.rotation.set(freecam.pitch, freecam.yaw, 0, 'YXZ'); }
    if (viewmodel) { const sprint = inp.sprint && spd > 6; viewmodel.position.set(0.17 + Math.sin(bob * 0.5) * 0.004 * Math.min(spd, 8) * 0.4, -0.2 - Math.abs(Math.sin(bob)) * 0.004 * Math.min(spd, 8) * 0.4 - (p.stance === 2 ? 0.05 : 0), -0.42); viewmodel.rotation.x += ((sprint ? -0.35 : 0) - viewmodel.rotation.x) * Math.min(1, dt * 10); viewmodel.rotation.y += ((sprint ? 0.5 : 0.04) - viewmodel.rotation.y) * Math.min(1, dt * 10); }
    sun.position.set(pl.pos.x + 60, 90, pl.pos.z + 40); sun.target.position.copy(pl.pos);
    $('hp').style.width = Math.max(0, p.hp) + '%'; $('hpt').textContent = 'HP ' + Math.max(0, Math.round(p.hp));
    $('stam').style.width = p.stamina + '%'; $('stance').textContent = ['Стоя', 'Присед', 'Лёжа'][p.stance] + (p.sliding ? ' · СКОЛЬЖЕНИЕ' : '') + (p.grounded ? '' : ' · в воздухе');
    const s = phys.stats; $('info').textContent = `FPS ${fps.toFixed(0)}\nФизика (воркер, 60 Гц): ${s.stepMs.toFixed(2)} мс/шаг\nТел активно/всего: ${s.awake}/${s.total}\nСкорость: ${spd.toFixed(1)} м/с\nPos: ${p.pos.map(v => v.toFixed(1)).join(', ')}`;
    if (p.hp < lastHp) { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = '0.35'; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; }); }
    lastHp = p.hp;
  }
  for (let i = fx.length - 1; i >= 0; i--) { const e = fx[i]; e.age += dt; const k = e.age / 0.6; e.m.scale.setScalar(1 + k * 14); (e.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - k); if (k >= 1) { scene.remove(e.m); fx.splice(i, 1); } }
  renderer.render(scene, camera);
}
let lastHp = 100; let freecam: { pos: [number, number, number]; yaw: number; pitch: number } | null = null;
// хуки для автотестов
(window as any).__game = { phys, lib, camera, scene, setLook: (y: number, p: number) => { yaw = y; pitch = p; }, start: () => { $('play').click(); }, keys, blast, throwCrate, cam: (pos: [number, number, number] | null, yaw = 0, pitch = 0) => { freecam = pos ? { pos, yaw, pitch } : null; } };
boot().catch(e => { $('load').textContent = 'Ошибка: ' + e; console.error(e); });
