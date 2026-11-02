// ВОКСЕЛЬНОЕ РАЗРУШЕНИЕ ДОМА (M5, в духе Teardown).
//
// Чем отличается от старого voxel.ts: там «панель» была одной неделимой деталью —
// попадание РПГ сносило её целиком, игрок жаловался. Здесь дом — сетка вокселей 0.5 м,
// урон выгрызает произвольные куски (сфера), а всё, что потеряло опору с землёй, падает.
//
// Ключевые решения по производительности (жалоба «ФПС падает до 30»):
//   • геометрия собирается ОДИН раз на чанк 8×8×8 из наружных граней — один draw call
//     на материал внутри чанка, а не InstancedMesh на каждый кубик;
//   • выбитый воксель НЕ перестраивает чанк: его вершины просто схлопываются в ноль
//     (см. hideVoxel), обновление — O(1);
//   • физика — тоже по чанкам (тримеш), пересобирается только «грязный» чанк,
//     и не чаще раза в 250 мс (см. update). Без этого пропадала коллизия снесённой стены;
//   • обломки — один InstancedMesh с кольцевым буфером, без физического движка.
import * as THREE from 'three';
import type { PhysicsClient } from '../physics/client';
import type { Surface } from '../shared/types';
import { tex } from '../render/tex.ts';

export const PITCH = 0.5;

/**
 * Геометрия кубика: 6 граней по 4 угла. ПОРЯДОК ОБХОДА ВЫЧИСЛЯЕТСЯ, а не вписывается руками:
 * раньше таблица была перевёрнута, все треугольники смотрели внутрь, и дом снаружи выглядел
 * «вывернутым» (видно внутренние стенки, окна — сквозные дыры). Теперь для каждой грани
 * берём нормаль по обмотке и, если она смотрит против направления грани, разворачиваем.
 */
export const VOXEL_FACES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CUBE_CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
// исходные «четвёрки» граней кубика; намотку всё равно проверяем ниже, здесь важен только состав
const RAW_QUADS = [[1, 5, 6, 2], [0, 3, 7, 4], [3, 2, 6, 7], [0, 4, 5, 1], [4, 7, 6, 5], [0, 1, 2, 3]];
/** углы грани в порядке против часовой стрелки, если смотреть СНАРУЖИ */
export const VOXEL_QUADS: number[][] = VOXEL_FACES.map((f, fi) => {
  const q = RAW_QUADS[fi];
  const p = q.map(i => CUBE_CORNERS[i]);
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const dot = n[0] * f[0] + n[1] * f[1] + n[2] * f[2];
  // dot ≈ 0 — значит четверка углов не лежит в плоскости грани (ошибка состава), это
  // должно падать сразу, а не превращаться в «вывернутый дом» на экране
  if (Math.abs(dot) < 1e-6) throw new Error(`VOXEL_QUADS: грань ${fi} собрана не из тех углов`);
  return dot < 0 ? [...q].reverse() : q;
});
export const CHUNK = 8;
const CAP = 60000;
const DEBRIS_CAP = 700;

/**
 * Текстура кладки на кубик (как в референсе browser-battlefield-destruction-game).
 * Без неё «воксели» читаются как гладкие серые кирпичи и дом выглядит пластиковым.
 * Текстура генерится кодом один раз: шум + рамка блока + швы кладки.
 */
