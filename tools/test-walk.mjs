// «ПОБЕГАТЬ ВНУТРИ ДОМА» — тест проходимости настоящей физикой (M7).
//
// Почему такой тест: раньше проверялось, что «в стене есть проём», и всё было зелено,
// а в игре зайти было нельзя. Причина — проём шириной 2.4 м, но капсула 0.6 м, ступень
// 0.5 м при шаге 0.4 м и перила поперёк прохода. Здесь строится тот же тримеш, что уходит
// в физику в игре, ставится капсула с теми же параметрами, что в src/physics/worker.ts,
// и бот реально идёт: улица → дверь → клетка → лестница → этаж → прихожая → все комнаты
// → обратно на улицу.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildStaircase, landingFloor } from '../src/game/staircase.ts';
import { PITCH, VOXEL_FACES, VOXEL_QUADS } from '../src/game/voxelhouse.ts';
import { makeSolid, findPath, bfsReach, walkableAt } from '../src/game/nav.ts';
import { PLAYER } from '../src/shared/constants.ts';
import { spawnVoxelHouse } from '../src/game/structure.ts';
import { BUILDINGS, SPAWN, spawnPoint } from '../src/game/world.ts';
import { heightAt } from '../src/game/terrain.ts';

await RAPIER.init();

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
const H = PITCH / 2;

/** Наружные грани живых вокселей — ровно то, что уходит в физику в игре. */
function meshOf(model) {
  const { nx, ny, nz, cells } = model.spec;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];
  const verts = [], idx = [];
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (at(i, j, k) < 0) continue;
    const cx = (i + 0.5) * PITCH, cy = (j + 0.5) * PITCH, cz = (k + 0.5) * PITCH;
    for (let f = 0; f < 6; f++) {
      const [di, dj, dk] = VOXEL_FACES[f];
      if (at(i + di, j + dj, k + dk) >= 0) continue;
      const start = verts.length / 3;
      for (const ci of VOXEL_QUADS[f]) {
        const c = CORNERS[ci];
        verts.push(cx + c[0] * H, cy + c[1] * H, cz + c[2] * H);
      }
      idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
}

function makeWorld(model, stair) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  // земля вокруг дома (дом стоит на уровне y = 0)
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200), ground);
  const m = meshOf(model);
  const off = m.verts.length / 3;
  const verts = new Float32Array(m.verts.length + stair.verts.length);
  verts.set(m.verts); verts.set(stair.verts, m.verts.length);
  const idx = [...m.idx, ...stair.idx.map(v => v + off)];
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idx)), b);
  world.step();
  return { world, tris: idx.length / 3 };
}

/** Те же параметры, что в src/physics/worker.ts */
function makePlayer(world, pos) {
  const R = 0.3, HH = PLAYER.heightStand;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1] + HH / 2, pos[2]));
  const col = world.createCollider(RAPIER.ColliderDesc.capsule((HH - 2 * R) / 2, R).setFriction(0), body);
  const cc = world.createCharacterController(0.02);
  cc.enableAutostep(PLAYER.stepHeight, 0.2, false);
  cc.enableSnapToGround(0.35);
  cc.setMaxSlopeClimbAngle((PLAYER.slopeMax * Math.PI) / 180);
  cc.setMinSlopeSlideAngle((PLAYER.slopeMax * Math.PI) / 180);
  cc.setUp({ x: 0, y: 1, z: 0 });
  return { body, col, cc, R, HH, vy: 0, grounded: false };
}

const feet = (p) => { const t = p.body.translation(); return [t.x, t.y - p.HH / 2, t.z]; };
/** уровень пола: капсула может «просесть» на пару сантиметров — округляем к сетке 0.5 м */
const lvl = (y) => Math.round(y / PITCH) * PITCH;

const DT = 1 / 60;
/**
 * Один кадр движения — ровно как stepPlayer() в src/physics/worker.ts:
 * вертикальная скорость копится гравитацией и обнуляется на земле (иначе, если каждый
 * кадр «давить» вниз фиксированным шагом, капсула постепенно просаживается в пол).
 */
