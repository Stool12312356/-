// СЕТКА ПРОХОДИМОСТИ ДЛЯ ТЕСТОВ (M7).
//
// Зачем: тест «можно ли войти в комнату» нельзя писать как «идти по прямой к центру» —
// в квартире есть повороты, и бот застревал в углу, хотя проход есть. Здесь считается
// честная сетка 0.25 м: клетка проходима, если в ней помещается капсула игрока
// (r = 0.3 м, высота 1.8 м) и под ногами есть пол. Дальше BFS даёт маршрут, а
// tools/test-walk.mjs проходит этот маршрут настоящей физикой.
//
// ВАЖНО: этот модуль только для тестов/отладки, в игру не входит.

import type { GridSpec } from './voxelhouse';

export const NAV_STEP = 0.25;
export type Solid = (i: number, j: number, k: number) => boolean;
export interface NavOrigin { ox: number; oy: number; oz: number }
export interface PathPoint { x: number; z: number }
const R = 0.3;              // радиус капсулы (как в physics/worker.ts)
const HEAD = 1.8;           // высота стоя
const FOOT = 0.06;          // зазор под ногами
const PITCH = 0.5;

/** Мир-воксели: solid(j) по индексам. Стекло (тип 3) тоже препятствие — окно не проход. */
export function makeSolid(spec: GridSpec): Solid {
  const { nx, ny, nz, cells } = spec;
  return (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return false;
    return cells[(j * nz + k) * nx + i] >= 0;
  };
}

/**
 * Проходима ли клетка (x,z) на уровне пола feetY.
 * Колонки вокселей переводятся в метры со смещением ox/oy/oz (у voxelgen — 0,0,0).
 */
export function walkableAt(
  solid: Solid, x: number, feetY: number, z: number,
  o: NavOrigin = { ox: 0, oy: 0, oz: 0 },
  /** дополнительные «полы», которых нет в вокселях (площадки лестницы) */
  extraFloor?: (x: number, z: number, feetY: number) => boolean,
): boolean {
  const i0 = Math.floor((x - R - o.ox) / PITCH), i1 = Math.floor((x + R - o.ox) / PITCH);
  const k0 = Math.floor((z - R - o.oz) / PITCH), k1 = Math.floor((z + R - o.oz) / PITCH);
  const j0 = Math.floor((feetY + FOOT - o.oy) / PITCH);
  const j1 = Math.floor((feetY + HEAD - o.oy) / PITCH);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (let k = k0; k <= k1; k++) if (solid(i, j, k)) return false;
    }
  }
  // пол: под ногами должна быть твёрдая поверхность (иначе это дырка в перекрытии).
  // Исключение — уровень земли снаружи дома: там пол задаёт террейн/плоскость физики,
  // а не воксели. Без этого исключения BFS не выходил за пределы пятна дома.
  // центр вокселя пола: round(низ/PITCH) - 1 (пол 3.0 м → воксель 5)
  const jf = Math.round((feetY - o.oy) / PITCH) - 1;
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
    if (solid(i, jf, k)) return true;
  }
  if (extraFloor && extraFloor(x, z, feetY)) return true;
  return feetY <= 0.2 + Math.abs(o.oy);
}

/**
 * Все клетки, достижимые из точки (BFS). Возвращает Проверялку: reachable(x,z) и карту.
 * Такой вид нужен для вопроса «можно ли вообще войти в комнату», а не «есть ли путь
 * ровно в центр». Именно из-за второго варианта тесты были зелёные, а зайти было нельзя.
 */
