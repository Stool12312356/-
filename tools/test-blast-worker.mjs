// Проверка настоящего собранного воркера: цель вне сухого, но внутри подводного радиуса.
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
const delay = ms => new Promise(r => setTimeout(r, ms));
async function run(y) {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
    workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
  });
  let player, body, readyResolve, readyReject;
  const ready = new Promise((r, j) => { readyResolve = r; readyReject = j; });
  worker.on('error', readyReject);
  worker.on('message', m => {
    if (m.type === 'ready') readyResolve();
    if (m.type === 'snapshot') {
      player = m.player;
      const i = m.ids.indexOf(2);
      if (i !== -1) body = Array.from(m.tf.slice(i * 7, i * 7 + 3));
    }
  });
  try {
    await ready;
    worker.postMessage({ type: 'water', water: { level: 0, x0: -50, x1: 50, z0: -50, z1: 50, depth: 5 } });
    worker.postMessage({ type: 'addBodies', bodies: [
      { id: 1, kind: 'static', pos: [0, -5.5, 0], shapes: [{ t: 'box', he: [50, 0.5, 50] }] },
      { id: 2, kind: 'dynamic', pos: [0, -1, 11], shapes: [{ t: 'box', he: [0.3, 0.3, 0.3] }], mass: 5 },
    ] });
    worker.postMessage({ type: 'spawnPlayer', pos: [11, -1.6, 0] });
    await delay(350);
    assert.ok(player && body, 'воркер передал состояние');
    const before = { hp: player.hp, x: player.pos[0], z: body[2] };
    worker.postMessage({ type: 'explosion', pos: [0, y, 0], radius: 10, impulse: 800 });
    await delay(250);
    return { damage: before.hp - player.hp, playerMove: player.pos[0] - before.x, bodyMove: body[2] - before.z };
  } finally { await worker.terminate(); }
}
const [air, underwater] = await Promise.all([run(1), run(-1)]);
assert.ok(Math.abs(air.damage) < 0.01 && Math.abs(air.playerMove) < 0.02 && Math.abs(air.bodyMove) < 0.02, `вне сухого радиуса: ${JSON.stringify(air)}`);
assert.ok(underwater.damage > 1, `урон игроку: ${JSON.stringify(underwater)}`);
assert.ok(underwater.playerMove > 0.05, `отбрасывание игрока: ${JSON.stringify(underwater)}`);
assert.ok(underwater.bodyMove > 0.05, `импульс динамическому телу: ${JSON.stringify(underwater)}`);
console.log('ИТОГ: OK — подводный взрыв действует на игрока и тело за сухим радиусом');

// РПГ вызывает взрыв сам в воркере и передаёт исходный радиус в событии попадания.
async function rocket() {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), {
    workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href },
  });
  let player, impact, readyResolve, readyReject;
  const ready = new Promise((r, j) => { readyResolve = r; readyReject = j; });
  worker.on('error', readyReject);
  worker.on('message', m => {
    if (m.type === 'ready') readyResolve();
    if (m.type === 'snapshot') player = m.player;
    if (m.type === 'impacts') impact = m.impacts.find(i => i.kind === 'explosive') ?? impact;
  });
  try {
    await ready;
    worker.postMessage({ type: 'water', water: { level: 0, x0: -50, x1: 50, z0: -50, z1: 50, depth: 5 } });
    worker.postMessage({ type: 'addBodies', bodies: [{ id: 10, kind: 'static', pos: [0, -1, 0], shapes: [{ t: 'box', he: [0.2, 2, 2] }] }] });
    worker.postMessage({ type: 'spawnPlayer', pos: [11, -1.6, 0] });
    await delay(250);
    const hp = player.hp;
    worker.postMessage({ type: 'shoot', tracer: { id: 99, pos: [-4, -1, 0], prev: [-4, -1, 0], vel: [100, 0, 0], life: 2, penetration: 1, owner: 0, explosive: { radius: 10, damage: 130 } } });
    await delay(350);
    assert.ok(impact && impact.pos[1] < 0, `подводное попадание: ${JSON.stringify(impact)}`);
    assert.equal(impact.blastRadius, 10); assert.equal(impact.damage, 130);
    assert.ok(player.hp < hp - 1, 'подводный РПГ сам вызывает расширенный взрыв');
  } finally { await worker.terminate(); }
}
await rocket();
console.log('ИТОГ: OK — попадание РПГ передаёт исходный радиус и вызывает взрыв в воркере');