function step(world, p, dirX, dirZ, speed = PLAYER.walk) {
  const len = Math.hypot(dirX, dirZ) || 1;
  p.vy += -9.81 * DT;
  if (p.grounded && p.vy < 0) p.vy = 0;
  const mv = { x: (dirX / len) * speed * DT, y: p.vy * DT, z: (dirZ / len) * speed * DT };
  p.cc.computeColliderMovement(p.col, mv);
  const m = p.cc.computedMovement();
  p.grounded = p.cc.computedGrounded();
  if (p.grounded && p.vy <= 0) p.vy = 0;
  const t = p.body.translation();
  p.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  world.step();
}

/** Идти по маршруту (список XZ) с допуском; маршрут строит nav.findPath. */
function follow(world, p, path, frames = 2400) {
  if (!path) return { reached: false, pos: feet(p), stuck: 0 };
  let i = 0, stuck = 0, f = 0;
  const prev = feet(p);
  while (i < path.length && f < frames) {
    const t = feet(p);
    const wp = path[i];
    const dx = wp.x - t[0], dz = wp.z - t[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.22) { i++; continue; }
    step(world, p, dx, dz);
    f++;
    const now = feet(p);
    if (Math.hypot(now[0] - prev[0], now[2] - prev[2]) < 0.002) stuck++; else stuck = 0;
    if (stuck > 45) break;
    prev[0] = now[0]; prev[1] = now[1]; prev[2] = now[2];
  }
  return { reached: i >= path.length, pos: feet(p), frames: f, stuck };
}

