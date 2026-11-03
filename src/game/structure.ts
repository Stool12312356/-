// Постановка воксельного дома в сцену: сетка вокселей + мебель + свет у подъездов.
// Моделей зданий нет намеренно — нужен интерьер и РАЗРУШАЕМОСТЬ, монолитный GLB этого не даёт.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsClient } from '../physics/client.ts';
import { buildStaircase, type Staircase } from './staircase.ts';
import { buildVoxelHouse, type VoxelHouseModel, type VoxelHouseOpts } from './voxelgen.ts';
import { buildSpecial, stairPlan, type SpecialKind, type SpecialPlan } from './barracks.ts';
import { VoxelHouse } from './voxelhouse.ts';
import { buildFurniture } from './furniture.ts';
import { furnish as furnishRoom } from './plan.ts';
import { PITCH } from './voxelhouse.ts';
import { Props, partKindOf, type PropItem } from './props.ts';

export interface PlacedBuilding {
  house: VoxelHouse;
  model: VoxelHouseModel;
  /** центр дома в мире */
  center: THREE.Vector3;
  /** габариты (для поиска «в какой дом попали») */
  size: [number, number, number];
  /** лестницы всех подъездов (проходимые, не воксельные) — по одной на секцию */
  stairs: Staircase[];
  /** лестница первого подъезда (для отладки/тестов) */
  stair: Staircase;
  /** разрушаемые предметы этого дома: мебель и лестницы (см. props.ts) */
  props: PropItem[];
  /** владелец предметов: через него наносится урон (props.ts) */
  propSet: Props;
  /** колбэк «предмет сломан» — обломки и огонь ставит main.ts */
  propBreak?: PropBreakHandler;
}

/**
 * ОБЩИЕ ВЕЩИ ДЛЯ ОСОБЫХ ЗДАНИЙ (казарма, военторг).
 * Ключ пачки мебели: дом/тип + секция + этаж + материал → один меш и одно тело на материал.
 */
function furnishSpecial(
  sp: SpecialPlan, scene: THREE.Scene, origin: THREE.Vector3, rotY: number, props: Props,
): PropItem[] {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const plan = { w: sp.w, d: sp.d, rooms: sp.rooms, walls: [], windows: [], entrance: sp.entrance,
    stairs: sp.stairWell ?? { x0: 0, x1: 0, z0: 0, z1: 0 } };
  const out: PropItem[] = [];
  let family = 0;
  for (let f = 0; f < sp.floors; f++) {
    const y = 0.02 + f * sp.floorH;
    for (const room of sp.rooms) {
      if (room.id === 'stairs') continue;
      for (const item of furnishRoom(room, plan)) {
        const p = new THREE.Vector3(item.x, y, item.z).applyQuaternion(q).add(origin);
        const g = buildFurniture(item.kind);
        if (!g) continue;
        g.position.copy(p);
        g.rotation.y = item.rot;
        g.updateMatrixWorld(true);
        const fam = ++family;
        g.traverse(o => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mat = m.material as THREE.Material;
          const geo = m.geometry.clone();
          geo.applyMatrix4(m.matrixWorld);
          const rec = props.add({
            type: 'furniture', kind: item.kind, geos: [geo], material: mat,
            bucketKey: `f:${sp.kind}:0:${f}:${mat.uuid}`,
            surface: (mat as THREE.MeshStandardMaterial).metalness > 0.45 ? 'metal' : 'wood',
            kindMat: partKindOf(mat), family: fam,
          });
          if (rec) out.push(rec);
        });
      }
    }
  }
  void scene;
  return out;
}

/**
 * Постановка особого здания (казарма / военторг): та же сетка вокселей и та же физика,
 * что у жилых домов, поэтому разрушается оно ровно так же — кусками.
 */
