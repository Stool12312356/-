// Рисует 2D-план квартиры (docs/plan-2k.png) по тем же данным, что использует генератор дома.
// Пользователь: «сделай 2д план квартиры, можешь скинуть фото как выглядит — и по своему же
// фото делай планировку». Поэтому план и дом строятся из одного файла src/game/plan.ts.
import fs from 'fs';
import zlib from 'zlib';
import { apartmentPlan, furnish } from '../src/game/plan.ts';
import { staircaseInfo } from '../src/game/staircase.ts';

/** высота этажа та же, что в voxelgen (кратна 0.5) */
const FLOOR_H = 3.0;

const plan = apartmentPlan(process.argv[2] === 'brezhnevka' ? 'brezhnevka' : 'khrushchevka');
const SCALE = 68;                        // пикселей на метр
const PAD = 56;
const W = Math.round(plan.w * SCALE + PAD * 2);
const H = Math.round(plan.d * SCALE + PAD * 2);

const px = Buffer.alloc(W * H * 3, 0);
const set = (x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
};
const rect = (x0, y0, x1, y1, c) => {
  for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) set(x, y, c);
};
const line = (x0, y0, x1, y1, c, t = 3) => {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) if (dx * dx + dy * dy <= t * t) set(Math.round(x + dx), Math.round(y + dy), c);
  }
};
// мировые координаты плана → пиксели (z растёт вниз, фасад сверху)
const X = (x) => PAD + (x + plan.w / 2) * SCALE;
const Y = (z) => PAD + (z + plan.d / 2) * SCALE;

const BG = [30, 32, 36], FLOOR = [58, 62, 68], INK = [240, 240, 235], DIM = [140, 148, 158], DOOR = [90, 200, 120];
rect(0, 0, W, H, BG);

// заливка комнат
const ROOM_FILL = {
  living: [74, 82, 92], bedroom: [80, 74, 88], kid: [74, 86, 80],
  kitchen: [92, 84, 70], bath: [70, 84, 94], hall: [62, 66, 72],
};
for (const r of plan.rooms) {
  rect(X(r.x0), Y(r.z0), X(r.x1), Y(r.z1), ROOM_FILL[r.id] ?? FLOOR);
}

// наружные стены
rect(X(-plan.w / 2) - 8, Y(-plan.d / 2) - 8, X(plan.w / 2) + 8, Y(-plan.d / 2) + 2, INK);
rect(X(-plan.w / 2) - 8, Y(plan.d / 2) - 2, X(plan.w / 2) + 8, Y(plan.d / 2) + 8, INK);
rect(X(-plan.w / 2) - 8, Y(-plan.d / 2) - 8, X(-plan.w / 2) + 2, Y(plan.d / 2) + 8, INK);
rect(X(plan.w / 2) - 2, Y(-plan.d / 2) - 8, X(plan.w / 2) + 8, Y(plan.d / 2) + 8, INK);

// внутренние стены с дверными проёмами
for (const wseg of plan.walls) {
  const horiz = Math.abs(wseg.z1 - wseg.z0) < 1e-6;
  const len = horiz ? Math.abs(wseg.x1 - wseg.x0) : Math.abs(wseg.z1 - wseg.z0);
  for (let t = 0; t < len; t += 0.02) {
    const open = wseg.doors.some(([a, b]) => t >= a && t <= b);
    if (open) continue;
    const x = horiz ? wseg.x0 + t : wseg.x0;
    const z = horiz ? wseg.z0 : wseg.z0 + t;
    const px0 = X(x), py0 = Y(z);
    rect(px0 - 3, py0 - 3, px0 + 3, py0 + 3, INK);
  }
  // дверные проёмы подсвечиваем
  for (const [a, b] of wseg.doors) {
    const x0 = horiz ? wseg.x0 + a : wseg.x0, z0 = horiz ? wseg.z0 : wseg.z0 + a;
    const x1 = horiz ? wseg.x0 + b : wseg.x0, z1 = horiz ? wseg.z0 : wseg.z0 + b;
    line(X(x0), Y(z0), X(x1), Y(z1), DOOR, 2);
  }
}

// мебель: те же позиции, что увидит игрок в доме (furnish() из plan.ts)
function furniture(kind, cx, cz, rot) {
  const s = SCALE;
  const box = (w, d, col) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (let y = -d / 2; y <= d / 2; y += 0.05) for (let x = -w / 2; x <= w / 2; x += 0.05) {
      const wx = cx + x * c - y * sn, wz = cz + x * sn + y * c;
      set(Math.round(X(wx)), Math.round(Y(wz)), col);
    }
  };
  switch (kind) {
    case 'bed': box(1.4, 2.0, [120, 140, 170]); break;
    case 'sofa': box(2.0, 0.9, [130, 120, 160]); break;
    case 'table': box(1.0, 0.8, [150, 130, 100]); break;
    case 'kitchen': box(2.4, 0.6, [170, 150, 110]); break;
    case 'fridge': box(0.6, 0.6, [180, 190, 200]); break;
    case 'wardrobe': box(1.6, 0.6, [120, 100, 80]); break;
    case 'shelf': box(1.2, 0.35, [110, 95, 80]); break;
    case 'tv': box(1.0, 0.25, [60, 60, 65]); break;
    case 'toilet': box(0.4, 0.6, [200, 210, 220]); break;
    case 'bath': box(1.7, 0.8, [200, 215, 230]); break;
    case 'sink': box(0.6, 0.5, [190, 205, 215]); break;
    case 'chair': box(0.45, 0.45, [140, 130, 110]); break;
    case 'carpet': box(1.8, 1.2, [110, 70, 70]); break;
    case 'lamp': box(0.3, 0.3, [220, 210, 150]); break;
  }
}
for (const r of plan.rooms) for (const f of furnish(r)) furniture(f.kind, f.x, f.z, f.rot);

