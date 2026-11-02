// Постановка воксельного дома в сцену: сетка вокселей + мебель + свет у подъездов.
// Моделей зданий нет намеренно — нужен интерьер и РАЗРУШАЕМОСТЬ, монолитный GLB этого не даёт.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsClient } from '../physics/client.ts';
import { buildStaircase, type Staircase } from './staircase.ts';
import { buildVoxelHouse, type VoxelHouseModel, type VoxelHouseOpts } from './voxelgen.ts';
import { VoxelHouse } from './voxelhouse.ts';
import { buildFurniture } from './furniture.ts';
import { furnish as furnishRoom } from './plan.ts';
import { PITCH } from './voxelhouse.ts';

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
}

/** Мебель внутри дома: ставится по квартирам, сливается по материалам в один меш на материал. */
/**
 * Мебель строго по 2D-плану (plan.ts): каждая комната получает свои предметы,
 * повёрнутые так же, как на картинке docs/plan-2k.png.
 * Геометрия сливается по материалам — иначе это сотни draw call и просадка ФПС.
 */
function furnish(model: VoxelHouseModel, scene: THREE.Scene, origin: THREE.Vector3, rotY: number) {
  const plan = model.plan;
  const W = plan.w, D = plan.d;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const buckets = new Map<string, { geo: THREE.BufferGeometry[]; mat: THREE.Material }>();
  // БАГ: высота этажа считалась как size.y/(floors+1) = 15.5/6 ≈ 2.58 м, а полы на самом
  // деле через 3.0 м (model.floorH). Мебель на верхних этажах «висела» в воздухе / тонула
  // в плите. Берём высоту этажа из модели, а пол — уровень плиты (f * floorH).
  const floorH = model.floorH;
  const secW = W;
  for (let s = 0; s < model.sections; s++) {
    for (let f = 0; f < model.floors; f++) {
      // пол этажа f — это ПЛИТА, то есть верхняя плоскость вокселя (f*floorH); мебель
      // ставим на неё с зазором 2 см
      const y = 0.02 + f * floorH;
      const secCenterX = -model.size[0] / 2 + s * secW + secW / 2;
      for (const room of plan.rooms) {
        if (room.id === 'stairs') continue;
        for (const item of furnishRoom(room, plan)) {
          const p = new THREE.Vector3(secCenterX + item.x, y, item.z).applyQuaternion(q).add(origin);
          const g = buildFurniture(item.kind);
          if (!g) continue;
          g.position.copy(p);
          // на плане поворот задан вокруг вертикали; в мире добавляем поворот дома
          g.rotation.y = item.rot;
          g.updateMatrixWorld(true);
          g.traverse(o => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const mat = m.material as THREE.Material;
            const key = `${mat.uuid}|${(mat as THREE.MeshStandardMaterial).color?.getHexString?.() ?? 'x'}`;
            const list = buckets.get(key) ?? { geo: [], mat };
            const geo = m.geometry.clone();
            geo.applyMatrix4(m.matrixWorld);
            list.geo.push(geo);
            buckets.set(key, list);
          });
        }
      }
    }
  }
  for (const { geo, mat } of buckets.values()) {
    if (!geo.length) continue;
    const merged = mergeGeometries(geo, false) ?? geo[0];
    const mesh = new THREE.Mesh(merged, mat);
    // имя — чтобы тесты и отладка могли отличить мебель от чанков дома
    mesh.name = 'furniture';
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  void D;
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
    scene.add(st.mesh);
    phys.add({
      kind: 'static',
      shapes: [{ t: 'trimesh', verts: st.verts, idx: st.idx }],
      pos: [0, 0, 0], quat: [0, 0, 0, 1], surface: 'concrete',
    } as never);
    stairs.push(st);
  }
  const stair = stairs[0];

  furnish(model, scene, offset, rotY);

  // свет у подъезда: один источник на дом (точечные источники дорогие)
  const lamp = new THREE.PointLight('#ffd9a0', 12, 26, 2);
  lamp.position.copy(offset).add(new THREE.Vector3(0, 3.2, model.size[2] / 2 + 2.5).applyQuaternion(q));
  scene.add(lamp);

  return { house, model, stairs, stair, center: new THREE.Vector3(offset.x, model.size[1] / 2, offset.z), size: model.size };
}