export function spawnSpecial(
  kind: SpecialKind, sections: number, scene: THREE.Scene, phys: PhysicsClient,
  pos: [number, number, number], rotY = 0, heightAt?: (x: number, z: number) => number,
): PlacedBuilding {
  const m = buildSpecial(kind, sections);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const offset = new THREE.Vector3(...pos);
  const grid = m.spec;
  if (rotY !== 0) {
    const cells = grid.cells;
    const { nx, ny, nz } = grid;
    const out = new Int8Array(cells.length).fill(-1);
    const secOut = new Uint8Array(cells.length);
    const bearOut = new Uint8Array(cells.length);
    const quarters = Math.round(rotY / (Math.PI / 2)) % 4;
    const nnx = quarters % 2 === 0 ? nx : nz;
    const nnz = quarters % 2 === 0 ? nz : nx;
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = (j * nz + k) * nx + i;
      if (cells[c] < 0) continue;
      let ni = i, nk = k;
      if (quarters === 1) { ni = nz - 1 - k; nk = i; }
      else if (quarters === 2) { ni = nx - 1 - i; nk = nz - 1 - k; }
      else if (quarters === 3) { ni = k; nk = nx - 1 - i; }
      const nc = (j * nnz + nk) * nnx + ni;
      out[nc] = cells[c]; secOut[nc] = grid.sectionOf[c]; bearOut[nc] = grid.bearing[c];
    }
    grid.nx = nnx; grid.nz = nnz; grid.cells = out; grid.sectionOf = secOut; grid.bearing = bearOut;
    m.size[0] = nnx * PITCH; m.size[2] = nnz * PITCH;
  }
  grid.ox = offset.x - (grid.nx * PITCH) / 2;
  grid.oy = offset.y;
  grid.oz = offset.z - (grid.nz * PITCH) / 2;

  const house = new VoxelHouse(grid, scene, phys);
  if (heightAt) house.setHeightFn(heightAt);

  const props = new Props(phys);
  const propItems: PropItem[] = [];
  const stairs: Staircase[] = [];
  for (let s = 0; s < sections; s++) {
    if (!m.plan.stairWell) break;
    const secCx = (s - (sections - 1) / 2) * m.plan.w;
    const origin = new THREE.Vector3(offset.x + secCx, offset.y, offset.z);
    const st = buildStaircase(stairPlan(m.plan), m.floors, m.floorH, origin);
    if (rotY !== 0) {
      const v = new THREE.Vector3();
      for (let i = 0; i < st.verts.length; i += 3) {
        v.set(st.verts[i] - offset.x, st.verts[i + 1] - offset.y, st.verts[i + 2] - offset.z).applyQuaternion(q);
        st.verts[i] = v.x + offset.x; st.verts[i + 1] = v.y + offset.y; st.verts[i + 2] = v.z + offset.z;
      }
    }
    scene.remove(st.mesh);
    destroyableStairs(st, `s:${kind}:${s}`, props, propItems);
    stairs.push(st);
  }
  propItems.push(...furnishSpecial(m.plan, scene, offset, rotY, props));
  props.build(scene);

  const placed: PlacedBuilding = {
    house, model: m as unknown as VoxelHouseModel, stairs, stair: stairs[0],
    props: propItems, propSet: props,
    center: new THREE.Vector3(offset.x, m.size[1] / 2, offset.z), size: m.size,
  };
  props.onBreak = (item, at) => {
    placed.propBreak?.(placed, item.type as 'furniture' | 'stairs', item.kind, at);
  };
  return placed;
}

/** Что происходит, когда предмет сломан: обломки, пыль, огонь. Ставит main.ts. */
export type PropBreakHandler = (b: PlacedBuilding, type: 'furniture' | 'stairs', kind: string,
  at: [number, number, number]) => void;

/**
 * Мебель внутри дома: ставится по 2D-плану (plan.ts) и сразу превращается в
 * РАЗРУШАЕМЫЕ предметы (props.ts).
 *
 * Раньше вся мебель сливалась в один меш на материал — дешёво, но её нельзя было
 * ни разрушить, ни толкнуть: пуля проходила сквозь стул. Теперь каждый предмет —
 * отдельная запись в Props со своей прочностью, а геометрия по-прежнему слита
 * пачками (дом × этаж × материал), так что draw call почти не вырос.
 */
