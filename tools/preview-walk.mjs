// ФОТО ПРОХОДА ПО ДОМУ (M7): бот идёт маршрутом с физикой и делает снимки.
// Ровно то, что просил пользователь: «побегай внутри и посмотри на свои фото».
// Запуск: node tools/preview-walk.mjs [--kind=brezhnevka] [--out=walk]
import fs from 'fs';
import zlib from 'zlib';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildStaircase, landingFloor } from '../src/game/staircase.ts';
import { PITCH, VOXEL_FACES, VOXEL_QUADS } from '../src/game/voxelhouse.ts';
import { findPath } from '../src/game/nav.ts';
import { buildFurniture } from '../src/game/furniture.ts';
import { furnish as furnishRoom } from '../src/game/plan.ts';
import { PLAYER } from '../src/shared/constants.ts';

const arg = (name, def) => {
  const a = process.argv.find(v => v.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};
const KIND = arg('kind', 'khrushchevka');
const OUT = arg('out', 'walk');

await RAPIER.init();
const model = buildVoxelHouse({ kind: KIND, sections: 1 });
const W = model.size[0] / 2, D = model.size[2] / 2;
const origin = new THREE.Vector3(W, 0, D);

// ---------- мир физики: те же треугольники, что в игре ----------
const CORNERS = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const H = PITCH / 2;
const { nx, ny, nz, cells } = model.spec;
const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];

/** треугольники стен для отрисовки (с цветом) и для физики */
const tris = [];
const verts = [], idx = [];
const COLOR = { 0: [207, 202, 189], 1: [185, 180, 168], 2: [156, 106, 80], 3: [120, 165, 195], 4: [122, 75, 40] };
for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
  const kind = at(i, j, k);
  if (kind < 0) continue;
  const cx = (i + 0.5) * PITCH, cy = (j + 0.5) * PITCH, cz = (k + 0.5) * PITCH;
  for (let f = 0; f < 6; f++) {
    const [di, dj, dk] = VOXEL_FACES[f];
    if (at(i + di, j + dj, k + dk) >= 0) continue;
    const start = verts.length / 3;
    const q = VOXEL_QUADS[f].map(ci => {
      const c = CORNERS[ci];
      const p = [cx + c[0] * H, cy + c[1] * H, cz + c[2] * H];
      verts.push(...p);
      return p;
    });
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    tris.push({ p: q, c: COLOR[kind] ?? [160, 160, 160], n: [di, dj, dk] });
  }
}
const stair = buildStaircase(model.plan, model.floors, model.floorH, origin);
for (let t = 0; t < stair.idx.length; t += 3) {
  const p3 = [0, 1, 2].map(n => [stair.verts[stair.idx[t + n] * 3], stair.verts[stair.idx[t + n] * 3 + 1], stair.verts[stair.idx[t + n] * 3 + 2]]);
  tris.push({ p: p3, c: [190, 184, 170], n: [0, 1, 0], stairFace: true });
}
// земля (в игре пол — террейн, в вокселях его нет)
for (let x = -10; x < model.size[0] + 10; x += 2) for (let z = -10; z < model.size[2] + 10; z += 2) {
  const inside = x > -1 && x < model.size[0] + 1 && z > -1 && z < model.size[2] + 1;
  tris.push({
    p: [[x, 0, z], [x + 2, 0, z], [x + 2, 0, z + 2], [x, 0, z + 2]],
    c: inside ? [104, 101, 94] : [116, 118, 108], n: [0, 1, 0],
  });
}
// мебель: чтобы на фото было видно, что это КВАРТИРА, а не бетонный колодец.
// Ставим ровно как structure.ts: y = 0.02 + f * floorH, координаты плана + центр дома.
{
  const q = new THREE.Quaternion();
  const W2 = model.plan.w / 2;
  for (const room of model.plan.rooms) {
    if (room.id === 'stairs') continue;
    for (const item of furnishRoom(room, model.plan)) {
      const g = buildFurniture(item.kind);
      if (!g) continue;
      g.position.set(origin.x + item.x, 0.02 + model.floorH, origin.z + item.z);
      g.rotation.y = item.rot;
      g.updateMatrixWorld(true);
      void q; void W2;
      g.traverse(o => {
        const mesh = o;
        if (!mesh.isMesh) return;
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const pos = geo.attributes.position;
        // THREE.Color хранит ЛИНЕЙНЫЕ значения (colorManagement), поэтому просто
        // умножить на 255 нельзя: '#6b4a2e' давало (37, 17, 7) — почти чёрный шкаф.
        const col = mesh.material.color;
        const c = col
          ? [col.r, col.g, col.b].map(v => Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255)
          : [180, 180, 180];
        for (let vi = 0; vi + 2 < pos.count; vi += 3) {
          const v = [];
          for (let n = 0; n < 3; n++) {
            const j = vi + n;
            v.push(new THREE.Vector3(pos.getX(j), pos.getY(j), pos.getZ(j)).applyMatrix4(mesh.matrixWorld).toArray());
          }
          const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
          const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
          let n2 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const nl = Math.hypot(...n2) || 1;
          n2 = n2.map(x => x / nl);
          tris.push({ p: v, c, n: n2.map(x => Math.abs(x)) });
        }
      });
    }
  }
}
// номера этажей на стене — чтобы на фото было видно, где мы
console.log(`${KIND}: ${model.size.map(v => v.toFixed(1)).join('×')} м, граней ${tris.length}`);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;
world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200), world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)));
world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
world.createCollider(RAPIER.ColliderDesc.trimesh(stair.verts, stair.idx), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
world.step();

const R = 0.3, HH = PLAYER.heightStand;
const pBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
  model.plan.entrance.x + W, HH / 2 + 0.05, model.plan.entrance.z + D - 9));
