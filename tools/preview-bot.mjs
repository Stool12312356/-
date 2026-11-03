// ПРЕДПРОСМОТР БОТА (без браузера): рендерим модель бота так, как её видит игра —
// с нормализацией из манифеста, с процедурной ходьбой из src/game/anim.ts и с
// материалом из GLB (цвет + текстура-альбедо без декодирования webp).
//
// Зачем: «боты в T-позе и чёрные» видно только глазами. Здесь — 4 кадра цикла ходьбы
// в PNG, по ним проверяют, что руки опущены, ноги шагают, силуэт читаемый.
//
// Использование:
//   node tools/preview-bot.mjs                 # soldier_ussr
//   node tools/preview-bot.mjs soldier_opfor
// Результат: tools/_render/bot-<id>-<кадр>.png
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { buildRig, worldTris } from './lib/rig.mjs';
import { WalkAnim } from '../src/game/anim.ts';
import fs from 'fs';
import sharp from 'sharp';
import zlib from 'zlib';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const MANIFEST = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8')).items;
const id = process.argv[2] ?? 'soldier_ussr';
const item = MANIFEST.find(i => i.id === id);
if (!item) throw new Error('нет модели ' + id);

const W = 420, H = 560;
const BG_TOP = [0xcd, 0xd9, 0xe4], BG_BOT = [0x9f, 0xa8, 0xb0];

// ---------- запись PNG (без внешних библиотек) ----------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- средний цвет текстуры-альбедо ----------
/**
 * В песочнице нет декодера webp (sharp/PIL/libvips недоступны), поэтому «средний цвет»
 * берём из самих данных текстуры: если это webp — считаем статистику байтов, она даёт
 * честный порядок яркости (тёмная текстура → тёмный солдат). Дополнительно —
 * параметры материала (baseColorFactor), которые GLTFLoader применяет точно.
 */
async function textureTint(doc, attached) {
  const tex = attached ?? doc.getRoot().listTextures()[0];
  if (!tex) return { rgb: [0.55, 0.55, 0.55], note: 'без текстуры' };
  const d = Buffer.from(tex.getImage());
  // sharp в проекте УЖЕ есть (им пересобираются модели) — декодируем webp честно
  try {
    const { data, info } = await sharp(d).resize(64, 64).raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    return {
      rgb: [r / n / 255, g / n / 255, b / n / 255],
      note: `текстура ${info.width}×${info.height}, средний цвет #${[r / n, g / n, b / n].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`,
    };
  } catch (e) {
    return { rgb: [0.5, 0.5, 0.5], note: 'текстура не декодировалась: ' + e.message };
  }
}

/**
 * Цвет материала так, как его увидит игра: sanitizeMaterials поднимает слишком тёмный
 * baseColorFactor при наличии текстуры (из-за него OPFOR и был чёрным).
 * Здесь повторяем это правило, чтобы рендер совпадал с игрой.
 */
function baseFactor(doc) {
  const m = doc.getRoot().listMaterials()[0];
  const f = m?.getBaseColorFactor() ?? [1, 1, 1, 1];
  let out = [f[0], f[1], f[2]];
  const lum = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  if (m?.getBaseColorTexture() && lum < 0.35) {
    const k = Math.min(1, 0.35 + lum) / Math.max(lum, 1e-4);
    out = out.map(v => Math.min(1, v * k));
  }
  return out;
}

// ---------- текстура: настоящая выборка по UV ----------
/** Декодируем альбедо в RGB-буфер 256×256 — так рендер показывает камуфляж, а не «средний цвет». */
async function decodeTexture(doc, tex) {
  if (!tex) return null;
  try {
    const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(256, 256, { fit: 'fill' })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { w: info.width, h: info.height, ch: info.channels, data };
  } catch { return null; }
}
function sampleTex(t, u, v) {
  if (!t) return null;
  // UV в glTF: (0,0) — левый ВЕРХНИЙ угол изображения
  const x = Math.min(t.w - 1, Math.max(0, Math.round((u % 1 + 1) % 1 * (t.w - 1))));
  const y = Math.min(t.h - 1, Math.max(0, Math.round((v % 1 + 1) % 1 * (t.h - 1))));
  const i = (y * t.w + x) * t.ch;
  return [t.data[i] / 255, t.data[i + 1] / 255, t.data[i + 2] / 255];
}

