// КАРТЫ (ТЗ п.9): расстановка зданий, точки захвата и спавны сторон.
//
// Карта теперь — ДАННЫЕ, а не хардкод в main.ts: houses + specials + points + spawns.
// Поэтому вторая карта («Заводская площадка») добавляется записью в MAPS, а не
// копированием кода. Проверяется tools/test-maps.mjs: обе карты собираются, точки
// не пересекаются со зданиями, спавны не внутри стен.
import type { CapturePoint } from './match.ts';
import type { SpecialKind } from './barracks.ts';

export interface MapPointDef {
  name: string;
  /** позиция в мире */
  pos: [number, number, number];
  radius: number;
}

export interface HouseDef {
  kind: 'khrushchevka' | 'brezhnevka';
  pos: [number, number, number];
  rotY: number;
  sections: number;
}

export interface SpecialDef {
  kind: SpecialKind;
  pos: [number, number, number];
  rotY: number;
  sections: number;
}

export interface MapDef {
  id: string;
  name: string;
  /** подпись карты в меню */
  subtitle: string;
  houses: HouseDef[];
  specials: SpecialDef[];
  points: MapPointDef[];
  /** где появляется игрок (если не задано — считается из первого дома, как раньше) */
  playerSpawn?: [number, number, number];
  /** базы сторон для ботов */
  spawns: { own: [number, number, number]; foe: [number, number, number] };
}

/**
 * «Спальный район» — историческая карта игры: хрущёвки, брежневка, казарма, военторг.
 * Разрушаемость максимальная: кварталы складываются.
 */
const SPALNY: MapDef = {
  id: 'spalny',
  name: 'Спальный район',
  subtitle: 'хрущёвки, дворы, казарма и военторг · максимум разрушений',
  houses: [
    { kind: 'khrushchevka', pos: [-72, 0, -86], rotY: 0, sections: 3 },
    { kind: 'brezhnevka', pos: [-20, 0, -105], rotY: 0, sections: 2 },
    { kind: 'khrushchevka', pos: [30, 0, -112], rotY: Math.PI, sections: 3 },
  ],
  specials: [
    { kind: 'barracks', pos: [-58, 0, -40], rotY: 0, sections: 2 },
    { kind: 'shop', pos: [-34, 0, -47], rotY: Math.PI / 8, sections: 1 },
  ],
  points: [
    { name: 'Двор', pos: [-51, 0, -70], radius: 12 },
    // точка — ВНУТРИ казармы (её и обороняют), но в проходе: центр здания задевает
    // межсекционную стену, поэтому сдвигаем в спальный зал первой секции
    { name: 'Казарма', pos: [-56, 0, -36], radius: 10 },
    { name: 'Военторг', pos: [-34, 0, -47], radius: 9 },
    { name: 'Перекрёсток', pos: [-20, 0, -68], radius: 12 },
    { name: 'Дальний дом', pos: [8, 0, -90], radius: 13 },
  ],
  // базы сторон — вне радиусов точек, иначе «свой» спавн сразу захватывает Двор
  spawns: { own: [-64, 0.05, -80], foe: [40, 0.05, -98] },
};

/**
 * «Заводская площадка» (ТЗ п.9.2): цеха, проходная, труба, склад. Просторнее и
 * «промышленнее»: высокий цех можно проехать техникой (появится позже), застройка
 * реже — больше открытых прострелов, поэтому точки разнесены на 40+ м.
 */
const ZAVOD: MapDef = {
  id: 'zavod',
  name: 'Заводская площадка',
  subtitle: 'цеха, проходная, труба · открытые прострелы и техника',
  houses: [
    { kind: 'brezhnevka', pos: [-96, 0, -18], rotY: Math.PI / 2, sections: 2 },
    { kind: 'khrushchevka', pos: [96, 0, -26], rotY: -Math.PI / 2, sections: 2 },
  ],
  specials: [
    // главный цех — по центру, воротами на юг (к спавну игрока)
    { kind: 'workshop', pos: [0, 0, -70], rotY: 0, sections: 1 },
    // второй цех поменьше — восточнее
    { kind: 'workshop', pos: [56, 0, -44], rotY: Math.PI / 2, sections: 1 },
    { kind: 'checkpoint', pos: [-40, 0, -30], rotY: 0, sections: 1 },
    { kind: 'barracks', pos: [-58, 0, -92], rotY: 0, sections: 2 },
  ],
  points: [
    { name: 'Проходная', pos: [-40, 0, -30], radius: 9 },
    { name: 'Цех №1', pos: [0, 0, -70], radius: 16 },
    { name: 'Цех №2', pos: [56, 0, -44], radius: 13 },
    { name: 'Склад', pos: [-20, 0, -52], radius: 11 },
    { name: 'Труба', pos: [30, 0, -96], radius: 14 },
    // внутри казармы, в спальном зале первой секции (центр здания — межсекционная стена)
    { name: 'Казарма', pos: [-56, 0, -88], radius: 10 },
  ],
  spawns: { own: [-30, 0.05, -12], foe: [40, 0.05, -110] },
};

export const MAPS: MapDef[] = [SPALNY, ZAVOD];

export const MAP_POINTS: Record<string, MapPointDef[]> = Object.fromEntries(MAPS.map(m => [m.id, m.points]));

/** Карта по id (по умолчанию первая). */
export function getMap(id?: string): MapDef {
  return MAPS.find(m => m.id === id) ?? MAPS[0];
}

/** Можно выбирать карту в меню: id из URL (?map=zavod) или первая. */
export function mapFromUrl(search: string): MapDef {
  const q = new URLSearchParams(search);
  return getMap(q.get('map') ?? undefined);
}

/** Точки захвата по карте (нейтральные, с готовыми полями Match). */
export function buildCapturePoints(mapId = 'spalny'): CapturePoint[] {
  const defs = getMap(mapId).points;
  return defs.map((d, i) => ({
    id: `cp${i}`, name: d.name, pos: [...d.pos] as [number, number, number],
    radius: d.radius, owner: -1 as const, progress: 0, capturing: -1 as const,
  }));
}

/** Где появляются боты стороны: у своей базы. */
export function spawnFor(side: 0 | 1, mapId = 'spalny'): [number, number, number] {
  const m = getMap(mapId);
  return side === 0 ? [...m.spawns.own] : [...m.spawns.foe];
}
