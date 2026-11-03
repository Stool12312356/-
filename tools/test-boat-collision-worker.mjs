// Проверка sweep-коллизии корпуса лодки в собранном физическом воркере.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { vehicleById } from '../src/game/vehicles.ts';
const bundle = (await readdir('dist/assets')).find(f => /^worker-.*\.js$/.test(f));
assert.ok(bundle, 'сначала выполните vite build');
const adapter = `import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
self.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on('message', data => self.onmessage?.({ data }));
await import(workerData.bundle);`;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function scenario(id, backwards) {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
    workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
  });
  let vehicle, resolveReady, rejectReady;
  const ready = new Promise((r, j) => { resolveReady = r; rejectReady = j; });
  worker.on('error', rejectReady);
  worker.on('message', m => { if (m.type === 'ready') resolveReady(); if (m.type === 'vehicle' && m.id === 1) vehicle = m; });
  try {
    await ready;
    const spec = vehicleById(id), sign = backwards ? -1 : 1;
    worker.postMessage({ type: 'water', water: { level: 0, x0: -50, x1: 50, z0: -50, z1: 50, depth: 5 } });
    worker.postMessage({ type: 'addBodies', bodies: [
      { id: 2, kind: 'static', pos: [0, -5.5, 0], shapes: [{ t: 'box', he: [100, 0.5, 100] }] },
      { id: 3, kind: 'static', pos: [0, 0, sign * 8], shapes: [{ t: 'box', he: [10, 3, 0.5] }] },
    ] });
    worker.postMessage({ type: 'addVehicle', v: { ...spec, id: 1, specId: spec.id, pos: [0, 0, 0], yaw: 0 } });
    worker.postMessage({ type: 'drive', id: 1, throttle: sign, steer: 0, handbrake: false });
    await wait(5500);
    const distance = sign * vehicle.pos[2];
    assert.ok(distance > 0.5, `${id}: лодка не двигается к стене`);
    assert.ok(distance <= 7.5 - spec.size[2] / 2 + 0.08, `${id}: корпус прошёл сквозь стену, z=${vehicle.pos[2]}`);
    const before = vehicle.pos[2];
    worker.postMessage({ type: 'drive', id: 1, throttle: -sign, steer: 0, handbrake: false });
    await wait(2500);
    assert.ok(sign * (vehicle.pos[2] - before) < -0.4, `${id}: лодка не может отойти от стены`);
    console.log(`  ok ${id}: ${backwards ? 'столкновение кормой' : 'столкновение носом'}, отход`);
  } finally { await worker.terminate(); }
}
async function sidewaysAndSlide() {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
    workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
  });
  let vehicle, resolveReady, rejectReady;
  const ready = new Promise((r, j) => { resolveReady = r; rejectReady = j; });
  worker.on('error', rejectReady);
  worker.on('message', m => { if (m.type === 'ready') resolveReady(); if (m.type === 'vehicle' && m.id === 1) vehicle = m; });
  try {
    await ready;
    const spec = vehicleById('assault_boat');
    const water = { level: 0, x0: -50, x1: 50, z0: -50, z1: 50, depth: 5, flow: [3, 0] };
    worker.postMessage({ type: 'water', water });
    worker.postMessage({ type: 'addBodies', bodies: [
      { id: 2, kind: 'static', pos: [0, -5.5, 0], shapes: [{ t: 'box', he: [100, 0.5, 100] }] },
      { id: 3, kind: 'static', pos: [3, 0, 0], shapes: [{ t: 'box', he: [0.5, 3, 30] }] },
    ] });
    worker.postMessage({ type: 'addVehicle', v: { ...spec, id: 1, specId: spec.id, pos: [0, 0, 0], yaw: 0 } });
    await wait(4500);
    assert.ok(vehicle.pos[0] > 0.6 && vehicle.pos[0] < 1.68, `борт не проходит стену: x=${vehicle.pos[0]}`);
    const z = vehicle.pos[2];
    worker.postMessage({ type: 'drive', id: 1, throttle: 1, steer: 0, handbrake: false });
    await wait(2500);
    assert.ok(vehicle.pos[0] < 1.68 && vehicle.pos[2] > z + 1, 'корпус скользит вдоль стены');
    worker.postMessage({ type: 'water', water: { ...water, flow: [-3, 0] } });
    await wait(2200);
    assert.ok(vehicle.pos[0] < 1.1, 'лодка может отойти бортом от стены');
    console.log('  ok столкновение бортом и скольжение вдоль стены');
  } finally { await worker.terminate(); }
}
await Promise.all([scenario('assault_boat', false), scenario('assault_boat', true), scenario('pubg_boat', false), sidewaysAndSlide()]);
console.log('ИТОГ: OK — столкновения лодок с препятствиями');