for (const kind of ['khrushchevka', 'brezhnevka']) {
  const model = buildVoxelHouse({ kind, sections: 1 });
  const origin = new THREE.Vector3(model.size[0] / 2, 0, model.size[2] / 2);
  const stair = buildStaircase(model.plan, model.floors, model.floorH, origin);
  const { world, tris } = makeWorld(model, stair);
  const plan = model.plan;
  const solid = makeSolid(model.spec);
  const floorH = model.floorH;
  const area = [-model.size[0] / 2 - 8, model.size[0] / 2 + 8, -model.size[2] / 2 - 8, model.size[2] / 2 + 8];
  console.log(`\n${kind}: ${model.size.map(v => v.toFixed(1)).join('×')} м, этаж ${floorH} м, floors ${model.floors}, физика ${(tris / 1000).toFixed(0)}k тр.`);

  check('этаж кратен шагу сетки (полы не «волной»)', Math.abs(floorH / PITCH - Math.round(floorH / PITCH)) < 1e-9, `${floorH} м`);
  check('потолок выше роста игрока', floorH - PITCH > PLAYER.heightStand, `этаж ${floorH} − плита 0.5 = ${(floorH - PITCH).toFixed(2)} м, рост ${PLAYER.heightStand}`);
  check('подступ лестницы ниже шага персонажа', stair.rise <= PLAYER.stepHeight,
    `подступ ${stair.rise.toFixed(3)} м, шаг ${PLAYER.stepHeight}`);

  // --- 1. улица → дверь → внутрь клетки (настоящая физика)
  const p = makePlayer(world, [plan.entrance.x + model.size[0] / 2, 0.05, plan.entrance.z + model.size[2] / 2 - 6]);
  const doorIn = [plan.entrance.x + model.size[0] / 2, 0.05, plan.entrance.z + model.size[2] / 2 + 1.4];
  const pathIn = findPath(solid, feet(p), doorIn, lvl(feet(p)[1]), { ox: 0, oy: 0, oz: 0 }, [-20, 30, -20, 30]);
  const rIn = follow(world, p, pathIn);
  check('заходим с улицы в подъезд', rIn.reached && feet(p)[2] > plan.entrance.z + model.size[2] / 2,
    `зашли на z=${(feet(p)[2] - model.size[2] / 2).toFixed(2)} (дверь на ${plan.entrance.z})`);

  // --- 2. достижимость по сетке проходимости (честная проверка «можно ли пройти»)
  const W = model.size[0] / 2, D = model.size[2] / 2;
  const worldW = (p2) => [p2[0] + W, p2[1] + D];
  const areaFloor = [0, model.size[0], 0, model.size[2]];
  const stairsFloor1 = landingFloor(plan, floorH);
  const extra = (x, z, feet) => stairsFloor1(x - W, z - D, feet);

  const doorW = worldW([plan.entrance.x, plan.entrance.z + 1.4]);
  // улицу включаем в область: иначе «дойти до улицы» упирается в границу BFS, а не в стену
  const areaWorld = [-14, model.size[0] + 14, -16, model.size[2] + 16];
  const reach0 = bfsReach(solid, [doorW[0], 0, doorW[1]], 0, undefined, areaWorld, extra);
  const roomsOk = plan.rooms.map(r => ({
    r, ok: reach0.reachable((r.x0 + r.x1) / 2 + W, (r.z0 + r.z1) / 2 + D),
  }));
  const missing = roomsOk.filter(x => !x.ok).map(x => x.r.name);
  check('с улицы можно дойти во все комнаты 1-го этажа', missing.length === 0,
    missing.length ? `недостижимы: ${missing.join(', ')}` : `${plan.rooms.length} комнат`);

  // верхний этаж: заходим из лестничной клетки на площадку этажа
  const landW = worldW([plan.stairs.x0 + 0.8, plan.stairs.z0 + 0.8]);
  const reachTop = bfsReach(solid, [landW[0], 0, landW[1]], floorH, undefined, areaWorld, extra);
  const topRooms = plan.rooms.filter(r => r.id !== 'stairs');
  const topMissing = topRooms.filter(r => !reachTop.reachable((r.x0 + r.x1) / 2 + W, (r.z0 + r.z1) / 2 + D));
  check(`на верхнем этаже (${floorH} м) все комнаты достижимы с площадки`,
    reachTop && topMissing.length === 0,
    reachTop ? `${topRooms.length - topMissing.length}/${topRooms.length} комнат` : 'площадка недостижима');
  // «обратно на улицу» проверяем как два шага: с этажа на площадку 1-го этажа, а оттуда
  // уже по первому этажу до двери (шахта лестницы в вокселях пустая, поэтому одним BFS
  // путь через этажи не строится — этажи соединяет геометрия лестницы, а не воксели).
  const backDown = reachTop.reachable(landW[0], landW[1]);
  const backOut = reach0.reachable(doorW[0], doorW[1] - 4);
  check('с этажа можно вернуться на улицу', backDown && backOut,
    `этаж→площадка: ${backDown ? 'да' : 'нет'}, площадка→улица: ${backOut ? 'да' : 'нет'}`);

  // --- 3. маршрут лестницей по физике: сначала реально взойти
  let maxY = feet(p)[1];
  const laneL = (stair.zone.x0 + (stair.zone.x0 + stair.zone.x1) / 2) / 2 + W;
  const laneR = ((stair.zone.x0 + stair.zone.x1) / 2 + stair.zone.x1) / 2 + W;
  const zA = stair.zone.z0 + D, zB = stair.zone.z1 + D;
  const waypoints = [
    [laneL, zA + 0.35], [laneL, zB - 0.35], [laneR, zB - 0.35], [laneR, zA + 0.35],
  ];
  for (const wp of waypoints) {
    for (let f = 0; f < 900; f++) {
      const t = feet(p);
      const dx = wp[0] - t[0], dz = wp[1] - t[2];
      if (Math.hypot(dx, dz) < 0.25) break;
      step(world, p, dx, dz);
      maxY = Math.max(maxY, feet(p)[1]);
    }
  }
  check('лестница физически выводит на этаж', maxY > floorH * 0.85,
    `поднялись на ${maxY.toFixed(2)} м при высоте этажа ${floorH} м (подступ ${stair.rise.toFixed(3)} м)`);

  // --- 4. с площадки этажа идём в каждую комнату настоящей физикой
  const failed = [];
  const hall = plan.rooms.find(r => r.id === 'hall');
  const hallC = [(hall.x0 + hall.x1) / 2 + W, floorH, (hall.z0 + hall.z1) / 2 + D];
  // сначала сходим с лестничной площадки в прихожую (дверь квартиры)
  {
    const outP = findPath(solid, feet(p), hallC, lvl(feet(p)[1]), undefined, areaFloor, extra);
    if (outP) for (const pt of outP) {
      for (let f = 0; f < 600; f++) {
        const t = feet(p);
        const dx = pt.x - t[0], dz = pt.z - t[2];
        if (Math.hypot(dx, dz) < 0.2) break;
        step(world, p, dx, dz);
      }
    }
  }
  for (const r of plan.rooms.filter(x => x.id !== 'stairs')) {
    const from = feet(p);
    const to = [(r.x0 + r.x1) / 2 + W, floorH, (r.z0 + r.z1) / 2 + D];
    // маршрут строим по сетке на уровне пола этажа; бот идёт по точкам физикой
    const pth = findPath(solid, from, to, lvl(from[1]), undefined, areaFloor, extra);
    if (process.env.DBG) console.log('   [dbg]', r.name, 'from', from.map(v => +v.toFixed(3)), 'path', pth ? pth.length : null,
      'wf', walkableAt(solid, from[0], lvl(from[1]), from[2], undefined, extra),
      'wt', walkableAt(solid, to[0], floorH, to[1], undefined, extra),
      'direct', findPath(solid, from, to, lvl(from[1]), undefined, areaFloor, extra)?.length ?? null);
    if (!pth) { failed.push(`${r.name}: нет маршрута`); continue; }
    // добавляем промежуточные точки маршрута в мировые координаты
    for (const pt of pth) {
      for (let f = 0; f < 600; f++) {
        const t = feet(p);
        const dx = pt.x - t[0], dz = pt.z - t[2];
        if (Math.hypot(dx, dz) < 0.2) break;
        step(world, p, dx, dz);
      }
    }
    const at = feet(p);
    const inside = at[0] > r.x0 + W && at[0] < r.x1 + W && at[2] > r.z0 + D && at[2] < r.z1 + D
      && Math.abs(at[1] - floorH) < 0.4;
    if (!inside) failed.push(`${r.name}: застрял на (${(at[0] - W).toFixed(1)}, ${(at[2] - D).toFixed(1)}) y=${at[1].toFixed(2)}`);
  }
  check('бот обходит все комнаты этажа (физика)', failed.length === 0,
    failed.length ? failed.join(' | ') : plan.rooms.filter(r => r.id !== 'stairs').length + ' комнат');

  // --- 5. наружная стена рядом с дверью — реальная преграда (проверяем тримеш физики)
  const facadeWorldZ = plan.entrance.z + model.size[2] / 2;
  const wallX = model.size[0] / 2 + plan.entrance.x + plan.entrance.width;   // сразу за краем двери
  const wallHit = world.castRay(new RAPIER.Ray({ x: wallX, y: 1.2, z: facadeWorldZ - 4 }, { x: 0, y: 0, z: 1 }), 8, true);
  check('рядом с дверью наружная стена — преграда', !!wallHit && wallHit.timeOfImpact < 4.5,
    wallHit ? `луч упёрся через ${wallHit.timeOfImpact.toFixed(2)} м (фасад на ${(facadeWorldZ - (facadeWorldZ - 4)).toFixed(1)} м)` : 'луч прошёл сквозь стену');

}

