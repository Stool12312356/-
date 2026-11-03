// Баллистика в собранном физическом воркере, а не копия алгоритма.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ricochetChance, penetrationResult, WEAPONS } from '../src/game/weapons.ts';

assert.equal(ricochetChance('metal', 0), 0, 'в лоб не рикошетит');
assert.equal(ricochetChance('metal', 60), 0, 'не скользящий угол');
assert.ok(ricochetChance('metal', 89) > 0.7, 'скользящий удар о металл');
assert.equal(ricochetChance('wood', 60), 0);
for (const w of WEAPONS.filter(w => !w.explosive)) {
  assert.equal(penetrationResult(w.penetration, 'concrete', 0).penetrated, false, `${w.id}: бетон останавливает пулю`);
  assert.equal(penetrationResult(w.penetration, 'armor', 0).penetrated, false, `${w.id}: броня останавливает пулю`);
}
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
let readyResolve, readyReject;
const ready = new Promise((r, j) => { readyResolve = r; readyReject = j; });
const impacts = [];
let freeTracer;
worker.on('error', readyReject);
worker.on('message', m => { if (m.type === 'ready') readyResolve(); if (m.type === 'impacts') impacts.push(...m.impacts); if (m.type === 'tracers') freeTracer = m.tracers.find(t => t.id === 500) ?? freeTracer; });
const delay = ms => new Promise(r => setTimeout(r, ms));
const wall = (id, pos, he, surface) => ({ id, kind: 'static', pos, surface, shapes: [{ t: 'box', he }] });
const shot = (id, pos, vel, penetration = 2.4) => ({ type: 'shoot', tracer: { id, pos, prev: pos, vel, life: 2, bc: 1, penetration, owner: 0 } });
try {
  await ready;
  worker.postMessage({ type: 'addBodies', bodies: [
    // Две 10-см перегородки с 10-см зазором: раньше прыжок на 35 см пропускал вторую.
    wall(1, [5, 1.5, 0], [0.05, 1, 1], 'wood'),
    wall(2, [5.2, 1.5, 0], [0.05, 1, 1], 'plaster'),
    wall(3, [10, 1.5, 0], [0.1, 1, 1], 'armor'),
    wall(8, [5, 1.5, -5], [0.6, 1, 1], 'wood'),
    wall(9, [10, 1.5, -5], [0.1, 1, 1], 'armor'),
    // Отдельная полоса для выстрелов в лоб по бетону, ловушка позади стрелка.
    wall(4, [5, 1.5, 5], [0.1, 1, 1], 'concrete'),
    wall(5, [-2, 1.5, 5], [0.1, 1, 1], 'dirt'),
    // Скользящее попадание по металлу; слева ловушка отражённой пули.
    wall(6, [5, 1.5, 30], [0.05, 1, 20], 'metal'),
    wall(7, [3, 1.5, 35], [0.1, 1, 10], 'dirt'),
  ] });
  await delay(200); // Rapier обновляет query pipeline на шаге мира
  worker.postMessage(shot(1, [0, 1.5, 0], [900, 0, 0]));
  worker.postMessage(shot(2, [0, 1.5, -5], [315, 0, 0]));
  worker.postMessage(shot(500, [0, 100, -15], [300, 0, 0]));
  for (let i = 0; i < 30; i++) worker.postMessage(shot(100 + i, [0, 1.5, 5], [830, 0, 0], 4.2));
  const a = 10 * Math.PI / 180;
  for (let i = 0; i < 30; i++) worker.postMessage(shot(200 + i, [4, 1.5, 20], [900 * Math.sin(a), 0, 900 * Math.cos(a)], 0.1));
  await delay(500);
  const thin = impacts.filter(i => i.tracer === 1);
  assert.deepEqual(thin.map(i => i.bodyId), [1, 2, 3], `две близкие перегородки и броня: ${JSON.stringify(thin)}`);
  assert.deepEqual(thin.map(i => i.penetrated), [true, true, false]);
  assert.ok(thin[0].damage > thin[1].damage, 'после пробития энергия снижается');
  assert.deepEqual(impacts.filter(i => i.tracer === 2).map(i => i.bodyId), [8, 9], 'толстый коллайдер не считается повторными попаданиями');
  assert.ok(freeTracer && freeTracer.pos[0] > 10 && freeTracer.pos[1] < 100 && freeTracer.vel[0] < 300, 'снаряд реально летит, падает и тормозится');
  const normal = impacts.filter(i => i.tracer >= 100 && i.tracer < 130);
  assert.equal(normal.filter(i => i.bodyId === 4 && !i.penetrated).length, 30, 'все пули остановились в бетоне');
  assert.equal(normal.filter(i => i.bodyId === 5).length, 0, 'от лобового попадания нет рикошетов');
  const grazing = impacts.filter(i => i.tracer >= 200);
  assert.equal(grazing.filter(i => i.bodyId === 6).length, 30, 'все попали по металлу');
  assert.ok(grazing.some(i => i.bodyId === 7), `часть пуль физически отражается: ${JSON.stringify(grazing)}`);
  console.log('ИТОГ: OK — реальный воркер: пробитие близких перегородок, бетон и скользящий рикошет');
} finally { await worker.terminate(); }
