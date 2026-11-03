// Плавучесть амфибии в кинематической модели техники. Вызывается из worker.ts
// каждый физический шаг; отдельно от силы колёс, которые работают только на опоре.
import { inWater, depthAt, type WaterDef } from './water.ts';

export interface AmphibiousState {
  specId: string;
  size: [number, number, number];
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  yawRate: number;
}

/** Ускорение от воды. Гравитация применяется вызывающим кодом, как и на суше. */
export function amphibiousAcceleration(
  w: WaterDef | undefined, v: AmphibiousState,
  controls: { throttle: number; steer: number; handbrake: boolean },
  /** Подвеска уже опирается на дно, берег или мост. */
  supported: boolean,
): { submerged: number; acceleration: [number, number, number]; yawAcceleration: number } {
  const none = { submerged: 0, acceleration: [0, 0, 0] as [number, number, number], yawAcceleration: 0 };
  const boat = v.specId === 'assault_boat' || v.specId === 'pubg_boat';
  if (!w || (!boat && v.specId !== 'btr80') || supported || !inWater(w, v.pos[0], v.pos[2])) return none;
  const height = Math.max(0.1, v.size[1]);
  const submerged = Math.max(0, Math.min(1, (w.level - (v.pos[1] - height / 2)) / height));
  if (submerged <= 0) return none;
  // Водоизмещение с запасом: при 62,5% погружения Архимед уравновешивает вес.
  // Вертикальный и горизонтальный демпферы не дают бесконечно раскачиваться.
  const flowX = w.flow?.[0] ?? 0, flowZ = w.flow?.[1] ?? 0;
  const throttle = controls.handbrake ? 0 : Math.max(-1, Math.min(1, controls.throttle));
  const thrust = throttle * (boat ? 5 : 3.2) * submerged;
  const drag = (boat ? 0.45 : 0.9) * submerged;
  return {
    submerged,
    acceleration: [
      Math.sin(v.yaw) * thrust - (v.vel[0] - flowX) * drag,
      9.81 * (boat ? 2 : 1.6) * submerged - v.vel[1] * 2.5 * submerged,
      Math.cos(v.yaw) * thrust - (v.vel[2] - flowZ) * drag,
    ],
    yawAcceleration: -Math.max(-1, Math.min(1, controls.steer)) * (boat ? 1 : 0.6) * submerged - v.yawRate * 2 * submerged,
  };
}

/** Танк не является амфибией: после попадания в глубокую воду у экипажа 10 с. */
export const TANK_EVACUATION_TIME = 10;
export interface TankFlood {
  elapsed: number;
  startY: number;
  bottomY: number;
  sunk: boolean;
}

/** null — танк сухой, иначе состояние затопления сохраняется даже при касании дна. */
export function advanceTankFlood(
  w: WaterDef | undefined, specId: string, pos: [number, number, number], height: number,
  wheelRadius: number, drySupport: boolean, previous: TankFlood | null, dt: number,
): TankFlood | null {
  if (previous?.sunk) return previous; // затонувшую машину нельзя «починить» выходом из воды
  if (!w || specId !== 't72' || !inWater(w, pos[0], pos[2]) || drySupport) return null;
  // Начало только в глубокой воде: вброд и по мосту таймер не включается.
  if (!previous && (pos[1] - height / 2 >= w.level || depthAt(w, pos[0], pos[2]) < 1.5)) return null;
  const flood = previous ?? { elapsed: 0, startY: pos[1], bottomY: w.level - depthAt(w, pos[0], pos[2]) + wheelRadius / 2, sunk: false };
  const elapsed = Math.min(TANK_EVACUATION_TIME, flood.elapsed + Math.max(0, dt));
  return { ...flood, elapsed, sunk: elapsed >= TANK_EVACUATION_TIME };
}

export function tankFloodHeight(flood: TankFlood): number {
  const t = Math.min(1, flood.elapsed / TANK_EVACUATION_TIME);
  return flood.startY + (Math.min(flood.startY, flood.bottomY) - flood.startY) * t;
}
