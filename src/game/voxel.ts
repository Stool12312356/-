// РАЗРУШЕНИЕ ДОМА ИЗ ПАНЕЛЕЙ (M4).
//
// Было (M3): дом из «кирпичиков 1.4 × 0.7», окна — вырезанные дыры, торцы — рёбра.
// На скриншотах это выглядело как решётка/решето, а не как панелька.
//
// Стало: стена собрана из ПАНЕЛЕЙ (panels.ts), у каждой панели:
//   - своя геометрия с ровной рамкой и настоящим проёмом (стекло отдельным мешем);
//   - свой запас прочности (hp) и раскладка на куски для пробоин;
//   - один InstancedMesh на материал — 300 панелей рисуются за 3 драу-колла.
// Разрушение:
//   1. Пуля/осколок бьёт в КОНКРЕТНУЮ панель → у неё убывает hp → на месте попадания
//      появляется пробоина (куски панели исчезают, панель перерисовывается);
//   2. Когда hp кончилось — панель выпадает целиком одним куском (обломок с физикой);
//   3. Несущие панели (фасад/торец) учитываются в обрушении: потеряли 66 % — секция падает.
//      Межсекционная кирпичная стена не несущая: её можно пробить, но дом стоит.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsClient } from '../physics/client.ts';
import type { Shape } from '../shared/types.ts';
import type { PlacedPanel } from './house.ts';
import { buildPanelGeometry, glassMat, layoutPanel, panelMaterial, type PanelVoxel } from './panels.ts';

const MAX_DEBRIS = 200;

interface PanelState extends PlacedPanel {
  /** стекло в проёме разбито (панель цела, но окно выбито) */
  glassBroken: boolean;
  /** локальный индекс панели */
  id: number;
  hp: number;
  maxHp: number;
  /** раскладка на куски (для пробоин) */
  voxels: PanelVoxel[];
  aliveVoxels: number;
  destroyed: boolean;
  /** матрица «локальные координаты дома» (позиция + поворот) */
  matrix: THREE.Matrix4;
}

export class HousePanels {
  group = new THREE.Group();
  panels: PanelState[] = [];
  /** центр и габариты — для поиска «какой дом рядом» и HUD */
  bounds = new THREE.Box3();

  private phys: PhysicsClient;
  private scene: THREE.Scene;
  private bodyId = -1;
  private inst = new Map<string, THREE.Mesh>();
  private glassInst: THREE.Mesh | null = null;
  private dirty = true;
  private collapseState = new Map<number, { left: number; total: number }>();
  collapsed = new Set<number>();
  private debrisCount = 0;
  /** куски, которые ещё не разлетелись: панель рисуется из целых кусков */
  private dummy = new THREE.Object3D();

