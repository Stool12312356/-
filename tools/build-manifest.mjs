// tools/build-manifest.mjs
// Сканирует assets/models/*.glb, классифицирует по config/catalog.json, считает габариты/нормализацию,
// генерирует физические коллайдеры (convex hull из геометрии) и пишет public/assets/manifest.json.
// Для предметов без файла пишет запись placeholder:true (игра рисует отдельную процедурную заглушку).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { Vector3 } from 'three';
import draco3d from 'draco3dgltf';
import fs from 'fs';
import { listSources } from './lib/sources.mjs';
import { bakeSkins } from './lib/bake.mjs';

const OUT = 'public/assets';
const catalog = JSON.parse(fs.readFileSync('config/catalog.json', 'utf8')).items;
fs.mkdirSync(`${OUT}/colliders`, { recursive: true });
// Модели в public/assets/game сжаты Draco (см. tools/convert.mjs), поэтому декодер обязателен:
// без registerDependencies падает на первом же сжатом файле (Cannot read properties of undefined 'DT_FLOAT32').
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const ROT = { '+x': Math.PI / 2, '+z': Math.PI, '-x': -Math.PI / 2, '-z': 0 };

const sources = listSources();
// Защита: если assets/models пуст, НЕ перезаписываем рабочий манифест пустым —
// иначе игра останется без моделей (частый случай: распаковали архив без сырых ассетов).
if (sources.length === 0 && fs.existsSync(`${OUT}/manifest.json`)) {
  const cur = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8'));
  const real = cur.items.filter(i => !i.placeholder && !i.procedural).length;
  console.log(`assets/models пуст — манифест НЕ тронут (в нём ${cur.items.length} предметов, ${real} реальных).`);
  console.log('Чтобы пересобрать: положите GLB в assets/models и повторите npm run assets.');
  process.exit(0);
}
const files = sources.map(s => s.name); const pathOf = Object.fromEntries(sources.map(s => [s.name, s.path]));
const claimed = new Map(); // file -> id
const byId = new Map();
const skipped = [];        // файлы, которые не удалось однозначно сопоставить
for (const f of files) {
  const hits = catalog.filter(it => it.match && new RegExp(it.match, 'i').test(f));
  if (hits.length > 1) {
    // Не роняем весь манифест из-за одной неоднозначной пары: пропускаем файл,
    // всё остальное собирается. Проблему видно в отчёте в конце.
    skipped.push(`${f} → подходит под ${hits.map(h => h.id).join(', ')}`);
    continue;
  }
  if (hits.length === 0) continue;
  const it = hits[0];
  if (byId.has(it.id)) { skipped.push(`${f} → id ${it.id} уже занят файлом ${byId.get(it.id)}`); continue; }
  byId.set(it.id, f); claimed.set(f, it.id);
}


function worldPoints(doc, excludeRe) {
  const pts = [];
  const scene = doc.getRoot().listScenes()[0];
  const walk = n => {
    const m = n.getMesh();
    if (m && !(excludeRe && excludeRe.test(n.getName()))) {
      const mw = n.getWorldMatrix();
      for (const p of m.listPrimitives()) {
        const pos = p.getAttribute('POSITION'); const v = [0, 0, 0];
        const step = Math.max(1, Math.floor(pos.getCount() / 3000));
        for (let i = 0; i < pos.getCount(); i += step) {
          pos.getElement(i, v);
          pts.push([mw[0]*v[0]+mw[4]*v[1]+mw[8]*v[2]+mw[12], mw[1]*v[0]+mw[5]*v[1]+mw[9]*v[2]+mw[13], mw[2]*v[0]+mw[6]*v[1]+mw[10]*v[2]+mw[14]]);
        }
      }
    }
    n.listChildren().forEach(walk);
  };
  scene.listChildren().forEach(walk);
  return pts;
}

