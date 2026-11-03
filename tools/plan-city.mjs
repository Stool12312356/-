// Рисует 2D-план ГОРОДА (docs/plan-city-<карта>.png) по тем же данным, что использует игра:
// src/game/maps.ts. Пользователь: «сделай план города перед постройкой его также как и
// с планировкой домов ты делал».
//
// Что на плане:
//   • застройка карты — кварталы домов (хрущёвки/брежневки) и особые здания (казарма,
//     военторг, цеха, проходная) в реальных габаритах и с поворотами;
//   • точки захвата — окружности радиуса захвата с подписями и буквой владельца;
//   • базы сторон (спавны) и путь между ними;
//   • сетка 20 м и масштабная линейка.
import fs from 'fs';
import zlib from 'zlib';
import { MAPS } from '../src/game/maps.ts';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildSpecial } from '../src/game/barracks.ts';

const which = process.argv[2] ?? 'all';
const maps = which === 'all' ? MAPS : MAPS.filter(m => m.id === which);

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 5×7 пиксельный шрифт — подписи без внешних библиотек
const GLYPHS = {
  А: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  Б: ['11111', '10000', '11110', '10001', '10001', '10001', '11110'],
  В: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  Г: ['11111', '10000', '10000', '10000', '10000', '10000', '10000'],
  Д: ['01110', '10010', '10010', '10010', '11111', '10001', '10001'],
  Е: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  Ё: ['01010', '00000', '11111', '10000', '11110', '10000', '11111'],
  Ж: ['10101', '10101', '11111', '10101', '10101', '10101', '10101'],
  З: ['01110', '10001', '00110', '10001', '10001', '10001', '01110'],
  И: ['10001', '10011', '10101', '11001', '10001', '10001', '10001'],
  Й: ['01110', '10001', '10011', '10101', '11001', '10001', '10001'],
  К: ['10001', '10010', '11100', '10010', '10001', '10001', '10001'],
  Л: ['00111', '01001', '01001', '01001', '01001', '11001', '10001'],
  М: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  Н: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  О: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  П: ['11111', '10001', '10001', '10001', '10001', '10001', '10001'],
  Р: ['11110', '10001', '11110', '10000', '10000', '10000', '10000'],
  С: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  Т: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  У: ['10001', '10001', '01010', '00100', '00100', '01000', '10000'],
  Ф: ['00100', '01110', '10101', '10101', '10101', '01110', '00100'],
  Х: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Ц: ['10001', '10001', '10001', '10001', '11111', '00001', '00001'],
  Ч: ['10001', '10001', '01111', '00010', '00010', '00100', '01000'],
  Ш: ['10101', '10101', '10101', '10101', '10101', '10101', '11111'],
  Щ: ['10101', '10101', '10101', '11111', '00001', '00001', '00001'],
  Ь: ['10000', '10000', '11110', '10001', '10001', '11110', '10000'],
  Ы: ['10001', '10001', '10101', '11001', '10101', '10001', '10001'],
  Э: ['01110', '10001', '00001', '00111', '00001', '10001', '01110'],
  Ю: ['10001', '10101', '10111', '10101', '10101', '10101', '10001'],
  Я: ['01111', '10001', '01111', '00100', '01010', '10001', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '№': ['11010', '11011', '10100', '10110', '10100', '10110', '00101'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '01110', '10001', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  'М': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
};

for (const map of maps) {
  // --- границы карты по застройке и точкам
  const xs = [], zs = [];
  const boxes = [];
  for (const h of map.houses) {
    const m = buildVoxelHouse({ kind: h.kind, sections: h.sections });
    const q = Math.abs(Math.round(h.rotY / (Math.PI / 2))) % 2 === 1;
    const sx = q ? m.size[2] : m.size[0], sz = q ? m.size[0] : m.size[2];
    boxes.push({ x: h.pos[0], z: h.pos[2], w: sx, d: sz, name: h.kind, kind: 'house' });
    xs.push(h.pos[0] - sx / 2, h.pos[0] + sx / 2); zs.push(h.pos[2] - sz / 2, h.pos[2] + sz / 2);
  }
  for (const sp of map.specials) {
    const m = buildSpecial(sp.kind, sp.sections);
    const q = Math.abs(Math.round(sp.rotY / (Math.PI / 2))) % 2 === 1;
    const sx = q ? m.size[2] : m.size[0], sz = q ? m.size[0] : m.size[2];
    boxes.push({ x: sp.pos[0], z: sp.pos[2], w: sx, d: sz, name: sp.kind, label: sp.label, kind: 'special' });
    xs.push(sp.pos[0] - sx / 2, sp.pos[0] + sx / 2); zs.push(sp.pos[2] - sz / 2, sp.pos[2] + sz / 2);
  }
  for (const st of map.streets ?? []) { xs.push(st.x0, st.x1); zs.push(st.z0, st.z1); }
  for (const it of map.dressing ?? []) { xs.push(it.pos[0]); zs.push(it.pos[2]); }
  for (const t of map.targets ?? []) { xs.push(t.pos[0]); zs.push(t.pos[2]); }
  // в границы НЕ включаем радиусы точек: они «висят» на зданиях, и карта расползается
  for (const p of map.points) { xs.push(p.pos[0], p.pos[0]); zs.push(p.pos[2], p.pos[2]); }
  xs.push(map.spawns.own[0], map.spawns.foe[0]); zs.push(map.spawns.own[2], map.spawns.foe[2]);
  const MARGIN = 26;
  const minX = Math.min(...xs) - MARGIN, maxX = Math.max(...xs) + MARGIN;
  const minZ = Math.min(...zs) - MARGIN, maxZ = Math.max(...zs) + MARGIN;

  const SCALE = Math.min(4, 1500 / Math.max(maxX - minX, maxZ - minZ));
  const PAD = 40, TOP = 96;
  const W = Math.round((maxX - minX) * SCALE + PAD * 2);
  const H = Math.round((maxZ - minZ) * SCALE + PAD * 2 + TOP);
  const px = Buffer.alloc(W * H * 3, 0);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = ((y | 0) * W + (x | 0)) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };
  const X = x => PAD + (x - minX) * SCALE;
  const Y = z => TOP + PAD + (z - minZ) * SCALE;
  const rect = (x0, y0, x1, y1, c) => { for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) set(x, y, c); };
  const circle = (cx, cy, r, c, thick = 2) => {
    for (let a = 0; a < Math.PI * 2; a += 0.002) for (let t = 0; t < thick; t++) {
      set(Math.round(cx + Math.cos(a) * (r - t)), Math.round(cy + Math.sin(a) * (r - t)), c);
    }
  };
  const text = (s, x, y, c, sc = 2) => {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (g[gy][gx] === '1') rect(cx + gx * sc, y + gy * sc, cx + gx * sc + Math.max(1, sc), y + gy * sc + Math.max(1, sc), c);
      cx += 6 * sc;
    }
  };
  // Подписи не должны наезжать друг на друга и на здания — простая «упаковка»:
  // занятые прямоугольники + перебор позиций вокруг якоря.
  const taken = [];
  const fits = (x, y, w, h) => {
    if (x < 4 || y < TOP || x + w > W - 4 || y + h > H - 26) return false;
    return !taken.some(r => x < r[2] && x + w > r[0] && y < r[3] && y + h > r[1]);
  };
  const place = (str, ax, ay, c, sc = 2, avoid = []) => {
    const w = str.length * 6 * sc - sc, h = 7 * sc;
    const cands = [];
    for (const dy of [-h - 6, 6, -h - 20, 20, -h - 34, 34, -h - 48, 48]) {
      for (const dx of [-w / 2, -w - 6, 6]) cands.push([ax + dx, ay + dy]);
    }
    const hits = (r) => avoid.some(a => r[0] < a[2] && r[2] > a[0] && r[1] < a[3] && r[3] > a[1]);
    // если совсем некуда — ставим в первую позицию и, чтобы подпись осталась читаемой,
    // подчёркиваем её: текст поверх здания иначе сливается
    const ok = cands.find(([x, y]) => fits(x, y, w, h) && !hits([x, y, x + w, y + h]));
    const pick = ok ?? cands[0];
    rect(pick[0] - 1, pick[1] - 1, pick[0] + w + 1, pick[1] + h + 1, [18, 20, 24]);
    taken.push([pick[0], pick[1], pick[0] + w, pick[1] + h]);
    text(str, pick[0], pick[1], c, sc);
    return pick;
  };

  const line = (x0, y0, x1, y1, c, t = 1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) set(Math.round(x + dx), Math.round(y + dy), c);
    }
  };

  const BG = [24, 27, 32], GRID = [38, 43, 50], SNOW = [58, 66, 76], HOUSE = [92, 100, 112],
    SPECIAL = [120, 104, 76], POINT = [230, 84, 56], BASE = [120, 176, 232], INK = [236, 236, 230], DIM = [138, 148, 160];
  rect(0, 0, W, H, BG);

  // сетка 20 м
  for (let gx = Math.ceil(minX / 20) * 20; gx <= maxX; gx += 20) line(X(gx), TOP + PAD, X(gx), H - PAD, GRID);
  for (let gz = Math.ceil(minZ / 20) * 20; gz <= maxZ; gz += 20) line(PAD, Y(gz), W - PAD, Y(gz), GRID);

  // --- УЛИЦЫ (по карте): асфальт с бордюром; дворовые проезды — темнее и уже
  const ROAD = [96, 104, 116], LANE = [74, 81, 91], CURB = [150, 158, 170], TREEC = [70, 122, 92];
  for (const st of map.streets ?? []) {
    const x0 = X(st.x0), x1 = X(st.x1), y0 = Y(st.z0), y1 = Y(st.z1);
    rect(x0, y0, x1, y1, st.lane ? LANE : ROAD);
    if (!st.lane) {
      // бордюр тонкой линией по краям полотна
      line(x0, y0, x1, y0, CURB, 0); line(x0, y1, x1, y1, CURB, 0);
      line(x0, y0, x0, y1, CURB, 0); line(x1, y0, x1, y1, CURB, 0);
      // осевая разметка пунктиром
      if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) {
        const cz = (y0 + y1) / 2;
        for (let x = x0 + 4; x < x1 - 4; x += 10) line(x, cz, x + 5, cz, [180, 176, 152], 0);
      } else {
        const cx = (x0 + x1) / 2;
        for (let y = y0 + 4; y < y1 - 4; y += 10) line(cx, y, cx, y + 5, [180, 176, 152], 0);
      }
      // название улицы — вдоль полотна
      if (st.name) {
        const vert = Math.abs(y1 - y0) > Math.abs(x1 - x0);
        place(st.name, (x0 + x1) / 2 + (vert ? 8 : 0), (y0 + y1) / 2 + (vert ? 0 : -6), [176, 186, 200], 1);
      }
    }
  }

  const NAME = { barracks: 'КАЗАРМА', shop: 'ВОЕНТОРГ', workshop: 'ЦЕХ', checkpoint: 'ПРОХОДНАЯ', panel: 'ПАНЕЛЬКА', brick: 'ХРУЩЁВКА', brezhnevka: 'БРЕЖНЕВКА', khrushchevka: 'ХРУЩЁВКА' };
  const houseBoxes = [], labelBoxes = [];

  // здания
  for (const b of boxes) {
    const x0 = X(b.x - b.w / 2), x1 = X(b.x + b.w / 2), y0 = Y(b.z - b.d / 2), y1 = Y(b.z + b.d / 2);
    const col = b.kind === 'house' ? HOUSE : SPECIAL;
    rect(x0, y0, x1, y1, col);
    // контур
    line(x0, y0, x1, y0, INK, 0); line(x0, y1, x1, y1, INK, 0);
    line(x0, y0, x0, y1, INK, 0); line(x1, y0, x1, y1, INK, 0);
    // «крыша» — диагональная штриховка, чтобы планы читались как застройка
    for (let y = Math.round(y0) + 2; y < y1 - 1; y += 5) line(x0 + 2, y, x1 - 2, y, [col[0] + 18, col[1] + 18, col[2] + 18], 0);
    labelBoxes.push([x0, y0, x1, y1]);
  }

  // названия зданий — внутри контура, если влезает, иначе под ним.
  // Если точка захвата называется так же («Казарма», «Проходная»), вторую подпись не ставим.
  const pointNames = new Set(map.points.map(p => p.name.toUpperCase()));
  for (const b of boxes) {
    const nm = b.label ? b.label.toUpperCase() : (NAME[b.name] ?? b.name.toUpperCase());
    const x0 = X(b.x - b.w / 2), x1 = X(b.x + b.w / 2), y0 = Y(b.z - b.d / 2), y1 = Y(b.z + b.d / 2);
    // шрифт целочисленный: дробный масштаб рвёт глифы, поэтому только 1 или 2
    // масштаб 1 и 2 только: глифы целочисленные, дробь их рвёт
    if (pointNames.has(nm) && b.kind === 'special') continue;
    const w2 = nm.length * 12 - 2, h2 = 14;
    if (x1 - x0 > w2 + 12 && y1 - y0 > h2 + 12) text(nm, (x0 + x1) / 2 - w2 / 2, (y0 + y1) / 2 - h2 / 2, [22, 24, 28], 2);
    else place(nm, (x0 + x1) / 2, y1 + 6, DIM, 1, []);
  }

  // --- МИШЕНИ СТРЕЛЬБИЩА (полигон): крестик + подпись дистанции
  if (map.targets?.length) {
    for (const t of map.targets) {
      const cx = X(t.pos[0]), cy = Y(t.pos[2]);
      line(cx - 4, cy - 4, cx + 4, cy + 4, POINT, 1);
      line(cx - 4, cy + 4, cx + 4, cy - 4, POINT, 1);
    }
    // подпись дистанции у каждого ряда мишеней
    const rows = [...new Set(map.targets.map(t => Math.round(Math.abs(t.pos[0] + 66))))];
    void rows;
    const lineX = X(-66);
    for (const d of [25, 50, 100, 200]) {
      const tx = X(-66 + d);
      if (tx > 0 && tx < W) place(`${d} М`, tx, Y(6), [230, 140, 110], 1);
    }
    void lineX;
  }

  // --- ДВОР: деревья, машины, гаражи, забор, площадка (по dressing.ts)
  const DCOL = {
    tree: TREEC, tree_snow: [96, 148, 118], car: [184, 118, 96], bus: [196, 168, 92],
    garage: [138, 146, 158], fence: [148, 154, 162], playground: [226, 168, 96],
    kiosk: [128, 150, 168], bench: [160, 128, 88], bin: [110, 132, 110], lamp: [176, 182, 190],
  };
  for (const it of map.dressing ?? []) {
    const c = DCOL[it.kind] ?? [150, 150, 150];
    const cx = X(it.pos[0]), cy = Y(it.pos[2]);
    if (it.kind.startsWith('tree')) { circle(cx, cy, 2.5, c, 2); set(cx, cy, [30, 40, 34]); }
    else if (it.kind === 'playground') { rect(cx - 6, cy - 6, cx + 6, cy + 6, c); rect(cx - 3, cy - 3, cx + 3, cy + 3, BG); }
    else if (it.kind === 'garage') rect(cx - 4, cy - 6, cx + 4, cy + 6, c);
    else if (it.kind === 'fence') line(cx - 3, cy, cx + 3, cy, c, 0);
    else if (it.kind === 'lamp') set(cx, cy, c);
    else rect(cx - 3, cy - 4, cx + 3, cy + 4, c);
  }

  // путь между базами (пунктир) и сами базы
  const own = map.spawns.own, foe = map.spawns.foe;
  taken.push([0, 0, W, TOP], [0, H - 24, W, H]);
  for (let t = 0; t < 1; t += 0.012) {
    const x = own[0] + (foe[0] - own[0]) * t, z = own[2] + (foe[2] - own[2]) * t;
    circle(X(x), Y(z), 1.5, DIM, 1);
  }
  circle(X(own[0]), Y(own[2]), 6, BASE, 2); place('СВОИ', X(own[0]), Y(own[2]), BASE, 1);
  circle(X(foe[0]), Y(foe[2]), 6, [226, 120, 96], 2); place('ВРАГ', X(foe[0]), Y(foe[2]), [226, 120, 96], 1);

  // точки захвата
  map.points.forEach((p, i) => {
    circle(X(p.pos[0]), Y(p.pos[2]), p.radius * SCALE, POINT, 2);
    circle(X(p.pos[0]), Y(p.pos[2]), 3, POINT, 2);
    // буква точки — в самом круге, подпись — рядом со свободным местом
    text('АБВГДЕ'[i] ?? '·', X(p.pos[0]) - 5, Y(p.pos[2]) - 7, POINT, 2);
    place(p.name, X(p.pos[0]), Y(p.pos[2]) + p.radius * SCALE + 8, INK, 1, labelBoxes);
  });

  // шапка и легенда
  rect(0, 0, W, TOP - 10, [18, 20, 24]);
  text(map.name, PAD, 14, INK, 3);
  let lx = PAD, ly = 46;
  const swatch = (c, name) => {
    // легенда переносится на вторую строку — иначе последний пункт уезжает за край
    if (lx + 34 + name.length * 12 > W - PAD) { lx = PAD; ly += 22; }
    rect(lx, ly, lx + 14, ly + 12, c); text(name, lx + 20, ly, DIM, 2); lx += 34 + name.length * 12;
  };
  swatch(HOUSE, 'ДОМА');
  swatch(SPECIAL, 'ОСОБЫЕ');
  swatch(POINT, 'ТОЧКИ');
  swatch(BASE, 'БАЗЫ');
  swatch(ROAD, 'УЛИЦЫ');
  swatch(TREEC, 'ДЕРЕВЬЯ');
  swatch(DCOL.playground, 'ДВОР');
  // масштабная линейка: 50 м
  const barLen = 50 * SCALE;
  line(W - PAD - barLen, H - 22, W - PAD, H - 22, INK, 1);
  line(W - PAD - barLen, H - 26, W - PAD - barLen, H - 18, INK, 1);
  line(W - PAD, H - 26, W - PAD, H - 18, INK, 1);
  text('50 М', W - PAD - barLen / 2 - 24, H - 40, DIM, 2);

  const out = `docs/plan-city-${map.id}.png`;
  fs.writeFileSync(out, png(W, H, px));
  console.log(`${out}: ${W}×${H}, ${boxes.length} зданий, ${map.points.length} точек, ${SCALE.toFixed(2)} px/м`);
}
