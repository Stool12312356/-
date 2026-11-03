// КОНСТРУКТОР ДОМА (M4). Дом собирается из деталей каталога (panels.ts), как из кубиков.
//
// Порядок, который просил пользователь: сначала детали, потом дом.
//   1. Секция = 3 пролёта по 3.0 м (9.0 м) + торцевые простенки 0.6 м = 11.6 м.
//   2. Фасадный ряд каждой секции, каждый этаж: [простенок][окно][окно][окно][простенок]
//      на первом этаже окна заменяются на дверь по центру.
//   3. Балконные панели через этаж (только фасад).
//   4. Торец: глухие панели с прорезями окон по центру.
//   5. Межсекционная стена — кирпичная панель (её можно пробить).
//   6. Плиты перекрытия на этаж, кровля сверху, лестница и площадки в подъезде.
//   7. Мебель в квартирах (интерьер).
//
// Все размеры в метрах, дом стоит на земле: низ первого этажа y = 0.
import type { Surface } from '../shared/types.ts';
import { panelDef, type PanelDef, type PanelKind } from './panels.ts';

export interface PlacedPanel {
  def: PanelDef;
  /** центр панели в локальных координатах дома */
  pos: [number, number, number];
  /** поворот вокруг Y (0 — панель вдоль X, PI/2 — вдоль Z) */
  rotY: number;
  /** секция, этаж и роль (для обрушения/подсчёта) */
  section: number;
  floor: number;
  role: 'wall' | 'window' | 'door' | 'balcony' | 'brick' | 'slab' | 'roof' | 'stair' | 'landing';
  bearing: boolean;
}

export interface PropDef {
  kind: 'bed' | 'table' | 'chair' | 'wardrobe' | 'sofa' | 'shelf' | 'tv' | 'carpet' | 'fridge' | 'lamp';
  pos: [number, number, number];
  rotY: number;
  section: number;
  floor: number;
}

export interface HouseSpec {
  kind: 'khrushchevka' | 'brezhnevka';
  name: string;
  floors: number;
  sections: number;
  floorH: number;
  /** габариты дома: ширина (секции), высота, глубина */
  size: [number, number, number];
  panels: PlacedPanel[];
  props: PropDef[];
  /** статистика для тестов/логов */
  stats: { panels: number; kinds: Record<string, number>; voxels: number };
}

export interface HouseOpts {
  kind: 'khrushchevka' | 'brezhnevka';
  sections?: number;
  floors?: number;
  seed?: number;
}

const TYPES = {
  khrushchevka: { floors: 5, floorH: 2.8, depth: 11.0, name: 'Хрущёвка (5 эт.)' },
  brezhnevka: { floors: 9, floorH: 2.9, depth: 11.6, name: 'Брежневка (9 эт.)' },
} as const;

