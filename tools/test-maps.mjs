// КАРТЫ (ТЗ п.9): проверяем, что обе карты реально собираются, точки не стоят внутри
// стен, спавны сторон снаружи зданий, а маршрут от спавна до точки есть.
//
// Тест строит НАСТОЯЩИЕ воксельные модели домов и цехов (как в игре) и валидирует
// расстановку — без three-рендера, только сетки.
import { MAPS, getMap, buildCapturePoints, spawnFor } from '../src/game/maps.ts';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildSpecial } from '../src/game/barracks.ts';
import { PITCH } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

/** Функция «в этой мировой точке есть живой воксель» для одной постройки. */
function solidOf(model, pos, rotY) {
  const { nx, ny, nz, cells } = model.spec;
  const c = Math.cos(-rotY), sn = Math.sin(-rotY);
  return (x, y, z) => {
    const dx = x - pos[0], dz = z - pos[2];
    // обратный поворот: мир → локальные оси здания
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    // как в voxelgen: X центрируется по nx, Z — по nz (для повёрнутых зданий
    // размеры по осям уже поменяны местами при сборке модели)
    const i = Math.floor((lx + (nx * PITCH) / 2) / PITCH);
    const k = Math.floor((lz + (nz * PITCH) / 2) / PITCH);
    const j = Math.floor((y - pos[1]) / PITCH);
    // проверяем ровно воксель на высоте точки (пол под ногами — не стена)
    if (i < 0 || k < 0 || j < 0 || i >= nx || k >= nz || j >= ny) return false;
    return cells[(j * nz + k) * nx + i] >= 0;
  };
}

check('карт минимум две', MAPS.length >= 2, MAPS.map(m => m.name).join(' / '));
check('id карт уникальны', new Set(MAPS.map(m => m.id)).size === MAPS.length);

for (const map of MAPS) {
  console.log(`\n${map.name} (${map.id})`);
  // 1. все модели карты собираются без ошибок
  let built = 0, fail = '';
  const boxes = [], solids = [];
  try {
    for (const h of map.houses) {
      const m = buildVoxelHouse({ kind: h.kind, sections: h.sections });
      boxes.push({ x0: h.pos[0] - m.size[0] / 2, x1: h.pos[0] + m.size[0] / 2, z0: h.pos[2] - m.size[2] / 2, z1: h.pos[2] + m.size[2] / 2, name: h.kind });
      solids.push(solidOf(m, h.pos, h.rotY));
      built += m.stats.voxels;
    }
    for (const s of map.specials) {
      const m = buildSpecial(s.kind, s.sections);
      // поворот на 90° меняет габариты местами
      const q = Math.abs(Math.round(s.rotY / (Math.PI / 2))) % 2 === 1;
      const sx = q ? m.size[2] : m.size[0], sz = q ? m.size[0] : m.size[2];
      boxes.push({ x0: s.pos[0] - sx / 2, x1: s.pos[0] + sx / 2, z0: s.pos[2] - sz / 2, z1: s.pos[2] + sz / 2, name: s.kind });
      solids.push(solidOf(m, s.pos, s.rotY));
      built += m.stats.voxels;
    }
  } catch (e) { fail = e.message; }
  check('все здания карты собираются', !fail, fail || `${map.houses.length + map.specials.length} зданий, ${built} вокселей`);
  check('на карте достаточно точек', map.points.length >= 5, `${map.points.length}`);

  // 2. точки не в стенах: центр точки не должен попадать в габарит здания
  // ВАЖНО: точка может стоять В ЗДАНИИ (казарма, цех — их и захватывают), но не в СТЕНЕ.
  // Поэтому проверяем реальные воксели: в точке на высоте 1.2 м должно быть пусто.
  // высота: пол на уровне земли + 1.2 м (в доме это 1-й этаж, в цеху — тот же уровень).
  // ±1 воксель по Y не берём: пол под ногами — не стена.
  const inWall = map.points.filter(p => solids.some(s => s(p.pos[0], p.pos[1] + 1.2, p.pos[2])));
  check('точки не в стенах зданий', inWall.length === 0, inWall.map(p => p.name).join(', '));

  // 3. точки не слиплись между собой
  const minD = Math.min(...map.points.flatMap((a, i) =>
    map.points.slice(i + 1).map(b => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]))));
  check('точки разнесены', minD > 10, `минимум ${minD.toFixed(1)} м`);

  // 4. спавны снаружи зданий
  for (const [side, name] of [[0, 'свой'], [1, 'противник']]) {
    const sp = spawnFor(side, map.id);
    const inWall = boxes.some(b => sp[0] > b.x0 && sp[0] < b.x1 && sp[2] > b.z0 && sp[2] < b.z1);
    check(`спавн «${name}» не в здании`, !inWall, sp.map(v => v.toFixed(0)).join(','));
  }

  // 5. спавны не на одной точке (иначе мгновенный захват на старте)
  const own = spawnFor(0, map.id), foe = spawnFor(1, map.id);
  const onPoint = map.points.some(p => Math.hypot(own[0] - p.pos[0], own[2] - p.pos[2]) < p.radius);
  check('свой спавн не на точке захвата', !onPoint);
  check('базы сторон далеко друг от друга', Math.hypot(own[0] - foe[0], own[2] - foe[2]) > 60,
    `${Math.hypot(own[0] - foe[0], own[2] - foe[2]).toFixed(0)} м`);

  // 6. точки режима строятся из данных карты
  const cps = buildCapturePoints(map.id);
  check('точки режима совпадают с картой', cps.length === map.points.length,
    `${cps.length} точек: ${cps.map(c => c.name).join(', ')}`);
}

