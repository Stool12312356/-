// КАЗАРМА (п.5): настоящая физика — зайти с улицы, пройти коридор, подняться по лестнице
// на 2-й этаж. Как и test-walk.mjs: тримеш из тех же воксельных граней + капсула с
// параметрами игрока (autostep 0.4). Не «в стене есть проём», а «бот реально стоит наверху».
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildSpecial, barracksPlan } from '../src/game/barracks.ts';
import { buildStaircase } from '../src/game/staircase.ts';
import { stairPlan } from '../src/game/barracks.ts';
import { PITCH, VOXEL_FACES, VOXEL_QUADS } from '../src/game/voxelhouse.ts';
import { PLAYER } from '../src/shared/constants.ts';

await RAPIER.init();

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
const H = PITCH / 2;

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
  return { verts, idx };
}

const plan = barracksPlan();
const model = buildSpecial('barracks', 1);
const origin = new THREE.Vector3(model.size[0] / 2, 0, model.size[2] / 2);   // сетка от 0 → дом в [0..W]
const stair = buildStaircase(stairPlan(plan), plan.floors, plan.floorH, origin);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;
const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(model.size[0] / 2, -0.5, model.size[2] / 2));
world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200), ground);
const m = meshOf(model);
const off = m.verts.length / 3;
const verts = new Float32Array(m.verts.length + stair.verts.length);
verts.set(m.verts); verts.set(stair.verts, m.verts.length);
const idx = [...m.idx, ...stair.idx.map(v => v + off)];
const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idx)), b);
world.step();

const R = 0.3, HH = PLAYER.heightStand;
const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
const col = world.createCollider(RAPIER.ColliderDesc.capsule((HH - 2 * R) / 2, R).setFriction(0), body);
const cc = world.createCharacterController(0.02);
cc.enableAutostep(PLAYER.stepHeight, 0.2, false);
cc.enableSnapToGround(0.35);
cc.setMaxSlopeClimbAngle((PLAYER.slopeMax * Math.PI) / 180);
cc.setUp({ x: 0, y: 1, z: 0 });
const p = { body, col, cc, vy: 0, grounded: false };
const feet = () => { const t = body.translation(); return [t.x, t.y - HH / 2, t.z]; };
const put = (x, y, z) => { body.setTranslation({ x, y: y + HH / 2, z }, true); p.vy = 0; };
const DT = 1 / 60;
function step(dx, dz, speed = PLAYER.walk) {
  const len = Math.hypot(dx, dz) || 1;
  p.vy += -9.81 * DT;
  if (p.grounded && p.vy < 0) p.vy = 0;
  cc.computeColliderMovement(col, { x: (dx / len) * speed * DT, y: p.vy * DT, z: (dz / len) * speed * DT });
  const mv = cc.computedMovement();
  p.grounded = cc.computedGrounded();
  if (p.grounded && p.vy <= 0) p.vy = 0;
  const t = body.translation();
  body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
  world.step();
}
/** идти к точке XZ, пока не дойдём (или не застрянем) */
function walkTo(x, z, frames = 1200) {
  let f = 0, stuck = 0;
  const prev = feet();
  while (f < frames) {
    const t = feet();
    const dx = x - t[0], dz = z - t[2];
    if (Math.hypot(dx, dz) < 0.25) break;
    step(dx, dz);
    f++;
    const n = feet();
    if (Math.hypot(n[0] - prev[0], n[2] - prev[2]) < 0.002) stuck++; else stuck = 0;
    if (stuck > 40) break;
    prev[0] = n[0]; prev[1] = n[1]; prev[2] = n[2];
  }
  return feet();
}

// мировые координаты: локальные X/Z → + половина габарита
const W = (x, z) => [x + model.size[0] / 2, z + model.size[2] / 2];

console.log(`\nКАЗАРМА ${model.size.map(v => v.toFixed(1)).join('×')} м, этажей ${plan.floors}, физика ${(idx.length / 3000).toFixed(0)}k тр.`);

