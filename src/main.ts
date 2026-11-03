import * as THREE from 'three';
import { AssetLibrary } from './render/assets';
import { PhysicsClient } from './physics/client';
import { buildPolygon } from './game/polygon';
import { buildGround } from './game/ground';
import { isTraining } from './game/maps';
import { heightAt } from './game/terrain';
import { setupEnvironment } from './render/env';
import { Effects } from './game/effects';
import { PlayerCombat } from './game/combat';
import { Scope } from './game/scope';
import { loadTextures } from './render/tex';
import { Audio, listenerPos } from './game/audio';
import { Bots } from './game/bots';
import { Match, type SoldierRef } from './game/match';
import { buildCapturePoints, spawnFor, MAPS } from './game/maps';
import { Squads } from './game/squads';
import { CLASSES, CLASS_ORDER, loadout, perkOf, type ClassId } from './game/classes';
import { Gadgets, gadgetForKey, type GadgetId } from './game/gadgets';
import { spawnVoxelHouse, spawnSpecial, type PlacedBuilding } from './game/structure';
import { BUILDINGS, SPAWN, CURRENT_MAP } from './game/world';
import { SURFACES, pointBlankRange, EXPLOSION, EXPLOSION_SMALL } from './game/weapons';
import { VEHICLE_SPAWNS, BOAT_SPAWNS, vehicleById } from './game/vehicles';
import { spawnDressing } from './game/dressing';
import { Weather } from './game/weather';
import { WaterSurface } from './game/water';
import { spawnStreets } from './game/streets';
import type { PlayerInput, Impact } from './shared/types';

