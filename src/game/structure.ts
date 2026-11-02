// Постановка процедурного здания в сцену: воксели (стены/перекрытия) + стекло + мебель.
// Мебель собирается один раз и сливается по материалам, иначе 300 предметов = 2000 драв-коллов.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsClient } from '../physics/client';
import { buildFurniture, buildWindows, type BuildingSpec } from './buildings';
import { VoxelBuilding, type VoxelWall } from './voxel';

export interface PlacedBuilding {
  voxels: VoxelBuilding;
  spec: BuildingSpec;
  /** центр здания в мире (для поиска «какой дом рядом») */
  center: THREE.Vector3;
  /** группы мебели по секциям: при обвале секции мебель убираем */
  furniture: THREE.Object3D[];
}

export function spawnVoxelBuilding(
  spec: BuildingSpec, scene: THREE.Scene, phys: PhysicsClient,
  pos: [number, number, number], rotY = 0,
): PlacedBuilding {
  const origin = new THREE.Vector3(...pos);
  // поворот здания применяем к блокам один раз (проще, чем вращать физику)
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const walls: VoxelWall[] = spec.walls.map(w => {
    const p = new THREE.Vector3(...w.pos).applyQuaternion(q).add(origin);
    return { ...w, pos: [p.x, p.y, p.z], rotY: w.rotY + rotY };
  });
  // окна/мебель тоже
  const specWorld: BuildingSpec = {
    ...spec,
    windows: spec.windows.map(w => {
      const p = new THREE.Vector3(...w.pos).applyQuaternion(q).add(origin);
      return { ...w, pos: [p.x, p.y, p.z], rotY: w.rotY + rotY };
    }),
    props: spec.props.map(pr => {
      const p = new THREE.Vector3(...pr.pos).applyQuaternion(q).add(origin);
      return { ...pr, pos: [p.x, p.y, p.z], rotY: pr.rotY + rotY };
    }),
  };

  const voxels = new VoxelBuilding(walls, scene, phys, new THREE.Vector3(0, 0, 0));
  voxels.register();
  // окна ставим прямо в сцену: их немного и они не участвуют в разрушении
  const win = buildWindows(specWorld);
  scene.add(win);

  // мебель: сливаем по материалам
  const buckets = new Map<string, { geo: THREE.BufferGeometry[]; mat: THREE.Material }>();
  for (const pr of specWorld.props) {
    const f = buildFurniture(pr.kind);
    if (!f) continue;
    f.position.set(...pr.pos); f.rotation.y = pr.rotY;
    f.updateMatrixWorld(true);
    f.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const material = m.material as THREE.Material;
      if (!buckets.has(material.uuid)) buckets.set(material.uuid, { geo: [], mat: material });
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      buckets.get(material.uuid)!.geo.push(g);
    });
  }
  // Свет внутри: PointLight на каждую квартиру = 300 источников (нельзя).
  // Вместо этого — тёплые emissive-пятна на потолках: визуально «квартиры живые»,
  // а стоимость нулевая. Плюс общий тусклый свет внутри дома на уровне земли.
  const specW = specWorld;
  const lightGeo = new THREE.PlaneGeometry(1.1, 1.1);
  const lightMat = new THREE.MeshBasicMaterial({ color: '#ffe6b0', transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const lamps = specW.props.filter(p => p.kind === 'lamp');
  const lampInst = new THREE.InstancedMesh(lightGeo, lightMat, Math.max(1, lamps.length));
  const dm = new THREE.Object3D();
  lamps.forEach((pr, i) => {
    dm.position.set(pr.pos[0], pr.pos[1] + 0.35, pr.pos[2]);
    dm.rotation.x = Math.PI / 2;
    dm.updateMatrix(); lampInst.setMatrixAt(i, dm.matrix);
  });
  lampInst.count = lamps.length;
  lampInst.instanceMatrix.needsUpdate = true;
  lampInst.frustumCulled = false;
  scene.add(lampInst);

  const furniture: THREE.Object3D[] = [];
  for (const { geo, mat } of buckets.values()) {
    const merged = mergeGeometries(geo, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh); furniture.push(mesh);
    geo.forEach(g => g.dispose());
  }
  return { voxels, spec: specWorld, furniture, center: origin.clone().add(new THREE.Vector3(0, spec.size[1] / 2, 0)) };
}
