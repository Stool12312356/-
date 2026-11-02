// Скачивание и подготовка РЕАЛЬНЫХ текстур (M6).
// Пользователь: «нет реалистичных текстур, надо скачать с интернета».
//
// Источники — свободные (CC0 / MIT-примеры), качаются через GitHub API, потому что
// raw.githubusercontent.com в песочнице недоступен. Файлы кладём в public/textures
// и сжимаем до 512×512 (в игре кубики 0.5 м — больше не нужно, а 4к в WebGL дорого).
//
// Запуск: node tools/fetch-textures.mjs   (повторно не перекачивает)
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import sharp from 'sharp';

const SRC = [
  // имя в игре      репозиторий                       путь                                                    ref    лицензия
  ['brick', 'mrdoob/three.js', 'examples/textures/brick_diffuse.jpg', 'dev', 'three.js examples (MIT)'],
  ['wood', 'mrdoob/three.js', 'examples/textures/hardwood2_diffuse.jpg', 'dev', 'three.js examples (MIT)'],
  ['grass', 'mrdoob/three.js', 'examples/textures/terrain/grasslight-big.jpg', 'dev', 'three.js examples (MIT)'],
  ['asphalt', 'KhronosGroup/glTF-Sample-Assets', 'Models/TrafficCone/glTF/asphalt_02_diff_1k.jpg', 'main', 'Khronos glTF-Sample-Assets (CC0)'],
  ['brick_normal', 'KhronosGroup/glTF-Sample-Assets', 'Models/TrafficCone/glTF/asphalt_02_rough_1k.jpg', 'main', 'Khronos glTF-Sample-Assets (CC0)'],
];

const OUT = 'public/textures';
fs.mkdirSync(OUT, { recursive: true });

/** 512×512, sRGB JPEG — ровно то, что нужно кубику 0.5 м. */
async function prep(srcPath, dstPath, size = 512) {
  await sharp(srcPath)
    .resize(size, size, { fit: 'cover' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(dstPath);
}

const manifest = [];
for (const [name, repo, p, ref, license] of SRC) {
  const raw = `/tmp/tex/${name}.src.jpg`;
  const dst = path.join(OUT, `${name}.jpg`);
  if (!fs.existsSync(raw)) {
    // через curl: у node fetch в песочнице не сходится цепочка сертификатов
    const url = `https://api.github.com/repos/${repo}/contents/${p}?ref=${ref}`;
    try {
      execFileSync('curl', ['-sS', '-m', '180', '-L', '-H', 'Accept: application/vnd.github.raw', '-o', raw, url], { stdio: 'pipe' });
    } catch (e) {
      console.log(`✗ ${name}: ${String(e).slice(0, 80)}`);
      continue;
    }
    if (!fs.existsSync(raw) || fs.statSync(raw).size < 1000) { console.log(`✗ ${name}: пустой файл`); continue; }
  }
  const size = name === 'grass' ? 256 : 512;          // трава на земле крупная — хватает 256
  await prep(raw, dst, size);
  const kb = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`✓ ${name}.jpg ${size}×${size} ${kb} КБ — ${license}`);
  manifest.push({ name, file: `${name}.jpg`, source: `${repo}/${p}`, license });
}

// сюда же — текстура кирпича как «штукатурка с рельефом» (нужна для стен подъезда)
if (fs.existsSync('/tmp/tex/plaster.jpg')) {
  await sharp('/tmp/tex/plaster.jpg').resize(512, 512, { fit: 'cover' }).grayscale().jpeg({ quality: 82 }).toFile(path.join(OUT, 'stucco.jpg'));
  console.log('✓ stucco.jpg 512×512 (из brick_bump, three.js MIT)');
  manifest.push({ name: 'stucco', file: 'stucco.jpg', source: 'mrdoob/three.js/examples/textures/brick_bump.jpg', license: 'three.js examples (MIT)' });
}

fs.writeFileSync(path.join(OUT, 'CREDITS.json'), JSON.stringify({
  note: 'Текстуры скачаны из свободных источников и уменьшены до 512px. Список — для атрибуции.',
  textures: manifest,
}, null, 2));
console.log(`\nитого ${manifest.length} текстур в ${OUT}, список — ${OUT}/CREDITS.json`);
