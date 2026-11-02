// КАРТЫ (ТЗ п.9): точки захвата и расстановка на советской местности.
//
// Пока карта одна — «Спальный район» (та, что уже есть в игре: хрущёвки, брежневка,
// казарма, военторг на снегу). Остальные карты из ТЗ появятся, когда будет готов
// генератор местности; точки захвата описаны данными, поэтому добавить новую карту —
// это добавить запись в MAP_POINTS, а не переписывать режим.
import type { CapturePoint } from './match.ts';
import { BUILDINGS } from './world.ts';

export interface MapPointDef {
  name: string;
  /** позиция в мире */
  pos: [number, number, number];
  radius: number;
}

export interface MapDef {
  id: string;
  name: string;
  points: MapPointDef[];
}

/**
 * «Спальный район»: 5 точек — двор у подъездов, казарма, военторг, перекрёсток и
 * дальний дом. Точки намеренно не в одну линию: атака идёт с двух направлений.
 */
export const MAPS: MapDef[] = [
  {
    id: 'spalny', name: 'Спальный район',
    points: [
      { name: 'Двор', pos: [-51, 0, -70], radius: 14 },
      { name: 'Казарма', pos: [-58, 0, -46], radius: 11 },
      { name: 'Военторг', pos: [-34, 0, -47], radius: 9 },
      { name: 'Перекрёсток', pos: [-20, 0, -68], radius: 12 },
      { name: 'Дальний дом', pos: [8, 0, -90], radius: 13 },
    ],
  },
];

export const MAP_POINTS: Record<string, MapPointDef[]> = Object.fromEntries(MAPS.map(m => [m.id, m.points]));

/** Точки захвата по карте (нейтральные, с готовыми полями Match). */
export function buildCapturePoints(mapId = 'spalny'): CapturePoint[] {
  const defs = MAP_POINTS[mapId] ?? MAPS[0].points;
  return defs.map((d, i) => ({
    id: `cp${i}`, name: d.name, pos: [...d.pos] as [number, number, number],
    radius: d.radius, owner: -1 as const, progress: 0, capturing: -1 as const,
  }));
}

/** Где появляются боты стороны: у своей базы, не на точке (иначе мгновенный захват). */
export function spawnFor(side: 0 | 1): [number, number, number] {
  // своя сторона — у первого дома (там же спавн игрока), противник — у дальнего конца карты
  const b = BUILDINGS[BUILDINGS.length - 1];
  return side === 0 ? [-60, 0.05, -72] : [b.pos[0] + 10, 0.05, b.pos[2] + 14];
}
