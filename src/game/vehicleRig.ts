// ХОДОВАЯ ТЕХНИКИ В РАНТАЙМЕ (ТЗ п.4.3, «raycast vehicle»).
//
// Шаг физики живёт в worker.ts (только он видит мир), но вся математика ходовой —
// здесь, чтобы её можно было проверить без браузера (tools/test-vehicles.mjs).
//
// Как работает шаг (60 Гц):
//   1. для каждого колеса берём высоту земли под ним (из физики, см. readGround);
//   2. пружина+демпфер дают силу подвески — машина «сидит» на колёсах, а не парит;
//   3. тяга на ведущих ограничена сцеплением покрытия (лёд — буксует);
//   4. рулевые колёса поворачиваются, гусеницы разворачиваются разностью бортов.
//
// Здесь чистые функции: на вход состояние и высоты земли, на выход силы и момент.
import type { VehicleSpec } from './vehicles.ts';
import { VEHICLE_SURFACES, pivotRate, topSpeed } from './vehicles.ts';

export interface VehicleState {
  spec: VehicleSpec;
  /** позиция корпуса, м */
  pos: [number, number, number];
  /** скорость, м/с */
  vel: [number, number, number];
  /** рыскание, рад (куда смотрит нос) */
  yaw: number;
  /** угловая скорость рыскания, рад/с */
  yawRate: number;
  /** угол поворота колёс, рад */
  steer: number;
  /** текущая передача: -1 назад, 0 нейтраль, 1 вперёд */
  gear: -1 | 0 | 1;
  /** состояние узлов: гусеница/двигатель/башня (ТЗ: повреждения узлов) */
  damaged: { track: boolean; engine: boolean; turret: boolean };
}

export interface WheelContact {
  /** высота земли под точкой колеса, м (null — провал/нет опоры) */
  ground: number | null;
  /** нормаль поверхности */
  normal: [number, number, number];
  /** материал под колесом: asphalt | dirt | snow | ice | mud | concrete */
  surface: string;
}

/** Позиция колеса в мире (с учётом рыскания машины). */
export function wheelWorld(spec: VehicleSpec, pos: [number, number, number], yaw: number, w: { pos: [number, number, number] }): [number, number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = w.pos[0] * c + w.pos[2] * s;
  const z = -w.pos[0] * s + w.pos[2] * c;
  return [pos[0] + x, pos[1] + w.pos[1], pos[2] + z];
}

/**
 * Один шаг ходовой. Возвращает силы/моменты, которые worker прикладывает к телу.
 *
 * @param dt шаг, с
 * @param input тяга (-1..1), руль (-1..1)
 * @param contacts состояние под каждым колесом (длина = spec.wheels.length)
 */
