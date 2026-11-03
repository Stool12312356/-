// Данные оружия. Всё в СИ: м/с, кг, метры.
// По ТЗ (п. 4.6): никаких хитсканов — каждая пуля летит физически, с гравитацией,
// сопротивлением воздуха и падением скорости; АК-74 — 900 м/с, СВД — 830 м/с.
import type { Surface } from '../shared/types';

export interface WeaponSpec {
  id: string;
  name: string;
  /** модель для вьюмодели (id из манифеста) */
  model: string;
  /** id патрона */
  ammo: string;
  /** темп стрельбы, выстр/мин */
  rpm: number;
  /** режимы: авто / одиночный */
  auto: boolean;
  /** сколько патронов в магазине */
  mag: number;
  /** начальная скорость, м/с */
  velocity: number;
  /** масса пули, г */
  bulletG: number;
  /** диаметр пули, мм (для расчёта пробития) */
  caliber: number;
  /** разброс в МОА (1 МОА ≈ 0.00029 рад) */
  moa: number;
  /** отдача: подброс ствола за выстрел, рад */
  recoil: number;
  /** «бронепробитие» пули в условных единицах */
  penetration: number;
  /** урон по живой силе (до множителей по зоне попадания) */
  damage: number;
  /** скорость перезарядки, с */
  reload: number;
  /** прицельная дальность для HUD, м */
  zero: number;
  /** РПГ: взрыв */
  explosive?: { radius: number; damage: number };
  /** отдача вьюмодели (визуальная), м */
  kick?: number;
  /** вес в руках (влияет на скорость бега), кг */
  weight: number;
  /** баллистический коэффициент: больше = меньше тормозится воздухом (СВД/SVD ~1.35, ПМ ~0.45) */
  bc: number;
  /** модель-прицел (id из манифеста, опционально) */
  optic?: string;
}

/**
 * Материалы: как пуля взаимодействует с поверхностью.
 * penetration — сколько «бронепробития» нужно, чтобы пройти насквозь;
 * loss — сколько пробития теряется при проходе; richochet — вероятность рикошета под малым углом.
 */
export interface SurfaceSpec {
  name: string;
  /** нужно пробития, чтобы пройти насквозь */
  need: number;
  /** потеря пробития после прохода */
  loss: number;
  /** угол (град) ниже которого металл/бетон рикошетит */
  ricochet: number;
  /** множитель урона по этому материалу (для разрушения) */
  dmgMul: number;
  color: string;
}

/**
 * ВЗРЫВ (РПГ и прочие взрывные). Один снаряд не должен сносить дом: он пробивает
 * брешь в стене, но не срезает секцию. Раньше урон считался сферой r = 3.4 м и
 * силой 400 — это ~200-240 вокселей за выстрел (3.8 % дома), а в связке с
 * «обрушением оторванного» дом складывался за пару выстрелов.
 *
 * Единый источник правды: main.ts и tools/test-rpg.mjs берут параметры отсюда,
 * поэтому они не могут разойтись.
 */
export const EXPLOSION = {
  /** радиус собственно кратера, м (полтора-два вокселя в глубину + разлёт) */
  crater: 1.4,
  /** сколько вокселей максимум выбивает один взрыв (это и есть «лаг» — пересборка чанков) */
  craterMax: 26,
  /** сила удара: с запасом больше HP любого вокселя (плита 40), чтобы центр гарантированно выбивало */
  strength: 120,
  /** радиус поражения (для существ, импульсов и дыма — НЕ для вокселей) */
  blast: 9,
  /** сила по живой силе на краю blast, в единицах hp */
  damage: 160,
  /** сколько секторов «осадков» стен не обрушивается: взрыв не должен запускать collapse */
  /** (порог обрушения секции остаётся 66 % в collapse-логике) */
} as const;

/** Параметры кратера для ящиков/прочих динамических объектов — дешевле, чем у РПГ. */
export const EXPLOSION_SMALL = { crater: 1.0, craterMax: 8, strength: 60 } as const;