const out = [];
for (const it of catalog) {
  const e = { id: it.id, name: it.name, category: it.category, faction: it.faction };
  for (const k of ['mass', 'hp', 'locomotion', 'note']) if (it[k] !== undefined) e[k] = it[k];
  const file = byId.get(it.id);
  for (const k of ['viewmodel', 'mount', 'recolor']) if (it[k] !== undefined) e[k] = it[k];
  if (it.procedural) { e.placeholder = false; e.procedural = it.procedural; out.push(e); continue; }
  if (!file) {
    if (!it.placeholder) { console.warn(`! ${it.id}: нет ни файла, ни заглушки`); continue; }
    e.placeholder = true; e.placeholderSpec = it.placeholder; out.push(e); continue;
  }
  const doc = await io.read(pathOf[file]);
  // Скин/поза: у моделей со Sketchfab реальная поза живёт в костях. Запекаем её ДО замера габаритов,
  // иначе масштаб и коллайдер считаются по bind-позе (реальный случай: rpk выходил 5,3×19,6×1,04 м).
  // convert.mjs делает то же самое — так геометрия в игре и в манифесте совпадает.
  if (bakeSkins(doc)) console.log(`  поза запечена: ${it.id}`);
  const scene = doc.getRoot().listScenes()[0];
  const b0 = getBounds(scene);
  let size0 = b0.max.map((v, i) => v - b0.min[i]);
  const fwd = (it.forward && it.forward !== '?') ? it.forward : (size0[0] >= size0[2] ? '+x' : '+z');
  const longAxis = (fwd.endsWith('x')) ? 0 : 2;
  const wideAxis = longAxis === 0 ? 2 : 0;
  let scale = it.scale ?? (it.targetLength ? it.targetLength / size0[longAxis] : it.targetHeight ? it.targetHeight / size0[1] : it.targetWidth ? it.targetWidth / size0[wideAxis] : 1);
  // Страховка: если масштаб не задан явно и модель «не в метрах» (длиннее 100 м или короче 10 см),
  // это почти всегда зашитый в модель масштаб — предупреждаем, а не молча строим великана.
  if (it.scale === undefined && !it.targetLength && !it.targetHeight && !it.targetWidth &&
      (size0[longAxis] > 100 || size0[longAxis] < 0.1)) {
    console.warn(`! ${it.id}: габарит ${size0.map(v => +v.toFixed(2))} — похоже на чужой масштаб, задайте targetLength/scale в catalog.json`);
  }
  const rotY = it.yawDeg !== undefined ? it.yawDeg * Math.PI / 180 : ROT[fwd];
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const rot = ([x, y, z]) => [x * c + z * s, y, -x * s + z * c];
  const pts = worldPoints(doc, it.colliderExclude ? new RegExp(it.colliderExclude, 'i') : null).map(p => rot(p.map(v => v * scale)));
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  pts.forEach(p => p.forEach((v, i) => { mn[i] = Math.min(mn[i], v); mx[i] = Math.max(mx[i], v); }));
  const grounded = !['weapon', 'gadget', 'attachment'].includes(it.category) || ['medkit', 'ammobox', 'claymore', 'mine01', 'rgd5', 'f1', 'c4'].includes(it.id);
  const off = [-(mn[0] + mx[0]) / 2, grounded ? -mn[1] : -(mn[1] + mx[1]) / 2, -(mn[2] + mx[2]) / 2];
  const hullPts = pts.map(p => new Vector3(p[0] + off[0], p[1] + off[1], p[2] + off[2]));
  const hull = new ConvexHull().setFromPoints(hullPts);
  const uniq = new Map();
  hull.faces.forEach(f => { let e2 = f.edge; do { const v = e2.head().point; uniq.set(`${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`, [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]); e2 = e2.next; } while (e2 !== f.edge); });
  const hullArr = [...uniq.values()];
  fs.writeFileSync(`${OUT}/colliders/${it.id}.json`, JSON.stringify({ id: it.id, type: 'hull', points: hullArr.flat(), halfExtents: [(mx[0]-mn[0])/2, (mx[1]-mn[1])/2, (mx[2]-mn[2])/2] }));
  let tris = 0; doc.getRoot().listMeshes().forEach(m => m.listPrimitives().forEach(p => { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }));
  Object.assign(e, {
    placeholder: false, source: file, file: `assets/game/${file}`, collider: `assets/colliders/${it.id}.json`,
    forward: it.yawDeg !== undefined ? `yaw ${it.yawDeg}°` : fwd, forwardVerified: it.yawDeg !== undefined || !!(it.forward && it.forward !== '?'),
    normalize: { scale: +scale.toFixed(6), rotY, offset: off.map(v => +v.toFixed(4)) },
    size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].map(v => +v.toFixed(3)),
    tris: Math.round(tris), animations: doc.getRoot().listAnimations().map(a => a.getName()),
  });
  out.push(e);
}
const unmapped = files.filter(f => !claimed.has(f));
const manifest = { generated: new Date().toISOString(), items: out, unmappedFiles: unmapped };
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
const real = out.filter(o => !o.placeholder && !o.procedural), ph = out.filter(o => o.placeholder), proc = out.filter(o => o.procedural);
console.log(`manifest: ${out.length} предметов | реальных моделей: ${real.length} | заглушек: ${ph.length} | процедурных: ${proc.length} | неопознанных файлов: ${unmapped.length}`);
real.forEach(r => console.log(`  ✔ ${r.id.padEnd(10)} ← ${r.source}  size=${r.size}  fwd=${r.forward}${r.forwardVerified ? '' : ' (?)'}`));
ph.forEach(p => console.log(`  ▫ заглушка: ${p.id}`));
unmapped.forEach(f => console.log(`  ? неопознан: ${f}`));
if (skipped.length) {
  console.log(`\n⚠ ПРОПУЩЕНО файлов: ${skipped.length} (остальные собраны нормально)`);
  skipped.forEach(s => console.log('   ' + s));
  console.log('   Исправьте match в config/catalog.json — он должен однозначно указывать на один id.');
}
