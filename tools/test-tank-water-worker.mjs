// Полный сценарий в собранном физическом воркере: сесть, затонуть или выйти вовремя.
// Перед запуском выполнить vite build.
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
const delay = ms => new Promise(r => setTimeout(r, ms));
async function scenario(evacuate) {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
    workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
  });
  let vehicle, player, resolveReady, rejectReady, resolveSunk, rejectSunk;
  const ready = new Promise((r, j) => { resolveReady = r; rejectReady = j; });
  const sunk = new Promise((r, j) => { resolveSunk = r; rejectSunk = j; });
  worker.on('error', e => { rejectReady(e); rejectSunk(e); });
  worker.on('message', m => {
    if (m.type === 'ready') resolveReady();
    if (m.type === 'vehicle') vehicle = m;
    if (m.type === 'snapshot') player = m.player;
    if (m.type === 'vehicleSunk') resolveSunk(m);
  });
  try {
    await ready;
    const spec = vehicleById('t72');
    worker.postMessage({ type: 'water', water: { level: 0, x0: -10, x1: 10, z0: -30, z1: 30, depth: 5 } });
    worker.postMessage({ type: 'addBodies', bodies: [
      { id: 2, kind: 'static', pos: [0, -5.5, 0], shapes: [{ t: 'box', he: [100, 0.5, 100] }] },
      { id: 3, kind: 'static', pos: [20, -0.5, 0], shapes: [{ t: 'box', he: [5, 0.5, 5] }] },
    ] });
    worker.postMessage({ type: 'addVehicle', v: { ...spec, id: 1, specId: spec.id, pos: [0, 0.5, 0], yaw: 0 } });
    worker.postMessage({ type: 'spawnPlayer', pos: [1, 0, 0] });
    worker.postMessage({ type: 'enterVehicle', id: 1 });
    worker.postMessage({ type: 'hurt', damage: 30 });
    await delay(2200);
    assert.ok(vehicle?.sinkRemaining > 6 && vehicle.sinkRemaining < 9, `виден обратный отсчёт: ${vehicle?.sinkRemaining}`);
    assert.ok(vehicle.pos[1] < 0.5, 'танк погружается');
    if (evacuate) {
      worker.postMessage({ type: 'spawnPlayer', pos: [20, 0, 0], preserve: true });
      worker.postMessage({ type: 'enterVehicle', id: -1 });
      await delay(400);
      assert.ok(player && player.pos[0] > 19, 'игрок вышел из танка');
      assert.ok(player.hp <= 70.1, `эвакуация не лечит игрока: HP ${player.hp}`);
    }
    const event = await Promise.race([sunk, delay(14000).then(() => { throw new Error('танк не затонул'); })]);
    assert.equal(event.passengerLost, !evacuate, 'последствия для экипажа зависят от эвакуации');
    await delay(100);
    assert.equal(vehicle?.sunk, true);
    assert.equal(vehicle?.damaged.engine, true);
    if (evacuate) assert.ok(player?.pos[0] > 19, 'вышедший игрок не возвращается в затонувший танк');
    else assert.ok(player && Math.abs(player.pos[0] - 1) < 1, 'не эвакуировавшийся игрок возрождается на своей базе');
    console.log(`  ok: ${evacuate ? 'эвакуировался вовремя' : 'не успел эвакуироваться'}`);
  } finally { await worker.terminate(); }
}
await Promise.all([scenario(false), scenario(true)]);
console.log('ИТОГ: OK — затопление танка в воркере и эвакуация');
