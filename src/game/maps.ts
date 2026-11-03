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

/** Мишень на стрельбище: стенд полигона (не боевая карта). */
export interface TargetDef {
  kind: 'soldier_ussr' | 'soldier_opfor' | 'crate' | 'barrel';
  pos: [number, number, number];
  rotY?: number;
}

export interface MapDef {
  id: string;
  name: string;
  /** подпись карты в меню */
  subtitle: string;
  /**
   * Тип карты:
   *  - `combat`   — играбельная боевая карта (режим «Штурм», базы, точки, техника);
   *  - `training` — полигон/стрельбище: ни режима, ни баз, ни техники, зато есть
   *                 стенды и мишени. Пользователь: «убери технику и стенды с предметами
   *                 из спального района... и добавь отдельную карту полигона».
   */
  mode?: 'combat' | 'training';
  /**
   * Размер игрового мира, м (ТЗ п.9: 2×2 км у города/завода, 4×4 у «Пригорода»,
   * 3×3 у порта). Влияет на сетку террейна и физику земли.
   */
  size?: number;
  /** Физика воды (ТЗ п.4.5): река/залив с уровнем и течением. */
  water?: { level: number; x0: number; z0: number; x1: number; z1: number; flow?: [number, number]; depth?: number };
  houses: HouseDef[];
  specials: SpecialDef[];
  points: MapPointDef[];
  /** улицы и дворовые проезды (см. streets.ts). Если нет — карта без дорог */
  streets?: { name?: string; x0: number; z0: number; x1: number; z1: number; lane?: boolean }[];
  /** предметы двора: деревья, лавки, площадка, гаражи, машины, забор (dressing.ts) */
  dressing?: { kind: string; pos: [number, number, number]; rotY?: number; color?: string }[];
  /** где появляется игрок (если не задано — считается из первого дома, как раньше) */
  playerSpawn?: [number, number, number];
  /** мишени стрельбища (только training) */
  targets?: TargetDef[];
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

/**
 * «ПОЛИГОН» — отдельная НЕБОЕВАЯ карта (mode: 'training').
 *
 * Зачем отдельно: раньше выставка всех ассетов (ряды техники, стол с оружием, рампы,
 * башня, мишени) жила ПРЯМО В спальном районе и на заводе — `buildPolygon()` вызывался
 * на каждой карте. Пользователь попросил это убрать: «это уже играбельные карты».
 * Теперь выставка принадлежит полигону, а данные карты описывают стрельбище:
 * секторы, валы, мишени.
 *
 * Раскладка (X — восток, Z — юг, ноль — центр):
 *   • своя база и точка старта — запад (−80…−60);
 *   • сектор пистолета/автомата — 25/50/100 м от линии огня (x от −40);
 *   • сектор снайперки — 300 м на восток (только СВД/РПГ);
 *   • рампы и склоны, башня для урона от падения — центр;
 *   • выставка техники и оружия — север (z < −10), стенды.
 */
const POLIGON: MapDef = {
  id: 'poligon',
  name: 'Полигон',
  subtitle: 'стрельбище и выставка техники · не боевая карта',
  mode: 'training',
  houses: [],
  specials: [],
  // «точки» здесь не захватываются: это подписи секторов, radius 0 — не цель.
  points: [
    { name: 'Огонь 25 м', pos: [-31, 0, 0], radius: 0 },
    { name: 'Огонь 50 м', pos: [-6, 0, 0], radius: 0 },
    { name: 'Огонь 100 м', pos: [44, 0, 0], radius: 0 },
    { name: 'Вал 200 м', pos: [144, 0, 0], radius: 0 },
    { name: 'Выставка техники', pos: [-40, 0, -48], radius: 0 },
  ],
  streets: [
    // бетонка вдоль линии огня (x −60…40) и подъезд к выставке (север)
    { name: 'Линия огня', x0: -60, z0: -6, x1: 40, z1: 2 },
    { name: 'Проезд к выставке', x0: -46, z0: -46, x1: -34, z1: -6, lane: true },
  ],
  /**
   * МИШЕНИ ПО ДИСТАНЦИЯМ. Линия огня — западный край бетонки, x = −56 (там игрок
   * стоит и стреляет). Тогда 25 м → x = −31, 50 м → −6, 100 м → 44, 200 м → 144.
   * Стрельбище смотрит на восток.
   */
  targets: [
    ...[-16, -2, 12].map((z, i) => ({ kind: (i % 2 ? 'soldier_opfor' : 'soldier_ussr') as TargetDef['kind'], pos: [-31, 0, z] as [number, number, number], rotY: -Math.PI / 2 })),
    ...[-16, -2, 12].map((z, i) => ({ kind: (i % 2 ? 'soldier_ussr' : 'soldier_opfor') as TargetDef['kind'], pos: [-6, 0, z] as [number, number, number], rotY: -Math.PI / 2 })),
    ...[-16, -2, 12].map((z, i) => ({ kind: (i % 2 ? 'soldier_opfor' : 'soldier_ussr') as TargetDef['kind'], pos: [44, 0, z] as [number, number, number], rotY: -Math.PI / 2 })),
    // дальний вал 200 м: ящики (их видно, попасть трудно)
    ...[-10, 0, 10].map(z => ({ kind: 'crate' as TargetDef['kind'], pos: [144, 0, z] as [number, number, number] })),
  ],
    // баз на полигоне нет: бой не идёт, спавны — только чтобы интерфейсу было что взять
  spawns: { own: [-56, 0.05, -2], foe: [144, 0.05, 0] },
  playerSpawn: [-56, 0.05, -2],
};


/**
 * «ПРИГОРОД» (ТЗ п.9.3) — 4×4 км, самый большой полигон для техники и авиации.
 *
 * По ТЗ на карте: поля, колхоз, река, мост, военная база, дачный посёлок.
 * Игровая зона — 800 м (в два раза больше города), поэтому:
 *   • река пересекает карту с севера на юг по x ≈ −60…−30, мост — единственная
 *     переправа для техники (ТЗ: мост как тактическая точка);
 *   • военная база на востоке (казарма, проходная, техника) — база врага;
 *   • колхоз на западе: два барака-склада и мастерская;
 *   • дачный посёлок на юге: маленькие дома-панельки по 1 секции;
 *   • поля — это dressing (плетни, стога нет — зима), а дороги — просёлки.
 *
 * Вода задаётся данными `water` (см. water.ts): уровень 0, глубина 3.2 м, течение
 * вдоль Z. Без моста реку пешком можно переплыть (кислород/плавучесть работают), а
 * техника — только по мосту или вброд у мелководья.
 */
const PRIGOROD: MapDef = {
  id: 'prigorod',
  name: 'Пригород',
  subtitle: 'поля, колхоз, река с мостом, военная база · 4×4 км',
  size: 800,
  houses: [
    // --- дачный посёлок (юг): маленькие дома по одной секции
    { kind: 'khrushchevka', pos: [-180, 0, 210], rotY: 0, sections: 1 },
    { kind: 'khrushchevka', pos: [-150, 0, 250], rotY: Math.PI / 2, sections: 1 },
    { kind: 'khrushchevka', pos: [-120, 0, 205], rotY: 0, sections: 1 },
    { kind: 'khrushchevka', pos: [-100, 0, 248], rotY: Math.PI / 2, sections: 1 },
    { kind: 'khrushchevka', pos: [-190, 0, 258], rotY: 0, sections: 1 },
    // --- военная база (восток): две брежневки-общежития
    { kind: 'brezhnevka', pos: [210, 0, -60], rotY: Math.PI / 2, sections: 2 },
    { kind: 'brezhnevka', pos: [210, 0, 20], rotY: Math.PI / 2, sections: 2 },
  ],
  specials: [
    // --- колхоз (запад): склады-бараки и мастерская
    { kind: 'barracks', pos: [-250, 0, -20], rotY: 0, sections: 2, label: 'Склад колхоза' },
    { kind: 'barracks', pos: [-250, 0, 20], rotY: 0, sections: 2, label: 'Коровник' },
    { kind: 'workshop', pos: [-200, 0, 80], rotY: Math.PI / 2, sections: 1, label: 'МТС' },
    // --- военная база: казарма и КПП
    { kind: 'barracks', pos: [200, 0, -140], rotY: 0, sections: 3, label: 'Казарма' },
    { kind: 'checkpoint', pos: [150, 0, -40], rotY: Math.PI / 2, sections: 2, label: 'КПП базы' },
  ],
  points: [
    { name: 'Мост через реку', pos: [-40, 0, 0], radius: 14 },      // тактическая точка ТЗ
    { name: 'Колхозный двор', pos: [-235, 0, 0], radius: 12 },
    { name: 'Дачи', pos: [-145, 0, 230], radius: 12 },
    { name: 'Военная база', pos: [200, 0, -70], radius: 13 },
    { name: 'Брод', pos: [-60, 0, 130], radius: 10 },               // мелководье: техника проходит
  ],
  streets: [
    // шоссе вдоль реки (север-юг) и просёлки к базе и колхозу
    { name: 'Шоссе', x0: -24, z0: -300, x1: -10, z1: 300 },
    { name: 'Просёлок к базе', x0: -10, z0: -20, x1: 140, z1: -8 },
    { name: 'Просёлок к колхозу', x0: -110, z0: -8, x1: -24, z1: 4, lane: true },
    { name: 'Дорожка к дачам', x0: -110, z0: 4, x1: -98, z1: 230, lane: true },
    { name: 'Мост', x0: -62, z0: -6, x1: -24, z1: 6 },
  ],
  /**
   * РЕКА (ТЗ п.4.5): уровень 0, глубина 3.2 м, течение на юг. Мост стоит поперёк
   * (x −62…−24, z −6…6), поэтому переправа есть, но она одна — как в ТЗ.
   */
  water: { level: 0, x0: -70, z0: -300, x1: -26, z1: 300, flow: [0, 0.9], depth: 3.2 },
  dressing: [
    // --- мост: настил и перила (переправа для техники)
    { kind: 'bridge', pos: [-48, 0, 0], rotY: 0 },
    // --- колхоз: плетни, скирды (зимой — снежные бугры), техника
    { kind: 'car', pos: [-260, 0, -2], rotY: 0, color: '#4a5a3a' },
    { kind: 'bus', pos: [-230, 0, 40], rotY: Math.PI / 2 },
    { kind: 'garage', pos: [-280, 0, 60], rotY: 0 },
    { kind: 'garage', pos: [-280, 0, 68], rotY: 0 },
    { kind: 'fence', pos: [-220, 0, -34], rotY: 0 },
    { kind: 'fence', pos: [-217.6, 0, -34], rotY: 0 },
    { kind: 'fence', pos: [-215.2, 0, -34], rotY: 0 },
    // --- военная база: ряд гаражей, вышка-фонарь, машины
    { kind: 'garage', pos: [160, 0, -100], rotY: Math.PI / 2 },
    { kind: 'garage', pos: [160, 0, -92], rotY: Math.PI / 2 },
    { kind: 'garage', pos: [160, 0, -84], rotY: Math.PI / 2 },
    { kind: 'car', pos: [175, 0, -30], rotY: 0, color: '#3a4a3a' },
    { kind: 'lamp', pos: [120, 0, -24], rotY: 0 },
    { kind: 'lamp', pos: [190, 0, -24], rotY: 0 },
    // --- дачи: колодец, детская площадка, лавки, плетни
    { kind: 'well', pos: [-135, 0, 232], rotY: 0 },
    { kind: 'playground', pos: [-165, 0, 268], rotY: 0 },
    { kind: 'bench', pos: [-180, 0, 200], rotY: 0 },
    { kind: 'bench', pos: [-150, 0, 240], rotY: Math.PI },
    { kind: 'fence', pos: [-170, 0, 195], rotY: 0 },
    { kind: 'fence', pos: [-167.6, 0, 195], rotY: 0 },
    // --- поля: редкие деревья по межам (аллеи вдоль шоссе)
    ...Array.from({ length: 12 }, (_, i) => ({ kind: 'tree_snow', pos: [-2, 0, -280 + i * 48] as [number, number, number], rotY: 0 })),
    ...Array.from({ length: 10 }, (_, i) => ({ kind: 'tree_snow', pos: [-34, 0, -260 + i * 55] as [number, number, number], rotY: 0 })),
    ...Array.from({ length: 8 }, (_, i) => ({ kind: 'tree', pos: [100 + i * 20, 0, 40] as [number, number, number], rotY: 0 })),
    ...[-150, -130, -110, -90, -70, -50, -30, -10].filter(x => x < -56 || x > -40).map(x => ({ kind: 'tree' as const, pos: [x, 0, 178] as [number, number, number], rotY: 0 })),
    ...Array.from({ length: 6 }, (_, i) => ({ kind: 'tree_snow', pos: [-270, 0, -80 + i * 40] as [number, number, number], rotY: 0 })),
  ],
  // своя сторона — запад (колхоз), враг — военная база на востоке
  spawns: { own: [-300, 0.05, 0], foe: [300, 0.05, -40] },
  playerSpawn: [-300, 0.05, 0],
};

/** План порта: набережная на юге, склады в центре, жилые кварталы на севере. */
const PORT: MapDef = {
  id: 'port', name: 'Портовый город',
  subtitle: 'зимняя набережная, краны, склады и жилые кварталы', size: 600,
  water: { level: 0, x0: -280, x1: 280, z0: 110, z1: 300, depth: 5 },
  houses: [
    { kind: 'khrushchevka', pos: [-170, 0, -160], rotY: 0, sections: 3 },
    { kind: 'brezhnevka', pos: [-90, 0, -160], rotY: 0, sections: 3 },
    { kind: 'khrushchevka', pos: [80, 0, -160], rotY: 0, sections: 3 },
    { kind: 'brezhnevka', pos: [160, 0, -160], rotY: 0, sections: 3 },
  ],
  specials: [
    { kind: 'workshop', pos: [-130, 0, -30], rotY: 0, sections: 2, label: 'Склад запад' },
    { kind: 'workshop', pos: [120, 0, -30], rotY: 0, sections: 2, label: 'Склад восток' },
    { kind: 'checkpoint', pos: [0, 0, -100], rotY: 0, sections: 1, label: 'Проходная' },
    { kind: 'barracks', pos: [-175, 0, 35], rotY: 0, sections: 2, label: 'Портовый склад' },
    { kind: 'shop', pos: [160, 0, -110], rotY: 0, sections: 1, label: 'Магазин' },
  ],
  streets: [
    { name: 'Набережная', x0: -240, x1: 240, z0: 60, z1: 74 },
    { name: 'Портовая', x0: -220, x1: 220, z0: -76, z1: -64 },
    { name: 'Западный проезд', x0: -220, x1: -208, z0: -200, z1: 60 },
    { name: 'Восточный проезд', x0: 208, x1: 220, z0: -200, z1: 60 },
    { name: 'Жилая улица', x0: -200, x1: 200, z0: -205, z1: -193 },
  ],
  points: [
    { name: 'Западный склад', pos: [-150, 0, -55], radius: 12 },
    { name: 'Проходная', pos: [0, 0, -75], radius: 12 },
    { name: 'Восточный склад', pos: [140, 0, -55], radius: 12 },
    { name: 'Набережная', pos: [0, 0, 67], radius: 14 },
    { name: 'Жилой квартал', pos: [0, 0, -160], radius: 12 },
  ],
  dressing: [
    { kind: 'quay', pos: [0, 0, 100] },
    { kind: 'crane', pos: [-120, 0, 90] },
    { kind: 'crane', pos: [100, 0, 90] },
    ...[-70, -62, -54, 45, 53, 61].map(x => ({ kind: 'container', pos: [x, 0, 25] as [number, number, number], color: x < 0 ? '#6b7061' : '#83594d' })),
    { kind: 'garage', pos: [-190, 0, -110] },
    { kind: 'car', pos: [-130, 0, -120], color: '#555c60' },
    { kind: 'playground', pos: [-35, 0, -135] },
    ...[-180, -120, -60, 60, 120, 180].map(x => ({ kind: 'lamp', pos: [x, 0, 80] as [number, number, number] })),
    ...[-150, -115, -80, 80, 115, 150].map(x => ({ kind: 'tree_snow', pos: [x, 0, -180] as [number, number, number] })),
  ],
  spawns: { own: [-245, 0.05, -120], foe: [245, 0.05, -120] },
  playerSpawn: [-245, 0.05, -120],
};

export const MAPS: MapDef[] = [SPALNY, ZAVOD, PRIGOROD, PORT, POLIGON];

/** Играбельные (боевые) карты: только они попадают в выбор режима. */
export const COMBAT_MAPS = MAPS.filter(m => (m.mode ?? 'combat') === 'combat');

/** Это полигон/стрельбище, а не бой? */
export const isTraining = (mapId?: string) => getMap(mapId).mode === 'training';

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
