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
  /** подпись на плане и в игре, если отличается от типа («Магазин» вместо «Военторг») */
  label?: string;
}

export interface MapDef {
  id: string;
  name: string;
  /** подпись карты в меню */
  subtitle: string;
  houses: HouseDef[];
  specials: SpecialDef[];
  points: MapPointDef[];
  /** улицы и дворовые проезды (см. streets.ts). Если нет — карта без дорог */
  streets?: { name?: string; x0: number; z0: number; x1: number; z1: number; lane?: boolean }[];
  /** предметы двора: деревья, лавки, площадка, гаражи, машины, забор (dressing.ts) */
  dressing?: { kind: string; pos: [number, number, number]; rotY?: number; color?: string }[];
  /** где появляется игрок (если не задано — считается из первого дома, как раньше) */
  playerSpawn?: [number, number, number];
  /** базы сторон для ботов */
  spawns: { own: [number, number, number]; foe: [number, number, number] };
}

/**
 * «Спальный район» — ПО ПЛАНУ ПОЛЬЗОВАТЕЛЯ (docs/plan-city-spalny.png).
 *
 * Раскладка повторяет схему квартала: две линии застройки по бокам, квартал бараков
 * в центре, магазин у перекрёстка на северо-востоке. Границы квартала — улицы
 * Ленина (север), Космонавтов (юг), Советская (запад), Гагарина (восток).
 *
 * Порядок домов в списке = порядок на плане (слева-направо, сверху вниз), чтобы
 * сверять карту со схемой было просто. Ориентация: rotY = 0 — дом длинной стороной
 * вдоль X (восток-запад), Math.PI / 2 — вдоль Z (север-юг).
 */
