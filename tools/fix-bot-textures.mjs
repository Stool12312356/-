// ПОЧИНКА «ЧЁРНЫХ» МОДЕЛЕЙ ПЕРСОНАЖЕЙ.
//
// Проблема со скриншота: боты выглядят чёрными силуэтами. Причины нашлись в самих GLB:
//  1) у `forest_soldier_outdated.glb` (OPFOR) материал `material` имеет
//     baseColorFactor = [0,0,0] без текстуры — это честно чёрный цвет;
//  2) альбедо-текстура OPFOR (512×512) в среднем 23/255 — на снегу читается как силуэт;
//  3) у OPFOR бинд-поза = T-поза, а клипов анимации нет (поэтому и T-поза — лечится в anim.ts).
//
// Здесь лечим (1) и (2): чёрный фактор заменяем нейтральным, а слишком тёмную
// альбедо-текстуру поднимаем по яркости (гаммой, а не «+50 к каждому пикселю»,
// чтобы рисунок камуфляжа не выцветал). Исходники перезаписываются в public/assets/game.
//
// Запуск: node tools/fix-bot-textures.mjs [--dry]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import fs from 'fs';

const DRY = process.argv.includes('--dry');
/** Ниже этой средней яркости (0..1) текстура считается «чёрной» и поднимается. */
const MIN_LUMA = 0.22;
/** Цель по средней яркости после подъёма. */
const TARGET_LUMA = 0.34;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const chars = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8')).items
  .filter(i => i.category === 'character' && !i.placeholder);

async function meanLuma(tex) {
  const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(64, 64).raw().toBuffer({ resolveWithObject: true });
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  return s / n / 255;
}

let changed = 0;
for (const item of chars) {
  const file = 'public/' + item.file;
  const doc = await io.read(file);
  const report = [];

  for (const mat of doc.getRoot().listMaterials()) {
    const f = mat.getBaseColorFactor();
    const tex = mat.getBaseColorTexture();
    // (1) чёрный baseColorFactor
    const lum = 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    if (lum < 0.05) {
      mat.setBaseColorFactor([0.62, 0.62, 0.58, f[3] || 1]);
      report.push(`  материал «${mat.getName()}»: baseColorFactor ${f.map(v => v.toFixed(2)).join(',')} → 0.62 (был чёрный)`);
      changed++;
    }
    // (2) слишком тёмная альбедо-текстура
    if (tex) {
      const m = await meanLuma(tex);
      if (m < MIN_LUMA) {
        const gain = TARGET_LUMA / Math.max(m, 0.01);
        const img = sharp(Buffer.from(tex.getImage()));
        const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        const ch = info.channels;
        for (let i = 0; i < data.length; i += ch) {
          // гамма-подъём: тени тянутся сильнее, блики почти не трогаем
          for (let k = 0; k < Math.min(3, ch); k++) {
            const v = data[i + k] / 255;
            data[i + k] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(v, 1 / Math.min(2.2, gain)) * Math.min(1.45, Math.pow(gain, 0.55)))));
          }
        }
        const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
          .webp({ quality: 88 }).toBuffer();
        tex.setImage(out).setMimeType('image/webp');
        report.push(`  текстура «${tex.getName() || 'albedo'}»: средняя яркость ${m.toFixed(2)} → поднята (цель ${TARGET_LUMA})`);
        changed++;
      }
    }
  }

  if (report.length && !DRY) await io.write(file, doc);
  console.log(`${item.id} (${item.file})${report.length ? '' : ' — ок'}`);
  report.forEach(l => console.log(l));
}
console.log(DRY ? `\n[--dry] изменений было бы: ${changed}` : `\nизменено параметров: ${changed}`);
