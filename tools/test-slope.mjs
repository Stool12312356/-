// Почему на 55° не скользим? Стенд: ставим персонажа РОВНО на плоскость (по лучу),
// даём только гравитацию и смотрим, поехал ли он вниз.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const G = -9.81;

function run(slopeDeg, o = {}) {
  const world = new RAPIER.World({ x: 0, y: G, z: 0 });
  world.timestep = 1 / 60;
  const a = slopeDeg * Math.PI / 180;
  const q = { x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) };
  const ramp = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setRotation(q));
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setFriction(o.friction ?? 0.3), ramp);
  world.step(); // ВАЖНО: без шага query pipeline пуст и луч ничего не найдёт

  const probe = world.castRayAndGetNormal(new RAPIER.Ray({ x: 0, y: 40, z: 0 }, { x: 0, y: -1, z: 0 }), 100, true);
  if (!probe) throw new Error('луч не нашёл рампу');
  const surfY = 40 - probe.timeOfImpact;
  const n = probe.normal;

  const R = 0.3, H = 1.8;
  const feetY = surfY + 0.02;
  const pb = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, feetY + H / 2, 0));
  const pc = world.createCollider(RAPIER.ColliderDesc.capsule((H - 2 * R) / 2, R).setFriction(0), pb);
  const cc = world.createCharacterController(0.02);
  cc.enableAutostep(0.4, 0.2, false);
  if (o.snap !== false) cc.enableSnapToGround(o.snap ?? 0.35);
  cc.setMaxSlopeClimbAngle((o.climb ?? 50) * Math.PI / 180);
  cc.setMinSlopeSlideAngle((o.slide ?? 50) * Math.PI / 180);
  cc.setCharacterMass(80);
  cc.setUp({ x: 0, y: 1, z: 0 });

  const start = { x: 0, z: 0 };
  let groundedAt = null, normals = new Set();
  for (let i = 0; i < 180; i++) {
    const desired = { x: 0, y: G * (1 / 60) * (1 / 60), z: 0 }; // только гравитация за шаг
    cc.computeColliderMovement(pc, desired);
    const m = cc.computedMovement();
    const grounded = cc.computedGrounded();
    if (grounded && groundedAt === null) groundedAt = i;
    for (let k = 0; k < cc.numComputedCollisions(); k++) {
      const c = cc.computedCollision(k);
      if (c) normals.add([c.normal1.x, c.normal1.y, c.normal1.z].map(v => v.toFixed(2)).join(','));
    }
    const t = pb.translation();
    pb.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    world.step();
  }
  const t = pb.translation();
  return { groundedAt, slid: +Math.hypot(t.x - start.x, t.z - start.z).toFixed(2), dy: +(t.y - feetY - H / 2).toFixed(2), normals: [...normals].slice(0, 2), slopeNormal: [n.x, n.y, n.z].map(v => +v.toFixed(2)) };
}

console.log('ТЕКУЩИЕ настройки (climb 50°, slide 50°, snap 0.35):');
for (const d of [30, 45, 50, 55, 60]) console.log(`  ${d}° →`, run(d));
console.log('\nесли slide = climb = 50° — это и есть баг: CC не различает «не залезть» и «съехать»');
console.log('\nslide 30° (а climb 50°):');
for (const d of [30, 45, 50, 55]) console.log(`  ${d}° →`, run(d, { slide: 30 }));
