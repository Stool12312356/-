// tools/preview-voxelhouse.mjs — оффлайн-рендер ВОКСЕЛЬНОГО дома (без браузера).
// Рисует наружные грани живых вокселей: так видно подъезд, окна, проломы.
import fs from 'fs';
import zlib from 'zlib';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildStaircase } from '../src/game/staircase.ts';
import { PITCH } from '../src/game/voxelhouse.ts';

const KIND = process.argv[2] === 'brezhnevka' ? 'brezhnevka' : 'khrushchevka';
const SECTIONS = process.argv[2] === 'brezhnevka' ? 1 : (process.argv.includes('--sections=1') ? 1 : 2);
const m = buildVoxelHouse({ kind: KIND, sections: SECTIONS });
const { nx, ny, nz, cells } = m.spec;
// РАЗРЕЗ: если задан --clip=N, воксели с i >= N не рисуем (видно шахту и лестницу)
const clipArg = process.argv.find(a => a.startsWith('--clip='));
const CLIP = clipArg ? Number(clipArg.split('=')[1]) : Infinity;
// --cut=K: срез по глубине (видны комнаты и лестница внутри)
const cutArg = process.argv.find(a => a.startsWith('--cut='));
const CUT_K = cutArg ? Number(cutArg.split('=')[1]) : null;
const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];

function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

const COLOR = { 0: [207, 202, 189], 1: [179, 174, 162], 2: [156, 106, 80], 3: [143, 182, 204], 4: [122, 75, 40], 5: [173, 167, 155] };
// собираем наружные грани
const tris = [];
const H = PITCH / 2;
const DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const corners = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const quad = [[1,5,6,2],[0,3,7,4],[3,2,6,7],[0,4,5,1],[4,7,6,5],[0,1,2,3]];
for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
  const c = at(i, j, k); if (c < 0) continue;
  if (i >= CLIP) continue;
  // разрез по глубине: убираем переднюю половину дома — видно комнаты, стены, двери
  if (CUT_K !== null && k < CUT_K) continue;   // срезаем переднюю (фасадную) половину
  const cx = (i + 0.5) * PITCH, cy = (j + 0.5) * PITCH, cz = (k + 0.5) * PITCH;
  for (let f = 0; f < 6; f++) {
    const [di, dj, dk] = DIRS[f];
    if (at(i + di, j + dj, k + dk) >= 0) continue;
    const q = quad[f].map(ci => { const p = corners[ci]; return [cx + p[0] * H, cy + p[1] * H, cz + p[2] * H]; });
    tris.push({ p: q, c: COLOR[c], n: DIRS[f] });
  }
}
// лестница: отдельная геометрия (в вокселях её больше нет) — добавляем её треугольники
{
  const st = buildStaircase(m.plan, m.floors, m.floorH, { x: m.size[0] / 2, y: 0, z: m.size[2] / 2 });
  const v = st.verts, idx = st.idx;
  const SC = [186, 180, 168];
  for (let t = 0; t < idx.length; t += 3) {
    const p3 = [0, 1, 2].map(n => [v[idx[t + n] * 3], v[idx[t + n] * 3 + 1], v[idx[t + n] * 3 + 2]]);
    const e1 = p3[1].map((x, i) => x - p3[0][i]), e2 = p3[2].map((x, i) => x - p3[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...n) || 1;
    // рендер ждёт квад (4 точки): треугольник отдаём как квад с повтором последней точки —
    // вторая половина вырождается и отбрасывается по площади
    tris.push({ p: [p3[0], p3[1], p3[2], p3[2]], c: SC, n: n.map(x => x / nl) });
  }
  console.log('лестница:', st.steps, 'ступеней на марш, подступ', st.rise.toFixed(3), 'м');
}
console.log('дом', m.size.map(v => v.toFixed(1)).join('×'), 'вокселей', m.stats.voxels, 'граней', tris.length);

function render(eye, atPt, W = 1000) {
  const Hh = Math.round(W * 0.62);
  const f = atPt.map((v, i) => v - eye[i]); const fl = Math.hypot(...f); const fw = f.map(v => v / fl);
  const up = [0, 1, 0];
  const r = [fw[1] * up[2] - fw[2] * up[1], fw[2] * up[0] - fw[0] * up[2], fw[0] * up[1] - fw[1] * up[0]];
  const rl = Math.hypot(...r); const right = r.map(v => v / rl);
  const u = [right[1] * fw[2] - right[2] * fw[1], right[2] * fw[0] - right[0] * fw[2], right[0] * fw[1] - right[1] * fw[0]];
  const tanY = Math.tan(50 * Math.PI / 180 / 2), aspect = W / Hh;
  const px = Buffer.alloc(W * Hh * 3);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; const s = 1 - y / Hh; px[i] = 120 + 40 * s | 0; px[i+1] = 150 + 30 * s | 0; px[i+2] = 185 + 25 * s | 0; }
  const zb = new Float32Array(W * Hh).fill(Infinity);
  const proj = p => { const d = [p[0]-eye[0], p[1]-eye[1], p[2]-eye[2]]; const z = d[0]*fw[0]+d[1]*fw[1]+d[2]*fw[2]; if (z <= 0.05) return null;
    const sx = (d[0]*right[0]+d[1]*right[1]+d[2]*right[2])/(z*tanY*aspect); const sy = (d[0]*u[0]+d[1]*u[1]+d[2]*u[2])/(z*tanY);
    return [W/2 + sx*W/2, Hh/2 - sy*Hh/2, z]; };
  for (const tri of tris) {
   for (const t of [{ p: [tri.p[0], tri.p[1], tri.p[2]], c: tri.c, n: tri.n }, { p: [tri.p[0], tri.p[2], tri.p[3]], c: tri.c, n: tri.n }]) {
    const ps = t.p.map(proj); if (ps.some(p => !p)) continue;
    const [ax, ay, az] = ps[0], [bx, by, bz] = ps[1], [cx2, cy2, cz2] = ps[2];
    const area = (bx-ax)*(cy2-ay)-(cx2-ax)*(by-ay); if (Math.abs(area) < 1e-9) continue;
    const n = t.n;
    const light = 0.5 + 0.5 * Math.max(0, n[0]*0.45 + n[1]*0.75 + n[2]*-0.5);
    const minX = Math.max(0, Math.floor(Math.min(ax,bx,cx2))), maxX = Math.min(W-1, Math.ceil(Math.max(ax,bx,cx2)));
    const minY = Math.max(0, Math.floor(Math.min(ay,by,cy2))), maxY = Math.min(Hh-1, Math.ceil(Math.max(ay,by,cy2)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx-x)*(cy2-y)-(cx2-x)*(by-y))/area, w1 = ((cx2-x)*(ay-y)-(ax-x)*(cy2-y))/area, w2 = 1-w0-w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = 1/(w0/az + w1/bz + w2/cz2); const i = y*W+x; if (z >= zb[i]) continue; zb[i] = z;
      const fog = Math.min(1, z / 300);
      for (let c = 0; c < 3; c++) px[i*3+c] = Math.max(0, Math.min(255, (t.c[c]*light)*(1-fog*0.35) + [150,170,200][c]*fog*0.35)) | 0;
    }
   }
  }
  return { W, H: Hh, px };
}
// земля: в игре пол — это террейн, а не воксели (иначе на «фото» изнутри видно небо;
// ровно на это я и наткнулся — пол в превью надо рисовать отдельно)
{
  // ВАЖНО: рендерер отбрасывает треугольник, если хоть одна вершина за камерой,
  // поэтому большой квад земли «исчезал». Режем землю на тайлы по 2 м.
  const g = m.size[0] / 2 + 60, z0 = m.size[2] / 2 + 60;
  const T = 2;
  for (let x = -g; x < m.size[0] + g; x += T) {
    for (let z = -z0; z < m.size[2] + z0; z += T) {
      const inside = x > -1 && x < m.size[0] + 1 && z > -1 && z < m.size[2] + 1;
      tris.push({
        p: [[x, 0, z], [x + T, 0, z], [x + T, 0, z + T], [x, 0, z + T]],
        c: inside ? [104, 101, 94] : [116, 118, 108], n: [0, 1, 0],
      });
    }
  }
}