// 1. перед дверью
const [dx, dz] = W(plan.entrance.x, plan.entrance.z - 3.0);
put(dx, 0.05, dz);
{
  const before = feet();
  const after = walkTo(...W(plan.entrance.x, plan.entrance.z + 0.6));
  check('дошёл от улицы до двери', Math.abs(after[2] - before[2]) > 1.5,
    `z ${before[2].toFixed(2)} → ${after[2].toFixed(2)}`);
  check('зашёл ВНУТРЬ (за фасад)', after[2] > W(0, plan.entrance.z + 0.3)[1], `z=${after[2].toFixed(2)}`);
}

// 2. коридор → дверь в лестничную клетку
{
  const r = walkTo(...W(plan.stairWell.x0 + 0.9, -4.9));
  check('прошёл коридором к лестнице', r[0] > W(3.0, 0)[0] - 0.1, `x=${r[0].toFixed(2)} (клетка с ${W(3.0, 0)[0].toFixed(2)})`);
}

// 3. наверх по лестнице. Три участка, как у настоящего маршрута:
//   фасад → тыл по левой полосе (нижний марш), разворот на площадке в тылу,
//   тыл → фасад по правой полосе (верхний марш) → площадка 2-го этажа.
// Никакой телепортации: бот идёт шагами, высоту набирает autostep.
{
  const x0 = plan.stairWell.x0;
  // мир: фасад z≈0, тыл z≈12. Клетка лестницы — z 0.5…6, разворотная площадка у z≈5.2
  const [wBack, wFacade] = [5.1, 0.9];
  let best = feet()[1], phase = 0;
  for (let i = 0; i < 3000; i++) {
    const t = feet();
    if (phase === 0 && t[2] > wBack - 0.35) phase = 1;
    else if (phase === 1 && t[0] > W(x0 + 1.7, 0)[0]) phase = 2;
    const px = W(x0 + (phase === 0 ? 0.9 : 2.1), 0)[0];
    const pz = phase < 2 ? wBack : wFacade;
    step(px - t[0], pz - t[2]);
    if (t[1] > best) best = t[1];
    if (process.env.DBG && i % 60 === 0) console.log(`    t=${i} pos=${t.map(v => v.toFixed(2)).join(',')} y_max=${best.toFixed(2)} ph=${phase}`);
    if (t[1] > plan.floorH + 0.1) break;
  }
  if (process.env.DBG) console.log('    best', best.toFixed(2), feet().map(v => v.toFixed(2)).join(','));
  check('поднялся по лестнице на 2-й этаж', best > plan.floorH - 0.05,
    `высота ${best.toFixed(2)} м при этаже ${plan.floorH} м`);
}

// 4. на 2-м этаже можно идти (перекрытие есть, не провалился)
{
  const t = feet();
  if (t[1] > plan.floorH) {
    // Выход с площадки 2-го этажа: дверь клетка→коридор (z −5.4…−4.4), затем коридор→зал
    // (z −5.2…−4.2). Идём по точкам: прямую сквозь стены бот пройти не может и не должен.
    let r1 = feet();
    for (const [x, z] of [[3.0, -4.9], [2.0, -4.7], [1.0, -4.7], [-2.0, -4.7]]) r1 = walkTo(...W(x, z));
    const r2 = r1;
    check('на 2-м этаже есть пол и не провалился', r2[1] > plan.floorH - 0.2, `y=${r2[1].toFixed(2)}`);
    check('на 2-м этаже можно идти (через дверь в зал)', r2[0] < W(plan.stairWell.x0, 0)[0], `x=${r1[0].toFixed(2)} → ${r2[0].toFixed(2)}`);
  } else {
    check('на 2-м этаже есть пол и не провалился', false, 'не поднялся');
    check('на 2-м этаже можно идти', false, 'не поднялся');
  }
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — казарма проходима (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
