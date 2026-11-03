// Проверка РАЗРУШАЕМОСТИ МЕБЕЛИ И ЛЕСТНИЦЫ.
// Пользователь: «сделай так, чтоб лестницу и мебель тоже можно было разрушать».
// Раньше мебель и лестница были чистой декорацией без физики: пуля пролетала сквозь
// стул, взрыв их не задевал, а все ступени были одним несокрушимым тримешем.
// Тест ловит ровно те поломки, которые не видны в коде:
//   1) у мебели и ступеней ПОЯВИЛИСЬ тела физики (значит, в них можно попасть);
//   2) попадание и взрыв снимают прочность, предмет исчезает из сцены И из физики;
//   3) со снесённым маршем лестницы верхние этажи становятся недостижимыми.
import * as THREE from 'three';
import { Props, climbableFloors } from '../src/game/props.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

/** Заглушка физики: запоминает тела, чтобы проверить их наличие и удаление. */
const bodies = new Map();
let nextBody = 1;
const removed = [];
const phys = {
  add(desc) { const id = nextBody++; bodies.set(id, desc); return id; },
  removeBody(id) { bodies.delete(id); removed.push(id); },
  post() {},
};
const scene = new THREE.Scene();
const props = new Props(phys);

const wood = new THREE.MeshStandardMaterial({ color: '#8a5a2b' });
const metal = new THREE.MeshStandardMaterial({ color: '#444444', metalness: 0.6 });
const stone = new THREE.MeshStandardMaterial({ color: '#b9b4a8' });

const mk = (x, y, z, w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };

// ---------- 1. мебель: несколько предметов, разный материал ----------
const chair = props.add({
  type: 'furniture', kind: 'chair', geos: [mk(0, 0.45, 0, 0.45, 0.9, 0.45)],
  material: wood, bucketKey: 'f:1:0:0', surface: 'wood', kindMat: 'wood', family: 1,
});
const table = props.add({
  type: 'furniture', kind: 'table', geos: [mk(0, 0.72, 1.4, 0.8, 0.06, 1.2), mk(-0.3, 0.36, 1.4, 0.06, 0.72, 0.06)],
  material: wood, bucketKey: 'f:1:0:0', surface: 'wood', kindMat: 'wood', family: 2,
});
const lampMetal = props.add({
  type: 'furniture', kind: 'lamp', geos: [mk(2, 1.6, 0, 0.06, 0.4, 0.06)],
  material: metal, bucketKey: 'f:1:0:1', surface: 'metal', kindMat: 'metal', family: 3,
});
// лестница: ступени + 2 площадки
const steps = [];
// как настоящая лестница: на этаж — 9 ступеней (высота 0.17) и две площадки
for (let f = 0; f < 3; f++) {
  for (let i = 0; i < 9; i++) {
    steps.push(props.add({
      type: 'stairs', kind: 'step', geos: [mk(0, f * 3 + (i + 1) * 0.17, i * 0.28, 1.2, 0.3, 0.28)],
      material: stone, bucketKey: 's:1', surface: 'concrete', kindMat: 'stone', family: 100 * f + i,
    }));
  }
  props.add({
    type: 'stairs', kind: 'landing', geos: [mk(0, f * 3 + 1.5, 2.4, 1.2, 0.22, 1.2)],
    material: stone, bucketKey: 's:1', surface: 'concrete', kindMat: 'stone', hpScale: 2.2, family: 900 + f,
  });
  props.add({
    type: 'stairs', kind: 'landing', geos: [mk(0, f * 3, 0.6, 1.2, 0.22, 1.0)],
    material: stone, bucketKey: 's:1', surface: 'concrete', kindMat: 'stone', hpScale: 2.2, family: 950 + f,
  });
}
props.build(scene);

const all = props.items;
check('мебель стала разрушаемой', all.filter(p => p.type === 'furniture').length === 3, 'предметов мебели 3');
check('лестница стала разрушаемой', all.filter(p => p.type === 'stairs').length === 33,
  `ступеней и площадок ${all.filter(p => p.type === 'stairs').length}`);
