// tools/preview-viewmodel.mjs — оффлайн-рендер вида от первого лица для каждого оружия.
//
// Зачем: в песочнице нет браузера, а посадку вьюмодели (масштаб, наклон, куда прикручен
// прицел) надо видеть ГЛАЗАМИ, иначе «детали повёрнуты не туда» ловится только скриншотами
// пользователя. Здесь та же цепочка преобразований, что и в игре:
//   manifest.normalize(scale, rotY, offset) → viewmodel.json(scale, x, y, z, rotY) →
//   камера в начале координат, взгляд вдоль -Z, FOV из игры.
//
// Использование:
//   node tools/preview-viewmodel.mjs                 # все стволы в config/viewmodel.json
//   node tools/preview-viewmodel.mjs pm ak74 svd     # выборочно
//   node tools/preview-viewmodel.mjs --ads ak74      # с прицеливанием (RMB)
// Результат: tools/_render/vm-<id>[-ads].png
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { poseFor } from './lib/vmpose.mjs';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

class THREEBox { constructor(sx, sy, sz) { const x = sx / 2, y = sy / 2, z = sz / 2; this.tris = []; this.p = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]; for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7]]) { this.tris.push([this.p[f[0]], this.p[f[1]], this.p[f[2]]]); this.tris.push([this.p[f[0]], this.p[f[2]], this.p[f[3]]]); } } translate(dx, dy, dz) { return { tris: this.tris.map(t => t.map(p => [p[0] + dx, p[1] + dy, p[2] + dz])) }; } }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const MANIFEST = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8')).items;
const CATALOG = new Map(JSON.parse(fs.readFileSync('config/catalog.json', 'utf8')).items.map(i => [i.id, i]));
const byId = new Map(MANIFEST.map(i => [i.id, i]));
const VM = JSON.parse(fs.readFileSync('config/viewmodel.json', 'utf8'));
const FOV = 75, ASPECT = 16 / 9, W = 800, H = Math.round(W / ASPECT);

// ---------- запись PNG ----------
function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- математика матриц (строка = ось) ----------
const I = () => ({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], t: [0, 0, 0] });
const mul = (m, n) => ({
  a: [0, 1, 2].map(i => m.a[0] * n.a[i] + m.b[0] * n.b[i] + m.c[0] * n.c[i]),
  b: [0, 1, 2].map(i => m.a[1] * n.a[i] + m.b[1] * n.b[i] + m.c[1] * n.c[i]),
  c: [0, 1, 2].map(i => m.a[2] * n.a[i] + m.b[2] * n.b[i] + m.c[2] * n.c[i]),
  t: [0, 1, 2].map(i => m.a[i] * n.t[0] + m.b[i] * n.t[1] + m.c[i] * n.t[2] + m.t[i]),
});
const apply = (m, p) => [0, 1, 2].map(i => m.a[i] * p[0] + m.b[i] * p[1] + m.c[i] * p[2] + m.t[i]);
const T = (x, y, z) => ({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], t: [x, y, z] });
const S = s => ({ a: [s, 0, 0], b: [0, s, 0], c: [0, 0, s], t: [0, 0, 0] });
const RX = r => ({ a: [1, 0, 0], b: [0, Math.cos(r), Math.sin(r)], c: [0, -Math.sin(r), Math.cos(r)], t: [0, 0, 0] });
const RY = r => ({ a: [Math.cos(r), 0, -Math.sin(r)], b: [0, 1, 0], c: [Math.sin(r), 0, Math.cos(r)], t: [0, 0, 0] });
const RZ = r => ({ a: [Math.cos(r), Math.sin(r), 0], b: [-Math.sin(r), Math.cos(r), 0], c: [0, 0, 1], t: [0, 0, 0] });

