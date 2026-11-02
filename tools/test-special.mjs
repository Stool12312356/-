// КАЗАРМА И ВОЕНТОРГ (п.5): проверяем, что здания действительно собираются, внутри
// есть куда войти, дверной проём пробит, на 2-м этаже казармы есть проём под лестницу,
// а не «глухая плита».
import { buildSpecial, specialPlan } from '../src/game/barracks.ts';
import { PITCH } from '../src/game/voxelhouse.ts';
import { buildStaircase } from '../src/game/staircase.ts';
import { stairPlan } from '../src/game/barracks.ts';
import { PLAYER } from '../src/shared/constants.ts';
import * as THREE from 'three';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

for (const kind of ['barracks', 'shop']) {
  console.log(`\n${kind === 'barracks' ? 'КАЗАРМА' : 'ВОЕНТОРГ'}`);
  const m = buildSpecial(kind, 1);
  const { nx, ny, nz, cells } = m.spec;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];
  const plan = specialPlan(kind);

  check('сетка', nx > 0 && ny > 0 && nz > 0, `${nx}×${ny}×${nz}`);
  check('воксели есть', m.stats.voxels > 500, String(m.stats.voxels));
  check('есть стекло (окна)', (m.stats.byKind[3] ?? 0) > 0, String(m.stats.byKind[3] ?? 0));
  check('есть внутренние стены', (m.stats.byKind[2] ?? 0) > 0, String(m.stats.byKind[2] ?? 0));

  // дверной проём: колонка над порогом должна быть пустой до 2.4 м
  const PI = (x) => Math.floor((x + (nx * PITCH) / 2) / PITCH);
  const PK = (z) => Math.floor((z + (nz * PITCH) / 2) / PITCH);
  const di = PI(plan.entrance.x), dk = PK(plan.entrance.z);
  let doorFree = true;
  for (let j = 1; j < Math.round(2.4 / PITCH); j++) if (at(di, j, dk) >= 0) doorFree = false;
  check('дверной проём до 2.4 м свободен', doorFree, `i=${di} k=${dk}`);

  // внутри должно быть пусто: центр зала на высоте 1.2 м
  const room = plan.rooms[0];
  const ci = PI((room.x0 + room.x1) / 2), ck = PK((room.z0 + room.z1) / 2);
  const free = [];
  for (let j = 2; j < 4; j++) free.push(at(ci, j, ck));
  check('внутри зала пусто (можно стоять)', free.every(v => v < 0), free.join(','));
  check('над залом есть перекрытие/крыша', at(ci, ny - 1, ck) >= 0 || at(ci, Math.round(plan.floorH / PITCH), ck) >= 0);

  if (kind === 'barracks') {
    // 2-й этаж: проём под лестницу
    const w = plan.stairWell;
    check('задан проём под лестницу', !!w);
    const wi = PI((w.x0 + w.x1) / 2), wk = PK((w.z0 + w.z1) / 2);
    const jFloor = Math.round(plan.floorH / PITCH) - 1;
    check('в перекрытии над лестницей проём', at(wi, jFloor, wk) < 0, `j=${jFloor}`);
    // лестница строится и не бросает (уклон, ширина площадок)
    let st = null, err = '';
    try { st = buildStaircase(stairPlan(plan), plan.floors, plan.floorH, new THREE.Vector3(0, 0, 0)); }
    catch (e) { err = e.message; }
    check('лестница собрана (уклон/проступь в норме)', !!st, err || `${st?.parts.length} частей`);
    if (st) check('подступ ниже шага игрока', st.rise <= PLAYER.stepHeight, `${st.rise.toFixed(3)} м`);
  } else {
    check('магазин одноэтажный', plan.floors === 1);
  }
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — казарма и военторг (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
