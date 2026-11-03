// Бюджет производительности: сколько стоит кадр с домами и разрушением (без браузера).
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { VoxelHouse } from '../src/game/voxelhouse.ts';

const scene = new THREE.Scene();
let seq = 1; const bodies = new Map();
const phys = { add(d) { const id = seq++; bodies.set(id, d); return id; }, removeBody(id) { bodies.delete(id); }, post() {} };

const houses = [];
for (const [kind, sections, pos] of [['khrushchevka', 3, [0, 0, 0]], ['brezhnevka', 2, [80, 0, 0]], ['khrushchevka', 2, [0, 0, 80]]]) {
  const model = buildVoxelHouse({ kind, sections });
  model.spec.ox = pos[0]; model.spec.oz = pos[2];
  const t0 = performance.now();
  houses.push(new VoxelHouse(model.spec, scene, phys));
  console.log(`дом ${kind}×${sections}: сборка ${(performance.now() - t0).toFixed(0)} мс, вокселей ${model.stats.voxels}`);
}
let tris = 0, draws = 0;
scene.traverse(o => { const m = o; if (m.isMesh) { draws++; tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; } });
console.log(`всего: мешей ${draws}, тр. ${(tris / 1000).toFixed(0)}k, уник. геометрий ${new Set(houses.flatMap(h => [...h['chunkR'].values()].map(c => c.geo.uuid))).size}`);

// залп: 12 РПГ по разным местам
const t1 = performance.now();
for (let n = 0; n < 12; n++) {
  const h = houses[n % 3];
  const x = h.ox + Math.random() * h.nx * 0.5, y = 1 + Math.random() * h.ny * 0.5, z = h.oz + Math.random() * h.nz * 0.5;
  const hit = h.raycast([x, y, z + 40], [0, 0, -1], 60);
  if (hit) h.damageAt(hit.point, 2.2, 40, { max: 200 });
}
console.log(`12 взрывов: ${(performance.now() - t1).toFixed(0)} мс`);

// 120 кадров с обновлением (включая пересборку чанков)
const t2 = performance.now();
let worst = 0;
for (let f = 0; f < 120; f++) {
  const f0 = performance.now();
  for (const h of houses) h.update(1 / 60, performance.now() + f * 16.7);
  worst = Math.max(worst, performance.now() - f0);
}
const avg = (performance.now() - t2) / 120;
console.log(`120 кадров: среднее ${avg.toFixed(2)} мс/кадр, худший ${worst.toFixed(1)} мс → ${(1000 / Math.max(avg, 0.01)).toFixed(0)} ФПС по логике`);
const alive = houses.reduce((n, h) => n + h.ids.filter(id => h.alive[id]).length, 0);
console.log(`живых вокселей осталось ${alive}, тел в физике ${bodies.size}, обломков ${houses.reduce((n, h) => n + h.debrisLive, 0)}`);
