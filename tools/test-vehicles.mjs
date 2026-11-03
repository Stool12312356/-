// ТЕХНИКА (ТЗ п.4.3): данные машин и математика ходовой — без физического движка.
// Проверяем: массы совпадают с ТЗ, у каждой машины колёса с подвеской и ведущими,
// покрытия реально влияют на скорость, гусеницы разворачиваются на месте, таран
// считает импульс и урон обоим.
import {
  VEHICLES, VEHICLE_SURFACES, vehicleById, TZ_MASSES,
  traction, topSpeed, accelTime, pivotRate, ram,
} from '../src/game/vehicles.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

// --- массы из ТЗ: цифры не должны «уплыть» при правках
for (const [id, mass] of Object.entries(TZ_MASSES)) {
  const v = vehicleById(id);
  check(`${id}: масса как в ТЗ`, Math.abs(v.mass - mass) / mass < 0.03, `${v.mass} кг (ТЗ ${mass})`);
}
check('все машины ТЗ на месте', VEHICLES.length >= 6, `${VEHICLES.length} машин`);

// --- колёса: 4–10 (ТЗ), у каждого радиус, ход подвески, ведущие есть
for (const v of VEHICLES) {
  const wheels = v.wheels;
  check(`${v.id}: 4–10 колёс/катков`, wheels.length >= 4 && wheels.length <= 10, `${wheels.length}`);
  check(`${v.id}: у колёс есть радиус и подвеска`,
    wheels.every(w => w.radius > 0.1 && w.travel > 0.05 && w.stiffness > 0 && w.damping > 0));
  check(`${v.id}: есть ведущие колёса`, wheels.some(w => w.drive), `${wheels.filter(w => w.drive).length} ведущих`);
  const steered = wheels.filter(w => w.steer).length;
  if (v.drive === 'wheeled') check(`${v.id}: передние колёса рулевые`, steered >= 2, `${steered} рулевых`);
  else check(`${v.id}: гусеницы разворачиваются на месте`, pivotRate(v, 'asphalt') > 0.3,
    `${pivotRate(v, 'asphalt').toFixed(2)} рад/с`);
  check(`${v.id}: масса > 1 т`, v.mass > 1000, `${v.mass} кг`);
}

// --- покрытия: на асфальте быстрее, чем на льду; на грязи медленнее, чем на грунте
for (const v of VEHICLES) {
  const a = topSpeed(v, 'asphalt'), d = topSpeed(v, 'dirt'), m = topSpeed(v, 'mud'), i = topSpeed(v, 'ice');
  check(`${v.id}: асфальт быстрее грунта`, a > d + 0.5, `${a.toFixed(1)} > ${d.toFixed(1)} м/с`);
  check(`${v.id}: грязь медленнее грунта`, m < d, `${m.toFixed(1)} < ${d.toFixed(1)} м/с`);
  check(`${v.id}: лёд заметно медленнее асфальта`, i < a * 0.75, `${i.toFixed(1)} против ${a.toFixed(1)} м/с`);
}

// --- сцепление: на льду тяга ограничена μ·N и много меньше мощности
{
  const t72 = vehicleById('t72');
  const onIce = traction(t72, 'ice'), onAsphalt = traction(t72, 'asphalt');
  check('на льду тяга ограничена сцеплением', onIce < onAsphalt * 0.3, `${Math.round(onIce)} против ${Math.round(onAsphalt)} Н`);
  check('сцепление льда ниже снега', VEHICLE_SURFACES.ice.grip < VEHICLE_SURFACES.snow.grip);
  check('сцепление грязи выше льда', VEHICLE_SURFACES.mud.grip > VEHICLE_SURFACES.ice.grip);
}

// --- разгон: танк не «ракета», но и не «улитка»
{
  const t = accelTime(vehicleById('t72'), 'asphalt', 10);
  check('Т-72 разгоняется 0–36 км/ч за 3–8 с', t > 3 && t < 8, `${t.toFixed(1)} с`);
  const u = accelTime(vehicleById('uaz469'), 'asphalt', 10);
  check('УАЗ разгоняется 0–36 км/ч быстрее танка', u < t, `${u.toFixed(1)} с против ${t.toFixed(1)} с`);
  check('на льду разгон дольше', accelTime(vehicleById('uaz469'), 'ice', 10) > u * 1.5,
    `${accelTime(vehicleById('uaz469'), 'ice', 10).toFixed(1)} с`);
}

