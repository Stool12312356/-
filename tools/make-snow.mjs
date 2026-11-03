// Генерация зимней текстуры снега public/textures/snow.jpg (без внешних библиотек).
// Нужна потому, что земля зимой не должна быть зелёной: раньше на террайн вешалась
// карта травы, и снег получался болотного оттенка.
//
// Пишем PNG (в нём есть свой zlib через node:zlib) — three грузит текстуру по URL,
// а расширение в tex.ts подставляется из имени. Чтобы не тащить JPEG-энкодер в проект,
// снег лежит как snow.png, а tex.ts пробует оба расширения.
import fs from 'fs';
import zlib from 'zlib';

const W = 512, H = 512;
const px = Buffer.alloc(W * H * 3);
// простое 2D-поле шума: сумма синусов + детерминированный «random» по клеткам
const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // крупные «сугробы»
  const big = smooth(x / 90, y / 90) * 0.6 + smooth(x / 34, y / 34) * 0.3 + smooth(x / 11, y / 11) * 0.1;
  // мелкая крупа
  const grain = (hash(x * 3.1, y * 2.7) - 0.5) * 0.5 + (smooth(x / 3.5, y / 3.5) - 0.5);
  // блики на насте
  const sparkle = hash(x * 7.3, y * 5.1) > 0.997 ? 10 : 0;
  const v = 222 + big * 22 + grain * 9 + sparkle;
  const i = (y * W + x) * 3;
  // снег чуть голубоватый в тенях, тёплый на свету
  px[i] = Math.max(0, Math.min(255, v + 2)) | 0;
  px[i + 1] = Math.max(0, Math.min(255, v + 4)) | 0;
  px[i + 2] = Math.max(0, Math.min(255, v + 7)) | 0;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw, { level: 9 })), ch('IEND', Buffer.alloc(0))]);
fs.writeFileSync('public/textures/snow.png', png);
console.log(`snow.png: ${W}×${H}, ${(png.length / 1024).toFixed(0)} КБ`);
