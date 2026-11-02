// ПЛАНИРОВКА КВАРТИР (M6). Проблема: «между квартирами нет стены, мебель раскидана
// по зданию без комнат и чёткой планировки».
//
// План задан ОДИН раз в метрах от центра секции и используется двумя потребителями:
//   1) voxelgen.ts — вырезает внутренние стены и дверные проёмы в воксельной сетке;
//   2) structure.ts — расставляет мебель строго по комнатам этого плана.
// tools/plan-apartment.mjs рисует по этим же данным картинку docs/plan-2k.png —
// так что план на картинке и дом в игре не могут разойтись.
//
// Оси: X — вдоль дома (фасад слева-направо), Z — в глубину; фасад = -Z, тыл = +Z.
// Секция: 10.2 м в ширину, 10.0 м в глубину (типовая «распашонка» серии 1-464).

export type FurnitureKind =
  | 'bed' | 'table' | 'chair' | 'wardrobe' | 'sofa' | 'tv' | 'fridge' | 'shelf' | 'carpet' | 'lamp'
  | 'kitchen' | 'toilet' | 'bath' | 'sink';

export interface Room {
  id: 'living' | 'bedroom' | 'kids' | 'kitchen' | 'bath' | 'hall' | 'stairs';
  name: string;
  x0: number; x1: number;
  z0: number; z1: number;
  furniture: FurnitureKind[];
}

export interface WallSeg {
  /** начало и конец отрезка в плане */
  x0: number; z0: number; x1: number; z1: number;
  /** дверные проёмы: [от, до] по длине отрезка, отсчёт от (x0,z0) */
  doors: [number, number][];
}

export interface ApartmentPlan {
  w: number; d: number;
  rooms: Room[];
  walls: WallSeg[];
  /** точка входной двери с улицы (в плане) */
  entrance: { x: number; z: number; width: number };
  /**
   * Лестничная клетка. Ограничена РОВНО внутренними стенами прихожей, иначе шахта
   * прорезает стену квартиры и получается «между квартирами нет стены» (это уже было).
   */
  stairs: { x0: number; x1: number; z0: number; z1: number };
}

/**
 * Границы плана — их же использует генератор дома.
 * ВАЖНО: все размеры кратны шагу сетки 0.5 м, иначе крайние стены/мебель попадают
 * в наружную стену (это уже случалось: план был 10.2 м, а секция в сетке 10.0 м).
 * Стены комнат держим на 0.25 м внутри наружных.
 */
export const PLAN_X = {
  left: -4.75, corridorL: -0.9, corridorR: 1.5, right: 4.75,
  kitchenR: -2.25, bathR: 1.5,
} as const;
export const PLAN_Z = {
  facade: -4.75, hallFront: -1.25, hallBack: 1.75, back: 4.75,
} as const;

export function apartmentPlan(kind: 'khrushchevka' | 'brezhnevka' = 'khrushchevka'): ApartmentPlan {
  // глубина: 10.0 м у хрущёвки, 10.5 у брежневки (кратно 0.5 — шагу сетки)
  const D = kind === 'brezhnevka' ? 10.5 : 10.0;
  const W = 10.0;
  const dz = D - 10.0;
  const zf = PLAN_Z.facade - dz / 2, zb = PLAN_Z.back + dz / 2;
  const zHallF = PLAN_Z.hallFront - dz / 2, zHallB = PLAN_Z.hallBack + dz / 2;
  const { left, corridorL, corridorR, right, kitchenR, bathR } = PLAN_X;

  const rooms: Room[] = [
    // фасадный ряд: гостиная | входной коридор | спальня
    { id: 'living', name: 'Общая комната', x0: left, x1: corridorL, z0: zf, z1: zHallF,
      furniture: ['sofa', 'tv', 'table', 'chair', 'carpet', 'lamp'] },
    { id: 'stairs', name: 'Лестничная клетка', x0: corridorL, x1: corridorR, z0: zf, z1: zHallF, furniture: [] },
    { id: 'bedroom', name: 'Спальня', x0: corridorR, x1: right, z0: zf, z1: zHallF,
      furniture: ['bed', 'wardrobe', 'chair', 'carpet', 'lamp'] },
    // середина: прихожая во всю ширину
    { id: 'hall', name: 'Прихожая', x0: left, x1: right, z0: zHallF, z1: zHallB,
      furniture: ['wardrobe', 'shelf', 'lamp'] },
    // тыльный ряд: кухня | санузел | детская
    { id: 'kitchen', name: 'Кухня', x0: left, x1: kitchenR, z0: zHallB, z1: zb,
      furniture: ['kitchen', 'fridge', 'table', 'chair', 'sink'] },
    { id: 'bath', name: 'Санузел', x0: kitchenR, x1: bathR, z0: zHallB, z1: zb,
      furniture: ['toilet', 'bath', 'sink'] },
    { id: 'kids', name: 'Детская', x0: corridorR, x1: right, z0: zHallB, z1: zb,
      furniture: ['bed', 'shelf', 'table', 'chair', 'carpet'] },
  ];

  // Двери считаем в мировых координатах и переводим в «расстояние от начала отрезка» —
  // иначе легко промахнуться и получить дверь в простенке (это уже было).
  const hWall = (z: number, x0: number, x1: number, doorsX: [number, number][]): WallSeg => ({
    x0, z0: z, x1, z1: z,
    doors: doorsX.map(([a, b]) => [a - Math.min(x0, x1), b - Math.min(x0, x1)] as [number, number]),
  });
  const vWall = (x: number, z0: number, z1: number, doorsZ: [number, number][] = []): WallSeg => ({
    x0: x, z0, x1: x, z1,
    doors: doorsZ.map(([a, b]) => [a - Math.min(z0, z1), b - Math.min(z0, z1)] as [number, number]),
  });

  const walls: WallSeg[] = [
    // стена «фасадные комнаты | прихожая»: проём входа по центру, двери в гостиную и спальню
    hWall(zHallF, left, right, [
      [corridorL + 0.25, corridorR - 0.25],     // сквозной проход из входа в прихожую
      [left + 1.2, left + 2.2],                 // дверь в гостиную
      [right - 2.2, right - 1.2],               // дверь в спальню
    ]),
    // стена «прихожая | тыльные комнаты»: двери в кухню, санузел, детскую
    hWall(zHallB, left, right, [
      [left + 1.25, left + 2.25],          // дверь в кухню (ширина 1 м, ровно по вокселям)
      [-0.25, 0.75],                       // дверь в санузел
      [corridorR + 1.0, corridorR + 2.0],  // дверь в детскую
    ]),
    // гостиная | вход
    vWall(corridorL, zf, zHallF),
    // вход | спальня
    vWall(corridorR, zf, zHallF, [[zHallF - 1.2, zHallF - 0.3]]),
    // кухня | санузел
    vWall(kitchenR, zHallB, zb),
    // санузел | детская
    vWall(bathR, zHallB, zb),
  ];

  return {
    w: W, d: D, rooms, walls,
    entrance: { x: (corridorL + corridorR) / 2, z: zf, width: corridorR - corridorL - 0.4 },
    // внутри стен клетки, с отступом в один воксель от стены
    stairs: { x0: corridorL, x1: corridorR, z0: zf, z1: zHallF },
  };
}