// --- 7. мебель стоит НА полу каждого этажа (а не висит в воздухе и не тонет в плите)
{
  const scene = new THREE.Scene();
  const phys = { add: () => 1, removeBody: () => {}, post: () => {} };
  const b = spawnVoxelHouse({ kind: 'khrushchevka', sections: 1 }, scene, phys, [0, 0, 0], 0);
  const fh = b.model.floorH;
  // Мебель слита по МАТЕРИАЛАМ (один меш на материал на весь дом), поэтому меш может
  // занимать несколько этажей — проверяем не меш целиком, а каждый его треугольник:
  // низ каждого предмета (первые 0.3 м над полом) должен попадать на уровень пола.
  const levels = new Set();
  let misplaced = 0, parts = 0;
  const samples = [];
  scene.traverse(o => {
    const m = o;
    if (!m.isMesh || m.name !== 'furniture' || !m.geometry?.attributes?.position) return;
    const pos = m.geometry.attributes.position;
    const buckets = new Map();          // уровень пола → сколько вершин рядом с ним
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = Math.round(y / fh);
      const key = k;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    for (const [k] of buckets) {
      parts++;
      levels.add(k);
      if (k < 0 || k > b.model.floors) { misplaced++; if (samples.length < 3) samples.push(`уровень ${k}`); }
    }
  });
  check('мебель стоит на полу своего этажа', misplaced === 0,
    `этажи: ${[...levels].sort((a, c) => a - c).join(', ')} (всего уровней ${parts})` +
    (misplaced ? `; вне дома ${misplaced}: ${samples.join(', ')}` : ''));
}

