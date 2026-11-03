// Ограничения осколков: предотвращают перегрузку и чрезмерный урон игроку.
export const FRAGMENTS_PER_BLAST = 24;
export const MAX_ACTIVE_FRAGMENTS = 96;
export const FRAGMENT_SPEED = 75;
export const FRAGMENT_LIFE = 0.4;
export const FRAGMENT_DAMAGE = 6;
export const FRAGMENT_PLAYER_CAP = 18;

/** Урон от следующего осколка одного взрыва с общим пределом для игрока. */
export function fragmentPlayerDamage(alreadyDealt: number, damage: number): number {
  return Math.max(0, Math.min(damage, FRAGMENT_PLAYER_CAP - Math.max(0, alreadyDealt)));
}
