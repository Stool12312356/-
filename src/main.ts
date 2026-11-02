import * as THREE from 'three';
import { AssetLibrary } from './render/assets';
import { PhysicsClient } from './physics/client';
import { buildPolygon } from './game/polygon';
import { heightAt } from './game/terrain';
import { setupEnvironment } from './render/env';
import { Effects } from './game/effects';
import { PlayerCombat } from './game/combat';
import { Bots } from './game/bots';
import { buildBuilding, buildBuildingMesh } from './game/buildings';
import { spawnBuilding, type Building } from './game/damage';
import { SURFACES, pointBlankRange } from './game/weapons';
import type { PlayerInput, Impact } from './shared/types';

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
scene.add(new THREE.HemisphereLight('#cfe0ff', '#4a4a3a', 1.0));
const sun = new THREE.DirectionalLight('#fff1d6', 2.4); sun.position.set(60, 90, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 300; sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
// PBR без окружения делает металл чёрным — именно из-за этого ГАЗ-66/Ми-8 были силуэтами
setupEnvironment(renderer, scene);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const lib = new AssetLibrary(); const phys = new PhysicsClient();
let started = false, yaw = 0, pitch = 0;
const keys = new Set<string>(); let toggledCrouch = false, toggledProne = false;
let viewmodel: THREE.Object3D | null = null;
const SPAWN: [number, number, number] = [0, 1.0, 100];

// создаются в boot(); временно null, чтобы кадр до загрузки не падал
let effects: Effects | null = null; let combat: PlayerCombat | null = null; let bots: Bots | null = null;
const buildings: Building[] = [];
/** панель → дом (индекс) */
const panelOwner = new Map<string, Building>();
let aimMsg = '', aimT = 0;
let lastHitMarker = 0;

async function boot() {
  const load = $('load');
  await lib.init((d, t, n) => { load.textContent = `Загрузка моделей ${d}/${t}: ${n}`; });
  await phys.ready;
  buildPolygon(scene, lib, phys);
  spawnBuildings();
  const fx = effects = new Effects(scene);
  const cmb = combat = new PlayerCombat(lib, phys, fx, camera);
  cmb.onViewModel = (obj) => {
    if (viewmodel) viewmodel.removeFromParent();
    viewmodel = obj;
    if (viewmodel) {
      camera.add(viewmodel);
      viewmodel.position.set(0.16, -0.19, -0.42);
      viewmodel.rotation.set(0, 0.03, 0);
    }
  };
  cmb.onRecoil = (dp, dy) => { pitch = Math.max(-1.5, Math.min(1.5, pitch + dp)); yaw += dy; };
  cmb.equip(0);
  const bt = bots = new Bots(scene, lib, phys);
  // мишени: 6 своих и 6 противников (у противника другая модель — forest_soldier_outdated)
  for (let i = 0; i < 6; i++) bt.spawn('soldier_ussr', [-30 + i * 3, 0.02, -50], Math.PI, 0);
  for (let i = 0; i < 6; i++) bt.spawn('soldier_opfor', [-30 + i * 3, 0.02, -42], 0, 1);
  phys.onImpact(onImpact);
  phys.post({ type: 'spawnPlayer', pos: SPAWN });
  const real = lib.all().filter(i => !i.placeholder && !i.procedural).length;
  load.innerHTML = `Готово. Реальных моделей: <b class="ok">${real}</b> · заглушек: <b class="ph">${lib.all().filter(i => i.placeholder).length}</b> · процедурных домов: <b class="ok">${buildings.length}</b>`;
  ($('play') as HTMLButtonElement).disabled = false; ($('regbtn') as HTMLButtonElement).disabled = false;
  buildRegistry(); requestAnimationFrame(frame);
}
void buildBuildingMesh;

/** Ставит процедурные панельки: хрущёвка и брежневка на своих местах. */
function spawnBuildings() {
  const defs: { kind: 'khrushchevka' | 'brezhnevka'; pos: [number, number, number]; rotY: number }[] = [
    { kind: 'khrushchevka', pos: [-72, 0, -86], rotY: 0 },
    { kind: 'brezhnevka', pos: [-20, 0, -105], rotY: 0 },
    { kind: 'khrushchevka', pos: [30, 0, -112], rotY: Math.PI },
  ];
  for (const d of defs) {
    const spec = buildBuilding({ kind: d.kind, sections: d.kind === 'khrushchevka' ? 3 : 2 });
    const b = spawnBuilding(spec, d.kind, scene, phys, d.pos, d.rotY);
    buildings.push(b);
    // карта «дом + панель» для попаданий: id физического тела дома известен
    panelOwner.set(String(b.physicsId), b);
    console.log(`дом ${d.kind}: панелей ${spec.panels.length}, несущих по секциям ${spec.loadBearingBySection.map(s => s.length).join('/')}`);
  }
}

function onImpact(i: Impact) {
  if (!effects || !bots) return;
  effects.impact(i);
  if (i.kind === 'explosive') {
    // РПГ: взрыв в точке попадания, отдельно бьём по ближайшему дому (средний уровень разрушений)
    effects.explosion(i.pos, 9);
    const v = new THREE.Vector3(...i.pos);
    let bestD = 22, best: Building | null = null;
    for (const b of buildings) {
      const d = v.distanceTo(new THREE.Vector3(b.spec.size[0] / 2, 0, 0).add(b.group.position));
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      const killed = best.blast(i.pos, 8, 950, scene, phys);
      if (killed) addFeed(`Стена выбита: ${killed} панел.`);
      if (best.structure.some(s => s.includes('ОБРУШЕНА'))) addFeed('СЕКЦИЯ ОБРУШЕНА');
    }
    aimMsg = 'ПОПАДАНИЕ РПГ'; aimT = 1.6;
    return;
  }
  // попадание по панели дома
  if (i.panel >= 0 && i.bodyId >= 0) {
    const b = panelOwner.get(String(i.bodyId));
    if (b) {
      const known = b.damagePanel(i.panel, i.damage, scene, phys, new THREE.Vector3(...i.pos));
      if (known) { lastHitMarker = performance.now(); if (i.damage > 60) addFeed(`Панель пробита (${SURFACES[i.surface].name})`); }
    }
  }
  // попадание по боту: ищем ближайшего в радиусе пули
  const bot = bots.nearest(i.pos, 0.85);
  if (bot) { const killed = bots.hit(bot, i.damage, i.pos); lastHitMarker = performance.now(); if (killed) addFeed(`${bot.side ? 'Противник' : 'Свой'} уничтожен`); }
  // подсказка о материале в прицеле
  const s = SURFACES[i.surface];
  aimMsg = `${s.name.toUpperCase()}${i.penetrated ? ' · ПРОБИТО' : ' · ЗАДЕРЖАЛА'}`; aimT = 1.4;
}

function addFeed(t: string) {
  const el = $('feed'); const d = document.createElement('div'); d.textContent = t; el.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

function buildRegistry() {
  const rows = lib.all().map(i => {
    const state = i.procedural ? 'ПРОЦЕДУРНЫЙ' : i.placeholder ? 'ЗАГЛУШКА (' + (i.placeholderSpec?.builder ?? '?') + ')' : 'МОДЕЛЬ';
    const cls = i.procedural || !i.placeholder ? 'ok' : 'ph';
    return `<tr><td>${i.id}</td><td>${i.name}</td><td>${i.category}</td><td>${i.faction}</td><td class="${cls}">${state}</td><td>${i.source ?? '—'}</td><td>${i.size ? i.size.join(' × ') + ' м' : '—'}</td><td>${i.tris ?? ''}</td><td>${i.note ?? ''}</td></tr>`;
  }).join('');
  $('reg').innerHTML = `<h2 style="margin-top:0">Реестр ассетов — <span class="ok">${lib.all().filter(i => !i.placeholder).length} моделей</span> / <span class="ph">${lib.all().filter(i => i.placeholder).length} заглушек</span> · Tab — закрыть</h2><table><tr><th>id</th><th>Название</th><th>Категория</th><th>Сторона</th><th>Состояние</th><th>Файл</th><th>Габариты</th><th>Треуг.</th><th>Примечание</th></tr>${rows}</table>`;
}
function toggleReg(force?: boolean) { const r = $('reg'); const show = force ?? r.style.display !== 'block'; r.style.display = show ? 'block' : 'none'; if (show && document.pointerLockElement) document.exitPointerLock(); }
$('regbtn').onclick = () => toggleReg(true);
$('play').onclick = () => { $('menu').style.display = 'none'; $('hud').style.display = 'block'; started = true; canvas.requestPointerLock(); };
canvas.addEventListener('click', () => { if (started && !document.pointerLockElement && $('reg').style.display !== 'block') canvas.requestPointerLock(); });
document.addEventListener('mousemove', e => {
  if (!document.pointerLockElement) return;
  // чувствительность падает при прицеливании
  const sens = 0.0022 * (aiming ? 0.45 : 1);
  yaw -= e.movementX * sens; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * sens));
});
document.addEventListener('mousedown', e => {
  if (!document.pointerLockElement) return;
  if (e.button === 0) combat?.trigger(true);
  if (e.button === 2) aiming = true;             // ПКМ — прицеливание (FOV сужается)
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) combat?.trigger(false);
  if (e.button === 2) aiming = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());