// --- 8. спавн игрока — прямо у подъезда первого дома (иначе «до здания не дойти»)
{
  const d = BUILDINGS[0];
  const m = buildVoxelHouse({ kind: d.kind, sections: d.sections });
  const secCx = d.pos[0] - m.size[0] / 2 + m.plan.w / 2;
  const doorX = secCx + m.plan.entrance.x;
  const doorZ = d.pos[2] + m.plan.entrance.z;
  const dist = Math.hypot(SPAWN[0] - doorX, SPAWN[2] - doorZ);
  check('спавн рядом с подъездом (не «за 190 м»)', dist > 2 && dist < 8,
    `до двери ${dist.toFixed(2)} м, спавн (${SPAWN[0].toFixed(1)}, ${SPAWN[2].toFixed(1)})`);
  check('спавн не внутри стены и на земле', Math.abs(SPAWN[1] - 1) < 1 && heightAt(SPAWN[0], SPAWN[2]) < 0.05,
    `высота земли ${heightAt(SPAWN[0], SPAWN[2]).toFixed(2)} м`);
  // спавн по формуле совпадает с константой (чтобы правки расстановки не «отрывали» спавн)
  const calc = spawnPoint(d);
  check('спавн вычисляется из плана дома', Math.hypot(calc[0] - SPAWN[0], calc[2] - SPAWN[2]) < 1e-6);
}

