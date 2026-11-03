// Проверяем реальные коллайдеры карты, а не только декларацию «река/мост».
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getMap } from '../src/game/maps.ts';
import { buildGround } from '../src/game/ground.ts';
import { spawnDressing } from '../src/game/dressing.ts';
import { blastAt } from '../src/game/water.ts';

await RAPIER.init();
const map = getMap('prigorod'), scene = new THREE.Scene();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const phys = { add(d) {
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...d.pos));
  for (const s of d.shapes) {
    const desc = s.t === 'trimesh' ? RAPIER.ColliderDesc.trimesh(s.verts, s.idx)
      : RAPIER.ColliderDesc.cuboid(...s.he);
    if (s.rotY) desc.setRotation({ x: 0, y: Math.sin(s.rotY / 2), z: 0, w: Math.cos(s.rotY / 2) });
    world.createCollider(desc, rb);
  }
} };
buildGround(scene, phys, map.size, map.water);
spawnDressing(scene, phys, map.dressing);
world.step();
const groundAt = (x, z, from = 5) => {
  const ray = new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 30, true);
  assert.ok(hit, `нет поверхности в (${x}, ${z})`);
  return from - hit.timeOfImpact;
};
assert.ok(Math.abs(groundAt(-48, 50) + 3.2) < 0.03, 'физическое дно реки');
assert.ok(Math.abs(groundAt(-48, 130) + 0.5) < 0.03, 'брод действительно мелкий');
assert.ok(Math.abs(groundAt(-48, 0) - 0.35) < 0.03, 'настил моста поверх воды');
assert.ok(Math.abs(groundAt(-48, 0, -1) + 3.2) < 0.03, 'под настилом есть вода, а не сплошной блок');
assert.ok(Math.abs(groundAt(-75, 0)) < 0.03 && Math.abs(groundAt(-22, 0)) < 0.03, 'берега соединены');
for (let x = -72; x <= -24; x += 2) assert.ok(groundAt(x, 0) > 0.3, `настил непрерывен x=${x}`);
// Реальный контроллер Rapier проходит по настилу с берега на берег.
const player = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-76, 0.95, 0));
const col = world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.3), player);
const cc = world.createCharacterController(0.02);
cc.enableAutostep(0.5, 0.2, false);
cc.enableSnapToGround(0.35);
let vy = 0, grounded = false, minFeet = Infinity;
for (let i = 0; i < 1000 && player.translation().x < -20; i++) {
  vy += -9.81 / 60;
  if (grounded && vy < 0) vy = 0;
  cc.computeColliderMovement(col, { x: 4 / 60, y: vy / 60, z: 0 });
  const movement = cc.computedMovement(), p = player.translation();
  grounded = cc.computedGrounded();
  if (grounded && vy < 0) vy = 0;
  player.setNextKinematicTranslation({ x: p.x + movement.x, y: p.y + movement.y, z: p.z });
  world.step();
  minFeet = Math.min(minFeet, player.translation().y - 0.9);
}
assert.ok(player.translation().x >= -20, `персонаж прошёл мост: x=${player.translation().x}`);
assert.ok(minFeet > -0.1, `персонаж не провалился под мост: y=${minFeet}`);
const wet = blastAt(map.water, [-48, -1, 20], 10, 100);
const above = blastAt(map.water, [-48, 1, 20], 10, 100);
const dry = blastAt(map.water, [0, -1, 20], 10, 100);
assert.deepEqual(wet, { radius: 16, power: 180 });
assert.deepEqual(above, { radius: 10, power: 100 });
assert.deepEqual(dry, above);
world.free();
console.log('ИТОГ: OK — дно реки, коллайдер моста и подводный взрыв');
