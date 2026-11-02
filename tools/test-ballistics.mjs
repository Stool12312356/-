// Проверка баллистики без браузера: те же шаги, что делает воркер.
// 1) пуля 900 м/с не должна «проходить сквозь» панель 0.32 м (туннелирование);
// 2) пробитие зависит от материала и угла;
// 3) настильность: через сколько метров пуля просядет на 0.5 м.
import RAPIER from '@dimforge/rapier3d-compat';
import { penetrationResult, SURFACES, BALLISTICS, pointBlankRange } from '../src/game/weapons.ts';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;

// панель 3 х 2.8 х 0.32 на дистанции 30 м
const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.4, -30));
world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.4, 0.16), wallBody);

// ВАЖНО: Rapier строит broad-phase/query pipeline только на шаге мира.
// Без этого castRay всегда возвращает null — грабли, на которые легко наступить.
world.step();
function shootWithSubsteps(velocity, substep = 1 / 600) {
  let pos = { x: 0, y: 1.5, z: 0 }, vel = { x: 0, y: 0, z: -velocity };
  const n = Math.ceil((1 / 60) / substep), h = (1 / 60) / n;
  for (let frame = 0; frame < 20; frame++) {
    for (let i = 0; i < n; i++) {
      const seg = Math.hypot(vel.x, vel.y, vel.z) * h;
      const dir = { x: vel.x / (seg / h), y: vel.y / (seg / h), z: vel.z / (seg / h) };
      const ray = new RAPIER.Ray(pos, dir);
      const hit = world.castRay(ray, seg, true);
      if (hit) return { hit: true, at: pos.z + dir.z * hit.timeOfImpact, frames: frame };
      pos = { x: pos.x + vel.x * h, y: pos.y + vel.y * h, z: pos.z + vel.z * h };
    }
  }
  return { hit: false };
}
function shootNoSubsteps(velocity) {
  let pos = { x: 0, y: 1.5, z: 0 }, vel = { x: 0, y: 0, z: -velocity };
  for (let frame = 0; frame < 20; frame++) {
    const seg = Math.hypot(vel.x, vel.y, vel.z) / 60;
    const dir = { x: 0, y: 0, z: -1 };
    const ray = new RAPIER.Ray(pos, dir);
    const hit = world.castRay(ray, seg, true);
    if (hit) return { hit: true, frames: frame };
    pos.z -= seg;
  }
  return { hit: false };
}

const fast = shootWithSubsteps(900), slow = shootWithSubsteps(120);
const noSub = shootNoSubsteps(900);
console.log('с подшагами 900 м/с →', fast, '| 120 м/с (РПГ) →', slow);
console.log('без подшагов 900 м/с (шаг 15 м за кадр) →', noSub);

console.log('\nпробитие (АК 2.4, СВД 4.2) по поверхностям, угол 0°/45°:');
for (const s of ['concrete', 'panel', 'brick', 'wood', 'armor']) {
  for (const pen of [2.4, 4.2]) {
    const a = penetrationResult(pen, s, 0), b = penetrationResult(pen, s, 45);
    console.log(`  ${s.padEnd(9)} pen=${pen}: 0° → ${a.penetrated ? 'пробила, остаток ' + a.remain.toFixed(2) : 'застряла'} | 45° → ${b.penetrated ? 'пробила, остаток ' + b.remain.toFixed(2) : 'застряла'}`);
  }
}
console.log('\nдальность прямого выстрела (просадка 0,5 м):');
for (const [name, v, bc] of [['АК-74', 900, 0.75], ['СВД', 830, 1.35], ['ПМ', 315, 0.45], ['РПГ-7', 120, 0.25]]) console.log(`  ${name.padEnd(7)} ${v} м/с (bc ${bc}) → ${pointBlankRange(v, bc).toFixed(0)} м`);

// Rapier делает swept-cast для отрезка, поэтому статичную стену 900 м/с не проскакивает.
// Подшаги всё равно нужны: за кадр пуля проходит 15 м и может перескочить движущуюся цель
// (техника, бот), а также пробить ДВЕ тонкие панели подряд — отрезок её увидит только одну.
const hitsWall = fast.hit && Math.abs(fast.at + 30) < 0.6;
const ok = hitsWall && slow.hit;
console.log(`\nИТОГ: ${ok ? 'OK — снаряд попадает в панель на 30 м и на 900, и на 120 м/с' : 'ПРОБЛЕМА: ' + JSON.stringify({ fast, slow })}`);
console.log(`       (без подшагов тоже попадает: ${noSub.hit} — Rapier считает отрезок, а не точку; подшаги нужны для движущихся целей)`);
process.exit(ok ? 0 : 1);