function furnish(
  model: VoxelHouseModel, scene: THREE.Scene, origin: THREE.Vector3, rotY: number, props: Props,
): PropItem[] {
  const plan = model.plan;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const floorH = model.floorH;
  const secW = plan.w;
  const out: PropItem[] = [];
  let family = 0;
  for (let s = 0; s < model.sections; s++) {
    for (let f = 0; f < model.floors; f++) {
      // пол этажа f — верхняя плоскость плиты (f * floorH); мебель с зазором 2 см
      const y = 0.02 + f * floorH;
      const secCenterX = -model.size[0] / 2 + s * secW + secW / 2;
      for (const room of plan.rooms) {
        if (room.id === 'stairs') continue;
        for (const item of furnishRoom(room, plan)) {
          const p = new THREE.Vector3(secCenterX + item.x, y, item.z).applyQuaternion(q).add(origin);
          const g = buildFurniture(item.kind);
          if (!g) continue;
          g.position.copy(p);
          g.rotation.y = item.rot;
          g.updateMatrixWorld(true);
          // один предмет мебели = одна «семья»: собран из разных материалов
          // (дерево + металл + ткань), поэтому ломается целиком
          const fam = ++family;
          g.traverse(o => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const mat = m.material as THREE.Material;
            const geo = m.geometry.clone();
            geo.applyMatrix4(m.matrixWorld);
            const rec = props.add({
              type: 'furniture', kind: item.kind, geos: [geo], material: mat,
              // пачка: дом-этаж-материал → одна физика и один меш на материал
              bucketKey: `f:${model.kind}:${s}:${f}:${mat.uuid}`,
              surface: (mat as THREE.MeshStandardMaterial).metalness > 0.45 ? 'metal' : 'wood',
              kindMat: partKindOf(mat), family: fam,
            });
            if (rec) out.push(rec);
          });
        }
      }
    }
  }
  void scene;
  return out;
}

/**
 * Лестница как разрушаемый объект: каждая ступень и площадка — отдельный предмет.
 * Площадки помечены как опорные (см. props.ts: снёс площадку — рассыпался марш).
 */
/** Материал лестницы — тот же, что у видимого меша (иначе пачка не совпадёт по цвету). */
const stoneMat = new THREE.MeshStandardMaterial({ color: '#b9b4a8', roughness: 0.92, metalness: 0.02 });

function destroyableStairs(st: Staircase, bucketKey: string, props: Props, out: PropItem[]) {
  for (const part of st.parts) {
    const rec = props.add({
      type: 'stairs', kind: part.kind, geos: [part.geo], material: stoneMat,
      bucketKey, surface: 'concrete', kindMat: 'stone',
      hpScale: part.kind === 'landing' ? 2.2 : 1,
    });
    if (rec) out.push(rec);
  }
}