export function stepVehicle(
  st: VehicleState, dt: number, input: { throttle: number; steer: number; handbrake: boolean },
  contacts: WheelContact[],
): { force: [number, number, number]; torqueY: number; wheels: { compression: number; slip: boolean }[] } {
  const spec = st.spec;
  const g = 9.81;
  const wheels = spec.wheels;
  const n = wheels.length;
  const wheelsOut: { compression: number; slip: boolean }[] = [];

  // --- 1. ПОДВЕСКА: пружина + демпфер по каждому колесу
  let up = 0, upWheels = 0;
  const perWheelComp: number[] = [];
  for (let i = 0; i < n; i++) {
    const w = wheels[i];
    const c = contacts[i] ?? { ground: null, normal: [0, 1, 0] as [number, number, number], surface: 'dirt' };
    if (c.ground == null) { perWheelComp.push(0); continue; }
    const wp = wheelWorld(spec, st.pos, st.yaw, w);
    const clearance = wp[1] - c.ground - w.radius;         // насколько подвеска сжата
    const comp = Math.max(0, Math.min(w.travel, w.travel - clearance + w.travel * 0.5));
    // скорость сжатия грубо: вертикальная скорость машины
    const compVel = st.vel[1];
    const spring = w.stiffness * comp - w.damping * compVel;
    if (spring > 0) { up += spring; upWheels++; }
    perWheelComp.push(comp);
  }
  // вес распределяется по колёсам, у которых есть опора; иначе машина падает
  const weight = spec.mass * g;
  // пружины не могут «тянуть» машину вниз: сила подвески — только вверх
  const support = upWheels ? Math.max(up, weight) : 0;

  // --- 2. КОЛЕСО: сцепление и тяга
  let driveForce = 0, gripSum = 0, grips = 0;
  const engineOk = st.damaged.engine ? 0.35 : 1;
  const trackOk = st.damaged.track ? 0.25 : 1;
  for (let i = 0; i < n; i++) {
    const w = wheels[i];
    const c = contacts[i] ?? { ground: null, normal: [0, 1, 0] as [number, number, number], surface: 'dirt' };
    const grip = (VEHICLE_SURFACES[c.surface] ?? VEHICLE_SURFACES.dirt).grip;
    if (c.ground != null) { gripSum += grip; grips++; }
    if (!w.drive || c.ground == null) continue;
    const normalLoad = support / Math.max(1, upWheels);
    const maxTraction = grip * normalLoad;
    // тяга на ведущее колесо: доля мощности, но не больше сцепления
    const share = spec.power / Math.max(1, wheels.filter(x => x.drive).length);
    driveForce += Math.min(share, maxTraction) * engineOk * trackOk;
  }
  const avgGrip = grips ? gripSum / grips : 0.7;

  // --- 3. СОПРОТИВЛЕНИЕ: качение + воздух
  const s = VEHICLE_SURFACES[contacts.find((c, i) => c?.ground != null)?.surface ?? 'dirt'] ?? VEHICLE_SURFACES.dirt;
  const speed = Math.hypot(st.vel[0], st.vel[2]);
  const roll = s.roll * weight;
  const drag = 0.6 * speed * speed;

  // --- 4. ПРОДОЛЬНАЯ СИЛА
  let accel = 0;
  const top = topSpeed(spec, contacts.find(c => c?.ground != null)?.surface ?? 'dirt');
  if (st.gear !== 0) {
    const want = input.throttle * (st.gear === -1 ? -1 : 1);
    // ограничение по максимальной скорости: у предела тяга падает
    const headroom = Math.max(0, 1 - speed / Math.max(0.1, top));
    accel = (driveForce * headroom * want) / spec.mass;
  }
  const dir = speed > 0.05 ? 1 : 0;          // сопротивление действует только на ходу
  accel -= dir * (roll / spec.mass);
  accel -= dir * (drag / spec.mass);
  if (input.handbrake) accel -= dir * 8;
  // боковое скольжение на слабом сцеплении: машину «тащит» вбок (лёд, грязь)
  const slide = avgGrip < 0.35 ? (st.vel[0] * 0.2) : 0;

  // --- 5. ПОВОРОТ: колёсная — углом колёс, гусеничная — разностью бортов
  let torqueY = 0;
  if (spec.drive === 'tracked' && !st.damaged.track) {
    const rate = pivotRate(spec, contacts.find(c => c?.ground != null)?.surface ?? 'dirt');
    const forwardSpeed = speed > 0.5;
    if (forwardSpeed) torqueY = -input.steer * rate * 1.4 * Math.min(1, speed / 3);
    else torqueY = -input.steer * rate;                       // разворот на месте
  } else if (!st.damaged.track) {
    // велосипедная модель: ω = v / L · tan(δ), L — база
    const L = Math.max(1.5, (spec.size[2] * 0.6));
    const delta = input.steer * spec.steerMax;
    st.steer += (delta - st.steer) * Math.min(1, dt * 6);
    torqueY = -(speed * Math.tan(st.steer)) / L;
  }

  // --- 6. что показать/проверить
  for (let i = 0; i < n; i++) {
    const c = contacts[i];
    const grip = (VEHICLE_SURFACES[c?.surface ?? 'dirt'] ?? VEHICLE_SURFACES.dirt).grip;
    wheelsOut.push({ compression: perWheelComp[i] ?? 0, slip: !!c && c.ground != null && grip < 0.3 && input.throttle !== 0 });
  }

  // сила подвески — вверх, продольная — вдоль носа машины (по рысканию),
  // боковой снос — отдельным слагаемым. Гравитацию тело получает от движка,
  // поэтому здесь только силы от колёс и сопротивление.
  const fwd = [Math.sin(st.yaw), 0, Math.cos(st.yaw)];
  const side = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
  const F = accel * spec.mass;
  return {
    force: [
      fwd[0] * F + side[0] * slide,
      support,
      fwd[2] * F + side[2] * slide,
    ],
    torqueY,
    wheels: wheelsOut,
  };
}

/** Проверка «машина стоит на колёсах»: все ли колёса достают до земли. */
export function groundedWheels(contacts: WheelContact[]): number {
  return contacts.filter(c => c && c.ground != null).length;
}
