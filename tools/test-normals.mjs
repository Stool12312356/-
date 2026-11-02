// Проверка намотки треугольников: нормаль каждой грани должна смотреть НАРУЖУ.
// Баг, который это ловит: дом «вывернут наизнанку» — снаружи видно внутренние стенки,
// а стены кажутся дырявыми (пользователь: «здания вывернуты»).
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { VoxelHouse, PITCH } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const scene = new THREE.Scene();
const phys = { add: () => 1, removeBody() {}, post() {} };
const model = buildVoxelHouse({ kind: 'khrushchevka', sections: 1 });
const H = new VoxelHouse(model.spec, scene, phys);

let out = 0, inward = 0, degenerate = 0;
for (const c of H['chunkR'].values()) {
  const pos = c.geo.attributes.position.array, idx = c.geo.index.array;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[d] - pos[a], pos[d + 1] - pos[a + 1], pos[d + 2] - pos[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) { degenerate++; continue; }
    for (let c = 0; c < 3; c++) n[c] /= len;
    const cx = (pos[a] + pos[b] + pos[d]) / 3, cy = (pos[a + 1] + pos[b + 1] + pos[d + 1]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[d + 2]) / 3;
    // Центр грани лежит РОВНО на границе вокселя, поэтому floor() от него ненадёжен.
    // Проверяем по существу: шаг по нормали наружу должен выйти в пустоту,
    // а шаг против нормали — попасть внутрь вокселя.
    const step = PITCH * 0.5;
    const isSolid = (x, y, z) => {
      const i = Math.floor(x / PITCH), j = Math.floor(y / PITCH), k = Math.floor(z / PITCH);
      return H['idAt'](i, j, k) >= 0;
    };
    const outside = isSolid(cx + n[0] * step, cy + n[1] * step, cz + n[2] * step);
    const inside = isSolid(cx - n[0] * step, cy - n[1] * step, cz - n[2] * step);
    if (!outside && inside) out++; else inward++;
  }
}
check('все нормали смотрят наружу', inward === 0, `наружу ${out}, внутрь ${inward}, вырожденных ${degenerate}`);

// и физика тоже: та же намотка (иначе коллизия «изнутри»)
const g = H['chunkGeom'](0, 0, 0);
if (g) {
  const pos = g.verts, idx = g.idx;
  let inw = 0;
  const isSolid = (x, y, z) => H['idAt'](Math.floor(x / PITCH), Math.floor(y / PITCH), Math.floor(z / PITCH)) >= 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[d] - pos[a], pos[d + 1] - pos[a + 1], pos[d + 2] - pos[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) continue;
    for (let c = 0; c < 3; c++) n[c] /= len;
    const cx = (pos[a] + pos[b] + pos[d]) / 3, cy = (pos[a + 1] + pos[b + 1] + pos[d + 1]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[d + 2]) / 3;
    const st = PITCH * 0.5;
    const outside = isSolid(cx + n[0] * st, cy + n[1] * st, cz + n[2] * st);
    const inside = isSolid(cx - n[0] * st, cy - n[1] * st, cz - n[2] * st);
    if (outside || !inside) inw++;
  }
  check('в физике та же намотка', inw === 0, `вывернутых ${inw}`);
}

// наружная поверхность: у стены должен быть «лицом наружу» и материал не просвечивать
check('материалы домов не прозрачные (кроме стекла)', [...H['mats']].every(([k, m]) => k === 3 || !m.transparent));

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — нормали наружу, дом не вывернут (${ok} проверок)`);
process.exit(bad ? 1 : 0);