const pCol = world.createCollider(RAPIER.ColliderDesc.capsule((HH - 2 * R) / 2, R).setFriction(0), pBody);
const cc = world.createCharacterController(0.02);
cc.enableAutostep(PLAYER.stepHeight, 0.2, false);
cc.enableSnapToGround(0.35);
cc.setMaxSlopeClimbAngle((PLAYER.slopeMax * Math.PI) / 180);
cc.setMinSlopeSlideAngle((PLAYER.slopeMax * Math.PI) / 180);
cc.setUp({ x: 0, y: 1, z: 0 });
let vy = 0, grounded = false;
const feet = () => { const t = pBody.translation(); return [t.x, t.y - HH / 2, t.z]; };
function stepTo(dx, dz, speed = PLAYER.walk) {
  const len = Math.hypot(dx, dz) || 1;
  vy -= 9.81 / 60; if (grounded && vy < 0) vy = 0;
  cc.computeColliderMovement(pCol, { x: (dx / len) * speed / 60, y: vy / 60, z: (dz / len) * speed / 60 });
  const m = cc.computedMovement();
  grounded = cc.computedGrounded();
  if (grounded && vy <= 0) vy = 0;
  const t = pBody.translation();
  pBody.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  world.step();
}

// ---------- рендер (медленный, но без браузера) ----------
function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}
const NEAR = 0.15;
function render(eye, yaw, pitch, w = 760, fov = 70) {
  const h = Math.round(w * 0.62);
  const cp = Math.cos(pitch);
  const fw = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  const right0 = [fw[2], 0, -fw[0]];
  const rl = Math.hypot(...right0) || 1;
  const right = right0.map(v => v / rl);
  // up = fw × right (right-handed). Было right × fw — кадр выходил вверх ногами:
  // земля уезжала в верх экрана, небо — вниз.
  const up = [fw[1] * right[2] - fw[2] * right[1], fw[2] * right[0] - fw[0] * right[2], fw[0] * right[1] - fw[1] * right[0]];
  const tanY = Math.tan((fov * Math.PI / 180) / 2), aspect = w / h;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const f = 1 - y / h;   // сверху светлее (небо), снизу темнее (земля)
    px[i] = 150 + 45 * f; px[i + 1] = 168 + 45 * f; px[i + 2] = 190 + 40 * f;
  }
  const zb = new Float32Array(w * h).fill(Infinity);
  // вершина → пространство камеры: [вправо, вверх, вперёд]
  const view = p => {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    return [d[0] * right[0] + d[1] * right[1] + d[2] * right[2],
            d[0] * up[0] + d[1] * up[1] + d[2] * up[2],
            d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2]];
  };
  const scr = v => [w / 2 + (v[0] / (v[2] * tanY * aspect)) * w / 2,
                    h / 2 - (v[1] / (v[2] * tanY)) * h / 2, v[2]];
  // отсечение по ближней плоскости: БЕЗ него плитка земли/стена с вершинами за
  // спиной выворачивалась и закрашивала весь кадр (было «серое небо»).
  const clipNear = poly => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return out;
  };
  for (const t of tris) {
    const n = t.n ?? [0, 1, 0];
    // солнце с юго-востока +подсветка неба: фасад (-Z) не должен быть чёрным
    const light = 0.55 + 0.45 * Math.max(0, n[0] * -0.35 + n[1] * 0.75 + n[2] * -0.55);
    const cam = t.p.map(view);
    let poly = clipNear(cam);
    if (poly.length < 3) continue;
    poly = poly.map(scr);
    for (let f = 1; f + 1 < poly.length; f++) {
      const [a, b, c] = [poly[0], poly[f], poly[f + 1]];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const q0 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / area;
        const q1 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / area;
        const q2 = 1 - q0 - q1;
        if (q0 < -1e-6 || q1 < -1e-6 || q2 < -1e-6) continue;
        const z = 1 / (q0 / a[2] + q1 / b[2] + q2 / c[2]);
        const i = y * w + x;
        if (z >= zb[i]) continue;
        zb[i] = z;
        const fog = Math.min(1, Math.max(0, (z - 12) / 60));
        for (let ch2 = 0; ch2 < 3; ch2++) {
          const v = t.c[ch2] * light * (1 - fog * 0.5) + [150, 165, 180][ch2] * fog * 0.5;
          px[i * 3 + ch2] = Math.max(0, Math.min(255, v)) | 0;
        }
      }
    }
  }
  return png(w, h, px);
}