/** Пролёт между поперечными рёбрами: 3.0 м — реальный шаг панелей серии 1-464. */
const BAY = 3.0;
const BAYS = 3;
const END_PIER = 0.6;
export const SECTION_W = BAY * BAYS + END_PIER * 2;
const WALL_T = 0.32;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function buildHouse(opts: HouseOpts): HouseSpec {
  const T = TYPES[opts.kind];
  const floors = opts.floors ?? T.floors;
  const sections = opts.sections ?? 2;
  const rnd = rng(opts.seed ?? (opts.kind === 'khrushchevka' ? 1971 : 1982));
  const floorH = T.floorH, D = T.depth;
  const W = SECTION_W * sections, H = floors * floorH;

  const panels: PlacedPanel[] = [];
  const props: PropDef[] = [];
  const kinds: Record<string, number> = {};

  const add = (kind: PanelKind, w: number, h: number, pos: [number, number, number], rotY: number,
    section: number, floor: number, bearing = true, role?: PlacedPanel['role']) => {
    const def = panelDef(kind, w, h);
    panels.push({ def, pos, rotY, section, floor, role: role ?? (kind as PlacedPanel['role']), bearing });
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  };

  for (let s = 0; s < sections; s++) {
    const cx0 = -W / 2 + s * SECTION_W;

    for (let f = 0; f < floors; f++) {
      const yc = f * floorH + floorH / 2;
      // ---------- ФАСАД (−Z) ----------
      // простенок слева
      add('wall', END_PIER, floorH, [cx0 + END_PIER / 2, yc, -D / 2], 0, s, f);
      for (let b = 0; b < BAYS; b++) {
        const xc = cx0 + END_PIER + BAY * (b + 0.5);
        // Вход в подъезд — по центру секции на первом этаже.
        // Окно с балконом — во всех пролётах, КРОМЕ центрального: там лестничная клетка
        // (на реальных панельках балконов над подъездом нет).
        const entrance = f === 0 && b === 1;
        const balcony = b !== 1;
        const kind: 'door' | 'balcony' | 'window' = entrance ? 'door' : balcony ? 'balcony' : 'window';
        add(kind, BAY, floorH, [xc, yc, -D / 2], 0, s, f);
      }
      add('wall', END_PIER, floorH, [cx0 + SECTION_W - END_PIER / 2, yc, -D / 2], 0, s, f);

      // ---------- ЗАДНЯЯ СТЕНА (+Z): по окну в пролёте ----------
      add('wall', END_PIER, floorH, [cx0 + END_PIER / 2, yc, D / 2], 0, s, f);
      for (let b = 0; b < BAYS; b++) {
        const xc = cx0 + END_PIER + BAY * (b + 0.5);
        add(b === 1 ? 'wall' : 'window', BAY, floorH, [xc, yc, D / 2], 0, s, f);
      }
      add('wall', END_PIER, floorH, [cx0 + SECTION_W - END_PIER / 2, yc, D / 2], 0, s, f);

      // ---------- ТОРЦЫ (только у крайних секций) ----------
      if (s === 0) {
        // торец — три панели по глубине: простенок + окна + простенок
        const dz = D / 3;
        for (let k = 0; k < 3; k++) {
          const zc = -D / 2 + dz * (k + 0.5);
          add(k === 1 ? 'wall' : 'window', dz, floorH, [-W / 2, yc, zc], Math.PI / 2, s, f);
        }
      }
      if (s === sections - 1) {
        const dz = D / 3;
        for (let k = 0; k < 3; k++) {
          const zc = -D / 2 + dz * (k + 0.5);
          add(k === 1 ? 'wall' : 'window', dz, floorH, [W / 2, yc, zc], Math.PI / 2, s, f);
        }
      }

      // ---------- МЕЖСЕКЦИОННАЯ СТЕНА ----------
      // Кирпичная, НЕ несущая для обрушения: её можно прострелить, но секция держится.
      if (s > 0) add('brick', D, floorH, [cx0, yc, 0], Math.PI / 2, s, f, false);

      // ---------- ЛЕСТНИЦА В ПОДЪЕЗДЕ (по центру секции, между квартирами) ----------
      if (f > 0) {
        add('stair', 2.4, floorH, [cx0 + SECTION_W / 2, yc, -D / 2 + 1.6], Math.PI / 2, s, f, false);
        add('landing', 2.4, 2.4, [cx0 + SECTION_W / 2, f * floorH + 0.11, 0.2], 0, s, f, false);
      }
    }

    // ---------- ПЕРЕКРЫТИЯ И КРОВЛЯ ----------
    for (let f = 1; f <= floors; f++) {
      const y = f * floorH - 0.12;
      const n = Math.max(1, Math.round(SECTION_W / 3.4));
      for (let i = 0; i < n; i++) {
        const w = SECTION_W / n;
        add('slab', w, D, [cx0 + (i + 0.5) * w, y, 0], 0, s, f, false);
      }
    }
    // кровля
    {
      const n = Math.max(1, Math.round(SECTION_W / 3.4));
      for (let i = 0; i < n; i++) {
        const w = SECTION_W / n;
        add('roof', w, D, [cx0 + (i + 0.5) * w, floors * floorH + 0.15, 0], 0, s, floors, false);
      }
    }

    // ---------- МЕБЕЛЬ ----------
    for (let f = 0; f < floors; f++) {
      const y = f * floorH;
      // две квартиры на секцию: слева и справа от лестницы
      for (const side of [-1, 1]) {
        const qx = cx0 + SECTION_W / 2 + side * SECTION_W * 0.28;
        const put = (kind: PropDef['kind'], dx: number, dz: number, rotY = 0) =>
          props.push({ kind, pos: [qx + dx, y, dz], rotY, section: s, floor: f });
        if (rnd() > 0.15) put('bed', -0.9, -D * 0.28, 0);
        if (rnd() > 0.3) put('wardrobe', -1.1, D * 0.24, Math.PI / 2);
        put('table', 0.6, -D * 0.22);
        if (rnd() > 0.4) put('chair', 0.15, -D * 0.22, Math.PI / 2);
        if (rnd() > 0.4) put('chair', 1.05, -D * 0.22, -Math.PI / 2);
        if (rnd() > 0.25) put('sofa', 1.2, D * 0.1, -Math.PI / 2);
        if (rnd() > 0.25) put('tv', 1.5, D * 0.28, Math.PI);
        if (rnd() > 0.4) put('fridge', 0.2, D * 0.3, Math.PI);
        if (rnd() > 0.35) put('shelf', -0.2, D * 0.3, Math.PI);
        if (rnd() > 0.3) put('carpet', 0.2, 0);
        put('lamp', 0, 0);
      }
    }
  }

  const voxels = panels.reduce((n, p) => {
    const nx = Math.max(1, Math.round(p.def.w / p.def.voxel.w));
    const ny = Math.max(1, Math.round(p.def.h / p.def.voxel.h));
    const opening = p.def.opening
      ? Math.round(nx * (p.def.opening.x1 - p.def.opening.x0)) * Math.round(ny * (p.def.opening.y1 - p.def.opening.y0))
      : 0;
    return n + Math.max(1, nx * ny - opening);
  }, 0);

  return {
    kind: opts.kind, name: T.name, floors, sections, floorH,
    size: [W, H, D],
    panels, props,
    stats: { panels: panels.length, kinds, voxels },
  };
}

/** Список ролей, которые считаются несущими для обрушения секции (как в ТЗ). */
export const BEARING_ROLES: ReadonlySet<Surface | PlacedPanel['role']> = new Set(['wall', 'window', 'door', 'balcony']);
