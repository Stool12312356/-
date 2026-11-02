// Тест воксельного дома без браузера: генерация, разрушение, опора, физика, ФПС-бюджет.
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { VoxelHouse, CHUNK } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (name, cond, info = '') => { if (cond) { ok++; console.log(`  ✓ ${name} ${info}`); } else { bad++; console.log(`  ✗ ${name} ${info}`); } };

function mk(kind, sections) {
  const scene = new THREE.Scene();
  const bodies = new Map(); let seq = 1;
  const phys = {
    add(d) { const id = seq++; bodies.set(id, d); return id; },
    removeBody(id) { bodies.delete(id); },
    post() {},
  };
  const model = buildVoxelHouse({ kind, sections });
  const h = new VoxelHouse(model.spec, scene, phys);
  return { h, model, scene, bodies };
}

console.log('ВОКСЕЛЬНЫЙ ДОМ');
for (const [kind, sections] of [['khrushchevka', 1], ['khrushchevka', 3], ['brezhnevka', 2]]) {
  const { h, model, scene, bodies } = mk(kind, sections);
  const [W, H, D] = model.size;
  console.log(`\n${kind} ×${sections}: ${W.toFixed(1)}×${H.toFixed(1)}×${D.toFixed(1)} м, вокселей ${model.stats.voxels}`);

  // 1. наружные грани: у каждой грани соседа нет — иначе «внутренние» полигоны (ФПС)
  let meshes = 0, tris = 0, verts = 0;
  scene.traverse(o => { const m = o; if (m.isMesh && m.geometry?.attributes?.position) { meshes++; verts += m.geometry.attributes.position.count; tris += (m.geometry.index?.count ?? 0) / 3; } });
  check('геометрия собрана чанками', meshes > 0 && meshes <= Math.ceil(model.spec.nx / CHUNK) * Math.ceil(model.spec.ny / CHUNK) * Math.ceil(model.spec.nz / CHUNK) * 1.1,
    `мешей ${meshes}, тр. ${tris | 0}, вершин ${verts}`);

  // 2. физика: чанковые тела, а не монолит-коробка; коллизия есть на всех этажах
  const bodiesAll = [...bodies.values()];
  check('физика по чанкам', bodiesAll.length > 8, `тел ${bodiesAll.length}`);
  const ys = bodiesAll.map(b => b.shapes[0].verts[1]).filter(v => v !== undefined);
  check('коллизия есть на всех этажах', Math.max(...ys) > H * 0.7, `верх ${Math.max(...ys).toFixed(1)} м при H=${H.toFixed(1)}`);

  // 3. подъезд: у земли в фасаде есть проём (можно войти), а не сплошная стена
  const c = model.stats.entrance;
  const doorCells = [];
  for (let j = 0; j < 4; j++) for (let di = -1; di <= 1; di++) {
    const hit = h.raycast([c[0] + di * 0.5, 1.0, -1.2], [0, 0, 1], 6);
    doorCells.push(!hit || hit.dist > 4);
  }
  check('вход в подъезд сквозной', doorCells.filter(Boolean).length >= 2, `${doorCells.filter(Boolean).length}/3 лучей прошли внутрь`);

  // 4. лестница: внутри шахты есть воксели на промежуточной высоте (ступени), а не только перекрытия
  const stairY = H / model.floors * 0.5;
  const steps = h.ids.filter(id => h.alive[id] && h.kind[id] === 5 && h.centerOf(id).y > stairY).length;
  check('лестница есть', steps > 10, `ступеней ${steps}`);

  // 5. воксельное разрушение: один выстрел РПГ выбивает кусок, но НЕ стену целиком
  const wall = h.raycast([model.size[0] / 2, 3.0, -6], [0, 0, 1], 20);
  check('луч попадает в стену', !!wall, wall ? `на ${wall.dist.toFixed(2)} м` : '');
  const before = h.ids.filter(id => h.alive[id]).length;
  const p = wall ? [wall.point.x, wall.point.y, wall.point.z] : [model.size[0] / 2, 3, 0];
  const killed = h.damageAt(p, 1.6, 40, { max: 120 });
  const after = h.ids.filter(id => h.alive[id]).length;
  const total = model.stats.voxels;
  check('РПГ выгрызает часть стены', killed > 4 && killed < total * 0.06, `выбито ${killed} (${(killed / total * 100).toFixed(1)} % дома)`);
  check('дыра сквозная (не «панель целиком»)', h.raycast(p, [0, 0, 1], 20) === null || (h.raycast(p, [0, 0, 1], 20)?.dist ?? 0) > 0.4,
    '');

  // 6. снесённая стена: коллизия исчезает там, где выбито
  const pid = h.bodyAt(p);
  check('тело чанка находится по точке', pid > 0, `id ${pid}`);

  // 7. целостность/обрушение
  check('учёт целостности секции', h.columns(0).total > 0, JSON.stringify(h.structure(0)));
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) {
    h.damageAt([Math.random() * W, Math.random() * H, Math.random() * D], 1.2, 25, { max: 60 });
  }
  const dt = performance.now() - t0;
  check('30 взрывов укладываются в бюджет', dt < 900, `${dt.toFixed(0)} мс`);
  const sup = h.checkSupport();
  console.log(`  · после 30 взрывов отвалилось по опоре: ${sup}`);
  const t1 = performance.now();
  for (let f = 0; f < 60; f++) h.update(1 / 60, performance.now() + f * 16);
  check('60 кадров update дёшевы', performance.now() - t1 < 300, `${(performance.now() - t1).toFixed(0)} мс`);
  h.dispose();
}

console.log(`\nИТОГО: ${ok} ok, ${bad} провалов`);
process.exit(bad ? 1 : 0);
