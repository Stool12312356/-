// Система разрушений (M3-заготовка, но работает уже сейчас).
// Уровни из ТЗ:
//  - микро: пуля оставляет пробоину и скол (частица + декаль), панель теряет HP;
//  - средняя: панель снесена -> в стене дыра, на её месте физические обломки;
//  - макро: кончились несущие панели секции -> секция складывается, всё внутри гибнет.
// Все визуальные объекты объединены в InstancedMesh по материалу, чтобы сотни обломков
// не превратились в сотни драв-коллов.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingSpec, WallPanel } from './buildings.ts';
import { buildBuildingMesh, buildFurniture } from './buildings.ts';
import type { PhysicsClient } from '../physics/client';
import type { Shape, Surface } from '../shared/types';

export interface DebrisBody { mesh: THREE.Mesh; bodyId: number; born: number; }

const MAX_DEBRIS = 260;
/**
 * Во сколько раз урон по зданию умножается.
 * Баланс: панель фасада ~430 HP, автомат бьёт 2.4*26*0.9 ≈ 56 урона за пулю →
 * ~8 попаданий на панель (как в BC2), РПГ 900×0.5 — сносит панель одним попаданием.
 */
const BUILDING_DMG_MUL = 2;
/** rAF есть не везде (Node-тесты): без него анимация просто не запускается */
const raf = (fn: FrameRequestCallback) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0);

export class Building {
  spec: BuildingSpec;
  group: THREE.Group;
  /** меши панелей: индекс панели → InstancedMesh (нужен, чтобы спрятать ровно одну) */
  private panels: WallPanel[];
  private hp: Float32Array;
  private destroyed: Uint8Array;
  private inst = new Map<number, { mesh: THREE.InstancedMesh; i: number }>();
  private glassMeshes: THREE.Object3D[] = [];
  /** HP несущих по секциям */
  private loadLeft: number[];
  private loadTotal: number[];
  collapsed: boolean[] = [];
  physicsId = -1;
  private frags: DebrisBody[] = [];
  private lastCollapse = 0;
  private collapsing = false;
  private origin: THREE.Vector3;
  private rotY: number;

  constructor(spec: BuildingSpec, kind: string, origin: THREE.Vector3, rotY: number) {
    this.spec = spec; this.origin = origin.clone(); this.rotY = rotY;
    const { group, panelMeshes } = buildBuildingMesh(spec, kind);
    this.group = group; this.panels = spec.panels;
    this.hp = new Float32Array(spec.panels.length); this.destroyed = new Uint8Array(spec.panels.length);
    spec.panels.forEach((p, i) => { this.hp[i] = p.hp; });
    this.inst = panelMeshes as unknown as Map<number, { mesh: THREE.InstancedMesh; i: number }>;
    this.loadLeft = spec.loadBearingBySection.map(l => l.length);
    this.loadTotal = spec.loadBearingBySection.map(l => l.length);
    this.collapsed = spec.loadBearingBySection.map(() => false);
    group.position.copy(origin); group.rotation.y = rotY;
    // запоминаем стеклянные группы окон — их прячем при разрушении фасада
    group.children.forEach(c => { if (!(c as THREE.InstancedMesh).isInstancedMesh) this.glassMeshes.push(c); });
  }