// --- 9. МНОГОСЕКЦИОННЫЙ дом: тесты гоняли 1 секцию, а в игре стоят 3 и 2.
// Внутренние стены, двери и ШАХТА переводились в индексы сетки со сложением двух
// центрирований (начало секции + смещение от центра дома). При 1 секции это
// компенсировалось, при 3 — уезжало на секцию вперёд: шахта вылезала за дом, плиты
// её заливали, и в подъезде из проёма росла «лестница в никуда».
{
  // по одному дому каждого типа и разной этажности (третий в мире — та же хрущёвка)
  const seen = new Set();
  for (const d of BUILDINGS) {
    const uid = `${d.kind}|${d.sections}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    const model = buildVoxelHouse({ kind: d.kind, sections: d.sections });
    const { nx, ny, nz, cells } = model.spec;
    const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];
    const secW = Math.round(model.plan.w / PITCH);
    const plan = model.plan;
    const PK = (z) => Math.floor((z + (nz * PITCH) / 2) / PITCH);
    const PI = (x, s) => Math.floor((x + (s - (d.sections - 1) / 2) * plan.w + (nx * PITCH) / 2) / PITCH);
    const tag = `${d.kind} ×${d.sections}`;
    const probs = [];
    for (let s = 0; s < d.sections; s++) {
      const sec0 = s * secW, sec1 = sec0 + secW - 1;
      const i0 = PI(plan.stairs.x0, s) + 1, i1 = PI(plan.stairs.x1, s) - 1;
      const k0 = PK(plan.stairs.z0) + 1, k1 = PK(plan.stairs.z1) - 1;
      if (i0 <= sec0 || i1 >= sec1 || i1 <= i0) { probs.push(`шахта секции ${s} вне секции (${i0}..${i1} при ${sec0}..${sec1})`); continue; }
      for (let f = 1; f < model.floors; f++) {
        const j = Math.floor((f * model.floorH) / PITCH) - 1;
        let solid = 0;
        for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) if (at(i, j, k) >= 0) solid++;
        if (solid) { probs.push(`шахта замурована на ${f}-м этаже (${solid} вокселей)`); break; }
      }
      const dI = PI(plan.entrance.x, s), dK = PK(plan.entrance.z);
      if (at(dI, 1, dK) >= 0) probs.push(`дверь подъезда заложена в секции ${s}`);
      // внутренняя стена квартиры (клетка | прихожая) на месте и с дверью
      const wI = PI(plan.stairs.x1, s);
      if (at(wI, Math.floor(1.5 / PITCH), PK(plan.stairs.z0 + 2.0)) < 0) probs.push(`нет стены клетки в секции ${s}`);
    }
    // марши не должны проходить сквозь перекрытие: у каждой ступени каждого подъезда
    // должен быть просвет до плиты не меньше роста игрока + запас
    let lowClear = 0, minClear = 99;
    for (let s = 0; s < d.sections; s++) {
      const so = new THREE.Vector3(model.size[0] / 2 + (s - (d.sections - 1) / 2) * plan.w, 0, model.size[2] / 2);
      const st = buildStaircase(plan, model.floors, model.floorH, so);
      for (let f = 0; f < model.floors - 1; f++) {
        for (const mid of [-4.75, -3.75]) {
          for (let n = 0; n < st.steps; n++) {
            const y = f * model.floorH + (n + 1) * st.rise;
            const x = so.x + mid;
            const z = so.z + st.zone.z0 + st.landing + (n + 0.5) * st.tread;
            const iL = Math.floor(x / PITCH), kL = Math.floor(z / PITCH);
            let clear = 0;
            for (let dd = 0.05; dd < 2.2; dd += 0.25) {
              if (at(iL, Math.floor((y + dd) / PITCH), kL) < 0) clear = dd; else break;
            }
            minClear = Math.min(minClear, clear);
            if (clear < PLAYER.heightStand + 0.1) lowClear++;
          }
        }
      }
    }
    if (lowClear) probs.push(`${lowClear} ступеней упираются в перекрытие (просвет ${minClear.toFixed(2)} м)`);
    check(`${tag}: шахта внутри дома, плиты её не заливают, двери на месте`,
      probs.length === 0,
      probs.length ? probs.slice(0, 3).join('; ') : `${d.sections} секц., ${model.floors} эт., просвет над маршем ${minClear.toFixed(2)} м`);
  }
}

// --- 10. физика в СРЕДНЕМ подъезде многосекционного дома.
// Лестница строилась одна на весь дом, поэтому в среднем и третьем подъездах маршей
// не было вовсе: наверх было не подняться (это и был кадр «лестница в никуда»).
{
  const d = BUILDINGS[0];                       // 3-секционная хрущёвка — как в игре
  const model = buildVoxelHouse({ kind: d.kind, sections: d.sections });
  const plan = model.plan;
  const secIdx = Math.floor(d.sections / 2);    // средний подъезд
  const secOff = (secIdx - (d.sections - 1) / 2) * plan.w;
  const center = new THREE.Vector3(0, 0, 0);
  // buildStaircase ждёт origin в геометрии дома (центр плана = size/2), но сетка
  // многосекционного дома шире одной секции — поэтому марши строим в координатах
  // сетки напрямую: центр секции = size[0]/2 + secOff.
  const st = buildStaircase(plan, model.floors, model.floorH, new THREE.Vector3(model.size[0] / 2 + secOff, 0, model.size[2] / 2));
  const { world } = makeWorld(model, st);
  const ox = model.size[0] / 2 + secOff, oz = model.size[2] / 2;
  const p = makePlayer(world, [plan.entrance.x + ox, 0.05, plan.entrance.z + oz - 2.0]);
  for (let f = 0; f < 240; f++) step(world, p, 0, 1);   // заходим в подъезд
  const y0 = feet(p)[1] + 1;                            // +1, чтобы 0 не считался «подъёмом»
  const laneL2 = (st.zone.x0 + (st.zone.x0 + st.zone.x1) / 2) / 2 + ox;
  const laneR2 = ((st.zone.x0 + st.zone.x1) / 2 + st.zone.x1) / 2 + ox;
  const zA2 = st.zone.z0 + oz, zB2 = st.zone.z1 + oz;
  for (const wp of [[laneL2, zA2 + 0.35], [laneL2, zB2 - 0.35], [laneR2, zB2 - 0.35], [laneR2, zA2 + 0.35]]) {
    for (let f = 0; f < 900; f++) {
      const t = feet(p);
      const dx = wp[0] - t[0], dz = wp[1] - t[2];
      if (Math.hypot(dx, dz) < 0.25) break;
      step(world, p, dx, dz);
    }
  }
  const climbed = feet(p)[1] + 1 - y0;
  check('в среднем подъезде 3-секционного дома есть лестница и она выводит на этаж',
    climbed > model.floorH - 0.4,
    `поднялись на ${climbed.toFixed(2)} м (этаж ${model.floorH} м)`);
}

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — ${ok} проверок, можно зайти, подняться на этаж и обойти все комнаты`);
process.exit(bad ? 1 : 0);