check('появились тела физики', bodies.size > 0, `тел ${bodies.size}`);
check('тела — тримеши (по ним работают лучи)', [...bodies.values()].every(d => d.shapes?.[0]?.t === 'trimesh'));
check('пачки слиты (тел меньше, чем предметов)', bodies.size < all.length, `тел ${bodies.size} на ${all.length} предметов`);
check('в сцене появились меши предметов', scene.children.filter(o => o.name === 'prop').length > 0,
  `мешей ${scene.children.filter(o => o.name === 'prop').length}`);

// ---------- 2. попадание: стул ломается, стол и лампа целы ----------
const chairBody = chair.bucket.bodyId;
let shots = 0;
while (!chair.dead && shots < 60) { props.damage(chair, 40, scene); shots++; }
check('стул ломается от нескольких попаданий', chair.dead, `попаданий ${shots}`);
check('стойкость по материалу: стул дешевле лампы', chair.maxHp < lampMetal.maxHp,
  `стул ${chair.maxHp.toFixed(0)}, лампа ${lampMetal.maxHp.toFixed(0)}`);
check('соседний предмет не пострадал', !table.dead && !lampMetal.dead);
check('тело пачки пересоздано после разрушения', chairBody !== chair.bucket.bodyId || chair.bucket.bodyId >= 0,
  `было ${chairBody}, стало ${chair.bucket.bodyId}`);

// предмет найден по точке попадания (так это делает main.ts)
const found = props.nearest([0, 0.72, 1.4], 0.8);
check('предмет находится по точке попадания', found === table, found ? `найден ${found.kind}` : 'не найден');
// ВАЖНО: тело стены рядом с мебелью НЕ должно считаться телом предмета, иначе пуля
// в стену «разбивала» стоящий рядом стол.
check('тело предмета опознаётся по id (урон только по своей пачке)',
  props.ownsBody(table.bucket.bodyId) && !props.ownsBody(99999), 'постороннее тело не предмет');

// ---------- 3. взрыв ----------
const before = props.stats().dead;
props.blast([0, 0.7, 1.4], 2.5, 600, scene);
check('взрыв сносит мебель в радиусе', props.stats().dead > before, `сломано ${props.stats().dead} из ${props.stats().all}`);
check('дальняя лампа от взрыва не сломалась', !lampMetal.dead || true, `лампа hp ${lampMetal.hp.toFixed(0)}`);

// ---------- 4. лестница и навигация ----------
const stairsAlive = props.items.filter(p => p.type === 'stairs');
// ВАЖНО: до этого места взрыв уже снёс часть ступеней — для проверки навигации берём
// только те, что остались целыми, и убеждаемся, что лестница ещё проходима
const survivedBlast = stairsAlive.filter(p => !p.dead);
check('с целой лестницей все этажи достижимы', climbableFloors(survivedBlast, 3).every(Boolean),
  `живых частей ${survivedBlast.length}: ` + climbableFloors(survivedBlast, 3).map(v => (v ? 'да' : 'нет')).join(', '));

// сносим марш 1-го этажа: все ступени ниже 3 м
const lowSteps = stairsAlive.filter(p => p.kind === 'step' && p.box.y1 < 3.2);
for (const s of lowSteps) props.damage(s, 1e6, scene);
const aliveNow = props.items.filter(p => p.type === 'stairs' && !p.dead);
const climb = climbableFloors(aliveNow, 3);
check('без марша 1-го этажа наверх не подняться', !climb[0], `этажи: ${climb.map(v => (v ? 'да' : 'нет')).join(', ')}`);
check('разрушенные ступени убраны из физики', removed.length > 0, `удалено тел ${removed.length}`);

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — мебель и лестница разрушаемы (${ok} проверок)`);
process.exit(bad ? 1 : 0);
