// Проверка разрушений на РЕАЛЬНОМ коде (damage.ts + buildings.ts), без браузера и без WebGL.
// Подменяем физику заглушкой: важно, что панели уничтожаются, обломки создаются,
// а несущая способность секции считается правильно.
import * as THREE from 'three';
import { buildBuilding } from '../src/game/buildings.ts';
import { Building } from '../src/game/damage.ts';

const scene = new THREE.Scene();
let nextBody = 1;
const removed = [], impulses = [], bodies = [];
const phys = {
  add(desc, obj) { const id = nextBody++; bodies.push({ id, desc, obj }); return id; },
  addBuilding(desc, panels) { const id = nextBody++; bodies.push({ id, desc, panels }); return id; },
  removePanel(id, panel) { removed.push(`${id}:${panel}`); },
  post(m) { if (m.type === 'impulse') impulses.push(m); if (m.type === 'removeBody') removed.push('body:' + m.id); },
};

const spec = buildBuilding({ kind: 'khrushchevka', sections: 1, seed: 7 });
const origin = new THREE.Vector3(0, 0, 0);
const b = new Building(spec, 'khrushchevka', origin, 0);
b.register(phys);
console.log(`дом: панелей ${spec.panels.length}, физ. сущностей ${bodies.length}, форм в теле ${bodies[0].desc.shapes.length}`);
console.log(`несущих по секциям: ${b.structure.join(' | ')}`);

// Проверяем баланс на САМОЙ СЛАБОЙ панели (оконная перемычка), а не на несущей
// (несущую и должно сносить только взрывом).
const weakest = spec.panels.map((p, i) => [p.hp, i]).sort((a, b) => a[0] - b[0])[0];
const wi = weakest[1];
let wn = 0; let wk = false;
while (!wk && wn < 200) { wk = b.damagePanel(wi, 26, scene, phys); wn++; }
const avg = spec.panels.reduce((a, p) => a + p.hp, 0) / spec.panels.length;
let an = 0; let ak = false;
const ai = spec.panels.findIndex((p, i) => p.hp > avg * 0.95 && !p.loadBearing && i !== wi);
while (!ak && an < 200) { ak = b.damagePanel(ai, 26, scene, phys); an++; }
console.log(`выстрелов на слабую панель (HP ${weakest[0]}): ${wn} | на ненесущую средней прочности (HP ${spec.panels[ai].hp}): ${an}`);
console.log(`(в BF-стиле стена должна поддаваться за 5-15 попаданий или за 1 РПГ)`);

// 1) один автоматный выстрел не должен сносить панель
const firstLoad = spec.loadBearingBySection[0][0];
const hp0 = spec.panels[firstLoad].hp;
let killed = b.damagePanel(firstLoad, 26, scene, phys);
console.log(`\nпуля (26 урона) в несущую с HP ${hp0}: уничтожена=${killed}`);

// 2) 20 выстрелов — должна сноситься
let n = 1;
while (!killed && n < 40) { killed = b.damagePanel(firstLoad, 26, scene, phys); n++; }
console.log(`понадобилось выстрелов: ${n} (ожидаемо ~${Math.ceil(hp0 / 26)})`);

// 3) обломки и снятие коллайдера
console.log(`обломков создано: ${bodies.filter(x => x.desc.kind === 'dynamic').length}, панелей снято из физики: ${removed.length}`);
console.log(`импульсов обломкам: ${impulses.length}`);

// 4) взрыв РПГ вплотную к дому должен выбить несколько панелей
const before = removed.length;
const kb = b.blast([0, 3, -5.5], 8, 950, scene, phys);
console.log(`\nРПГ вплотную к фасаду: снесено панелей ${kb}, всего снято ${removed.length - before}`);
// 5) добиваем несущие до обрушения
let guard = 0;
while (!b.structure.some(s => s.includes('ОБРУШЕНА')) && guard++ < 12) {
  b.blast([0, 3, -6], 60, 4000, scene, phys, 40);
}
console.log(`после ${guard} массированных взрывов: ${b.structure.join(' | ')}`);
console.log(`обломков всего: ${bodies.filter(x => x.desc.kind === 'dynamic').length} (лимит 260 на дом)`);
console.log(`\nИТОГ: ${removed.length > 3 && bodies.filter(x => x.desc.kind === 'dynamic').length > 3 ? 'OK' : 'ПРОБЛЕМА — разрушения не сработали'}`);
console.log('отладка: collapsed =', JSON.stringify(b.collapsed), 'loadLeft =', JSON.stringify([...b.structure]));