const SPALNY: MapDef = {
  id: 'spalny',
  name: 'Спальный район',
  subtitle: 'хрущёвки, брежневки, квартал бараков и магазин · максимум разрушений',
  houses: [
    // верхняя линия (вдоль ул. Ленина): две хрущёвки, между ними точка A
    { kind: 'khrushchevka', pos: [-50, 0, -44], rotY: 0, sections: 3 },          // 36 × 10.5
    { kind: 'khrushchevka', pos: [4, 0, -45], rotY: 0, sections: 2 },            // 24 × 10.5
    // середина слева: длинная брежневка, под ней сквер с точкой B
    { kind: 'brezhnevka', pos: [-58, 0, -23], rotY: 0, sections: 4 },            // 48 × 11
    // справа по центру: хрущёвка, повёрнутая вдоль Гагарина (на плане — вертикальная)
    { kind: 'khrushchevka', pos: [20, 0, -15], rotY: Math.PI / 2, sections: 3 }, // 10.5 × 36
    // нижняя линия (вдоль ул. Космонавтов): две брежневки, между ними точка D
    { kind: 'brezhnevka', pos: [-58, 0, 28], rotY: 0, sections: 4 },             // 48 × 11
    { kind: 'brezhnevka', pos: [10, 0, 28], rotY: 0, sections: 4 },              // 48 × 11
  ],
  specials: [
    // МАГАЗИН (на плане — красный дом с буквой M) у перекрёстка Ленина / Гагарина
    { kind: 'shop', pos: [40, 0, -44], rotY: 0, sections: 2, label: 'Магазин' },  // 24 × 8
    // КВАРТАЛ БАРАКОВ в центре: два длинных одноэтажных барака (на плане — коричневые)
    { kind: 'barracks', pos: [-8, 0, -18], rotY: 0, sections: 2, label: 'Барак' },   // 24 × 12
    { kind: 'barracks', pos: [0, 0, 1.5], rotY: 0, sections: 2, label: 'Барак' },    // 24 × 12
  ],
  points: [
    // A — двор с песочницей между верхними хрущёвками
    { name: 'Двор с песочницей', pos: [-20, 0, -44], radius: 10 },
    // B — сквер у брежневки (на плане — площадка с фонтаном)
    { name: 'Сквер', pos: [-54, 0, 2], radius: 11 },
    // C — площадка у магазина, между хрущёвкой и Гагарина
    { name: 'Магазин', pos: [38, 0, -5], radius: 10 },
    // D — детская площадка на юге (на плане — качели)
    { name: 'Детская площадка', pos: [-18, 0, 29], radius: 10 },
    // Квартал бараков — в проходе между двумя бараками
    { name: 'Бараки', pos: [-4, 0, -8], radius: 9 },
  ],
  /**
   * УЛИЦЫ по плану: четыре по периметру квартала + дворовые проезды между домами.
   * Ширина проезжей части 10 м (две полосы), проезды внутри — 6 м.
   */
  streets: [
    // ул. Ленина (север), ул. Космонавтов (юг) — за пределами домов
    { name: 'ул. Ленина', x0: -96, z0: -70, x1: 60, z1: -58 },
    { name: 'ул. Космонавтов', x0: -96, z0: 48, x1: 60, z1: 60 },
    // ул. Советская (запад), ул. Гагарина (восток)
    { name: 'ул. Советская', x0: -100, z0: -70, x1: -88, z1: 60 },
    { name: 'ул. Гагарина', x0: 62, z0: -70, x1: 74, z1: 60 },
    // дворовые проезды (между домами, 6 м)
    { x0: -88, z0: 8, x1: 62, z1: 14, lane: true },          // между бараками и южными домами
    { x0: -88, z0: -36, x1: 10, z1: -30, lane: true },       // между верхними хрущёвками и брежневкой
    { x0: -32, z0: -58, x1: -26, z1: 8, lane: true },        // поперечный у точки A
    { x0: 16, z0: -48, x1: 24, z1: -40, lane: true },        // проезд к магазину, восточнее хрущёвки
  ],
  /** ДВОР по плану: деревья вдоль улиц и в сквере, гаражи, площадка, машины, забор бараков */
  dressing: [
    // --- детская площадка у точки D (на плане — качели и песочница)
    { kind: 'playground', pos: [-24, 0, 26], rotY: 0 },

    // --- гаражи у восточной линии (на плане — ряд гаражей у Гагарина)
    { kind: 'garage', pos: [48, 0, 1], rotY: 0 },
    { kind: 'garage', pos: [48, 0, 7.5], rotY: 0 },
    { kind: 'garage', pos: [48, 0, 14], rotY: 0 },

    // --- киоск и остановка у магазина
    { kind: 'kiosk', pos: [30, 0, -52], rotY: 0.2 },

    // --- машины во дворах (на плане стоят вдоль домов)
    { kind: 'car', pos: [-82, 0, -2], rotY: 0, color: '#7a3a3a' },
    { kind: 'car', pos: [-80, 0, -14], rotY: 0, color: '#3a4a6a' },
    { kind: 'car', pos: [56, 0, -24], rotY: Math.PI / 2, color: '#c9c4a8' },
    { kind: 'car', pos: [30, 0, 38], rotY: 0, color: '#2e2e30' },
    { kind: 'bus', pos: [-52, 0, 22], rotY: 0 },
    { kind: 'car', pos: [-72, 0, 22], rotY: 0, color: '#4a5a3a' },

    // --- лавки и урны в сквере (точка B)
    { kind: 'bench', pos: [-62, 0, -6], rotY: 0 },
    { kind: 'bench', pos: [-46, 0, -6], rotY: Math.PI },
    { kind: 'bin', pos: [-65, 0, -4.6], rotY: 0 },
    { kind: 'bin', pos: [-43, 0, -4.6], rotY: 0 },

    // --- фонари по проездам
    { kind: 'lamp', pos: [-26, 0, -30], rotY: 0 },
    { kind: 'lamp', pos: [-26, 0, 20], rotY: 0 },
    { kind: 'lamp', pos: [34, 0, -30], rotY: Math.PI },
    { kind: 'lamp', pos: [34, 0, 20], rotY: Math.PI },

    // --- забор вокруг квартала бараков (на плане — пунктирный контур):
    //     по восточной стороне, от проезда до проезда
    { kind: 'fence', pos: [26, 0, -14], rotY: Math.PI / 2 },
    { kind: 'fence', pos: [26, 0, -11.6], rotY: Math.PI / 2 },
    { kind: 'fence', pos: [26, 0, -9.2], rotY: Math.PI / 2 },
    { kind: 'fence', pos: [26, 0, 2], rotY: Math.PI / 2 },
    { kind: 'fence', pos: [26, 0, 4.4], rotY: Math.PI / 2 },
    { kind: 'fence', pos: [26, 0, 6.8], rotY: Math.PI / 2 },

    // --- деревья: вдоль улиц и в сквере (ровные аллеи, как на плане)
    // аллея вдоль Ленина (северный газон, до асфальта)
    ...[-84, -71, -58, -45, -32, -19, -6, 7, 33, 46].map(x => ({ kind: (x % 3 ? 'tree' : 'tree_snow') as string, pos: [x, 0, -54] as [number, number, number], rotY: 0 })),
    // аллея вдоль Космонавтов (южный газон)
    ...Array.from({ length: 10 }, (_, i) => ({ kind: 'tree_snow', pos: [-86 + i * 14, 0, 42] as [number, number, number], rotY: 0 })),
    // вдоль Советской (западный газон, восточнее асфальта)
    ...Array.from({ length: 7 }, (_, i) => ({ kind: 'tree', pos: [-82, 0, -42 + i * 12] as [number, number, number], rotY: 0 })),
    // вдоль Гагарина (восточный газон, западнее асфальта)
    ...Array.from({ length: 7 }, (_, i) => ({ kind: 'tree_snow', pos: [54, 0, -42 + i * 12] as [number, number, number], rotY: 0 })),
    // сквер у точки B — деревья по краям, центр свободен
    ...Array.from({ length: 4 }, (_, i) => ({ kind: 'tree', pos: [-68 + i * 6, 0, -10] as [number, number, number], rotY: 0 })),
    // двор у песочницы (точка A) — по краям двора
    ...[-22, -16, -10].map(x => ({ kind: 'tree_snow' as const, pos: [x, 0, -37] as [number, number, number], rotY: 0 })),
    ...Array.from({ length: 4 }, (_, i) => ({ kind: 'tree', pos: [-16 + i * 6, 0, -24] as [number, number, number], rotY: 0 })),
  ],
  // базы: своя — на Советской (запад), враг — за Гагарина (восток)
  spawns: { own: [-94, 0.05, 24], foe: [68, 0.05, -24] },
  /** игрок появляется на Советской, лицом в квартал */
  playerSpawn: [-94, 0.05, -4],
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
