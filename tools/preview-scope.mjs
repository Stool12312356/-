// Оффлайн-рендер прицельных сеток в PNG — чтобы видеть ровно то, что увидит игрок.
// Ловит ровно тот баг, на который жаловались: «у прицела посередине ничего не видно».
import fs from 'fs';
import zlib from 'zlib';
import { Scope } from '../src/game/scope.ts';

// мини-DOM: Scope создаёт div'ы и пишет innerHTML — нам нужно только вытащить SVG и стили
function fakeDoc() {
  const mk = () => {
    const el = {
      id: '', innerHTML: '', style: {}, children: [],
      firstElementChild: null,
      appendChild(c) { this.children.push(c); return c; },
      // canvas-виньетка: в Node контекста нет, Scope это переживает (null)
      getContext: () => null,
      set innerHTML(v) { this._html = v; this.firstElementChild = v.includes('<svg') ? { style: {} } : null; },
      get innerHTML() { return this._html || ''; },
    };
    return el;
  };
  const body = mk();
  globalThis.document = { body, createElement: mk, getElementById: () => null };
  return body;
}

const body = fakeDoc();
const scope = new Scope(body);
const W = 700, H = 640;
const out = { optic: [0, 0, 0, []], iron: [0, 0, 0, []], pistol: [0, 0, 0, []] };

/** Разбор очень узкого подмножества SVG, которое используется в scope.ts. */
function parseSvg(svg) {
  const shapes = [];
  let stroke = '#000', sw = 1, fill = 'none';
  const re = /<(\/?)(circle|line|g|svg)([^>]*?)(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(svg))) {
    const [, close, tag, attrs, self] = m;
    const a = {};
    for (const am of attrs.matchAll(/(\w[\w-]*)="([^"]*)"/g)) a[am[1]] = am[2];
    if (tag === 'g' || tag === 'svg') {
      if (!close && !self) stack.push({ stroke, sw, fill });
      else if (close) { const p = stack.pop(); if (p) { stroke = p.stroke; sw = p.sw; fill = p.fill; } }
      continue;
    }
    stroke = a.stroke ?? stroke;
    if (a['stroke-width']) sw = parseFloat(a['stroke-width']);
    fill = a.fill ?? (a['stroke'] ? 'none' : fill);
    shapes.push({ tag, a, stroke, sw, fill: a.fill ?? 'none' });
  }
  return shapes;
}

for (const kind of ['optic', 'iron', 'pistol']) {
  scope.show(kind, 1);   // перерисует innerHTML
  // в body сначала идёт виньетка, потом сам оверлей — берём тот, где есть svg
  const el = body.children.find(c => (c.innerHTML || '').includes('<svg'));
  if (!el) throw new Error(`Scope не создал сетку для ${kind}`);
  const svg = el.innerHTML;
  out[kind][3] = parseSvg(svg);
  // размер: 62vmin для оптики, 34vmin для остальных. vmin = H
  out[kind][0] = kind === 'optic' ? 0.62 * H : 0.34 * H;
}

