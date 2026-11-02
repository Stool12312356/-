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

export interface VoxelHouseOpts {
  kind: 'khrushchevka' | 'brezhnevka';
  sections?: number;
  floors?: number;
  seed?: number;
}

export interface VoxelHouseModel {
  spec: GridSpec;
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
export const SECTION_W = BAY * BAYS + END * 2;

export function buildVoxelHouse(opts: VoxelHouseOpts): VoxelHouseModel {
  const T = TYPES[opts.kind];
  const floors = opts.floors ?? T.floors;
  const sections = opts.sections ?? 2;
  const floorH = T.floorH, depth = T.depth;
  const W = SECTION_W * sections, H = floors * floorH;

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

  const secW = Math.round(SECTION_W / PITCH);           // 10.2 / 0.5 = 20 вокселей
  const wallRows = 1;                                    // толщина стены 0.5 м

  for (let s = 0; s < sections; s++) {
    const s0 = s * secW;                                 // начало секции по i
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
            const isEntrance = f === 0 && k === 0 && bayI === 1; // подъезд по центру секции
            const isEntranceDoor = isEntrance && j - j0 < Math.round(2.1 / PITCH) && isWindowCol;
            if (isEntranceDoor) continue;                    // проём двери — пусто
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
      // ---- перекрытие (пол следующего этажа) ----
      const jf = Math.floor(((f + 1) * floorH) / PITCH) - 1;
      for (let i = s0; i < s0 + secW; i++) for (let k = 0; k < nz; k++) {
        if (cells[idx(i, jf, k)] >= 0) continue;
        add(i, jf, k, 1, s, 0);
      }
    }
    // ---- подъезд: шахта в центре секции, сквозная через все перекрытия ----
    const ex = s0 + Math.round(secW / 2);           // центр шахты по i
    const ez = Math.round(nz * 0.22);               // ближе к фасаду
    for (let f = 0; f <= floors; f++) {
      const jf = Math.floor((f * floorH) / PITCH) - 1;
      for (let di = -2; di <= 2; di++) for (let dk = -2; dk <= 2; dk++) {
        if (f === 0) empty(ex + di, jf, ez + dk);
        else { empty(ex + di, jf, ez + dk); empty(ex + di, jf - 1, ez + dk); }
      }
    }
    // ---- стены лестничной клетки: отделяют подъезд от квартир, с дверями ----
    // Пользователь: «вход ведёт сразу в квартиру». Теперь заходишь в клетку,
    // а в квартиру ведёт отдельная дверь на площадке.
    for (let f = 0; f < floors; f++) {
      const j0 = Math.floor((f * floorH) / PITCH);
      const jTop = Math.floor(((f + 1) * floorH) / PITCH) - 2;   // до перекрытия
      for (let j = j0; j <= jTop; j++) {
        const localJ = j - j0;
        const doorRow = localJ >= 0 && localJ <= Math.round(2.0 / PITCH) - 1;
        // стены вдоль X (по обе стороны шахты) и сзади, с проёмом двери в квартиру
        for (let di = -2; di <= 2; di++) {
          // задняя стена клетки
          if (!(doorRow && Math.abs(di) <= 1)) add(ex + di, j, ez + 4, 2, s, 0);
        }
        for (let dk = -2; dk <= 4; dk++) {
          const isDoor = doorRow && (dk === ez + 2 || dk === 3);
          if (!isDoor) { add(ex - 3, j, ez + dk, 2, s, 0); add(ex + 3, j, ez + dk, 2, s, 0); }
        }
      }
    }

    // ---- лестница: ступени змейкой по шахте ----
    for (let f = 0; f < floors; f++) {
      const baseJ = Math.floor((f * floorH) / PITCH);
      const steps = Math.round(floorH / 0.25);      // 11 ступеней по 0.25 м
      const even = f % 2 === 0;
      for (let st = 0; st < steps; st++) {
        const jj = baseJ + Math.round((st + 1) * floorH / steps / PITCH);
        if (jj >= ny - 1) break;
        const kk = ez + Math.round((st / steps) * 4) - 2; // ступени идут вдоль Z
        const ii = ex + (even ? 1 : -1);                  // два марша: вперёд-назад
        for (let d = 0; d <= (even ? 1 : -1); d += even ? 1 : -1) {
          const jTop = jj + d;
          // ступень — воксели до самого верха шага
          for (let j2 = jj; j2 <= Math.max(jj, jTop); j2++) add(ii + (d === 0 ? 0 : (even ? 1 : -1)), j2, kk, 5, s, 0);
        }
      }
    }
    // ---- вход в подъезд: козырёк и свободный проход ----
    {
      const ezF = 0;
      const jDoor = Math.round(2.1 / PITCH);
      for (let di = -2; di <= 2; di++) for (let j = 0; j < jDoor; j++) empty(ex + di, j, ezF);
      // плита козырька
      for (let di = -3; di <= 3; di++) for (let dk = -1; dk <= 1; dk++) {
        if (ezF + dk < 0) continue;
        add(ex + di, jDoor + 1, ezF + dk, 1, s, 0);
      }
    }
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
    size: [nx * PITCH, ny * PITCH, nz * PITCH],
    center: [nx * PITCH / 2, ny * PITCH / 2, nz * PITCH / 2],
    floors, sections,
    stats: { voxels, byKind, entrance: [(Math.floor(secW / 2) + 0.5) * PITCH, 0, 0.5 * PITCH] },
  };
}
