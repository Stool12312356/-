// Постановка воксельного дома в сцену: сетка вокселей + мебель + свет у подъездов.
// Моделей зданий нет намеренно — нужен интерьер и РАЗРУШАЕМОСТЬ, монолитный GLB этого не даёт.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsClient } from '../physics/client';
import { buildVoxelHouse, type VoxelHouseModel, type VoxelHouseOpts } from './voxelgen';
import { VoxelHouse } from './voxelhouse';
import { buildFurniture } from './furniture';
import { furnish as furnishRoom } from './plan';
import { PITCH } from './voxelhouse';

export interface PlacedBuilding {
  house: VoxelHouse;
  model: VoxelHouseModel;
  /** центр дома в мире */
  center: THREE.Vector3;
  /** габариты (для поиска «в какой дом попали») */
  size: [number, number, number];
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
  const floorH = (model.size[1]) / (model.floors + 1);
  const secW = W;
  for (let s = 0; s < model.sections; s++) {
    for (let f = 0; f < model.floors; f++) {
      const y = 0.02 + f * floorH;
      const secCenterX = -model.size[0] / 2 + s * secW + secW / 2;
      for (const room of plan.rooms) {
        if (room.id === 'stairs') continue;
        for (const item of furnishRoom(room)) {
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
  furnish(model, scene, offset, rotY);

  // свет у подъезда: один источник на дом (точечные источники дорогие)
  const lamp = new THREE.PointLight('#ffd9a0', 12, 26, 2);
  lamp.position.copy(offset).add(new THREE.Vector3(0, 3.2, model.size[2] / 2 + 2.5).applyQuaternion(q));
  scene.add(lamp);

  return { house, model, center: new THREE.Vector3(offset.x, model.size[1] / 2, offset.z), size: model.size };
}
