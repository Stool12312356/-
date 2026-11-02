export const PHYS_HZ = 60;
export const GRAVITY = -9.81;
export const PLAYER = {
  walk: 5, run: 8, sprint: 8, crouchSpeed: 2.5, proneSpeed: 1.2,
  radius: 0.35, heightStand: 1.8, heightCrouch: 1.2, heightProne: 0.6,
  eyeStand: 1.65, eyeCrouch: 1.05, eyeProne: 0.4,
  jump: 4.6, slopeMax: 50, stepHeight: 0.4,
  /** выше этого угла персонаж съезжает вниз сам (было: не съезжал вообще — баг) */
  slideFrom: 45,
  /** ускорение сползания по склону, м/с² (не 9.81: иначе сдувает как с горки) */
  slideAccel: 2.6,
  /** максимальная скорость сползания, м/с */
  slideMax: 6.5,
  staminaMax: 100, staminaDrain: 22, staminaRegen: 14, fallDamageFrom: 6, hp: 100,
};
