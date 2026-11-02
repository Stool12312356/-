// ВОКСЕЛЬНЫЕ РАЗРУШЕНИЯ (M3).
//
// Почему так: «панели с HP» давали решето — каждая выбитая панель оставляла прямоугольную дыру,
// сквозь которую видно интерьер, полки висели в воздухе, а стены просвечивали.
// Воксельный подход решает это по-другому:
//
//  1. Стена = сетка вокселей (кирпичей) ~0.45 м. Пока все воксели целы — это МОНОЛИТ
//     с одним коллайдером: никаких щелей, никакого просвечивания, чистый фасад.
//  2. Когда воксель разбит (пуля/осколок/взрыв) — он выпадает физическим обломком, а его
//     соседи помечаются «краевыми».
//  3. Раз в несколько кадров пересобирается коллайдер: из оставшихся вокселей строятся
//     крупные блоки (жадное слияние по объёму), поэтому с одной дырой дом — это 2-4 коробки,
//     а не 400 мелких. Физика и рендер совпадают: где нет вокселя — есть проход.
//  4. Опора: воксель держится, если под ним (или над ним) есть цепочка до земли.
//     Отрезали нижние — верхние осыпаются сами (обвал как в BC2).
//
// Рендер: один InstancedMesh на материал (кирпичи разного цвета), обновляется только при
// изменениях. Никаких отдельных мешей на воксель.
import * as THREE from 'three';
import type { PhysicsClient } from '../physics/client';
import type { Shape, Surface } from '../shared/types';

export interface VoxelWall {
  /** мировая позиция центра блока */
  pos: [number, number, number];
  /** размеры блока (обычно 0.45 × 0.45 × толщина) */
  size: [number, number, number];
  /** поворот вокруг Y */
  rotY: number;
  material: Surface;
  /** 0 — обычная стена, 1 — несущая (обрушение по ней) */
  bearing: boolean;
  section: number;
  floor: number;
  /** несущая КОЛОННА: обрушение секции считается по ним (как в ТЗ) */
  column?: boolean;
}

export interface VoxelCell {
  wall: number;
  /** локальные координаты в сетке стены */
  i: number; j: number;
  /** мировая позиция центра */
  p: [number, number, number];
  size: [number, number, number];
  alive: boolean;
  /** коллайдер принадлежит этой ячейке (для точечного удаления) */
  colKey: number;
}

export interface WallGrid {
  /** ось «вдоль стены» в мире */
  axis: 'x' | 'z';
  /** координата плоскости стены (Y — высота берётся из pos.y) */
  fixed: number;
  /** количество по горизонтали и вертикали */
  nx: number;
  ny: number;
  /** размер одной ячейки */
  cw: number;
  ch: number;
  thickness: number;
  /** точка «от» по оси X/Z */
  start: number;
  /** базовая высота низа стены */
  baseY: number;
  material: Surface;
  bearing: boolean;
  section: number;
  floor: number;
  column?: boolean;
}

/**
 * Воксельное здание. Содержит список стен-сеток, состояние вокселей, физику и рендер.
 * Публичный API: damageAt(точка, радиус, сила) — и всё остальное делает сам.
 */
export class VoxelBuilding {
  walls: VoxelWall[] = [];
  /** все ячейки в одном массиве, индекс = ячейка */
  cells: VoxelCell[] = [];
  grids: WallGrid[] = [];

  group = new THREE.Group();