function render(kind) {
  const [size, , , shapes] = out[kind];
  const W2 = 700, H2 = 640;
  const px = Buffer.alloc(W2 * H2 * 3);
  // фон = «мир»: небо + земля + дом, чтобы видеть, что центр НЕ закрыт
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = (y * W2 + x) * 3; const s = y / H2;
    px[i] = (150 + 40 * (1 - s)) | 0; px[i + 1] = (175 + 25 * (1 - s)) | 0; px[i + 2] = (200 + 20 * (1 - s)) | 0;
  }
  // «дом» на горизонте — чтобы центр был заведомо виден
  for (let y = 240; y < 420; y++) for (let x = 180; x < 520; x++) {
    const i = (y * W2 + x) * 3;
    const win = (x % 40 < 14) && (y % 46 < 16);
    px[i] = win ? 90 : 200; px[i + 1] = win ? 110 : 196; px[i + 2] = win ? 130 : 188;
  }
  const cx = W2 / 2, cy = H2 / 2, k = size / 100;
  // виньетка
  if (kind === 'optic') {
    // ровно как canvas в Scope.paintVignette: чёрно ВСЁ, кроме круга окуляра
    const R = size / 2;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const d = Math.hypot(x - cx, y - cy);
      // внутри окуляра кадр не трогаем (множитель 1), снаружи — в чёрное (0)
      const fade = Math.min(1, Math.max(0, (d - R * 0.9) / (R * 0.12)));
      const keep = 1 - fade;
      const i = (y * W2 + x) * 3;
      px[i] *= keep; px[i + 1] *= keep; px[i + 2] *= keep;
    }
  }
  const blend = (x, y, col, alpha) => {
    if (x < 0 || y < 0 || x >= W2 || y >= H2) return;
    const i = (y * W2 + x) * 3;
    px[i] = px[i] * (1 - alpha) + col[0] * alpha;
    px[i + 1] = px[i + 1] * (1 - alpha) + col[1] * alpha;
    px[i + 2] = px[i + 2] * (1 - alpha) + col[2] * alpha;
  };
  const parseColor = (c) => {
    if (!c || c === 'none') return null;
    if (c === '#0b0b0b') return [11, 11, 11];
    if (c === '#e8342b') return [232, 52, 43];
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    return [0, 0, 0];
  };
  const thickLine = (x1, y1, x2, y2, w, col, alpha) => {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) + 1;
    for (let t = 0; t <= n; t++) {
      const x = x1 + (x2 - x1) * t / n, y = y1 + (y2 - y1) * t / n;
      const r = w / 2;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        blend(Math.round(x + dx), Math.round(y + dy), col, alpha);
      }
    }
  };
  for (const s of shapes) {
    const a = s.a;
    if (s.tag === 'line') {
      const col = parseColor(s.stroke);      // stroke наследуется из <g>, а не лежит в атрибутах line
      if (!col) continue;
      const alpha = (s.stroke.startsWith('rgba') ? (col[3] ?? 1) : 1);
      thickLine(+(a.x1) * k + cx - 50 * k, +(a.y1) * k + cy - 50 * k, +(a.x2) * k + cx - 50 * k, +(a.y2) * k + cy - 50 * k, Math.max(1, s.sw * k), col, alpha);
    } else if (s.tag === 'circle') {
      const ccx = +a.cx * k + cx - 50 * k, ccy = +a.cy * k + cy - 50 * k, r = +a.r * k;
      const col = parseColor(s.stroke);
      const fillCol = parseColor(a.fill);
      if (fillCol && a.fill !== 'none') {
        // ЗАЛИВКА: если она закрывает центр (r большой и цвет непрозрачный) — это баг
        for (let y = Math.floor(ccy - r); y <= ccy + r; y++) for (let x = Math.floor(ccx - r); x <= ccx + r; x++) {
          if ((x - ccx) ** 2 + (y - ccy) ** 2 > r * r) continue;
          blend(x, y, fillCol, fillCol[3] ?? 1);
        }
      }
      if (col) {
        const alpha = (s.stroke || '').startsWith('rgba') ? (col[3] ?? 1) : 1;
        const steps = Math.max(48, Math.round(r * 6));
        for (let t = 0; t <= steps; t++) {
          const ang = t / steps * Math.PI * 2;
          const x = ccx + Math.cos(ang) * r, y = ccy + Math.sin(ang) * r;
          const w = Math.max(1, s.sw * k);
          for (let dy = -w / 2; dy <= w / 2; dy += 1) for (let dx = -w / 2; dx <= w / 2; dx += 1) blend(Math.round(x + dx), Math.round(y + dy), col, alpha);
        }
      }
    }
  }
  return { W: W2, H: H2, px };
}

function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync('tools/_render', { recursive: true });
let bad = 0;
for (const kind of ['optic', 'iron', 'pistol']) {
  const r = render(kind);
  // центр кадра: ищем, не залит ли он (цвет должен отличаться от «чёрного диска»)
  const i = ((r.H / 2 | 0) * r.W + (r.W / 2 | 0)) * 3;
  const centerLum = (r.px[i] + r.px[i + 1] + r.px[i + 2]) / 3;
  const corner = ((10 * r.W + 10) * 3);
  const cornerLum = (r.px[corner] + r.px[corner + 1] + r.px[corner + 2]) / 3;
  const ring = (() => {
    // яркость на 20 px от центра — там должна быть сетка, а не чёрная заливка
    const j = ((r.H / 2 | 0) * r.W + (r.W / 2 | 0) + 20) * 3;
    return (r.px[j] + r.px[j + 1] + r.px[j + 2]) / 3;
  })();
  console.log(`${kind}: яркость в центре ${centerLum.toFixed(0)}, рядом ${ring.toFixed(0)}, угол ${cornerLum.toFixed(0)}`);
  // в центре ДОЛЖНО быть видно мир; у оптики угол кадра — чёрный, у остальных — прозрачный
  // у обычных сеток в самом центре стоит точка прицела — она чёрная по замыслу,
  // поэтому смотрим чуть в стороне (12 px): там должен быть виден мир
  const side = ((r.H / 2 | 0) * r.W + (r.W / 2 | 0) + 12) * 3;
  const sideLum = (r.px[side] + r.px[side + 1] + r.px[side + 2]) / 3;
  if (sideLum < 60) bad++;
  if (kind === 'optic' && centerLum < 60) bad++;
  if (kind === 'optic' && cornerLum > 40) { console.log('  виньетка не затемняет край кадра'); bad++; }
  if (kind !== 'optic' && cornerLum < 100) { console.log('  виньетка не должна закрывать кадр у обычного прицела'); bad++; }
  if (!out[kind][3].length) { console.log(`${kind}: сетка ПУСТАЯ — нечего рисовать`); bad++; }
  fs.writeFileSync(`tools/_render/scope-${kind}.png`, png(r.W, r.H, r.px));
}
fs.copyFileSync('tools/_render/scope-optic.png', 'tools/_render/scope-optic.png');
console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ — центр залит' : 'OK'} — в центре прицела видно мир, картинки в tools/_render/scope-*.png`);
process.exit(bad ? 1 : 0);

console.log('отладка: разобрано фигур', out.optic[3].length, 'первая', JSON.stringify(out.optic[3][0]));
console.log('отладка: размер', out.optic[0]);
