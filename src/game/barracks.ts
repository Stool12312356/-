// КАЗАРМА И ВОЕННЫЙ МАГАЗИН (п.5 из списка пользователя).
//
// Оба здания — из той же воксельной сетки 0.5 м, что и жилые дома, поэтому они так же
// разрушаются: выбиваются куски стен, обрушивается перекрытие, остаются кратеры.
// Отдельный модуль, потому что планировка у них принципиально другая:
//
//   КАЗАРМА (одноэтажная, 24 × 8 м, на 2 секции):
//   ┌──────────────────────────────┬───────────────┐
//   │ спальный зал (койки в 2 ряда)│  коридор      │  вход с фасада
//   │                              ├───────┬───────┤
//   │                              │ кубрик│ оружейка│
//   └──────────────────────────────┴───────┴───────┘
//
//   МАГАЗИН («Военторг», 12 × 8 м):
//   ┌────────────────────┬─────────────┐
//   │ торговый зал       │ подсобка    │
//   │ (прилавок, витрины)│ (склад)     │
//   └────────────────────┴─────────────┘
//
// Планы заданы в тех же единицах, что plan.ts: оси стен на сетке 0.5 м от центра.
import { PITCH } from './voxelhouse.ts';
import type { ApartmentPlan, Room, WallSeg, WindowSeg } from './plan.ts';

export type SpecialKind = 'barracks' | 'shop';

export interface SpecialPlan {
  kind: SpecialKind;
  name: string;
  /** ширина одной секции и глубина, м */
  w: number; d: number; floors: number; floorH: number;
  rooms: Room[];
  /** простые стены (горизонтальные/вертикальные) с проёмами, как в plan.ts */
  walls: WallSeg[];
  /** проём в перекрытии (лестница) — по внутреннему объёму */
  stairWell?: { x0: number; x1: number; z0: number; z1: number };
  /** вход: x и z фасада, ширина */
  entrance: { x: number; z: number; width: number };
  /** окна: ось и сторона */
  windows: WindowSeg[];
}

/**
 * Казарма: одноэтажная, 24 м в длину (2 секции по 12). Внутри — спальный зал на весь
 * левый край, коридор вдоль фасада и два кубрика в тылу.
 */
export function barracksPlan(): SpecialPlan {
  // 12 × 12 м: слева большой спальный зал, справа — коридор шириной 1 м и лестничная
  // клетка 2.5 × 5.5 (марш + две площадки, проступь считается в staircase.ts), сзади —
  // оружейка и каптёрка.
  const W = 12.0, D = 12.0, H = 3.0;
  const x0 = -6.0, x1 = 6.0, z0 = -6.0, z1 = 6.0;
  const splitX = 1.5;              // спальный зал | коридор
  const corrX = 3.0;               // коридор | лестница и задние комнаты
  const stairZ1 = 0.0;             // лестница | задние комнаты
  const backMidZ = 3.0;            // оружейка | каптёрка
  const rooms: Room[] = [
    { id: 'living', name: 'Спальный зал', x0, x1: splitX, z0, z1, furniture: ['bed', 'bed', 'bed', 'bed', 'shelf', 'lamp'] },
    // «stairs» — не комната, а место лестницы: мебель туда не ставится (тот же id, что в plan.ts)
    { id: 'stairs', name: 'Лестница', x0: corrX, x1: 5.5, z0: -5.5, z1: stairZ1, furniture: [] },
    { id: 'hall', name: 'Коридор', x0: splitX, x1: corrX, z0, z1, furniture: ['lamp', 'shelf'] },
    { id: 'bath', name: 'Оружейная', x0: corrX, x1: 5.5, z0: stairZ1 + 0.5, z1: backMidZ, furniture: ['shelf', 'shelf', 'table'] },
    { id: 'study', name: 'Кубрик', x0: corrX, x1: 5.5, z0: backMidZ, z1: 5.5, furniture: ['table', 'chair', 'wardrobe'] },
  ];
  const walls: WallSeg[] = [
    // спальный зал | коридор — дверь у фасада
    { x0: splitX, z0, x1: splitX, z1, doors: [[0.8, 1.8]] },
    // коридор | лестничная клетка — дверь у фасада
    { x0: corrX, z0, x1: corrX, z1: stairZ1, doors: [[0.6, 1.6]] },
    // коридор | задние комнаты — дверь у тыла
    { x0: corrX, z0: stairZ1, x1: corrX, z1, doors: [[4.2, 5.2]] },
    // лестница | оружейка
    { x0: corrX, z0: stairZ1, x1: 5.5, z1: stairZ1, doors: [] },
    // оружейка | кубрик
    { x0: corrX, z0: backMidZ, x1: 5.5, z1: backMidZ, doors: [[1.2, 2.2]] },
  ];
  return {
    kind: 'barracks', name: 'Казарма', w: W, d: D, floors: 2, floorH: H,
    rooms, walls,
    /** проём в перекрытии над лестницей: иначе на 2-й этаж не попасть */
    stairWell: { x0: corrX, x1: 5.5, z0: -5.5, z1: stairZ1 },
    // вход — прямо в коридор (local x 1.5…3.0), а не в спальный зал: иначе с порога
    // приходится идти вдоль фасада и искать дверь в стене
    entrance: { x: 2.2, z: z0, width: 1.4 },
    // окна НЕ пересекаются с дверью — иначе дверь «застеклится»
    windows: [
      { x0: -5.5, x1: -4.5, z: z0, side: 'facade' },
      { x0: -1.0, x1: 1.0, z: z0, side: 'facade' },
      { x0: -4.5, x1: -2.5, z: z1, side: 'back' },
      { x0: 3.5, x1: 5.0, z: z1, side: 'back' },
    ],
  };
}

