// ОБЗОР КАЖДОЙ КОМНАТЫ: 11 видов на комнату (1 основной + 10 дополнительных).
// Пользователь: «добавь ещё 10 видов каждой комнаты».
//
// Как это сделано: камера ставится в проходимую точку комнаты (бот идёт туда настоящей
// физикой) и оборачивается по кругу с разной высотой и наклоном. Ракурсы не случайные:
//   • 2 вида от двери (как входит человек) — по одному на каждую дверь;
//   • 6 по кругу с шагом 60° из центра комнаты — полный обзор стен;
//   • 2 сверху-вниз (общий вид мебели) и снизу (пол/плинтус/ковёр).
// Снимки: tools/_render/views-<комната>-<номер>.png + views.json со списком.
//
// Запуск: node tools/preview-rooms.mjs [--kind=brezhnevka] [--room=living] [--out=views]
import fs from 'fs';
import zlib from 'zlib';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildStaircase, landingFloor } from '../src/game/staircase.ts';
import { PITCH, VOXEL_FACES, VOXEL_QUADS } from '../src/game/voxelhouse.ts';
import { findPath, walkableAt } from '../src/game/nav.ts';
import { buildFurniture } from '../src/game/furniture.ts';
import { furnish as furnishRoom, apartmentPlan } from '../src/game/plan.ts';
import { PLAYER } from '../src/shared/constants.ts';

const arg = (name, def) => {
  const a = process.argv.find(v => v.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};
const KIND = arg('kind', 'khrushchevka');
const OUT = arg('out', 'views');
const ONLY = arg('room', '');

await RAPIER.init();
const model = buildVoxelHouse({ kind: KIND, sections: 1 });
const plan = model.plan;
const W = model.size[0] / 2, D = model.size[2] / 2;
const floorH = model.floorH;

// ---------- геометрия для отрисовки и физики ----------
const CORNERS = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const H = PITCH / 2;
const { nx, ny, nz, cells } = model.spec;
const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : cells[(j * nz + k) * nx + i];
const tris = [];
const verts = [], idx = [];
const COLOR = { 0: [207, 202, 189], 1: [185, 180, 168], 2: [156, 106, 80], 3: [120, 165, 195], 4: [122, 75, 40] };
for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
  const kind = at(i, j, k);
  if (kind < 0) continue;
  const cx0 = (i + 0.5) * PITCH, cy0 = (j + 0.5) * PITCH, cz0 = (k + 0.5) * PITCH;
  for (let f = 0; f < 6; f++) {
    const [di, dj, dk] = VOXEL_FACES[f];
    if (at(i + di, j + dj, k + dk) >= 0) continue;
    const start = verts.length / 3;
    const q = VOXEL_QUADS[f].map(ci => {
      const c = CORNERS[ci];
      const p = [cx0 + c[0] * H, cy0 + c[1] * H, cz0 + c[2] * H];
      verts.push(...p);
      return p;
    });
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    tris.push({ p: q, c: COLOR[kind] ?? [160, 160, 160], n: [di, dj, dk] });
  }
}
const stair = buildStaircase(plan, model.floors, model.floorH, new THREE.Vector3(W, 0, D));
for (let t = 0; t < stair.idx.length; t += 3) {
  const p3 = [0, 1, 2].map(n => [stair.verts[stair.idx[t + n] * 3], stair.verts[stair.idx[t + n] * 3 + 1], stair.verts[stair.idx[t + n] * 3 + 2]]);
  tris.push({ p: p3, c: [190, 184, 170], n: [0, 1, 0] });
}
// земля (в игре пол — террейн, в вокселях его нет). ЗИМА: снег, а не асфальт.
for (let x = -10; x < model.size[0] + 10; x += 2) for (let z = -10; z < model.size[2] + 10; z += 2) {
  const inside = x > -1 && x < model.size[0] + 1 && z > -1 && z < model.size[2] + 1;
  tris.push({
    p: [[x, 0, z], [x + 2, 0, z], [x + 2, 0, z + 2], [x, 0, z + 2]],
    c: inside ? [150, 146, 138] : [233, 240, 246], n: [0, 1, 0],
  });
}
// мебель — та же расстановка, что в игре (тут она не разрушается, это фото)
for (let s = 0; s < model.sections; s++) {
  for (let f = 0; f < model.floors; f++) {
    const y = 0.02 + f * floorH;
    const secCenterX = -model.size[0] / 2 + s * plan.w + plan.w / 2;
    for (const room of plan.rooms) {
      if (room.id === 'stairs') continue;
      for (const item of furnishRoom(room, plan)) {
        const g = buildFurniture(item.kind);
        if (!g) continue;
        g.position.set(secCenterX + item.x + W, y, item.z + D);
        g.rotation.y = item.rot;
        g.updateMatrixWorld(true);
        g.traverse(o => {
          const m = o;
          if (!m.isMesh) return;
          const col = m.material.color;
          const c = [col.r * 255, col.g * 255, col.b * 255];
          const geo = m.geometry;
          const pos = geo.getAttribute('position');
          const index = geo.getIndex();
          const v = (n2) => [pos.getX(n2), pos.getY(n2), pos.getZ(n2)].map((val, ax) => ax === 0 ? val + m.matrixWorld.elements[12] : ax === 1 ? val + m.matrixWorld.elements[13] : val + m.matrixWorld.elements[14]);
          if (index) {
            for (let t = 0; t < index.count; t += 3) tris.push({ p: [0, 1, 2].map(n2 => v(index.getX(t + n2))), c, n: [0, 1, 0] });
          } else {
            for (let t = 0; t + 2 < pos.count; t += 3) tris.push({ p: [v(t), v(t + 1), v(t + 2)], c, n: [0, 1, 0] });
          }
        });
      }
    }
  }
}

