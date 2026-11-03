// Скачивание и подготовка РЕАЛЬНЫХ текстур (M6).
// Пользователь: «нет реалистичных текстур, надо скачать с интернета».
//
// Источники — свободные (CC0 / MIT-примеры движков): three.js, PlayCanvas, Khronos glTF.
// Почему через GitHub API: raw.githubusercontent.com в песочнице отдаёт обрыв соединения,
// а CDN текстурных сайтов (ambientCG, Poly Haven, SketchupTextures) вообще недоступны.
// Качаем `api.github.com/.../contents/<path>` с заголовком Accept: application/vnd.github.raw,
// затем проверяем РАЗМЕР (была ситуация, когда пришёл HTML ошибки на 140 байт — молча
// превращался в «серую заглушку») и прогоняем через sharp до 512×512.
//
// Запуск: node tools/fetch-textures.mjs   (повторно не перекачивает, если файл уже есть)
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import sharp from 'sharp';

const TMP = '/tmp/tex-src';
fs.mkdirSync(TMP, { recursive: true });

const SRC = [
  // имя в игре, репозиторий, путь, ref, лицензия, размер
  ['brick', 'mrdoob/three.js', 'examples/textures/brick_diffuse.jpg', 'dev', 'three.js examples (MIT)', 512],
  ['wood', 'mrdoob/three.js', 'examples/textures/hardwood2_diffuse.jpg', 'dev', 'three.js examples (MIT)', 512],
  ['grass', 'mrdoob/three.js', 'examples/textures/terrain/grasslight-big.jpg', 'dev', 'three.js examples (MIT)', 256],
  ['asphalt', 'KhronosGroup/glTF-Sample-Assets', 'Models/TrafficCone/glTF/asphalt_02_diff_1k.jpg', 'main', 'Khronos glTF-Sample-Assets (CC0)', 512],
  ['stone', 'playcanvas/engine', 'examples/assets/textures/bricks076a/color.webp', 'main', 'PlayCanvas engine examples (MIT)', 512],
  ['ground', 'playcanvas/engine', 'examples/assets/textures/ground092c/color.webp', 'main', 'PlayCanvas engine examples (MIT)', 512],
];

/** Скачивание с проверкой, что пришёл файл, а не JSON/HTML ошибки. */
function download(repo, p, ref, dst) {
  if (fs.existsSync(dst) && fs.statSync(dst).size > 2000) return dst;
  const url = `https://api.github.com/repos/${repo}/contents/${p}?ref=${ref}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      execFileSync('curl', ['-sS', '-m', '240', '-L', '-H', 'Accept: application/vnd.github.raw', '-o', dst, url], { stdio: 'pipe' });
    } catch { continue; }
    const size = fs.existsSync(dst) ? fs.statSync(dst).size : 0;
    if (size < 2000) continue;
    const head = fs.readFileSync(dst).subarray(0, 4).toString('latin1');
    // JPEG / PNG / WebP — всё, что не начинается с них, считаем мусором
    if (head.startsWith('\xff\xd8') || head.startsWith('\x89PNG') || head.includes('RIFF') || head.includes('WEBP')) return dst;
  }
  return null;
}

const OUT = 'public/textures';
fs.mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const [name, repo, p, ref, license, size] of SRC) {
  const raw = path.join(TMP, `${name}.src`);
  const src = download(repo, p, ref, raw);
  if (!src) { console.log(`✗ ${name}: не скачалось (проверьте сеть)`); continue; }
  const dst = path.join(OUT, `${name}.jpg`);
  await sharp(src).resize(size, size, { fit: 'cover' }).jpeg({ quality: 84, mozjpeg: true }).toFile(dst);
  // «серая заглушка» ловится яркостью и разбросом: настоящая текстура имеет цвет и контраст
  const stats = await sharp(dst).stats();
  const spread = Math.max(...stats.channels.map(c => c.stdev));
  if (spread < 12) { console.log(`✗ ${name}: похоже на заглушку (разброс ${spread.toFixed(1)})`); continue; }
  console.log(`✓ ${name}.jpg ${size}×${size} ${(fs.statSync(dst).size / 1024).toFixed(0)} КБ — ${license}`);
  manifest.push({ name, file: `${name}.jpg`, source: `${repo}/${p}`, license });
}

fs.writeFileSync(path.join(OUT, 'CREDITS.json'), JSON.stringify({
  note: 'Текстуры скачаны из свободных источников (CC0/MIT) и уменьшены до 512px. Список — для атрибуции.',
  textures: manifest,
}, null, 2));
console.log(`\nитого ${manifest.length} текстур в ${OUT}`);