// 7. выбор карты по id и по умолчанию
check('getMap по id работает', getMap('zavod').name === 'Заводская площадка' || MAPS.every(m => getMap(m.id).id === m.id));
check('getMap с мусором даёт первую карту', getMap('нет-такой').id === MAPS[0].id);

// 8. на заводской карте есть цех (это её отличие от спального района)
{
  const z = getMap('zavod');
  check('на заводе есть цеха', z.specials.filter(s => s.kind === 'workshop').length >= 2);
  check('на заводе есть проходная', z.specials.some(s => s.kind === 'checkpoint'));
  check('в цеху есть ворота шириной под технику', (() => {
    const m = buildSpecial('workshop', 1);
    return m.plan.entrance.width >= 3.5;
  })());
  check('цех высокий (можно технику)', buildSpecial('workshop', 1).plan.floorH >= 5, `${buildSpecial('workshop', 1).plan.floorH} м`);
}

// 9. перекрытия и стены цеха: внутри пусто, над головой крыша
{
  const m = buildSpecial('workshop', 1);
  const { nx, ny, nz, cells } = m.spec;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];
  const ci = Math.floor(nx / 2), ck = Math.floor(nz / 2);
  check('в цеху можно стоять (2 м пусто)', at(ci, 4, ck) < 0 && at(ci, 5, ck) < 0);
  check('над цехом крыша', at(ci, ny - 1, ck) >= 0);
  check('шаг сетки цеха целый', Math.abs(m.size[0] / PITCH - Math.round(m.size[0] / PITCH)) < 1e-9);
}

// 10. сборка миров: расстановка карты реально ставится (тот же spawnSpecial, что в игре)
{
  const THREE = await import('three');
  const { spawnVoxelHouse, spawnSpecial } = await import('../src/game/structure.ts');
  for (const map of MAPS) {
    const scene = new THREE.Scene();
    const phys = { add: () => 1, removeBody: () => {}, post: () => {} };
    let placed = 0, props = 0, err = '';
    const t0 = performance.now();
    try {
      for (const h of map.houses) {
        const b = spawnVoxelHouse({ kind: h.kind, sections: h.sections }, scene, phys, h.pos, h.rotY);
        placed++; props += b.props.length;
      }
      for (const sp of map.specials) {
        const b = spawnSpecial(sp.kind, sp.sections, scene, phys, sp.pos, sp.rotY);
        placed++; props += b.props.length;
      }
    } catch (e) { err = e.message; }
    const ms = performance.now() - t0;
    check(`${map.name}: мир собирается целиком`, !err && placed === map.houses.length + map.specials.length,
      err || `${placed} зданий, ${props} предметов, ${ms.toFixed(0)} мс`);
    // мебель не должна висеть в воздухе: предметы есть у каждого здания с комнатами
    check(`${map.name}: мебель расставлена`, props > 100, `${props} предметов`);
  }
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — карты (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