export function bfsReach(
  solid: Solid, from: readonly number[], feetY: number,
  o: NavOrigin = { ox: 0, oy: 0, oz: 0 },
  area: [number, number, number, number] = [-200, 200, -200, 200],
  extraFloor?: (x: number, z: number, feetY: number) => boolean,
): { reachable: (x: number, z: number) => boolean; size: number } | null {
  const [ax0, ax1, az0, az1] = area;
  const gx0 = Math.ceil((ax0 - o.ox) / NAV_STEP), gx1 = Math.floor((ax1 - o.ox) / NAV_STEP);
  const gz0 = Math.ceil((az0 - o.oz) / NAV_STEP), gz1 = Math.floor((az1 - o.oz) / NAV_STEP);
  const W = gx1 - gx0 + 1, Hh = gz1 - gz0 + 1;
  // КЛЮЧЕВОЙ БАГ, который стоил «бот не находит путь при проходимой сетке»:
  // при key < 0 оператор % в JS возвращает отрицательное число, и разбор клетки
  // `(cur % W) + gx0` давал мусорные координаты (BFS «застревал» в первой клетке).
  // Индексы держим неотрицательными: (gz - gz0) и (gx - gx0) всегда >= 0.
  const key = (gx: number, gz: number) => (gz - gz0) * W + (gx - gx0);
  // k % W в JS может быть отрицательным — приводим к неотрицательному остатку
  const unKeyX = (k: number) => ((k % W) + W) % W + gx0;
  const unKeyZ = (k: number) => ((k / W) | 0) + gz0;
  const pass = new Map<number, boolean>();
  const ok = (gx: number, gz: number) => {
    const k = key(gx, gz);
    let v = pass.get(k);
    if (v === undefined) {
      v = walkableAt(solid, gx * NAV_STEP + o.ox, feetY, gz * NAV_STEP + o.oz, o, extraFloor);
      pass.set(k, v);
    }
    return v;
  };
  // стартовую клетку ищем рядом: игрок может стоять «в допуске» от стены
  let sx = Math.round((from[0] - o.ox) / NAV_STEP), sz = Math.round((from[2] - o.oz) / NAV_STEP);
  if (!ok(sx, sz)) {
    let best: { gx: number; gz: number } | null = null, bd = Infinity;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (!ok(sx + dx, sz + dz)) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = { gx: sx + dx, gz: sz + dz }; }
    }
    if (!best) return null;
    sx = best.gx; sz = best.gz;
  }
  const seen = new Uint8Array(W * Hh);
  const q = new Int32Array(W * Hh);
  let qh = 0, qt = 0;
  q[qt++] = key(sx, sz);
  seen[q[0]] = 1;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (qh < qt) {
    const cur = q[qh++];
    const gx = ((cur % W) + W) % W + gx0, gz = ((cur / W) | 0) + gz0;
    for (const [dx, dz] of DIRS) {
      const nx2 = gx + dx, nz2 = gz + dz;
      if (nx2 < gx0 || nx2 > gx1 || nz2 < gz0 || nz2 > gz1) continue;
      const k = key(nx2, nz2);
      if (seen[k] || !ok(nx2, nz2)) continue;
      seen[k] = 1; q[qt++] = k;
    }
  }
  return {
    size: qt,
    reachable(x: number, z: number) {
      const gx = Math.round((x - o.ox) / NAV_STEP), gz = Math.round((z - o.oz) / NAV_STEP);
      if (gx < gx0 || gx > gx1 || gz < gz0 || gz > gz1) return false;
      return seen[key(gx, gz)] === 1;
    },
  };
}

/**
 * BFS по сетке от точки до точки. Возвращает массив точек пути (мировые XZ) или null.
 * solid — функция (i,j,k) → препятствие; ox/oz/oy — смещение сетки.
 */