export const SURFACES: Record<Surface, SurfaceSpec> = {
  concrete: { name: 'бетон', need: 5, loss: 1.4, ricochet: 18, dmgMul: 0.6, color: '#b9b5a8' },
  panel: { name: 'панель', need: 1.6, loss: 1.1, ricochet: 15, dmgMul: 0.9, color: '#a9adb2' },
  brick: { name: 'кирпич', need: 1.1, loss: 0.9, ricochet: 12, dmgMul: 1.1, color: '#8d5a44' },
  plaster: { name: 'штукатурка', need: 0.5, loss: 0.4, ricochet: 6, dmgMul: 1.6, color: '#cfc9bb' },
  wood: { name: 'дерево', need: 0.4, loss: 0.3, ricochet: 5, dmgMul: 1.4, color: '#8a5a2b' },
  glass: { name: 'стекло', need: 0.05, loss: 0.05, ricochet: 0, dmgMul: 2.5, color: '#9fc4d8' },
  metal: { name: 'металл', need: 1.4, loss: 1.3, ricochet: 25, dmgMul: 0.8, color: '#7a7f85' },
  armor: { name: 'броня', need: 99, loss: 99, ricochet: 30, dmgMul: 0.05, color: '#5a5f52' },
  dirt: { name: 'земля', need: 9, loss: 9, ricochet: 0, dmgMul: 0.5, color: '#6d6b64' },
  water: { name: 'вода', need: 9, loss: 9, ricochet: 0, dmgMul: 0.2, color: '#4a6a7a' },
};

const W = (w: WeaponSpec) => w;

export const WEAPONS: WeaponSpec[] = [
  W({
    id: 'ak74', name: 'АК-74', model: 'ak74', ammo: '5.45x39', rpm: 650, auto: true, mag: 30,
    velocity: 900, bulletG: 3.4, caliber: 5.45, moa: 60, recoil: 0.012, penetration: 2.4, damage: 34,
    reload: 2.4, zero: 300, weight: 3.3, bc: 0.75
  }),
  W({
    id: 'ak74m', name: 'АК-74М', model: 'ak74m', ammo: '5.45x39', rpm: 650, auto: true, mag: 30,
    velocity: 900, bulletG: 3.4, caliber: 5.45, moa: 55, recoil: 0.011, penetration: 2.4, damage: 34,
    reload: 2.3, zero: 300, weight: 3.4, bc: 0.75
  }),
  W({
    id: 'akm', name: 'АКМ', model: 'akm', ammo: '7.62x39', rpm: 600, auto: true, mag: 30,
    velocity: 715, bulletG: 7.9, caliber: 7.62, moa: 70, recoil: 0.018, penetration: 2.6, damage: 42,
    reload: 2.5, zero: 250, weight: 3.6, kick: 0.05, bc: 0.8
  }),
  W({
    id: 'svd', name: 'СВД', model: 'svd', ammo: '7.62x54R', rpm: 40, auto: false, mag: 10,
    velocity: 830, bulletG: 9.6, caliber: 7.62, moa: 15, recoil: 0.035, penetration: 4.2, damage: 95,
    reload: 3.1, zero: 500, weight: 4.6, optic: 'att_1p29', bc: 1.35
  }),
  W({
    id: 'pkm', name: 'ПКМ', model: 'pkm', ammo: '7.62x54R', rpm: 650, auto: true, mag: 100,
    velocity: 825, bulletG: 9.6, caliber: 7.62, moa: 80, recoil: 0.02, penetration: 4.0, damage: 48,
    reload: 6.0, zero: 400, weight: 9.0, bc: 1.3
  }),
  W({
    id: 'rpk', name: 'РПК', model: 'rpk', ammo: '5.45x39', rpm: 600, auto: true, mag: 45,
    velocity: 900, bulletG: 3.4, caliber: 5.45, moa: 65, recoil: 0.013, penetration: 2.4, damage: 34,
    reload: 3.0, zero: 300, weight: 5.1, bc: 0.78
  }),
  W({
    id: 'pm', name: 'ПМ', model: 'pm', ammo: '9x18', rpm: 300, auto: false, mag: 8,
    velocity: 315, bulletG: 6.1, caliber: 9, moa: 110, recoil: 0.022, penetration: 1.1, damage: 26,
    reload: 1.8, zero: 50, weight: 0.73, bc: 0.45
  }),
  W({
    id: 'm4a1', name: 'M4A1', model: 'm4a1', ammo: '5.56x45', rpm: 800, auto: true, mag: 30,
    velocity: 880, bulletG: 4.0, caliber: 5.56, moa: 45, recoil: 0.009, penetration: 2.3, damage: 31,
    reload: 2.2, zero: 300, weight: 3.1, bc: 0.85
  }),
  W({
    id: 'awm_l96', name: 'AWM / L96', model: 'awm_l96', ammo: '7.62x51', rpm: 35, auto: false, mag: 5,
    velocity: 850, bulletG: 9.5, caliber: 7.62, moa: 10, recoil: 0.04, penetration: 4.4, damage: 100,
    reload: 3.4, zero: 600, weight: 6.5, bc: 1.5
  }),
  W({
    id: 'pgm_ur', name: 'PGM Ultima Ratio', model: 'pgm_ur', ammo: '7.62x51', rpm: 35, auto: false, mag: 10,
    velocity: 860, bulletG: 9.5, caliber: 7.62, moa: 8, recoil: 0.038, penetration: 4.6, damage: 100,
    reload: 3.2, zero: 600, weight: 7.2, bc: 1.5
  }),
  W({
    id: 'rpg7', name: 'РПГ-7', model: 'rpg7', ammo: 'ПГ-7В', rpm: 8, auto: false, mag: 1,
    velocity: 120, bulletG: 2600, caliber: 85, moa: 200, recoil: 0.09, penetration: 99, damage: 60,
    reload: 7.0, zero: 300, weight: 7.0, explosive: { radius: EXPLOSION.blast, damage: EXPLOSION.damage }, kick: 0.2, bc: 0.25
  }),
];

