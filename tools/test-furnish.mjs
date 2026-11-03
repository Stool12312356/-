// Проверка РАССТАНОВКИ МЕБЕЛИ по квартирам.
// Пользователь: «мебель навалена друг на друга / торчит из стены, посторонний чёрный куб».
// Тест ловит ровно это, без браузера и без картинок:
//   1) каждый предмет из плана комнаты РЕАЛЬНО поставлен (раньше молча исчезал);
//   2) ничего не стоит в стене (проверяем по настоящей воксельной сетке дома);
//   3) предметы не пересекаются по габаритам (ковёр — исключение, он лежит под мебелью);
//   4) весь предмет внутри своей комнаты;
//   5) мебель не загораживает дверные проёмы.
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { apartmentPlan, furnish, FURN_SIZE, inRoom } from '../src/game/plan.ts';
import { PITCH } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

/** Габарит предмета на плане с учётом поворота. */
const box = (it) => {
  const [w0, d0] = FURN_SIZE[it.kind];
  const odd = Math.abs(Math.round(it.rot / (Math.PI / 2)) % 2) === 1;
  const w = odd ? d0 : w0, d = odd ? w0 : d0;
  return { x0: it.x - w / 2, x1: it.x + w / 2, z0: it.z - d / 2, z1: it.z + d / 2 };
};

for (const kind of ['khrushchevka', 'brezhnevka']) {
  const plan = apartmentPlan(kind);
  const m = buildVoxelHouse({ kind, sections: 1 });
  const { nx, ny, nz, cells } = m.spec;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];
  const I = (x) => Math.floor((x + plan.w / 2) / PITCH);
  const K = (z) => Math.floor((z + plan.d / 2) / PITCH);
  // «в стене» = центр предмета попал в воксель на высоте 1 м (или 0.4 м для низкой мебели)
  const inWall = (it) => at(I(it.x), Math.floor(1.0 / PITCH), K(it.z)) >= 0 ||
    at(I(it.x), Math.floor(0.4 / PITCH), K(it.z)) >= 0;

  console.log(`\n${kind}`);
  let placed = 0, missing = [], walls = [], overlaps = [], outside = [], doors = [];
  for (const r of plan.rooms) {
    if (r.id === 'stairs') continue;                 // лестничная клетка без мебели
    const items = furnish(r, plan);
    placed += items.length;
    for (const want of r.furniture) {
      if (!items.some(i => i.kind === want)) missing.push(`${r.id}:${want}`);
    }
    for (const it of items) {
      if (inWall(it)) walls.push(`${r.id}:${it.kind}@${it.x.toFixed(2)},${it.z.toFixed(2)}`);
      if (!inRoom(r, it.x, it.z, 0.2)) outside.push(`${r.id}:${it.kind}`);
      // дверные проёмы этой комнаты: предмет не должен стоять в проёме
      for (const ws of plan.walls) {
        const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
        for (const [a, b] of ws.doors) {
          const lo = (horiz ? Math.min(ws.x0, ws.x1) : Math.min(ws.z0, ws.z1)) + a;
          const hi = (horiz ? Math.min(ws.x0, ws.x1) : Math.min(ws.z0, ws.z1)) + b;
          const ax = horiz ? ws.z0 : ws.x0;
          const zone = horiz ? { x0: lo, x1: hi, z0: ax - 0.25, z1: ax + 0.25 } : { x0: ax - 0.25, x1: ax + 0.25, z0: lo, z1: hi };
          const bb = box(it);
          const ox = Math.min(bb.x1, zone.x1) - Math.max(bb.x0, zone.x0);
          const oz = Math.min(bb.z1, zone.z1) - Math.max(bb.z0, zone.z0);
          if (ox > 0.05 && oz > 0.05) doors.push(`${r.id}:${it.kind} в проёме`);
        }
      }
    }
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const A = items[a], B = items[b];
        if (A.kind === 'carpet' || B.kind === 'carpet') continue;   // ковёр лежит под мебелью
        const p = box(A), q = box(B);
        const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
        const oz = Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0);
        if (ox > 0.02 && oz > 0.02) overlaps.push(`${r.id}:${A.kind}×${B.kind} ${ox.toFixed(2)}×${oz.toFixed(2)}`);
      }
    }
  }
  check('вся мебель из плана поставлена', missing.length === 0,
    missing.length ? `не поставлено: ${missing.join(', ')}` : `предметов ${placed}`);
  check('мебель не стоит в стене', walls.length === 0, walls.length ? walls.join(', ') : 'в стене 0');
  check('мебель не пересекается', overlaps.length === 0, overlaps.length ? overlaps.join(', ') : 'наложений 0');
  check('мебель внутри своей комнаты', outside.length === 0, outside.length ? outside.join(', ') : 'вне комнат 0');
  check('мебель не загораживает двери', doors.length === 0, doors.length ? doors.join(', ') : 'проёмы свободны');
}

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — расстановка мебели (${ok} проверок)`);
process.exit(bad ? 1 : 0);
