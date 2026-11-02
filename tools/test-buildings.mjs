// Проверка процедурных домов без браузера: сколько панелей, несущих, мебели, габариты.
import { buildBuilding } from '../src/game/buildings.ts';
for (const [kind, sections] of [['khrushchevka', 3], ['brezhnevka', 2]]) {
  const b = buildBuilding({ kind, sections, seed: 42 });
  const bearing = b.walls.filter(w => w.bearing);
  const bySec = {};
  for (const w of bearing) bySec[w.section] = (bySec[w.section] ?? 0) + 1;
  const totalLb = bearing.length;
  const byFloor = {};
  for (const p of b.walls) byFloor[p.floor] = (byFloor[p.floor] ?? 0) + 1;
  console.log(`\n${kind} (секций ${sections}): ${b.size.map(v => v.toFixed(1)).join(' × ')} м, этажей ${b.floors}`);
  console.log(`  блоков ${b.walls.length} (стены ${b.voxels.walls}, перекрытия ${b.voxels.slabs}; несущих ${totalLb}: ${Object.values(bySec).join('/')} по секциям)`);
  console.log(`  окон ${b.windows.length}, мебели ${b.props.length} (${[...new Set(b.props.map(p => p.kind))].join(', ')})`);
  console.log(`  панелей по этажам: ${Object.entries(byFloor).map(([f, n]) => `${f}:${n}`).join(' ')}`);
  const mats = {}; for (const p of b.walls) mats[p.material] = (mats[p.material] ?? 0) + 1;
  console.log(`  материалы: ${Object.entries(mats).map(([m, n]) => m + ':' + n).join(', ')}`);
  // объём геометрии: важно для FPS (инстансинг тянет десятки тысяч блоков)
  const colWalls = b.walls.filter(w => w.column);
  const cols = {}; for (const w of colWalls) cols[w.section] = (cols[w.section] ?? 0) + 1;
  console.log(`  колонн: ${colWalls.length} (${Object.values(cols).join('/')} по секциям) — обрушение при потере 66%`);
  console.log(`  общий объём блоков в сцене: ${b.walls.length} (инстансинг: ${Object.keys(mats).length} меша по материалам)`);
}
