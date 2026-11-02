// НАСТОЯЩАЯ ЛЕСТНИЦА В ПОДЪЕЗДЕ (M7).
//
// Почему не вокселями: шаг сетки 0.5 м, поэтому ступень из вокселей получается высотой
// 0.5 м — это 45°, по такой капсула персонажа не поднимается (autostep 0.4), и получалась
// «лестница», по которой нельзя взойти. Тест с настоящим Rapier (tools/test-walk.mjs) это
// сразу показал: игрок упирался в первую ступень и оставался на первом этаже.
//
// Здесь двухмаршевая лестница считается аналитически и отдаётся одним мешем + одним
// тримешем на физику. Компоновка — как в жизни (снизу вверх):
//
//        фасад (вход)                              тыл
//   ┌───────────────┬──────────────┐
//   │  площадка     │ марш 0  ↑    │  этаж N:  вошли в дверь — стоим на площадке,
//   │  этажа        │ (левая)      │  марш 0 идёт вглубь и поднимает на пол-этажа,
//   ├───────────────┴──────────────┤  в тылу разворот на площадке,
//   │  марш 1  ↑    │              │  марш 1 возвращается к фасаду и выводит на этаж N+1.
//   │ (правая)      │ площадка 1.4 │
//   └───────────────┴──────────────┘
//
// На первом этаже фасадная площадка — это пол подъезда: заходишь с улицы и сразу
// оказываешься под маршем 1 (над головой ~2.6 м), а слева начинается марш 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ApartmentPlan } from './plan';

export interface Staircase {
  /** видимая геометрия всех маршей и площадок (мировые координаты дома) */
  mesh: THREE.Mesh;
  /** та же геометрия для физики (один статичный тримеш) */
  verts: Float32Array;
  idx: Uint32Array;
  /** ступеней на марш, подступ, проступь — для тестов */
  steps: number;
  rise: number;
  tread: number;
  floorH: number;
  /** область плана, занятая маршами (для теста-ходока) */
  zone: { x0: number; x1: number; z0: number; z1: number };
  /** глубина фасадной площадки и площадки разворота */
  landing: number;
}

/** Отступ от стен клетки: капсула r = 0.3 м не должна задевать стену на повороте. */
const INSET = 0.15;
const STEP_RISE_MIN = 0.13, STEP_RISE_MAX = 0.2;
/** Глубина площадок: фасадной (вход) и разворотной — не меньше диаметра капсулы (0.6) + запас */
const LANDING = 1.2;

interface Dims {
  steps: number; rise: number; tread: number;
  x0: number; x1: number; zFront: number; zBack: number;
  /** площадки шире маршей: доходят до стен, иначе у двери остаётся щель без пола */
  lx0: number; lx1: number;
  laneL: [number, number]; laneR: [number, number];
}

function dims(plan: ApartmentPlan, floorH: number): Dims {
  const s = plan.stairs;
  const x0 = s.x0 + INSET, x1 = s.x1 - INSET;
  const zFront = s.z0 + INSET, zBack = s.z1 - INSET;
  const steps = Math.max(7, Math.min(12, Math.round(floorH / 2 / 0.16)));
  const rise = floorH / 2 / steps;
  if (rise > STEP_RISE_MAX) throw new Error(`лестница слишком крутая: подступ ${rise.toFixed(3)} м`);
  if (rise < STEP_RISE_MIN) throw new Error(`лестница слишком пологая: подступ ${rise.toFixed(3)} м`);
  const flightLen = (zBack - zFront) - 2 * LANDING;
  const tread = flightLen / steps;
  if (tread < 0.24) throw new Error(`проступь слишком узкая: ${tread.toFixed(3)} м`);
  const mid = (x0 + x1) / 2;
  return {
    steps, rise, tread, x0, x1, zFront, zBack,
    lx0: s.x0 - 0.25, lx1: s.x1 + 0.25,
    laneL: [x0, mid], laneR: [mid, x1],
  };
}

/**
 * Марш: ступени — плиты толщиной TREND. ВАЖНО: нельзя делать ступени блоками «до пола
 * марша»: тогда над головой идущего по нижнему маршу остаётся всего 3.0 − 1.5 − 1.8 < 0 м,
 * потому что марш следующего этажа начинается на той же высоте основания. С плитами
 * просвет = высота этажа − толщина плиты = 2.75 м (тест это проверяет).
 * Плиты соседних ступеней перекрываются по высоте (0.3 > подступ 0.167) — марш выглядит
 * сплошным, без «парящих дощечек».
 */
