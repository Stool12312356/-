// Загружаем модуль мира так же, как при выборе карты в браузере. Ошибка на
// верхнем уровне раньше останавливала main.ts до boot() и оставляла «Инициализация».
import assert from 'node:assert/strict';
import { MAPS } from '../src/game/maps.ts';
for (const map of MAPS) {
  globalThis.location = { search: `?map=${encodeURIComponent(map.id)}` };
  const world = await import(`../src/game/world.ts?map-startup=${encodeURIComponent(map.id)}`);
  assert.equal(world.CURRENT_MAP.id, map.id);
  assert.equal(world.BUILDINGS.length, map.houses.length);
  assert.equal(world.SPAWN.length, 3);
  assert.ok(world.SPAWN.every(Number.isFinite), `${map.id}: некорректный спавн`);
  if (!map.houses.length) {
    assert.deepEqual(world.SPAWN, map.playerSpawn ?? map.spawns.own);
    assert.deepEqual(world.spawnPoint(), map.playerSpawn ?? map.spawns.own);
  }
  console.log(`  ok ${map.id}: модуль мира загружен, спавн ${world.SPAWN.join(', ')}`);
}
console.log('ИТОГ: OK — запуск мира всех карт');
