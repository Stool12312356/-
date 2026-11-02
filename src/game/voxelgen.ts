// ДОМ В ВОКСЕЛЬНУЮ СЕТКУ (M5). Сборка из деталей-панелей (panels.ts) переводится в
// единую сетку вокселей 0.5 м: теперь стена — не «панель с hp», а набор кубиков, как в Teardown.
//
// Почему так: пользователь просил воксельное разрушение, а панель ломалась целиком.
// Плюс в прошлой версии не было подъезда и лестницы: вход вёл сразу в квартиру.
//
// Что где:
//   - фасад/тыл/торцы: стены толщиной 0.5 м (2 вокселя по 0.25? нет — 1 воксель 0.5);
//   - окна/двери: воксели просто НЕ ставятся (проём), стекло ставится отдельным типом;
//   - перекрытия: слой вокселей на этаж;
//   - подъезд: в центре секции шахта 2.4 × 2.4 м со сквозными проёмами во всех перекрытиях;
//   - лестница: настоящие ступени из вокселей, змейкой по шахте.
import { PITCH } from './voxelhouse.ts';
import type { GridSpec } from './voxelhouse.ts';
import { apartmentPlan, PLAN_X, PLAN_Z, type ApartmentPlan } from './plan.ts';

export interface VoxelHouseOpts {
  kind: 'khrushchevka' | 'brezhnevka';
  sections?: number;
  floors?: number;
  seed?: number;
}

export interface VoxelHouseModel {
  spec: GridSpec;
  /** по этому плану вырезаны внутренние стены и расставлена мебель */
  plan: ApartmentPlan;
  /** габариты в метрах */
  size: [number, number, number];
  /** центр дома в мире (для HUD/поиска) */
  center: [number, number, number];
  floors: number;
  sections: number;
  stats: { voxels: number; byKind: Record<number, number>; entrance: [number, number, number] };
}

const TYPES = {
  khrushchevka: { floors: 5, floorH: 2.8, depth: 11.0, name: 'Хрущёвка' },
  brezhnevka: { floors: 9, floorH: 2.9, depth: 11.6, name: 'Брежневка' },
} as const;

/** Секция: 3 пролёта по 3.0 м + простенки 0.6 м. */
const BAY = 3.0;
const BAYS = 3;
const END = 0.6;
/** оставлено для совместимости; фактическая ширина секции берётся из плана (plan.w) */
export const SECTION_W = 10.0;