// ---------- физика: тот же дом, чтобы бот честно доходил до точки съёмки ----------
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;
world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200), world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)));
world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
world.createCollider(RAPIER.ColliderDesc.trimesh(stair.verts, stair.idx), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
world.step();

const R = 0.3, HH = PLAYER.heightStand;
const pBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
  plan.entrance.x + W, HH / 2 + 0.05, plan.entrance.z + D - 9));
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

// ---------- программный рендер (без браузера) ----------
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
function render(eye, yaw, pitch, w = 640, fov = 75) {
  const h = Math.round(w * 0.62);
  const cp = Math.cos(pitch);
  const fw = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  const right0 = [fw[2], 0, -fw[0]];
  const rl = Math.hypot(...right0) || 1;
  const right = right0.map(v => v / rl);
  const up = [fw[1] * right[2] - fw[2] * right[1], fw[2] * right[0] - fw[0] * right[2], fw[0] * right[1] - fw[1] * right[0]];
  const tanY = Math.tan((fov * Math.PI / 180) / 2), aspect = w / h;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const f = 1 - y / h;
    px[i] = 178 + 40 * f; px[i + 1] = 192 + 38 * f; px[i + 2] = 206 + 32 * f;
  }
  const zb = new Float32Array(w * h).fill(Infinity);
  const view = p => {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    return [d[0] * right[0] + d[1] * right[1] + d[2] * right[2],
            d[0] * up[0] + d[1] * up[1] + d[2] * up[2],
            d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2]];
  };
  const scr = v => [w / 2 + (v[0] / (v[2] * tanY * aspect)) * w / 2, h / 2 - (v[1] / (v[2] * tanY)) * h / 2, v[2]];
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
    const light = 0.58 + 0.42 * Math.max(0, n[0] * -0.35 + n[1] * 0.75 + n[2] * -0.55);
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
        const fog = Math.min(1, Math.max(0, (z - 14) / 70));
        for (let ch2 = 0; ch2 < 3; ch2++) {
          const v = t.c[ch2] * light * (1 - fog * 0.45) + [210, 220, 232][ch2] * fog * 0.45;
          px[i * 3 + ch2] = Math.max(0, Math.min(255, v)) | 0;
        }
      }
    }
  }
  return png(w, h, px);
}

// ---------- навигация и точка съёмки ----------
const area = [-14, model.size[0] + 14, -16, model.size[2] + 16];
// extraFloor получает МИРОВЫЕ координаты (как в test-walk): лестница внутри дома
// отсчитывается от его центра, поэтому вычитаем половину габаритов.
const extra = (x, z, feetY) => landingFloor(plan, floorH)(x - W, z - D, feetY);
const solid = (i, j, k) => at(i, j, k) >= 0;
/**
 * Дойти до точки на нужном этаже. Если мы ниже — сначала поднимаемся по маршруту
 * лестницы (тот же «змейкой», как в test-walk), иначе путь ищется сквозь перекрытие и
 * BFS честно возвращает null: на этаж нельзя пройти сквозь бетон.
 */
