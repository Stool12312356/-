// КАРТА КОСТЕЙ ДЛЯ АНИМАЦИИ (config/rig-map.json).
//
// Зачем: у моделей ботов разные скелеты. У первой имена читаемые (`Grp_Dui_l_*` — бедро),
// у второй (OPFOR) — `Bone.037_...`, и по имени не понять, где рука, а где нога.
// Угадывать по положению узлов нельзя: у OPFOR «кость, идущая вниз», оказывается плечом,
// и бот на анимации складывается в шпагат (проверено рендером).
//
// Поэтому кости определяем честно — по СКИНУ: для каждой кости считаем центр тяжести
// вершин, которые она двигает (вес × позиция × матрица кости × inverseBindMatrix), и
// раскладываем эти центры по анатомическим уровням: ступня, колено, бедро, кисть,
// предплечье, плечо, голова, корпус. Результат пишем в config/rig-map.json, а игра
// берёт оттуда готовое соответствие — без эвристик в рантайме.
//
// Запуск: node tools/rig-map.mjs   (перезаписывает config/rig-map.json)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, x, y, z) => ({
  x: m[0] * x + m[4] * y + m[8] * z + m[12],
  y: m[1] * x + m[5] * y + m[9] * z + m[13],
  z: m[2] * x + m[6] * y + m[10] * z + m[14],
});

const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8'));
const chars = manifest.items.filter(i => i.category === 'character' && !i.placeholder);
const out = {};

for (const item of chars) {
  const doc = await io.read('public/' + item.file);
  const root = doc.getRoot();
  // самый большой скиннутый примитив — по нему и считаем
  let best = null;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(), skin = node.getSkin();
    if (!mesh || !skin) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos || !prim.getAttribute('JOINTS_0')) continue;
      if (!best || pos.getCount() > best.pos.getCount()) best = { node, skin, prim, pos };
    }
  }
  if (!best) { console.log(`${item.id}: скина нет — карта не нужна`); continue; }

  const { node, skin, prim, pos } = best;
  const joints = skin.listJoints();
  const ibmAcc = skin.getInverseBindMatrices();
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const world = joints.map(j => j.getWorldMatrix());

  // центр тяжести вершин на каждую кость (в мировых координатах покоя)
  const acc = joints.map(() => ({ x: 0, y: 0, z: 0, w: 0 }));
  const v = [0, 0, 0], jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
  for (let i = 0; i < pos.getCount(); i += 3) {          // прореживаем: 1/3 вершин достаточно
    pos.getElement(i, v); J.getElement(i, jj); W.getElement(i, ww);
    for (let k = 0; k < 4; k++) {
      const w = ww[k]; if (!w) continue;
      const ji = jj[k]; if (ji >= joints.length) continue;
      const ibm = new Array(16); ibmAcc.getElement(ji, ibm);
      const p = apply(mul(world[ji], ibm), v[0], v[1], v[2]);
      acc[ji].x += p.x * w; acc[ji].y += p.y * w; acc[ji].z += p.z * w; acc[ji].w += w;
    }
  }
  const pts = acc.map((a, i) => ({ i, name: joints[i].getName(), x: a.x / a.w, y: a.y / a.w, z: a.z / a.w, w: a.w }))
    .filter(p => p.w > 0.5);

  // нормируем рост к 1.8 м и «бок» к метрам
  const ys = pts.map(p => p.y);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const unit = 1.8 / Math.max(0.05, y1 - y0);
  const H = p => (p.y - y0) * unit, X = p => p.x * unit;

  const pick = (list, fn) => list.slice().sort(fn)[0];
  const byH = (list) => list.slice().sort((a, b) => H(b) - H(a));

  // НОГА: кости ниже 0.95 м, в стороне от центра. Бедро — самая ВЫСОКАЯ из них на стороне,
  // колено — ниже бедра, ступня — самая низкая.
  const side = (s) => pts.filter(p => Math.sign(X(p)) === s && Math.abs(X(p)) > 0.04);
  const legs = (s) => byH(side(s).filter(p => H(p) < 0.95 && H(p) > 0.02));
  const legR = legs(1), legL = legs(-1);
  const thighR = legR[0], shinR = legR.find(p => p !== thighR && H(p) < H(thighR) - 0.1);
  const thighL = legL[0], shinL = legL.find(p => p !== thighL && H(p) < H(thighL) - 0.1);
  const footR = legR.find(p => p !== thighR && p !== shinR && H(p) < 0.35);
  const footL = legL.find(p => p !== thighL && p !== shinL && H(p) < 0.35);

  // РУКА: кости выше 1.0 м, вынесенные вбок. Плечо — ближайшая к торсу, кисть — самая дальняя.
  const armsS = (s) => side(s).filter(p => H(p) > 1.0 && Math.abs(X(p)) > 0.1)
    .sort((a, b) => Math.abs(X(a)) - Math.abs(X(b)));
  const armR = armsS(1)[0], armL = armsS(-1)[0];
  const foreR = armsS(1).slice(-1)[0] !== armR ? armsS(1).slice(-1)[0] : armsS(1)[1];
  const foreL = armsS(-1).slice(-1)[0] !== armL ? armsS(-1).slice(-1)[0] : armsS(-1)[1];

  // ГОЛОВА/КОРПУС: ближе всех к осевой линии, выше всех — голова, ниже — корпус
  const center = byH(pts.filter(p => Math.abs(X(p)) < 0.25));
  const head = center[0];
  const chest = center.find(p => H(p) > 1.0 && H(p) < 1.55 && p !== head);

  const map = {
    head, chest, thighL, thighR, shinL, shinR, footL, footR, armL, armR, forearmL: foreL, forearmR: foreR,
  };
  const res = {};
  for (const [k, val] of Object.entries(map)) if (val) res[k] = val.name;
  out[item.id] = { file: item.file, joints: res };
  console.log(`${item.id} (${item.file})`);
  for (const [k, val] of Object.entries(map)) {
    console.log(`  ${k.padEnd(9)} ${val ? val.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 22).padEnd(24) + ` H=${H(val).toFixed(2)} X=${X(val).toFixed(2)}` : '— НЕ НАЙДЕНО'}`);
  }
}

fs.writeFileSync('config/rig-map.json', JSON.stringify(out, null, 2) + '\n');
// и TS-копия для игры: импорт JSON в рантайме тянет лишний запрос, а типы тут простые
const ts = `// СГЕНЕРИРОВАНО tools/rig-map.mjs — не править руками.\n// Соответствие «анатомическая кость → имя узла в модели» для процедурной ходьбы.\nexport const RIG_MAP: Record<string, { file: string; joints: Record<string, string> }> = ${JSON.stringify(out, null, 2)};\n`;
fs.writeFileSync('src/game/rigMap.ts', ts);
console.log('\nзаписано config/rig-map.json и src/game/rigMap.ts');