// ---------- маршрут: улица → подъезд → лестница → этаж → все комнаты ----------
const plan = model.plan;
const area = [-14, model.size[0] + 14, -16, model.size[2] + 16];
const extra = (x, z, feetY) => landingFloor(plan, model.floorH)(x - W, z - D, feetY);
const shots = [];
function shoot(tag) {
  const p = tag.from ?? feet();
  const target = tag.target;
  const yaw = Math.atan2(target[0] - p[0], target[2] - p[2]);
  const dist = Math.hypot(target[0] - p[0], target[2] - p[2]);
  const pitch = Math.max(-0.45, Math.min(0.45, Math.atan2(target[1] - (p[1] + 1.6), Math.max(dist, 0.5))));
  fs.mkdirSync('tools/_render', { recursive: true });
  const file = `tools/_render/${OUT}-${String(shots.length + 1).padStart(2, '0')}-${tag.name}.png`;
  fs.writeFileSync(file, render([p[0], p[1] + 1.6, p[2]], yaw, pitch, 760, tag.fov ?? 70));
  shots.push({ file, name: tag.name, pos: p.map(v => +v.toFixed(2)), target: tag.target });
  console.log(`  📷 ${tag.name}: ${file} (x=${p[0].toFixed(1)} y=${p[1].toFixed(2)} z=${p[2].toFixed(1)})`);
}
function goTo(x, z, feetY) {
  const path = findPath((i, j, k) => at(i, j, k) >= 0, feet(), [x, feetY, z], feetY === undefined ? feet()[1] : feetY, undefined, area, extra);
  if (!path) return false;
  for (const pt of path) {
    for (let f = 0; f < 900; f++) {
      const p = feet();
      const dx = pt.x - p[0], dz = pt.z - p[2];
      if (Math.hypot(dx, dz) < 0.2) break;
      stepTo(dx, dz);
    }
  }
  const p = feet();
  return Math.hypot(p[0] - x, p[2] - z) < 1.2;
}

const cx = (v) => v + W, cz = (v) => v + D;
const rooms = plan.rooms.filter(r => r.id !== 'stairs');
// Фасад целиком: камера по центру дома в 12 м и чуть выше глаз, иначе в кадре
// половина пустой земли и кусок стены (дом шириной 12 м вблизи не влезает).
shoot({
  name: 'street',
  from: [model.size[0] / 2 - 7.5, 1.7, -9.5],
  target: [model.size[0] / 2, 4.5, model.size[2] / 2],
  fov: 75,
});

// Снимаем ОТ ПОРОГА, а не стоя на первой ступени: вплотную к маршу камера видит
// только ступени в 20 см от объектива.
goTo(cx(plan.entrance.x), cz(plan.entrance.z - 1.6), 0);
shoot({
  name: 'in-entrance',
  target: [cx((plan.stairs.x0 + plan.stairs.x1) / 2), 1.6, cz(plan.stairs.z1 - 0.6)],
  fov: 80,
});

// вверх по лестнице (по маршруту «марш 0 → разворот → марш 1»)
const zA = cx(plan.stairs.x0 + 0.9), zBx = cx(plan.stairs.x1 - 0.9);
for (const [x, z] of [[zA, cz(plan.stairs.z0 + 1.6)], [zA, cz(plan.stairs.z1 - 1.6)],
  [zBx, cz(plan.stairs.z1 - 1.6)], [zBx, cz(plan.stairs.z0 + 1.6)]]) {
  for (let f = 0; f < 1200; f++) {
    const p = feet();
    const dx = x - p[0], dz = z - p[2];
    if (Math.hypot(dx, dz) < 0.25) break;
    stepTo(dx, dz);
  }
}
// Стоим на фасадной площадке 2-го этажа и смотрим на дверь квартиры. Раньше цель
// была «в фасад» — камера упиралась в стену, и понять, что мы на этаже, было нельзя.
shoot({
  name: 'landing-floor2',
  from: [cx(plan.stairs.x0 + 0.6), model.floorH, cz(plan.entrance.z + 0.8)],
  target: [cx(plan.stairs.x1 + 1.6), model.floorH + 1.4, cz(plan.entrance.z + 0.9)],
  fov: 88,
});