/** Треугольники узла GLB в локальных координатах документа (без нормализации). */
function nodeTris(doc, filter) {
  const tris = [];
  const scene = doc.getRoot().listScenes()[0];
  const walk = (node, m, nm) => {
    const mm = node.getMatrix();
    let local;
    if (mm) local = { a: [mm[0], mm[1], mm[2]], b: [mm[4], mm[5], mm[6]], c: [mm[8], mm[9], mm[10]], t: [mm[12], mm[13], mm[14]] };
    else {
      const r = node.getRotation(), s = node.getScale();
      const [x, y, z, w] = r;
      const rot = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                   [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                   [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
      local = { a: rot[0].map(v => v * s[0]), b: rot[1].map(v => v * s[1]), c: rot[2].map(v => v * s[2]), t: node.getTranslation() };
    }
    const cur = mul(m, local);
    const name = node.getName();
    const mesh = node.getMesh?.();
    if (mesh && !(filter && filter.test(name))) for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), v = [0, 0, 0];
      const get = i => apply(cur, [pos.getElement(i, v)[0], v[1], v[2]]);
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        tris.push([get(idx ? idx.getScalar(i) : i), get(idx ? idx.getScalar(i + 1) : i + 1), get(idx ? idx.getScalar(i + 2) : i + 2)]);
      }
    }
    node.listChildren().forEach(c => walk(c, cur, name));
  };
  scene.listChildren().forEach(c => walk(c, I(), ''));
  return tris;
}

/** Как AssetLibrary.make(): масштаб/поворот/смещение из манифеста. */
function normalized(doc, item, exclude) {
  const n = item.normalize;
  const re = exclude && exclude.length ? new RegExp(exclude.join('|'), 'i') : null;
  return nodeTris(doc, re).map(t => t.map(p => apply(T(...n.offset), apply(S(n.scale), apply(RY(n.rotY), p)))));
}

// ламберт: без нормалей детали не читаются (всё сливается в один силуэт)
function norm(t) {
  const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
  const v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const L = Math.hypot(...n) || 1;
  n = n.map(x => x / L);
  const dot = n[0] * -0.4 + n[1] * 0.55 + n[2] * -0.73; // свет сверху-слева-сзади камеры
  return 0.30 + 0.70 * Math.max(0, Math.abs(dot));
}

function draw(tris, W, H, fov) {
  const px = Buffer.alloc(W * H * 3);
  // фон: небо + «пол» — чтобы линию горизонта и центр кадра было видно
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const g = y < H * 0.55 ? [120, 140, 160] : [92, 96, 88];
    px[i] = g[0]; px[i + 1] = g[1]; px[i + 2] = g[2];
  }
  const zb = new Float32Array(W * H).fill(-Infinity); // храним -z (глубину вперёд)
  const tanY = Math.tan((fov * Math.PI / 180) / 2);
  const proj = p => { const z = -p[2]; return [W / 2 + (p[0] / (z * tanY * ASPECT)) * (W / 2), H / 2 - (p[1] / (z * tanY)) * (H / 2), z]; };
  for (const t of tris) {
    const shade = norm(t);
    const ps = t.map(proj);
    if (ps.some(p => p[2] <= 0.01)) continue;
    const [ax, ay, az] = ps[0], [bx, by, bz] = ps[1], [cx, cy, cz] = ps[2];
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
      const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = 1 / (w0 / az + w1 / bz + w2 / cz); // перспективно-корректная глубина
      const i = y * W + x;
      if (z > zb[i]) {
        zb[i] = z;
        const fog = Math.max(0.55, Math.min(1, 0.75 + 0.35 * (1 - z / 2.2)));
        const sh = shade * fog;
        px[i * 3] = Math.round(210 * sh); px[i * 3 + 1] = Math.round(200 * sh); px[i * 3 + 2] = Math.round(180 * sh);
      }
    }
  }
  // прицел-перекрестие в центре кадра
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  for (let d = -12; d <= 12; d++) { if (Math.abs(d) > 3) { put(W / 2 + d | 0, H / 2, [255, 90, 90]); put(W / 2 | 0, H / 2 + d, [255, 90, 90]); } }
  return px;
}

