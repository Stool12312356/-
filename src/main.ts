import * as THREE from 'three';
import { AssetLibrary } from './render/assets';
import { PhysicsClient } from './physics/client';
import { buildPolygon } from './game/polygon';
import { heightAt } from './game/terrain';
import { setupEnvironment } from './render/env';
import { Effects } from './game/effects';
import { PlayerCombat } from './game/combat';
import { Scope } from './game/scope';
import { loadTextures } from './render/tex';
import { Audio, listenerPos } from './game/audio';
import { Bots } from './game/bots';
import { Match, type SoldierRef } from './game/match';
import { buildCapturePoints, spawnFor } from './game/maps';
import { Squads } from './game/squads';
import { CLASSES, CLASS_ORDER, loadout, perkOf, type ClassId } from './game/classes';
import { spawnVoxelHouse, spawnSpecial, type PlacedBuilding } from './game/structure';
import { BUILDINGS, SPAWN } from './game/world';
import { SURFACES, pointBlankRange, EXPLOSION, EXPLOSION_SMALL } from './game/weapons';
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
// Зимнее небо: холодное, светлое у горизонта. Тот же цвет в тумане — иначе дальние
// дома «вырезаны» на фоне другого оттенка.
scene.background = new THREE.Color('#cdd9e4'); scene.fog = new THREE.Fog('#cdd9e4', 120, 420);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1200); scene.add(camera);
// Снизу светит СНЕГ, а не земля: раньше нижний цвет был тёмно-коричневый, и зимой
// предметы снизу выглядели грязно-жёлтыми.
scene.add(new THREE.HemisphereLight('#dce9f7', '#b9c6d2', 1.15));
const sun = new THREE.DirectionalLight('#fff1d6', 2.4); sun.position.set(60, 90, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 300; sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
// PBR без окружения делает металл чёрным — именно из-за этого ГАЗ-66/Ми-8 были силуэтами
setupEnvironment(renderer, scene);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const lib = new AssetLibrary(); const phys = new PhysicsClient();
// yaw = 0 смотрит в −Z, а дом стоит «севернее» спавна — значит смотрим прямо на подъезд
let started = false, yaw = 0, pitch = 0;
const keys = new Set<string>(); let toggledCrouch = false, toggledProne = false;
let viewmodel: THREE.Object3D | null = null;
// Спавн и расстановка домов — в src/game/world.ts: точка появления вычисляется из плана
// первого дома (прямо перед подъездом). Раньше спавн был [0, 1, 100] — 190 м от здания.


// создаются в boot(); временно null, чтобы кадр до загрузки не падал
let effects: Effects | null = null; let combat: PlayerCombat | null = null; let bots: Bots | null = null;
/** прицельная сетка (оверлей): ПКМ → сетка на экране, модель оружия скрыта */
let scope: Scope | null = null;
const buildings: PlacedBuilding[] = [];
/** id физического тела дома → сам дом (для маршрутизации попаданий) */
const houseByBody = new Map<number, PlacedBuilding>();
let aimMsg = '', aimT = 0;
let lastHitMarker = 0;
/** Звук: создаётся на первом жесте пользователя (политика браузеров), см. audio.ts */
const audio = new Audio();
/** Режим «Штурм» (ТЗ п.7): точки захвата, билеты, время. Логика — в game/match.ts */
let match: Match | null = null;
/** выбранный класс пехоты (ТЗ п.8) — влияет на набор оружия, HP-множитель и перезарядку */
let playerClass: ClassId = 'assault';
/** управление бойцами: мозги ботов + урон (game/squads.ts) */
let squads: Squads | null = null;
/** сколько бойцов на сторону в одной волне */
const WAVE = 8;
let waveT = 0;

async function boot() {
  const load = $('load');
  await loadTextures((d, t, n) => { load.textContent = `Загрузка текстур ${d}/${t}: ${n}`; });
  await lib.init((d, t, n) => { load.textContent = `Загрузка моделей ${d}/${t}: ${n}`; });
  await phys.ready;
  buildPolygon(scene, lib, phys);
  spawnBuildings();
  const fx = effects = new Effects(scene);
  const cmb = combat = new PlayerCombat(lib, phys, fx, camera);
  scope = new Scope(document.body);
  cmb.onViewModel = (obj) => {
    if (viewmodel) viewmodel.removeFromParent();
    viewmodel = obj;
    if (viewmodel) {
      camera.add(viewmodel);
      const home = cmb.vmHome;
      viewmodel.position.set(home.x, home.y, home.z);
      viewmodel.rotation.set(0, 0.03, 0);
    }
  };
  cmb.onRecoil = (dp, dy) => { pitch = Math.max(-1.5, Math.min(1.5, pitch + dp)); yaw += dy; };
  // ЗВУК: выстрел. Тип звука зависит от ствола (винтовка/пистолет/снайперка/РПГ) —
  // раньше игра была полностью беззвучной.
  cmb.onShot = ({ weapon }) => {
    const id = weapon.id ?? '';
    const kind = id.includes('rpg') || id.includes('spg') ? 'rpg'
      : id.includes('svd') ? 'sniper'
      : id.includes('pkm') || id.includes('rpk') ? 'mg'
      : id.includes('pm') ? 'pistol' : 'rifle';
    audio.shot(kind);
  };
  // куда смотрит перекрестие — нужен физике: ствол сводится в эту точку, а не «примерно вперёд»
  cmb.aimProbe = (origin, dir) => { phys.probe([origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z], 200); return phys.rayDist; };
  cmb.equip(0);
  const bt = bots = new Bots(scene, lib, phys);
  // РЕЖИМ «ШТУРМ» (ТЗ п.7): точки захвата + волны бойцов обеих сторон.
  match = new Match(buildCapturePoints('spalny'));
  buildPointMarkers();
  spawnWave();
  squads = new Squads(bt, match, phys, fx);
  squads.onKill = (victim, killer) => {
    audio.hit('dirt', [victim.object.position.x, victim.object.position.y + 1, victim.object.position.z], listenerPos(camera));
    if (killer === 0) addFeed('Противник уничтожен');
  };
  bt.onDeath = (b) => {
    // смерть бойца = минус билет его стороне (в ТЗ билеты — это жизни).
    // ВАЖНО: Bots.hit вызывает kill() ровно один раз (dead-флаг), поэтому и билет
    // списывается один раз — двойного списания нет.
    match?.casualty(b.side ? 1 : 0);
  };
  phys.onImpact(onImpact);
  phys.post({ type: 'spawnPlayer', pos: SPAWN });
  const real = lib.all().filter(i => !i.placeholder && !i.procedural).length;
  load.innerHTML = `Готово. Реальных моделей: <b class="ok">${real}</b> · заглушек: <b class="ph">${lib.all().filter(i => i.placeholder).length}</b> · процедурных домов: <b class="ok">${buildings.length}</b>`;
  buildClassMenu();
  selectClass(playerClass);
  ($('play') as HTMLButtonElement).disabled = false; ($('regbtn') as HTMLButtonElement).disabled = false;
  buildRegistry(); requestAnimationFrame(frame);
}

/**
 * ВОЛНА БОЙЦОВ (ТЗ п.7/п.10): боты появляются у своих баз и расходятся к точкам
 * захвата. Пока это манекены с HP и рэгдоллом (полный ИИ — отдельный этап), но
 * расстановка уже «по режиму», а не в две шеренги посреди карты.
 */
function spawnWave() {
  if (!bots || !match) return;
  const my = spawnFor(0), foe = spawnFor(1);
  for (let i = 0; i < WAVE; i++) {
    const a = (i / WAVE) * Math.PI * 2;
    bots.spawn('soldier_ussr', [my[0] + Math.cos(a) * 4, 0.05, my[2] + Math.sin(a) * 4], 0, 0);
    bots.spawn('soldier_opfor', [foe[0] + Math.cos(a) * 4, 0.05, foe[2] + Math.sin(a) * 4], Math.PI, 1);
  }
  waveT = 0;
}

/** Раз в несколько секунд добиваем стороны до размера волны — «подкрепления» режима. */
function reinforcements(dt: number) {
  if (!bots || !match || match.state !== 'running') return;
  waveT += dt;
  if (waveT < 6) return;
  waveT = 0;
  const my = spawnFor(0), foe = spawnFor(1);
  while (bots.aliveBy(0) < WAVE) {
    const i = bots.aliveBy(0);
    bots.spawn('soldier_ussr', [my[0] + Math.cos(i) * 4, 0.05, my[2] + Math.sin(i) * 4], 0, 0);
  }
  while (bots.aliveBy(1) < WAVE) {
    const i = bots.aliveBy(1);
    bots.spawn('soldier_opfor', [foe[0] + Math.cos(i) * 4, 0.05, foe[2] + Math.sin(i) * 4], Math.PI, 1);
  }
}

/**
 * ВИДИМЫЕ ТОЧКИ ЗАХВАТА: кольцо на земле + столб света, цвет = владелец.
 * Без них в «Штурме» непонятно, куда идти: HUD показывает буквы, но не место.
 */
let cpMarkers: { ring: THREE.Mesh; beam: THREE.Mesh; idx: number }[] = [];
function buildPointMarkers() {
  if (!match) return;
  for (const m of cpMarkers) { m.ring.removeFromParent(); m.beam.removeFromParent(); }
  cpMarkers = [];
  match.points.forEach((p, idx) => {
    const y = heightAt(p.pos[0], p.pos[2]) + 0.06;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(p.radius - 0.35, p.radius, 40),
      new THREE.MeshBasicMaterial({ color: '#9aa4ae', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.pos[0], y, p.pos[2]);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 14, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: '#9aa4ae', transparent: true, opacity: 0.22, depthWrite: false }),
    );
    beam.position.set(p.pos[0], y + 7, p.pos[2]);
    scene.add(ring, beam);
    cpMarkers.push({ ring, beam, idx });
  });
}