const TREAD_THICK = 0.32;
function flight(
  out: THREE.BufferGeometry[], lane: [number, number], yBase: number,
  zStart: number, dir: 1 | -1, d: Dims,
) {
  const w = lane[1] - lane[0];
  for (let i = 0; i < d.steps; i++) {
    const top = yBase + (i + 1) * d.rise;
    const h = Math.min(top - yBase, TREAD_THICK);
    const g = new THREE.BoxGeometry(w, h, d.tread + 0.01);
    g.translate(lane[0] + w / 2, top - h / 2, zStart + dir * (i + 0.5) * d.tread);
    out.push(g);
  }
}

function landing(out: THREE.BufferGeometry[], d: Dims, yTop: number, zCenter: number, depth = LANDING) {
  const g = new THREE.BoxGeometry(d.lx1 - d.lx0, 0.22, depth);
  g.translate((d.lx0 + d.lx1) / 2, yTop - 0.11, zCenter);
  out.push(g);
}

export function buildStaircase(
  plan: ApartmentPlan, floors: number, floorH: number, origin: THREE.Vector3,
): Staircase {
  const d = dims(plan, floorH);
  const geos: THREE.BufferGeometry[] = [];
  /** начало марша 0 (у фасадной площадки) и площадки разворота */
  const zFlight0 = d.zFront + LANDING;
  const zFlight1 = d.zBack - LANDING;

  for (let f = 0; f < floors; f++) {
    const y = f * floorH;
    const midY = y + floorH / 2;
    // марш 0: от фасада вглубь, левая половина клетки
    flight(geos, d.laneL, y, zFlight0 + 0.001, +1, d);
    // площадка разворота в тылу, во всю ширину
    landing(geos, d, midY, d.zBack - LANDING / 2);
    // марш 1: от тыла к фасаду, правая половина, с площадки разворота
    flight(geos, d.laneR, midY, zFlight1 - 0.001, -1, d);
    // площадка этажа у фасада: на неё выводит марш 1 и с неё вход в коридор.
    // На первом этаже это пол подъезда, поэтому «плиту» не рисуем — она совпадает с полом.
    if (f > 0) landing(geos, d, y, d.zFront + LANDING / 2);
  }

  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('не удалось собрать геометрию лестницы');
  merged.computeVertexNormals();
  for (const g of geos) g.dispose();

  const mat = new THREE.MeshStandardMaterial({ color: '#b9b4a8', roughness: 0.92, metalness: 0.02 });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.position.copy(origin);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'staircase';

  // физика: те же вершины, только сразу в мировых координатах
  const pos = merged.getAttribute('position').array as Float32Array;
  const verts = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    verts[i] = pos[i] + origin.x;
    verts[i + 1] = pos[i + 1] + origin.y;
    verts[i + 2] = pos[i + 2] + origin.z;
  }
  const idxArr = merged.getIndex();
  const idx = idxArr
    ? new Uint32Array(idxArr.array as ArrayLike<number>)
    : new Uint32Array(pos.length / 3).map((_, i) => i);

  return {
    mesh, verts, idx, steps: d.steps, rise: d.rise, tread: d.tread, floorH,
    zone: { x0: d.x0, x1: d.x1, z0: d.zFront, z1: d.zBack },
    landing: LANDING,
  };
}

/**
 * Пол площадок лестницы как функция: нужна навигации и тестам, чтобы знать, где в
 * лестничной клетке есть пол (в вокселях его нет — там шахта).
 * Возвращает true, если в точке (x,z) плана на высоте feet есть площадка.
 */
export function landingFloor(plan: ApartmentPlan, floorH: number) {
  const d = dims(plan, floorH);
  const snap = (v: number) => Math.abs(v - Math.round(v / floorH) * floorH) < 0.3;
  return (x: number, z: number, feet: number): boolean => {
    if (x < d.lx0 || x > d.lx1) return false;
    // фасадная площадка: уровень этажа
    if (z >= d.zFront && z <= d.zFront + LANDING && snap(feet)) return true;
    // площадка разворота: пол-этажа
    if (z >= d.zBack - LANDING && z <= d.zBack &&
        Math.abs(feet - (Math.round((feet - floorH / 2) / floorH) * floorH + floorH / 2)) < 0.3) return true;
    return false;
  };
}

/** Параметры марша — для тестов и отладки. */
export function staircaseInfo(plan: ApartmentPlan, floorH: number) {
  const d = dims(plan, floorH);
  return {
    steps: d.steps, rise: d.rise, tread: d.tread,
    flightLen: d.steps * d.tread, landing: LANDING,
    /** подступ < 0.4 м — значит персонаж (autostep 0.4) физически может подняться */
    climbable: d.rise <= 0.4,
  };
}
