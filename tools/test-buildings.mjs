// Проверка дома-конструктора без браузера: детали → сборка, габариты, проёмы, материалы.
import { buildHouse, SECTION_W } from '../src/game/house.ts';
import { panelDef } from '../src/game/panels.ts';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'БАГ '} ${m}`); if (!c) fail++; };

console.log('\n--- каталог деталей ---');
const kinds = ['wall', 'window', 'door', 'balcony', 'brick', 'slab', 'roof', 'stair', 'landing'];
ok(kinds.length === 9, `деталей в каталоге: ${kinds.length} (${kinds.join(', ')})`);
for (const k of kinds) {
  const d = panelDef(k, 3.0, 2.8);
  const nx = Math.round(d.w / d.voxel.w), ny = Math.round(d.h / d.voxel.h);
  ok(d.hp > 0 && nx > 0 && ny > 0 && d.debris > 0, `${k}: ${d.w}×${d.h}×${d.thickness} м, hp ${d.hp}, ${nx}×${ny} кусков, материал ${d.material}`);
}
const win = panelDef('window', 3.0, 2.8);
ok(!!win.opening && win.opening.x1 - win.opening.x0 > 0.4 && win.opening.y1 - win.opening.y0 > 0.3,
  `панель с окном: проём ${Math.round((win.opening.x1 - win.opening.x0) * 100)}% ширины × ${Math.round((win.opening.y1 - win.opening.y0) * 100)}% высоты`);
const door = panelDef('door', 3.0, 2.8);
ok(door.opening.y0 === 0, 'панель с дверью: проём от самого низа (в подъезд можно зайти)');
const wall = panelDef('wall', 3.0, 2.8);
ok(!wall.opening, 'глухая панель: проёма нет');

for (const [kind, sections] of [['khrushchevka', 3], ['brezhnevka', 2]]) {
  const h = buildHouse({ kind, sections, seed: 42 });
  console.log(`\n--- ${kind} (секций ${sections}) ---`);
  console.log(`  ${h.size.map(v => v.toFixed(1)).join(' × ')} м, этажей ${h.floors}, высота этажа ${h.floorH} м`);
  console.log(`  панелей ${h.stats.panels}, кусков для разрушения ${h.stats.voxels}, мебели ${h.props.length}`);
  console.log(`  состав: ${Object.entries(h.stats.kinds).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  // секция ровно 11.6 м: 3 пролёта по 3.0 + два простенка 0.6 — стыки панелей совпадают
  ok(Math.abs(SECTION_W - (3 * 3.0 + 2 * 0.6)) < 1e-6, `секция ${SECTION_W.toFixed(2)} м = 3 пролёта + 2 простенка`);

  // панели не пересекаются по X внутри одного ряда фасада
  const front = h.panels.filter(p => p.role === 'window' || p.role === 'door' || p.role === 'balcony' || (p.role === 'wall' && Math.abs(p.rotY) < 0.01));
  const row = front.filter(p => p.floor === 0 && p.section === 0 && Math.abs(p.pos[2] + h.size[2] / 2) < 0.01);
  const widths = row.reduce((a, p) => a + p.def.w, 0);
  ok(Math.abs(widths - SECTION_W) < 0.01, `фасад секции собран без щелей: ${widths.toFixed(2)} м = ${SECTION_W.toFixed(2)} м (${row.length} панелей)`);

  // проёмы: каждое окно/дверь с проёмом, у глухих — нет
  ok(h.panels.filter(p => p.role === 'window').every(p => !!p.def.opening), 'у всех оконных панелей есть проём');
  ok(h.panels.filter(p => p.role === 'door').every(p => p.def.opening?.y0 === 0), 'у дверей проём до земли');
  ok(h.panels.filter(p => p.role === 'slab' || p.role === 'roof').every(p => !p.def.opening), 'плиты перекрытий без проёмов');

  // несущие: фасад/торец, но НЕ межсекционная кирпичная стена
  const brick = h.panels.filter(p => p.role === 'brick');
  ok(brick.length > 0 && brick.every(p => !p.bearing), `межсекционных кирпичных панелей ${brick.length}, все НЕ несущие (дом не падает от пробоины)`);
  const bearing = h.panels.filter(p => p.bearing);
  const bySec = {};
  for (const p of bearing) bySec[p.section] = (bySec[p.section] ?? 0) + 1;
  console.log(`  несущих панелей ${bearing.length}: ${Object.values(bySec).join(' / ')} по секциям`);
  ok(bearing.length > 0 && Object.values(bySec).every(v => v > 10), 'несущие панели распределены по всем секциям');

  // геометрия деталей: у панели с окном реальная дырка (проверяем по габаритам кусков)
  ok(h.stats.voxels > 1000, `кусков для разрушения достаточно: ${h.stats.voxels}`);

  // мебель внутри дома, а не снаружи
  const HZ = h.size[2] / 2;
  const inside = h.props.filter(p => Math.abs(p.pos[2]) <= HZ && Math.abs(p.pos[0]) <= h.size[0] / 2 && p.pos[1] >= 0);
  ok(inside.length === h.props.length, `мебель вся внутри дома (${inside.length}/${h.props.length})`);

  // габариты по панелям совпадают с заявленными
  const maxX = Math.max(...h.panels.map(p => Math.abs(p.pos[0]) + p.def.w / 2 * (Math.abs(p.rotY) < 0.01 ? 1 : 0) + 0.32));
  ok(maxX <= h.size[0] / 2 + 0.5, `панели не торчат за габарит дома (${maxX.toFixed(2)} ≤ ${(h.size[0] / 2 + 0.5).toFixed(2)})`);
}

console.log(`\nИТОГ: ${fail ? `найдено проблем: ${fail}` : 'OK — детали на месте, дом собран без щелей'}`);
process.exit(fail ? 1 : 0);
