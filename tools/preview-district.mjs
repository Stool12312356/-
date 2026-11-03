// ПРЕВЬЮ РАЙОНА (оффлайн, без браузера).
//
// Проверка «как это выглядит» по данным карты: дома, улицы, двор, деревья. Собирает
// боксы из maps.ts + streets.ts + dressing.ts и рисует программным растеризатором с
// z-буфером (тот же приём, что в preview-house.mjs). Нужен, чтобы поймать «дом на
// дороге», «дерево в стене» и пустой двор ДО того, как это увидит игрок.
//
//   node tools/preview-district.mjs            → docs/district-spalny-bird.png + -street.png
//   node tools/preview-district.mjs zavod
import fs from 'fs';
import zlib from 'zlib';
import { getMap } from '../src/game/maps.ts';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildSpecial } from '../src/game/barracks.ts';
import { heightAt } from '../src/game/terrain.ts';

const ID = process.argv[2] ?? 'spalny';
const map = getMap(ID);

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

// ---------- сбор геометрии: треугольники с цветом ----------
const tris = [];
const addBox = (x, y, z, w, h, d, color, rotY = 0) => {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const P = (px, py, pz) => [x + px * c + pz * s, y + py, z - px * s + pz * c];
  const v = [
    P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(-hw, hh, -hd),
    P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd),
  ];
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7]];
  for (const f of faces) {
    const [a, b, cc, dd] = f.map(i => v[i]);
    tris.push({ p: [a, b, cc], color });
    tris.push({ p: [a, cc, dd], color });
  }
};
const addFlat = (x, z, w, d, color, y = 0.03) => addBox(x, y, z, w, 0.04, d, color);

const C = {
  khrush: [196, 190, 176], brezh: [208, 202, 188], shop: [176, 92, 78], barrack: [150, 120, 84],
  road: [72, 76, 82], lane: [86, 90, 96], snow: [232, 240, 246], tree: [58, 96, 74],
  trunk: [74, 58, 44], car: [140, 70, 70], garage: [110, 116, 124], fence: [150, 156, 162],
  lamp: [110, 116, 122], bench: [140, 108, 70], ground: [222, 230, 238],
};