// ЛЕСТНИЦА: марши и площадки рисуем по тем же размерам, что строит src/game/staircase.ts,
// иначе на плане клетка пустая, а в игре там лестница (план обязан совпадать с домом).
{
  const st = staircaseInfo(plan, FLOOR_H);
  const INSET = 0.15, LANDING = st.landing;
  const x0 = plan.stairs.x0 + INSET, x1 = plan.stairs.x1 - INSET;
  const zF = plan.stairs.z0 + INSET, zB = plan.stairs.z1 - INSET;
  const mid = (x0 + x1) / 2;
  const STEP = [190, 182, 168], PLAT = [150, 148, 140];
  const band = (xa, xb, za, zb, col) => {
    for (let x = xa; x <= xb; x += 0.03) for (let z = za; z <= zb; z += 0.03) set(Math.round(X(x)), Math.round(Y(z)), col);
  };
  // марш 0 (левая половина, от фасада вглубь) и марш 1 (правая, от тыла к фасаду)
  const zf0 = zF + LANDING, zb1 = zB - LANDING;
  for (let i = 0; i < st.steps; i++) {
    const za = zf0 + i * st.tread, zb = za + st.tread;
    const c = i % 2 ? STEP : [170, 164, 152];
    band(x0, mid - 0.02, za, zb, c);              // марш 0
    const za2 = zb1 - (i + 1) * st.tread, zb2 = za2 + st.tread;
    band(mid + 0.02, x1, za2, zb2, c);            // марш 1
  }
  band(x0, x1, zF, zf0, PLAT);                    // фасадная площадка (вход/выход)
  band(x0, x1, zb1, zB, PLAT);                    // площадка разворота
  // стрелка подъёма
  line(X(x0 + 0.25), Y(zf0 + 0.2), X(x0 + 0.25), Y(zb1 - 0.2), [250, 210, 120], 2);
  line(X(x0 + 0.25), Y(zb1 - 0.2), X(mid + 0.25), Y(zb1 - 0.2), [250, 210, 120], 2);
  line(X(mid + 0.25), Y(zb1 - 0.2), X(mid + 0.25), Y(zf0 + 0.3), [250, 210, 120], 2);
}

// подписи комнат: пиксельные буквы 3×5 (кириллица в PNG не нужна — подписи в README)
const GLYPH = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], W: ['101', '101', '111', '111', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  V: ['101', '101', '101', '101', '010'], G: ['011', '100', '101', '101', '011'],
  P: ['110', '101', '110', '100', '100'], X: ['101', '101', '010', '101', '101'],
};
const text = (str, x, y, col = [235, 238, 240], sc = 3) => {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = GLYPH[ch];
    if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1') rect(cx + c * sc, y + r * sc, cx + c * sc + sc, y + r * sc + sc, col);
    cx += 4 * sc;
  }
};
const LABEL = {
  living: ['LIVING', [200, 220, 255]], bedroom: ['BEDROOM', [220, 200, 255]],
  kids: ['KIDS', [200, 255, 220]], study: ['STUDY', [235, 225, 200]],
  kitchen: ['KITCHEN', [255, 230, 170]],
  bath: ['BATH', [180, 230, 255]], hall: ['HALL', [200, 255, 200]],
  stairs: ['STAIRS', [225, 225, 225]],
};
for (const r of plan.rooms) {
  const [name, col] = LABEL[r.id] ?? [r.id.toUpperCase(), [220, 220, 220]];
  const cx = X((r.x0 + r.x1) / 2) - name.length * 4;
  const cy = Y((r.z0 + r.z1) / 2) - 4;
  text(name, cx, cy, col, 2);
}
// вход
line(X(plan.entrance.x), Y(-plan.d / 2) - 34, X(plan.entrance.x), Y(-plan.d / 2) - 6, [255, 120, 90], 4);
text('ENTRANCE', X(plan.entrance.x) + 14, Y(-plan.d / 2) - 30, [255, 140, 110], 2);

function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/plan-2k.png', png(W, H, px));
console.log(`план записан: docs/plan-2k.png ${W}×${H}, комнат ${plan.rooms.length}, стен ${plan.walls.length}`);
for (const r of plan.rooms) console.log(`  ${r.name}: ${(r.x1 - r.x0).toFixed(1)}×${(r.z1 - r.z0).toFixed(1)} м, мебель: ${r.furniture.join(', ')}`);