// --- таран: лёгкий забор сносится без урона машине, бетон бьёт по машине
{
  const uaz = vehicleById('uaz469');
  const fence = ram(uaz, 12, { mass: 80, hp: 40, breakable: true });
  check('таран сносит забор', fence.destroyed && fence.damageVehicle === 0,
    `импульс ${Math.round(fence.impulse)} кг·м/с, машине ${fence.damageVehicle}`);
  const wall = ram(uaz, 12, { mass: 6000, hp: 4000, breakable: false });
  check('бетонная стена бьёт по машине', wall.damageVehicle > 3 && !wall.destroyed, `машине ${wall.damageVehicle.toFixed(1)}`);
  const t72 = vehicleById('t72');
  const garage = ram(t72, 10, { mass: 1200, hp: 200, breakable: true });
  check('танк пробивает гараж', garage.destroyed, `импульс ${Math.round(garage.impulse)} кг·м/с`);
  const heavy = ram(t72, 10, { mass: 6000, hp: 4000, breakable: false });
  const light = ram(uaz, 10, { mass: 6000, hp: 4000, breakable: false });
  check('танк о стену страдает меньше УАЗа', heavy.damageVehicle < light.damageVehicle,
    `${heavy.damageVehicle.toFixed(1)} против ${light.damageVehicle.toFixed(1)}`);
}

// --- СИМУЛЯЦИЯ ШАГА ХОДОВОЙ: машина реально едет, поворачивает, гусеница разворачивается
{
  const { stepVehicle } = await import('../src/game/vehicleRig.ts');
  const sim = (id, surface, input, seconds) => {
    const spec = vehicleById(id);
    const st = {
      spec, pos: [0, 0.6, 0], vel: [0, 0, 0], yaw: 0, yawRate: 0, steer: 0, gear: 1,
      damaged: { track: false, engine: false, turret: false },
    };
    const dt = 1 / 60;
    const contacts = spec.wheels.map(() => ({ ground: 0, normal: [0, 1, 0], surface }));
    let peak = 0, sunk = true;
    for (let i = 0; i < seconds / dt; i++) {
      const r = stepVehicle(st, dt, input, contacts);
      st.vel[1] += (r.force[1] / spec.mass - 9.81) * dt;
      st.vel[0] += (r.force[0] / spec.mass) * dt;
      st.vel[2] += (r.force[2] / spec.mass) * dt;
      st.pos[0] += st.vel[0] * dt; st.pos[2] += st.vel[2] * dt;
      st.yawRate += r.torqueY * dt; st.yaw += st.yawRate * dt;
      peak = Math.max(peak, Math.hypot(st.vel[0], st.vel[2]));
      if (st.pos[1] > -1) sunk = false;
    }
    return { v: Math.hypot(st.vel[0], st.vel[2]), peak, yaw: st.yaw, sunk, y: st.pos[1] };
  };

  const uaz = sim('uaz469', 'asphalt', { throttle: 1, steer: 0, handbrake: false }, 25);
  check('УАЗ разгоняется до близко к пределу', uaz.v > topSpeed(vehicleById('uaz469'), 'asphalt') * 0.8,
    `${uaz.v.toFixed(1)} из ${topSpeed(vehicleById('uaz469'), 'asphalt').toFixed(1)} м/с`);
  check('машина не проваливается сквозь землю', !uaz.sunk, `y = ${uaz.y.toFixed(2)}`);
  const turn = sim('uaz469', 'asphalt', { throttle: 0.6, steer: 1, handbrake: false }, 6);
  check('колёсная машина поворачивает на ходу', Math.abs(turn.yaw) > 1.5, `${turn.yaw.toFixed(1)} рад за 6 с`);
  const t72 = sim('t72', 'asphalt', { throttle: 0, steer: 1, handbrake: false }, 3);
  check('гусеницы разворачиваются на месте', Math.abs(t72.yaw) > 1.0, `${t72.yaw.toFixed(1)} рад за 3 с без газа`);
  const ice = sim('uaz469', 'ice', { throttle: 1, steer: 0, handbrake: false }, 25);
  check('на льду машина медленнее', ice.v < uaz.v * 0.75, `${ice.v.toFixed(1)} против ${uaz.v.toFixed(1)} м/с`);
  // повреждение двигателя: тяга падает
  const spec = vehicleById('uaz469');
  const st2 = { spec, pos: [0, 0.6, 0], vel: [0, 0, 0], yaw: 0, yawRate: 0, steer: 0, gear: 1, damaged: { track: false, engine: true, turret: false } };
  let peakBroken = 0;
  const contacts = spec.wheels.map(() => ({ ground: 0, normal: [0, 1, 0], surface: 'asphalt' }));
  for (let i = 0; i < 15 * 60; i++) {
    const r = stepVehicle(st2, 1 / 60, { throttle: 1, steer: 0, handbrake: false }, contacts);
    // вертикаль тоже считаем: без неё сила подвески каждый шаг считалась как «нагрузка»
    // и машина разгонялась иначе, чем на дороге
    st2.vel[1] += (r.force[1] / spec.mass - 9.81) / 60;
    st2.vel[0] += r.force[0] / spec.mass / 60;
    st2.vel[2] += r.force[2] / spec.mass / 60;
    st2.pos[1] += st2.vel[1] / 60;
    peakBroken = Math.max(peakBroken, Math.hypot(st2.vel[0], st2.vel[2]));
  }
  check('с повреждённым двигателем едет хуже', peakBroken < uaz.peak * 0.7, `${peakBroken.toFixed(1)} против ${uaz.peak.toFixed(1)} м/с`);
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — техника: данные и ходовая (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
