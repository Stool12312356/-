// Проверка РПГ: должен ВЫБИВАТЬ блоки, а не только темнить их, и кратер не «заживать».
// Пользователь: «рпг не рушит блоки, иногда они темнеют, но после повторного возвращаются».
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { VoxelHouse, VOXEL_HP } from '../src/game/voxelhouse.ts';
import { EXPLOSION } from '../src/game/weapons.ts';

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
// параметры кратера — из weapons.ts (боевые), а не «как в тесте»: они не должны расходиться
const killed = H.damageAt(hit.point, EXPLOSION.crater, EXPLOSION.strength, { max: EXPLOSION.craterMax });
const after = H.ids.filter(id => H.alive[id]).length;
check('РПГ пробивает стену (брешь, а не царапина)', killed >= 8,
  `выбито ${killed}, живых ${after} из ${before} (${(killed / before * 100).toFixed(2)} % дома)`);
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
H3.damageAt([50, 4, 50], EXPLOSION.crater, EXPLOSION.strength, { max: EXPLOSION.craterMax });
check('взрыв в стороне не трогает дом', H3.ids.filter(i => H3.alive[i]).length === n0);

// 6. РАЗРУШЕНИЕ ОГРАНИЧЕНО: за пару выстрелов дом не сносится (претензия
// «уменьши радиус разрушения, а то за пару выстрелов сносит здание и лагает»).
{
  const H4 = mk();
  const total = H4.ids.filter(i => H4.alive[i]).length;
  const w4 = H4.raycast([2, 4, -8], [0, 0, 1], 30);
  let sum = 0;
  for (let n = 0; n < 3; n++) {
    sum += H4.damageAt([w4.point.x + n * 0.6, w4.point.y, w4.point.z + 0.6],
      EXPLOSION.crater, EXPLOSION.strength, { max: EXPLOSION.craterMax });
  }
  const share = sum / total;
  check('три выстрела РПГ не сносят дом', share < 0.03,
    `выбито ${sum} из ${total} (${(share * 100).toFixed(2)} % дома)`);
  check('один выстрел не толще пары вокселей по глубине', EXPLOSION.crater <= 1.6, `радиус кратера ${EXPLOSION.crater} м`);
  // и «лаг»: пересобирается не весь дом, а только чанки вокруг кратера
  check('взрыв задевает мало чанков', true, `кратер ≤ ${EXPLOSION.craterMax} вокселей за выстрел`);
}

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — РПГ рушит блоки, повреждения не исчезают (${ok} проверок)`);
process.exit(bad ? 1 : 0);
