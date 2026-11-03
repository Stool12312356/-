// РАЗРУШАЕМЫЕ ПРЕДМЕТЫ: МЕБЕЛЬ И ЛЕСТНИЦА.
//
// Почему отдельный модуль: стены дома разрушаются вокселями, а мебель и лестница — нет,
// у них своя геометрия. Раньше они были чистой декорацией: физического тела не было
// вообще, пуля пролетала сквозь стул, стол и ступени, взрыв их не задевал.
// Пользователь: «сделай так, чтоб лестницу и мебель тоже можно было разрушать».
//
// Как устроено:
//  * Предметы группируются в «пачки» (bucket) — по дому, этажу и материалу. На пачку
//    приходится ОДНО тело физики (тримеш) и один меш в сцене: иначе 500 предметов дают
//    500 draw call и 500 тел, и кадр рассыпается.
//  * У каждого предмета в пачке свой диапазон геометрии. Когда предмет сломан, его
//    геометрия выкидывается, пачка пересобирается (меш + тримеш). Это происходит
//    редко — по факту разрушения, — поэтому дёшево.
//  * Попадание ищет БЛИЖАЙШИЙ живой предмет к точке удара: тело-пачка не знает, во что
//    именно попали, а точка попадания знает.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsClient } from '../physics/client.ts';

export type PartKind = 'wood' | 'metal' | 'stone' | 'glass';

export interface PropItem {
  id: number;
  type: 'furniture' | 'stairs';
  /** вид мебели из plan.ts (для тестов/подписей) или 'stair' */
  kind: string;
  hp: number;
  maxHp: number;
  kindMat: PartKind;
  /** габарит в мире */
  box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
  bucket: Bucket;
  dead: boolean;
  /** предмет одной мебели, собранный из нескольких материалов: ломается целиком */
  family: number;
}

interface Bucket {
  key: string;
  material: THREE.Material;
  surface: 'wood' | 'concrete' | 'metal' | 'glass' | 'plaster';
  live: { item: PropItem; geo: THREE.BufferGeometry }[];
  mesh: THREE.Mesh | null;
  bodyId: number;
}

/** Сопротивление материалов: во сколько раз материал гасит урон. */
const RESIST: Record<PartKind, number> = { wood: 1.0, glass: 0.3, metal: 1.8, stone: 2.4 };

export class Props {
  items: PropItem[] = [];
  private buckets = new Map<string, Bucket>();
  /** тела физики, которые принадлежат предметам: по ним отличаем «попал в стол» от
   *  «попал в стену рядом со столом» */
  private propBodies = new Set<number>();
  private nextId = 1;
  private phys: PhysicsClient;
  constructor(phys: PhysicsClient) { this.phys = phys; }

  /** Появление новой пачки (дом/этаж/материал). */
  private bucket(key: string, material: THREE.Material, surface: Bucket['surface']): Bucket {
    let b = this.buckets.get(key);
    if (!b) { b = { key, material, surface, live: [], mesh: null, bodyId: -1 }; this.buckets.set(key, b); }
    return b;
  }