const $ = (id: string) => document.getElementById(id)!;
/** Текущая карта — полигон/стрельбище? Тогда нет боя, техники и выставки на картах. */
const TRAINING = isTraining(CURRENT_MAP.id);
/** Исходная строка подсказок: её возвращаем после временных сообщений (погода и т.п.). */
const HINT_DEFAULT = document.getElementById('hint')?.textContent ?? '';
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
const hemi = new THREE.HemisphereLight('#dce9f7', '#b9c6d2', 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.4); sun.position.set(60, 90, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 300; sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
// PBR без окружения делает металл чёрным — именно из-за этого ГАЗ-66/Ми-8 были силуэтами
setupEnvironment(renderer, scene);
// ПОГОДА (ТЗ п.9): снегопад, метель, туман, ночь. Снег — одна геометрия с движением
// в шейдере, поэтому 6000 снежинок не стоят ничего в JS. Клавиша N переключает по кругу,
// в консоли — `__game.weather.set('storm')`.
const weather = new Weather(scene, renderer, sun, hemi);
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
/** названия гаджетов для фида */
const GADGET_NAME: Record<GadgetId, string> = {
  medkit: 'аптечка', wrench: 'ремключ', ammo: 'ящик патронов',
  drone: 'дрон-разведчик', grenade: 'граната', mine: 'мина', c4: 'С4',
};
/** выбранный класс пехоты (ТЗ п.8) — влияет на набор оружия, HP-множитель и перезарядку */
let playerClass: ClassId = 'assault';
/** гаджеты класса: аптечка, ящик патронов, С4/мина/граната, дрон (ТЗ п.8) */
let gadgets: Gadgets | null = null;
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
  // Диагностика «чёрных моделей»: если у материалов нет карты цвета, GLTFLoader
  // не декодировал текстуру (частая причина — формат webp в нестандартной упаковке).
  const ts = lib.textureStats;
  if (ts.meshes) {
    const pct = Math.round((ts.withMap / ts.meshes) * 100);
    console.log(`текстуры: ${ts.withMap}/${ts.meshes} мешей с картой цвета (${pct}%)`);
    if (pct < 80) console.warn('много моделей без карты цвета — возможны чёрные силуэты');
  }
  // ВЫСТАВКА АССЕТОВ — ТОЛЬКО ПОЛИГОН.
  // Раньше `buildPolygon()` вызывался на любой карте, и на спальном районе/заводе
  // стояли ряды техники, стол с оружием, рампы и башня — то есть на игровой карте
  // торчал музей. Пользователь: «убери технику и стенды с предметами из спального
  // района и если также на заводском тоже оттуда убери — это уже играбельные карты.
  // И добавь отдельную карту полигона». Теперь выставка живёт только здесь.
  // размер мира — из карты (ТЗ п.9: 400 м у города/завода, 800 м у «Пригорода»)
  const WORLD = CURRENT_MAP.size ?? 400;
  if (TRAINING) buildPolygon(scene, lib, phys, WORLD);
  else buildGround(scene, phys, WORLD, CURRENT_MAP.water);
  // УЛИЦЫ И ДВОР (по плану квартала): асфальт, бордюры, проезды, деревья, площадка,
  // гаражи, машины, забор. Раньше на их месте был чистый снег — район читался как
  // «дома в поле» (видно на скриншотах пользователя).
  if (CURRENT_MAP.streets?.length) {
    const st = spawnStreets(scene, phys, CURRENT_MAP.streets);
    console.log(`улицы: ${st.count}`);
  }
  // ВОДА (ТЗ п.4.5): река на «Пригороде». Визуал — плоскость с волнами Герстнера в
  // шейдере, физика — сообщением в воркер (плавучесть, кислород, течение).
  if (CURRENT_MAP.water) {
    waterSurface = new WaterSurface(scene, CURRENT_MAP.water);
    phys.setWater(CURRENT_MAP.water);
    console.log(`вода: ${CURRENT_MAP.water.x1 - CURRENT_MAP.water.x0} × ${CURRENT_MAP.water.z1 - CURRENT_MAP.water.z0} м, уровень ${CURRENT_MAP.water.level}`);
  }
  if (CURRENT_MAP.dressing?.length) {
    const dr = spawnDressing(scene, phys, CURRENT_MAP.dressing as never[]);
    console.log(`двор: ${dr.count} предметов`);
  }
  // мишени стрельбища (только полигон): данными, не хардкодом — см. maps.ts
  if (TRAINING) spawnTargets();
  spawnBuildings();
  const fx = effects = new Effects(scene);
  const cmb = combat = new PlayerCombat(lib, phys, fx, camera);
  scope = new Scope(document.body);
  // ГАДЖЕТЫ (ТЗ п.8): лечение/патроны/взрыв/дрон. Эффекты — настоящие: HP через физику,
  // взрыв через тот же blast-код, что и у РПГ.
  gadgets = new Gadgets({
    heal: (hp) => phys.post({ type: 'heal', hp }),
    resupply: (mags) => combat?.resupply(mags),
    explode: (p, radius, power) => {
      phys.post({ type: 'explosion', pos: p, radius, impulse: power === 'big' ? 700 : 380 });
      effects?.explosion(p, radius);
      effects?.fire(p, power === 'big' ? 1.2 : 0.8);
      audio.explosion(p, listenerPos(camera));
      const b = findHouseNear(p, 2);
      if (b) b.house.damageAt(p, power === 'big' ? EXPLOSION.crater : EXPLOSION_SMALL.crater,
        power === 'big' ? EXPLOSION.strength : EXPLOSION_SMALL.strength,
        { max: power === 'big' ? EXPLOSION.craterMax : EXPLOSION_SMALL.craterMax });
      for (const bld of buildings) bld.propSet.blast(p, 2.4, power === 'big' ? 260 : 140, scene);
    },
    origin: () => [camera.position.x, camera.position.y, camera.position.z],
    aim: () => { const d = lookDir(); return [d.x, d.y, d.z]; },
  }, effects, phys);
  gadgets.onUse = (id, ok, why) => addFeed(ok ? `Применено: ${GADGET_NAME[id]}` : `${GADGET_NAME[id]}: ${why}`);
  gadgets.setFrom(CLASSES[playerClass].gadgets);
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
  match = new Match(buildCapturePoints(CURRENT_MAP.id));
  buildPointMarkers();
  // БОЙ только на боевых картах. На полигоне нет ни волн, ни техники, ни билетов:
  // это стрельбище, а не режим «Штурм».
  if (!TRAINING) { spawnWave(); spawnVehicles(); }
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
  phys.onVehicleSunk = (id, passengerLost) => {
    if (passengerLost && drivingId === id) {
      drivingId = null;
      $('veh').textContent = '';
      addFeed('Танк затонул: вы не успели эвакуироваться');
    }
  };
  phys.post({ type: 'spawnPlayer', pos: CURRENT_MAP.playerSpawn ?? SPAWN });
  const real = lib.all().filter(i => !i.placeholder && !i.procedural).length;
  load.innerHTML = `Готово. Реальных моделей: <b class="ok">${real}</b> · заглушек: <b class="ph">${lib.all().filter(i => i.placeholder).length}</b> · процедурных домов: <b class="ok">${buildings.length}</b>`;
  buildMapMenu();
  buildClassMenu();
  selectClass(playerClass);
  ($('play') as HTMLButtonElement).disabled = false; ($('regbtn') as HTMLButtonElement).disabled = false;
  buildRegistry(); requestAnimationFrame(frame);
}