function goTo(x, z, feetY) {
  const target = feetY ?? feet()[1];
  if (feet()[1] < target - 0.5) {
    const sx = plan.stairs;
    const lane = (fx, fz) => { for (let i = 0; i < 900; i++) { const p = feet(); const dx = fx - p[0], dz = fz - p[2]; if (Math.hypot(dx, dz) < 0.25) break; stepTo(dx, dz); } };
    while (feet()[1] < target - 0.5) {
      lane(cx(sx.x0 + 0.9), cz(sx.z0 + 1.6));
      lane(cx(sx.x0 + 0.9), cz(sx.z1 - 1.6));
      lane(cx(sx.x1 - 0.9), cz(sx.z1 - 1.6));
      lane(cx(sx.x1 - 0.9), cz(sx.z0 + 1.6));
      if (feet()[1] < target - 0.5) break;
    }
  }
  const path = findPath(solid, feet(), [x, target, z], target, undefined, area, extra);
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
  return Math.hypot(p[0] - x, p[2] - z) < 1.4;
}
const cx = (v) => v + W, cz = (v) => v + D;

/** Двери комнаты (мировые координаты) — из них снимаем «как входит человек». */
function doorsOf(r) {
  const list = [];
  for (const ws of plan.walls) {
    const horiz = Math.abs(ws.z1 - ws.z0) < 1e-6;
    for (const [a, b] of ws.doors) {
      const t = (a + b) / 2;
      const x = horiz ? Math.min(ws.x0, ws.x1) + t : ws.x0;
      const z = horiz ? ws.z0 : Math.min(ws.z0, ws.z1) + t;
      // дверь принадлежит комнате, если стоит на её границе
      const onEdgeX = Math.abs(x - r.x0) < 0.3 || Math.abs(x - r.x1) < 0.3;
      const onEdgeZ = Math.abs(z - r.z0) < 0.3 || Math.abs(z - r.z1) < 0.3;
      const inside = x > r.x0 - 0.7 && x < r.x1 + 0.7 && z > r.z0 - 0.7 && z < r.z1 + 0.7;
      if (inside && onEdgeX && onEdgeZ) {
        // внутрь комнаты от двери
        const dx = (r.x0 + r.x1) / 2 - x, dz = (r.z0 + r.z1) / 2 - z;
        const d = Math.hypot(dx, dz) || 1;
        list.push({ door: { x, z }, inside: { x: x + (dx / d) * 0.8, z: z + (dz / d) * 0.8 } });
      }
    }
  }
  return list;
}

// --- кадр снаружи: проверить зимнюю землю и снег на деревьях/крышах
const exterior = () => {
  const eye = [model.size[0] / 2 - 6, 1.7, -11];
  return { eye, target: [model.size[0] / 2, 4.2, model.size[2] / 2] };
};
fs.mkdirSync('tools/_render', { recursive: true });
const shots = [];
function shoot(roomId, index, name, eye, target, fov = 78) {
  const yaw = Math.atan2(target[0] - eye[0], target[2] - eye[2]);
  const dist = Math.hypot(target[0] - eye[0], target[2] - eye[2]);
  const pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(target[1] - eye[1], Math.max(dist, 0.4))));
  const file = `tools/_render/${OUT}-${roomId}-${String(index).padStart(2, '0')}-${name}.png`;
  fs.writeFileSync(file, render(eye, yaw, pitch, 640, fov));
  shots.push({ file, room: roomId, name, eye: eye.map(v => +v.toFixed(2)), target: target.map(v => +v.toFixed(2)) });
}

// Вид снаружи: ЗИМА (снег вместо зелёного газона)
if (!ONLY) {
  const ex = exterior();
  shoot('street', 1, 'winter', ex.eye, ex.target, 80);
  fs.writeFileSync('tools/_render/views.json', JSON.stringify(shots, null, 2));
}

