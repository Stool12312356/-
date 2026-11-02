// tools/split.mjs — вырезает отдельные модели из паков по config/splits.json → assets/_split/<id>.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import fs from 'fs';
const splits = JSON.parse(fs.readFileSync('config/splits.json', 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync('assets/_split', { recursive: true });
for (const [pack, parts] of Object.entries(splits)) {
  if (pack.startsWith('_')) continue;
  const src = `assets/models/${pack}`; if (!fs.existsSync(src)) { console.warn('нет пака', pack); continue; }
  for (const [id, names] of Object.entries(parts)) {
    const out = `assets/_split/${id}.glb`;
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs && fs.statSync(out).mtimeMs > fs.statSync('config/splits.json').mtimeMs) continue;
    const doc = await io.read(src); const keep = new Set(names); const found = new Set();
    const scene = doc.getRoot().listScenes()[0];
    // «контейнер» = самый глубокий узел, у которого >1 детей
    let c = scene.listChildren()[0]; while (c.listChildren().length === 1) c = c.listChildren()[0];
    for (const ch of c.listChildren()) { if (keep.has(ch.getName())) found.add(ch.getName()); else ch.dispose(); }
    const missing = names.filter(n => !found.has(n)); if (missing.length) console.warn(`  ! ${id}: не найдены узлы`, missing);
    await doc.transform(prune());
    await io.write(out, doc); console.log(`split ${pack} → ${id}.glb (${found.size} узлов)`);
  }
}