/**
 * ТЕХНИКА НА КАРТЕ (ТЗ п.4.3). Машины ставятся у баз сторон; игрок подходит и садится
 * (E), едет (W/S — газ, A/D — руль, Space — ручник), выходит (E).
 * Модель берётся из манифеста; если её нет — машина всё равно существует физически,
 * но показывается процедурная заглушка, а не чужая модель (правило проекта).
 */
const vehicleObjs = new Map<number, { obj: THREE.Object3D; specId: string; pos: [number, number, number]; yaw: number }>();
function spawnVehicles() {
  // ВАЖНО: fallback на spalny убран. Иначе карта без техники (полигон) получала бы
  // машины спального района — «техника из другой карты» на стрельбище.
  const list = [...(VEHICLE_SPAWNS[CURRENT_MAP.id] ?? []), ...(BOAT_SPAWNS[CURRENT_MAP.id] ?? [])];
  if (!list.length) return;
  for (const vs of list) {
    const spec = vehicleById(vs.id);
    // объект: настоящая модель или её процедурная заглушка (чужую не подставляем)
    const inst = lib.has(spec.model) ? lib.make(spec.model) : null;
    // Центр коллайдера лодки находится посередине корпуса, а модель нормализована
    // от дна. Сдвигаем только вложенный объект, не меняя позицию физического тела.
    let obj = inst?.object ?? makeVehiclePlaceholder(spec);
    if (spec.drive === 'boat') {
      const wrapper = new THREE.Group();
      obj.position.y = -spec.size[1] / 2;
      wrapper.add(obj); obj = wrapper;
    }
    obj.position.set(vs.pos[0], vs.pos[1], vs.pos[2]);
    obj.rotation.y = vs.yaw;
    scene.add(obj);
    const id = phys.addVehicle({
      specId: spec.id, pos: vs.pos, yaw: vs.yaw, mass: spec.mass, size: spec.size,
      wheels: spec.wheels, drive: spec.drive, power: spec.power, maxSpeed: spec.maxSpeed,
      steerMax: spec.steerMax, pivotRate: spec.pivotRate,
    });
    vehicleObjs.set(id, { obj, specId: spec.id, pos: vs.pos, yaw: vs.yaw });
  }
  addFeed(`Техника: ${list.length} единиц — подойди и нажми E`);
}

/**
 * МИШЕНИ СТРЕЛЬБИЩА (только полигон). Данные — `map.targets`, поэтому расстановку
 * можно править в maps.ts, а не в коде. Мишени статичные (не падают от пули — иначе
 * после первого Magazine стрелять было бы некуда), но их можно снести взрывом.
 */
