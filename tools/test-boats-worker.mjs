// Две настоящие лодки в собранном физическом воркере. Сначала выполнить vite build.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { BOATS } from '../src/game/vehicles.ts';
const bundle = (await readdir('dist/assets')).find(f => /^worker-.*\.js$/.test(f));
assert.ok(bundle, 'сначала выполните vite build');
const adapter = `import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
self.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on('message', data => self.onmessage?.({ data }));
await import(workerData.bundle);`;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function run(spec) {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
    workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
  });
  let vehicle, edgeBoat, player, resolveReady, rejectReady, waterTime = 0;
  const positionsY = [], tilts = [];
  const ready = new Promise((r, j) => { resolveReady = r; rejectReady = j; });
  worker.on('error', rejectReady);
  worker.on('message', m => {
    if (m.type === 'ready') resolveReady();
    if (m.type === 'vehicle' && m.id === 1) { vehicle = m; positionsY.push(m.pos[1]); tilts.push(Math.abs(m.pitch ?? 0) + Math.abs(m.roll ?? 0)); }
    if (m.type === 'vehicle' && m.id === 4) edgeBoat = m;
    if (m.type === 'snapshot') { player = m.player; waterTime = m.waterTime ?? 0; }
  });
  try {
    await ready;
    worker.postMessage({ type: 'water', water: { level: 0, x0: -30, x1: 30, z0: -30, z1: 30, depth: 5 } });
    worker.postMessage({ type: 'addBodies', bodies: [{ id: 2, kind: 'static', pos: [0, -5.5, 0], shapes: [{ t: 'box', he: [50, 0.5, 50] }] }] });
    worker.postMessage({ type: 'addVehicle', v: { ...spec, id: 1, specId: spec.id, pos: [0, 0, 0], yaw: 0 } });
    worker.postMessage({ type: 'spawnPlayer', pos: [2, 0, 0] });
    worker.postMessage({ type: 'enterVehicle', id: 1 });
    worker.postMessage({ type: 'hurt', damage: 30 });
    await wait(1500);
    assert.ok(vehicle && Math.abs(vehicle.pos[1]) < 0.5, `${spec.id}: не держится на воде`);
    assert.ok(Math.max(...positionsY) - Math.min(...positionsY) > 0.015, `${spec.id}: корпус поднимается и опускается на волнах`);
    assert.ok(Math.max(...tilts) > 0.003, `${spec.id}: корпус наклоняется на волнах`);
    assert.ok(waterTime > 1, 'воркер передаёт время волн для синхронизации рендера');
    assert.ok(player && Math.abs(player.pos[2] - vehicle.pos[2]) < 1, `${spec.id}: пассажир в лодке`);
    worker.postMessage({ type: 'drive', id: 1, throttle: 1, steer: 0, handbrake: false });
    const startZ = vehicle.pos[2];
    await wait(2600);
    assert.ok(vehicle.pos[2] > startZ + 2, `${spec.id}: тяга вперёд, z=${vehicle.pos[2]}`);
    assert.ok(Math.abs(player.pos[2] - vehicle.pos[2]) < 1, `${spec.id}: пассажир движется вместе с лодкой`);
    // Задний ход должен действительно менять направление движения, а не только
    // возвращать отрицательное ускорение из изолированной формулы.
    const reverseStart = vehicle.pos[2];
    worker.postMessage({ type: 'drive', id: 1, throttle: -1, steer: 0, handbrake: false });
    await wait(4000);
    assert.ok(vehicle.pos[2] < reverseStart - 0.2, `${spec.id}: задний ход z=${vehicle.pos[2]} вместо ${reverseStart}`);
    const startYaw = vehicle.yaw;
    worker.postMessage({ type: 'drive', id: 1, throttle: 1, steer: 1, handbrake: false });
    await wait(1200);
    assert.ok(vehicle.yaw < startYaw - 0.05, `${spec.id}: руль поворачивает`);
    worker.postMessage({ type: 'spawnPlayer', pos: [vehicle.pos[0] + 3, vehicle.pos[1] + 0.4, vehicle.pos[2]], preserve: true });
    worker.postMessage({ type: 'enterVehicle', id: -1 });
    await wait(500);
    assert.ok(player.hp <= 70.1, `${spec.id}: высадка не восстанавливает здоровье`);
    assert.ok(Math.abs(player.pos[0] - vehicle.pos[0]) > 1, `${spec.id}: пассажир вышел`);
    worker.postMessage({ type: 'addVehicle', v: { ...spec, id: 4, specId: spec.id, pos: [0, 0, 24.4], yaw: 0 } });
    worker.postMessage({ type: 'drive', id: 4, throttle: 1, steer: 0, handbrake: false });
    await wait(1800);
    assert.ok(edgeBoat && edgeBoat.pos[2] <= 24.501 && edgeBoat.pos[2] >= 24, `${spec.id}: граница водоёма`);
    console.log(`  ok ${spec.id}: плавание, ход вперёд/назад, поворот, посадка и высадка`);
  } finally { await worker.terminate(); }
}
await Promise.all(BOATS.map(run));
console.log('ИТОГ: OK — лодки в физическом воркере');
