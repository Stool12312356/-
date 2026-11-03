// Настоящая геометрия VoxelHouse и настоящий production worker.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { VoxelHouse } from '../src/game/voxelhouse.ts';
const bundle = (await readdir('dist/assets')).find(f => /^worker-.*\.js$/.test(f));
assert.ok(bundle, 'сначала выполните vite build');
const adapter = `import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
self.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on('message', data => self.onmessage?.({ data }));
await import(workerData.bundle);`;
const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
  workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
});
const impacts = [];
let readyResolve, readyReject;
const ready = new Promise((r, j) => { readyResolve = r; readyReject = j; });
worker.on('error', readyReject);
worker.on('message', m => { if (m.type === 'ready') readyResolve(); if (m.type === 'impacts') impacts.push(...m.impacts); });
const delay = ms => new Promise(r => setTimeout(r, ms));
let nextId = 1;
const phys = { add: desc => { const id = nextId++; worker.postMessage({ type: 'addBodies', bodies: [{ ...desc, id }] }); return id; }, removeBody: id => worker.postMessage({ type: 'removeBody', id }), post: msg => worker.postMessage(msg) };
const nx = 12, ny = 1, nz = 3, ox = -3.15, oy = 1.05, oz = -3.3;
const cells = new Int8Array(nx * ny * nz).fill(-1);
const cell = (x, z) => z * nx + x;
// Стекло, дерево, кирпич и бетон в одном чанке без зазора.
[3, 4, 2, 0].forEach((kind, x) => { cells[cell(x, 0)] = kind; });
// Те же соседние материалы на стыке чанков 7/8: правильный материал с обеих сторон.
cells[cell(7, 2)] = 3; cells[cell(8, 2)] = 4; cells[cell(9, 2)] = 0;
const spec = { nx, ny, nz, ox, oy, oz, cells, sectionOf: new Uint8Array(cells.length), bearing: new Uint8Array(cells.length) };
const shoot = (id, startX, z, direction = 1) => worker.postMessage({ type: 'shoot', tracer: {
  id, pos: [startX, oy + 0.25, z], prev: [startX, oy + 0.25, z], vel: [direction * 830, 0, 0], life: 2, penetration: 4.2, owner: 0, bc: 1,
} });
const seen = id => impacts.filter(i => i.tracer === id);
try {
  await ready;
  const house = new VoxelHouse(spec, new THREE.Scene(), phys);
  await delay(220);
  shoot(1, ox - 2, oz + 0.25);
  shoot(2, ox + 2.5, oz + 1.25);
  shoot(3, ox + 5.8, oz + 1.25, -1);
  shoot(5, ox + 4.48, oz + 1.25, -1); // обратное пересечение стыка из дерева в стекло // бетон с обратной стороны останавливает пулю
  await delay(350);
  const one = seen(1), seam = seen(2), reverse = seen(3);
  assert.deepEqual(one.map(i => i.surface), ['glass', 'wood', 'brick', 'concrete'], `соседние материалы: ${JSON.stringify(one)}`);
  assert.deepEqual(one.map(i => i.penetrated), [true, true, true, false]);
  assert.deepEqual(seam.map(i => i.surface), ['glass', 'wood', 'concrete'], `стык чанков: ${JSON.stringify(seam)}`);
  assert.notEqual(seam[0].bodyId, seam[1].bodyId, 'материал найден в правильном чанке');
  assert.deepEqual(reverse.map(i => i.surface), ['concrete']);
  assert.deepEqual(seen(5).map(i => i.surface), ['glass'], `обратное пересечение: ${JSON.stringify(seen(5))}`);
  // Разбиваем стекло и пересоздаём реальные коллайдеры: индекс материалов не должен устареть.
  const glassId = house.raycast([ox - 2, oy + 0.25, oz + 0.25], [1, 0, 0], 10).id;
  house.hitVoxel(glassId, 100, [1, 0, 0]);
  house.update(1 / 60, 0); // как в игровом цикле: пересборка грязных чанков
  await delay(220);
  shoot(4, ox - 2, oz + 0.25);
  await delay(350);
  assert.deepEqual(seen(4).map(i => i.surface), ['wood', 'brick', 'concrete'], `после пересборки: ${JSON.stringify(seen(4))}`);
  // Удалённый сосед на стыке не должен оставаться в пространственном индексе.
  house.hitVoxel(house['idAt'](8, 0, 2), 100, [1, 0, 0]);
  house.update(1 / 60, 0);
  await delay(220);
  shoot(6, ox + 2.5, oz + 1.25);
  await delay(350);
  assert.deepEqual(seen(6).map(i => i.surface), ['glass', 'concrete'], `нет фантомного дерева после удаления: ${JSON.stringify(seen(6))}`);
  console.log('ИТОГ: OK — материалы реальных воксельных чанков, стыки и пересборка в воркере');
} finally { await worker.terminate(); }
