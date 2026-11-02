// Проверка ВОКСЕЛЬНЫХ разрушений на реальном коде (voxel.ts + buildings.ts), без браузера.
import * as THREE from 'three';
import { buildBuilding } from '../src/game/buildings.ts';
import { VoxelBuilding } from '../src/game/voxel.ts';

const scene = new THREE.Scene();
let nextBody = 1;
const bodies = [], impulses = [];
const phys = {
  add(desc, obj) { const id = nextBody++; bodies.push({ id, desc, obj }); return id; },
  addBuilding(desc, panels) { const id = nextBody++; bodies.push({ id, desc, panels }); return id; },
  post(m) { if (m.type === 'impulse') impulses.push(m); },
};

const spec = buildBuilding({ kind: 'khrushchevka', sections: 2, seed: 11 });
const b = new VoxelBuilding(spec.walls, scene, phys, new THREE.Vector3(0, 0, 0));
// (в теле цикла переменная b не должна перекрываться)
b.register();
const total = b.cells.length;
console.log(`дом: блоков ${total} (стены ${spec.voxels.walls}, перекрытия ${spec.voxels.slabs})`);
console.log(`физика «пока цел»: ${bodies.length} тело, форм ${bodies[0].desc.shapes.length} — монолит`);
console.log(`несущих по секциям: ${[0, 1].map(s => b.structure(s) + '%').join(' / ')}`);

// 1) пуля
// ВАЖНО: у ячейки нет поля bearing/pos-копии — всё в сетке. Фильтруем по сетке.
const wall = b.cells.find(c => b.grids[c.wall] && !b.grids[c.wall].bearing);
if (!wall) { console.log('НЕТ ненесущей стены — проверьте классификацию сеток'); process.exit(1); }
const killed1 = b.damageAt(wall.p, 0.7, 1.5, { max: 3 });
console.log(`\nпуля (радиус 0.7, сила 1.5): разбито ${killed1} блок(ов)`);

// 2) РПГ
const before = total - b.cells.filter(c => c.alive).length;
const killed2 = b.damageAt(wall.p, 2.6, 3.2, { max: 90 });
const alive = b.cells.filter(c => c.alive).length;
console.log(`РПГ (радиус 2.6): разбито ${killed2}, всего целых ${alive}/${total}`);
console.log(`обломков создано: ${bodies.filter(x => x.desc.kind === 'dynamic').length}, импульсов ${impulses.length}`);

// 3) пересборка физики после разрушений
b.update(performance.now() + 1000);
const last = bodies.filter(x => x.desc.kind === 'static').pop();
console.log(`после пересборки: форм в коллайдере ${last.desc.shapes.length} (было 1)`);
console.log(`соседние целые блоки сохранили коллайдеры: ${last.desc.shapes.length > 1 ? 'да' : 'НЕТ'}`);

// 4) обвал секции
let guard = 0;
// Бьём по КОЛОННАМ секции 0 (как РПГ в игре: несколько попаданий в опоры).
const cols = b.cells.filter(c => b.grids[c.wall].column && b.grids[c.wall].section === 0);
console.log(`колонн в секции 0: ${b.columns(0).total}, бьём по ${Math.ceil(b.columns(0).total * 0.66)} из них`);
// порог 34% колонн: 28 подрывов × ~3 колонны = 84 > 53 нужных
while (!b.collapsed.has(0) && guard++ < 80) {
  // бьём по КОНКРЕТНОЙ ещё живой колонне, а не по массиву вслепую
  const w = cols.filter(c => c.alive)[0];
  if (!w) break;
  b.damageAt(w.p, 3.0, 3.2, { max: 120 });
  b.update(performance.now() + guard * 1000);
}
console.log(`\nпосле ${guard} подрывов: секция 0 → ${b.structure(0)}%, обрушена: ${b.collapsed.has(0)}`);
console.log(`несущая способность секции 1 не тронута: ${b.structure(1)}%`);

// 5) ГЛАВНОЕ: нет «просвечивающих» блоков — всё, что осталось, держится на земле
b.enforceSupport();
const st = b.supportStats();
console.log(`
опора после разрушений: живых ${st.alive}, на опоре ${st.supported}, висят ${st.floating}`);
console.log(`
ИТОГ: ${killed1 >= 1 && killed2 > 5 && b.collapsed.has(0) && b.structure(1) > 90 ? 'OK' : 'ПРОБЛЕМА'}`);
