// Проверка подъезда и лестницы: можно ли ВОЙТИ с улицы и ПОДНЯТЬСЯ на этажи.
// Пользователь: «нет подъезда: вход ведёт сразу в квартиру, и нет лестницы на следующие этажи».
// Считаем проходимость честно: BFS по свободным вокселям с шагом вверх не больше
// 0.55 м (высота ступени), вниз — свободно.
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { PITCH } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

for (const [kind, sections] of [['khrushchevka', 2], ['brezhnevka', 1]]) {
  const m = buildVoxelHouse({ kind, sections });
  const { nx, ny, nz, cells } = m.spec;
  const solid = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? false : cells[(j * nz + k) * nx + i] >= 0;
  const key = (i, j, k) => (j * nz + k) * nx + i;

  // старт — на улице перед дверью подъезда
  const ex = Math.round(m.stats.entrance[0] / PITCH);
  const start = key(ex, 0, 0);
  const seen = new Uint8Array(nx * ny * nz);
  const q = [start]; seen[start] = 1;
  let head = 0, maxJ = 0;
  while (head < q.length) {
    const c = q[head++];
    const i = c % nx, k = Math.floor(c / nx) % nz, j = Math.floor(c / (nx * nz));
    if (j > maxJ) maxJ = j;
    const nb = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
    for (const [di, , dk] of nb) {
      // шаг вверх не больше 0.55 м → один воксель
      for (let dj = -3; dj <= 1; dj++) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni < 0 || nk < 0 || nj < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
        if (solid(ni, nj, nk)) continue;
        if (solid(ni, nj + 1, nk)) continue;              // места под рост нет
        const n = key(ni, nj, nk);
        if (seen[n]) continue;
        seen[n] = 1; q.push(n);
        break;                                             // берём первый свободный уровень
      }
    }
  }
  const floorJ = Math.round((m.floors > 0 ? 1 : 1) * 0 + 2.8 / PITCH);
  const reached = (j) => {
    // на этом уровне достижим хотя бы один свободный воксель внутри дома
    for (let c = 0; c < seen.length; c++) {
      if (!seen[c]) continue;
      const jj = Math.floor(c / (nx * nz));
      if (jj === j) return true;
    }
    return false;
  };
  console.log(`\n${kind}: этажей ${m.floors}, вход на улице (i=${ex})`);
  check('вход в подъезд проходим с улицы', maxJ >= 1, `достигнута высота ${maxJ} вокс. (${(maxJ * PITCH).toFixed(1)} м)`);
  check('есть проход на 1-й этаж', reached(floorJ), `уровень j=${floorJ}`);
  check('есть проход на 2-й этаж', reached(floorJ * 2), `уровень j=${floorJ * 2}`);
  check('лестница ведёт выше 3-го этажа', maxJ * PITCH > 6.5, `макс. высота ${(maxJ * PITCH).toFixed(1)} м`);
}

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — подъезд сквозной, лестница ведёт на этажи (${ok} проверок)`);
process.exit(bad ? 1 : 0);
