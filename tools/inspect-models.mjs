// tools/inspect-models.mjs — рендер GLB в PNG БЕЗ браузера (z-buffer, плоская заливка).
// Зачем: в песочнице нет chromium, а проверять ориентацию оружия/деталей надо глазами.
// Использование: node tools/inspect-models.mjs public/assets/game/pm.glb [ещё GLB...]
// Пишет <имя>-side.png (вид сбоку, вдоль +X), -top.png (сверху), -front.png (спереди, вдоль -Z).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Собирает все треугольники сцены в мировых координатах. */
function triangles(doc) {
  const tris = [];
  const scene = doc.getRoot().listScenes()[0];
  const walk = (node, acc) => {
    const m = node.getMatrix();
    let local;
    if (m) local = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]], [m[12], m[13], m[14]]];
    else {
      const t = node.getTranslation(), r = node.getRotation(), s = node.getScale();
      const [x, y, z, w] = r;
      const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                 [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                 [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
      local = [R[0].map(v => v * s[0]), R[1].map(v => v * s[1]), R[2].map(v => v * s[2]), t];
    }
    const ax = [0, 1, 2].map(i => acc[0][i] * local[0][0] + acc[1][i] * local[0][1] + acc[2][i] * local[0][2]);
    const ay = [0, 1, 2].map(i => acc[0][i] * local[1][0] + acc[1][i] * local[1][1] + acc[2][i] * local[1][2]);
    const az = [0, 1, 2].map(i => acc[0][i] * local[2][0] + acc[1][i] * local[2][1] + acc[2][i] * local[2][2]);
    const at = [0, 1, 2].map(i => acc[0][i] * local[3][0] + acc[1][i] * local[3][1] + acc[2][i] * local[3][2] + acc[3][i]);
    const tf = p => [0, 1, 2].map(i => ax[i] * p[0] + ay[i] * p[1] + az[i] * p[2] + at[i]);
    const mesh = node.getMesh?.();
    if (mesh) for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'); const idx = prim.getIndices();
      const v = [0, 0, 0];
      const get = i => { pos.getElement(i, v); return tf([v[0], v[1], v[2]]); };
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        const a = get(idx ? idx.getScalar(i) : i), b = get(idx ? idx.getScalar(i + 1) : i + 1), c = get(idx ? idx.getScalar(i + 2) : i + 2);
        tris.push([a, b, c, node.getName()]);
      }
    }
    node.listChildren().forEach(c => walk(c, [ax, ay, az, at]));
  };
  scene.listChildren().forEach(c => walk(c, [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]]));
  return tris;
}

const VIEWS = {
  // u/v — оси экрана в координатах модели, d — ось глубины (для z-буфера)
  side: { u: 2, v: 1, d: 0 },   // смотрим вдоль +X: видим Z (вправо) и Y (вверх)
  top: { u: 0, v: 2, d: 1 },
  front: { u: 0, v: 1, d: 2 },
};

function render(tris, box, view, W = 700) {
  const { u, v, d } = view;
  const spanU = box.max[u] - box.min[u], spanV = box.max[v] - box.min[v];
  const H = Math.max(80, Math.round(W * (spanV / Math.max(1e-6, spanU))));
  const px = new Uint8Array(W * H * 3).fill(28);
  const zb = new Float32Array(W * H).fill(Infinity);
  const su = (W - 1) / Math.max(1e-6, spanU), sv = (H - 1) / Math.max(1e-6, spanV);
  const toPx = p => [(p[u] - box.min[u]) * su, H - 1 - (p[v] - box.min[v]) * sv];
  for (const [a, b, c] of tris) {
    const [ax, ay] = toPx(a), [bx, by] = toPx(b), [cx, cy] = toPx(c);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
      const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = a[d] * w0 + b[d] * w1 + c[d] * w2;
      const i = y * W + x;
      if (z < zb[i]) {
        zb[i] = z;
        // оттенок по глубине: ближе — светлее, плюс лёгкая подсветка градиентом
        const shade = 0.45 + 0.5 * (1 - (z - box.min[d]) / Math.max(1e-6, box.max[d] - box.min[d]));
        px[i * 3] = Math.round(210 * shade); px[i * 3 + 1] = Math.round(200 * shade); px[i * 3 + 2] = Math.round(180 * shade);
      }
    }
  }
  return { W, H, px };
}

for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const scene = doc.getRoot().listScenes()[0];
  const box = getBounds(scene);
  const size = box.max.map((v, i) => v - box.min[i]);
  const tris = triangles(doc);
  const base = path.join('tools/_render', path.basename(f).replace(/\.glb$/i, ''));
  fs.mkdirSync('tools/_render', { recursive: true });
  for (const [name, view] of Object.entries(VIEWS)) {
    const r = render(tris, box, view, name === 'side' ? 760 : 520);
    fs.writeFileSync(`${base}-${name}.png`, png(r.W, r.H, Buffer.from(r.px)));
  }
  console.log(`${path.basename(f)}: ${tris.length} треугольников, габарит ${size.map(v => +v.toFixed(3)).join(' × ')} м → tools/_render/${path.basename(base)}-{side,top,front}.png`);
}
