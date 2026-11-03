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
  /** тип дома — ключ пачек геометрии/физики мебели (props.ts) */
  kind: 'khrushchevka' | 'brezhnevka';
  spec: GridSpec;
  /** по этому плану вырезаны внутренние стены и расставлена мебель */
  plan: ApartmentPlan;
  /** габариты в метрах */
  size: [number, number, number];
  /** центр дома в мире (для HUD/поиска) */
  center: [number, number, number];
  floors: number;
  sections: number;
  /** высота этажа, м (нужна лестнице и тестам проходимости) */
  floorH: number;
  stats: { voxels: number; byKind: Record<number, number>; entrance: [number, number, number] };
}

const TYPES = {
  khrushchevka: { floors: 5, floorH: 3.0, name: 'Хрущёвка' },
  brezhnevka: { floors: 9, floorH: 3.0, name: 'Брежневка' },
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
  // БАГ (найден тестом): высота этажа 2.8 м не кратна шагу сетки 0.5, поэтому полы
  // этажей получались на 2.5 и на 3.0 м по очереди — «этажи волнистые», а лестница
  // (её высота = floorH) не совпадала с полом. Теперь высота этажа кратна сетке.
  const floorH = Math.round(T.floorH / PITCH) * PITCH;
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

  const secW = Math.round(plan.w / PITCH);              // 12.0 / 0.5 = 24 вокселя
  /** центр вокселя по X (в координатах плана) */
  const xCenter = (i: number) => (i + 0.5) * PITCH - (nx * PITCH) / 2;
  /** центр вокселя по Z (в координатах плана) */
  const zCenter = (k: number) => (k + 0.5) * PITCH - (nz * PITCH) / 2;

  for (let s = 0; s < sections; s++) {
    const s0 = s * secW;                                 // начало секции по i
    // метры плана → индексы сетки. План задан по ОСЕВЫМ линиям стен (они проходят через
    // ЦЕНТРЫ вокселей), поэтому floor, а не round: round «съезжал» на полвокселя.
    // Перевод координаты плана в индекс сетки. Раньше здесь складывались ДВА
    // центрирования: `s0` (начало секции в вокселях) и `secOffset` (смещение секции
    // ОТ ЦЕНТРА ВСЕГО ДОМА). При 1 секции ошибка компенсировалась (s0 = 0), а при
    // 3 секциях внутренние стены, двери и шахта уезжали на секцию вперёд и вылезали
    // за сетку: шахта оказывалась за пределами дома, плиты её заливали, и из проёма
    // в подъезде росла «лестница в никуда» — марши шли в перекрытие. Именно поэтому
    // тесты (1 секция) были зелёные, а в игре (3 секции) — нет.
    const secOffset = (s - (sections - 1) / 2) * plan.w;
    const PI = (x: number) => Math.floor((x + secOffset + (nx * PITCH) / 2) / PITCH);
    const PK = (z: number) => Math.floor((z + (nz * PITCH) / 2) / PITCH);
    // ---- стены по периметру + межсекционная ----
    for (let f = 0; f < floors; f++) {
      // ВАЖНО: этажи считаем через floor одной формулы. Раньше низ этажа округлялся
      // отдельно от верха, между этажами появлялись щели в целый воксель (видно на превью
      // как «этажи парят»).
      const j0 = Math.floor((f * floorH) / PITCH);
      const j1 = Math.floor(((f + 1) * floorH) / PITCH) - 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = s0; i < s0 + secW; i++) {
          // фасад/тыл — в КАЖДОЙ секции: у каждого подъезда своя дверь и свои окна
          for (const k of [PK(plan.entrance.z), nz - 1]) {
            // проём под окно: 2.05/0.85 м → примерно воксели 2..4 (снизу 0.85 = 1.7 вокс)
            const localJ = j - j0;
            const winLo = Math.round(0.85 / PITCH), winHi = Math.round(2.05 / PITCH) - 1;
            const isWindowRow = localJ >= winLo && localJ <= winHi;
            // ОКНА ТОЛЬКО ТАМ, ГДЕ ИХ ЗАДАЛ ПЛАН (plan.windows). Раньше окно ставилось
            // «в каждом пролёте фасада» и появлялось в санузле и лестничной клетке.
            const isFacade = k === PK(plan.entrance.z);
            const xc = xCenter(i) - secOffset;       // X в координатах секции
            const inWindow = isWindowRow && plan.windows.some(w =>
              (isFacade ? w.side === 'facade' : w.side === 'back') &&
              PK(w.z) === k && xc >= w.x0 - 0.01 && xc <= w.x1 + 0.01);
            // подъездная дверь — проём на первом этаже, ровно по ширине из плана
            const isDoorCell = f === 0 && isFacade &&
              Math.abs(xc - plan.entrance.x) <= plan.entrance.width / 2 + 0.01;
            if (isDoorCell && j < Math.round(2.4 / PITCH)) continue;   // проём двери
            if (inWindow) { add(i, j, k, 3, s, 1); continue; }         // стекло
            add(i, j, k, 0, s, 1);
          }
        }
        // торцы: окно только в задней половине (там жилые комнаты), в клетке у фасада — нет
        const localJt = j - j0;
        const winRowT = localJt >= Math.round(0.85 / PITCH) && localJt <= Math.round(2.05 / PITCH) - 1;
        const kWin0 = Math.round(nz * 0.55), kWin1 = Math.round(nz * 0.8);
        if (s === 0) for (let k = 1; k < nz - 1; k++)
          add(0, j, k, winRowT && k > kWin0 && k < kWin1 ? 3 : 0, s, 1);
        if (s === sections - 1) for (let k = 1; k < nz - 1; k++)
          add(nx - 1, j, k, winRowT && k > kWin0 && k < kWin1 ? 3 : 0, s, 1);
        // межсекционная СТЕНА НА ВСЮ ГЛУБИНУ: это стена между квартирами, а не
        // один воксель в середине (через него квартиры «сообщались»).
        if (s > 0) for (let k = 0; k < nz; k++) add(s0, j, k, 2, s, 0);
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
        const a = horiz ? Math.min(wseg.x0, wseg.x1) : Math.min(wseg.z0, wseg.z1);
        const b = horiz ? Math.max(wseg.x0, wseg.x1) : Math.max(wseg.z0, wseg.z1);
        const n = Math.round((b - a) / PITCH);
        for (let t = 0; t <= n; t++) {
          const coord = a + t * PITCH;                     // ровно центры вокселей
          const off = coord - a;                            // смещение вдоль стены
          const inDoor = wseg.doors.some(([d0, d1]) => off >= d0 - 0.01 && off <= d1 + 0.01);
          const i = horiz ? PI(coord) : PI(wseg.x0);
          const k = horiz ? PK(wseg.z0) : PK(coord);
          // БАГ (видно на фото фасада): внутренние перегородки доходили до наружной
          // стены и ПЕРЕЗАПИСЫВАЛИ её кирпичом — на фасаде появлялись коричневые полосы.
          // Внутренние стены ставим только во внутреннем объёме секции.
          const inner = k > 0 && k < nz - 1 && (i % secW) > 0 && (i % secW) < secW - 1;
          if (!inner) continue;
          for (let j = j0; j < jf; j++) {
            if (inDoor && j <= jDoorTop) continue;      // проём двери
            add(i, j, k, 2, s, 0);                       // кирпичная перегородка (не несущая)
          }
        }
      }

      // ---- перекрытие (пол следующего этажа) ----
      // Лестничный проём НЕ заделываем: шахта задана планом (plan.stairs), иначе
      // перекрытие замуровывает лестницу (из-за этого раньше «не было лестницы на этажи»).
      // ВАЖНО: plan.stairs задан «вплотную к стенам», а стена занимает целый воксель.
      // Поэтому внутренний объём клетки = границы ±1 воксель. Без этого шахта съедала
      // стену между клеткой и прихожей (получался проход шириной 6 м и «нет стены»).
      // plan.stairs — уже ВНУТРЕННИЙ объём клетки (между осями стен), и стена занимает
      // воксель вокруг своей оси. Отступ «±1 воксель» срезал лишнее: крайние клетки
      // шахты заливались плитой, и марш проходил СКВОЗЬ перекрытие — на скриншоте это
      // «лестница в никуда». Внутренний объём = PI(x0) .. PI(x1)-1.
      const si0p = PI(plan.stairs.x0), si1p = PI(plan.stairs.x1) - 1;
      const sk0p = PK(plan.stairs.z0), sk1p = PK(plan.stairs.z1) - 1;
      for (let i = s0; i < s0 + secW; i++) for (let k = 0; k < nz; k++) {
        if (cells[idx(i, jf, k)] >= 0) continue;
        if (i >= si0p && i <= si1p && k >= sk0p && k <= sk1p) continue;  // шахта
        add(i, jf, k, 1, s, 0);
      }
    }
    // ---- ЛЕСТНИЧНАЯ КЛЕТКА по плану: шахта ровно внутри стен прихожей ----
    // Раньше шахта стояла «где получилось» и прорезала стены квартиры — получалось,
    // что между квартирами нет стены. Теперь границы берём из плана (plan.stairs).
    // plan.stairs задан по ВНУТРЕННЕМУ объёму клетки (между стенами), поэтому
    // дополнительных отступов не нужно — иначе шахта съедала стены квартиры.
    const sIn0 = PI(plan.stairs.x0), sIn1 = PI(plan.stairs.x1) - 1;
    const sK0 = PK(plan.stairs.z0), sK1 = PK(plan.stairs.z1) - 1;
    for (let f = 0; f < floors; f++) {
      const j0 = Math.floor((f * floorH) / PITCH);
      // ВАЖНО: на первом этаже оставляем слой j = 0 — это ПОЛ подъезда. Если начать
      // вырезать с него, под ногами открывается дырка и видно небо (было на фото).
      const jFrom = f === 0 ? 1 : j0;
      // всё, что выше пола этого этажа и ниже перекрытия следующего, — пусто
      for (let j = jFrom; j <= Math.floor(((f + 1) * floorH) / PITCH) - 1; j++)
        for (let i = sIn0; i <= sIn1; i++) for (let k = sK0; k <= sK1; k++) empty(i, j, k);
    }

    // ---- крыльцо и козырёк над входом (видно на фото: вход «в стене», без крыльца) ----
    {
      const iDoor0 = PI(plan.entrance.x - plan.entrance.width / 2);
      const iDoor1 = PI(plan.entrance.x + plan.entrance.width / 2);
      const jDoorTop = Math.round(2.4 / PITCH);
      // козырёк — плита над дверью, на 1 воксель вперёд от фасада
      for (let i = iDoor0 - 1; i <= iDoor1 + 1; i++) {
        if (i < 0 || i >= nx) continue;
        add(i, jDoorTop, 0, 1, s, 0);
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
    kind: opts.kind,
    spec: { nx, ny, nz, ox: 0, oy: 0, oz: 0, cells, sectionOf, bearing },
    plan,
    size: [nx * PITCH, ny * PITCH, nz * PITCH],
    center: [nx * PITCH / 2, ny * PITCH / 2, nz * PITCH / 2],
    floors, sections, floorH,
    stats: { voxels, byKind, entrance: [(Math.floor(secW / 2) + 0.5) * PITCH, 0, 0.5 * PITCH] },
  };
}
