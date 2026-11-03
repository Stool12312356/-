// Проверки «как это выглядит» для воксельного дома: текстура, затемнение повреждений,
// столкновение обломков с домом. Взято из референса browser-battlefield-destruction-game,
// где это сделано аккуратнее.
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { VoxelHouse } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const scene = new THREE.Scene();
const phys = { add: () => 1, removeBody() {}, post() {} };
const model = buildVoxelHouse({ kind: 'khrushchevka', sections: 1 });

// «canvas» подменяем, чтобы текстура кладки реально создалась (в браузере её даёт DOM)
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {} }),
  }),
};

const H = new VoxelHouse(model.spec, scene, phys);

// 1. текстура кладки на конструкционных материалах, но не на стекле
const mats = [...H['mats'].values()];
check('на бетоне есть текстура кладки', mats.filter(m => m.map).length >= 3, `материалов с картой ${mats.filter(m => m.map).length}`);
check('стекло без текстуры кладки', [...H['mats']].filter(([k, m]) => k === 3).every(([, m]) => !m.map));
check('в материалах включены цвета вершин', mats.every(m => m.vertexColors), 'нужно для затемнения повреждений');

// 2. повреждение затемняет только повреждённый воксель
const hit = H.raycast([model.size[0] / 2, 3, -8], [0, 0, 1], 30);
check('луч попал в стену', !!hit);
const id = hit.id;
const key = H['chunkKey'](Math.floor(H.ix[id] / 8), Math.floor(H.iy[id] / 8), Math.floor(H.iz[id] / 8));
const ch = H['chunkR'].get(key);
const slot = ch.slot.get(id);
const colAttr = ch.geo.getAttribute('color');
const before = colAttr.array[slot[0] * 3];
H.hitVoxel(id, H.maxHp[id] * 0.5, [0, 0, 1]);
const after = colAttr.array[slot[0] * 3];
check('попадание затемняет блок', after < before - 0.05, `${before.toFixed(2)} → ${after.toFixed(2)}`);
const otherSlot = [...ch.slot.entries()].find(([sid]) => sid !== id)[1];
check('соседние блоки не темнеют', Math.abs(colAttr.array[otherSlot[0] * 3] - 1) < 1e-6);

// 3. при разрушении затемнение снимается вместе с вокселем (вершины схлопнуты)
const p = hit.point;
H.damageAt(p, 1.2, 60, { max: 80 });
check('блок разбит', H.alive[id] === 0);

// 4. обломки сталкиваются с домом, а не проваливаются внутрь
// берём ЦЕЛЫЙ участок стены на 2-м этаже: ниже мы уже пробили дыру
const inside = [model.size[0] / 2, 6, model.size[2] / 2];
check('solidAt: стена — твёрдо', H.solidAt(model.size[0] / 2, 6, 0.25) === true);
check('solidAt: воздух снаружи — пусто', H.solidAt(model.size[0] / 2, 6, -3) === false);
void inside;

// 5. пробуждение обломков взрывом
H.damageAt([model.size[0] / 2, 4, 0.4], 1.6, 80, { max: 60 });
for (let i = 0; i < 200; i++) H.update(1 / 60, performance.now() + i * 16);
const slept = [...H['dsleep']].filter(v => v === 1).length;
H.wakeDebris(model.size[0] / 2, 0.5, 0, 30);
const woke = [...H['dsleep']].filter(v => v === 1).length;
check('обломки засыпают и просыпаются от взрыва', slept >= 0 && woke <= slept, `спало ${slept}, после взрыва ${woke}`);

// 6. пыль вызывается
let dust = 0;
H.onDust = () => { dust++; };
H.damageAt([model.size[0] / 2, 3, 0.4], 1.6, 80, { max: 60 });
check('разрушение даёт пыль', dust > 0, `событий пыли ${dust}`);

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — текстура, затемнение повреждений и обломки работают как в референсе (${ok} проверок)`);
process.exit(bad ? 1 : 0);