// ---------- рендер ----------
function render(tris, camYaw, zoom, bg, tex = null) {
  const px = Buffer.alloc(W * H * 3);
  // фон: небо → земля
  for (let y = 0; y < H; y++) {
    const k = y / H;
    const r = BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * k;
    const g = BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * k;
    const b = BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * k;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; }
  }
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const cos = Math.cos(camYaw), sin = Math.sin(camYaw);
  const FOV = 0.55;                     // вертикальный угол, рад
  const dist = 3.2 / zoom;
  const light = [0.45, 0.78, 0.44];     // направление света (нормализовано ниже)
  const ll = Math.hypot(...light); const L = light.map(v => v / ll);

  const project = (p) => {
    // мир: Y вверх, персонаж стоит в (0,0,0). Камера смотрит на высоту 0.9 м.
    const x = p[0] - 0, y = p[1] - 0.9, z = p[2];
    const xr = x * cos - z * sin, zr = x * sin + z * cos;
    const zc = zr + dist;
    if (zc < 0.05) return null;
    const f = (H / 2) / Math.tan(FOV / 2);
    return [W / 2 + (xr / zc) * f, H / 2 - (y / zc) * f, zc];
  };

  for (let ti = 0; ti < tris.length; ti++) {
    const tri = tris[ti];
    const tuv = tris.uv?.[ti];
    const p = tri.map(project);
    if (p.some(v => !v)) continue;
    // нормаль в мире для освещения
    const [a, b, c] = tri;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // двусторонняя: если нормаль смотрит от камеры — переворачиваем (солдат должен быть светлым)
    let nxr = nx * cos - nz * sin, nzr = nx * sin + nz * cos;
    if (nzr > 0) { nxr = -nxr; nzr = -nzr; ny = -ny; }
    const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    // В игре работают ambient + солнце + env-карта: офлайн-рендер повторяет суммарную
    // освещённость (иначе всё выглядит темнее, чем в браузере)
    const shade = 0.72 + 0.55 * diff;
    // цвет берём из текстуры по UV (камуфляж), иначе — средний цвет материала
    const col = [0, 1, 2].map(i => Math.min(255, Math.round(255 * (tint?.[i] ?? 0.6) * factor[i] * shade)));
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const d = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((p[1][0] - x) * (p[2][1] - y) - (p[2][0] - x) * (p[1][1] - y)) / d;
      const w1 = ((p[2][0] - x) * (p[0][1] - y) - (p[0][0] - x) * (p[2][1] - y)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
      const zi = y * W + x;
      if (z >= zbuf[zi]) continue;
      zbuf[zi] = z;
      const i = zi * 3;
      let c = col;
      if (tex && tuv) {
        const u = w0 * tuv[0][0] + w1 * tuv[1][0] + w2 * tuv[2][0];
        const v = w0 * tuv[0][1] + w1 * tuv[1][1] + w2 * tuv[2][1];
        const s = sampleTex(tex, u, v);
        if (s) c = [0, 1, 2].map(k => Math.min(255, Math.round(255 * s[k] * factor[k] * shade)));
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
  }
  return px;
}

const doc = await io.read('public/assets/' + item.file.replace('assets/', ''));
const rig = buildRig(doc);
// --raw: без процедурной позы (проверить саму геометрию и скин)
const RAW = process.argv.includes('--raw');
const anim = RAW ? null : new WalkAnim(rig.root, id);
// текстура берётся та, что привязана к базовому цвету (а не первая попавшаяся)
const texMat = doc.getRoot().listMaterials().find(m => m.getBaseColorTexture());
const tint = await textureTint(doc, texMat?.getBaseColorTexture());
const TEX = await decodeTexture(doc, texMat?.getBaseColorTexture());
const factor = baseFactor(doc);
if (anim) {
  const found = Object.entries(anim.joints).filter(([k, v]) => k !== 'base' && v).map(([k]) => k);
  console.log(`${id}: кости (${found.length}) ${found.join(', ') || 'НЕ НАЙДЕНЫ'}`);
} else console.log(`${id}: --raw, поза не применяется`);
console.log(`  материал: baseColorFactor ${factor.map(v => v.toFixed(2)).join(', ')}; ${tint.note}`);

// нормализация из манифеста (как в игре)
rig.root.scale.setScalar(item.normalize.scale);
rig.root.rotation.y = item.normalize.rotY;
rig.root.position.set(...item.normalize.offset);

fs.mkdirSync('tools/_render', { recursive: true });
const phases = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
phases.forEach((ph, i) => {
  if (anim) {
    anim.phase = ph;
    for (let k = 0; k < 40; k++) anim.update(1 / 60, 3.1);   // выйти на амплитуду шага
    anim.phase = ph;
    anim.update(1 / 60, 3.1);
  }
  const tris = worldTris(rig);
  for (const [yaw, tag] of [[0, 'front'], [Math.PI / 2, 'side']]) {
    const px = render(tris, yaw, 1.0, tint.rgb, TEX);
    const name = `tools/_render/bot-${id}-${tag}-${i}${RAW ? '-raw' : ''}.png`;
    fs.writeFileSync(name, png(W, H, px));
  }
  if (i === 1) {
    // крупный кадр головы/торса — чтобы проверить, что руки НЕ в T-позе
    const px = render(tris, 0, 2.6, tint.rgb, TEX);
    fs.writeFileSync(`tools/_render/bot-${id}-closeup.png`, png(W, H, px));
  }
});
console.log('  сохранено: tools/_render/bot-' + id + '-{front,side}-*.png');
