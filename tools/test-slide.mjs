// Проверка ФАКТИЧЕСКОЙ логики сползания (не только CC Rapier):
// углы <= 42° — стоим как вкопанные, 55–60° — съезжаем вниз.
import RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER } from '../src/shared/constants.ts';
await RAPIER.init();
const G = -9.81, DT = 1 / 60;

function run(deg, seconds = 2.5) {
  const world = new RAPIER.World({ x: 0, y: G, z: 0 });
  world.timestep = DT;
  const a = deg * Math.PI / 180;
  const q = { x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) };
  const ramp = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setRotation(q));
  world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setFriction(0.3), ramp);
  world.step();
  const hit = world.castRay(new RAPIER.Ray({ x: 0, y: 60, z: 0 }, { x: 0, y: -1, z: 0 }), 200, true);
  const surfY = 60 - hit.timeOfImpact;

  const R = 0.3, H = PLAYER.heightStand;
  const pb = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, surfY + 0.02 + H / 2, 0));
  const pc = world.createCollider(RAPIER.ColliderDesc.capsule((H - 2 * R) / 2, R).setFriction(0), pb);
  const cc = world.createCharacterController(0.02);
  cc.enableAutostep(PLAYER.stepHeight, 0.2, false);
  cc.enableSnapToGround(0.35);
  cc.setMaxSlopeClimbAngle(PLAYER.slopeMax * Math.PI / 180);
  cc.setMinSlopeSlideAngle(PLAYER.slopeMax * Math.PI / 180);
  cc.setUp({ x: 0, y: 1, z: 0 });

  // та же логика, что в worker.ts: разгон вдоль нормали + трение
  let push = [0, 0], slopeDeg = 0, gn = { x: 0, y: 1, z: 0 }, grounded = true, vy = 0;
  const steps = Math.round(seconds / DT);
  const path = [];
  for (let i = 0; i < steps; i++) {
    if (grounded && slopeDeg >= PLAYER.slideFrom) {
      const l = Math.hypot(gn.x, gn.z) || 1;
      const k = Math.sin(slopeDeg * Math.PI / 180);
      push[0] += (gn.x / l) * PLAYER.slideAccel * k * DT;
      push[1] += (gn.z / l) * PLAYER.slideAccel * k * DT;
      const sp = Math.hypot(push[0], push[1]);
      if (sp > PLAYER.slideMax) { push[0] *= PLAYER.slideMax / sp; push[1] *= PLAYER.slideMax / sp; }
    } else {
      const d = Math.exp(-8 * DT); push[0] *= d; push[1] *= d;
    }
    vy += G * DT;
    if (grounded && vy < 0) vy = 0;
    cc.computeColliderMovement(pc, { x: push[0] * DT, y: vy * DT, z: push[1] * DT });
    const m = cc.computedMovement();
    grounded = cc.computedGrounded();
    // как в worker.ts: нормаль опоры берём лучом вниз
    const t0 = pb.translation();
    const g = world.castRayAndGetNormal(new RAPIER.Ray({ x: t0.x, y: t0.y, z: t0.z }, { x: 0, y: -1, z: 0 }), H / 2 + 0.45, true, undefined, undefined, pc);
    if (g) { gn = { x: g.normal.x, y: g.normal.y, z: g.normal.z }; slopeDeg = Math.acos(Math.max(-1, Math.min(1, gn.y))) * 180 / Math.PI; }
    else { gn = { x: 0, y: 1, z: 0 }; slopeDeg = 0; }
    const t = pb.translation();
    pb.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    world.step();
    const n = pb.translation();
    path.push([n.x, n.y, n.z]);
    if (process.env.DBG && i % 30 === 0) console.log(`     шаг ${i}: y=${n.y.toFixed(2)} x=${n.x.toFixed(2)} z=${n.z.toFixed(2)} grounded=${grounded} slope=${slopeDeg.toFixed(0)} push=${push.map(v=>v.toFixed(2))}`);
  }
  // старт берём после того, как персонаж «осел» на склон (первые кадры уходят на посадку)
  const a0 = path[15], a1 = path[path.length - 1];
  const dist = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]);
  return { slope: +slopeDeg.toFixed(0), movedIn2s: +dist.toFixed(2), dropY: +(a1[1] - a0[1]).toFixed(2) };
}

console.log('Логика сползания worker.ts (порог 42°, ускорение 7.5, максимум 9 м/с):');
let fails = 0;
for (const d of [30, 42, 45, 50, 55, 60]) {
  const r = run(d);
  const shouldSlide = d >= 45;
  const slides = r.movedIn2s > 1.0;
  const ok = shouldSlide ? slides : !slides;
  if (!ok) fails++;
  console.log(`  ${String(d).padStart(2)}° → съехал ${r.movedIn2s} м за 2 с, по вертикали ${r.dropY} м · ${ok ? 'OK' : 'ПЛОХО'}`);
}
console.log(`\nИТОГ: ${fails === 0 ? 'OK — на 55° съезжаем, на 30° стоим' : 'ПРОБЛЕМА в ' + fails + ' случаях'}`);
process.exit(fails ? 1 : 0);