/** Попадает ли точка плана в комнату. */
export function inRoom(r: Room, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 + pad && x <= r.x1 - pad && z >= r.z0 + pad && z <= r.z1 - pad;
}

/**
 * Расстановка мебели в комнате: возвращает позиции и поворот (радианы) для каждого предмета.
 * Правило простое и предсказуемое: крупные предметы — вдоль стен, стол — в центре.
 * Так планировка читается, и мебель не оказывается в дверном проёме.
 */
export function furnish(r: Room): { kind: FurnitureKind; x: number; z: number; rot: number }[] {
  const out: { kind: FurnitureKind; x: number; z: number; rot: number }[] = [];
  /** держим предмет внутри комнаты (иначе шкаф «прорезает» стену на плане и в игре) */
  const push = (kind: FurnitureKind, x: number, z: number, rot: number) => {
    const pad = 0.55;
    out.push({
      kind, rot,
      x: Math.min(Math.max(x, r.x0 + pad), r.x1 - pad),
      z: Math.min(Math.max(z, r.z0 + pad), r.z1 - pad),
    });
  };
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const inner = 0.55;            // отступ от стены (пол-ширины шкафа)
  const along: 'x' | 'z' = (r.x1 - r.x0) >= (r.z1 - r.z0) ? 'x' : 'z';
  for (const [n, kind] of r.furniture.entries()) {
    switch (kind) {
      // вдоль фасадной стены комнаты
      case 'sofa': push(kind, cx, r.z0 + inner, 0); break;
      case 'tv': push(kind, cx, r.z1 - 0.3, Math.PI); break;
      case 'bed': push(kind, r.x0 + 1.0, cz, Math.PI / 2); break;
      case 'wardrobe': push(kind, r.x1 - inner, cz, -Math.PI / 2); break;
      case 'kitchen': push(kind, r.x0 + Math.min(1.3, (r.x1 - r.x0) / 2), r.z0 + 0.4, 0); break;
      case 'fridge': push(kind, r.x1 - 0.5, r.z0 + 0.5, 0); break;
      case 'toilet': push(kind, r.x0 + 0.6, r.z0 + 0.5, 0); break;
      case 'bath': push(kind, Math.min(r.x1 - 1.0, r.x0 + 2.2), r.z0 + 0.6, 0); break;
      case 'sink': push(kind, r.x0 + 0.7, r.z1 - 0.5, Math.PI); break;
      case 'shelf': push(kind, r.x0 + inner, cz, Math.PI / 2); break;
      // в центре комнаты
      case 'table': push(kind, cx, cz + 0.2, 0); break;
      case 'chair': push(kind, cx + (along === 'x' ? 0.75 : 0), cz + (along === 'x' ? 0.2 : 0.75), Math.PI); break;
      case 'carpet': push(kind, cx, cz - 0.1, 0); break;
      case 'lamp': push(kind, r.x1 - 0.5, r.z1 - 0.5, 0); break;
    }
    void n;
  }
  return out;
}
