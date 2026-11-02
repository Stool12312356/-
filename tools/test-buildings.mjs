// Проверка процедурных домов без браузера: сколько панелей, несущих, мебели, габариты.
import { buildBuilding } from '../src/game/buildings.ts';
for (const [kind, sections] of [['khrushchevka', 3], ['brezhnevka', 2]]) {
  const b = buildBuilding({ kind, sections, seed: 42 });
  const lb = b.loadBearingBySection.map(s => s.length);
  const totalLb = lb.reduce((a, x) => a + x, 0);
  const byFloor = {};
  for (const p of b.panels) byFloor[p.floor] = (byFloor[p.floor] ?? 0) + 1;
  console.log(`\n${kind} (секций ${sections}): ${b.size.map(v => v.toFixed(1)).join(' × ')} м, этажей ${b.floors}`);
  console.log(`  панелей ${b.panels.length} (несущих ${totalLb}: ${lb.join('/')} по секциям)`);
  console.log(`  окон ${b.windows.length}, мебели ${b.props.length} (${[...new Set(b.props.map(p => p.kind))].join(', ')})`);
  console.log(`  панелей по этажам: ${Object.entries(byFloor).map(([f, n]) => `${f}:${n}`).join(' ')}`);
  const mats = {}; for (const p of b.panels) mats[p.material] = (mats[p.material] ?? 0) + 1;
  console.log(`  материалы: ${Object.entries(mats).map(([m, n]) => m + ':' + n).join(', ')}`);
  const hp = b.panels.map(p => p.hp);
  console.log(`  HP панелей: мин ${Math.min(...hp)} / средн ${(hp.reduce((a, x) => a + x, 0) / hp.length).toFixed(0)}`);
  // обрушение: сколько панелей надо снести, чтобы потерять 65% несущих
  const need = Math.ceil(totalLb * 0.65);
  console.log(`  обрушение секции наступает после ~${Math.ceil(lb[0] * 0.65)} снесённых несущих из ${lb[0]}`);
  void need;
}
