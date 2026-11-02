// ГАДЖЕТЫ КЛАССОВ (ТЗ п.8) — то, чем класс полезен: аптечка, ящик патронов, С4,
// мина, ремключ, дрон. Раньше это были только надписи в меню; теперь у каждого есть
// реальный эффект в игре.
//
// Модели не подделываем (ТЗ, п.с.): гаджет без модели в манифесте применяется
// «из рук» — эффект в мире (взрыв, лечение, пополнение), а не чужая модель.
import type { Effects } from './effects';
import type { PhysicsClient } from '../physics/client';

export type GadgetId = 'medkit' | 'wrench' | 'ammo' | 'drone' | 'grenade' | 'mine' | 'c4';

export interface GadgetState {
  id: GadgetId;
  /** осталось применений */
  uses: number;
}

export interface GadgetHooks {
  /** вылечить игрока на hp (не выше предела) */
  heal: (hp: number) => void;
  /** пополнить запас патронов текущего оружия (сколько магазинов) */
  resupply: (mags: number) => void;
  /** взрыв в точке (физика + эффекты + урон домам) */
  explode: (pos: [number, number, number], radius: number, power: 'small' | 'big') => void;
  /** позиция игрока/взгляда */
  origin: () => [number, number, number];
  /** куда смотрит игрок (нормализовано) */
  aim: () => [number, number, number];
}

/**
 * Набор гаджетов игрока. Применение — по клавишам:
 *   H — аптечка/ремонт, J — боеприпасы, K — С4/мина/граната, L — дрон.
 *
 * Почему цифры именно такие: аптечка лечит 65 HP (как в Battlefield — не до полного),
 * ящик даёт 3 магазина, С4/мина — взрыв средний/малый, дрон только «подсвечивает»
 * (пока без авиации из ТЗ).
 */
export class Gadgets {
  list: GadgetState[] = [];
  hooks: GadgetHooks;
  effects: Effects | null;
  phys: PhysicsClient | null;
  /** последний дрон: точка, куда он улетел (для HUD/разведки) */
  droneSpot: [number, number, number] | null = null;
  onUse: ((g: GadgetId, ok: boolean, why?: string) => void) | null = null;

  constructor(hooks: GadgetHooks, effects: Effects | null = null, phys: PhysicsClient | null = null) {
    this.hooks = hooks; this.effects = effects; this.phys = phys;
  }

  /** Загрузить гаджеты класса (копии счётчиков, чтобы не портить данные классов). */
  setFrom(list: readonly { id: string; uses: number }[]) {
    this.list = list
      .filter(g => isGadget(g.id))
      .map(g => ({ id: g.id as GadgetId, uses: g.uses }));
  }

  have(id: GadgetId) { return this.list.some(g => g.id === id && g.uses > 0); }
  uses(id: GadgetId) { return this.list.find(g => g.id === id)?.uses ?? 0; }

  hud(): string {
    return this.list.map(g => `${ICON[g.id]}${g.uses}`).join(' ');
  }

  /**
   * Применить гаджет. Возвращает true, если применение прошло.
   * Все эффекты — через hooks: сама логика не знает про three и физику.
   */
  use(id: GadgetId): boolean {
    const g = this.list.find(x => x.id === id);
    if (!g) { this.onUse?.(id, false, 'нет в наборе'); return false; }
    if (g.uses <= 0) { this.onUse?.(id, false, 'закончился'); return false; }
    const at = this.hooks.origin();
    const dir = this.hooks.aim();

    switch (id) {
      case 'medkit':
        this.hooks.heal(65);
        break;
      case 'wrench':
        // ремключ по ТЗ чинит технику; техники пока нет — чиним СЕБЯ (как «перевязка»)
        this.hooks.heal(25);
        break;
      case 'ammo':
        this.hooks.resupply(3);
        break;
      case 'grenade': {
        // граната летит по взгляду на 18 м или до первой стены (упрощённо: 18 м)
        const p: [number, number, number] = [at[0] + dir[0] * 18, at[1] + dir[1] * 18, at[2] + dir[2] * 18];
        this.hooks.explode(p, 6, 'small');
        break;
      }
      case 'c4': {
        // С4 ставим перед собой (1.5 м) — взрыв большой
        const p: [number, number, number] = [at[0] + dir[0] * 1.5, Math.max(at[1] - 0.6, 0.2), at[2] + dir[2] * 1.5];
        this.hooks.explode(p, 8, 'big');
        break;
      }
      case 'mine': {
        // мина ставится под ноги и взрывается сразу при постановке в этом прототипе
        // (полноценные мины с триггером — этап техники; здесь важен эффект и расход)
        const p: [number, number, number] = [at[0] + dir[0] * 2.0, Math.max(at[1] - 1.2, 0.15), at[2] + dir[2] * 2.0];
        this.hooks.explode(p, 5, 'small');
        break;
      }
      case 'drone': {
        // дрон-разведчик: поднимается на 25 м вперёд и «подсвечивает» район
        this.droneSpot = [at[0] + dir[0] * 25, at[1] + 18, at[2] + dir[2] * 25];
        this.effects?.dust(this.droneSpot, 6, 2.0);
        break;
      }
    }
    g.uses--;
    this.onUse?.(id, true);
    return true;
  }
}

const ICON: Record<GadgetId, string> = {
  medkit: '✚', wrench: '🔧', ammo: '▣', drone: '◎', grenade: '●', mine: '◉', c4: '▮',
};

function isGadget(id: string): id is GadgetId {
  return id in ICON;
}

/** Клавиша → гаджет (порядок как в меню класса). */
export const GADGET_KEYS: Record<string, GadgetId> = {
  KeyH: 'medkit', KeyJ: 'ammo', KeyK: 'c4', KeyL: 'drone',
};

/** Для класса: какая клавиша что делает (в HUD подсказки). */
export function gadgetForKey(list: readonly GadgetState[], key: string): GadgetId | null {
  const want = GADGET_KEYS[key];
  if (want && list.some(g => g.id === want)) return want;
  // у инженера ремключ на H, мина на K, у штурмовика граната на K
  if (key === 'KeyH') {
    if (list.some(g => g.id === 'medkit')) return 'medkit';
    if (list.some(g => g.id === 'wrench')) return 'wrench';
  }
  if (key === 'KeyK') {
    if (list.some(g => g.id === 'c4')) return 'c4';
    if (list.some(g => g.id === 'mine')) return 'mine';
    if (list.some(g => g.id === 'grenade')) return 'grenade';
  }
  return null;
}