/** Перекраска маркеров по владельцу (раз в 0.2 с, не каждый кадр). */
function updatePointMarkers() {
  if (!match) return;
  for (const m of cpMarkers) {
    const p = match.points[m.idx];
    const col = p.owner === 0 ? '#e8483c' : p.owner === 1 ? '#7fb1e8' : '#9aa4ae';
    for (const obj of [m.ring, m.beam]) {
      const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat.color.getHexString() !== col.slice(1)) mat.color.set(col);
    }
    // пульсация: точка, которую сейчас берут, мигает
    const pulse = p.capturing === -1 ? 1 : 0.75 + 0.25 * Math.sin(performance.now() / 140);
    ((m.ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.3 * pulse;
  }
}

/**
 * МЕНЮ ВЫБОРА КЛАССА (ТЗ п.8). Клик по карточке меняет набор оружия ДО боя,
 * поэтому можно выбрать «инженера с РПГ» или «разведчика со СВД» осмысленно.
 */
function buildClassMenu() {
  const box = $('classes');
  if (!box) return;
  box.innerHTML = '';
  for (const id of CLASS_ORDER) {
    const c = CLASSES[id];
    const el = document.createElement('div');
    el.className = 'cls' + (id === playerClass ? ' sel' : '');
    el.innerHTML = `<b>${c.name}</b>${c.role}<br><i>${c.weapons.map(w => w.id.toUpperCase()).join(' · ')}<br>${c.gadgets.map(g => g.name).join(', ')}<br>${c.perk.note}</i>`;
    el.onclick = () => { selectClass(id); buildClassMenu(); };
    box.appendChild(el);
  }
}

/** Применить класс: набор оружия, множитель перезарядки и (в бою) запас здоровья. */
function selectClass(id: ClassId) {
  playerClass = id;
  const perk = perkOf(id);
  combat?.setLoadout(loadout(id), perk.reloadMul);
  if (started && phys.player) {
    // HP класса: поддержка крепче. Считаем от текущего, чтобы не «лечить» сменой класса
    phys.post({ type: 'maxHp', hp: Math.round(100 * perk.hpMul) });
  }
  addFeed(`Класс: ${CLASSES[id].name}`);
}

/** Ставит процедурные панельки: хрущёвка и брежневка на своих местах. */
function spawnBuildings() {
  const defs: { kind: 'khrushchevka' | 'brezhnevka'; pos: [number, number, number]; rotY: number }[] = [
    { kind: 'khrushchevka', pos: [-72, 0, -86], rotY: 0 },
    { kind: 'brezhnevka', pos: [-20, 0, -105], rotY: 0 },
    { kind: 'khrushchevka', pos: [30, 0, -112], rotY: Math.PI },
  ];
  for (const d of defs) {
    const b = spawnVoxelHouse({ kind: d.kind, sections: d.kind === 'khrushchevka' ? 3 : 2 },
      scene, phys, d.pos, d.rotY, heightAt);
    buildings.push(b);
    houseByBody.set(b.house.bodyId, b);
    // пыль при разрушении — через систему эффектов (как в референсе)
    b.house.onDust = (x, y, z, count, big) => effects?.dust([x, y, z], count, big ? 3.2 : 1.2);
    // ОБЛОМКИ от мебели и ступеней (п.1): раньше разбитый стул просто исчезал.
    // Кидаем те же обломки, что летят из стен, и добавляем пыль.
    b.propBreak = (bld, type, kind, at) => {
      const wood = type === 'furniture';
      // kind → тип вокселя для цвета обломка: 4 = дерево, 5 = бетон (лестница)
      bld.house.debrisAt(at, wood ? 6 : 9, wood ? 4 : 5);
      effects?.dust(at, wood ? 3 : 5, wood ? 0.8 : 1.4);
      audio.hit(wood ? 'wood' : 'concrete', at, listenerPos(camera));
      void kind;
    };
    console.log(`дом ${d.kind}: ${b.model.size.map(v => v.toFixed(1)).join('×')} м, вокселей ${b.model.stats.voxels}, подъездов ${b.model.sections}`);
  }

  // КАЗАРМА И ВОЕНТОРГ (п.5): стоят на площадке перед домами, лицом к спавну.
  const specials: { kind: 'barracks' | 'shop'; pos: [number, number, number]; rotY: number }[] = [
    { kind: 'barracks', pos: [-58, 0, -40], rotY: 0 },
    { kind: 'shop', pos: [-34, 0, -47], rotY: Math.PI / 8 },
  ];
  for (const d of specials) {
    const b = spawnSpecial(d.kind, 2, scene, phys, d.pos, d.rotY, heightAt);
    buildings.push(b);
    houseByBody.set(b.house.bodyId, b);
    b.house.onDust = (x, y, z, count, big) => effects?.dust([x, y, z], count, big ? 3.2 : 1.2);
    b.propBreak = (bld, type, kind, at) => {
      const wood = type === 'furniture';
      bld.house.debrisAt(at, wood ? 6 : 9, wood ? 4 : 5);
      effects?.dust(at, wood ? 3 : 5, wood ? 0.8 : 1.4);
      audio.hit(wood ? 'wood' : 'concrete', at, listenerPos(camera));
      void kind;
    };
    console.log(`${d.kind}: ${b.model.size.map(v => v.toFixed(1)).join('×')} м, вокселей ${b.model.stats.voxels}`);
  }
}

/**
 * Видно ли из точки A точку B (линия огня ботов). Проверяем по вокселям домов
 * шагом 0.5 м: попадание в живой воксель = стена. Террейн ниже уровня глаз не мешает.
 */
function lineOfSight(a: [number, number, number], b: [number, number, number]): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.min(240, Math.ceil(len / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a[0] + dx * t, y = a[1] + dy * t, z = a[2] + dz * t;
    if (y < heightAt(x, z) - 0.3) continue;      // ниже земли — не препятствие (холм)
    for (const bld of buildings) {
      const h = bld.house;
      if (!h.solidAt(x, y, z)) continue;
      return false;
    }
  }
  return true;
}

function onImpact(i: Impact) {
  if (!effects || !bots) return;
  effects.impact(i);
  const lp = listenerPos(camera);
  audio.hit(i.surface, i.pos, lp);
  if (i.kind === 'explosive') {
    // РПГ: взрыв в точке попадания, отдельно бьём по ближайшему дому (средний уровень разрушений)
    effects.explosion(i.pos, EXPLOSION.blast);
    // огонь остаётся на месте взрыва несколько секунд (п.2)
    effects.fire(i.pos, 1.1);
    audio.explosion(i.pos, listenerPos(camera));
    const best = findHouseNear(i.pos, 3);
    if (best) {
      // Кратер ограничен параметрами из weapons.ts (EXPLOSION). Было r = 3.4 и max 600:
      // один выстрел выгрызал ~240 вокселей плюс запускал обрушение оторванных стен,
      // и дом складывался за пару выстрелов. Теперь — брешь 1.4 м и не больше
      // 26 вокселей: стену пробивает, дом не сносит.
      const killed = best.house.damageAt(i.pos, EXPLOSION.crater, EXPLOSION.strength, { max: EXPLOSION.craterMax });
      if (killed) addFeed(`Выбито ${killed} блоков`);
      if (best.house.collapsed.size) {
        addFeed('СЕКЦИЯ ОБРУШЕНА');
        audio.collapse(i.pos, listenerPos(camera));
      }
    }
    // Мебель и лестница тоже разрушаются: у них нет вокселей, поэтому взрыв
    // обрабатывается отдельно для каждого дома рядом (см. props.ts).
    for (const b of buildings) {
      const broken = b.propSet.blast(i.pos, EXPLOSION.crater + 1.2, EXPLOSION.strength, scene);
      if (broken) addFeed(`Разбито предметов: ${broken}`);
    }
    aimMsg = 'ПОПАДАНИЕ РПГ'; aimT = 1.6;
    return;
  }
  // попадание по стене дома: воксельный урон в радиусе удара
  if (i.bodyId >= 0) {
    // тело дома пересобирается после каждого разрушения (новый id), поэтому
    // основой служит геометрический поиск, а карта — быстрый путь
    const b = findHouseNear(i.pos) ?? houseByBody.get(i.bodyId);
    if (b) {
      // пуля выбивает воксель, если пробила материал; иначе только скол
      const dmg = i.penetrated ? 3.5 : 1.2;
      const broken = b.house.damageAt(i.pos, 0.45, dmg, { max: 3 });
      if (broken) { lastHitMarker = performance.now(); }
    }
  }
  // попадание по мебели/лестнице: у них отдельные тела физики, а предмет ищем по
  // точке попадания (тело-пачка не знает, во что именно попали).
  // ВАЖНО: проверяем, что пуля попала ИМЕННО в тело предметов, иначе выстрел в стену
  // рядом со столом «разбивал» стол.
  for (const b of buildings) {
    if (!b.propSet.ownsBody(i.bodyId)) continue;
    const target = b.propSet.nearest(i.pos, 0.6);
    if (!target) continue;
    const broken = b.propSet.damage(target, i.penetrated ? 120 : 45, scene);
    if (broken) {
      addFeed(target.type === 'stairs' ? 'Ступень разрушена' : 'Мебель разбита');
      lastHitMarker = performance.now();
      effects.dust(i.pos, 4, 0.7);
    }
    break;
  }
  // попадание по боту: ищем ближайшего в радиусе пули
  const bot = bots.nearest(i.pos, 0.85);
  if (bot) { const killed = bots.hit(bot, i.damage, i.pos); lastHitMarker = performance.now(); if (killed) addFeed(`${bot.side ? 'Противник' : 'Свой'} уничтожен`); }
  // подсказка о материале в прицеле
  const s = SURFACES[i.surface];
  aimMsg = `${s.name.toUpperCase()}${i.penetrated ? ' · ПРОБИТО' : ' · ЗАДЕРЖАЛА'}`; aimT = 1.4;
}

/** Ищет дом рядом с точкой (по габаритам, а не по центру — иначе дальняя стена не находится). */
function findHouseNear(pos: [number, number, number], extra = 4): PlacedBuilding | null {
  const v = new THREE.Vector3(...pos);
  let best: PlacedBuilding | null = null, bd = Infinity;
  for (const b of buildings) {
    const half = Math.max(b.size[0], b.size[2]) / 2 + extra;
    // все дома стоят в известных местах: расстояние до центра минус половина габарита
    const c = new THREE.Vector3(0, 0, 0);
    const dx = Math.abs(v.x - b.center.x), dz = Math.abs(v.z - b.center.z);
    const dy = Math.abs(v.y - b.center.y);
    const d = Math.max(0, Math.max(dx - b.size[0] / 2, dz - b.size[2] / 2)) + Math.max(0, dy - b.size[1] / 2);
    if (d < half && d < bd) { bd = d; best = b; }
    void c;
  }
  return best;
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
  if (e.button === 2) { aiming = true; combat?.setAiming(true); }   // ПКМ — прицеливание (FOV сужается)
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) combat?.trigger(false);
  if (e.button === 2) { aiming = false; combat?.setAiming(false); }
});
document.addEventListener('contextmenu', e => e.preventDefault());
let aiming = false;
addEventListener('keydown', e => {
  audio.unlock();
  if (e.code === 'Tab') { e.preventDefault(); if (started || $('menu').style.display !== 'none') toggleReg(); return; }
  if (e.repeat) return; keys.add(e.code);
  if (!started) return;
  if (e.code === 'KeyC') { toggledCrouch = !toggledCrouch; toggledProne = false; }
  if (e.code === 'KeyZ') { toggledProne = !toggledProne; toggledCrouch = false; }
  if (e.code === 'KeyR') { combat?.reload(); audio.reload(); }
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
  // отладочный залп (G): радиус поражения оставляем большим (это «спецэффект» для теста),
  // но кратер в доме — маленький, чтобы не сносить полкарты одним нажатием
  phys.post({ type: 'explosion', pos: [hit.x, hit.y, hit.z], radius: 18, impulse: 900 });
  effects?.explosion([hit.x, hit.y, hit.z], 18);
  const bestG = findHouseNear([hit.x, hit.y, hit.z], 3);
  if (bestG) bestG.house.damageAt([hit.x, hit.y, hit.z], EXPLOSION_SMALL.crater, EXPLOSION_SMALL.strength, { max: EXPLOSION_SMALL.craterMax });
  for (const b of buildings) b.propSet.blast([hit.x, hit.y, hit.z], 2.6, 200, scene);
}

let lastT = performance.now(), fps = 60, eyeY = 1.65, bob = 0, stepAcc = 0;
let matchEnded = false, scoreT = 0;
/** Счёт режима наверху экрана: билеты, время, точки (буквы окрашены по владельцу). */
function updateScoreHud() {
  const el = $('score');
  if (!el || !match) return;
  const own = match.points.filter(p => p.owner === 0).length;
  const foe = match.points.filter(p => p.owner === 1).length;
  const dots = match.points.map(p => {
    const col = p.owner === 0 ? '#e8483c' : p.owner === 1 ? '#7fb1e8' : '#9aa4ae';
    const cap = p.capturing === 0 ? '▸' : p.capturing === 1 ? '◂' : ' ';
    return `<span style="color:${col}">${cap}${p.name[0]}</span>`;
  }).join(' ');
  el.innerHTML = `БИЛЕТЫ ${Math.round(match.tickets[0])} : ${Math.round(match.tickets[1])} · ${match.hud()} · ТОЧКИ ${own}:${foe}<br>${dots}`;
  void scoreT;
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  const inp: PlayerInput = {
    yaw, pitch, fwd: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), right: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    jump: keys.has('Space'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), crouch: toggledCrouch || keys.has('ControlLeft'), prone: toggledProne,
  };
  if (started) phys.sendInput(inp);
  combat?.update(dt, phys.player ? Math.hypot(phys.player.vel[0], phys.player.vel[2]) : 0);
  // звук: панорама по взгляду + шаги (снег/бетон) с шагом 0.55 м
  audio.listenerYaw = yaw;
  const spd2 = phys.player ? Math.hypot(phys.player.vel[0], phys.player.vel[2]) : 0;
  if (started && spd2 > 0.6 && phys.player?.grounded) {
    stepAcc += spd2 * dt;
    if (stepAcc > (phys.player.stance === 2 ? 0.9 : 0.62)) { stepAcc = 0; audio.step('snow'); }
  } else stepAcc = 0;
  const pl = phys.interpolate();
  if (pl && phys.player) {
    const p = phys.player; eyeY += (p.eye - eyeY) * Math.min(1, dt * 12);
    const spd = Math.hypot(p.vel[0], p.vel[2]); bob += dt * spd * 1.7; const b = p.grounded ? Math.sin(bob) * Math.min(spd, 8) * 0.0045 : 0;
    camera.position.set(pl.pos.x, pl.pos.y + eyeY + b, pl.pos.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    // прицеливание: FOV и посадка вьюмодели живут в combat.ts (у каждого ствола своя оптика)
    if (combat) {
      camera.fov += (combat.fov - camera.fov) * Math.min(1, dt * 16); camera.updateProjectionMatrix();
    }
    if (freecam) { camera.position.set(...freecam.pos); camera.rotation.set(freecam.pitch, freecam.yaw, 0, 'YXZ'); }
    if (combat && scope) { combat.placeViewModel(phys.player?.stance ?? 0); combat.updateScope(scope); }
    sun.position.set(pl.pos.x + 60, 90, pl.pos.z + 40); sun.target.position.copy(pl.pos);
    $('hp').style.width = Math.max(0, p.hp) + '%'; $('hpt').textContent = 'HP ' + Math.max(0, Math.round(p.hp));
    $('stam').style.width = p.stamina + '%';
    if ($('stance')) $('stance').title = CLASSES[playerClass].name; $('stance').textContent = ['Стоя', 'Присед', 'Лёжа'][p.stance] + (p.sliding ? ' · СПОЛЗАНИЕ' : '') + (p.grounded ? '' : ' · в воздухе') + (p.slope ? ` · склон ${p.slope.toFixed(0)}°` : '');
    const s = phys.stats;
    const w = combat?.weapon;
    $('info').textContent = `FPS ${fps.toFixed(0)}\nФизика: ${s.stepMs.toFixed(2)} мс/шаг · тел ${s.awake}/${s.total}\nСкорость: ${spd.toFixed(1)} м/с\nPos: ${p.pos.map(v => v.toFixed(1)).join(', ')}` +
      (w ? `\n${w.name}: ${w.velocity} м/с, прямой выстрел ~${pointBlankRange(w.velocity, w.bc)} м` : '');
    if (p.hp < lastHp) { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = '0.35'; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; }); }
    lastHp = p.hp;
  }
  // разрушаемые дома: пересборка коллайдеров/рендера не чаще 10 раз в секунду
  for (const b of buildings) { b.house.update(dt, now); houseByBody.set(b.house.bodyId, b); }
  // эффекты и трассеры
  if (effects) { effects.update(dt); effects.updateTracers(phys.tracers, camera); }
  // РЕЖИМ «ШТУРМ»: тик точек захвата и билетов. Игрок — такой же боец в списке,
  // иначе «своя» сторона не может захватывать точки одна.
  if (match && bots) {
    reinforcements(dt);
    const refs: SoldierRef[] = bots.refs();
    if (phys.player) {
      const pp = phys.player.pos;
      const pOnPoint = !!match.pointAt(pp);
      refs.push({ side: 0, alive: phys.player.hp > 0, pos: [pp[0], pp[1], pp[2]], holding: pOnPoint && spd2 < 1.2 });
    }
    for (const msg of match.update(dt, refs)) addFeed(msg);
    // БОЙ: боты ходят к точкам, видят цель через свободную линию огня и стреляют.
    // Урон по игроку идёт в физику (то же тело, что получает урон от взрывов).
    if (squads && phys.player) {
      const pp = phys.player.pos;
      squads.update(dt, lineOfSight, [pp[0], pp[1], pp[2]], phys.player.hp > 0,
        [camera.position.x, camera.position.y, camera.position.z]);
      let dmg = 0;
      for (const h of squads.hits) if (h.target === 'player') dmg += h.damage;
      if (dmg > 0) {
        phys.post({ type: 'hurt', damage: dmg });
        audio.hit('dirt', [pp[0], pp[1] + 1.2, pp[2]], listenerPos(camera));
      }
      // звук выстрелов ботов: слышно по расстоянию, панорама от слушателя
      for (const sh of squads.shots) audio.shot('rifle', sh.pos, listenerPos(camera));
    }
    updateScoreHud();
    updatePointMarkers();
    if (match.state !== 'running' && !matchEnded) {
      matchEnded = true;
      addFeed(match.state === 'win' ? `ПОБЕДА: ${match.reason}` : match.state === 'lose' ? `ПОРАЖЕНИЕ: ${match.reason}` : `НИЧЬЯ: ${match.reason}`);
    }
  }
  // прицел-перекрестие: расхождение = разброс
  if (combat) {
    const spread = 8 + (combat.isReloading ? 0 : 6);
    const ch = $('crosshair'); ch.style.setProperty('--gap', `${spread}px`);
    $('ammo').textContent = combat.hud();
    $('hits').style.opacity = String(Math.max(0, 1 - (now - lastHitMarker) / 220));
  }
  if (aimT > 0) { aimT -= dt; $('aim').textContent = aimMsg; $('aim').style.opacity = String(Math.min(1, aimT * 2)); } else $('aim').style.opacity = '0';
  if ($('killfeed')) $('killfeed').textContent = `В живых: ${bots?.alive() ?? 0}`;
  // состояние ближайшего дома: сколько колонн осталось (играбельно и понятно)
  if (buildings.length) {
    let best: PlacedBuilding | null = null, bd = Infinity;
    const cp = camera.position;
    for (const b of buildings) {
      const dx = Math.abs(cp.x - b.center.x) - b.size[0] / 2;
      const dz = Math.abs(cp.z - b.center.z) - b.size[2] / 2;
      const d = Math.max(0, dx) + Math.max(0, dz);
      if (d < bd) { bd = d; best = b; }
    }
    if (best && bd < 60) {
      const parts = Array.from({ length: best!.model.sections }, (_, i) => i).map(i => {
        const c = best!.house.columns(i);
        const pct = Math.round((c.left / Math.max(1, c.total)) * 100);
        return `${pct}%${best!.house.collapsed.has(i) ? ' ОБРУШЕН' : ''}`;
      });
      $('house').textContent = `ДОМ: целостность ${parts.join(' · ')}`;
      $('house').style.opacity = '1';
    } else if ($('house')) $('house').style.opacity = '0';
  }
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
