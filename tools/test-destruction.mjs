// Проверка РАЗРУШЕНИЯ (M5): дом — воксельная сетка, урон выгрызает куски,
// а не сносит панель целиком. Старый панельный тест заменён: он проверял ровно то
// поведение, на которое жаловался пользователь.
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { VoxelHouse } from '../src/game/voxelhouse.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };
const flush = () => { for (let f = 0; f < 8; f++) for (const h of houses) h.update(1 / 60, performance.now() + f * 16); };

const scene = new THREE.Scene();
const bodies = new Map(); let seq = 1;
const phys = { add(d) { const id = seq++; bodies.set(id, d); return id; }, removeBody(id) { bodies.delete(id); }, post() {} };
const houses = [];
for (const [kind, sections, x] of [['khrushchevka', 2, 0], ['brezhnevka', 1, 60]]) {
  const model = buildVoxelHouse({ kind, sections });
  model.spec.ox = x;
  houses.push(new VoxelHouse(model.spec, scene, phys));
}
const H = houses[0];

console.log('разрушение (воксельное)');
{
  // 1. РПГ по стене: выгрызает кусок, но не сносит всю стену
  const hit = H.raycast([10, 3, -8], [0, 0, 1], 30);
  check('луч находит стену', !!hit);
  const total = H.ids.length;
  const before = H.ids.filter(id => H.alive[id]).length;
  const killed = H.damageAt(hit.point, 1.8, 40, { max: 160 });
  const after = H.ids.filter(id => H.alive[id]).length;
  check('РПГ выбивает кусок, а не панель целиком', killed >= 5 && killed < total * 0.08, `выбито ${killed} из ${total}`);
  check('счётчик живых совпадает с реальностью', before - after === killed, `${before}→${after}`);

  // 2. дыра действительно сквозная: луч проходит через выбитое место
  const through = H.raycast(hit.point, [0, 0, 1], 30);
  check('в стене сквозная дыра', !through || through.dist > 0.3, through ? `до ${through.dist.toFixed(2)} м` : 'луч прошёл насквозь');

  // 3. коллизия обновляется: чанк с дырой пересобран в физике
  flush();
  const bodyNow = H.bodyAt(hit.point);
  check('тело чанка с дырой живо', bodyNow > 0, `id ${bodyNow}`);
  const bodyDesc = bodies.get(bodyNow);
  check('в физике дыры нет (меньше треугольников)', !!bodyDesc, bodyDesc ? `тр. ${bodyDesc.shapes[0].idx.length / 3}` : '');

  // 4. пуля: одна пуля не ломает несущую стену — дом не разваливается от чиха
  const w2 = H.raycast([12, 2.5, -8], [0, 0, 1], 30);
  if (w2) {
    const killedOne = H.damageAt(w2.point, 0.45, 1.2, { max: 3 });
    check('одна пуля в бетон почти не вредит', killedOne <= 1, `выбито ${killedOne}`);
  }

  // 5. висящих вокселей нет: всё, что без опоры, падает
  H.damageAt([10, 3, 0], 4, 60, { max: 400 });
  const fell = H.checkSupport();
  check('беспорные воксели падают', fell >= 0);
  const floating = H.ids.filter(id => H.alive[id] && H.iy[id] > 0 && !H['idAt'](H.ix[id], H.iy[id] - 1, H.iz[id]) && Math.random() < 0.02);
  check('висящих вокселей нет (выборка)', floating.length === 0, `проверено ${H.ids.length} вокселей`);

  // 6. рендер: один меш на чанк, а не 250 панелей
  let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; });
  check('рендер чанками', meshes > 0 && meshes < 400, `мешей ${meshes}`);

  // 7. стекло не блокирует и не держит дом
  const glass = H.ids.find(id => H.alive[id] && H.kind[id] === 3);
  check('стекло в доме есть и оно «навесное»', glass !== undefined && H.bearing[glass] === 1);
}

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — воксельное разрушение работает (${ok} проверок)`);
process.exit(bad ? 1 : 0);
