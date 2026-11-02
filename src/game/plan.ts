// ПЛАНИРОВКА КВАРТИР (M7). План задан ОДИН раз в метрах от центра секции и используется:
//   1) voxelgen.ts — режет внутренние стены, дверные проёмы и окна в воксельной сетке;
//   2) structure.ts — расставляет мебель строго по комнатам этого плана;
//   3) staircase.ts — ставит проходимую лестницу в клетке плана;
//   4) tools/plan-apartment.mjs рисует docs/plan-2k.png по этим же данным.
// План на картинке и дом в игре физически не могут разойтись.
//
// Планировка (секция 12 × 10.5 м, 3-комнатная квартира на этаже):
//
//        фасад (вход в подъезд, z = -5.25)
//   ┌───────────┬───────────┬───────────┬───────────┐
//   │ лестничная│ прихожая  │  гостиная │  спальня  │  z = -5.25 … 1.0
//   │ клетка    │ (вход)    │           │           │
//   ├───────────┼───────────┼───────────┴───────────┤
//   │  кухня    │ санузел   │  детская  │ кабинет   │  z = 1.0 … 5.25
//   └───────────┴───────────┴───────────┴───────────┘
//        тыл (z = +5.25)
//
// Почему так, а не «клетка в центре фасада» (было в M6): клетка в центре перекрывала
// вход — улица упиралась в стену лестницы, а лестница из вокселей имела ступень 0.5 м
// (выше шага персонажа 0.4 м), поэтому внутрь было не зайти. Теперь:
//   - вход в подъезд — в фасаде лестничной клетки у края дома;
//   - из клетки дверь в прихожую, из прихожей — во все комнаты;
//   - лестница отдельная (staircase.ts) с подступом 0.17 м.
//
// Правила, которые проверяет tools/test-apartment.mjs:
//   - комнаты покрывают секцию без щелей и не перекрываются;
//   - все координаты — на сетке вокселей 0.5 м;
//   - у каждой жилой комнаты и кухни есть окно на наружной стене;
//   - из любой комнаты есть путь до входа по дверям (граф связности);
//   - дверные проёмы не попадают в углы/пересечения стен.

export type FurnitureKind =
  | 'bed' | 'table' | 'chair' | 'wardrobe' | 'sofa' | 'tv' | 'fridge' | 'shelf' | 'carpet' | 'lamp'
  | 'kitchen' | 'toilet' | 'bath' | 'sink' | 'desk';

export interface Room {
  id: 'living' | 'bedroom' | 'kids' | 'study' | 'kitchen' | 'bath' | 'hall' | 'stairs';
  name: string;
  x0: number; x1: number;
  z0: number; z1: number;
  furniture: FurnitureKind[];
}

export interface WallSeg {
  /** отрезок стены по осевой линии (координаты — центры вокселей) */
  x0: number; z0: number; x1: number; z1: number;
  /** дверные проёмы: [от, до] по длине отрезка, отсчёт от (x0,z0) */
  doors: [number, number][];
}

export interface WindowSeg {
  /** ось окна: горизонтальная стена на z = z, от x0 до x1 */
  x0: number; x1: number; z: number;
  /** какая сторона дома: фасад (-Z) или тыл (+Z) */
  side: 'facade' | 'back';
}

export interface ApartmentPlan {
  w: number; d: number;
  rooms: Room[];
  walls: WallSeg[];
  windows: WindowSeg[];
  /** входная дверь с улицы (в плане) */
  entrance: { x: number; z: number; width: number };
  /** лестничная клетка — ровно внутренний объём между стенами */
  stairs: { x0: number; x1: number; z0: number; z1: number };
}

/**
 * Осевые линии стен секции. Все значения — центры вокселей сетки 0.5 м:
 * сетка идёт с шагом 0.5 от центра секции, поэтому координаты кратны 0.5 + 0.25.
 * w = 12.0 → наружные стены в x = ±5.75; d = 10.5 → в z = ±5.0.
 */
export const PLAN_X = {
  left: -5.75, stairR: -2.75, hallR: -0.75, midR: 2.75, right: 5.75,
} as const;
export const PLAN_Z = {
  facade: -5.0, /** граница фасадного и заднего ряда */ mid: 1.0, back: 5.0,
  /** конец прихожей: дальше санузел */ hallBack: 2.0,
} as const;