fs.mkdirSync('tools/_render', { recursive: true });
const cx = m.size[0]/2, cz = m.size[2]/2;
const views = {
  front: [[cx, m.size[1]*0.35, -m.size[2]*2.0], [cx, m.size[1]*0.45, cz]],
  entrance: [[cx, 1.6, -9], [cx, 2.2, 0]],
  close: [[cx, m.size[1]*0.9, -m.size[2]*1.2], [cx, m.size[1]*0.7, cz]],
  // изнутри подъезда: видно шахту и лестницу (а не «сразу квартиру»)
  // изнутри подъезда: вид на лестницу снизу (проверяем, что она есть и вход не замурован)
  inside: [[m.plan.entrance.x + m.size[0] / 2, 1.65, m.plan.entrance.z + m.size[2] / 2 + 1.0],
           [m.plan.stairs.x0 + m.size[0] / 2 + 0.6, 1.4, m.plan.stairs.z1 + m.size[2] / 2 - 1.0]],
  // вид из прихожей в коридор: видно двери в комнаты
  hall: [[-1.75 + m.size[0] / 2, 1.6, -4.0 + m.size[2] / 2], [0.5 + m.size[0] / 2, 1.4, 3.0 + m.size[2] / 2]],
  // из коридора в гостиную через дверь
  living: [[-1.0 + m.size[0] / 2, 1.6, -2.9 + m.size[2] / 2], [3.5 + m.size[0] / 2, 1.3, -3.0 + m.size[2] / 2]],
  // срез: смотрим в разрез дома, чтобы видеть перекрытия, шахту и марши
  cut: [[-14, m.size[1] * 0.55, m.size[2] * 0.6], [cx, m.size[1] * 0.4, cz]],
  section: [[-m.size[0] * 0.05, m.size[1] * 0.45, -1.2], [cx, m.size[1] * 0.34, cz]],
  // разрез по глубине: сверху-сбоку видно планировку (комнаты, двери, лестницу)
  plan3d: [[cx - 1, 16, -16], [cx, 1.0, cz + 2]],
};
for (const [name, [eye, atPt]] of Object.entries(views)) {
  const r = render(eye, atPt, name === 'entrance' ? 900 : 1000);
  fs.writeFileSync(`tools/_render/voxel-${name}.png`, png(r.W, r.H, Buffer.from(r.px)));
  console.log('→', `tools/_render/voxel-${name}.png`);
}
