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

// --- ПРОВЕРКА НА РЕАЛЬНЫХ МОДЕЛЯХ (обеих): руки НЕ в T-позе, шаг видим, масштаб адекватен.
// Раньше тест проверял только имена узлов первой модели — и «зеленел», пока боты
// на экране стояли в T-позе. Теперь меряем геометрию: положение кистей и размах ног.
{
  const { buildRig, worldTris } = await import('./lib/rig.mjs');
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const draco3d = (await import('draco3dgltf')).default;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });
  const models = [
    { id: 'soldier_ussr', file: 'public/assets/game/soldier.glb' },
    { id: 'soldier_opfor', file: 'public/assets/game/forest_soldier_outdated.glb' },
  ];
  for (const m of models) {
    const doc = await io.read(m.file);
    const rig = buildRig(doc);
    const a = new WalkAnim(rig.root, m.id);
    check(`${m.id}: кости найдены`, a.jointNames().length >= 8, a.jointNames().join(','));
    // руки опущены: кисть ниже плеча, а размах по X меньше полутора ростов
    const handP = () => { rig.root.updateMatrixWorld(true); const p = new THREE.Vector3(); (a.joints.forearmL ?? a.joints.armL).getWorldPosition(p); return p; };
    const box = () => {
      const wt = worldTris(rig); let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const t of wt) for (const v of t) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
      return { w: mx[0] - mn[0], h: mx[1] - mn[1] };
    };
    const shoulderY = a.joints.armL.getWorldPosition(new THREE.Vector3()).y;
    const b0 = box(), h0 = handP();
    // фиксируем ссылки: позже a.joints может обновиться, а тут нужны те же кости
    const thighL = a.joints.thighL, shinL = a.joints.shinL;
    check(`${m.id}: руки опущены (не T-поза)`, h0.y < shoulderY && b0.w < b0.h * 1.1,
      `кисть ${h0.y.toFixed(2)} < плечо ${shoulderY.toFixed(2)}, ширина ${b0.w.toFixed(2)} при росте ${b0.h.toFixed(2)}`);
    // шаг: размах бёдер и сгиб колена (по мировым координатам, не по осям костей)
    a.speed = 1;
    let spread = 0, knee = 0;
    a.phase = Math.PI / 2; a.update(1 / 60, 3.1);
    const footX = () => { rig.root.updateMatrixWorld(true); const p = new THREE.Vector3(); a.joints.shinL.getWorldPosition(p); return p; };
    const fx0 = footX();
    for (let i = 0; i < 60; i++) {
      a.update(1 / 60, 3.1);
      const f = footX();
      spread = Math.max(spread, Math.hypot(f.x - fx0.x, f.z - fx0.z));
    }
    rot: {
      // колено: угол между бедром и голенью меняется в цикле
      let minA = 9, maxA = -9;
      for (let i = 0; i < 60; i++) {
        a.update(1 / 60, 3.1);
        rig.root.updateMatrixWorld(true);
        const th = new THREE.Vector3().setFromMatrixPosition(thighL.matrixWorld);
        const sh = new THREE.Vector3().setFromMatrixPosition(shinL.matrixWorld);
        const ang = Math.atan2(sh.z - th.z, sh.y - th.y);
        minA = Math.min(minA, ang); maxA = Math.max(maxA, ang);
      }
      knee = maxA - minA;
    }
    const modelH = b0.h;
    check(`${m.id}: голень ходит при шаге`, spread > modelH * 0.05, `размах ${spread.toFixed(2)} м при росте ${modelH.toFixed(2)}`);
    check(`${m.id}: колено сгибается`, knee > 0.2, `ход угла ${knee.toFixed(2)} рад`);
  }
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — анимация ходьбы (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
