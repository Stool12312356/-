// ЗЕМЛЯ БОЕВОЙ КАРТЫ (без выставки).
//
// `polygon.ts` — это музей: ряды техники, стол с оружием, рампы, башня. Он нужен
// полигону и НЕ должен стоять на играбельных картах. Но террейн (снег, холмы, физика
// земли) нужен всем — поэтому он вынесен сюда, в отдельный маленький модуль.
//
// Раньше землю создавал только buildPolygon(), и убрать выставку с карты было нельзя,
// не оставив игрока в пустоте без пола.
import * as THREE from 'three';
import type { PhysicsClient } from '../physics/client.ts';
import { buildTerrain } from './terrain.ts';

export function buildGround(scene: THREE.Scene, phys: PhysicsClient) {
  const t = buildTerrain();
  scene.add(t.mesh);
  phys.add({ kind: 'static', pos: [0, 0, 0], friction: 0.9, shapes: [{ t: 'trimesh', verts: t.verts, idx: t.idx }] });
  return t;
}
