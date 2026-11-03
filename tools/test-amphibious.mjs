import assert from 'node:assert/strict';
import { amphibiousAcceleration } from '../src/game/vehicleWater.ts';
import { vehicleById } from '../src/game/vehicles.ts';
import { getMap } from '../src/game/maps.ts';

const water = getMap('port').water;
const spec = vehicleById('btr80');
const state = { specId: spec.id, size: spec.size, pos: [0, 0, 170], vel: [0, 0, 0], yaw: 0, yawRate: 0 };
const controls = { throttle: 0, steer: 0, handbrake: false };
const calc = (s = state, opts = controls, support = false, w = water) => amphibiousAcceleration(w, s, opts, support);
assert.equal(calc(state, controls, true).submerged, 0, 'мост отключает плавучесть');
assert.equal(calc({ ...state, pos: [0, 0, 0] }).submerged, 0, 'на суше воды нет');
assert.equal(calc({ ...state, specId: 't72' }).submerged, 0, 'танк не считается амфибией');
assert.equal(calc({ ...state, pos: [0, 3, 170] }).submerged, 0, 'над водой плавучести нет');
const dt = 1 / 60;
for (let i = 0; i < 60 * 20; i++) {
  const a = calc();
  state.vel[1] += (a.acceleration[1] - 9.81) * dt;
  state.pos[1] += state.vel[1] * dt;
}
assert.ok(Math.abs(state.pos[1] + 0.3) < 0.03, `осадка на поверхности: ${state.pos[1]}`);
assert.ok(Math.abs(state.vel[1]) < 0.03, 'колебания затухают');
const fwd = calc(state, { ...controls, throttle: 1 });
assert.ok(fwd.acceleration[2] > 0, 'водомёт ускоряет вперёд');
assert.ok(calc(state, { ...controls, throttle: -1 }).acceleration[2] < 0, 'водомёт даёт задний ход');
assert.equal(calc(state, { ...controls, throttle: 1, handbrake: true }).acceleration[2], 0, 'тормоз останавливает тягу');
assert.ok(calc(state, { ...controls, steer: 1 }).yawAcceleration < 0, 'руль действует в воде');
const stream = { ...water, flow: [1, 0] };
assert.ok(calc(state, controls, false, stream).acceleration[0] > 0, 'течение действует на корпус');
console.log('ИТОГ: OK — плавучесть, водомёт, течение и мост');
