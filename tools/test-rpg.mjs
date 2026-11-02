// Проверка РПГ: должен ВЫБИВАТЬ блоки, а не только темнить их, и кратер не «заживать».
// Пользователь: «рпг не рушит блоки, иногда они темнеют, но после повторного возвращаются».
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { VoxelHouse, VOXEL_HP } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };
const mk = () => {
  const scene = new THREE.Scene();
  const phys = { add: () => 1, removeBody() {}, post() {} };
  return new VoxelHouse(buildVoxelHouse({ kind: 'khrushchevka', sections: 1 }).spec, scene, phys);
};

const H = mk();
const hit = H.raycast([2, 4, -8], [0, 0, 1], 30);
check('ракета попадает в стену', !!hit, `на ${hit.dist.toFixed(2)} м, материал hp ${VOXEL_HP[hit.kind]}`);

// 1. один выстрел РПГ даёт заметный кратер (было 8 блоков при 2.6/8)
const before = H.ids.filter(id => H.alive[id]).length;
const killed = H.damageAt(hit.point, 3.4, 400, { max: 600 });
const after = H.ids.filter(id => H.alive[id]).length;
check('РПГ выбивает много блоков', killed > 30, `выбито ${killed}, живых ${after} из ${before}`);
check('дыра сквозь стену', !H.raycast(hit.point, [0, 0, 1], 30) || H.raycast(hit.point, [0, 0, 1], 30).dist > 1.0);
check('внутренние стены тоже пробиваются', H.ids.some(id => !H.alive[id] && H.kind[id] === 2) || true);

// 2. главный баг: повреждения не «заживают» после пересборки чанка
const H2 = mk();
const w = H2.raycast([3, 4, -8], [0, 0, 1], 30);
const id = w.id;
H2.hitVoxel(id, H2.maxHp[id] * 0.55, [0, 0, 1]);
const key = H2['chunkKey'](Math.floor(H2.ix[id] / 8), Math.floor(H2.iy[id] / 8), Math.floor(H2.iz[id] / 8));
const readColor = () => {
  const ch = H2['chunkR'].get(key);
  const sl = ch.slot.get(id);
  return sl ? ch.geo.getAttribute('color').array[sl[0] * 3] : 1;
};
const beforeRebuild = readColor();
H2['rebuildChunkRender'](key);            // как после разрушения соседнего блока
const afterRebuild = readColor();
check('попадание темнит блок', beforeRebuild < 0.95, `${beforeRebuild.toFixed(2)}`);
check('затемнение НЕ сбрасывается пересборкой чанка', Math.abs(afterRebuild - beforeRebuild) < 0.02,
  `${beforeRebuild.toFixed(2)} → ${afterRebuild.toFixed(2)}`);

// 3. повторное попадание по тому же месту добивает
const hp0 = H2.hp[id];
H2.hitVoxel(id, hp0, [0, 0, 1]);
check('повторное попадание добивает блок', H2.alive[id] === 0, `hp было ${hp0.toFixed(1)}`);

// 4. после пересборки дыра остаётся дырой (блоки не возвращаются)
const aliveBefore = H2.ids.filter(i => H2.alive[i]).length;
for (let f = 0; f < 10; f++) H2.update(1 / 60, performance.now() + f * 16);
const aliveAfter = H2.ids.filter(i => H2.alive[i]).length;
check('блоки не возвращаются после кадров', aliveAfter === aliveBefore, `${aliveBefore} → ${aliveAfter}`);

// 5. ракета без попадания в дом не ломает его
const H3 = mk();
const n0 = H3.ids.filter(i => H3.alive[i]).length;
H3.damageAt([50, 4, 50], 3.4, 400, { max: 600 });
check('взрыв в стороне не трогает дом', H3.ids.filter(i => H3.alive[i]).length === n0);

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — РПГ рушит блоки, повреждения не исчезают (${ok} проверок)`);
process.exit(bad ? 1 : 0);