/**
 * Военторг: торговый зал с прилавком, подсобка за перегородкой.
 */
export function shopPlan(): SpecialPlan {
  const W = 12.0, D = 8.0, H = 3.0;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const splitX = 2.5;      // торговый зал | подсобка
  const rooms: Room[] = [
    { id: 'living', name: 'Торговый зал', x0, x1: splitX, z0, z1, furniture: ['table', 'shelf', 'shelf', 'lamp', 'chair'] },
    { id: 'study', name: 'Подсобка', x0: splitX, x1, z0, z1, furniture: ['shelf', 'shelf', 'table'] },
    { id: 'bath', name: 'Кабинет', x0: splitX, x1: x1 - 2.5, z0: 1.5, z1, furniture: ['table', 'chair'] },
  ];
  const walls: SpecialPlan['walls'] = [
    { x0: splitX, z0, x1: splitX, z1, doors: [[1.5, 2.5]] },
  ];
  return {
    kind: 'shop', name: 'Военторг', w: W, d: D, floors: 1, floorH: H,
    rooms, walls,
    entrance: { x: -3.0, z: z0, width: 2.0 },
    windows: [
      { x0: -1.0, x1: 4.5, z: z0, side: 'facade' },    // витрина (дверь −4.0…−2.0)
      { x0: -5.5, x1: -4.5, z: z0, side: 'facade' },
      { x0: -4.0, x1: -2.0, z: z1, side: 'back' },
    ],
  };
}

/**
 * Копия плана с «пустыми» жилыми комнатами. Нужна лестнице: buildStaircase берёт из
 * плана только геометрию клетки, но её тип — ApartmentPlan, поэтому подставляем
 * валидную, а мебель остаётся нашей (см. furnishSpecial).
 */
export function stairPlan(sp: SpecialPlan): ApartmentPlan {
  return { w: sp.w, d: sp.d, rooms: [], walls: [], windows: [], entrance: sp.entrance, stairs: sp.stairWell! };
}

export function specialPlan(kind: SpecialKind): SpecialPlan {
  return kind === 'barracks' ? barracksPlan() : shopPlan();
}

/**
 * Воксельная сетка казармы/магазина: стены, окна, дверной проём, перекрытие и крыша.
 * Ничего не выдумываем — те же правила, что в voxelgen.ts для жилых домов:
 *  • стена — один воксель по осевой линии плана;
 *  • окна на высоте 0.85…2.05 м;
 *  • дверной проём — до 2.4 м;
 *  • крыша — слой вокселей по всей площади.
 */