function spawnTargets() {
  const list = CURRENT_MAP.targets ?? [];
  for (const t of list) {
    const inst = lib.has(t.kind) ? lib.make(t.kind) : null;
    if (inst) {
      inst.object.position.set(t.pos[0], t.pos[1] + 0.05, t.pos[2]);
      inst.object.rotation.y = t.rotY ?? 0;
      scene.add(inst.object);
      // щит под мишенью: видно, что это стенд, а не живой боец
      const shield = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.12, 0.6),
        new THREE.MeshStandardMaterial({ color: '#8a7040', roughness: 0.9 }),
      );
      shield.position.set(t.pos[0], t.pos[1] + 0.06, t.pos[2]);
      shield.receiveShadow = true;
      scene.add(shield);
    } else {
      // нет модели — не подменяем чужой: обычный ящик-мишень
      const box = lib.make('crate');
      box.object.position.set(t.pos[0], t.pos[1] + 0.3, t.pos[2]);
      scene.add(box.object);
    }
  }
  addFeed(`Полигон: мишеней ${list.length} · дистанции 25/50/100/200 м`);
}

/** Простая коробка-заглушка по габаритам и колёсам: видно, где машина и куда она смотрит. */
function makeVehiclePlaceholder(spec: { size: [number, number, number]; wheels: { pos: [number, number, number]; radius: number }[] }): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(spec.size[0], spec.size[1] * 0.6, spec.size[2]),
    new THREE.MeshStandardMaterial({ color: 0x4a5540, roughness: 0.85, metalness: 0.1 }));
  body.position.y = spec.size[1] * 0.55;
  g.add(body);
  const wmat = new THREE.MeshStandardMaterial({ color: 0x181a18, roughness: 0.95 });
  for (const w of spec.wheels) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, 0.3, 10), wmat);
    m.rotation.z = Math.PI / 2;
    m.position.set(w.pos[0], w.pos[1], w.pos[2]);
    g.add(m);
  }
  // «нос» — светлая полоса спереди, чтобы понять направление
  const nose = new THREE.Mesh(new THREE.BoxGeometry(spec.size[0] * 0.8, 0.15, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c0 }));
  nose.position.set(0, spec.size[1] * 0.7, spec.size[2] / 2);
  g.add(nose);
  return g;
}

