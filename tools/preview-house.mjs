// tools/preview-house.mjs — оффлайн-рендер дома-конструктора в PNG (без браузера).
// Собирает панели так же, как игра (panels.ts: buildPanelGeometry + matrix), и рисует
// вид снаружи. Нужен, чтобы ловить «решето», дыры и торчащие детали ДО скриншотов игрока.
//   node tools/preview-house.mjs                       → хрущёвка с фасада
//   node tools/preview-house.mjs brezhnevka front/back/side
import fs from 'fs';
import zlib from 'zlib';
import * as THREE from 'three';
import { buildHouse } from '../src/game/house.ts';
import { buildPanelGeometry, layoutPanel } from '../src/game/panels.ts';

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

const spec = buildHouse({ kind: process.argv[2] === 'brezhnevka' ? 'brezhnevka' : 'khrushchevka', sections: 2, seed: 42 });
// треугольники всех панелей в мировых координатах
const tris = [];
for (const p of spec.panels) {
  const { body } = buildPanelGeometry(p.def);
  const m = new THREE.Matrix4().makeRotationY(p.rotY).setPosition(p.pos[0], p.pos[1], p.pos[2]);
  // ВАЖНО: BoxGeometry индексированная (4 вершины на грань) — без развёртки индексов
  // получались случайные треугольники («мусор» на превью).
  const g = body.clone().applyMatrix4(m).toNonIndexed();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    tris.push([
      [pos.getX(i), pos.getY(i), pos.getZ(i)],
      [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)],
      [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)],
    ]);
  }
  // стекло рисуем полупрозрачным маркером: рисуем как отдельный «синий» треугольник
  if (p.def.glass && p.def.opening) {
    const w = (p.def.opening.x1 - p.def.opening.x0) * p.def.w;
    const h = (p.def.opening.y1 - p.def.opening.y0) * p.def.h;
    const cx = -p.def.w / 2 + ((p.def.opening.x0 + p.def.opening.x1) / 2) * p.def.w;
    const cy = -p.def.h / 2 + ((p.def.opening.y0 + p.def.opening.y1) / 2) * p.def.h;
    const gm = new THREE.PlaneGeometry(w, h).translate(cx, cy, 0).applyMatrix4(m).toNonIndexed();
    const gp = gm.attributes.position;
    for (let i = 0; i < gp.count; i += 3) {
      const t = [[gp.getX(i), gp.getY(i), gp.getZ(i)], [gp.getX(i + 1), gp.getY(i + 1), gp.getZ(i + 1)], [gp.getX(i + 2), gp.getY(i + 2), gp.getZ(i + 2)]];
      t.glass = true;
      tris.push(t);
    }
  }
}
console.log('панелей', spec.panels.length, 'треугольников', tris.length, 'габарит', spec.size.map(v => v.toFixed(1)).join('×'));

// камера: извне, чуть сверху, смотрим на центр дома
const VIEWS = {
  front: { eye: [0, spec.size[1] * 0.42, -spec.size[2] * 2.4], up: [0, 1, 0] },
  back: { eye: [0, spec.size[1] * 0.42, spec.size[2] * 2.4], up: [0, 1, 0] },
  side: { eye: [spec.size[0] * 1.6, spec.size[1] * 0.42, 0], up: [0, 1, 0] },
  above: { eye: [spec.size[0] * 0.9, spec.size[1] * 1.4, -spec.size[2] * 1.6], up: [0, 1, 0] },
};

function render(view, W = 900) {
  const H = Math.round(W * 0.66);
  const eye = view.eye, up = view.up;
  const at = [0, spec.size[1] * 0.45, 0];
  const f = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
  const fl = Math.hypot(...f); const fw = f.map(v => v / fl);
  const r = [fw[1] * up[2] - fw[2] * up[1], fw[2] * up[0] - fw[0] * up[2], fw[0] * up[1] - fw[1] * up[0]];
  const rl = Math.hypot(...r); const right = r.map(v => v / rl);
  const u = [right[1] * fw[2] - right[2] * fw[1], right[2] * fw[0] - right[0] * fw[2], right[0] * fw[1] - right[1] * fw[0]];
  const tanY = Math.tan((50 * Math.PI / 180) / 2), aspect = W / H;
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const sky = 1 - y / H;
    px[i] = Math.round(120 + 40 * sky); px[i + 1] = Math.round(150 + 30 * sky); px[i + 2] = Math.round(185 + 25 * sky);
  }
  const zb = new Float32Array(W * H).fill(Infinity);
  const proj = p => {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    if (z <= 0.05) return null;
    const sx = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (z * tanY * aspect);
    const sy = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (z * tanY);
    return [W / 2 + sx * W / 2, H / 2 - sy * H / 2, z];
  };
  for (const t of tris) {
    const ps = t.map(proj);
    if (ps.some(p => !p)) continue;
    const [ax, ay, az] = ps[0], [bx, by, bz] = ps[1], [cx2, cy2, cz2] = ps[2];
    const area = (bx - ax) * (cy2 - ay) - (cx2 - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    // ламберт
    const e1 = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
    const e2 = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...n) || 1; n = n.map(v => v / nl);
    const light = 0.45 + 0.55 * Math.max(0, n[0] * 0.5 + n[1] * 0.7 + n[2] * -0.5);
    const base = t.glass ? [120, 175, 205] : [207, 202, 189];
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx2))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx2)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy2))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy2)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx - x) * (cy2 - y) - (cx2 - x) * (by - y)) / area;
      const w1 = ((cx2 - x) * (ay - y) - (ax - x) * (cy2 - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = 1 / (w0 / az + w1 / bz + w2 / cz2);
      const i = y * W + x;
      if (z >= zb[i]) continue;
      zb[i] = z;
      const fog = Math.min(1, z / 260);
      px[i * 3] = Math.round((base[0] * light) * (1 - fog * 0.4) + 150 * fog * 0.4);
      px[i * 3 + 1] = Math.round((base[1] * light) * (1 - fog * 0.4) + 170 * fog * 0.4);
      px[i * 3 + 2] = Math.round((base[2] * light) * (1 - fog * 0.4) + 200 * fog * 0.4);
    }
  }
  return { W, H, px };
}

fs.mkdirSync('tools/_render', { recursive: true });
const want = process.argv[3] ? [process.argv[3]] : Object.keys(VIEWS);
for (const name of want) {
  const r = render(VIEWS[name]);
  const out = `tools/_render/house-${spec.kind}-${name}.png`;
  fs.writeFileSync(out, png(r.W, r.H, Buffer.from(r.px)));
  console.log('→', out);
}
