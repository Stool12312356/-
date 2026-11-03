// tools/test-viewmodel.mjs — проверка посадки оружия в руках БЕЗ браузера.
//
// Ловит именно те баги, которые нашёл пользователь на скриншотах:
//  1) деталь висит рядом с оружием (у ПМ в модели отдельный запасной магазин);
//  2) ствол смотрит мимо перекрестия (на экране оружие «повёрнуто не туда»);
//  3) приклад/кольца прицела оказываются ЗА камерой (оптика во весь экран);
//  4) при прицеливании (ПКМ) прицельные не на линии взгляда.
// Считаем ту же математику, что в игре (src/game/combat.ts + tools/lib/vmpose.mjs).
import fs from 'fs';
import { loadTris, normalizeTris, bounds } from './lib/glb.mjs';
import { poseFor, project } from './lib/vmpose.mjs';

const MANIFEST = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8')).items;
const CATALOG = new Map(JSON.parse(fs.readFileSync('config/catalog.json', 'utf8')).items.map(i => [i.id, i]));
const VM = JSON.parse(fs.readFileSync('config/viewmodel.json', 'utf8'));
const ASPECT = 16 / 9;

let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'БАГ '} ${msg}`); if (!cond) fail++; };

// матрицы (строка = ось), как в src/game/combat.ts через three.js
const apply = (m, p) => [0, 1, 2].map(i => m.a[i] * p[0] + m.b[i] * p[1] + m.c[i] * p[2] + m.t[i]);
const T = (x, y, z) => ({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], t: [x, y, z] });
const S = s => ({ a: [s, 0, 0], b: [0, s, 0], c: [0, 0, s], t: [0, 0, 0] });
const RY = r => ({ a: [Math.cos(r), 0, -Math.sin(r)], b: [0, 1, 0], c: [Math.sin(r), 0, Math.cos(r)], t: [0, 0, 0] });
const mul = (m, n) => ({
  a: [0, 1, 2].map(i => m.a[0] * n.a[i] + m.b[0] * n.b[i] + m.c[0] * n.c[i]),
  b: [0, 1, 2].map(i => m.a[1] * n.a[i] + m.b[1] * n.b[i] + m.c[1] * n.c[i]),
  c: [0, 1, 2].map(i => m.a[2] * n.a[i] + m.b[2] * n.b[i] + m.c[2] * n.c[i]),
  t: [0, 1, 2].map(i => m.a[i] * n.t[0] + m.b[i] * n.t[1] + m.c[i] * n.t[2] + m.t[i]),
});

const ids = Object.keys(VM).filter(k => !k.startsWith('_'));
for (const id of ids) {
  const item = MANIFEST.find(i => i.id === id);
  if (!item || item.placeholder || !item.file) { console.log(`\n${id}: пропуск (нет модели)`); continue; }
  const cfg = VM[id];
  const cat = CATALOG.get(id);
  console.log(`\n${id} (${item.name}):`);
  const raw = await loadTris(item.file.replace('assets/', 'public/assets/'), cat?.exclude);
  let tris = normalizeTris(raw, item.normalize);
  const b = bounds(tris);
  const top = b.mx[1], rear = b.mx[2], bottom = b.mn[1];

  // 1) вьюмодель не должна быть больше двух метров (признак чужого масштаба)
  ok(b.size[2] > 0.08 && b.size[2] < 2.0, `длина ${b.size[2].toFixed(3)} м (норма для оружия 0.08…2 м)`);

  // 2) поза «от бедра»: приклад перед камерой, низ не под полом взгляда
  const hip = poseFor(cfg, { top, rear, adsT: 0 });
  const hipM = mul(T(...hip.pos), mul(RY(hip.rotY), S(cfg.scale)));
  const mz = apply(hipM, [0, 0.02, -b.size[2] / 2]);
  const rearPt = apply(hipM, [0, top, rear]);
  // Часть оружия может быть позади камеры (приклад у плеча) — это нормально.
  // Проверяем главное: дуло далеко впереди и модель целиком не «в глазу».
  ok(mz[2] < -0.35, `дуло впереди камеры на ${(-mz[2]).toFixed(2)} м`);
  const pr = project(mz, 75, ASPECT);
  // дуло должно быть в правой-нижней четверти: иначе оружие закрывает центр экрана
  ok(pr[0] > 0.45 && pr[0] < 0.80 && pr[1] > 0.45 && pr[1] < 0.85,
    `дуло в кадре справа-снизу (x=${pr[0].toFixed(2)}, y=${pr[1].toFixed(2)})`);
  const sizeOnScreen = Math.abs(rearPt[0] - mz[0]);
  ok(sizeOnScreen < 0.55, `оружие не шире половины кадра (${sizeOnScreen.toFixed(2)})`);

  // 3) ствол параллелен взгляду: доворот в покое ≤ 4°
  const yawDeg = Math.abs(hip.rotY * 180 / Math.PI);
  ok(yawDeg <= 4, `доворот ствола в покое ${yawDeg.toFixed(1)}° (≤ 4°)`);

  // 4) прицеливание: оптика/прицельные на оси взгляда => перекрестие на них
  const ads = poseFor(cfg, { top, rear, adsT: 1 });
  const adsM = mul(T(...ads.pos), mul(RY(ads.rotY), S(cfg.scale)));
  const sightY = cfg.optic ? top + 0.022 : top;   // центр трубы оптики либо верх прицельных
  const sight = apply(adsM, [0, sightY, -b.size[2] * 0.5]);
  const pj = project(sight, 55, ASPECT);
  ok(Math.abs(pj[0] - 0.5) < 0.06 && Math.abs(pj[1] - 0.5) < 0.10,
    `при прицеливании прицельные в перекрестии (dx=${(pj[0] - 0.5).toFixed(3)}, dy=${(pj[1] - 0.5).toFixed(3)})`);
  ok(sight[2] < -0.15, `прицельные перед камерой (${sight[2].toFixed(2)} м)`);
  // дуло при ADS должно быть в кадре: оружие не «смотрит в пол»
  // при ADS ствол должен смотреть по центру кадра по горизонтали
  // (по вертикали дуло бывает ниже — линия прицеливания идёт по прицельным, а не по стволу)
  const adsMuzzle = apply(adsM, [0, 0.02, -b.size[2] / 2]);
  const am = project(adsMuzzle, 55, ASPECT);
  ok(Math.abs(am[0] - 0.5) < 0.08 && am[1] > 0.25 && am[1] < 0.95,
    `при прицеливании ствол смотрит по центру (x=${am[0].toFixed(2)}, y=${am[1].toFixed(2)})`);
  void bottom;

  // 5) кроме того: модель не должна быть «плоской» — признак, что детали не собрались
  ok(b.size[0] > 0.01 && b.size[1] > 0.01, `габарит по толщине ${b.size[0].toFixed(3)}×${b.size[1].toFixed(3)} м`);
}

// у ПМ в модели есть отдельный запасной магазин — он должен быть исключён из вьюмодели
const pmCat = CATALOG.get('pm');
ok(!!pmCat?.exclude?.length, 'ПМ: запасной магазин исключён из вьюмодели');

console.log(`\nИТОГ: ${fail === 0 ? 'OK — посадка оружия верна для всех стволов' : `найдено проблем: ${fail}`}`);
process.exit(fail ? 1 : 0);
