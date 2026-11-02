// Проверка разрушений дома-конструктора без браузера (voxel.ts).
// Что проверяем: пробоина от пули, снос панели РПГ, обрушение секции по несущим панелям,
// и главное — что после всех разрушений НЕ ОСТАЁТСЯ висящих панелей.
import * as THREE from 'three';
import { buildHouse } from '../src/game/house.ts';
import { HousePanels } from '../src/game/voxel.ts';

const scene = new THREE.Scene();
let nextBody = 1;
const bodies = [];
const phys = {
  add(desc, obj) { const id = nextBody++; bodies.push({ id, desc, obj }); return id; },
  addBuilding(desc, panels) { const id = nextBody++; bodies.push({ id, desc, panels }); return id; },
  post() {},
};

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'БАГ '} ${m}`); if (!c) fail++; };

const spec = buildHouse({ kind: 'khrushchevka', sections: 2, seed: 11 });
const h = new HousePanels(spec.panels, scene, phys);
h.register();
console.log(`дом: панелей ${spec.stats.panels} (несущих ${h.columns(0).total} в секции 0), кусков ${spec.stats.voxels}`);
console.log(`физика «пока цел»: тел ${bodies.length}, форм в первом ${bodies[0].desc.shapes.length} — монолит, внутрь не залезть`);

// 1) пуля: пробоина в конкретной панели, но панель цела
const target = h.panels.find(p => p.role === 'window' && p.floor === 1 && p.section === 0);
const hpBefore = target.hp;
const hitPoint = [target.pos[0], target.pos[1], target.pos[2] - 0.2];
const k1 = h.damageAt(hitPoint, 0.55, 60, { max: 4 });
console.log(`\nпуля (радиус 0.55): выбито кусков ${k1}, hp панели ${hpBefore} → ${Math.round(target.hp)}, панель цела: ${!target.destroyed}`);
ok(k1 >= 1 && k1 <= 4, `пуля делает пробоину из 1–4 кусков (${k1})`);
ok(!target.destroyed, 'одна пуля не сносит панель целиком');

// 2) РПГ: панель сносится
const k2 = h.damageAt(hitPoint, 2.6, 300, { max: 40 });
console.log(`РПГ (радиус 2.6): выбито кусков ${k2}, панель снесена: ${target.destroyed}`);
ok(target.destroyed, 'РПГ сносит панель целиком');
ok(k2 >= 4, `РПГ выбивает кусок стены, а не один кусок (${k2})`);
ok(bodies.some(b => b.desc.kind === 'dynamic'), 'обломки стали физическими телами');

// 3) обрушение секции по НЕСУЩИМ панелям
const sec0 = h.columns(0);
console.log(`\nнесущих панелей секции 0: ${sec0.left}/${sec0.total} — обрушение при потере 66%`);
const bearing0 = h.panels.filter(p => p.bearing && p.section === 0 && !p.destroyed);
let guard = 0;
while (!h.collapsed.has(0) && guard < bearing0.length) {
  const p = bearing0[guard++];
  h.damageAt([p.pos[0], p.pos[1], p.pos[2]], 3.0, 400, { max: 60 });
}
const st0 = h.columns(0);
console.log(`после ${guard} подрывов: секция 0 → ${Math.round((st0.left / st0.total) * 100)}% (${st0.left}/${st0.total}), обрушена: ${h.collapsed.has(0)}`);
ok(h.collapsed.has(0), 'секция обрушилась после потери несущих панелей');
// соседняя секция не обрушена (её собственные несущие не трогали)
ok(!h.collapsed.has(1), 'соседняя секция не обрушена');

// 4) ГЛАВНОЕ: нет висящих панелей
const dropped = h.enforceSupport();
const sup = h.supportStats();
console.log(`\nпосле разрушений: живых панелей ${sup.alive}, упало без опоры ${dropped}, висят: ${sup.floating}`);
ok(sup.floating === 0, 'висящих панелей нет (всё, что осталось, стоит на опоре)');

// 5) пересборка рендера не падает и даёт ничтожное число мешей
h.update(performance.now() + 1000);
const meshes = h.group.children.filter(c => c.isMesh);
console.log(`рендер: ${meshes.length} меша на весь дом (по материалам), треугольников ~${meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0) | 0}`);
ok(meshes.length <= 12, `дом рисуется ${meshes.length} мешами (было 250+ отдельных панелей)`);

// 6) защита от мусора во входных данных
ok(h.damageAt('мусор', 1, 100) === 0, 'некорректная точка не роняет игру');

console.log(`\nИТОГ: ${fail ? `найдено проблем: ${fail}` : 'OK'}`);
process.exit(fail ? 1 : 0);
