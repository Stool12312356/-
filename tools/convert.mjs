// tools/convert.mjs — оптимизация GLB: metalrough, dedup/prune, ресайз текстур (webp), Draco.
// Использование: node tools/convert.mjs  (читает assets/models/*.glb → пишет assets/game/*.glb)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, draco, metalRough, flatten, weld, getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { bakeSkins } from './lib/bake.mjs';
import { listSources } from './lib/sources.mjs';
// config/recolor.json (зимняя перекраска) временно отключён: lib/recolor.mjs не выгружен.
// Вернуть: положить tools/lib/recolor.mjs и снять флаг RECOLOR=0 ниже.
import { existsSync } from 'fs';
const RECOLOR_ON = process.env.RECOLOR !== '0' && existsSync(new URL('./lib/recolor.mjs', import.meta.url));
const recolorWinter = RECOLOR_ON ? (await import('./lib/recolor.mjs')).recolorWinter : null;
import fs from 'fs';
// --low: второй проход с текстурами 128px для слабых ПК (раньше это делала bash-строка в package.json,
// которая на Windows не работает). Кроссплатформенно: node tools/convert.mjs --low
const LOW = process.argv.includes('--low');
const IN='assets/models', OUT=process.env.OUT || (LOW ? 'public/assets/game-low' : 'public/assets/game');
fs.mkdirSync(OUT,{recursive:true});
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
// Лимиты текстур (по VRAM): герой-оружие и вертолёт 1024, остальное 512. Переопределение: TEXMAX=256 node tools/convert.mjs
const maxTex = f => LOW ? 128 : process.env.TEXMAX ? +process.env.TEXMAX : /akmn|hind|mh-6/.test(f) ? 1024 : 512;
const recolor = fs.existsSync('config/recolor.json') ? JSON.parse(fs.readFileSync('config/recolor.json','utf8')) : {};
for (const {name: f, path: srcPath} of listSources()) {
  const doc = await io.read(srcPath);
  if (recolor[f] === 'winter') {
    if (recolorWinter) { const n = await recolorWinter(doc, sharp); console.log('  winter recolor:', n, 'textures'); }
    else console.warn('  перекраска в зимнюю пропущена (lib/recolor.mjs отсутствует)');
  }
  const hasSG = doc.getRoot().listExtensionsUsed().some(e=>e.extensionName==='KHR_materials_pbrSpecularGlossiness');
  const baked = f.startsWith('m4_') ? 0 : bakeSkins(doc);
  if (baked) console.log('  skin baked:', baked);
  const steps = [];
  if (hasSG) steps.push(metalRough());
  steps.push(dedup(), prune(), textureCompress({encoder:sharp, targetFormat:'webp', resize:[maxTex(f),maxTex(f)], quality:80}), draco({method:'edgebreaker'}));
  await doc.transform(...steps);
  await io.write(`${OUT}/${f}`, doc);
  console.log(f, (fs.statSync(srcPath).size/1e6).toFixed(1)+'MB →', (fs.statSync(`${OUT}/${f}`).size/1e6).toFixed(1)+'MB', hasSG?'(SG→MR)':'');
}
