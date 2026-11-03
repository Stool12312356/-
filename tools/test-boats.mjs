import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOATS, BOAT_SPAWNS, VEHICLE_SPAWNS, vehicleById } from '../src/game/vehicles.ts';
import { getMap } from '../src/game/maps.ts';
import { amphibiousAcceleration } from '../src/game/vehicleWater.ts';
const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8'));
assert.deepEqual(BOATS.map(b => b.id).sort(), ['assault_boat', 'pubg_boat']);
for (const boat of BOATS) {
  const asset = manifest.items.find(i => i.id === boat.model);
  assert.ok(asset && !asset.placeholder && fs.existsSync(`public/${asset.file}`), `${boat.id}: настоящая модель из манифеста`);
  assert.equal(vehicleById(boat.id), boat);
  assert.equal(boat.drive, 'boat');
  assert.equal(boat.wheels.length, 0);
  const state = { specId: boat.id, size: boat.size, pos: [0, 0, 160], vel: [0, 0, 0], yaw: 0, yawRate: 0 };
  const water = getMap('port').water;
  const controls = { throttle: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 60 * 12; i++) {
    const a = amphibiousAcceleration(water, state, controls, false);
    state.vel[1] += (a.acceleration[1] - 9.81) / 60;
    state.pos[1] += state.vel[1] / 60;
  }
  assert.ok(Math.abs(state.pos[1]) < 0.05, `${boat.id}: равновесие у поверхности`);
  assert.ok(amphibiousAcceleration(water, state, { ...controls, throttle: 1 }, false).acceleration[2] > 0);
  assert.ok(amphibiousAcceleration(water, state, { ...controls, throttle: -1 }, false).acceleration[2] < 0);
  assert.ok(amphibiousAcceleration(water, state, { ...controls, steer: 1 }, false).yawAcceleration < 0);
  assert.equal(amphibiousAcceleration(undefined, state, controls, false).submerged, 0);
}
for (const [id, list] of Object.entries(BOAT_SPAWNS)) {
  const map = getMap(id), w = map.water;
  assert.ok(w, `${id}: вода существует`);
  for (const s of list) {
    assert.ok(BOATS.includes(vehicleById(s.id)));
    assert.ok(s.pos[0] > w.x0 + 5 && s.pos[0] < w.x1 - 5 && s.pos[2] > w.z0 + 5 && s.pos[2] < w.z1 - 5, `${id}/${s.id}: лодка в воде`);
    assert.ok(map.points.every(p => Math.hypot(s.pos[0] - p.pos[0], s.pos[2] - p.pos[2]) > p.radius), `${id}/${s.id}: не на точке захвата`);
  }
}
assert.equal((BOAT_SPAWNS.poligon ?? []).length, 0, 'на стрельбище нет ездовой техники');
assert.equal((VEHICLE_SPAWNS.poligon ?? []).length, 0);
console.log('ИТОГ: OK — модели лодок, плавучесть и расположение на воде');