export function apartmentPlan(kind: 'khrushchevka' | 'brezhnevka' = 'khrushchevka'): ApartmentPlan {
  // глубина: 10.5 м у хрущёвки, 11.0 у брежневки (кратно шагу сетки 0.5)
  const D = kind === 'brezhnevka' ? 11.0 : 10.5;
  const W = 12.0;
  const dExtra = D - 10.5;
  const zf = PLAN_Z.facade - dExtra / 2;         // фасад
  const zb = PLAN_Z.back + dExtra / 2;           // тыл
  const zm = PLAN_Z.mid;                          // фасадный | задний ряд
  const zHallBack = PLAN_Z.hallBack;              // прихожая | санузел
  const { left, stairR, hallR, midR, right } = PLAN_X;

  const rooms: Room[] = [
    // фасадный ряд
    { id: 'stairs', name: 'Лестничная клетка', x0: left, x1: stairR, z0: zf, z1: zm,
      furniture: [] },
    { id: 'hall', name: 'Прихожая', x0: stairR, x1: hallR, z0: zf, z1: zHallBack,
      furniture: ['wardrobe', 'shelf', 'lamp'] },
    { id: 'living', name: 'Гостиная', x0: hallR, x1: midR, z0: zf, z1: zm,
      furniture: ['sofa', 'tv', 'table', 'chair', 'carpet', 'lamp'] },
    { id: 'bedroom', name: 'Спальня', x0: midR, x1: right, z0: zf, z1: zm,
      furniture: ['bed', 'wardrobe', 'chair', 'carpet', 'lamp'] },
    // задний ряд
    { id: 'kitchen', name: 'Кухня', x0: left, x1: stairR, z0: zm, z1: zb,
      furniture: ['kitchen', 'fridge', 'table', 'chair', 'sink'] },
    { id: 'bath', name: 'Санузел', x0: stairR, x1: hallR, z0: zHallBack, z1: zb,
      furniture: ['toilet', 'bath', 'sink'] },
    { id: 'kids', name: 'Детская', x0: hallR, x1: midR, z0: zm, z1: zb,
      furniture: ['bed', 'shelf', 'table', 'chair', 'carpet'] },
    { id: 'study', name: 'Кабинет', x0: midR, x1: right, z0: zm, z1: zb,
      furniture: ['desk', 'shelf', 'chair', 'carpet', 'lamp'] },
  ];

  /** горизонтальная стена (вдоль X) на z; проёмы задаются в мировых X */
  const hWall = (z: number, x0: number, x1: number, doorsX: [number, number][]): WallSeg => ({
    x0, z0: z, x1, z1: z,
    doors: doorsX.map(([a, b]) => [a - Math.min(x0, x1), b - Math.min(x0, x1)] as [number, number]),
  });
  /** вертикальная стена (вдоль Z) на x; проёмы задаются в мировых Z */
  const vWall = (x: number, z0: number, z1: number, doorsZ: [number, number][] = []): WallSeg => ({
    x0: x, z0, x1: x, z1,
    doors: doorsZ.map(([a, b]) => [a - Math.min(z0, z1), b - Math.min(z0, z1)] as [number, number]),
  });

  const walls: WallSeg[] = [
    // клетка | прихожая: дверь КВАРТИРЫ — прямо у фасадной площадки лестницы.
    // Это важно физически: на верхних этажах в клетке нет пола, кроме площадок,
    // и выходить на этаж нужно с фасадной площадки, а не через провал шахты.
    vWall(stairR, zf, zm, [[zf + 0.5, zf + 1.5]]),
    // клетка | кухня: глухая стена
    hWall(zm, left, stairR, []),
    // прихожая | кухня (короткий участок стены x = stairR за санузлом).
    // Дверь держим по центру участка: угол z = hallBack занят поперечной стеной,
    // и проём «в угол» просто закладывался её вокселем (это ловил тест).
    vWall(stairR, zm, zHallBack, [[zm + 0.35, zHallBack - 0.35]]),
    // прихожая | санузел — дверь в конце коридора
    hWall(zHallBack, stairR, hallR, [[stairR + 0.25, stairR + 1.15]]),
    // прихожая | гостиная
    vWall(hallR, zf, zm, [[zf + 1.5, zf + 2.5]]),
    // прихожая | детская (короткий участок за санузлом)
    vWall(hallR, zHallBack, zb, []),
    // гостиная | детская
    hWall(zm, hallR, midR, [[hallR + 1.25, hallR + 2.25]]),
    // гостиная | спальня
    vWall(midR, zf, zm, [[zf + 1.75, zf + 2.75]]),
    // спальня | кабинет
    hWall(zm, midR, right, [[midR + 1.0, midR + 2.0]]),
    // детская | кабинет
    vWall(midR, zm, zb, [[zm + 1.75, zm + 2.75]]),
  ];

  // Окна — из плана, а не «в каждом пролёте фасада»: иначе окна появлялись в санузле
  // и в лестничной клетке (было именно так). Ширина кратна шагу сетки.
  const win = (room: Room, side: 'facade' | 'back', w = 1.5): WindowSeg => {
    const c = (room.x0 + room.x1) / 2;
    const half = w / 2;
    return { x0: c - half, x1: c + half, z: side === 'facade' ? zf : zb, side };
  };
  const byId = (id: Room['id']) => rooms.find(r => r.id === id)!;
  const windows: WindowSeg[] = [
    win(byId('living'), 'facade', 2.0),
    win(byId('bedroom'), 'facade', 1.5),
    win(byId('kitchen'), 'back', 1.5),
    win(byId('kids'), 'back', 1.5),
    win(byId('study'), 'back', 1.5),
  ];

  return {
    w: W, d: D, rooms, walls, windows,
    // вход в подъезд — в фасаде лестничной клетки (двойная дверь 1.5 м)
    entrance: { x: (left + stairR) / 2, z: zf, width: 1.5 },
    // Лестничная клетка — ВНУТРЕННИЙ объём между стенами (стена занимает полвокселя
    // от осевой линии). Иначе лестница врастает в стену, а шахта съедает стену квартиры.
    stairs: { x0: left + 0.25, x1: stairR - 0.25, z0: zf + 0.25, z1: zm - 0.25 },
  };
}