  /** Физическая регистрация: одна статичная сущность с панельными коробками. */
  register(phys: PhysicsClient) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY);
    const shapes: Shape[] = [];
    const indexes: number[] = [];
    this.panels.forEach((p, i) => {
      const v = new THREE.Vector3(...p.pos).applyQuaternion(q).add(this.origin);
      // панель повёрнута вокруг Y на p.rotY внутри дома: суммируем с поворотом дома
      const yaw = this.rotY + p.rotY;
      const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      shapes.push({ t: 'box', he: [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], pos: [0, 0, 0], rotY: 0 });
      // для простоты физики панель описываем мировой коробкой с поворотом: Rapier хранит
      // поворот коллайдера относительно тела, поэтому поворачивать каждую панель отдельно
      // нельзя — вместо этого используем AABB-коробку нужного габарита (для панелей 0/90° это точно).
      void qp; void v;
      indexes.push(i);
    });
    // панели дома повёрнуты только вокруг Y на 0 или 90°, поэтому AABB-коробка = панель.
    // Собираем мировые коробки: у 0/90° габариты меняются местами по X/Z.
    shapes.length = 0; indexes.length = 0;
    this.panels.forEach((p, i) => {
      const local = new THREE.Vector3(...p.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY).add(this.origin);
      const swap = Math.abs(Math.sin(p.rotY)) > 0.5; // 90°
      const halfX = (swap ? p.size[2] : p.size[0]) / 2;
      const halfY = p.size[1] / 2;
      const halfZ = (swap ? p.size[0] : p.size[2]) / 2;
      shapes.push({ t: 'box', he: [halfX, halfY, halfZ], pos: [local.x, local.y, local.z] });
      indexes.push(i);
    });
    this.physicsId = phys.addBuilding({
      kind: 'static', pos: [0, 0, 0], friction: 0.85, surface: 'panel', building: true, group: 0x0002,
      shapes,
    }, indexes);
  }

  /** Урон панели. Возвращает true, если панель уничтожена этим ударом. */
  damagePanel(i: number, dmg: number, scene: THREE.Scene, phys: PhysicsClient, point?: THREE.Vector3) {
    if (i < 0 || i >= this.panels.length || this.destroyed[i]) return false;
    this.hp[i] -= dmg * BUILDING_DMG_MUL;
    if (this.hp[i] > 0) return false;
    this.destroy(i, scene, phys, point);
    return true;
  }

  private destroy(i: number, scene: THREE.Scene, phys: PhysicsClient, point?: THREE.Vector3) {
    this.destroyed[i] = 1;
    const ref = this.inst.get(i);
    if (ref) {
      // прячем панель: масштаб в ноль (дёшево, без перестройки буферов)
      const m = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
      ref.mesh.setMatrixAt(ref.i, m); ref.mesh.instanceMatrix.needsUpdate = true;
    }
    const p = this.panels[i];
    // коллайдер панели — из физики (игрок сможет пройти в дыру)
    if (this.physicsId >= 0) phys.removePanel(this.physicsId, i);
    if (this.collapsing) return; // во время обрушения не плодим обломки и не пересчитываем несущие
    // обломки
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY + p.rotY);
    const world = new THREE.Vector3(...p.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY).add(this.origin);
    const n = Math.min(4, Math.max(2, Math.round(p.size[2] / 0.9)));
    for (let k = 0; k < n; k++) {
      const sz: [number, number, number] = [p.size[0], p.size[1] / n * 0.9, p.size[2]];
      const geo = new THREE.BoxGeometry(sz[0], sz[1], sz[2]);
      const mat = new THREE.MeshStandardMaterial({ color: p.material === 'brick' ? '#7d5038' : '#9a9a92', roughness: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      const off = new THREE.Vector3(0, (k - (n - 1) / 2) * sz[1], 0).applyQuaternion(q);
      mesh.position.copy(world).add(off); mesh.quaternion.copy(q);
      mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
      const bodyId = phys.add({
        kind: 'dynamic', pos: [mesh.position.x, mesh.position.y, mesh.position.z],
        quat: [q.x, q.y, q.z, q.w], mass: 40 + 30 * sz[1] * sz[2], friction: 0.85, restitution: 0.05,
        shapes: [{ t: 'box', he: [sz[0] / 2, sz[1] / 2, sz[2] / 2] }],
        surface: p.material as Surface, group: 0x0004,
      }, mesh);
      this.frags.push({ mesh, bodyId, born: performance.now() });
      if (point) {
        const d = new THREE.Vector3().subVectors(mesh.position, point).normalize();
        phys.post({ type: 'impulse', id: bodyId, imp: [d.x * 260, d.y * 260 + 120, d.z * 260] });
      }
    }
    // слишком много обломков — самые старые убираем (лимит производительности из ТЗ)
    while (this.frags.length > MAX_DEBRIS) {
      const old = this.frags.shift()!;
      scene.remove(old.mesh); old.mesh.geometry.dispose(); phys.post({ type: 'removeBody', id: old.bodyId });
    }
    // несущая: уменьшаем счётчик секции и проверяем обрушение
    if (p.loadBearing) {
      this.loadLeft[p.section] = Math.max(0, this.loadLeft[p.section] - 1);
      const left = this.loadLeft[p.section], total = this.loadTotal[p.section];
      // обрушение — редкое событие: не чаще раза в 900 мс, чтобы взрыв не ронял все секции разом
      const nowMs = performance.now();
      // lastCollapse === 0 — первое обрушение не должно блокироваться дебаунсом
      if (!this.collapsed[p.section] && total > 0 && left <= Math.floor(total * 0.35) && (this.lastCollapse === 0 || nowMs - this.lastCollapse > 900)) {
        this.lastCollapse = nowMs;
        this.collapse(p.section, scene, phys);
        // ВАЖНО: collapse() обходит тот же массив несущих и вызывает destroy(),
        // поэтому выходим из внешнего цикла — иначе счётчик уходит в отрицательные и
        // обрушение «теряется» (баг ловился тестом: loadLeft 0/108, а collapsed = false).
        return;
      }
    }
  }

  /** Макро-обрушение секции: всё, что осталось от несущих, падает вниз по этажам. */
  private collapse(section: number, scene: THREE.Scene, phys: PhysicsClient) {
    this.collapsed[section] = true;
    this.collapsing = true;
    const list = this.spec.loadBearingBySection[section];
    for (const i of list) if (!this.destroyed[i]) this.destroy(i, scene, phys);
    // пыль и грохот: большая сфера-облако
    const c = new THREE.Vector3(this.origin.x + 0, 4, this.origin.z);
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 10), new THREE.MeshBasicMaterial({ color: '#b0a89a', transparent: true, opacity: 0.35, depthWrite: false }));
    cloud.position.copy(c); cloud.scale.set(1, 0.6, 1); scene.add(cloud);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 2600;
      cloud.scale.setScalar(1 + k * 2.2); (cloud.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.35 * (1 - k));
      if (k < 1) raf(anim); else scene.remove(cloud);
    };
    raf(anim);
    this.collapsing = false;
  }

  /**
   * Взрыв рядом с домом: выбивает кусок стены (средний уровень из ТЗ), а вплотную к несущей —
   * роняет секцию. Урон падает с расстоянием, поэтому РПГ сносит 2-4 панели, а не полдома.
   */
  blast(point: [number, number, number], radius: number, damage: number, scene: THREE.Scene, phys: PhysicsClient, maxPanels = 6) {
    if (this.physicsId < 0) return 0;
    const p = new THREE.Vector3(...point);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY);
    let killed = 0;
    // ограничение: один взрыв выбивает кусок стены, а не полфасада (иначе дом «испаряется»)
    for (let i = 0; i < this.panels.length && killed < maxPanels; i++) {
      if (this.destroyed[i]) continue;
      const panel = this.panels[i];
      const c = new THREE.Vector3(...panel.pos).applyQuaternion(q).add(this.origin);
      const d = c.distanceTo(p);
      if (d > radius) continue;
      // урон падает квадратично: в эпицентре полный, на краю радиуса — 25%
      const k = 1 - (d / radius) * 0.75;
      if (this.damagePanel(i, damage * k * k, scene, phys, p)) killed++;
    }
    return killed;
  }

  /** Сколько несущих осталось (для HUD/отладки). */
  get structure() { return this.loadLeft.map((l, i) => `${l}/${this.loadTotal[i]}${this.collapsed[i] ? ' ОБРУШЕНА' : ''}`); }
}

