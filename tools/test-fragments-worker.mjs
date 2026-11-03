// Реальные осколки взрывного снаряда в production worker, а не частицы эффекта.
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
const create = async () => {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), { workerData: { bundle: pathToFileURL(resolve('dist/assets', bundle)).href } });
  const state = { impacts: [], traces: [], player: null, body: null };
  let ok, fail; const ready = new Promise((r, j) => { ok = r; fail = j; });
  worker.on('error', fail);
  worker.on('message', m => {
    if (m.type === 'ready') ok();
    if (m.type === 'impacts') state.impacts.push(...m.impacts);
    if (m.type === 'tracers') state.traces.push(...m.tracers.filter(t => t.fragment));
    if (m.type === 'snapshot') { state.player = m.player; const i = m.ids.indexOf(7); if (i >= 0) state.body = Array.from(m.tf.slice(i * 7, i * 7 + 3)); }
  });
  await ready; return { worker, state };
};
const shoot = (worker, tracer) => worker.postMessage({ type: 'shoot', tracer: { prev: [...tracer.pos], life: 2, penetration: 1, owner: 0, bc: 1, ...tracer } });
const box = (id, pos, he, surface = 'concrete', kind = 'static') => ({ id, kind, pos, surface, shapes: [{ t: 'box', he }], ...(kind === 'dynamic' ? { mass: 5 } : {}) });

// РПГ попадает в стенку; экран позади стрелка останавливает осколки.
{
  const { worker, state } = await create();
  try {
    worker.postMessage({ type: 'addBodies', bodies: [
      box(1, [0, 8, 0], [0.1, 1, 1]),
      box(2, [-4, 8, 0], [0.1, 30, 30], 'metal'),
      box(3, [-6, 8, 0], [0.1, 30, 30], 'wood'),
    ] });
    await delay(220);
    shoot(worker, { id: 101, pos: [-2, 8, 0], vel: [100, 0, 0], explosive: { radius: 9, damage: 160 } });
    await delay(600);
    const explosions = state.impacts.filter(i => i.kind === 'explosive');
    const frag = state.impacts.filter(i => i.kind === 'fragment');
    assert.equal(explosions.length, 1, 'один удар РПГ');
    assert.ok(frag.length > 0 && frag.length <= 24, `количество осколков ограничено: ${frag.length}`);
    assert.ok(frag.some(i => i.bodyId === 2), 'осколки физически попадают в экран');
    assert.equal(frag.filter(i => i.bodyId === 3).length, 0, 'экран закрывает цель');
    assert.ok(state.traces.some(t => t.fragment && t.id < 0), 'осколки передаются как летящие трассеры');
    assert.ok(frag.every(i => i.damage === 6), 'ограниченный урон осколка');
    const startImpacts = state.impacts.length, startTraces = state.traces.length;
    for (let i = 0; i < 10; i++) shoot(worker, { id: 300 + i, pos: [-2, 8, 0], vel: [100, 0, 0], explosive: { radius: 9, damage: 160 } });
    await delay(600);
    const batchImpacts = state.impacts.slice(startImpacts), batchTraces = state.traces.slice(startTraces);
    assert.equal(batchImpacts.filter(i => i.kind === 'explosive').length, 10, 'все снаряды детонировали');
    const ids = new Set([...batchImpacts.filter(i => i.kind === 'fragment').map(i => i.tracer), ...batchTraces.map(t => t.id)]);
    assert.ok(ids.size > 24 && ids.size <= 96, `общий бюджет активных осколков: ${ids.size}`);
  } finally { await worker.terminate(); }
}

// Сам полёт осколка попадает в настоящую капсулу игрока и динамическое тело.
{
  const { worker, state } = await create();
  try {
    worker.postMessage({ type: 'addBodies', bodies: [
      box(1, [0, -0.5, 0], [30, 0.5, 30]),
      box(7, [8, 1.5, 5], [0.5, 0.5, 0.5], 'wood', 'dynamic'),
    ] });
    worker.postMessage({ type: 'spawnPlayer', pos: [8, 0.02, 0] });
    await delay(350);
    assert.ok(state.player && state.body);
    const beforeHP = state.player.hp, beforeX = state.body[0];
    shoot(worker, { id: 201, pos: [4, 1, 0], vel: [75, 0, 0], fragment: { damage: 6 } });
    shoot(worker, { id: 202, pos: [4, state.body[1], 5], vel: [75, 0, 0], fragment: { damage: 6 } });
    await delay(300);
    const playerHit = state.impacts.find(i => i.tracer === 201);
    const bodyHit = state.impacts.find(i => i.tracer === 202);
    assert.equal(playerHit?.kind, 'fragment'); assert.equal(playerHit?.targetPlayer, true);
    assert.ok(state.player.hp <= beforeHP - 5.9, `урон игроку: ${beforeHP} → ${state.player.hp}`);
    assert.equal(bodyHit?.bodyId, 7, 'осколок попал в динамический объект');
    assert.ok(state.body[0] > beforeX + 0.01, `объект получил импульс: ${beforeX} → ${state.body[0]}`);
  } finally { await worker.terminate(); }
}
console.log('ИТОГ: OK — осколки РПГ, укрытие, столкновения, урон игроку и импульс телу');