for (const h of map.houses) {
  const m = buildVoxelHouse({ kind: h.kind, sections: h.sections });
  const q = Math.abs(Math.round(h.rotY / (Math.PI / 2))) % 2 === 1;
  const sx = q ? m.size[2] : m.size[0], sz = q ? m.size[0] : m.size[2];
  addBox(h.pos[0], h.pos[1] + m.size[1] / 2, h.pos[2], sx, m.size[1], sz, h.kind === 'brezhnevka' ? C.brezh : C.khrush);
}
for (const s of map.specials) {
  const m = buildSpecial(s.kind, s.sections);
  const q = Math.abs(Math.round(s.rotY / (Math.PI / 2))) % 2 === 1;
  const sx = q ? m.size[2] : m.size[0], sz = q ? m.size[0] : m.size[2];
  addBox(s.pos[0], s.pos[1] + m.size[1] / 2, s.pos[2], sx, m.size[1], sz, s.kind === 'shop' ? C.shop : C.barrack);
}
for (const st of map.streets ?? []) {
  const y = Math.max(heightAt(st.x0, st.z0), heightAt(st.x1, st.z1)) + 0.04;
  addFlat((st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2, st.x1 - st.x0, st.z1 - st.z0, st.lane ? C.lane : C.road, y);
}
const KIND_SIZE = {
  tree: [2.6, 6, 2.6], tree_snow: [2.6, 6, 2.6], bench: [1.8, 0.9, 0.5], playground: [6, 2.4, 6],
  garage: [3.5, 2.5, 6], car: [1.9, 1.5, 4.2], bus: [2.5, 3, 10], kiosk: [3.4, 2.7, 2.4],
  fence: [2.4, 1.9, 0.2], bin: [0.7, 0.9, 0.7], lamp: [0.3, 6.2, 0.3],
};
for (const it of map.dressing ?? []) {
  const sz = KIND_SIZE[it.kind] ?? [2, 2, 2];
  const col = it.kind.startsWith('tree') ? (it.kind === 'tree_snow' ? C.snow : C.tree) : (C[it.kind] ?? [150, 150, 150]);
  addBox(it.pos[0], sz[1] / 2, it.pos[2], sz[0], sz[1], sz[2], col, it.rotY ?? 0);
}

// ---------- растеризатор ----------
function render({ eye, at, W, H, fov = 55, fogNear = 120, fogFar = 420, skyTop = [96, 128, 168], skyBot = [206, 220, 232] }) {
  const up = [0, 1, 0];
  const f = at.map((v, i) => v - eye[i]);
  const fl = Math.hypot(...f); const fw = f.map(v => v / fl);
  const r = [fw[1] * up[2] - fw[2] * up[1], fw[2] * up[0] - fw[0] * up[2], fw[0] * up[1] - fw[1] * up[0]];
  const rl = Math.hypot(...r) || 1; const right = r.map(v => v / rl);
  const u = [right[1] * fw[2] - right[2] * fw[1], right[2] * fw[0] - right[0] * fw[2], right[0] * fw[1] - right[1] * fw[0]];
  const tanY = Math.tan((fov * Math.PI / 180) / 2), aspect = W / H;
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      px[i] = Math.round(skyTop[0] + (skyBot[0] - skyTop[0]) * t);
      px[i + 1] = Math.round(skyTop[1] + (skyBot[1] - skyTop[1]) * t);
      px[i + 2] = Math.round(skyTop[2] + (skyBot[2] - skyTop[2]) * t);
    }
  }
  const zb = new Float32Array(W * H).fill(Infinity);
  const proj = p => {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    if (z <= 0.2) return null;
    const sx = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (z * tanY * aspect);
    const sy = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (z * tanY);
    return [W / 2 + sx * W / 2, H / 2 - sy * H / 2, z];
  };
  // земля: снег, иначе район «висит» в воздухе и не видно, где дороги
  tris.unshift(
    { p: [[-260, 0.01, -260], [260, 0.01, -260], [260, 0.01, 260]], color: C.ground },
    { p: [[-260, 0.01, -260], [260, 0.01, 260], [-260, 0.01, 260]], color: C.ground },
  );
  for (const t of tris) {
    const ps = t.p.map(proj);
    if (ps.some(p => !p)) continue;
    const [ax, ay, az] = ps[0], [bx, by, bz] = ps[1], [cx2, cy2, cz2] = ps[2];
    const area = (bx - ax) * (cy2 - ay) - (cx2 - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const e1 = [t.p[1][0] - t.p[0][0], t.p[1][1] - t.p[0][1], t.p[1][2] - t.p[0][2]];
    const e2 = [t.p[2][0] - t.p[0][0], t.p[2][1] - t.p[0][1], t.p[2][2] - t.p[0][2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...n) || 1; n = n.map(v => v / nl);
    const light = 0.55 + 0.45 * Math.max(0, n[0] * 0.35 + n[1] * 0.82 + n[2] * -0.45);
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx2))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx2)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy2))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy2)));
    if (maxX < 0 || maxY < 0 || minX >= W || minY >= H) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx - x) * (cy2 - y) - (cx2 - x) * (by - y)) / area;
      const w1 = ((cx2 - x) * (ay - y) - (ax - x) * (cy2 - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = 1 / (w0 / az + w1 / bz + w2 / cz2);
      const i = y * W + x;
      if (z >= zb[i]) continue;
      zb[i] = z;
      const fog = Math.min(1, Math.max(0, (z - fogNear) / (fogFar - fogNear)));
      for (let k = 0; k < 3; k++) {
        const base = t.color[k] * light;
        px[i * 3 + k] = Math.round(base * (1 - fog) + [198, 210, 222][k] * fog);
      }
    }
  }
  return { W, H, px };
}

fs.mkdirSync('docs', { recursive: true });
const views = [
  { name: 'bird', eye: [6, 118, 158], at: [0, 0, -4], W: 1280, H: 860, fov: 50, fogNear: 190, fogFar: 430 },
  { name: 'street', eye: [-96, 2.2, -4], at: [-30, 6, -6], W: 1280, H: 720, fov: 62, fogNear: 90, fogFar: 340 },
];
for (const v of views) {
  const r = render(v);
  const out = `docs/district-${ID}-${v.name}.png`;
  fs.writeFileSync(out, png(r.W, r.H, Buffer.from(r.px)));
  console.log('→', out, `${r.W}×${r.H}`);
}