export function buildVoxelHouse(opts: VoxelHouseOpts): VoxelHouseModel {
  const T = TYPES[opts.kind];
  const plan = apartmentPlan(opts.kind);
  const floors = opts.floors ?? T.floors;
  const sections = opts.sections ?? 2;
  const floorH = T.floorH;
  // глубина дома = глубина плана: иначе внутренние стены плана попадают в наружную стену
  const depth = plan.d;
  const W = plan.w * sections, H = floors * floorH;

  const nx = Math.round(W / PITCH), ny = Math.round(H / PITCH) + 1, nz = Math.round(depth / PITCH);
  const cells = new Int8Array(nx * ny * nz).fill(-1);
  const sectionOf = new Uint8Array(nx * ny * nz);
  const bearing = new Uint8Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => (j * nz + k) * nx + i;
  const set = (i: number, j: number, k: number, kind: number, sec = 0, bear = 1) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const c = idx(i, j, k);
    cells[c] = kind;
    sectionOf[c] = sec;
    bearing[c] = bear;
  };
  const empty = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    cells[idx(i, j, k)] = -1;
  };

  const byKind: Record<number, number> = {};
  const add = (i: number, j: number, k: number, kind: number, sec = 0, bear = 1) => {
    set(i, j, k, kind, sec, bear);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  };

  const secW = Math.round(plan.w / PITCH);              // 10.0 / 0.5 = 20 вокселей
  const wallRows = 1;                                    // толщина стены 0.5 м

  for (let s = 0; s < sections; s++) {
    const s0 = s * secW;                                 // начало секции по i
    // метры плана → индексы сетки (центр секции = центр плана)
    const PI = (x: number) => s0 + Math.round((x + plan.w / 2) / PITCH);
    const PK = (z: number) => Math.round((z + nz * PITCH / 2) / PITCH);
    // ---- стены по периметру + межсекционная ----
    for (let f = 0; f < floors; f++) {
      // ВАЖНО: этажи считаем через floor одной формулы. Раньше низ этажа округлялся
      // отдельно от верха, между этажами появлялись щели в целый воксель (видно на превью
      // как «этажи парят»).
      const j0 = Math.floor((f * floorH) / PITCH);
      const j1 = Math.floor(((f + 1) * floorH) / PITCH) - 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = s0; i < s0 + secW; i++) {
          // фасад/тыл
          for (const k of [0, nz - 1]) {
            // проём под окно: 2.05/0.85 м → примерно воксели 2..4 (снизу 0.85 = 1.7 вокс)
            const localJ = j - j0;
            const winLo = Math.round(0.85 / PITCH), winHi = Math.round(2.05 / PITCH) - 1;
            const isWindowRow = localJ >= winLo && localJ <= winHi;
            // окно в каждом пролёте: 2 вокселя шириной по центру пролёта
            const local = (i * PITCH) - s0 * PITCH;
            const bayI = Math.floor(local / BAY);
            const inBay = Math.round((local - bayI * BAY) / PITCH);
            // Окно в каждом пролёте: 2 вокселя (1 м) по центру пролёта. Раньше проём
            // считался от начала секции и «окна» уезжали между пролётами.
            const bayCenter = Math.round(BAY / PITCH / 2);
            const isWindowCol = inBay >= bayCenter - 1 && inBay <= bayCenter;
            const isEntrance = f === 0 && k === 0 && bayI === 1; // у подъезда окна нет
            if (isWindowRow && isWindowCol && !isEntrance) { add(i, j, k, 3, s, 1); continue; } // стекло
            add(i, j, k, 0, s, 1);
          }
        }
        // торцы
        if (s === 0) for (let k = 1; k < nz - 1; k++) {
          const localJ = j - j0;
          const isWin = localJ >= Math.round(0.85 / PITCH) && localJ <= Math.round(2.05 / PITCH) - 1
            && k > Math.round(nz * 0.3) && k < Math.round(nz * 0.7);
          add(0, j, k, isWin ? 3 : 0, s, 1);
        }
        if (s === sections - 1) for (let k = 1; k < nz - 1; k++) {
          const localJ = j - j0;
          const isWin = localJ >= Math.round(0.85 / PITCH) && localJ <= Math.round(2.05 / PITCH) - 1
            && k > Math.round(nz * 0.3) && k < Math.round(nz * 0.7);
          add(nx - 1, j, k, isWin ? 3 : 0, s, 1);
        }
        // межсекционная кирпичная стена (не несущая: её можно пробить, дом стоит)
        if (s > 0) add(s0, j, Math.round(nz / 2), 2, s, 0);
      }
      // ---- ВНУТРЕННИЕ СТЕНЫ ПО 2D-ПЛАНУ (plan.ts) ----
      // Раньше дом внутри был пустой коробкой: «между квартирами нет стены, мебель
      // раскидана без комнат». Стены и двери берутся из apartmentPlan(), и тот же план
      // рисуется картинкой docs/plan-2k.png — план и дом не могут разойтись.
      // ВАЖНО: стены ставим ПЕРЕД перекрытием этажа, иначе плита заливает дверные проёмы.
      const jf = Math.floor(((f + 1) * floorH) / PITCH) - 1;
      const jDoorTop = j0 + Math.round(2.0 / PITCH) - 1;
      for (const wseg of plan.walls) {
        const horiz = Math.abs(wseg.z1 - wseg.z0) < 1e-6;
        const len = horiz ? Math.abs(wseg.x1 - wseg.x0) : Math.abs(wseg.z1 - wseg.z0);
        for (let t = 0; t < len; t += PITCH * 0.5) {
          const inDoor = wseg.doors.some(([a, b]) => t >= a - PITCH * 0.75 && t <= b + PITCH * 0.75);
          const wx = horiz ? Math.min(wseg.x0, wseg.x1) + t : wseg.x0;
          const wz = horiz ? wseg.z0 : Math.min(wseg.z0, wseg.z1) + t;
          const i = PI(wx), k = PK(wz);
          for (let j = j0; j < jf; j++) {
            if (inDoor && j <= jDoorTop) continue;      // проём двери
            add(i, j, k, 2, s, 0);                       // кирпичная перегородка (не несущая)
          }
        }
      }

      // ---- перекрытие (пол следующего этажа) ----
      // Лестничный проём НЕ заделываем: шахта задана планом (plan.stairs), иначе
      // перекрытие замуровывает лестницу (из-за этого раньше «не было лестницы на этажи»).
      const si0p = PI(plan.stairs.x0) + 1, si1p = PI(plan.stairs.x1) - 1;
      const sk0p = PK(plan.stairs.z0) + 1, sk1p = PK(plan.stairs.z1) - 1;
      for (let i = s0; i < s0 + secW; i++) for (let k = 0; k < nz; k++) {
        if (cells[idx(i, jf, k)] >= 0) continue;
        if (i >= si0p && i <= si1p && k >= sk0p && k <= sk1p) continue;  // шахта
        add(i, jf, k, 1, s, 0);
      }
    }
    // ---- ЛЕСТНИЧНАЯ КЛЕТКА по плану: шахта ровно внутри стен прихожей ----
    // Раньше шахта стояла «где получилось» и прорезала стены квартиры — получалось,
    // что между квартирами нет стены. Теперь границы берём из плана (plan.stairs).
    const si0 = PI(plan.stairs.x0), si1 = PI(plan.stairs.x1);
    const sk0 = PK(plan.stairs.z0), sk1 = PK(plan.stairs.z1);
    // внутренний объём (без стен клетки — их рисуют стены плана)
    const sIn0 = si0 + 1, sIn1 = si1 - 1, sK0 = sk0 + 1, sK1 = sk1 - 1;
    for (let f = 0; f < floors; f++) {
      const j0 = Math.floor((f * floorH) / PITCH);
      // площадка на уровне пола: перекрытие под квартирой остаётся, шахта — над ним
      for (let j = j0 + 1; j <= Math.floor(((f + 1) * floorH) / PITCH) - 2; j++)
        for (let i = sIn0; i <= sIn1; i++) for (let k = sK0; k <= sK1; k++) empty(i, j, k);
    }

    // ---- лестница: марши внутри клетки, ступени по 0.25 м ----
    for (let f = 0; f < floors; f++) {
      const baseJ = Math.floor((f * floorH) / PITCH);
      const steps = Math.round(floorH / 0.25);          // 11 ступеней
      const even = f % 2 === 0;
      const laneX = even ? sIn0 + 1 : sIn1 - 1;         // два марша: туда и обратно
      for (let st = 0; st < steps; st++) {
        const jj = baseJ + Math.round(((st + 1) * floorH) / steps / PITCH);
        if (jj >= ny - 2) break;
        // ступени идут вдоль Z от фасада к тылу клетки
        const kk = sK0 + Math.round((st / steps) * (sK1 - sK0));
        for (let j2 = baseJ + 1; j2 <= jj; j2++) add(laneX, j2, kk, 5, s, 0);
      }
      // площадка между маршами на уровне следующего этажа
      const jTop = Math.floor(((f + 1) * floorH) / PITCH) - 2;
      for (let i = sIn0; i <= sIn1; i++) for (let k = sK1 - 1; k <= sK1; k++) add(i, jTop, k, 5, s, 0);
    }

    // ---- вход в подъезд: проём в фасаде точно по ширине клетки ----
    {
      const jDoor = Math.round(2.1 / PITCH);
      for (let i = si0 + 1; i <= si1 - 1; i++) for (let j = 0; j < jDoor; j++) empty(i, j, 0);
      // козырёк над входом
      for (let i = si0 - 1; i <= si1 + 1; i++) for (let k = 0; k <= 1; k++) {
        if (i < 0 || i >= nx) continue;
        add(i, jDoor + 1, k, 1, s, 0);
      }
    }

    // ---- дверь из клетки в прихожую (в стене hallFront уже есть проём по плану) ----
  }

  // ---- крыша ----
  const jRoof = ny - 1;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    if (cells[idx(i, jRoof, k)] >= 0) continue;
    const sec = Math.min(sections - 1, Math.floor(i / secW));
    add(i, jRoof, k, 1, sec, 0);
  }

  let voxels = 0;
  for (let c = 0; c < cells.length; c++) if (cells[c] >= 0) voxels++;

  return {
    spec: { nx, ny, nz, ox: 0, oy: 0, oz: 0, cells, sectionOf, bearing },
    plan,
    size: [nx * PITCH, ny * PITCH, nz * PITCH],
    center: [nx * PITCH / 2, ny * PITCH / 2, nz * PITCH / 2],
    floors, sections,
    stats: { voxels, byKind, entrance: [(Math.floor(secW / 2) + 0.5) * PITCH, 0, 0.5 * PITCH] },
  };
}
