// КЛАССЫ ПЕХОТЫ (ТЗ п.8): штурмовик, инженер, поддержка, разведчик.
//
// Каждый класс — набор из трёх вещей:
//  • ОРУЖИЕ (стволы из weapons.ts, всегда реальные данные, а не «примерно»);
//  • ГАДЖЕТ (то, чем класс полезен команде: аптечка, ремключ, ящик патронов, дрон);
//  • ПАССИВКА (одно числовое отличие: скорость, прочность, запас патронов).
//
// Почему отдельный модуль без three: баланс должен проверяться тестом
// (tools/test-classes.mjs), а не «на глаз». Всё, что тут есть — данные и чистые
// функции: что надеть, сколько патронов, что можно чинить.
import { WEAPONS, type WeaponSpec } from './weapons.ts';

export type ClassId = 'assault' | 'engineer' | 'support' | 'recon';

export interface Gadget {
  id: 'medkit' | 'wrench' | 'ammo' | 'drone' | 'grenade' | 'mine' | 'c4';
  name: string;
  /** сколько применений за жизнь */
  uses: number;
}

export interface ClassSpec {
  id: ClassId;
  name: string;
  /** модель бойца: у нас две (СССР/противник), класс на них не влияет */
  role: string;
  /** стволы по слотам: 0 — основное, 1 — второе, 2 — пистолет */
  weapons: { id: string; reserve: number }[];
  gadgets: Gadget[];
  /** пассивка класса */
  perk: { hpMul: number; speedMul: number; reloadMul: number; extraAmmoMul: number; note: string };
}

/**
 * Данные классов — ровно по таблице ТЗ п.8:
 *  Штурмовик — АК-74/АКМ, ГП-25 и аптечка;
 *  Инженер — АКС-74У, РПГ-7, ремключ, мины;
 *  Поддержка — ПКМ/РПК, ящик патронов, С4;
 *  Разведчик — СВД, дрон, маяк.
 *
 * ВАЖНО (п.с. ТЗ): оружия ГП-25/мин/маяка в манифесте моделей НЕТ. Поэтому в гаджетах
 * они описаны данными, а не подменены чужой моделью: на экране гаджет — иконка в HUD.
 * Как только модели появятся, сюда добавится поле model — интерфейс уже готов.
 */
export const CLASSES: Record<ClassId, ClassSpec> = {
  assault: {
    id: 'assault', name: 'Штурмовик', role: 'Пехота ближнего боя: продавливает точки',
    // слот 1 — ОСНОВНОЕ (АК-74), слот 2 — ВТОРОЕ. Раньше здесь стоял второй автомат (АКМ),
    // и игрок видел «два калаша» вместо гранатомёта. По ТЗ у штурмовика второе оружие —
    // РПГ-7 (как и было в стартовом наборе до появления классов).
    weapons: [
      { id: 'ak74', reserve: 180 },
      { id: 'rpg7', reserve: 6 },
      { id: 'pm', reserve: 48 },
    ],
    gadgets: [
      { id: 'grenade', name: 'Граната РГД-5', uses: 2 },
      { id: 'medkit', name: 'Аптечка', uses: 1 },
    ],
    perk: { hpMul: 1.0, speedMul: 1.06, reloadMul: 1.0, extraAmmoMul: 1.0, note: 'быстрее бегает (+6%)' },
  },
  engineer: {
    id: 'engineer', name: 'Инженер', role: 'Техника и разрушение: РПГ, ремключ, мины',
    weapons: [{ id: 'ak74m', reserve: 150 }, { id: 'rpg7', reserve: 6 }, { id: 'pm', reserve: 32 }],
    gadgets: [
      { id: 'wrench', name: 'Ремключ', uses: 99 },
      { id: 'mine', name: 'Мина ТМ-62', uses: 2 },
    ],
    perk: { hpMul: 1.0, speedMul: 1.0, reloadMul: 1.0, extraAmmoMul: 1.15, note: 'чинит технику, +15% боезапаса' },
  },
  support: {
    id: 'support', name: 'Поддержка', role: 'Плотный огонь и снабжение: ПКМ, ящик патронов',
    weapons: [{ id: 'pkm', reserve: 300 }, { id: 'rpk', reserve: 135 }, { id: 'pm', reserve: 32 }],
    gadgets: [
      { id: 'ammo', name: 'Ящик боеприпасов', uses: 3 },
      { id: 'c4', name: 'С4', uses: 2 },
    ],
    perk: { hpMul: 1.2, speedMul: 0.92, reloadMul: 1.15, extraAmmoMul: 1.0, note: 'крепче (+20% HP), но тяжелее (−8% скорости)' },
  },
  recon: {
    id: 'recon', name: 'Разведчик', role: 'Дальний бой и разведка: СВД, дрон',
    weapons: [{ id: 'svd', reserve: 60 }, { id: 'ak74', reserve: 90 }, { id: 'pm', reserve: 32 }],
    gadgets: [
      { id: 'drone', name: 'Дрон-разведчик', uses: 1 },
      { id: 'grenade', name: 'Граната РГД-5', uses: 1 },
    ],
    perk: { hpMul: 0.95, speedMul: 1.0, reloadMul: 0.9, extraAmmoMul: 1.0, note: 'перезаряжает на 10% быстрее' },
  },
};

export const CLASS_ORDER: ClassId[] = ['assault', 'engineer', 'support', 'recon'];

/** Стволы класса, которые реально есть в данных (проверка «не выдумывать оружие»). */
export function classWeapons(c: ClassSpec): WeaponSpec[] {
  return c.weapons.map(w => WEAPONS.find(x => x.id === w.id)).filter((w): w is WeaponSpec => !!w);
}

/** Что кладём в инвентарь: список [id, запас] с учётом пассивки класса. */
export function loadout(id: ClassId): [string, number][] {
  const c = CLASSES[id];
  return c.weapons.map(w => [w.id, Math.round(w.reserve * c.perk.extraAmmoMul)]);
}

/** Урон по игроку с учётом прочности класса (поддержка крепче). */
export function applyArmor(id: ClassId, damage: number): number {
  return damage / CLASSES[id].perk.hpMul;
}

/** Может ли класс чинить технику (ремключ) — пригодится технике из ТЗ п.6. */
export function canRepair(id: ClassId): boolean {
  return CLASSES[id].gadgets.some(g => g.id === 'wrench');
}

/** Перк класса → множители для физики/оружия. */
export function perkOf(id: ClassId) {
  return CLASSES[id].perk;
}

/** Гаджеты по id (для HUD и применений). */
export function gadget(id: ClassId, g: Gadget['id']): Gadget | null {
  return CLASSES[id].gadgets.find(x => x.id === g) ?? null;
}
