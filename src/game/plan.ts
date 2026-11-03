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
  /** граница санузла и детской (санузел шире коридора: иначе не влезает ванна) */
  bathR: -0.25,
} as const;
export const PLAN_Z = {
  facade: -5.0, /** граница фасадного и заднего ряда */ mid: 1.0, back: 5.0,
  /**
   * Конец коридора: дальше санузел. Было 2.0 — и участок стены «коридор | кухня»
   * получался ровно 1 м: в нём помещался проём 0.5 м, а капсула игрока 0.6 м в него
   * физически не пролезает. Кухня оказывалась доступна ТОЛЬКО через дыру в санузел.
   * 2.5 даёт нормальную дверь 1.0 м, как во всей квартире.
   */
  hallBack: 2.5,
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
  const { left, stairR, hallR, midR, right, bathR } = PLAN_X;

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
    // Санузел ШИРЕ коридора: ванна 1.7 м физически не влезала в 1.5 м полезной ширины
    // (между осями стен 2 м минус полвокселя с каждой стороны), и `furnish` её просто
    // не ставил. Граница санузла и детской сдвинута на 0.75 м в сторону детской.
    { id: 'bath', name: 'Санузел', x0: stairR, x1: bathR, z0: zHallBack, z1: zb,
      furniture: ['toilet', 'bath', 'sink'] },
    { id: 'kids', name: 'Детская', x0: bathR, x1: midR, z0: zm, z1: zb,
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
    // прихожая | кухня. Проём — РОВНО по двум центрам вокселей (z = 1.5 и 2.0):
    // один центр даёт 0.5 м, а капсула игрока 0.6 м в такую дверь не пролезает —
    // кухня оставалась отрезанной (это ловит test-walk, а не статический тест).
    vWall(stairR, zm, zHallBack, [[zm + 0.5, zm + 1.0]]),
    // прихожая | санузел — дверь в конце коридора
    hWall(zHallBack, stairR, bathR, [[stairR + 1.0, stairR + 2.0]]),
    // БАГ (нашли фото-проходом): кухня | санузел — стены НЕ БЫЛО вовсе. Участок
    // x = stairR от z = zm до zHallBack принадлежит коридору, а санузел тянется до тыла,
    // и с кухни были видны ванна и унитаз. Глухая стена на весь задний ряд.
    vWall(stairR, zHallBack, zb, []),
    // прихожая | гостиная
    vWall(hallR, zf, zm, [[zf + 1.5, zf + 2.5]]),
    // прихожая | детская (короткий участок за санузлом) и санузел | детская.
    // Раньше отрезок начинался с zHallBack, и между прихожей и детской оставался
    // проём 1 м без двери — «проходная» дыра в стене коридора.
    vWall(hallR, zm, zHallBack, []),       // короткий участок: прихожая | санузел-коридор
    vWall(bathR, zHallBack, zb, []),        // санузел | детская
    // гостиная | детская
    hWall(zm, hallR, bathR, []),            // прихожая-коридор | детская: глухая
    hWall(zm, bathR, midR, [[bathR + 0.5, bathR + 1.5]]),     // гостиная | детская
    hWall(zHallBack, bathR, midR, []),      // гостиная | детская (задний ряд)
    // гостиная | спальня
    vWall(midR, zf, zm, [[zf + 1.75, zf + 2.75]]),   // ближе к центру: у углов стоит мебель
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

/** Габариты мебели по её геометрии из furniture.ts: [по X, по Z] при повороте 0. */
export const FURN_SIZE: Record<FurnitureKind, [number, number]> = {
  bed: [1.0, 2.1], table: [0.8, 1.2], chair: [0.45, 0.45], wardrobe: [0.6, 1.1], sofa: [0.95, 2.1],
  // тумба под телевизор: панель 0.86 м + выступ
  tv: [0.95, 0.42], fridge: [0.65, 0.65], shelf: [1.25, 0.35], carpet: [2.4, 1.8], lamp: [0.45, 0.45],
  kitchen: [2.3, 0.6], toilet: [0.4, 0.5], bath: [1.7, 0.75], sink: [0.55, 0.42], desk: [1.4, 0.7],
};

export interface FurnItem { kind: FurnitureKind; x: number; z: number; rot: number }
interface Box { x0: number; z0: number; x1: number; z1: number }

/** Прямоугольник предмета на плане с учётом поворота (кратно 90°). */
function boxOf(kind: FurnitureKind, x: number, z: number, rot: number): Box {
  const [w0, d0] = FURN_SIZE[kind];
  const odd = Math.abs(Math.round(rot / (Math.PI / 2)) % 2) === 1;   // поворот на 90° → габариты меняются местами
  const w = odd ? d0 : w0, d = odd ? w0 : d0;
  return { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 };
}

/**
 * Расстановка мебели в комнате.
 *
 * Раньше позиции были формулами «угол + смещение», и предметы налезали друг на друга:
 * диван влезал в стол, кухонный гарнитур — в холодильник, ванна — в мойку, а диван
 * вообще выходил за стену (на скриншоте игрока это выглядело как «беспорядок»).
 * Теперь расстановка проверяет ГАБАРИТЫ: каждый предмет ставится к стене или в центр,
 * но только если он целиком внутри комнаты и не пересекается с уже поставленными.
 *
 * plan (необязателен) нужен, чтобы не загораживать дверные проёмы и окна.
 */
export function furnish(r: Room, plan?: ApartmentPlan): FurnItem[] {
  const out: FurnItem[] = [];
  // ВАЖНО: границы комнат в плане — это ОСИ стен. Воксельная стена толщиной 0.5 м
  // ложится на ось НЕ всегда симметрично: генератор ставит воксель в
  // floor((ось + размер/2) / 0.5), поэтому при чётном смещении стена занимает
  // [ось − 0.25, ось + 0.25], а при нечётном — [ось, ось + 0.5]. Из-за этого любой
  // фиксированный отступ в какой-то части дома «задвигал» мебель в кирпич
  // (на скриншоте лампы и полки стояли внутри стены). Считаем ровно как генератор.
  const WALL = 0.5;
  const wallSpan = (axis: number, half: number): [number, number] => {
    const idx = Math.floor((axis + half) / WALL);
    return [idx * WALL - half, (idx + 1) * WALL - half];
  };
  const base = {
    x0: wallSpan(r.x0, plan ? plan.w / 2 : 6)[1],
    x1: wallSpan(r.x1, plan ? plan.w / 2 : 6)[0],
    z0: wallSpan(r.z0, plan ? plan.d / 2 : 5.25)[1],
    z1: wallSpan(r.z1, plan ? plan.d / 2 : 5.25)[0],
  };
  // страховка: если границы совпали/перевернулись (тонкая нестандартная комната),
  // отступаем внутрь на полклетки — мебель не должна оказаться в стене
  const inner: Box = {
    x0: base.x0 < r.x1 ? base.x0 : r.x0 + WALL / 2,
    x1: base.x1 > r.x0 ? base.x1 : r.x1 - WALL / 2,
    z0: base.z0 < r.z1 ? base.z0 : r.z0 + WALL / 2,
    z1: base.z1 > r.z0 ? base.z1 : r.z1 - WALL / 2,
  };
  const inside = (b: Box) => b.x0 >= inner.x0 - 1e-6 && b.x1 <= inner.x1 + 1e-6 &&
    b.z0 >= inner.z0 - 1e-6 && b.z1 <= inner.z1 + 1e-6;
  const overlap = (a: Box, b: Box) => {
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
    return ox > 0.02 && oz > 0.02;
  };
  const fits = (b: Box, ignore: Set<FurnitureKind>) => inside(b) && !out.some(o => {
    if (ignore.has(o.kind)) return false;
    return overlap(b, boxOf(o.kind, o.x, o.z, o.rot));
  });
  // зоны, которые нельзя занимать: дверные проёмы, ведущие в эту комнату
  const zones: Box[] = [];
  if (plan) {
    for (const ws of plan.walls) {
      const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
      for (const [a, b] of ws.doors) {
        const axis = horiz ? ws.z0 : ws.x0;
        const lo = (horiz ? Math.min(ws.x0, ws.x1) : Math.min(ws.z0, ws.z1)) + a;
        const hi = (horiz ? Math.min(ws.x0, ws.x1) : Math.min(ws.z0, ws.z1)) + b;
        const z: Box = horiz
          ? { x0: lo - 0.15, z0: axis - 0.9, x1: hi + 0.15, z1: axis + 0.9 }
          : { x0: axis - 0.9, z0: lo - 0.15, x1: axis + 0.9, z1: hi + 0.15 };
        if (z.x1 > r.x0 && z.x0 < r.x1 && z.z1 > r.z0 && z.z0 < r.z1) zones.push(z);
      }
    }
  }
  // Дверные зоны проверяем в два уровня:
  //  * strict — предмет не попадает в «коридор» перед дверью (0.9 м в комнату);
  //  * loose  — предмет не перекрывает сам проём.
  // Раньше проверялся только strict, причём с лишним отступом pad по ВСЕМ сторонам:
  // в гостиной 3.5×6 диван 2.1 м не находил места ни у одной стены (зона двери
  // «съедала» всю стену), и диван вообще не появлялся. Отступ pad уже учтён в inner,
  // поэтому здесь он не нужен.
  const freeOfDoors = (b: Box, strict = true) => !zones.some(z => {
    const dz = strict ? z : { x0: z.x0 + 0.6, z0: z.z0 + 0.55, x1: z.x1 - 0.6, z1: z.z1 - 0.55 };
    return overlap(b, dz);
  });

  /**
   * Поставить к стене. side: 0 = фасад (−Z), 1 = тыл (+Z), 2 = запад (−X), 3 = восток (+X).
   * `near` — предпочтительное смещение вдоль стены в метрах от её середины
   * (вторая вещь пары встаёт напротив первой, а не рядом).
   */
  const againstWall = (kind: FurnitureKind, side: number, near = 0): boolean => {
    const [w0, d0] = FURN_SIZE[kind];
    const alongX = side < 2;                             // стена тянется вдоль X (фасад/тыл)
    // ВАЖНО: предмет должен стоять ВДОЛЬ стены длинной стороной. Раньше поворот был
    // привязан к стороне («боковая стена → 90°») без учёта формы: диван 0.95×2.1 у
    // фасада вставал поперёк, занимал полкомнаты, и остальная мебель не помещалась.
    const long = Math.max(w0, d0);
    const wantLongAlongX = alongX;
    const rot0 = wantLongAlongX === (w0 >= d0);          // true → rot = 0, false → 90°
    const rot = wantLongAlongX
      ? (rot0 ? 0 : Math.PI / 2)
      : (d0 >= w0 ? 0 : Math.PI / 2);
    const w = Math.abs(rot) > 0.1 ? d0 : w0, d = Math.abs(rot) > 0.1 ? w0 : d0;
    void long;
    const lo = alongX ? inner.x0 : inner.z0;
    const hi = alongX ? inner.x1 : inner.z1;
    const fixed = side === 0 ? inner.z0 + d / 2 : side === 1 ? inner.z1 - d / 2
      : side === 2 ? inner.x0 + w / 2 : inner.x1 - w / 2;
    const half = (alongX ? w : d) / 2;
    const span = hi - lo - half * 2;
    if (span < -1e-6) return false;
    // кандидаты вдоль стены: сначала желаемое место, потом к краям
    const mid = (lo + hi) / 2 + near;
    const cand = [mid, mid + 0.4, mid - 0.4, mid + 0.8, mid - 0.8, lo + half, hi - half];
    for (let n = 1; n <= 6; n++) cand.push(lo + half + (span * n) / 6, hi - half - (span * n) / 6);
    // Проход 1 — не загораживаем дверь совсем; проход 2 — можно встать в «коридор»
    // перед дверью, но не в сам проём.
    for (const strict of [true, false]) {
      for (const p of cand) {
        const clamped = Math.min(Math.max(p, lo + half), hi - half);
        const x = alongX ? clamped : fixed, z = alongX ? fixed : clamped;
        const b = boxOf(kind, x, z, rot);
        if (!fits(b, new Set()) || !freeOfDoors(b, strict)) continue;
        out.push({ kind, x, z, rot });
        return true;
      }
    }
    return false;
  };

  /** Поставить в центр (стол, ковёр, лампа). */
  const atCenter = (kind: FurnitureKind, dx = 0, dz = 0): boolean => {
    const cand: [number, number][] = [[dx, dz], [0, 0], [-dx, -dz], [dx, -dz], [-dx, dz], [0, -0.6], [0, 0.6], [0.6, 0], [-0.6, 0]];
    for (const [ox, oz] of cand) {
      const x = (r.x0 + r.x1) / 2 + ox, z = (r.z0 + r.z1) / 2 + oz;
      const b = boxOf(kind, x, z, 0);
      if (!fits(b, new Set()) || !freeOfDoors(b, false)) continue;
      out.push({ kind, x, z, rot: 0 });
      return true;
    }
    // Раньше здесь стояло 9 фиксированных точек, и в маленькой комнате (детская 3×4 м
    // после кровати 2.1 м у стены) стол было некуда поставить — он просто исчезал.
    // Теперь перебираем сетку с шагом 0.2 м от центра комнаты наружу.
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const rad = Math.max(r.x1 - r.x0, r.z1 - r.z0) / 2;
    for (let ring = 0.2; ring <= rad; ring += 0.2) {
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * Math.PI * 2;
        const x = cx + Math.cos(th) * ring, z = cz + Math.sin(th) * ring;
        const b = boxOf(kind, x, z, 0);
        if (!fits(b, new Set()) || !freeOfDoors(b, false)) continue;
        out.push({ kind, x, z, rot: 0 });
        return true;
      }
    }
    return false;
  };

  const has = (k: FurnitureKind) => r.furniture.includes(k);

  // 1) ПАРЫ у противоположных стен: диван ↔ телевизор, кровать ↔ шкаф.
  // Раньше обе вещи «прилипали» к одной стене, и комната выглядела как склад.
  if (has('sofa')) {
    const side = againstWall('sofa', 2) ? 2 : againstWall('sofa', 3) ? 3 : againstWall('sofa', 0) ? 0 : 1;
    if (has('tv')) againstWall('tv', side === 2 ? 3 : side === 3 ? 2 : side === 0 ? 1 : 0);
  } else if (has('bed')) {
    const side = againstWall('bed', 2) ? 2 : againstWall('bed', 3) ? 3 : againstWall('bed', 0) ? 0 : 1;
    if (has('wardrobe')) againstWall('wardrobe', side === 2 ? 3 : side === 3 ? 2 : side === 0 ? 1 : 0);
  } else if (has('wardrobe')) {
    againstWall('wardrobe', 3) || againstWall('wardrobe', 1);
  }
  // 2) остальная мебель по стенам (в т.ч. вторая вещь пары, если напротив не влезла)
  for (const kind of ['tv', 'bed', 'desk', 'shelf', 'kitchen', 'fridge', 'bath', 'toilet', 'sink', 'lamp', 'carpet'] as FurnitureKind[]) {
    if (!has(kind) || out.some(i => i.kind === kind)) continue;
    for (const side of kind === 'bath' || kind === 'kitchen' ? [0, 1, 2, 3] : [3, 1, 0, 2]) {
      if (againstWall(kind, side)) break;
    }
  }
  // 3) стол в центре, стул — рядом с ним (стул может «заезжать» под стол)
  if (has('table')) atCenter('table', 0, 0.2);
  if (has('chair')) {
    const t = out.find(i => i.kind === 'table');
    let placed = false;
    if (t) {
      for (const [dx, dz, rot] of [[0, 0.85, Math.PI], [0, -0.85, 0], [0.8, 0, -Math.PI / 2], [-0.8, 0, Math.PI / 2]] as [number, number, number][]) {
        const b = boxOf('chair', t.x + dx, t.z + dz, rot);
        if (fits(b, new Set<FurnitureKind>(['table', 'carpet'])) && freeOfDoors(b, false)) {
          out.push({ kind: 'chair', x: t.x + dx, z: t.z + dz, rot });
          placed = true;
          break;
        }
      }
    }
    if (!placed) atCenter('chair', 0.7, 0.2);
  }
  // 3b) ЧЕГО НЕ ВЛЕЗЛО ПО ПРАВИЛАМ — ставим хоть куда, но внутри комнаты.
  // Иначе предмет молча исчезал: в санузле брежневки ванна занимала всё, и мойка
  // с унитазом просто не появлялись (а на плане они есть — расходились план и игра).
  for (const kind of r.furniture) {
    if (kind === 'carpet') continue;        // ковёр ставится отдельно, последним
    if (out.some(i => i.kind === kind)) continue;
    let placed = false;
    for (let side = 0; side < 4 && !placed; side++) placed = againstWall(kind, side);
    if (!placed) placed = atCenter(kind);
    if (!placed) {
      // последняя попытка: мелкая сетка по комнате, но БЕЗ наложений на мебель.
      // Раньше здесь проверялись только границы комнаты — из-за этого в детской стол
      // вставал прямо на кровать (видно на скриншоте), а в санузле — друг на друга.
      for (let z = inner.z0; z <= inner.z1 && !placed; z += 0.2) {
        for (let x = inner.x0; x <= inner.x1 && !placed; x += 0.2) {
          for (const rot of [0, Math.PI / 2]) {
            const b = boxOf(kind, x, z, rot);
            if (!fits(b, new Set()) || !freeOfDoors(b, false)) continue;
            out.push({ kind, x, z, rot }); placed = true; break;
          }
        }
      }
    }
  }
  // 4) ковёр — ПОСЛЕДНИМ: он лежит под мебелью, поэтому проверяем только границы комнаты
  if (has('carpet')) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    // ковёр может быть БОЛЬШЕ комнаты (2.4 × 1.8 против детской 3 × 4 м — влезает,
    // а вот в узком месте нет). Тогда поворачиваем его на 90° и, если всё равно
    // не влезает, ставим меньший: центр ковра не должен оказаться в стене.
    for (const rot of [0, Math.PI / 2]) {
      const b = boxOf('carpet', cx, cz, rot);
      if (inside(b)) { out.push({ kind: 'carpet', x: cx, z: cz, rot }); break; }
    }
  }
  return out;
}

const ALL_KINDS = new Set<FurnitureKind>(['bed', 'table', 'chair', 'wardrobe', 'sofa', 'tv', 'fridge', 'shelf', 'carpet', 'lamp', 'kitchen', 'toilet', 'bath', 'sink', 'desk']);