export function buildSpecial(kind: SpecialKind, sections = 1) {
  const plan = specialPlan(kind);
  const secW = Math.round(plan.w / PITCH);
  const nx = secW * sections, nz = Math.round(plan.d / PITCH);
  const floors = plan.floors, floorH = plan.floorH;
  const ny = Math.round((floors * floorH) / PITCH) + 1;
  const cells = new Int8Array(nx * ny * nz).fill(-1);
  const sectionOf = new Uint8Array(nx * ny * nz);
  const bearing = new Uint8Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => (j * nz + k) * nx + i;
  const add = (i: number, j: number, k: number, kind: number, s = 0) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const c = idx(i, j, k); cells[c] = kind; sectionOf[c] = s; bearing[c] = 1;
  };
  const empty = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    cells[idx(i, j, k)] = -1;
  };
  const byKind: Record<number, number> = {};

  for (let s = 0; s < sections; s++) {
    const s0 = s * secW;
    const secOffset = (s - (sections - 1) / 2) * plan.w;
    const PI = (x: number) => Math.floor((x + secOffset + (nx * PITCH) / 2) / PITCH);
    const PK = (z: number) => Math.floor((z + (nz * PITCH) / 2) / PITCH);
    for (let f = 0; f < floors; f++) {
      const j0 = Math.floor((f * floorH) / PITCH);
      const j1 = Math.floor(((f + 1) * floorH) / PITCH) - 1;
      const jf = j1;                       // верхний слой этажа — перекрытие
      // НАРУЖНЫЕ СТЕНЫ: фасад, тыл, торцы
      for (let j = j0; j <= j1; j++) {
        const localJ = j - j0;
        const winRow = localJ >= Math.round(0.85 / PITCH) && localJ <= Math.round(2.05 / PITCH) - 1;
        for (let i = s0; i < s0 + secW; i++) {
          const xc = ((i + 0.5) * PITCH - (nx * PITCH) / 2) - secOffset;   // X в координатах секции
          for (const k of [PK(plan.entrance.z), nz - 1]) {
            const isFacade = k === PK(plan.entrance.z);
            const inWin = winRow && plan.windows.some(w =>
              (isFacade ? w.side === 'facade' : w.side === 'back') && PK(w.z) === k && xc >= w.x0 - 0.01 && xc <= w.x1 + 0.01);
            // вход: проём до 2.4 м на первом этаже
            const isDoor = f === 0 && isFacade && Math.abs(xc - plan.entrance.x) <= plan.entrance.width / 2 + 0.01
              && j < Math.round(2.4 / PITCH);
            if (isDoor) continue;
            if (inWin) { add(i, j, k, 3, s); byKind[3] = (byKind[3] ?? 0) + 1; continue; }
            add(i, j, k, 0, s); byKind[0] = (byKind[0] ?? 0) + 1;
          }
        }
        // торцы — только у крайних секций
        if (s === 0) for (let k = 1; k < nz - 1; k++) { add(0, j, k, 0, s); byKind[0] = (byKind[0] ?? 0) + 1; }
        if (s === sections - 1) for (let k = 1; k < nz - 1; k++) { add(nx - 1, j, k, 0, s); byKind[0] = (byKind[0] ?? 0) + 1; }
        // межсекционная стена на всю глубину
        if (s > 0) for (let k = 0; k < nz; k++) { add(s0, j, k, 2, s); byKind[2] = (byKind[2] ?? 0) + 1; }
      }
      // ВНУТРЕННИЕ СТЕНЫ по плану
      const jDoorTop = j0 + Math.round(2.0 / PITCH) - 1;
      for (const ws of plan.walls) {
        const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
        const a = horiz ? Math.min(ws.x0, ws.x1) : Math.min(ws.z0, ws.z1);
        const b = horiz ? Math.max(ws.x0, ws.x1) : Math.max(ws.z0, ws.z1);
        const n = Math.round((b - a) / PITCH);
        for (let t = 0; t <= n; t++) {
          const coord = a + t * PITCH;
          const off = coord - a;
          const inDoor = ws.doors.some(([d0, d1]) => off >= d0 - 0.01 && off <= d1 + 0.01);
          const i = horiz ? PI(coord) : PI(ws.x0);
          const k = horiz ? PK(ws.z0) : PK(coord);
          if (!(k > 0 && k < nz - 1 && i >= s0 && i < s0 + secW)) continue;   // не задевать наружные стены
          if (i % secW === 0 && s > 0) continue;
          for (let j = j0; j < j1; j++) {
            if (inDoor && j <= jDoorTop) continue;
            add(i, j, k, 2, s); byKind[2] = (byKind[2] ?? 0) + 1;
          }
        }
      }
      // ПЕРЕКРЫТИЕ / КРЫША
      for (let i = s0; i < s0 + secW; i++) for (let k = 0; k < nz; k++) {
        if (cells[idx(i, jf, k)] >= 0) continue;
        // лестничный проём: на верхних этажах перекрытие НЕ ставим, иначе на 2-й не попасть
        const w = plan.stairWell;
        if (w && f < floors - 1) {
          const xc = ((i + 0.5) * PITCH - (nx * PITCH) / 2) - secOffset;
          const zc = (k + 0.5) * PITCH - (nz * PITCH) / 2;
          if (xc > w.x0 && xc < w.x1 && zc > w.z0 && zc < w.z1) continue;
        }
        add(i, jf, k, 1, s); byKind[1] = (byKind[1] ?? 0) + 1;
      }
    }
  }
  // крыша: последний слой по всей площади
  const jRoof = ny - 1;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    if (cells[idx(i, jRoof, k)] >= 0) continue;
    add(i, jRoof, k, 1, Math.min(sections - 1, Math.floor(i / secW))); byKind[1] = (byKind[1] ?? 0) + 1;
  }

  let voxels = 0;
  for (let c = 0; c < cells.length; c++) if (cells[c] >= 0) voxels++;
  return {
    kind: plan.kind,
    name: plan.name,
    plan,
    spec: { nx, ny, nz, ox: 0, oy: 0, oz: 0, cells, sectionOf, bearing },
    size: [nx * PITCH, ny * PITCH, nz * PITCH] as [number, number, number],
    floors, floorH, sections,
    stats: { voxels, byKind },
  };
}

/** Пусто ли внутри (для теста «есть куда войти»). */
export function specialInsideType(m: ReturnType<typeof buildSpecial>, i: number, j: number, k: number): number {
  const { nx, ny, nz, cells } = m.spec;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -2;
  return cells[(j * nz + k) * nx + i];
}
