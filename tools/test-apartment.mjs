// Проверка ВНУТРЕННЕЙ ПЛАНИРОВКИ: стены по 2D-плану, двери, проходимость комнат.
// Пользователь: «между квартирами нет стены, мебель раскидана по зданию без комнат».
// Тест ловит ровно это: пустую коробку внутри и комнату без двери.
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { apartmentPlan, furnish, inRoom } from '../src/game/plan.ts';
import { PITCH } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

for (const kind of ['khrushchevka', 'brezhnevka']) {
  const plan = apartmentPlan(kind);
  const m = buildVoxelHouse({ kind, sections: 1 });
  const { nx, ny, nz, cells } = m.spec;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];
  // метры плана → индексы сетки. План задан по осевым линиям стен (они проходят через
  // ЦЕНТРЫ вокселей), поэтому индекс = floor(координата / PITCH) в мировых координатах,
  // где дом стоит от 0 до size. Раньше здесь был round от центра плана — тест «съезжал»
  // на полвокселя и давал ложные FAIL.
  const I = (x) => Math.floor((x + plan.w / 2) / PITCH);
  const K = (z) => Math.floor((z + plan.d / 2) / PITCH);
  const solidAtFloor = (x, z, h = 1.0) => at(I(x), Math.floor(h / PITCH), K(z)) >= 0;
  console.log(`\n${kind}: ${m.size.map(v => v.toFixed(1)).join('×')} м, комнат ${plan.rooms.length}, стен ${plan.walls.length}`);

  // 1. стены на месте: в середине каждого отрезка (вне дверей) есть воксели от пола до потолка
  let wallOk = 0, wallBad = 0;
  for (const ws of plan.walls) {
    const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
    const len = horiz ? Math.abs(ws.x1 - ws.x0) : Math.abs(ws.z1 - ws.z0);
    for (let t = 0.5; t < len; t += 0.5) {
      if (ws.doors.some(([a, b]) => t >= a - 0.3 && t <= b + 0.3)) continue;
      const x = horiz ? Math.min(ws.x0, ws.x1) + t : ws.x0;
      const z = horiz ? ws.z0 : Math.min(ws.z0, ws.z1) + t;
      // стена идёт от пола (j0 = 0) до перекрытия: проверяем 0.25 … 2.25 м
      const column = [0.25, 0.75, 1.25, 1.75, 2.25].every(h => solidAtFloor(x, z, h));
      if (column) wallOk++; else wallBad++;
    }
  }
  check('внутренние стены стоят от пола до потолка', wallBad === 0, `проверено ${wallOk + wallBad} точек, дыр ${wallBad}`);

  // 2. двери открыты (на уровне 1 м проёма нет)
  let doorBad = 0, doors = 0;
  for (const ws of plan.walls) {
    const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
    for (const [a, b] of ws.doors) {
      doors++;
      const mid = (a + b) / 2;
      const x = horiz ? Math.min(ws.x0, ws.x1) + mid : ws.x0;
      const z = horiz ? ws.z0 : Math.min(ws.z0, ws.z1) + mid;
      if (solidAtFloor(x, z, 1.0)) doorBad++;
    }
  }
  check('все двери прорезаны', doorBad === 0, `дверей ${doors}, заложено ${doorBad}`);

  // 3. проходимость: из прихожей достижима каждая комната (BFS по свободным клеткам)
  const step = 0.25;
  const W = Math.ceil(plan.w / step), H = Math.ceil(plan.d / step);
  const blocked = (gx, gz) => {
    const x = -plan.w / 2 + (gx + 0.5) * step, z = -plan.d / 2 + (gz + 0.5) * step;
    return solidAtFloor(x, z, 1.0);
  };
  const seen = new Uint8Array(W * H);
  const start = [Math.floor((plan.entrance.x + plan.w / 2) / step), Math.floor((plan.entrance.z + 0.5 + plan.d / 2) / step)];
  const q = [start[1] * W + start[0]]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], gx = c % W, gz = Math.floor(c / W);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nX = gx + dx, nZ = gz + dz;
      if (nX < 0 || nZ < 0 || nX >= W || nZ >= H) continue;
      const n = nZ * W + nX;
      if (seen[n] || blocked(nX, nZ)) continue;
      seen[n] = 1; q.push(n);
    }
  }
  const unreachable = [];
  for (const r of plan.rooms) {
    const gx = Math.floor(((r.x0 + r.x1) / 2 + plan.w / 2) / step);
    const gz = Math.floor(((r.z0 + r.z1) / 2 + plan.d / 2) / step);
    // центр комнаты может быть занят мебелью — тогда ищем любую достижимую клетку комнаты
    let reach = false;
    for (let zz = 0; zz < H && !reach; zz++) for (let xx = 0; xx < W; xx++) {
      if (!seen[zz * W + xx]) continue;
      const x = -plan.w / 2 + (xx + 0.5) * step, z = -plan.d / 2 + (zz + 0.5) * step;
      if (inRoom(r, x, z, 0.1)) { reach = true; break; }
    }
    void gx; void gz;
    if (!reach) unreachable.push(r.name);
  }
  check('в каждую комнату можно войти из прихожей', unreachable.length === 0, unreachable.length ? `недостижимы: ${unreachable.join(', ')}` : 'все 7 комнат достижимы');

  // 4. мебель строго внутри своей комнаты и не в стене
  let furn = 0, outside = 0, inWall = 0;
  for (const r of plan.rooms) {
    for (const f of furnish(r)) {
      furn++;
      if (!inRoom(r, f.x, f.z, 0.2)) outside++;
      if (solidAtFloor(f.x, f.z, 1.0)) inWall++;
    }
  }
  check('мебель внутри комнат', outside === 0, `предметов ${furn}, вне комнаты ${outside}`);
  check('мебель не стоит в стене', inWall === 0, `в стене ${inWall}`);

  // 5. перекрытия этажей целые: вне лестничной шахты плита есть в каждой клетке пола,
  // а над шахтой — пусто (иначе лестница «замурована» либо в полу дыры)
  let slabHoles = 0, shaftBlocked = 0, floorsChecked = 0;
  for (let f = 1; f < m.floors; f++) {
    const j = Math.round((f * m.floorH) / PITCH) - 1;      // плита = верхний воксель этажа
    floorsChecked++;
    for (let i = 0; i < m.spec.nx; i++) for (let k = 0; k < m.spec.nz; k++) {
      const inShaft = i > I(plan.stairs.x0) && i < I(plan.stairs.x1) && k > K(plan.stairs.z0) && k < K(plan.stairs.z1);
      const solid = at(i, j, k) >= 0;
      if (inShaft && solid) shaftBlocked++;
      if (!inShaft && !solid) slabHoles++;
    }
  }
  check('перекрытия этажей целые, шахта открыта', slabHoles === 0 && shaftBlocked === 0,
    `этажей ${floorsChecked}, дыр в плитах ${slabHoles}, замуровано в шахте ${shaftBlocked}`);

  // 6. СМЕЖНЫЕ КОМНАТЫ РАЗДЕЛЕНЫ СТЕНОЙ (найдено фото-проходом M7).
  // Санузел не имел стены с кухней: с кухни были видны ванна и унитаз. Смотрим ровно
  // ЦЕНТРЫ вокселей (полувоксельные срезы давали ложные «дыры» у кромки двери).
  const wallDoorAt = (x, z) => plan.walls.some(ws => {
    const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
    const onLine = horiz
      ? Math.abs(z - ws.z0) < 1e-6 && x >= Math.min(ws.x0, ws.x1) - 1e-6 && x <= Math.max(ws.x0, ws.x1) + 1e-6
      : Math.abs(x - ws.x0) < 1e-6 && z >= Math.min(ws.z0, ws.z1) - 1e-6 && z <= Math.max(ws.z0, ws.z1) + 1e-6;
    if (!onLine) return false;
    const t = horiz ? x - Math.min(ws.x0, ws.x1) : z - Math.min(ws.z0, ws.z1);
    return ws.doors.some(([a, b]) => t >= a - 0.02 && t <= b + 0.02);
  });
  const openPairs = [];
  let pairs = 0;
  for (let a = 0; a < plan.rooms.length; a++) for (let b = a + 1; b < plan.rooms.length; b++) {
    const A = plan.rooms[a], B = plan.rooms[b];
    const vShared = Math.abs(A.x1 - B.x0) < 1e-6;
    const hShared = Math.abs(A.z1 - B.z0) < 1e-6;
    let holes = 0, span = 0;
    if (vShared) {
      const z0 = Math.max(A.z0, B.z0), z1 = Math.min(A.z1, B.z1);
      if (z1 - z0 < 0.3) continue;
      pairs++;
      // осевые линии стен идут через ЦЕНТРЫ вокселей, поэтому берём строго центры:
      // от z0+0.5 шагом 0.5. Отсчёт от z0+0.25 попадал на кромки вокселей.
      for (let z = z0 + 0.5; z <= z1 - 0.5 + 1e-6; z += 0.5) {
        span++;
        if (!solidAtFloor(A.x1, z, 1.2) && !wallDoorAt(A.x1, z)) holes++;
      }
    } else if (hShared) {
      const x0 = Math.max(A.x0, B.x0), x1 = Math.min(A.x1, B.x1);
      if (x1 - x0 < 0.3) continue;
      pairs++;
      for (let x = x0 + 0.5; x <= x1 - 0.5 + 1e-6; x += 0.5) {
        span++;
        if (!solidAtFloor(x, A.z1, 1.2) && !wallDoorAt(x, A.z1)) holes++;
      }
    }
    void span;
    if (holes) openPairs.push(`${A.id}|${B.id}(${holes})`);
  }
  check('смежные комнаты разделены стенами', openPairs.length === 0,
    openPairs.length ? `дыры без дверей: ${openPairs.join(', ')}` : `пар смежных ${pairs}, дыр 0`);

  // 7. квартиры разделены: между гостиной и спальней есть стена
  const living = plan.rooms.find(r => r.id === 'living');
  const bedroom = plan.rooms.find(r => r.id === 'bedroom');
  const midX = (living.x1 + bedroom.x0) / 2;
  // глубину берём ВНЕ дверного проёма (дверь в спальню — на z ≈ −3.2…−2.2)
  check('между гостиной и спальней есть перегородка',
    solidAtFloor(midX, -1.2, 1.2) && solidAtFloor(midX, -4.4, 1.2), `стена x=${midX}`);
}

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — планировка по плану: стены, двери, комнаты проходимы (${ok} проверок)`);
process.exit(bad ? 1 : 0);