function blockTexture(): THREE.Texture | null {
  // в тестах (Node) canvas нет — тогда просто без текстуры, логика от этого не меняется
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) {
    const v = 180 + (Math.random() * 60) | 0;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  g.strokeStyle = 'rgba(60,55,50,0.45)';
  g.lineWidth = 1.5;
  g.strokeRect(0.5, 0.5, 63, 63);
  // швы: две вертикальные панели и горизонтальный стык
  g.beginPath();
  g.moveTo(0, 32); g.lineTo(64, 32);
  g.moveTo(32, 0); g.lineTo(32, 32);
  g.moveTo(16, 32); g.lineTo(16, 64);
  g.moveTo(48, 32); g.lineTo(48, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** тип вокселя: 0 бетон(несущая), 1 плита, 2 кирпич, 3 стекло, 4 дерево, 5 ступень */
export type VoxelKind = 0 | 1 | 2 | 3 | 4 | 5;

export const VOXEL_COLOR: Record<number, string> = {
  0: '#cfcabd', 1: '#b3aea2', 2: '#9c6a50', 3: '#8fb6cc', 4: '#7a4b28', 5: '#ada79b',
};
export const VOXEL_MATERIAL: Record<number, Surface> = {
  0: 'concrete', 1: 'concrete', 2: 'concrete', 3: 'glass', 4: 'wood', 5: 'concrete',
};
/** запас прочности: сколько урона держит воксель */
export const VOXEL_HP: Record<number, number> = { 0: 30, 1: 24, 2: 12, 3: 0.5, 4: 3, 5: 40 };

export interface GridSpec {
  nx: number; ny: number; nz: number;
  ox: number; oy: number; oz: number;
  /** тип вокселя или -1 (пусто); индекс = (j*nz + k)*nx + i */
  cells: Int8Array;
  sectionOf: Uint8Array;
  /** 1 — несущий, 0 — навесной (перегородка, стекло, ступени) */
  bearing: Uint8Array;
}

export interface RayHit {
  id: number;
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  kind: number;
  bearing: boolean;
}

interface ChunkRender {
  geo: THREE.BufferGeometry;
  pos: THREE.Float32BufferAttribute;
  /** слот вокселя в буфере: id → [начало вершины, кол-во вершин] */
  slot: Map<number, [number, number]>;
  mesh: THREE.Mesh;
}

interface ChunkPhys { id: number; verts: Float32Array; idx: Uint32Array }

export class VoxelHouse {
  group = new THREE.Group();
  nx = 0; ny = 0; nz = 0;
  ox = 0; oy = 0; oz = 0;

  n = 0;
  ids: number[] = [];
  kind = new Int8Array(CAP);
  alive = new Uint8Array(CAP);
  hp = new Float32Array(CAP);
  maxHp = new Float32Array(CAP);
  section = new Uint8Array(CAP);
  bearing = new Uint8Array(CAP);
  ix = new Int16Array(CAP); iy = new Int16Array(CAP); iz = new Int16Array(CAP);
  /** индекс вокселя в сетке по id (для физики/рендера) */
  grid = new Int32Array(1);

  private scene: THREE.Scene;
  private phys: PhysicsClient;
  private tint = new Float32Array(CAP * 3);
  /**
   * Множитель затемнения от повреждений (1 — целый, 0.55 — почти разрушен).
   * ВАЖНО: раньше затемнение жило только в цветах вершин чанка, а чанк после разрушения
   * пересобирается заново с белыми цветами — блок «светлел обратно» (претензия «блоки
   * темнеют, но после повторного возвращаются»). Теперь множитель хранится по id.
   */
  private dmgF = new Float32Array(CAP).fill(1);

  private chunkR = new Map<string, ChunkRender>();
  private chunkP = new Map<string, ChunkPhys>();
  private dirty = new Set<string>();
  /** чанки, которым нужно пересобрать РЕНДЕР (появились новые открытые грани у соседей) */
  private dirtyR = new Set<string>();
  private lastCollapse = 0;

  private secTotal = new Map<number, number>();
  private secLeft = new Map<number, number>();
  collapsed = new Set<number>();

  // обломки (кольцевой буфер)
  private debrisMesh!: THREE.InstancedMesh;
  private dp = new Float32Array(DEBRIS_CAP * 3);
  private dv = new Float32Array(DEBRIS_CAP * 3);
  private dr = new Float32Array(DEBRIS_CAP * 3);
  private dw = new Float32Array(DEBRIS_CAP * 3);
  private dsz = new Float32Array(DEBRIS_CAP);
  private dst = new Float32Array(DEBRIS_CAP);
  private dsleep = new Uint8Array(DEBRIS_CAP);
  private dkind = new Uint8Array(DEBRIS_CAP);
  private dnext = 0;
  private dcount = 0;

  private heightAt: (x: number, z: number) => number = () => 0;

  private M = new THREE.Matrix4();
  private P = new THREE.Vector3();
  private C = new THREE.Color();
  private boxGeo = new THREE.BoxGeometry(PITCH * 0.9, PITCH * 0.9, PITCH * 0.9);

  private mats = new Map<number, THREE.MeshStandardMaterial>();

  constructor(spec: GridSpec, scene: THREE.Scene, phys: PhysicsClient) {
    this.phys = phys; this.scene = scene;
    this.group.name = 'voxel_house';
    scene.add(this.group);
    this.nx = spec.nx; this.ny = spec.ny; this.nz = spec.nz;
    this.ox = spec.ox; this.oy = spec.oy; this.oz = spec.oz;
    this.grid = new Int32Array(spec.nx * spec.ny * spec.nz).fill(-1);

    for (let j = 0; j < spec.ny; j++) for (let k = 0; k < spec.nz; k++) for (let i = 0; i < spec.nx; i++) {
      const cell = (j * spec.nz + k) * spec.nx + i;
      const c = spec.cells[cell];
      if (c < 0 || this.n >= CAP) continue;
      const id = this.n++;
      this.kind[id] = c;
      this.alive[id] = 1;
      this.hp[id] = this.maxHp[id] = VOXEL_HP[c] ?? 20;
      this.section[id] = spec.sectionOf[cell] ?? 0;
      this.bearing[id] = spec.bearing[cell] ?? 0;
      this.ix[id] = i; this.iy[id] = j; this.iz[id] = k;
      this.grid[cell] = id;
      this.ids.push(id);
      const s = this.section[id];
      this.secTotal.set(s, (this.secTotal.get(s) ?? 0) + 1);
      this.secLeft.set(s, (this.secLeft.get(s) ?? 0) + 1);
      const v = 0.93 + Math.random() * 0.14;
      this.tint[id * 3] = v; this.tint[id * 3 + 1] = v; this.tint[id * 3 + 2] = v;
    }

    // Реальные текстуры из public/textures (см. src/render/tex.ts). Если текстура не
    // загрузилась — материал остаётся однотонным, игра не падает.
    const tBrick = tex('brick'), tStone = tex('stone'), tWood = tex('wood');
    const generated = blockTexture();      // запасная процедурная кладка
    // БАГ (виден на скриншоте игрока): на стены и плиты была навешана текстура 'ground' —
    // это фотография земли с камуфляжными пятнами. Внутри квартиры потолок и стены
    // выглядели грязно-зелёными разводами. Для бетона берём каменную кладку, а если
    // её нет — процедурную.
    // 0 бетон (несущая), 1 плита, 2 кирпич (стена между квартирами), 4 дерево, 5 ступени
    const tConcrete = tStone ?? tBrick ?? generated;
    const MAP: Record<number, THREE.Texture | null> = { 0: tConcrete, 1: tConcrete, 2: tBrick ?? tStone, 4: tWood, 5: tConcrete };
    for (const [k, color] of Object.entries(VOXEL_COLOR)) {
      const kk = +k;
      if (kk === 3) {
        this.mats.set(kk, new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.4 }));
        continue;
      }
      const map = MAP[kk] ?? generated;
      this.mats.set(kk, new THREE.MeshStandardMaterial({
        color,
        ...(map ? { map } : {}),
        roughness: kk === 4 ? 0.95 : 0.92,
        metalness: 0.02,
        vertexColors: true,
      }));
    }
    this.buildDebris();
    for (const key of this.allChunks()) this.ensureChunk(key);
    this.rebuildPhysics(true);
  }

  setHeightFn(fn: (x: number, z: number) => number) { this.heightAt = fn; }

  // ---------- координаты ----------
  private idAt(i: number, j: number, k: number): number {
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return this.grid[(j * this.nz + k) * this.nx + i];
  }
  centerOf(id: number, out = new THREE.Vector3()) {
    return out.set(
      this.ox + (this.ix[id] + 0.5) * PITCH,
      this.oy + (this.iy[id] + 0.5) * PITCH,
      this.oz + (this.iz[id] + 0.5) * PITCH,
    );
  }

  // ---------- рендер по чанкам ----------
  private chunkKey(cx: number, cy: number, cz: number) { return `${cx},${cy},${cz}`; }
  private allChunks(): string[] {
    const out: string[] = [];
    const ncx = Math.ceil(this.nx / CHUNK), ncy = Math.ceil(this.ny / CHUNK), ncz = Math.ceil(this.nz / CHUNK);
    for (let cy = 0; cy < ncy; cy++) for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) out.push(this.chunkKey(cx, cy, cz));
    return out;
  }
  private markDirty(i: number, j: number, k: number) {
    const key = this.chunkKey(Math.floor(i / CHUNK), Math.floor(j / CHUNK), Math.floor(k / CHUNK));
    this.dirty.add(key);
    this.dirtyR.add(key);
  }

  /** Пересборка видимой геометрии чанка: у соседей выбитых вокселей появляются открытые грани. */
  private rebuildChunkRender(key: string) {
    const old = this.chunkR.get(key);
    if (old) { old.mesh.removeFromParent(); old.geo.dispose(); this.chunkR.delete(key); }
    this.ensureChunk(key);
  }

  private static FACES = VOXEL_FACES;
  private static CORNERS = CUBE_CORNERS;
  private static QUAD = VOXEL_QUADS;
  /** UV-координаты углов грани: (0,0) (1,0) (1,1) (0,1) в порядке quads */
  private static QUAD_UV = [0, 0, 1, 0, 1, 1, 0, 1];
  /**
   * UV по МИРОВЫМ координатам грани (а не «полный тайл на кубик»).
   * Кубик 0.5 м: при UV 0..1 рисунок кирпича повторяется каждые полметра — на стене
   * это выглядело мелкой рябью (на скриншоте: «камуфляжные» разводы на потолке).
   * TEX_M — сколько метров стены занимает один тайл текстуры.
   */
  private static readonly TEX_M = 2.0;

  /** Собирает геометрию чанка: наружные грани живых вокселей, по группам на материал. */
  private ensureChunk(key: string) {
    const [cx, cy, cz] = key.split(',').map(Number);
    const i0 = cx * CHUNK, j0 = cy * CHUNK, k0 = cz * CHUNK;
    const h = PITCH / 2;
    const perKind = new Map<number, { verts: number[]; uvs: number[]; slot: Map<number, [number, number]> }>();
    for (let j = j0; j < Math.min(this.ny, j0 + CHUNK); j++)
      for (let k = k0; k < Math.min(this.nz, k0 + CHUNK); k++)
        for (let i = i0; i < Math.min(this.nx, i0 + CHUNK); i++) {
          const id = this.idAt(i, j, k);
          if (id < 0 || !this.alive[id]) continue;
          const kind = this.kind[id];
          const cxp = this.ox + (i + 0.5) * PITCH, cyp = this.oy + (j + 0.5) * PITCH, czp = this.oz + (k + 0.5) * PITCH;
          const a = perKind.get(kind) ?? { verts: [], uvs: [], slot: new Map<number, [number, number]>() };
          const start = a.verts.length / 3;
          let quads = 0;
          for (let f = 0; f < 6; f++) {
            const [di, dj, dk] = VoxelHouse.FACES[f];
            const nid = this.idAt(i + di, j + dj, k + dk);
            if (nid >= 0 && this.alive[nid]) continue;          // грань внутри — не нужна
            // UV считаем ПО МИРОВЫМ КООРДИНАТАМ ВЕРШИН в плоскости грани: рисунок
            // кладки непрерывен через соседние кубики (нет «плитки» каждые 0.5 м).
            // КРИТИЧЕСКАЯ ОШИБКА, из-за которой на стенах были «обрывки» и полосы:
            // раньше UV брались от ЦЕНТРА кубика, поэтому все 4 вершины грани получали
            // одну и ту же точку текстуры (нулевая площадь) — грань вырождалась в
            // единственный тексель, и на стене вспыхивали случайные полоски.
            // Ось грани выбираем ПО НОМЕРУ ГРАНИ (f), а не по компоненте смещения:
            // у граней ±Y (2/3) смещение по X равно нулю, и проверка `di !== 0` не работала.
            const axis = f < 2 ? 0 : f < 4 ? 1 : 2;
            for (let qi = 0; qi < 4; qi++) {
              const c = VoxelHouse.CORNERS[VoxelHouse.QUAD[f][qi]];
              const px = cxp + c[0] * h, py = cyp + c[1] * h, pz = czp + c[2] * h;
              a.verts.push(px, py, pz);
              // ±X → плоскость (Z, Y); ±Y (пол/потолок) → (X, Z); ±Z → (X, Y)
              const u = axis === 0 ? pz : px, v = axis === 1 ? pz : py;
              a.uvs.push(u / VoxelHouse.TEX_M, v / VoxelHouse.TEX_M);
            }
            quads++;
          }
          if (quads) a.slot.set(id, [start, quads * 4]);
          perKind.set(kind, a);
        }

    // один BufferGeometry на чанк, материалы — группами
    const pos: number[] = [];
    const uvArr: number[] = [];
    const kinds: number[] = [];
    const ranges: { start: number; count: number; kind: number }[] = [];
    const slot = new Map<number, [number, number]>();
    for (const [kind, a] of perKind) {
      if (!a.verts.length) continue;
      const base = pos.length / 3;
      for (const v of a.verts) pos.push(v);
      for (const u of a.uvs) uvArr.push(u);
      for (const [id, [st, cnt]] of a.slot) slot.set(id, [st + base, cnt]);
      ranges.push({ start: base, count: a.verts.length / 3, kind });
      kinds.push(kind);
    }
    if (!pos.length) return;

    const geo = new THREE.BufferGeometry();
    const attr = new THREE.Float32BufferAttribute(new Float32Array(pos), 3);
    geo.setAttribute('position', attr);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvArr), 2));
    // цвет вершин: затемнение повреждённых блоков (см. damageMark). Пишем СРАЗУ из dmgF,
    // иначе после пересборки чанка повреждения «заживали».
    const colors = new Float32Array(pos.length).fill(1);
    for (const [id, [start, count]] of slot) {
      const f = this.dmgF[id];
      if (f >= 0.999) continue;
      for (let v = start; v < start + count; v++) {
        colors[v * 3] = f; colors[v * 3 + 1] = f; colors[v * 3 + 2] = f;
      }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const index: number[] = [];
    for (const r of ranges) {
      const quads = r.count / 4;
      for (let q = 0; q < quads; q++) {
        const b = r.start + q * 4;
        index.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.clearGroups();
    let gStart = 0;
    for (const r of ranges) {
      const gi = kinds.indexOf(r.kind);
      geo.addGroup(gStart, (r.count / 4) * 6, gi);
      gStart += (r.count / 4) * 6;
    }
    // материалы в порядке first-appearance
    for (const m of this.mats.values()) if (!m.vertexColors) { m.vertexColors = true; m.needsUpdate = true; }
    const matArr = kinds.map(k => this.mats.get(k) ?? this.mats.get(0)!);
    geo.setDrawRange(0, index.length);
    const mesh = new THREE.Mesh(geo, matArr as unknown as THREE.Material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.chunkR.set(key, { geo, pos: attr, slot, mesh });
  }

  /** Гасит воксель в рендере без пересборки чанка: вершины уезжают в центр (нулевая площадь). */
  private hideVoxel(id: number) {
    const key = this.chunkKey(Math.floor(this.ix[id] / CHUNK), Math.floor(this.iy[id] / CHUNK), Math.floor(this.iz[id] / CHUNK));
    const ch = this.chunkR.get(key);
    if (!ch) return false;
    const s = ch.slot.get(id);
    if (!s) return true;                                  // воксель не имел наружных граней (внутри массива)
    this.centerOf(id, this.P);
    const arr = ch.pos.array as Float32Array;
    for (let v = s[0]; v < s[0] + s[1]; v++) {
      arr[v * 3] = this.P.x; arr[v * 3 + 1] = this.P.y; arr[v * 3 + 2] = this.P.z;
    }
    ch.pos.needsUpdate = true;
    ch.slot.delete(id);
    return true;
  }

  // ---------- луч (DDA по сетке) ----------
  raycast(origin: readonly number[], dir: readonly number[], maxT = 300): RayHit | null {
    // AABB-отсечение
    const inv = [1 / (dir[0] || 1e-9), 1 / (dir[1] || 1e-9), 1 / (dir[2] || 1e-9)];
    const lo = [this.ox, this.oy, this.oz];
    const hi = [this.ox + this.nx * PITCH, this.oy + this.ny * PITCH, this.oz + this.nz * PITCH];
    let t0 = 0, t1 = maxT;
    for (let a = 0; a < 3; a++) {
      let ta = (lo[a] - origin[a]) * inv[a], tb = (hi[a] - origin[a]) * inv[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    let t = t0 + 1e-4;
    const p = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    let i = Math.floor((p[0] - this.ox) / PITCH), j = Math.floor((p[1] - this.oy) / PITCH), k = Math.floor((p[2] - this.oz) / PITCH);
    const step = [dir[0] > 0 ? 1 : -1, dir[1] > 0 ? 1 : -1, dir[2] > 0 ? 1 : -1];
    const tDelta = [Math.abs(PITCH * inv[0]), Math.abs(PITCH * inv[1]), Math.abs(PITCH * inv[2])];
    const boundary = [
      this.ox + (i + (step[0] > 0 ? 1 : 0)) * PITCH,
      this.oy + (j + (step[1] > 0 ? 1 : 0)) * PITCH,
      this.oz + (k + (step[2] > 0 ? 1 : 0)) * PITCH,
    ];
    const tMax = [
      (boundary[0] - origin[0]) * inv[0],
      (boundary[1] - origin[1]) * inv[1],
      (boundary[2] - origin[2]) * inv[2],
    ];
    let nx2 = 0, ny2 = 0, nz2 = 0;
    for (let guard = 0; guard < 4096 && t <= t1; guard++) {
      const id = this.idAt(i, j, k);
      if (id >= 0 && this.alive[id]) {
        const c = this.centerOf(id);
        return {
          id, dist: t, point: new THREE.Vector3(origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t),
          normal: new THREE.Vector3(nx2, ny2, nz2), kind: this.kind[id], bearing: this.bearing[id] === 1,
        };
      }
      const axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      t = tMax[axis];
      tMax[axis] += tDelta[axis];
      if (axis === 0) { i += step[0]; nx2 = -step[0]; ny2 = 0; nz2 = 0; }
      else if (axis === 1) { j += step[1]; ny2 = -step[1]; nx2 = 0; nz2 = 0; }
      else { k += step[2]; nz2 = -step[2]; nx2 = 0; ny2 = 0; }
    }
    return null;
  }

  // ---------- урон ----------
  /** Сферический урон: выгрызает кусок вокруг точки. Возвращает число выбитых вокселей. */
  damageAt(point: readonly number[] | THREE.Vector3, radius: number, strength: number, opts: { max?: number } = {}): number {
    const [px, py, pz] = VoxelHouse.xyz(point);
    const max = opts.max ?? 64;
    const r2 = radius * radius;
    const i0 = Math.max(0, Math.floor((px - radius - this.ox) / PITCH)), i1 = Math.min(this.nx - 1, Math.floor((px + radius - this.ox) / PITCH));
    const j0 = Math.max(0, Math.floor((py - radius - this.oy) / PITCH)), j1 = Math.min(this.ny - 1, Math.floor((py + radius - this.oy) / PITCH));
    const k0 = Math.max(0, Math.floor((pz - radius - this.oz) / PITCH)), k1 = Math.min(this.nz - 1, Math.floor((pz + radius - this.oz) / PITCH));
    const hits: { id: number; d: number }[] = [];
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const id = this.idAt(i, j, k);
      if (id < 0 || !this.alive[id]) continue;
      const dx = this.ox + (i + 0.5) * PITCH - px, dy = this.oy + (j + 0.5) * PITCH - py, dz = this.oz + (k + 0.5) * PITCH - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      hits.push({ id, d: Math.sqrt(d2) });
    }
    hits.sort((a, b) => a.d - b.d);
    const dir = new THREE.Vector3(0, 0, 0);
    let killed = 0;
    for (const h of hits) {
      if (killed >= max) break;
      // линейное затухание: в центре полный урон, на краю — 35 %
      const f = 1 - 0.65 * (h.d / Math.max(0.001, radius));
      dir.set(this.ix[h.id], this.iy[h.id], this.iz[h.id]).sub(new THREE.Vector3(px, py, pz));
      if (this.hitVoxel(h.id, strength * f, [dir.x, dir.y + 0.4, dir.z])) killed++;
    }
    return killed;
  }

  /** Урон одному вокселю. Возвращает true, если он разбит. */
  hitVoxel(id: number, dmg: number, dir: [number, number, number]): boolean {
    if (id < 0 || !this.alive[id]) return false;
    // несущие держат удар крепче: дом не разваливается от одной пули в стену
    this.hp[id] -= dmg;
    if (this.hp[id] > 0) {
      this.damageMark(id);       // воксель темнеет — видно, куда уже попадали
      return false;
    }
    this.destroyVoxel(id, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
    return true;
  }

  /**
   * Затемнение повреждённого вокселя. В референсе это сделано цветом инстанса; у нас
   * геометрия сшита в чанк, поэтому перекрашиваем вершины (attribute 'color').
   * Без этого игрок не понимает, что стена «уже на грани» — она ломается внезапно.
   */
  private damageMark(id: number) {
    const key = this.chunkKey(Math.floor(this.ix[id] / CHUNK), Math.floor(this.iy[id] / CHUNK), Math.floor(this.iz[id] / CHUNK));
    const ch = this.chunkR.get(key);
    if (!ch) return;
    const s = ch.slot.get(id);
    if (!s) return;
    const f = 0.55 + 0.45 * Math.max(0, this.hp[id] / Math.max(0.001, this.maxHp[id]));
    this.dmgF[id] = f;                       // запоминаем: переживёт пересборку чанка
    const col = ch.geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!col) return;
    const arr = col.array as Float32Array;
    for (let v = s[0]; v < s[0] + s[1]; v++) {
      arr[v * 3] = f; arr[v * 3 + 1] = f; arr[v * 3 + 2] = f;
    }
    col.needsUpdate = true;
  }

  private destroyVoxel(id: number, push: THREE.Vector3) {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.grid[(this.iy[id] * this.nz + this.iz[id]) * this.nx + this.ix[id]] = -1;
    const s = this.section[id];
    this.secLeft.set(s, (this.secLeft.get(s) ?? 1) - 1);
    this.centerOf(id, this.P);
    this.hideVoxel(id);
    // пыль: каждый 4-й выбитый блок даёт облачко (как в референсе)
    if (++this.dustCounter % 4 === 0) this.onDust?.(this.P.x, this.P.y, this.P.z, 1, false);
    // осколки: 1–3 кубика на выбитый воксель
    const n = 1 + (Math.random() * 2.4 | 0);
    const v = new THREE.Vector3();
    for (let i2 = 0; i2 < n; i2++) {
      v.copy(push).multiplyScalar(2.2 + Math.random() * 3.2);
      v.x += (Math.random() - 0.5) * 3; v.y += Math.random() * 3.5; v.z += (Math.random() - 0.5) * 3;
      this.spawnDebris(this.P, v, this.kind[id]);
    }
    this.markDirty(this.ix[id], this.iy[id], this.iz[id]);
    // соседи по граням — у них появились открытые грани и дыры в физике
    for (const [di, dj, dk] of VoxelHouse.FACES) {
      const nid = this.idAt(this.ix[id] + di, this.iy[id] + dj, this.iz[id] + dk);
      if (nid >= 0) this.markDirty(this.ix[nid], this.iy[nid], this.iz[nid]);
    }
  }

  // ---------- физика ----------
  private chunkGeom(cx: number, cy: number, cz: number): ChunkPhys | null {
    const i0 = cx * CHUNK, j0 = cy * CHUNK, k0 = cz * CHUNK;
    const h = PITCH / 2;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let j = j0; j < Math.min(this.ny, j0 + CHUNK); j++)
      for (let k = k0; k < Math.min(this.nz, k0 + CHUNK); k++)
        for (let i = i0; i < Math.min(this.nx, i0 + CHUNK); i++) {
          const id = this.idAt(i, j, k);
          if (id < 0 || !this.alive[id]) continue;
          const cxp = this.ox + (i + 0.5) * PITCH, cyp = this.oy + (j + 0.5) * PITCH, czp = this.oz + (k + 0.5) * PITCH;
          for (let f = 0; f < 6; f++) {
            const [di, dj, dk] = VoxelHouse.FACES[f];
            const nid = this.idAt(i + di, j + dj, k + dk);
            if (nid >= 0 && this.alive[nid]) continue;
            const start = verts.length / 3;
            for (const ci of VoxelHouse.QUAD[f]) {
              const c = VoxelHouse.CORNERS[ci];
              verts.push(cxp + c[0] * h, cyp + c[1] * h, czp + c[2] * h);
            }
            idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          }
        }
    if (!idx.length) return null;
    return { id: -1, verts: new Float32Array(verts), idx: new Uint32Array(idx) };
  }

  /** Пересобирает физику изменённых чанков (или всех). */
  rebuildPhysics(full = false) {
    const list = full ? this.allChunks() : [...this.dirty];
    this.dirty.clear();
    for (const key of list) {
      const old = this.chunkP.get(key);
      if (old) { this.phys.removeBody(old.id); this.chunkP.delete(key); }
      const [cx, cy, cz] = key.split(',').map(Number);
      const g = this.chunkGeom(cx, cy, cz);
      if (!g) continue;
      const id = this.phys.add({
        kind: 'static',
        shapes: [{ t: 'trimesh', verts: g.verts, idx: g.idx }],
        pos: [0, 0, 0], quat: [0, 0, 0, 1],
        surface: 'concrete',
      } as never);
      this.chunkP.set(key, { id, verts: g.verts, idx: g.idx });
    }
  }

  /** id тела любого живого чанка (дом как физический объект). */
  get bodyId() { for (const c of this.chunkP.values()) return c.id; return -1; }
  /** id тела чанка, в котором лежит точка (или -1). Принимает и массив, и Vector3. */
  bodyAt(point: readonly number[] | THREE.Vector3) {
    const [px, py, pz] = VoxelHouse.xyz(point);
    const i = Math.floor((px - this.ox) / PITCH), j = Math.floor((py - this.oy) / PITCH), k = Math.floor((pz - this.oz) / PITCH);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return this.chunkP.get(this.chunkKey(Math.floor(i / CHUNK), Math.floor(j / CHUNK), Math.floor(k / CHUNK)))?.id ?? -1;
  }
  contains(p: readonly number[] | THREE.Vector3) {
    const [x, y, z] = VoxelHouse.xyz(p);
    return x >= this.ox && x <= this.ox + this.nx * PITCH && z >= this.oz && z <= this.oz + this.nz * PITCH
      && y >= this.oy - 1 && y <= this.oy + this.ny * PITCH + 1;
  }

  /** Точка → [x, y, z]. Умеет и массив, и Vector3 (на этом уже ловили NaN). */
  static xyz(p: readonly number[] | THREE.Vector3): [number, number, number] {
    if (Array.isArray(p)) return [p[0], p[1], p[2]];
    const v = p as THREE.Vector3;
    return [v.x, v.y, v.z];
  }

  // ---------- опора / обрушение ----------
  private bfsV = new Uint8Array(1);
  private bfsQ = new Int32Array(1);

  /** Всё, что не связано с землёй — отваливается обломками. Возвращает число упавших вокселей. */
  checkSupport(): number {
    const total = this.nx * this.ny * this.nz;
    if (total > this.bfsV.length) { this.bfsV = new Uint8Array(total); this.bfsQ = new Int32Array(total); }
    const vis = this.bfsV, q = this.bfsQ;
    vis.fill(0, 0, total);
    let h = 0, t = 0;
    const layer = this.nx * this.nz;
    for (let c = 0; c < layer; c++) {
      const id = this.grid[c];
      if (id >= 0 && this.alive[id]) { vis[c] = 1; q[t++] = c; }
    }
    const nx = this.nx, nz = this.nz;
    while (h < t) {
      const c = q[h++];
      const i = c % nx, k = Math.floor(c / nx) % nz, j = Math.floor(c / (nx * nz));
      const nb = [
        j + 1 < this.ny ? c + layer : -1, j > 0 ? c - layer : -1,
        i + 1 < nx ? c + 1 : -1, i > 0 ? c - 1 : -1,
        k + 1 < nz ? c + nx : -1, k > 0 ? c - nx : -1,
      ];
      for (const n of nb) {
        if (n < 0 || vis[n]) continue;
        const id = this.grid[n];
        if (id < 0 || !this.alive[id]) continue;
        vis[n] = 1; q[t++] = n;
      }
    }
    let fallen = 0;
    const v = new THREE.Vector3();
    for (let c = 0; c < total; c++) {
      const id = this.grid[c];
      if (id < 0 || !this.alive[id] || vis[c]) continue;
      // оторвано от земли → обломки
      this.alive[id] = 0;
      this.grid[c] = -1;
      this.hideVoxel(id);
      this.centerOf(id, this.P);
      v.set((Math.random() - 0.5) * 1.2, -0.5, (Math.random() - 0.5) * 1.2);
      this.spawnDebris(this.P, v, this.kind[id]);
      fallen++;
      const s = this.section[id];
      this.secLeft.set(s, (this.secLeft.get(s) ?? 1) - 1);
    }
    if (fallen) {
      const c = this.centerOf(this.ids[0] ?? 0, new THREE.Vector3());
      this.onDust?.(c.x, this.oy + this.ny * PITCH * 0.5, c.z, Math.min(30, fallen), true);
      for (const key of this.allChunks()) this.dirtyR.add(key);   // дёшево: пересборка идёт по бюджету
      this.rebuildPhysics(true);
    }
    return fallen;
  }

  /** Обрушение секции целиком, если потеряно больше 66 % вокселей. */
  checkCollapse(): number[] {
    const out: number[] = [];
    for (const [s, total] of this.secTotal) {
      if (this.collapsed.has(s)) continue;
      const left = this.secLeft.get(s) ?? 0;
      if (left / Math.max(1, total) > 0.34) continue;
      this.collapsed.add(s);
      out.push(s);
    }
    return out;
  }

  /** целостность секции: сколько вокселей осталось */
  columns(section: number) { return { left: this.secLeft.get(section) ?? 0, total: this.secTotal.get(section) ?? 0 }; }
  structure(section: number) {
    const c = this.columns(section);
    return { left: c.left, total: c.total, pct: Math.round((c.left / Math.max(1, c.total)) * 100), collapsed: this.collapsed.has(section) };
  }

  /** Есть ли живой воксель в точке (мировые координаты). */
  solidAt(x: number, y: number, z: number): boolean {
    const i = Math.floor((x - this.ox) / PITCH), j = Math.floor((y - this.oy) / PITCH), k = Math.floor((z - this.oz) / PITCH);
    const id = this.idAt(i, j, k);
    return id >= 0 && this.alive[id] === 1;
  }

  // ---------- обломки ----------
  private buildDebris() {
    const geo = this.boxGeo;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.02, vertexColors: false });
    this.debrisMesh = new THREE.InstancedMesh(geo, mat, DEBRIS_CAP);
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = false;
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = new Float32Array(DEBRIS_CAP * 3);
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.scene.add(this.debrisMesh);
  }

  /** Разбудить спящие обломки в радиусе (взрыв снова подбрасывает мусор). */
  wakeDebris(x: number, y: number, z: number, r: number) {
    const r2 = r * r;
    for (let i = 0; i < this.dcount; i++) {
      if (!this.dsleep[i]) continue;
      const o = i * 3;
      const dx = this.dp[o] - x, dy = this.dp[o + 1] - y, dz = this.dp[o + 2] - z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      this.dsleep[i] = 0;
      this.dst[i] = 0;
      this.dv[o] += dx * 0.6; this.dv[o + 1] += 2.5; this.dv[o + 2] += dz * 0.6;
    }
  }

  /**
   * Выбросить обломок в произвольной точке — для разрушаемой мебели и лестницы
   * (props.ts). Механика та же, что у кусков стен: обломок летит, падает, засыпает.
   */
  debrisAt(p: readonly number[], count = 5, kind = 4) {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set((Math.random() - 0.5) * 2.2, 0.8 + Math.random() * 2.0, (Math.random() - 0.5) * 2.2);
      this.spawnDebris(
        new THREE.Vector3(p[0] + (Math.random() - 0.5) * 0.5, p[1] + Math.random() * 0.5, p[2] + (Math.random() - 0.5) * 0.5),
        v, kind,
      );
    }
  }

  /** Пыль взрыва: вызывается из main.ts, рисуется системой эффектов. */
  onDust?: (x: number, y: number, z: number, count: number, big: boolean) => void;
  private dustCounter = 0;

  private spawnDebris(p: THREE.Vector3, v: THREE.Vector3, kind: number) {
    const i = this.dnext;
    this.dnext = (this.dnext + 1) % DEBRIS_CAP;
    this.dcount = Math.min(DEBRIS_CAP, this.dcount + 1);
    this.dp[i * 3] = p.x; this.dp[i * 3 + 1] = p.y; this.dp[i * 3 + 2] = p.z;
    this.dv[i * 3] = v.x; this.dv[i * 3 + 1] = v.y; this.dv[i * 3 + 2] = v.z;
    this.dr[i * 3] = Math.random() * 6.28; this.dr[i * 3 + 1] = Math.random() * 6.28; this.dr[i * 3 + 2] = Math.random() * 6.28;
    this.dw[i * 3] = (Math.random() - 0.5) * 9; this.dw[i * 3 + 1] = (Math.random() - 0.5) * 9; this.dw[i * 3 + 2] = (Math.random() - 0.5) * 9;
    this.dsz[i] = PITCH * (0.35 + Math.random() * 0.5);
    this.dst[i] = 0;
    this.dsleep[i] = 0;
    this.dkind[i] = kind;
  }

  private updateDebris(dt: number) {
    if (!this.dcount) return;
    const col = this.debrisMesh.instanceColor!;
    const arr = col.array as Float32Array;
    let live = 0;
    for (let i = 0; i < this.dcount; i++) {
      if (this.dsleep[i]) { continue; }
      live++;
      const o = i * 3;
      this.dv[o + 1] -= 22 * dt;
      this.dp[o] += this.dv[o] * dt; this.dp[o + 1] += this.dv[o + 1] * dt; this.dp[o + 2] += this.dv[o + 2] * dt;
      this.dr[o] += this.dw[o] * dt; this.dr[o + 1] += this.dw[o + 1] * dt; this.dr[o + 2] += this.dw[o + 2] * dt;
      // столкновение с ещё стоящими вокселями: обломки не проваливаются сквозь стены
      // (в референсе solid(); без этого куски «исчезают» внутри дома)
      if (this.solidAt(this.dp[o], this.dp[o + 1], this.dp[o + 2])) {
        this.dp[o] -= this.dv[o] * dt; this.dp[o + 1] -= this.dv[o + 1] * dt; this.dp[o + 2] -= this.dv[o + 2] * dt;
        this.dv[o] *= -0.3; this.dv[o + 1] *= -0.2; this.dv[o + 2] *= -0.3;
        this.dw[o] *= 0.6; this.dw[o + 1] *= 0.6; this.dw[o + 2] *= 0.6;
      }
      const gy = this.heightAt(this.dp[o], this.dp[o + 2]) + this.dsz[i] * 0.5;
      if (this.dp[o + 1] <= gy) {
        this.dp[o + 1] = gy;
        if (Math.abs(this.dv[o + 1]) < 2.5) { this.dv[o] *= 0.5; this.dv[o + 2] *= 0.5; this.dv[o + 1] = 0; }
        else { this.dv[o + 1] *= -0.28; this.dv[o] *= 0.7; this.dv[o + 2] *= 0.7; }
        this.dst[i] += dt;
        if (this.dst[i] > 0.8 && Math.abs(this.dv[o]) + Math.abs(this.dv[o + 2]) < 0.4) this.dsleep[i] = 1;
      }
      this.dst[i] = Math.max(0, this.dst[i] - dt * 0.2);
      this.M.makeRotationFromEuler(new THREE.Euler(this.dr[o], this.dr[o + 1], this.dr[o + 2]));
      this.M.scale(new THREE.Vector3(this.dsz[i], this.dsz[i] * 0.7, this.dsz[i]));
      this.M.setPosition(this.dp[o], this.dp[o + 1], this.dp[o + 2]);
      this.debrisMesh.setMatrixAt(i, this.M);
      this.C.set(VOXEL_COLOR[this.dkind[i]] ?? '#cfcabd').multiplyScalar(0.85);
      arr[o] = this.C.r; arr[o + 1] = this.C.g; arr[o + 2] = this.C.b;
    }
    this.debrisMesh.count = this.dcount;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    col.needsUpdate = true;
    this.debrisLive = live;
  }
  debrisLive = 0;

  // ---------- кадр ----------
  update(dt: number, now = performance.now()) {
    this.updateDebris(dt);

    // РЕНДЕР: чанк, где выбили воксель, пересобираем целиком — иначе у соседей
    // отсутствуют грани в сторону дыры и стена «просвечивает». Бюджет 3 чанка за кадр.
    if (this.dirtyR.size) {
      let budget = 3;
      for (const key of [...this.dirtyR]) {
        if (budget-- <= 0) break;
        this.dirtyR.delete(key);
        this.rebuildChunkRender(key);
      }
    }

    // ФИЗИКА: держим бюджет 6 чанков за кадр — дыра получает коллизию через 1–2 кадра,
    // а не через полсекунды (на это была отдельная претензия: «коллизия остаётся»).
    if (this.dirty.size) {
      let budget = 6;
      for (const key of [...this.dirty]) {
        if (budget-- <= 0) break;
        this.dirty.delete(key);
        const old = this.chunkP.get(key);
        if (old) { this.phys.removeBody(old.id); this.chunkP.delete(key); }
        const [cx, cy, cz] = key.split(',').map(Number);
        const g = this.chunkGeom(cx, cy, cz);
        if (!g) continue;
        const id = this.phys.add({ kind: 'static', shapes: [{ t: 'trimesh', verts: g.verts, idx: g.idx }], pos: [0, 0, 0], quat: [0, 0, 0, 1], surface: 'concrete' } as never);
        this.chunkP.set(key, { id, verts: g.verts, idx: g.idx });
      }
    }
    // проверка опоры — раз в 0.5 с (BFS по 30k ячеек не бесплатен)
    if (now - this.lastCollapse > 500) {
      this.lastCollapse = now;
      if (this.checkSupport()) this.lastCollapse = now;
      this.checkCollapse();
    }
  }

  dispose() {
    for (const c of this.chunkR.values()) { c.mesh.removeFromParent(); c.geo.dispose(); }
    for (const c of this.chunkP.values()) this.phys.removeBody(c.id);
    this.chunkR.clear(); this.chunkP.clear();
    this.debrisMesh.removeFromParent();
    this.scene.remove(this.group);
  }
}