export function findPath(
  solid: Solid, from: readonly number[], to: readonly number[], feetY: number,
  o: NavOrigin = { ox: 0, oy: 0, oz: 0 }, area: [number, number, number, number] = [-200, 200, -200, 200],
  extraFloor?: (x: number, z: number, feetY: number) => boolean,
): PathPoint[] | null {
  const [ax0, ax1, az0, az1] = area;
  const gx0 = Math.ceil((ax0 - o.ox) / NAV_STEP), gx1 = Math.floor((ax1 - o.ox) / NAV_STEP);
  const gz0 = Math.ceil((az0 - o.oz) / NAV_STEP), gz1 = Math.floor((az1 - o.oz) / NAV_STEP);
  const W = gx1 - gx0 + 1, Hh = gz1 - gz0 + 1;
  // КЛЮЧЕВОЙ БАГ, который стоил «бот не находит путь при проходимой сетке»:
  // при key < 0 оператор % в JS возвращает отрицательное число, и разбор клетки
  // `(cur % W) + gx0` давал мусорные координаты (BFS «застревал» в первой клетке).
  // Индексы держим неотрицательными: (gz - gz0) и (gx - gx0) всегда >= 0.
  const key = (gx: number, gz: number) => (gz - gz0) * W + (gx - gx0);
  // k % W в JS может быть отрицательным — приводим к неотрицательному остатку
  const unKeyX = (k: number) => ((k % W) + W) % W + gx0;
  const unKeyZ = (k: number) => ((k / W) | 0) + gz0;
  const g2w = (gx: number, gz: number) => ({ x: gx * NAV_STEP + o.ox, z: gz * NAV_STEP + o.oz });

  // Индексы сетки — мировые (могут быть отрицательными), key() переводит их в >= 0
  const start = { gx: Math.round((from[0] - o.ox) / NAV_STEP), gz: Math.round((from[2] - o.oz) / NAV_STEP) };
  const goal = { gx: Math.round((to[0] - o.ox) / NAV_STEP), gz: Math.round((to[2] - o.oz) / NAV_STEP) };
  if (start.gx < gx0 || start.gx > gx1 || start.gz < gz0 || start.gz > gz1) return null;
  if (goal.gx < gx0 || goal.gx > gx1 || goal.gz < gz0 || goal.gz > gz1) return null;

  // предпосчёт проходимости (с мемоизацией — BFS по 2000 клеток не должен считать всё заново)
  const pass = new Map<number, boolean>();
  const ok = (gx: number, gz: number) => {
    const k = key(gx, gz);
    let v = pass.get(k);
    if (v === undefined) {
      const p = g2w(gx, gz);
      v = walkableAt(solid, p.x, feetY, p.z, o, extraFloor);
      pass.set(k, v);
    }
    return v;
  };
  if (!ok(start.gx, start.gz)) {
    // старт может быть чуть в стене — ищем ближайшую проходимую клетку
    let best: { gx: number; gz: number } | null = null;
    let bd = Infinity;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (ok(start.gx + dx, start.gz + dz)) {
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = { gx: start.gx + dx, gz: start.gz + dz }; }
      }
    }
    if (!best) return null;
    start.gx = best.gx; start.gz = best.gz;
  }

  // Цель тоже может попасть в клетку, которую консервативная проверка капсулы
  // считает занятой (узкая комната: цель «в центр» рядом со стеной). Без подбора
  // findPath возвращал null, хотя комната проходима — на этом застревал фото-проход
  // в санузле. Ищем ближайшую проходимую клетку к цели.
  if (!ok(goal.gx, goal.gz)) {
    let best: { gx: number; gz: number } | null = null;
    let bd = Infinity;
    for (let r = 1; r <= 8 && !best; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const gx = goal.gx + dx, gz = goal.gz + dz;
        if (gx < gx0 || gx > gx1 || gz < gz0 || gz > gz1) continue;
        if (!ok(gx, gz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = { gx, gz }; }
      }
    }
    if (!best) return null;
    goal.gx = best.gx; goal.gz = best.gz;
  }

  const prev = new Int32Array(W * Hh).fill(-1);
  const seen = new Uint8Array(W * Hh);
  const q = [key(start.gx, start.gz)];
  seen[q[0]] = 1;
  const goalKey = key(goal.gx, goal.gz);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  for (let head = 0; head < q.length; head++) {
    const cur = q[head];
    if (cur === goalKey) { found = true; break; }
    const gx = unKeyX(cur), gz = unKeyZ(cur);
    for (const [dx, dz] of DIRS) {
      const nx2 = gx + dx, nz2 = gz + dz;
      if (nx2 < gx0 || nx2 > gx1 || nz2 < gz0 || nz2 > gz1) continue;
      const k = key(nx2, nz2);
      if (seen[k] || !ok(nx2, nz2)) continue;
      seen[k] = 1; prev[k] = cur; q.push(k);
    }
  }
  if (!found) return null;

  const path: PathPoint[] = [];
  for (let k = goalKey; k !== -1; k = prev[k]) {
    const gx = unKeyX(k), gz = unKeyZ(k);
    const p = g2w(gx, gz);
    path.push({ x: p.x, z: p.z });
    if (k === key(start.gx, start.gz)) break;
  }
  path.reverse();
  // прореживание: оставляем точки, где направление меняется (меньше «дёрганья»)
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const d1 = { x: b.x - a.x, z: b.z - a.z }, d2 = { x: c.x - b.x, z: c.z - b.z };
    if (Math.abs(d1.x * d2.z - d1.z * d2.x) > 1e-9) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}