const args = process.argv.slice(2);
const ads = args.includes('--ads');
const want = args.filter(a => !a.startsWith('--'));

const only = want.length ? want : Object.keys(VM);
fs.mkdirSync('tools/_render', { recursive: true });
for (const id of only) {
  const item = byId.get(id);
  if (!item || item.placeholder || !item.file) { console.warn(`нет модели: ${id}`); continue; }
  const cfg = VM[id];
  if (!cfg) { console.warn(`нет посадки в viewmodel.json: ${id}`); continue; }
  // в игре загружается собранный файл из public/assets/game — по нему и проверяем
  const file = item.file.replace('assets/', 'public/assets/');
  const doc = await io.read(file);
  // исключённые детали (у ПМ в модели лежит отдельный запасной магазин) — как в игре
  let tris = normalized(doc, item, CATALOG.get(id)?.exclude);
  // габарит вьюмодели в её собственных координатах — от него считается «подняться на линию глаз»
  let top = 0;
  for (const t of tris) for (const p of t) top = Math.max(top, p[1]);

  // --- поза: порт combat.placeViewModel (держать в синхроне!) ---
  const adsT = ads ? 1 : 0;
  let bottom = 1e9, rear = -1e9;
  for (const t of tris) for (const p of t) { bottom = Math.min(bottom, p[1]); rear = Math.max(rear, p[2]); }
  // прицел из примитивов: считаем раньше позы, потому что от него зависит высота ADS
  let opticTris = [];
  let opticLift = 0;
  if (cfg.optic) {
    const sc = cfg.optics ?? 1, R = 0.022, L = 0.16;
    const ox = cfg.opticMount?.x ?? 0, oz = cfg.opticMount?.z ?? -0.10;
    const baseY = cfg.opticMount?.y ?? top;
    opticLift = baseY + R * sc * 0.5;
    const cyl = (r, h, cz, caps = false) => {
      const N = 14, out = [];
      for (let i = 0; i < N; i++) {
        const a1 = (i / N) * Math.PI * 2, a2 = ((i + 1) / N) * Math.PI * 2;
        const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r, x2 = Math.cos(a2) * r, y2 = Math.sin(a2) * r;
        out.push([[x1, y1, cz - h / 2], [x2, y2, cz - h / 2], [x2, y2, cz + h / 2]]);
        out.push([[x1, y1, cz - h / 2], [x2, y2, cz + h / 2], [x1, y1, cz + h / 2]]);
        if (caps) out.push([[0, 0, cz + h / 2], [x1, y1, cz + h / 2], [x2, y2, cz + h / 2]]);
      }
      return out;
    };
    const push = (arr, dy, dz) => arr.forEach(t => opticTris.push(t.map(p => [p[0] * sc + ox, p[1] * sc + dy, p[2] * sc + dz])));
    push(cyl(R, L, 0), baseY, oz);
    push(cyl(R * 1.55, 0.03, -L / 2 - 0.012), baseY, oz);
    push(cyl(R * 1.4, 0.03, L / 2 + 0.012), baseY, oz);
  }
  const pose = poseFor(cfg, { top, rear, opticLift, adsT });
  const rotY = pose.rotY;
  let m = mul(T(...pose.pos), mul(RY(rotY), S(cfg.scale)));
  void bottom;
  tris = tris.concat(opticTris);
  tris = tris.map(t => t.map(p => apply(m, p)));
  const pngBuf = png(W, H, draw(tris, W, H, ads ? (cfg.ads?.fov ?? 45) : FOV));
  const out = `tools/_render/vm-${id}${ads ? '-ads' : ''}.png`;
  fs.writeFileSync(out, pngBuf);
  console.log(`${id}: ${tris.length} тр. → ${out}`);
}