export const weaponById = (id: string) => WEAPONS.find(w => w.id === id) ?? WEAPONS[0];

/** Плотность воздуха и коэффициент сопротивления пули — общие для всех. */
export const BALLISTICS = {
  gravity: -9.81,
  /** коэффициент сопротивления: a = -k * v^2 (подобрано так, чтобы АК терял ~100 м/с на 500 м) */
  dragK: 1.9e-4,
  /** максимальная дистанция полёта пули (для уборки трассеров), м */
  maxRange: 2200,
  /** шаг интегрирования в воркере (подшаги для быстрых пуль), с */
  substep: 1 / 600,
};

/**
 * Пробитие: возвращает {penetrated, remain} — прошла ли пуля поверхность и с каким остатком бронепробития.
 * Угол в градусах к нормали: 0 — в лоб, 90 — скользящий.
 */
export function penetrationResult(penetration: number, surface: Surface, angleDeg: number) {
  const s = SURFACES[surface];
  // Скользящее попадание: путь внутри материала длиннее, поэтому нужно БОЛЬШЕ пробития.
  // Было наоборот (делили на cos) — тест ловил абсурд «под 45° пробивает, в лоб нет».
  const eff = penetration * Math.pow(Math.max(0.2, Math.cos((angleDeg * Math.PI) / 180)), 0.5);
  const need = s.need;
  if (eff < need) return { penetrated: false, remain: 0 };
  const remain = eff - need - s.loss;
  return { penetrated: remain > 0, remain: Math.max(0, remain) };
}

/** Вероятность рикошета: угол задаётся к нормали (90° — касательное попадание). */
export function ricochetChance(surface: Surface, angleDeg: number): number {
  const limit = SURFACES[surface].ricochet;
  if (limit <= 0) return 0;
  const grazing = 90 - Math.max(0, Math.min(90, angleDeg));
  return Math.max(0, (limit - grazing) / limit) * 0.8;
}

/** Дальность прямого выстрела (для подсказки в HUD): где пуля просядет более 0.5 м. */
export function pointBlankRange(velocity: number, bc = 1) {
  const dragK = BALLISTICS.dragK / bc;
  // численно: интегрируем горизонтальный полёт и смотрим превышение/просадку над линией прицела
  let x = 0, y = 0, vx = velocity, vy = 0;
  const dt = 0.01, g = BALLISTICS.gravity;
  while (x < 1200) {
    const v = Math.hypot(vx, vy);
    vx += (-dragK * v * vx) * dt;
    vy += (-dragK * v * vy + g) * dt;
    x += vx * dt; y += vy * dt;
    if (-y > 0.5) return x;
  }
  return 1200;
}