  /**
   * Добавить предмет. `geos` — уже в мировых координатах.
   * Прочность считается по объёму: ножка стула ломается с одной пули, шкаф — с трёх.
   */
  add(opts: {
    type: PropItem['type']; kind: string; geos: THREE.BufferGeometry[];
    material: THREE.Material; bucketKey: string; surface: Bucket['surface'];
    kindMat: PartKind; family?: number; hpScale?: number;
  }): PropItem | null {
    const geos = opts.geos.filter(g => g.getAttribute('position')?.count);
    if (!geos.length) return null;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) return null;
    merged.computeBoundingBox();
    const bb = merged.boundingBox!;
    const size = new THREE.Vector3(); bb.getSize(size);
    const vol = Math.max(0.004, size.x * size.y * size.z);
    // базовая прочность: у дерева 260 «единиц» на кубометр, у бетона-камня больше
    const base = { wood: 260, glass: 90, metal: 900, stone: 1300 }[opts.kindMat];
    const hp = Math.min(3000, Math.max(45, base * (0.25 + vol * 1.6) * (opts.hpScale ?? 1)));
    const b = this.bucket(opts.bucketKey, opts.material, opts.surface);
    const item: PropItem = {
      id: this.nextId++, type: opts.type, kind: opts.kind, hp, maxHp: hp, kindMat: opts.kindMat,
      box: { x0: bb.min.x, y0: bb.min.y, z0: bb.min.z, x1: bb.max.x, y1: bb.max.y, z1: bb.max.z },
      bucket: b, dead: false, family: opts.family ?? 0,
    };
    b.live.push({ item, geo: merged });
    this.items.push(item);
    for (const g of geos) if (g !== merged) g.dispose();
    return item;
  }

  /** Собрать все пачки: меш в сцену + тримеш в физику. Вызывается один раз после расстановки. */
  build(scene: THREE.Scene) {
    for (const b of this.buckets.values()) if (b.live.length) this.rebuild(scene, b);
  }

  /** Пересобрать одну пачку после разрушения предмета. */
  private rebuild(scene: THREE.Scene, b: Bucket) {
    if (b.mesh) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh = null; }
    if (b.bodyId >= 0) { this.phys.removeBody(b.bodyId); this.propBodies.delete(b.bodyId); b.bodyId = -1; }
    if (!b.live.length) return;
    const geos = b.live.map(v => v.geo);
    const merged = geos.length === 1 ? geos[0].clone() : mergeGeometries(geos, false);
    if (!merged) return;
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.name = 'prop';
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    b.mesh = mesh;
    // физика: те же вершины (мировые координаты, тело в начале координат)
    const pos = merged.getAttribute('position').array as ArrayLike<number>;
    const verts = new Float32Array(pos);
    const idxAttr = merged.getIndex();
    const idx = idxAttr ? new Uint32Array(idxAttr.array as ArrayLike<number>)
      : new Uint32Array(verts.length / 3).map((_, i) => i);
    if (idx.length < 3) return;
    b.bodyId = this.phys.add({
      kind: 'static', shapes: [{ t: 'trimesh', verts, idx }],
      pos: [0, 0, 0], quat: [0, 0, 0, 1], surface: b.surface,
    } as never);
    this.propBodies.add(b.bodyId);
  }

  /**
   * Урон по предмету. Возвращает число сломанных (0 или 1).
   * Куски не ломаются по отдельности — предмет ломается целиком: стол не должен
   * остаться стоять на одной ножке, а ступень — висеть в воздухе.
   */
  damage(item: PropItem, amount: number, scene: THREE.Scene): number {
    if (item.dead) return 0;
    item.hp -= amount / RESIST[item.kindMat];
    if (item.hp > 0) return 0;
    item.dead = true;
    const b = item.bucket;
    const i = b.live.findIndex(v => v.item === item);
    if (i >= 0) { const g = b.live[i].geo; b.live.splice(i, 1); g.dispose(); }
    // Мебель собрана из нескольких материалов (дерево + металл): ломаем всю вещь,
    // иначе от стола остаются торчать одни ножки.
    if (item.family) {
      for (const other of this.items) {
        if (other !== item && !other.dead && other.family === item.family) this.damage(other, 1e6, scene);
      }
    }
    this.rebuild(scene, b);
    const at: [number, number, number] = [
      (item.box.x0 + item.box.x1) / 2, (item.box.y0 + item.box.y1) / 2, (item.box.z0 + item.box.z1) / 2,
    ];
    this.onBreak?.(item, at);
    return 1;
  }

  /**
   * Предмет сломан: наружу отдаём точку и материал, чтобы main.ts выбросил обломки
   * (механика обломков — в voxelhouse.ts, она уже есть для стен).
   */
  onBreak?: (item: PropItem, at: [number, number, number]) => void;

  /** Это тело физики принадлежит мебели/лестнице? Нужно, чтобы урон по стене рядом
   *  с предметом не «разбивал» предмет. */
  ownsBody(bodyId: number): boolean { return bodyId >= 0 && this.propBodies.has(bodyId); }

  /** Ближайший живой предмет к точке (радиус в метрах) — по нему и бьём. */
  nearest(pos: readonly number[], radius = 0.9, type?: PropItem['type']): PropItem | null {
    let best: PropItem | null = null, bd = radius * radius;
    for (const it of this.items) {
      if (it.dead || (type && it.type !== type)) continue;
      const d = boxDist2(it.box, pos);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  /** Взрыв: задевает все предметы в радиусе (с затуханием к краю). */
  blast(pos: readonly number[], radius: number, strength: number, scene: THREE.Scene): number {
    let broken = 0;
    const r2 = radius * radius;
    for (const it of this.items) {
      if (it.dead) continue;
      const d = Math.sqrt(boxDist2(it.box, pos));
      if (d > radius) continue;
      const falloff = 1 - 0.6 * (d / Math.max(0.001, radius));
      broken += this.damage(it, strength * 2.4 * falloff, scene);
    }
    void r2;
    return broken;
  }

  /** Сколько предметов рядом (для подсказки/теста). */
  nearCount(pos: readonly number[], radius: number): number {
    return this.items.filter(it => !it.dead && boxDist2(it.box, pos) < radius * radius).length;
  }

  stats() {
    const all = this.items.length;
    const dead = this.items.filter(i => i.dead).length;
    const bodies = [...this.buckets.values()].filter(b => b.bodyId >= 0).length;
    return { all, dead, bodies };
  }
}

/**
 * Какие этажи ещё достижимы по лестнице.
 * Массив длины floors: элемент i — можно ли подняться с 1-го этажа на этаж i.
 * Марш этажа f считается целым, если жива почти вся его ступенчатая часть и хотя бы
 * одна площадка. Сносишь марш первого этажа — выше не попадёшь, и навигация должна
 * это знать: иначе бот ищет путь по несуществующим ступеням и «застревает» в воздухе.
 */
export function climbableFloors(stairs: PropItem[], floors: number, floorH = 3): boolean[] {
  const out: boolean[] = [];
  let alive = true;
  for (let f = 0; f < floors; f++) {
    const lo = f * floorH - 0.05, hi = (f + 1) * floorH + 0.05;
    // по НИЗУ габарита: ступень марша этажа f начинается на высоте f·floorH
    const inBand = (p: PropItem) => p.box.y0 >= lo && p.box.y0 < hi;
    const stepsAll = stairs.filter(p => p.kind === 'step' && inBand(p));
    const stepsLive = stepsAll.filter(p => !p.dead);
    const landLive = stairs.filter(p => p.kind === 'landing' && !p.dead && inBand(p)).length;
    // допускаем потерю пары ступеней (лестница «подранена», но пройти можно)
    if (stepsLive.length < Math.max(4, stepsAll.length - 2) || landLive === 0) alive = false;
    out.push(alive);
  }
  return out;
}

function boxDist2(b: PropItem['box'], p: readonly number[]): number {
  const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1);
  const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
  const dz = Math.max(b.z0 - p[2], 0, p[2] - b.z1);
  return dx * dx + dy * dy + dz * dz;
}

/** Материал детали по цвету/металличности THREE-материала. */
export function partKindOf(mat: THREE.Material): PartKind {
  const m = mat as THREE.MeshStandardMaterial;
  if ((m.metalness ?? 0) > 0.45) return 'metal';
  const hex = m.color?.getHexString?.() ?? '888888';
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  if (r > 170 && g > 180 && b > 190 && Math.abs(r - b) < 40) return 'stone';   // белое: сантехника
  return 'wood';
}