  constructor(panels: PlacedPanel[], scene: THREE.Scene, phys: PhysicsClient) {
    this.phys = phys; this.scene = scene;
    this.group.name = 'house';
    scene.add(this.group);
    let id = 0;
    for (const p of panels) {
      const def = p.def;
      const matrix = new THREE.Matrix4()
        .makeRotationY(p.rotY)
        .setPosition(p.pos[0], p.pos[1], p.pos[2]);
      const state: PanelState = {
        ...p, id: id++, hp: def.hp, maxHp: def.hp, glassBroken: false,
        voxels: layoutPanel(def), aliveVoxels: 0, destroyed: false, matrix,
      };
      state.aliveVoxels = state.voxels.filter(v => !v.inOpening).length;
      this.panels.push(state);
      this.bounds.expandByPoint(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]));
      if (p.bearing) {
        const st = this.collapseState.get(p.section) ?? { left: 0, total: 0 };
        st.total++; st.left++;
        this.collapseState.set(p.section, st);
      }
    }
  }

  get physicsId() { return this.bodyId; }

  /** Сколько несущих панелей осталось в секции, %. */
  structure(section: number) {
    const st = this.collapseState.get(section);
    if (!st) return 100;
    return Math.round((st.left / Math.max(1, st.total)) * 100);
  }

  /** Для HUD и тестов: несущие панели секции (left/total). */
  columns(section: number) {
    const st = this.collapseState.get(section) ?? { left: 0, total: 0 };
    return { left: st.left, total: st.total };
  }

  /**
   * Физика дома. Пока дом цел — ОДНА коробка по габаритам: внутрь не залезть,
   * но и 300 коллайдеров не нужны. После первого разрушения пересобираем по живым панелям.
   */
  register() {
    const size = this.bounds.getSize(new THREE.Vector3());
    const center = this.bounds.getCenter(new THREE.Vector3());
    const he: [number, number, number] = [Math.max(0.5, size.x / 2), Math.max(0.5, size.y / 2), Math.max(0.5, size.z / 2)];
    // низ дома стоит на земле: сдвигаем коробку вверх на половину высоты
    this.bodyId = this.phys.addBuilding({
      kind: 'static',
      shapes: [{ t: 'box', he, pos: [center.x, Math.max(he[1], center.y), center.z] } as Shape],
      pos: [0, 0, 0], quat: [0, 0, 0, 1],
    } as never, [0]);
    this.rebuildRender();
  }

  /** Разрушение в точке. Возвращает число выбитых кусков (для эффектов/тестов). */
  damageAt(point: readonly number[] | THREE.Vector3, radius: number, strength: number, opts: { max?: number } = {}): number {
    // защита от мусора: в игру могут прилететь и массив, и Vector3, и (при баге) строка
    let cp: THREE.Vector3;
    if (point instanceof THREE.Vector3) cp = point.clone();
    else if (Array.isArray(point) && point.length >= 3 && point.every(v => typeof v === 'number' && Number.isFinite(v)))
      cp = new THREE.Vector3(point[0], point[1], point[2]);
    else return 0;
    const max = opts.max ?? 6;
    let killed = 0;
    for (const p of this.panels) {
      if (p.destroyed) continue;
      // дистанция до панели (плоская, по её плоскости и толщине)
      const local = cp.clone().applyMatrix4(p.matrix.clone().invert());
      // панель локально: X — ширина, Y — высота, Z — толщина
      const dx = Math.max(0, Math.abs(local.x) - p.def.w / 2);
      const dy = Math.max(0, Math.abs(local.y) - p.def.h / 2);
      const dz = Math.max(0, Math.abs(local.z) - p.def.thickness / 2);
      const dist = Math.hypot(dx, dy, dz);
      if (dist > radius) continue;
      // линейное падение силы (квадратичное давало 1 кусок вместо куска стены)
      const k = 1 - dist / radius;
      const dmg = strength * k * (1 + 0.35 * Math.random());
      if (dmg < 6) continue;
      // гасим hp и выбиваем куски в радиусе
      p.hp -= dmg;
      // Радиус пробоины. Раньше он был меньше куска панели и пуля могла не выбить НИ ОДНОГО
      // куска («стреляю в стену — ничего») . Теперь гарантированно берём ближайший кусок.
      const hitR = Math.min(1.3, Math.max(0.5, radius * 0.9));
      let broken = 0;
      for (const v of p.voxels) {
        if (!v.alive) continue;
        if (broken >= max) break;
        const vp = new THREE.Vector3(v.p[0], v.p[1], v.p[2]).applyMatrix4(p.matrix);
        if (vp.distanceTo(cp) > hitR) continue;
        if (v.inOpening) {
          // попадание в проём: выбивает стекло, а не стену — это тоже пробоина
          if (p.def.glass && !p.glassBroken) { p.glassBroken = true; broken++; killed++; }
          continue;
        }
        v.alive = false; broken++; killed++;
      }
      p.aliveVoxels -= broken;
      if (p.hp <= 0 || p.aliveVoxels <= Math.max(1, p.voxels.length * 0.35)) {
        this.destroyPanel(p, cp);
      }
      // на фасаде обрушение считаем по панелям, а не по кускам
      this.dirty = true;
    }
    for (const s of this.collapseState.keys()) this.checkCollapse(s);
    return killed;
  }

  private destroyPanel(p: PanelState, at: THREE.Vector3) {
    p.destroyed = true;
    p.hp = 0;
    p.aliveVoxels = 0;
    p.glassBroken = true;
    for (const v of p.voxels) v.alive = false;
    if (p.bearing) {
      const st = this.collapseState.get(p.section);
      if (st) st.left = Math.max(0, st.left - 1);
    }
    // обломок: целая панель падает куском (в физике — коробка)
    this.spawnDebris(p.def.w * 0.5, p.def.h * 0.5, p.def.thickness * 0.5, at, p.def.color);
  }

  private spawnDebris(hx: number, hy: number, hz: number, at: THREE.Vector3, color: string) {
    if (this.debrisCount >= MAX_DEBRIS) return;
    this.debrisCount++;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 }));
    mesh.position.copy(at);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.phys.add({
      kind: 'dynamic',
      shapes: [{ t: 'box', he: [hx, hy, hz] }],
      pos: [at.x, at.y, at.z], quat: [0, 0, 0, 1],
      density: 700, friction: 0.8, restitution: 0.05,
    } as never, mesh);
  }

  /** Обрушение секции: все живые панели выше первого этажа падают. */
  private checkCollapse(section: number) {
    if (this.collapsed.has(section)) return;
    const st = this.collapseState.get(section);
    if (!st || st.total === 0) return;
    if (st.left / st.total > 0.34) return;
    this.collapsed.add(section);
    for (const p of this.panels) {
      if (p.section !== section || p.destroyed) continue;
      if (p.floor < 1) continue;             // первый этаж остаётся – есть на что смотреть
      this.destroyPanel(p, new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]));
    }
    // всё, что осталось без опоры (в т.ч. в соседних секциях), роняем
    this.enforceSupport();
    this.dirty = true;
  }

  /** Геометрия панели с учётом уже выбитых кусков: собранная из живых кусков. */
  private panelGeometry(p: PanelState): { body: THREE.BufferGeometry | null; glass: boolean } {
    if (p.destroyed || p.aliveVoxels === 0) return { body: null, glass: false };
    if (p.aliveVoxels === p.voxels.filter(v => !v.inOpening).length) {
      const g = buildPanelGeometry(p.def);
      return { body: g.body, glass: !!p.def.glass };
    }
    // есть пробоина: собираем из живых кусков (они крупные, это дёшево)
    const parts: THREE.BufferGeometry[] = [];
    for (const v of p.voxels) {
      if (!v.alive || v.inOpening) continue;
      const g = new THREE.BoxGeometry(v.size[0], v.size[1], v.size[2]);
      g.translate(v.p[0], v.p[1], v.p[2]);
      parts.push(g);
    }
    if (!parts.length) return { body: null, glass: false };
    const body = mergeGeometries(parts, false);
    body?.computeVertexNormals();
    return { body: parts.length ? body : null, glass: false };
  }

  /**
   * Рендер: ОДИН меш на материал. Панели склеиваются в общую геометрию, поэтому дом
   * рисуется 3–4 драу-коллами (было: 250+ отдельных панелей). Разрушенная панель
   * выпадает из склейки, а её пробоина — это отсутствующие куски в геометрии.
   */
  private rebuildRender() {
    for (const m of this.inst.values()) { m.removeFromParent(); m.geometry?.dispose(); }
    this.inst.clear();
    this.glassInst?.removeFromParent();
    this.glassInst = null;

    const byColor = new Map<string, THREE.BufferGeometry[]>();
    const glassGeos: THREE.BufferGeometry[] = [];
    for (const p of this.panels) {
      if (p.destroyed) continue;
      const { body, glass } = this.panelGeometry(p);
      if (body) {
        body.applyMatrix4(p.matrix);
        const list = byColor.get(p.def.color) ?? [];
        list.push(body);
        byColor.set(p.def.color, list);
      }
      if (glass && p.def.glass && p.def.opening && !p.glassBroken) {
        const w = (p.def.opening.x1 - p.def.opening.x0) * p.def.w * 0.98;
        const h = (p.def.opening.y1 - p.def.opening.y0) * p.def.h * 0.98;
        const cx = -p.def.w / 2 + ((p.def.opening.x0 + p.def.opening.x1) / 2) * p.def.w;
        const cy = -p.def.h / 2 + ((p.def.opening.y0 + p.def.opening.y1) / 2) * p.def.h;
        const g = new THREE.PlaneGeometry(w, h);
        g.translate(cx, cy, 0);
        g.applyMatrix4(p.matrix);
        glassGeos.push(g);
      }
    }
    for (const [color, geos] of byColor) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, panelMaterial({ color } as never));
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.inst.set(color, mesh);
    }
    if (glassGeos.length) {
      const merged = mergeGeometries(glassGeos, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, glassMat());
        mesh.renderOrder = 2;
        this.group.add(mesh);
      }
    }
  }

  /** Вызывать каждый кадр: пересборка рендера не чаще 10 раз в секунду. */
  lastUpdate = 0;
  update(now: number) {
    if (!this.dirty) return;
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    this.dirty = false;
    this.rebuildRender();
  }

  /**
   * Панель держится, если под ней есть живая опора: панель предыдущего этажа в той же
   * секции и рядом по горизонтали. Всё, что осталось висеть в воздухе после обрушения,
   * роняем — иначе получаются «парящие» куски стен (это и было на скриншотах).
   */
  enforceSupport() {
    const alive = this.panels.filter(p => !p.destroyed);
    const byKey = new Map<string, PanelState>();
    const key = (p: PanelState, floor: number) => `${p.section}|${floor}|${Math.round(p.pos[0] / 2)}|${Math.round(p.pos[2] / 2)}`;
    for (const p of alive) byKey.set(key(p, p.floor), p);
    let dropped = 0;
    for (const p of alive) {
      if (p.floor === 0) continue;
      // внутренние плиты/лестницы не считаем: они держатся на секции
      if (p.role === 'slab' || p.role === 'stair' || p.role === 'landing' || p.role === 'roof') continue;
      let hasSupport = false;
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        const k = `${p.section}|${p.floor - 1}|${Math.round(p.pos[0] / 2) + dx}|${Math.round(p.pos[2] / 2) + dz}`;
        if (byKey.has(k)) { hasSupport = true; break; }
      }
      if (!hasSupport) {
        p.destroyed = true; p.hp = 0;
        for (const v of p.voxels) v.alive = false;
        dropped++;
      }
    }
    if (dropped) this.dirty = true;
    return dropped;
  }

  /** Диагностика для тестов: сколько панелей висит без опоры (не должно быть). */
  supportStats() {
    let alive = 0, floating = 0;
    for (const p of this.panels) {
      if (p.destroyed) continue;
      if (p.role === 'slab' || p.role === 'roof' || p.role === 'stair' || p.role === 'landing') continue;
      alive++;
      // панель «висит», если под ней нет ни одной живой панели-опоры и это не первый этаж
      if (p.floor === 0) continue;
      const below = this.panels.some(q => !q.destroyed && q.section === p.section && q.floor === p.floor - 1
        && Math.abs(q.pos[0] - p.pos[0]) < 3.6 && Math.abs(q.pos[2] - p.pos[2]) < 3.6);
      if (!below) floating++;
    }
    return { alive, floating };
  }
}