let failed = 0;
for (const r of plan.rooms) {
  if (r.id === 'stairs') continue;
  if (ONLY && r.id !== ONLY) continue;
  const rcx = (r.x0 + r.x1) / 2, rcz = (r.z0 + r.z1) / 2;
  const halfW = (r.x1 - r.x0) / 2, halfD = (r.z1 - r.z0) / 2;
  // точка съёмки — не в мебели: перебираем точки комнаты, где бот реально может встать
  const cands = [];
  for (const t of [0.55, 0.45, 0.65, 0.35]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cands.push({ x: rcx + sx * halfW * t, z: rcz + sz * halfD * t });
  }
  cands.push({ x: rcx, z: rcz });
  // ВАЖНО: сначала ИДЁМ в комнату (бот стартует на улице), и только потом проверяем
  // точки. Раньше здесь стоял walkableAt на высоте пола 1-го этажа, пока бот ещё был
  // на улице — и все кандидаты отбраковывались («не смог войти»).
  const entered = goTo(cx(rcx), cz(rcz), floorH);
  let spot = null;
  for (const c of cands) {
    if (!walkableAt(solid, cx(c.x), floorH, cz(c.z), undefined, extra)) continue;
    if (!goTo(cx(c.x), cz(c.z), floorH)) continue;
    spot = c;
    break;
  }
  if (!spot && entered) spot = { x: feet()[0] - W, z: feet()[2] - D };
  if (!spot) { console.log(`  ✗ ${r.name}: не смог войти`); failed++; continue; }
  const eyeBase = [cx(spot.x), feet()[1] + 1.6, cz(spot.z)];

  // 1 — основной вид: на центр мебели (как «фото комнаты»)
  const items = furnishRoom(r, plan);
  const fx = items.length ? items.reduce((a, i) => a + i.x, 0) / items.length : rcx;
  const fz = items.length ? items.reduce((a, i) => a + i.z, 0) / items.length : rcz;
  shoot(r.id, 1, 'main', eyeBase, [cx(fx), eyeBase[1] - 0.25, cz(fz)], 82);

  // 2-3 — от дверей: как заходит человек
  const doors = doorsOf(r);
  for (let i = 0; i < 2; i++) {
    const d = doors[i] ?? doors[0];
    const eye = d ? [cx(d.inside.x), floorH + 1.6, cz(d.inside.z)] : eyeBase;
    shoot(r.id, 2 + i, d ? `from-door-${i + 1}` : 'from-door-center', eye, [cx(rcx), floorH + 1.2, cz(rcz)], 88);
  }

  // 4-9 — круг по 60°: обзор стен. Камера в ЦЕНТРЕ комнаты, цель — на расстоянии,
  // которое комната реально позволяет: раньше цель стояла в 3.2 м, в гостиной 3.5 м
  // шириной это упиралось в стену, и кадр был «кирпич в упор».
  const centerEye = [cx(rcx), floorH + 1.55, cz(rcz)];
  const reach = Math.max(0.9, Math.min(halfW, halfD) * 0.92);
  const around = [[0, 1], [1, 1], [1, 0], [0, -1], [-1, -1], [-1, 0]];
  around.forEach(([dx, dz], i) => {
    const len = Math.hypot(dx, dz) || 1;
    const target = [centerEye[0] + (dx / len) * reach, floorH + 1.1, centerEye[2] + (dz / len) * reach];
    shoot(r.id, 4 + i, `around-${i * 60}deg`, centerEye, target, 90);
  });

  // 10 — сверху вниз: общий вид мебели, как на плане квартиры
  shoot(r.id, 10, 'top-down', [cx(rcx), floorH + 2.6, cz(rcz)], [cx(rcx) + 0.01, floorH, cz(rcz)], 96);
  // 11 — снизу: пол, ковёр, плинтус
  shoot(r.id, 11, 'floor', [spot.x + W, floorH + 0.85, spot.z + D], [cx(rcx), floorH - 0.05, cz(rcz)], 88);
  console.log(`  ✓ ${r.name}: 11 видов`);
}

fs.writeFileSync(`tools/_render/${OUT}.json`, JSON.stringify(shots, null, 2));
console.log(`\nснимков: ${shots.length}${failed ? `, не смог войти в ${failed} комнат` : ''}`);
process.exit(failed ? 1 : 0);