let aiming = false;
addEventListener('keydown', e => {
  if (e.code === 'Tab') { e.preventDefault(); if (started || $('menu').style.display !== 'none') toggleReg(); return; }
  if (e.repeat) return; keys.add(e.code);
  if (!started) return;
  if (e.code === 'KeyC') { toggledCrouch = !toggledCrouch; toggledProne = false; }
  if (e.code === 'KeyZ') { toggledProne = !toggledProne; toggledCrouch = false; }
  if (e.code === 'KeyR') combat?.reload();
  if (e.code === 'KeyF') throwCrate();
  if (e.code === 'KeyG') blast();
  if (e.code === 'KeyB') phys.post({ type: 'spawnPlayer', pos: SPAWN });
  // 1..4 — оружие
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 4) combat?.equip(n); }
  if (e.code === 'KeyQ' && combat) combat.equip((combat.current + 1) % combat.inventory.length);
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
  const d = lookDir(); const o = camera.position.clone(); let t = 1, hit: THREE.Vector3 | null = null;
  for (; t < 160; t += 0.5) { const p = o.clone().addScaledVector(d, t); if (p.y <= heightAt(p.x, p.z) + 0.2) { hit = p; break; } }
  hit ??= o.clone().addScaledVector(d, 40);
  phys.post({ type: 'explosion', pos: [hit.x, hit.y, hit.z], radius: 18, impulse: 900 });
  effects?.explosion([hit.x, hit.y, hit.z], 18);
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
  combat?.update(dt);
  const pl = phys.interpolate();
  if (pl && phys.player) {
    const p = phys.player; eyeY += (p.eye - eyeY) * Math.min(1, dt * 12);
    const spd = Math.hypot(p.vel[0], p.vel[2]); bob += dt * spd * 1.7; const b = p.grounded ? Math.sin(bob) * Math.min(spd, 8) * 0.0045 : 0;
    camera.position.set(pl.pos.x, pl.pos.y + eyeY + b, pl.pos.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    // прицеливание: плавно сужаем FOV, viewmodel подтягивается к центру
    const wantFov = aiming ? 45 : 75;
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix();
    if (freecam) { camera.position.set(...freecam.pos); camera.rotation.set(freecam.pitch, freecam.yaw, 0, 'YXZ'); }
    if (viewmodel) {
      const sprint = inp.sprint && spd > 6;
      const sway = aiming ? 0.25 : 1;
      const baseX = aiming ? 0 : 0.16, baseY = aiming ? -0.105 : -0.19, baseZ = aiming ? -0.3 : -0.42;
      viewmodel.position.set(baseX + Math.sin(bob * 0.5) * 0.004 * Math.min(spd, 8) * 0.4 * sway, baseY - Math.abs(Math.sin(bob)) * 0.004 * Math.min(spd, 8) * 0.4 * sway - (p.stance === 2 ? 0.05 : 0), baseZ);
      viewmodel.rotation.x += ((sprint ? -0.35 : 0) - viewmodel.rotation.x) * Math.min(1, dt * 10);
      viewmodel.rotation.y += ((sprint ? 0.5 : 0.03) - viewmodel.rotation.y) * Math.min(1, dt * 10);
      // отдача гасится
      viewmodel.position.z += (0 - viewmodel.position.z - 0) * 0; void 0;
    }
    sun.position.set(pl.pos.x + 60, 90, pl.pos.z + 40); sun.target.position.copy(pl.pos);
    $('hp').style.width = Math.max(0, p.hp) + '%'; $('hpt').textContent = 'HP ' + Math.max(0, Math.round(p.hp));
    $('stam').style.width = p.stamina + '%'; $('stance').textContent = ['Стоя', 'Присед', 'Лёжа'][p.stance] + (p.sliding ? ' · СКОЛЬЖЕНИЕ' : '') + (p.grounded ? '' : ' · в воздухе');
    const s = phys.stats;
    const w = combat?.weapon;
    $('info').textContent = `FPS ${fps.toFixed(0)}\nФизика: ${s.stepMs.toFixed(2)} мс/шаг · тел ${s.awake}/${s.total}\nСкорость: ${spd.toFixed(1)} м/с\nPos: ${p.pos.map(v => v.toFixed(1)).join(', ')}` +
      (w ? `\n${w.name}: ${w.velocity} м/с, прямой выстрел ~${pointBlankRange(w.velocity, w.bc)} м` : '');
    if (p.hp < lastHp) { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = '0.35'; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; }); }
    lastHp = p.hp;
  }
  // эффекты и трассеры
  if (effects) { effects.update(dt); effects.updateTracers(phys.tracers, camera); }
  // прицел-перекрестие: расхождение = разброс
  if (combat) {
    const spread = 8 + (combat.isReloading ? 0 : 6);
    const ch = $('crosshair'); ch.style.setProperty('--gap', `${spread}px`);
    $('ammo').textContent = combat.hud();
    $('hits').style.opacity = String(Math.max(0, 1 - (now - lastHitMarker) / 220));
  }
  if (aimT > 0) { aimT -= dt; $('aim').textContent = aimMsg; $('aim').style.opacity = String(Math.min(1, aimT * 2)); } else $('aim').style.opacity = '0';
  $('killfeed') && ($('killfeed').textContent = `В живых: ${bots?.alive() ?? 0}`);
  renderer.render(scene, camera);
}
let lastHp = 100; let freecam: { pos: [number, number, number]; yaw: number; pitch: number } | null = null;
// хуки для автотестов
(window as any).__game = {
  phys, lib, camera, scene, effects, combat, bots, buildings,
  setLook: (y: number, p: number) => { yaw = y; pitch = p; },
  start: () => { $('play').click(); },
  keys, blast, throwCrate,
  cam: (pos: [number, number, number] | null, yaw = 0, pitch = 0) => { freecam = pos ? { pos, yaw, pitch } : null; },
  /** выстрел из текущего оружия (для тестов и отладки) */
  shoot: () => combat?.trigger(true),
  aim: (v: boolean) => { aiming = v; },
};
boot().catch(e => { $('load').textContent = 'Ошибка: ' + e; console.error(e); });
