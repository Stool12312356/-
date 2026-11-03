// Параметры взрыва для визуала, построек и живой силы. Импульс телам и игроку
// рассчитывает физический воркер; сюда поступают исходные, не усиленные значения.
import { blastAt, inWater, type WaterDef } from './water.ts';

export interface BlastProfile {
  radius: number;
  damage: number;
  craterRadius: number;
  craterStrength: number;
  propRadius: number;
  propStrength: number;
  maxVoxels: number;
}

export function planBlast(w: WaterDef | undefined, pos: [number, number, number], base: BlastProfile) {
  const living = blastAt(w, pos, base.radius, base.damage);
  const crater = blastAt(w, pos, base.craterRadius, base.craterStrength);
  const props = blastAt(w, pos, base.propRadius, base.propStrength);
  return {
    underwater: !!w && inWater(w, pos[0], pos[2]) && pos[1] < w.level,
    radius: living.radius, damage: living.power,
    craterRadius: crater.radius, craterStrength: crater.power,
    propRadius: props.radius, propStrength: props.power,
    // Бюджет обломков не увеличиваем: иначе один взрыв может обрушить весь дом.
    maxVoxels: base.maxVoxels,
  };
}

/** Урон без множителя попадания в голову: ударная волна действует на всё тело. */
export function blastDamage(distance: number, radius: number, damage: number): number {
  if (radius <= 0 || distance >= radius || damage <= 0) return 0;
  return Math.max(0, damage * (1 - Math.max(0, distance) / radius));
}
