// Проверка ныряния настоящим собранным физическим воркером (сначала vite build).
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
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
let player, resolveReady, rejectReady;
const ready = new Promise((r, j) => { resolveReady = r; rejectReady = j; });
worker.on('error', rejectReady);
worker.on('message', m => { if (m.type === 'ready') resolveReady(); if (m.type === 'snapshot') player = m.player; });
const delay = ms => new Promise(r => setTimeout(r, ms));
const input = (changes = {}) => worker.postMessage({ type: 'input', input: {
  yaw: 0, pitch: 0, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, prone: false, dive: false, ...changes,
} });
try {
  await ready;
  worker.postMessage({ type: 'water', water: { level: 0, x0: -10, x1: 10, z0: -10, z1: 10, depth: 5 } });
  worker.postMessage({ type: 'addBodies', bodies: [{ id: 1, kind: 'static', pos: [0, -5.5, 0], shapes: [{ t: 'box', he: [50, 0.5, 50] }] }] });
  worker.postMessage({ type: 'spawnPlayer', pos: [0, -1.4, 0] });
  input();
  await delay(1000);
  assert.ok(player?.swimming, 'персонаж в воде');
  const startY = player.pos[1];
  input({ crouch: true, dive: true });
  await delay(2000);
  assert.ok(player.pos[1] < startY - 0.5, `Ctrl погружает: ${startY} → ${player.pos[1]}`);
  assert.equal(player.stance, 0, 'ныряние не переключает капсулу в присед');
  assert.equal(player.submerged, true, 'глаза под водой');
  assert.ok(player.oxygen < 90, `кислород расходуется: ${player.oxygen}`);
  const firstDeep = player.pos[1];
  input();
  await delay(3500);
  assert.ok(player.pos[1] > firstDeep + 0.3, 'без нажатий плавучесть поднимает игрока');
  input({ crouch: true, dive: true });
  await delay(1200);
  const minOxygen = player.oxygen, deepY = player.pos[1];
  input({ jump: true });
  await delay(3000);
  assert.ok(player.pos[1] > deepY + 0.5, `Space поднимает: ${deepY} → ${player.pos[1]}`);
  assert.equal(player.submerged, false, 'при всплытии голова над водой');
  assert.ok(player.oxygen > minOxygen, 'кислород восстанавливается');
  // На суше Ctrl по-прежнему приседает, а не включает плавание.
  worker.postMessage({ type: 'addBodies', bodies: [{ id: 2, kind: 'static', pos: [20, -0.5, 0], shapes: [{ t: 'box', he: [5, 0.5, 5] }] }] });
  worker.postMessage({ type: 'spawnPlayer', pos: [20, 0.05, 0] });
  input({ crouch: true, dive: true });
  await delay(600);
  assert.equal(player.swimming, false);
  assert.equal(player.stance, 1, 'Ctrl на суше — присед');
  console.log('ИТОГ: OK — ныряние, всплытие, кислород и присед на суше');
} finally { await worker.terminate(); }