/** Ближайшая машина в радиусе (для подсказки «E — сесть»). */
function nearestVehicle(maxDist = 3.2): number | null {
  const p = phys.player?.pos; if (!p) return null;
  let best: number | null = null, bd = maxDist;
  for (const [id, v] of vehicleObjs) {
    if (phys.vehicles.get(id)?.sunk) continue;
    const d = Math.hypot(p[0] - v.pos[0], p[1] - v.pos[1], p[2] - v.pos[2]);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/** В машине ли игрок (id) и какую машину ведём. */
let drivingId: number | null = null;
/** Вода карты (ТЗ п.4.5): визуал волн; null, если на карте её нет. */
let waterSurface: WaterSurface | null = null;
function toggleVehicle() {
  if (drivingId != null) {
    // выйти: рядом с машиной, чтобы не оказаться внутри корпуса
    const v = phys.vehicles.get(drivingId);
    if (v) phys.post({ type: 'spawnPlayer', pos: [v.pos[0] + Math.cos(v.yaw) * 3, v.pos[1] + 0.4, v.pos[2] - Math.sin(v.yaw) * 3], preserve: true });
    phys.enterVehicle(-1);
    addFeed(`Вышел из машины: ${vehicleById(vehicleObjs.get(drivingId)?.specId ?? 'uaz469').name}`);
    drivingId = null;
    return;
  }
  const id = nearestVehicle();
  if (id == null) { addFeed('Рядом нет техники (подойди ближе 3 м)'); return; }
  drivingId = id;
  phys.enterVehicle(id);
  addFeed(`Сел в ${vehicleById(vehicleObjs.get(id)?.specId ?? 'uaz469').name}: W/S — газ, A/D — руль, E — выйти`);
}

/**
 * ВОЛНА БОЙЦОВ (ТЗ п.7/п.10): боты появляются у своих баз и расходятся к точкам
 * захвата. Пока это манекены с HP и рэгдоллом (полный ИИ — отдельный этап), но
 * расстановка уже «по режиму», а не в две шеренги посреди карты.
 */
function spawnWave() {
  if (TRAINING) return;   // на полигоне бойцов-противников не выставляем
  if (!bots || !match) return;
  const my = spawnFor(0, CURRENT_MAP.id), foe = spawnFor(1, CURRENT_MAP.id);
  for (let i = 0; i < WAVE; i++) {
    const a = (i / WAVE) * Math.PI * 2;
    bots.spawn('soldier_ussr', [my[0] + Math.cos(a) * 4, 0.05, my[2] + Math.sin(a) * 4], 0, 0);
    bots.spawn('soldier_opfor', [foe[0] + Math.cos(a) * 4, 0.05, foe[2] + Math.sin(a) * 4], Math.PI, 1);
  }
  waveT = 0;
}

/** Раз в несколько секунд добиваем стороны до размера волны — «подкрепления» режима. */
function reinforcements(dt: number) {
  if (TRAINING) return;
  if (!bots || !match || match.state !== 'running') return;
  waveT += dt;
  if (waveT < 6) return;
  waveT = 0;
  const my = spawnFor(0, CURRENT_MAP.id), foe = spawnFor(1, CURRENT_MAP.id);
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
  gadgets?.setFrom(CLASSES[id].gadgets);
  if (started && phys.player) {
    // HP класса: поддержка крепче. Считаем от текущего, чтобы не «лечить» сменой класса
    phys.post({ type: 'maxHp', hp: Math.round(100 * perk.hpMul) });
  }
  addFeed(`Класс: ${CLASSES[id].name}`);
}

/**
 * МЕНЮ КАРТ (ТЗ п.9). Карта задаётся параметром ?map= и собирается при загрузке,
 * поэтому переключение — перезагрузка страницы: иначе надо сносить всю физику,
 * ботов и дома, а это на 40k вокселей дороже секунды загрузки.
 * Пока идёт матч, кнопки неактивны — чтобы не потерять прогресс случайно.
 */
function buildMapMenu() {
  const box = $('maps');
  if (!box) return;
  box.innerHTML = '';
  for (const m of MAPS) {
    const el = document.createElement('div');
    el.className = 'map' + (m.id === CURRENT_MAP.id ? ' sel' : '');
    // на полигоне нет «точек захвата» — писать «точек: 5» было бы враньём
    const info = m.mode === 'training'
      ? `мишеней: ${m.targets?.length ?? 0} · секторов: ${m.points.length}`
      : `точек: ${m.points.length} · домов: ${m.houses.length + m.specials.length}`;
    el.innerHTML = `<b>${m.name}</b><i>${m.subtitle}</i><br><i>${info}</i>`;
    el.onclick = () => {
      if (started) { addFeed('Карта меняется до боя'); return; }
      const u = new URL(location.href);
      u.searchParams.set('map', m.id);
      location.href = u.toString();
    };
    box.appendChild(el);
  }
}

/** Ставит процедурные панельки: хрущёвка и брежневка на своих местах. */
function spawnBuildings() {
  // Расстановка — ИЗ КАРТЫ (maps.ts): у каждой карты свои дома и особые здания.
  for (const d of CURRENT_MAP.houses) {
    const b = spawnVoxelHouse({ kind: d.kind, sections: d.sections },
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

  // ОСОБЫЕ ЗДАНИЯ КАРТЫ: казарма, военторг, цеха, проходная.
  for (const d of CURRENT_MAP.specials) {
    const b = spawnSpecial(d.kind, d.sections, scene, phys, d.pos, d.rotY, heightAt);
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
// На полигоне кнопка называется по-другому: «В БОЙ» на стрельбище — враньё.
if (TRAINING) { const b = $('play'); if (b) b.textContent = 'НА СТРЕЛЬБИЩЕ'; }
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
  // ГАДЖЕТЫ класса (ТЗ п.8): H — аптечка/ремключ, J — боеприпасы, K — С4/мина/граната,
  // L — дрон. Клавиша работает только если гаджет есть у выбранного класса.
  if (gadgets && ['KeyH', 'KeyJ', 'KeyK', 'KeyL'].includes(e.code) && started) {
    const g = gadgetForKey(gadgets.list, e.code);
    if (g) { e.preventDefault(); gadgets.use(g); }
  }
  // N — следующая погода (ТЗ п.9: снегопад, туман, ночь). Подпись — в строку подсказок,
  // отдельного тоста в HUD нет, а лезть в вёрстку ради одного сообщения не нужно.
  if (e.code === 'KeyN') {
    const label = weather.next();
    const hint = document.getElementById('hint');
    if (hint) { hint.textContent = `Погода: ${label}`; setTimeout(() => hint.textContent = HINT_DEFAULT, 2500); }
    return;
  }
  if (e.code === 'KeyE') { toggleVehicle(); return; }
  if (e.code === 'KeyF') throwCrate();
  if (e.code === 'KeyG') blast();
  if (e.code === 'KeyB') phys.post({ type: 'spawnPlayer', pos: CURRENT_MAP.playerSpawn ?? SPAWN });
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
  // ПОЛИГОН: боя нет, поэтому билеты и точки не показываем. Вместо них — дистанция
  // до ближайшей мишени: на стрельбище это и есть «счёт».
  if (TRAINING) {
    const c = camera.position;
    let best = Infinity, bestName = '—';
    for (const t of CURRENT_MAP.targets ?? []) {
      const d = Math.hypot(t.pos[0] - c.x, t.pos[2] - c.z);
      if (d < best) { best = d; bestName = `${Math.round(d)} м`; }
    }
    el.innerHTML = `ПОЛИГОН · мишеней ${CURRENT_MAP.targets?.length ?? 0} · ближайшая ${bestName}<br>`
      + `дистанции: 25 / 50 / 100 / 200 м · N — погода`;
    return;
  }
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
    jump: keys.has('Space'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), crouch: toggledCrouch || keys.has('ControlLeft') || keys.has('ControlRight'), prone: toggledProne,
    dive: keys.has('ControlLeft') || keys.has('ControlRight'),
  };
  if (started) {
    // За рулём пехотинцу управление не шлём: иначе игрок «выходит» из машины своим ходом
    if (drivingId == null) phys.sendInput(inp);
    else {
      const th = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const st = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
      phys.drive(drivingId, th, st, keys.has('Space'));
    }
  }
  // машины: позы приходят из воркера (ходовая считается там)
  for (const [id, v] of vehicleObjs) {
    const s2 = phys.vehicles.get(id);
    if (!s2) continue;
    v.pos = s2.pos; v.yaw = s2.yaw;
    v.obj.position.set(s2.pos[0], s2.pos[1], s2.pos[2]);
    v.obj.rotation.set(s2.pitch, s2.yaw, s2.roll, 'YXZ');
  }
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
    if (drivingId != null) {
      const v = phys.vehicles.get(drivingId);
      if (v) {
        const nm = vehicleById(vehicleObjs.get(drivingId)?.specId ?? 'uaz469').name;
        const isBoat = vehicleById(vehicleObjs.get(drivingId)?.specId ?? 'uaz469').drive === 'boat';
        $('veh').textContent = v.sinkRemaining != null
          ? `ТАНК ТОНЕТ: ${Math.ceil(v.sinkRemaining)} с · E — выйти`
          : isBoat ? `${nm}: ${v.speed.toFixed(0)} км/ч · E — выйти` : 'E — выйти';
        $('info').textContent = `${nm}: ${v.speed.toFixed(0)} км/ч${v.slip ? ' · БУКСУЕТ' : ''}` +
          (v.damaged.track ? ' · ГУСЕНИЦА' : '') + (v.damaged.engine ? ' · ДВИГАТЕЛЬ' : '') + '\nE — выйти';
      }
    } else if (nearestVehicle() != null) {
      $('veh') && ($('veh').textContent = 'E — сесть в машину');
    } else if ($('veh')) $('veh').textContent = '';
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
    // НА ПОЛИГОНЕ МАТЧ НЕ ИДЁТ: без этого «мир» на стрельбище заканчивался ничьей
    // через 15 минут, а билеты капали в HUD, которого там нет.
    if (!TRAINING) for (const msg of match.update(dt, refs)) addFeed(msg);
    // БОЙ: боты ходят к точкам, видят цель через свободную линию огня и стреляют.
    // Урон по игроку идёт в физику (то же тело, что получает урон от взрывов).
    if (squads && phys.player) {
      const pp = phys.player.pos;
      squads.playerMaxHp = Math.round(100 * perkOf(playerClass).hpMul);
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
    if (!TRAINING && match.state !== 'running' && !matchEnded) {
      matchEnded = true;
      addFeed(match.state === 'win' ? `ПОБЕДА: ${match.reason}` : match.state === 'lose' ? `ПОРАЖЕНИЕ: ${match.reason}` : `НИЧЬЯ: ${match.reason}`);
    }
  }
  // прицел-перекрестие: расхождение = разброс
  if (combat) {
    const spread = 8 + (combat.isReloading ? 0 : 6);
    const ch = $('crosshair'); ch.style.setProperty('--gap', `${spread}px`);
    $('ammo').textContent = combat.hud() + (gadgets ? `   ${gadgets.hud()}` : '');
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
  // Погода живёт до старта матча: снег идёт и в меню, иначе первый кадр после
  // «Играть» показывал бы пустое небо без частиц.
  weather.update(dt, camera);
  waterSurface?.setTime(phys.waterTime);
  // HUD: кислород под водой (ТЗ п.4.5) и предупреждение «тонешь»
  if (waterSurface && phys.player) {
    const o2 = phys.player.oxygen ?? 0;
    const el = $('veh');
    const inVeh = drivingId !== null;
    if (phys.player.submerged && el && !inVeh) el.textContent = `КИСЛОРОД ${Math.ceil(o2)} с · Space — вверх`;
    else if (phys.player.swimming && el && !inVeh) el.textContent = 'ВПЛАВЬ · Ctrl — нырнуть · Space — вверх';
  }
  // тень солнца должна ездить за игроком, иначе в 200 м от центра она обрезается
  sun.position.set(camera.position.x + 60, 90, camera.position.z + 40);
  sun.target.position.set(camera.position.x, 0, camera.position.z);
  sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
}
let lastHp = 100; let freecam: { pos: [number, number, number]; yaw: number; pitch: number } | null = null;
// хуки для автотестов
(window as any).__game = {
  phys, lib, camera, scene, effects, combat, bots, buildings,
  setLook: (y: number, p: number) => { yaw = y; pitch = p; },
  start: () => { $('play').click(); },
  keys, blast, throwCrate, weather,
  setWeather: (p: string) => weather.apply(p as never),
  cam: (pos: [number, number, number] | null, yaw = 0, pitch = 0) => { freecam = pos ? { pos, yaw, pitch } : null; },
  /** выстрел из текущего оружия (для тестов и отладки) */
  shoot: () => combat?.trigger(true),
  aim: (v: boolean) => { aiming = v; },
};
boot().catch(e => { $('load').textContent = 'Ошибка: ' + e; console.error(e); });