/**
 * Ставит в сцену готовый дом: визуал + физика + мебель.
 * Мебель не физическая (это декор внутри, экономия 40 тел на квартиру), но лежит
 * на своих местах и видна через выбитые окна — требование «внутри чтобы было».
 */
export function spawnBuilding(spec: BuildingSpec, kind: string, scene: THREE.Scene, phys: PhysicsClient, pos: [number, number, number], rotY = 0) {
  const b = new Building(spec, kind, new THREE.Vector3(...pos), rotY);
  b.register(phys);
  scene.add(b.group);
  // Мебель: 250-350 предметов × ~8 мешей = 2000+ драв-коллов, если ставить как есть.
  // Поэтому каждый предмет собирается один раз, а затем ВСЕ его меши сливаются по материалу
  // в несколько общих мешей на дом (BufferGeometryUtils.mergeGeometries).
  const buckets = new Map<string, { geo: THREE.BufferGeometry[]; mat: THREE.Material }>();
  for (const pr of spec.props) {
    const f = buildFurniture(pr.kind);
    if (!f) continue;
    f.position.set(...pr.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).add(new THREE.Vector3(...pos));
    f.rotation.y = pr.rotY + rotY;
    f.updateMatrixWorld(true);
    f.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      const key = mat.uuid;
      if (!buckets.has(key)) buckets.set(key, { geo: [], mat });
      const g = m.geometry.clone();
      // запекаем мировую матрицу в геометрию — иначе мебель «развалится» при слиянии
      g.applyMatrix4(m.matrixWorld);
      buckets.get(key)!.geo.push(g);
    });
  }
  for (const { geo, mat } of buckets.values()) {
    const merged = mergeGeometries(geo, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    geo.forEach(g => g.dispose());
  }
  return b;
}