  private phys: PhysicsClient;
  private scene: THREE.Scene;
  private bodyId = -1;
  /** какой коллайдер (ключ) относится к какой ячейке */
  private colOwner = new Map<number, number[]>();
  private colKey = 0;
  private dirtyRender = true;
  private dirtyPhysics = true;
  private instPerColor = new Map<string, THREE.InstancedMesh>();
  private raf = (fn: FrameRequestCallback) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0);

  /** несущие секции: сколько осталось / сколько было */
  private bearingLeft = new Map<number, number>();
  private bearingTotal = new Map<number, number>();
  private columnLeft = new Map<number, number>();
  private columnTotal = new Map<number, number>();
  collapsed = new Set<number>();

  constructor(walls: VoxelWall[], scene: THREE.Scene, phys: PhysicsClient, origin: THREE.Vector3) {
    this.phys = phys; this.scene = scene;
    this.group.name = 'voxel_building';
    this.group.position.copy(origin);
    scene.add(this.group);
    // группируем стены в сетки: стены с одинаковой плоскостью и шагом сливаются
    const byGrid = new Map<string, { grid: WallGrid; cells: VoxelCell[] }>();
    for (const w of walls) {
      const horizontal = Math.abs(w.rotY % Math.PI) < 0.01; // 0 → вдоль X, PI/2 → вдоль Z
      const axis: 'x' | 'z' = horizontal ? 'x' : 'z';
      const [sx, sy, sz] = w.size;
      const cw = horizontal ? sx : sz;
      const ch = sy;
      const baseY = w.pos[1] - sy / 2;
      const start = horizontal ? w.pos[0] - sx / 2 : w.pos[2] - sz / 2;
      const fixed = horizontal ? w.pos[2] : w.pos[0];
      // Ключ сетки = плоскость + ось + шаг + материал. Разные этажи и секции НЕ должны
      // разделять сетку: иначе каждая плита перекрытия становится отдельной сеткой из одного
      // блока (на дом выходило 1500 сеток, а «ненесущих» стен не оставалось вовсе).
      const key = [axis, fixed.toFixed(2), cw.toFixed(2), ch.toFixed(2), (horizontal ? sz : sx).toFixed(2), w.material, w.column ? 'col' : ''].join('|');
      if (!byGrid.has(key)) byGrid.set(key, {
        grid: { axis, fixed, nx: 0, ny: 0, cw, ch, thickness: horizontal ? sz : sx, start, baseY, material: w.material, bearing: w.bearing, section: w.section, floor: w.floor, column: w.column },
        cells: [],
      });
      const g = byGrid.get(key)!;
      // координаты ячейки в общей сетке стены
      const i = Math.round((horizontal ? (w.pos[0] - g.grid.start) / cw : (w.pos[2] - g.grid.start) / cw) - 0.5);
      const j = Math.round((w.pos[1] - g.grid.baseY) / ch - 0.5);
      g.cells.push({
        wall: this.walls.length, i, j,
        p: [w.pos[0], w.pos[1], w.pos[2]], size: [sx, sy, sz],
        alive: true, colKey: -1,
      });
      g.grid.nx = Math.max(g.grid.nx, i + 1);
      g.grid.ny = Math.max(g.grid.ny, j + 1);
      this.walls.push(w);
    }
    // раскладываем ячейки в плоские массивы сеток
    for (const { grid, cells } of byGrid.values()) {
      const gi = this.grids.push(grid) - 1;
      for (const c of cells) { c.wall = gi; }
      this.cells.push(...cells);
      if (grid.column) {
        this.columnTotal.set(grid.section, (this.columnTotal.get(grid.section) ?? 0) + cells.length);
        this.columnLeft.set(grid.section, (this.columnLeft.get(grid.section) ?? 0) + cells.length);
      }
      if (grid.bearing) {
        this.bearingTotal.set(grid.section, (this.bearingTotal.get(grid.section) ?? 0) + cells.length);
        this.bearingLeft.set(grid.section, (this.bearingLeft.get(grid.section) ?? 0) + cells.length);
      }
    }
  }

  /**
   * Строит физику. Пока дом цел — один монолит: считаем габарит здания и делаем
   * ОДНУ коробку. Это принципиально: 5000 коробок в статике Rapier стоят дорого,
   * а целое здание — всё равно непроходимая коробка.
   * После первого разрушения коллайдеры пересобираются по живым вокселям.
   */
  register() {
    this.bounds = new THREE.Box3();
    for (const c of this.cells) {
      this.bounds.expandByPoint(new THREE.Vector3(...c.p).addScaledVector(new THREE.Vector3(...c.size), 0.5));
      this.bounds.expandByPoint(new THREE.Vector3(...c.p).addScaledVector(new THREE.Vector3(...c.size), -0.5));
    }
    const c0 = this.bounds.getCenter(new THREE.Vector3()), sz = this.bounds.getSize(new THREE.Vector3());
    this.bodyId = this.phys.addBuilding({
      kind: 'static', pos: [0, 0, 0], friction: 0.85, surface: 'panel', building: true, group: 0x0002,
      shapes: [{ t: 'box', he: [sz.x / 2, sz.y / 2, sz.z / 2], pos: [c0.x, c0.y, c0.z] }],
    }, [0]);
    this.solidShell = true;
  }
  private bounds = new THREE.Box3();
  private solidShell = false;

  /** Урон в точке: убивает воксели в радиусе. Возвращает количество разбитых. */
  damageAt(point: [number, number, number], radius: number, strength: number, opts: { max?: number; direction?: [number, number, number] } = {}) {
    // защита от неверного вызова (например, передали ячейку вместо её позиции)
    if (!Array.isArray(point) || point.length !== 3 || point.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      console.warn('voxel.damageAt: ожидался [x,y,z], получено', point);
      return 0;
    }
    const p = new THREE.Vector3(...point);
    const max = opts.max ?? 40;
    let broken = 0;
    const touchedSections = new Set<number>();
    for (let idx = 0; idx < this.cells.length && broken < max; idx++) {
      const c = this.cells[idx];
      if (!c.alive) continue;
      const cp = new THREE.Vector3(...c.p);
      const d = cp.distanceTo(p);
      if (d > radius) continue;
      // порог: в эпицентре ломается всё, на краю — только слабое
      const k = 1 - d / radius;
      // линейная зависимость: у квадратичной взрыв выбивал 1-2 блока вместо куска стены
      if (strength * k < 1) continue;
      this.breakCell(idx, p, opts.direction);
      broken++;
      const g = this.grids[c.wall];
      if (g.bearing) touchedSections.add(g.section);
    }
    if (broken) { this.dirtyRender = true; this.dirtyPhysics = true; }
    this.checkCollapse(touchedSections);
    return broken;
  }

  /** Ломает один воксель: физический обломок + пометка «мёртв». */
  private breakCell(idx: number, from: THREE.Vector3, direction?: [number, number, number]) {
    const c = this.cells[idx];
    if (!c.alive) return;
    c.alive = false;
    this.solidShell = false;
    const g = this.grids[c.wall];
    if (g.bearing) this.bearingLeft.set(g.section, (this.bearingLeft.get(g.section) ?? 1) - 1);
    if (g.column) this.columnLeft.set(g.section, (this.columnLeft.get(g.section) ?? 1) - 1);
    // обломок: кусок того же размера, физический, с импульсом от точки удара
    if (this.debrisCount < MAX_DEBRIS) {
      const geo = new THREE.BoxGeometry(c.size[0] * 0.92, c.size[1] * 0.92, c.size[2] * 0.92);
      const mat = voxelMaterialFor(g.material);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...c.p);
      if (g.axis === 'z') mesh.rotation.y = Math.PI / 2;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      const dir = new THREE.Vector3(...c.p).sub(from);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      const mass = Math.max(2, c.size[0] * c.size[1] * c.size[2] * 900); // бетон ~900 кг/м³ в вокселе
      const bodyId = this.phys.add({
        kind: 'dynamic', pos: c.p, mass, friction: 0.9, restitution: 0.03,
        shapes: [{ t: 'box', he: [c.size[0] * 0.46, c.size[1] * 0.46, c.size[2] * 0.46] }],
        surface: g.material, group: 0x0004,
      }, mesh);
      const push = 90 + mass * 4;
      this.phys.post({ type: 'impulse', id: bodyId, imp: [dir.x * push + (direction?.[0] ?? 0) * 40, dir.y * push + 70, dir.z * push + (direction?.[2] ?? 0) * 40] });
      this.debris.push({ mesh, bodyId, born: performance.now() });
      this.debrisCount++;
    }
  }

  private debris: { mesh: THREE.Mesh; bodyId: number; born: number }[] = [];
  private debrisCount = 0;

  /**
   * Проверка опоры: блок держится, только если от него есть путь по живым соседям до земли.
   * Раньше «висящие» блоки оставались висеть над выбитым проёмом и просвечивали насквозь —
   * именно те «полки» со скриншота. Теперь всё, что отрезано от земли, падает.
   */
  enforceSupport() {
    if (!this.cells.length) return 0;
    // грубая сетка соседства: шаг 1.6 м достаточно для блоков 1.4 × 0.7 × 0.32 и плит 2.5 × 0.3
    const H = 1.6;
    const key = (x: number, y: number, z: number) => `${Math.round(x / H)},${Math.round(y / H)},${Math.round(z / H)}`;
    const index = new Map<string, number[]>();
    this.cells.forEach((c, idx) => {
      if (!c.alive) return;
      const k = key(c.p[0], c.p[1], c.p[2]);
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(idx);
    });
    const reached = new Uint8Array(this.cells.length);
    const queue: number[] = [];
    // Опоры: (1) блоки, стоящие на земле; (2) блоки, висящие на перекрытии — плита держится
    // на стенах под ней, а не на воздухе. Без этого целые этажи над одной выбитой колонной
    // «падали» в воздух и дом рушился сам собой.
    const slabs: number[] = [];
    this.cells.forEach((c, idx) => {
      if (!c.alive) return;
      const g = this.grids[c.wall];
      const bottom = c.p[1] - c.size[1] / 2;
      if (bottom <= g.baseY + 0.05 || bottom <= 0.35) { reached[idx] = 1; queue.push(idx); }
      if (c.size[0] > 1.8 || c.size[2] > 1.8) slabs.push(idx);
    });
    // плиты, у которых под краем есть живая стена, тоже считаем опорой
    for (const si of slabs) {
      if (reached[si]) continue;
      const s = this.cells[si];
      const supported = this.cells.some((o, oi) => o.alive && oi !== si &&
        Math.abs(o.p[1] - (s.p[1] - s.size[1] / 2)) < 0.9 &&
        Math.abs(o.p[0] - s.p[0]) < s.size[0] / 2 + 0.5 && Math.abs(o.p[2] - s.p[2]) < s.size[2] / 2 + 0.5);
      if (supported) { reached[si] = 1; queue.push(si); }
    }
    // перекрытия первого этажа тоже считаем опорой (они лежат на стенах)
    while (queue.length) {
      const idx = queue.pop()!;
      const c = this.cells[idx];
      const [x, y, z] = c.p;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const list = index.get(key(x + dx * H, y + dy * H, z + dz * H));
        if (!list) continue;
        for (const o of list) {
          if (reached[o]) continue;
          const oc = this.cells[o];
          // настоящая близость, а не только совпадение ячеек хеша
          if (Math.abs(oc.p[0] - x) > H * 0.9 || Math.abs(oc.p[2] - z) > H * 0.9) continue;
          if (Math.abs(oc.p[1] - y) > Math.max(0.8, c.size[1] * 0.6)) continue;
          reached[o] = 1; queue.push(o);
        }
      }
    }
    let falling = 0;
    for (let idx = 0; idx < this.cells.length; idx++) {
      if (!this.cells[idx].alive || reached[idx]) continue;
      this.breakCell(idx, new THREE.Vector3(this.cells[idx].p[0], this.cells[idx].p[1] - 1, this.cells[idx].p[2]));
      falling++;
    }
    if (falling) { this.dirtyRender = true; this.dirtyPhysics = true; }
    return falling;
  }

  /**
   * Диагностика опоры: какие живые блоки связаны с землёй, а какие висят.
   * Нужна тестам — по ней видно, что геометрия не «просвечивает».
   */
  supportStats() {
    const H = 1.6;
    const key = (x: number, y: number, z: number) => `${Math.round(x / H)},${Math.round(y / H)},${Math.round(z / H)}`;
    const index = new Map<string, number[]>();
    this.cells.forEach((c, idx) => { if (!c.alive) return; const k = key(c.p[0], c.p[1], c.p[2]); if (!index.has(k)) index.set(k, []); index.get(k)!.push(idx); });
    const reached = new Uint8Array(this.cells.length);
    const queue: number[] = [];
    const slabs: number[] = [];
    this.cells.forEach((c, idx) => {
      if (!c.alive) return;
      const g = this.grids[c.wall];
      const bottom = c.p[1] - c.size[1] / 2;
      if (bottom <= g.baseY + 0.05 || bottom <= 0.35) { reached[idx] = 1; queue.push(idx); }
      if (c.size[0] > 1.8 || c.size[2] > 1.8) slabs.push(idx);
    });
    for (const si of slabs) {
      if (reached[si]) continue;
      const s = this.cells[si];
      const ok = this.cells.some((o, oi) => o.alive && oi !== si &&
        Math.abs(o.p[1] - (s.p[1] - s.size[1] / 2)) < 0.9 &&
        Math.abs(o.p[0] - s.p[0]) < s.size[0] / 2 + 0.5 && Math.abs(o.p[2] - s.p[2]) < s.size[2] / 2 + 0.5);
      if (ok) { reached[si] = 1; queue.push(si); }
    }
    while (queue.length) {
      const idx = queue.pop()!; const c = this.cells[idx]; const [x, y, z] = c.p;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const list = index.get(key(x + dx * H, y + dy * H, z + dz * H)); if (!list) continue;
        for (const o of list) {
          if (reached[o]) continue;
          const oc = this.cells[o];
          if (Math.abs(oc.p[0] - x) > H * 0.9 || Math.abs(oc.p[2] - z) > H * 0.9) continue;
          if (Math.abs(oc.p[1] - y) > Math.max(0.8, c.size[1] * 0.6)) continue;
          reached[o] = 1; queue.push(o);
        }
      }
    }
    let alive = 0, supported = 0;
    this.cells.forEach((c, idx) => { if (!c.alive) return; alive++; if (reached[idx]) supported++; });
    return { alive, supported, floating: alive - supported };
  }

  /** Обвал: если от несущих секции осталось меньше 25 % — роняем остатки. */
  private checkCollapse(sections: Set<number>) {
    const now = performance.now();
    // если по колоннам не бьют (например, обрушился только фасад), всё равно проверяем все секции
    if (!sections.size) for (const k of this.columnTotal.keys()) sections.add(k);
    for (const s of sections) {
      if (this.collapsed.has(s)) continue;
      // считаем КОЛОННЫ (ТЗ: «у здания есть несущие колонны») и проверяем ВСЕ секции
      const left = this.columnLeft.get(s) ?? 0, total = this.columnTotal.get(s) ?? 0;
      const okTime = this.lastCollapse === 0 || now - this.lastCollapse > 700;
      if (total && left / total <= 0.34 && okTime) {
        this.lastCollapse = now;
        this.collapsed.add(s);
        this.collapseSection(s);
      }
    }
  }
  private lastCollapse = 0;

  private collapseSection(section: number) {
    // роняем всё, что осталось в секции: сверху вниз, по одному слою за кадр — так выглядит обвал
    const victims: number[] = [];
    this.cells.forEach((c, idx) => {
      if (!c.alive) return;
      const g = this.grids[c.wall];
      if (g.section === section) victims.push(idx);
    });
    victims.sort((a, b) => this.cells[b].p[1] - this.cells[a].p[1]); // сверху вниз
    let li = 0;
    const step = () => {
      const chunk = victims.slice(li, li + 14);
      li += 14;
      for (const idx of chunk) if (this.cells[idx].alive) this.breakCell(idx, new THREE.Vector3(this.cells[idx].p[0], this.cells[idx].p[1] - 1, this.cells[idx].p[2]));
      this.dirtyRender = true; this.dirtyPhysics = true;
      if (li < victims.length) this.raf(step);
      else this.dustSpawn();
    };
    this.raf(step);
  }

  private dustSpawn() {
    const c = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: '#b0a89a', transparent: true, opacity: 0.3, depthWrite: false }));
    c.position.copy(this.group.position).add(new THREE.Vector3(0, 4, 0));
    c.scale.set(1.4, 0.5, 1.4);
    this.scene.add(c);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 3000;
      c.scale.set(1.4 + k * 2, 0.5 + k * 1.2, 1.4 + k * 2);
      (c.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.3 * (1 - k));
      if (k < 1) this.raf(anim); else this.scene.remove(c);
    };
    this.raf(anim);
  }

  /** Пересборка коллайдеров: жадное слияние живых вокселей в крупные коробки. */
  private rebuildPhysics() {
    if (this.bodyId < 0) return;
    const shapes: Shape[] = [];
    // группируем по стене и ищем прямоугольные блоки живых клеток
    this.grids.forEach((g, gi) => {
      const alive = this.cells.filter(c => c.wall === gi && c.alive);
      if (!alive.length) return;
      // сетка по (i, y-слой): индекс по округлённой высоте
      const cellH = g.ch;
      const baseY = g.baseY;
      const rows = new Map<number, Set<number>>(); // слой j → множество i
      for (const c of alive) {
        const j = Math.round((c.p[1] - baseY - cellH / 2) / cellH);
        if (!rows.has(j)) rows.set(j, new Set());
        rows.get(j)!.add(Math.round((g.axis === 'x' ? c.p[0] - g.start : c.p[2] - g.start) / g.cw - 0.5));
      }
      // для каждого слоя сливаем подряд идущие i в один блок
      for (const [j, set] of rows) {
        const arr = [...set].sort((a, b) => a - b);
        let runStart = arr[0], prev = arr[0];
        const flush = () => {
          const count = prev - runStart + 1;
          const centerG = g.start + (runStart + count / 2) * g.cw;
          const y = baseY + j * cellH + cellH / 2;
          const he: [number, number, number] = g.axis === 'x'
            ? [count * g.cw / 2, cellH / 2, g.thickness / 2]
            : [g.thickness / 2, cellH / 2, count * g.cw / 2];
          const pos: [number, number, number] = g.axis === 'x' ? [centerG, y, g.fixed] : [g.fixed, y, centerG];
          // позиция в локальных координатах здания: физика ждёт мировые, вычтем origin
          shapes.push({ t: 'box', he, pos: [pos[0] - this.group.position.x, pos[1] - this.group.position.y, pos[2] - this.group.position.z] });
        };
        for (let k = 1; k < arr.length; k++) {
          if (arr[k] !== prev + 1) { flush(); runStart = arr[k]; }
          prev = arr[k];
        }
        flush();
      }
    });
    // проще и надёжнее: удалить тело и создать заново (дом статичный).
    // Ограничение: если форм слишком много (дом почти целый), физику не трогаем —
    // монолитная коробка уже стоит и работает.
    this.phys.post({ type: 'removeBody', id: this.bodyId });
    const capped = shapes.slice(0, 2500);
    this.bodyId = this.phys.addBuilding({
      kind: 'static', pos: [0, 0, 0], friction: 0.85, surface: 'panel', building: true, group: 0x0002, shapes: capped,
    }, capped.map((_, i) => i));
    this.dirtyPhysics = false;
  }

  /** Пересборка визуала: один InstancedMesh на цвет материала. */
  private rebuildRender() {
    // считаем живые по материалу
    const byMat = new Map<string, VoxelCell[]>();
    for (const c of this.cells) {
      if (!c.alive) continue;
      const g = this.grids[c.wall];
      const k = g.material;
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k)!.push(c);
    }
    for (const [mat, list] of byMat) {
      let inst = this.instPerColor.get(mat);
      if (!inst || inst.count < list.length) {
        if (inst) this.group.remove(inst);
        inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), voxelMaterialFor(mat as Surface), Math.max(64, list.length * 2));
        inst.castShadow = true; inst.receiveShadow = true;
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(inst);
        this.instPerColor.set(mat, inst);
      }
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      list.forEach((c, i) => {
        const g = this.grids[c.wall];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.axis === 'z' ? Math.PI / 2 : 0);
        // в локальных координатах группы
        p.set(c.p[0] - this.group.position.x, c.p[1] - this.group.position.y, c.p[2] - this.group.position.z);
        s.set(c.size[0], c.size[1], c.size[2]);
        m.compose(p, q, s); inst!.setMatrixAt(i, m);
      });
      inst.count = list.length;
      inst.instanceMatrix.needsUpdate = true;
    }
    // материалы, которых больше нет, прячем
    for (const [mat, inst] of this.instPerColor) if (!byMat.has(mat)) inst.count = 0;
    this.dirtyRender = false;
  }

  /** Вызывать каждый кадр. Пересобирает физику/рендер не чаще 10 раз в секунду. */
  update(now: number) {
    if (this.dirtyRender && now - this.lastRebuild > 100) { this.lastRebuild = now; this.rebuildRender(); }
    if (this.dirtyPhysics && now - this.lastPhysics > 160) {
      this.lastPhysics = now;
      this.enforceSupport();   // сначала роняем отрезанное, потом собираем коллайдеры
      this.rebuildPhysics();
    }
    // уборка старых обломков
    if (this.debris.length > MAX_DEBRIS) {
      const excess = this.debris.splice(0, this.debris.length - MAX_DEBRIS);
      for (const d of excess) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); this.phys.post({ type: 'removeBody', id: d.bodyId }); this.debrisCount--; }
    }
  }
  private lastRebuild = 0; private lastPhysics = 0;

  /** id текущего физического тела (меняется при пересборке коллайдеров) */
  get physicsId() { return this.bodyId; }

  /** Сколько процентов секции ещё стоит (для HUD). */
  structure(section: number) {
    const total = this.columnTotal.get(section) ?? 0;
    const left = this.columnLeft.get(section) ?? 0;
    if (!total) return 100;
    return Math.round((left / total) * 100);
  }

  /** Сколько колонн осталось в секции (для HUD/тестов). */
  columns(section: number) { return { left: this.columnLeft.get(section) ?? 0, total: this.columnTotal.get(section) ?? 0 }; }
}

const MAX_DEBRIS = 220;

const voxelMats = new Map<string, THREE.MeshStandardMaterial>();
export function voxelMaterialFor(m: Surface) {
  if (!voxelMats.has(m)) {
    const colors: Record<string, string> = {
      panel: '#b4b0a4', concrete: '#a3a49c', brick: '#8d5a44', plaster: '#cfc9bb', wood: '#8a5a2b', metal: '#7a7f85', glass: '#9fc4d8',
    };
    voxelMats.set(m, new THREE.MeshStandardMaterial({ color: colors[m] ?? '#b0b0a8', roughness: 0.93, metalness: 0.02 }));
  }
  return voxelMats.get(m)!;
}