/** Попадает ли точка плана в комнату. */
export function inRoom(r: Room, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 + pad && x <= r.x1 - pad && z >= r.z0 + pad && z <= r.z1 - pad;
}

/** Комната, в которой лежит точка плана (или null — если точка в стене). */
export function roomAt(plan: ApartmentPlan, x: number, z: number): Room | null {
  for (const r of plan.rooms) if (inRoom(r, x, z)) return r;
  return null;
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
    // отступ от стены: стена занимает полвокселя от осевой линии
    const padX = Math.min(0.55, (r.x1 - r.x0) / 2 - 0.05);
    const padZ = Math.min(0.55, (r.z1 - r.z0) / 2 - 0.05);
    out.push({
      kind, rot,
      x: Math.min(Math.max(x, r.x0 + padX), r.x1 - padX),
      z: Math.min(Math.max(z, r.z0 + padZ), r.z1 - padZ),
    });
  };
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const inner = 0.6;            // отступ от стены
  const along: 'x' | 'z' = (r.x1 - r.x0) >= (r.z1 - r.z0) ? 'x' : 'z';
  for (const kind of r.furniture) {
    switch (kind) {
      // вдоль стен
      case 'sofa': push(kind, r.x0 + inner, cz, Math.PI / 2); break;
      case 'tv': push(kind, r.x1 - inner, cz, -Math.PI / 2); break;
      case 'bed': push(kind, r.x0 + 1.1, cz, Math.PI / 2); break;
      case 'wardrobe': push(kind, r.x1 - inner, r.z0 + 1.0, 0); break;
      case 'kitchen': push(kind, cx, r.z0 + 0.5, 0); break;
      case 'fridge': push(kind, r.x1 - 0.55, r.z0 + 0.5, 0); break;
      case 'toilet': push(kind, r.x0 + 0.55, r.z0 + 0.55, 0); break;
      case 'bath': push(kind, r.x0 + 0.95, r.z1 - 0.9, 0); break;
      case 'sink': push(kind, r.x1 - 0.55, r.z1 - 0.55, Math.PI); break;
      case 'shelf': push(kind, r.x0 + inner, r.z1 - 0.9, Math.PI / 2); break;
      case 'desk': push(kind, r.x1 - 0.7, cz, -Math.PI / 2); break;
      // в центре комнаты
      case 'table': push(kind, cx, cz + 0.25, 0); break;
      case 'chair': push(kind, cx + (along === 'x' ? 0.8 : 0), cz + (along === 'x' ? 0.25 : 0.8), Math.PI); break;
      case 'carpet': push(kind, cx, cz - 0.15, 0); break;
      case 'lamp': push(kind, r.x1 - 0.5, r.z1 - 0.5, 0); break;
    }
  }
  return out;
}