// ВЗГЛЯД ИЗ ПРИХОЖЕЙ В ЛЕСТНИЧНУЮ КЛЕТКУ через дверь квартиры — ровно тот кадр,
// на котором игрок увидел «лестницу в никуда». Пол этажа = floorH.
{
  goTo(cx(-1.2), cz(-4.0), model.floorH);
  shoot({
    name: 'hall-look-stairs',
    target: [cx(plan.stairs.x0 + 1.0), feet()[1] + 1.3, cz(plan.stairs.z0 + 3.0)],
    fov: 92,
  });
  // и снизу вверх по шахте со второго этажа квартиры
  goTo(cx(-4.2), cz(0.4), model.floorH);
  shoot({
    name: 'stairwell-up',
    target: [cx(-4.2), feet()[1] - 2.0, cz(plan.stairs.z0 + 1.0)],
    fov: 95,
  });
}

// в квартиру и по комнатам (пол 1 этажа = floorH)
const floorH = model.floorH;
for (const r of rooms) {
  // Куда смотреть: на ЦЕНТР МЕБЕЛИ комнаты, а не в угол. Съёмка «из угла в ближний
  // угол» давала стену, а «в противоположный угол» — комнату без гарнитура
  // (на кухне в кадр не попали ни плита, ни холодильник). Смотрим на мебель.
  const items = furnishRoom(r, model.plan);
  const cxF = items.length ? items.reduce((a, i) => a + i.x, 0) / items.length : (r.x0 + r.x1) / 2;
  const czF = items.length ? items.reduce((a, i) => a + i.z, 0) / items.length : (r.z0 + r.z1) / 2;
  // в узкой комнате шире 1 м от стены не отойти — иначе стена занимает полкадра
  const padX = Math.min(1.0, (r.x1 - r.x0) / 2 - 0.35);
  const padZ = Math.min(1.0, (r.z1 - r.z0) / 2 - 0.35);
  const narrow = Math.min(r.x1 - r.x0, r.z1 - r.z0) < 3.5;
  let best = null;
  for (const x of [r.x0 + padX, r.x1 - padX]) for (const z of [r.z0 + padZ, r.z1 - padZ]) {
    const d = Math.hypot(x - cxF, z - czF);
    if (!best || d > best.d) best = { x, z, d };
  }
  // Маленькая комната (санузел 2 × 2.5): из угла камера упирается в ванну и мебель
  // занимает весь кадр. Такие снимаем ОТ ДВЕРИ, глядя внутрь.
  const area2 = (r.x1 - r.x0) * (r.z1 - r.z0);
  if (area2 < 7.5) {
    const door = plan.walls.flatMap(ws => {
      const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
      return ws.doors.map(([a, b]) => {
        const t = (a + b) / 2;
        const x = horiz ? Math.min(ws.x0, ws.x1) + t : ws.x0;
        const z = horiz ? ws.z0 : Math.min(ws.z0, ws.z1) + t;
        return { x, z };
      });
    }).filter(d => d.x >= r.x0 - 0.6 && d.x <= r.x1 + 0.6 && d.z >= r.z0 - 0.6 && d.z <= r.z1 + 0.6)
      .sort((a, b) => Math.hypot(a.x - cxF, a.z - czF) - Math.hypot(b.x - cxF, b.z - czF))[0];
    if (door) {
      const d = Math.hypot(cxF - door.x, czF - door.z) || 1;
      // сдвигаемся внутрь комнаты на 0.7 м, чтобы камера не стояла в проёме
      best = { x: door.x + ((cxF - door.x) / d) * 0.7, z: door.z + ((czF - door.z) / d) * 0.7, d: 0 };
    }
  }
  const ok = goTo(cx(best.x), cz(best.z), floorH);
  const p = feet();
  shoot({
    name: ok ? `room-${r.id}` : `STUCK-${r.id}`,
    target: [cx(cxF), p[1] + 1.25, cz(czF)],
    fov: narrow ? 78 : 90,
  });
}
console.log(`\nснимков: ${shots.length}`);
fs.writeFileSync(`tools/_render/${OUT}.json`, JSON.stringify(shots, null, 2));
