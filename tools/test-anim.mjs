// АНИМАЦИЯ ХОДЬБЫ НА РЕАЛЬНОЙ МОДЕЛИ: берём soldier.glb из public/assets/game,
// находим в нём кости и проверяем, что процедурная ходьба их действительно двигает.
//
// Это важный тест: имена костей в скелете Sketchfab — транслит («Grp_Dui_l_64»),
// и при пересборке ассетов они легко меняются. Если имена поменяются, анимация
// молча перестанет работать — тест это поймает.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { WalkAnim } from '../src/game/anim.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

// GLB в JSON-часть: читаем скелет напрямую, без GLTFLoader (он тянет DOM)
const glb = readFileSync('public/assets/game/soldier.glb');
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.slice(20, 20 + jsonLen).toString('utf8'));
const names = json.nodes.map(n => n.name);

check('в модели есть скелет (узлы Grp_*)', names.filter(n => /^Grp_/.test(n)).length > 20,
  `${names.filter(n => /^Grp_/.test(n)).length} узлов`);
check('в модели НЕТ готовых клипов (поэтому анимация процедурная)', (json.animations ?? []).length === 0);

// собираем «скелет» из Object3D с теми же именами — так же, как его увидит WalkAnim
const root = new THREE.Group();
for (const n of names) {
  const o = new THREE.Object3D();
  o.name = n;
  root.add(o);
}
const anim = new WalkAnim(root);
const found = anim.jointNames();
check('WalkAnim нашёл кости ног и рук', anim.ok && found.length >= 8, found.join(', '));
check('кости ног найдены поимённо',
  found.includes('thighL') && found.includes('thighR') && found.includes('shinL') && found.includes('shinR'));
check('кости рук найдены', found.includes('armL') && found.includes('armR'));
check('голова и корпус найдены', found.includes('head') && found.includes('chest'));

// стоя: кости не дёргаются
{
  const before = anim.joints.thighL.rotation.x;
  for (let i = 0; i < 30; i++) anim.update(1 / 60, 0);
  check('стоя ноги не машут', Math.abs(anim.joints.thighL.rotation.x - before) < 0.02,
    `Δ ${(anim.joints.thighL.rotation.x - before).toFixed(3)}`);
}

// идём: бёдра ходят в противофазе
{
  let maxL = 0, maxR = 0, opposite = true;
  for (let i = 0; i < 120; i++) {
    anim.update(1 / 60, 3.1);
    const l = anim.joints.thighL.rotation.x, r = anim.joints.thighR.rotation.x;
    maxL = Math.max(maxL, Math.abs(l)); maxR = Math.max(maxR, Math.abs(r));
    if (Math.abs(l + r) > 1e-6) opposite = false;
  }
  check('при ходьбе бёдра качаются', maxL > 0.2 && maxR > 0.2, `амплитуда ${maxL.toFixed(2)}`);
  check('левая и правая нога в противофазе', opposite);
}

// колени сгибаются (не «деревянные палки»)
{
  let maxKnee = 0;
  for (let i = 0; i < 120; i++) { anim.update(1 / 60, 3.1); maxKnee = Math.max(maxKnee, anim.joints.shinL.rotation.x); }
  check('колени сгибаются', maxKnee > 0.3, `сгиб ${maxKnee.toFixed(2)} рад`);
}

// руки в противофазе ногам (левая рука с правой ногой)
{
  let wrongPhase = 0;
  for (let i = 0; i < 120; i++) {
    anim.update(1 / 60, 3.1);
    const leg = anim.joints.thighL.rotation.x, arm = anim.joints.armL.rotation.x;
    if (Math.sign(leg) === Math.sign(arm) && Math.abs(leg) > 0.05) wrongPhase++;
  }
  check('руки в противофазе ногам', wrongPhase < 12, `${wrongPhase} кадров из 120 в фазе`);
}

// корпус поворачивается к цели
{
  anim.update(0.3, 3.1, 0.8);
  const chestY = anim.joints.chest.rotation.y;
  check('корпус доворачивается к цели', Math.abs(chestY) > 0.2, `y=${chestY.toFixed(2)}`);
}

// reset возвращает базовую позу
{
  anim.reset();
  const anyMoved = Math.abs(anim.joints.thighL.rotation.x) > 1e-6;
  check('reset возвращает позу', !anyMoved);
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — анимация ходьбы (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