export function spawnVoxelHouse(
  opts: VoxelHouseOpts, scene: THREE.Scene, phys: PhysicsClient,
  pos: [number, number, number], rotY = 0,
  heightAt?: (x: number, z: number) => number,
): PlacedBuilding {
  const model = buildVoxelHouse(opts);
  // сетка строится от 0; сдвигаем её в нужную точку
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const offset = new THREE.Vector3(...pos);
  const grid = model.spec;
  // поворот применяем к координатам сетки: дом может стоять «лицом» в любую сторону
  if (rotY !== 0) {
    const cells = grid.cells;
    const nx = grid.nx, ny = grid.ny, nz = grid.nz;
    const out = new Int8Array(cells.length).fill(-1);
    const secOut = new Uint8Array(cells.length);
    const bearOut = new Uint8Array(cells.length);
    // поворот на 90/180/270: пересчитываем размеры
    const quarters = Math.round(rotY / (Math.PI / 2)) % 4;
    const nnx = quarters % 2 === 0 ? nx : nz;
    const nnz = quarters % 2 === 0 ? nz : nx;
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = (j * nz + k) * nx + i;
      if (cells[c] < 0) continue;
      let ni = i, nk = k;
      if (quarters === 1) { ni = nz - 1 - k; nk = i; }
      else if (quarters === 2) { ni = nx - 1 - i; nk = nz - 1 - k; }
      else if (quarters === 3) { ni = k; nk = nx - 1 - i; }
      const nc = (j * nnz + nk) * nnx + ni;
      out[nc] = cells[c];
      secOut[nc] = grid.sectionOf[c];
      bearOut[nc] = grid.bearing[c];
    }
    grid.nx = nnx; grid.nz = nnz; grid.cells = out; grid.sectionOf = secOut; grid.bearing = bearOut;
    model.size[0] = nnx * PITCH; model.size[2] = nnz * PITCH;
  }
  grid.ox = offset.x - (grid.nx * PITCH) / 2;
  grid.oy = offset.y;
  grid.oz = offset.z - (grid.nz * PITCH) / 2;

  const house = new VoxelHouse(grid, scene, phys);
  if (heightAt) house.setHeightFn(heightAt);

  // ---- настоящие лестницы во ВСЕХ подъездах (см. staircase.ts) ----
  // Воксельная «змейка» была непроходимой: ступень 0.5 м при autostep 0.4 м.
  // БАГ: лестница строилась одна на весь дом. У 3-секционной хрущёвки три подъезда и
  // три лестничных клетки, а марши были только в первой; из остальных подъездов наверх
  // попасть было нельзя.
  const props = new Props(phys);
  const propItems: PropItem[] = [];
  const stairs: Staircase[] = [];
  for (let s = 0; s < model.sections; s++) {
    const secCx = (s - (model.sections - 1) / 2) * model.plan.w;
    const origin = new THREE.Vector3(offset.x + secCx, offset.y, offset.z);
    const st = buildStaircase(model.plan, model.floors, model.floorH, origin);
    if (rotY !== 0) {
      st.mesh.rotation.y = rotY;
      // физика: те же вершины, повёрнутые вокруг центра дома
      const v = new THREE.Vector3();
      for (let i = 0; i < st.verts.length; i += 3) {
        v.set(st.verts[i] - offset.x, st.verts[i + 1] - offset.y, st.verts[i + 2] - offset.z).applyQuaternion(q);
        st.verts[i] = v.x + offset.x; st.verts[i + 1] = v.y + offset.y; st.verts[i + 2] = v.z + offset.z;
      }
    }
    // ВАЖНО: отдельное статичное тело на всю лестницу больше не создаём — её
    // ступени и площадки теперь разрушаемые предметы (props.ts), и физика собирается
    // из них. Иначе после разрушения марша по нему всё равно можно было бы ходить.
    scene.remove(st.mesh);
    destroyableStairs(st, `s:${model.kind}:${s}`, props, propItems);
    stairs.push(st);
  }
  const stair = stairs[0];

  const furniture = furnish(model, scene, offset, rotY, props);
  propItems.push(...furniture);
  // тела физики и меши — пачками
  props.build(scene);
  // Обломки от сломанной мебели/ступеней (п.1): то же самое, что летит из стен.
  // Без этого разбитый стул просто исчезал — «испарился», а не разлетелся.
  props.onBreak = (item, at) => {
    placed.propBreak?.(placed, item.type as 'furniture' | 'stairs', item.kind, at);
  };

  // свет у подъезда: один источник на дом (точечные источники дорогие)
  const lamp = new THREE.PointLight('#ffd9a0', 12, 26, 2);
  lamp.position.copy(offset).add(new THREE.Vector3(0, 3.2, model.size[2] / 2 + 2.5).applyQuaternion(q));
  scene.add(lamp);

  const placed: PlacedBuilding = {
    house, model, stairs, stair, props: propItems, propSet: props,
    center: new THREE.Vector3(offset.x, model.size[1] / 2, offset.z), size: model.size,
  };
  return placed;
}
