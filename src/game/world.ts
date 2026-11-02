// РАССТАНОВКА МИРА (M7): где стоят дома и где появляется игрок.
//
// Почему отдельный модуль: раньше и то и другое было захардкожено в main.ts, и спавн
// оказался в 190 м от ближайшего дома — «подхожу к зданию, а внутрь не зайти» начиналось
// уже с дороги. Теперь точка спавна ВЫЧИСЛЯЕТСЯ из плана первого дома (прямо перед его
// дверью), а тест tools/test-walk.mjs проверяет, что она стоит там, где надо.
import { buildVoxelHouse } from './voxelgen.ts';

export interface BuildingDef {
  kind: 'khrushchevka' | 'brezhnevka';
  /** центр дома в мире */
  pos: [number, number, number];
  rotY: number;
  sections: number;
}

export const BUILDINGS: BuildingDef[] = [
  { kind: 'khrushchevka', pos: [-72, 0, -86], rotY: 0, sections: 3 },
  { kind: 'brezhnevka', pos: [-20, 0, -105], rotY: 0, sections: 2 },
  { kind: 'khrushchevka', pos: [30, 0, -112], rotY: Math.PI, sections: 3 },
];

/** Расстояние от спавна до двери первого дома, м. */
export const SPAWN_AWAY = 4.5;

/**
 * Точка появления игрока — перед входом в первый дом, лицом к двери.
 * Считается из плана: центр первой секции + координата двери из plan.entrance.
 */
export function spawnPoint(def: BuildingDef = BUILDINGS[0]): [number, number, number] {
  const model = buildVoxelHouse({ kind: def.kind, sections: def.sections });
  // центр первой секции: дом центрирован, секция шириной plan.w
  const secCx = def.pos[0] - (model.size[0] / 2) + model.plan.w / 2;
  const cx = secCx + model.plan.entrance.x;
  // фасад дома при rotY = 0 обращён в −Z
  const cz = def.pos[2] + model.plan.entrance.z;
  // фасад обращён наружу по локальной −Z; после поворота дома на rotY нормаль
  // фасада в мире = (−sin rotY, 0, −cos rotY). Спавн — вдоль неё от двери.
  const nz = -Math.cos(def.rotY), nx = -Math.sin(def.rotY);
  return [cx + nx * SPAWN_AWAY, 1.0, cz + nz * SPAWN_AWAY];
}

export const SPAWN: [number, number, number] = spawnPoint();
