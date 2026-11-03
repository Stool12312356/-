// Плавучесть амфибии в кинематической модели техники. Вызывается из worker.ts
// каждый физический шаг; отдельно от силы колёс, которые работают только на опоре.
import { inWater, type WaterDef } from './water.ts';

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
  if (!w || v.specId !== 'btr80' || supported || !inWater(w, v.pos[0], v.pos[2])) return none;
  const height = Math.max(0.1, v.size[1]);
  const submerged = Math.max(0, Math.min(1, (w.level - (v.pos[1] - height / 2)) / height));
  if (submerged <= 0) return none;
  // Водоизмещение с запасом: при 62,5% погружения Архимед уравновешивает вес.
  // Вертикальный и горизонтальный демпферы не дают бесконечно раскачиваться.
  const flowX = w.flow?.[0] ?? 0, flowZ = w.flow?.[1] ?? 0;
  const throttle = controls.handbrake ? 0 : Math.max(-1, Math.min(1, controls.throttle));
  const thrust = throttle * 3.2 * submerged;
  const drag = 0.9 * submerged;
  return {
    submerged,
    acceleration: [
      Math.sin(v.yaw) * thrust - (v.vel[0] - flowX) * drag,
      9.81 * 1.6 * submerged - v.vel[1] * 2.5 * submerged,
      Math.cos(v.yaw) * thrust - (v.vel[2] - flowZ) * drag,
    ],
    yawAcceleration: -Math.max(-1, Math.min(1, controls.steer)) * 0.6 * submerged - v.yawRate * 2 * submerged,
  };
}
