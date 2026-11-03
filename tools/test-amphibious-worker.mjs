// Smoke-тест настоящего собранного Web Worker под Node worker_threads.
// Сначала: npx vite build. Адаптер только заменяет транспорт Web Worker.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { vehicleById } from '../src/game/vehicles.ts';

const files = await readdir('dist/assets');
const bundle = files.find(f => /^worker-.*\.js$/.test(f));
assert.ok(bundle, 'сначала выполните npx vite build');
const adapter = `import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
self.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on('message', data => self.onmessage?.({ data }));
await import(workerData.bundle);`;
const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
  workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
});
let latestVehicle, latestPlayer;
let initResolve, initReject;
const ready = new Promise((resolve, reject) => { initResolve = resolve; initReject = reject; });
worker.on('error', initReject);
worker.on('message', m => {
  if (m.type === 'ready') initResolve();
  if (m.type === 'vehicle') latestVehicle = m;
  if (m.type === 'snapshot') latestPlayer = m.player;
});
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  await Promise.race([ready, delay(15000).then(() => { throw new Error('воркер не запустился'); })]);
  const spec = vehicleById('btr80');
  worker.postMessage({ type: 'water', water: { level: 0, x0: -100, x1: 100, z0: -100, z1: 100, depth: 5 } });
  worker.postMessage({ type: 'addVehicle', v: { ...spec, id: 1, specId: spec.id, pos: [0, 0, 0], yaw: 0 } });
  worker.postMessage({ type: 'spawnPlayer', pos: [2, 0, 0] });
  worker.postMessage({ type: 'enterVehicle', id: 1 });
  await delay(3500);
  assert.ok(latestVehicle, 'нет состояния БТР из воркера');
  assert.ok(latestVehicle.pos[1] > -1 && latestVehicle.pos[1] < 0.2, `БТР не удержался на воде: y=${latestVehicle.pos[1]}`);
  const z = latestVehicle.pos[2];
  worker.postMessage({ type: 'drive', id: 1, throttle: 1, steer: 0, handbrake: false });
  await delay(3000);
  assert.ok(latestVehicle.pos[2] > z + 2, `БТР не движется по воде: z=${latestVehicle.pos[2]}`);
  assert.ok(latestPlayer && Math.abs(latestPlayer.pos[2] - latestVehicle.pos[2]) < 1, 'игрок едет в машине, а не остаётся сзади');
  console.log(`ИТОГ: OK — воркер: БТР держится на воде и едет с игроком (z=${latestVehicle.pos[2].toFixed(1)} м)`);
} finally {
  await worker.terminate();
}
