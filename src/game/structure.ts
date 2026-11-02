// Постановка дома в сцену: панели + мебель + свет. Моделей зданий нет намеренно —
// нужен интерьер и разрушаемость, монолитный GLB этого не даёт.
import * as THREE from 'three';
import type { PhysicsClient } from '../physics/client';
import type { HouseSpec } from './house';
import { HousePanels } from './voxel';
import { buildFurniture } from './furniture';

export interface PlacedBuilding {
  panels: HousePanels;
  spec: HouseSpec;
  /** центр дома в мире */
  center: THREE.Vector3;
}

export function spawnHouse(
  spec: HouseSpec, scene: THREE.Scene, phys: PhysicsClient,
  pos: [number, number, number], rotY = 0,
): PlacedBuilding {
  const origin = new THREE.Vector3(...pos);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  // поворот здания применяем к панелям и мебели один раз (физику вращать не нужно)
  const panels = spec.panels.map(p => {
    const v = new THREE.Vector3(...p.pos).applyQuaternion(q).add(origin);
    return { ...p, pos: [v.x, v.y, v.z] as [number, number, number], rotY: p.rotY + rotY };
  });
  const props = spec.props.map(pr => {
    const v = new THREE.Vector3(...pr.pos).applyQuaternion(q).add(origin);
    return { ...pr, pos: [v.x, v.y, v.z] as [number, number, number], rotY: pr.rotY + rotY };
  });

  const hp = new HousePanels(panels, scene, phys);
  hp.register();

  // мебель: сливаем по материалам — вместо 250 объектов один меш на материал
  const buckets = new Map<string, { geo: THREE.BufferGeometry[]; mat: THREE.Material }>();
  for (const pr of props) {
    const f = buildFurniture(pr.kind);
    if (!f) continue;
    f.position.set(pr.pos[0], pr.pos[1], pr.pos[2]);
    f.rotation.y = pr.rotY;
    f.updateMatrixWorld(true);
    f.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      const key = `${mat.uuid}|${(mat as THREE.MeshStandardMaterial).color?.getHexString?.() ?? 'x'}`;
      const list = buckets.get(key) ?? { geo: [], mat };
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      list.geo.push(g);
      buckets.set(key, list);
    });
  }
  for (const { geo, mat } of buckets.values()) {
    if (!geo.length) continue;
    const mesh = new THREE.Mesh(mergeAll(geo), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // тёплый свет у подъездов: два источника на дом, не больше (точечные источники дорогие)
  const mid = origin.clone().add(new THREE.Vector3(0, 4, spec.size[2] / 2 + 3.5).applyQuaternion(q));
  const lamp = new THREE.PointLight('#ffd9a0', 10, 24, 2);
  lamp.position.copy(mid);
  scene.add(lamp);

  return { panels: hp, spec, center: origin.clone().add(new THREE.Vector3(0, spec.size[1] / 2, 0)) };
}

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function mergeAll(list: THREE.BufferGeometry[]) {
  return mergeGeometries(list, false) ?? list[0];
}
