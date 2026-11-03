// Физический мир в Web Worker: Rapier3D, фиксированный шаг 60 Гц.
import RAPIER from '@dimforge/rapier3d-compat';
import type { ToWorker, FromWorker, BodyDesc, Shape, PlayerInput, PlayerState, Tracer, Impact, Surface, VehicleDesc } from '../shared/types';
import { SURFACES, BALLISTICS, penetrationResult } from '../game/weapons';
import { PHYS_HZ, GRAVITY, PLAYER } from '../shared/constants';
import { stepVehicle as stepVehicleLocal } from '../game/vehicleRig';

const DT = 1 / PHYS_HZ;
let world: RAPIER.World;
const bodies = new Map<number, RAPIER.RigidBody>();
const dynIds = new Set<number>();
// Метаданные коллайдеров: материал, принадлежность к панели дома, толщина.
// Без этого баллистика не знает, во что попала пуля.
interface ColMeta { bodyId: number; panel: number; surface: Surface; building: boolean; thin: boolean; group: number }
const colMeta = new Map<number, ColMeta>();
const panelCols = new Map<string, RAPIER.Collider>(); // `${bodyId}:${panel}` → коллайдер
let tracers: Tracer[] = [];
let eventQueue: RAPIER.EventQueue;

// ---------- игрок ----------
const PR = 0.3;
const stanceH = [PLAYER.heightStand, PLAYER.heightCrouch, 0.7];
const stanceEye = [PLAYER.eyeStand, PLAYER.eyeCrouch, PLAYER.eyeProne];
const stanceSpeed = [PLAYER.walk, PLAYER.crouchSpeed, PLAYER.proneSpeed];
let pBody: RAPIER.RigidBody | null = null, pCol: RAPIER.Collider | null = null, cc: RAPIER.KinematicCharacterController;
let input: PlayerInput = { yaw: 0, pitch: 0, fwd: 0, right: 0, jump: false, sprint: false, crouch: false, prone: false };
const ps = { feet: [0, 0, 0] as [number, number, number], vel: [0, 0, 0] as [number, number, number], grounded: false, stance: 0 as 0 | 1 | 2, stamina: PLAYER.staminaMax, exhausted: false, hp: PLAYER.hp, sliding: false, hurtAt: 0, hpLimit: PLAYER.hp, spawn: [0, 2, 0] as [number, number, number], airTopY: 0, wasGrounded: true, pushVel: [0, 0, 0] as [number, number, number], slopeDeg: 0, groundNormal: { x: 0, y: 1, z: 0 } as { x: number; y: number; z: number } };

/** Направление вниз по склону по нормали поверхности (горизонтальная проекция). */
function downhill(n: { x: number; y: number; z: number }): [number, number] {
  const l = Math.hypot(n.x, n.z);
  if (l < 1e-4) return [0, 0];
  return [n.x / l, n.z / l];
}

function spawnPlayer(pos: [number, number, number]) {
  if (pBody) { world.removeRigidBody(pBody); pBody = null; }
  ps.spawn = pos; ps.feet = [...pos]; ps.vel = [0, 0, 0]; ps.stance = 0; ps.hp = PLAYER.hp; ps.hurtAt = 0; ps.stamina = PLAYER.staminaMax;
  const h = stanceH[0];
  pBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1] + h / 2, pos[2]));
  pCol = world.createCollider(RAPIER.ColliderDesc.capsule((h - 2 * PR) / 2, PR).setFriction(0), pBody);
  ps.airTopY = pos[1];
}
function setStance(s: 0 | 1 | 2) {
  if (!pBody || !pCol || s === ps.stance) return;
  const h = stanceH[s];
  // нельзя встать, если над головой препятствие
  if (s < ps.stance) {
    try {
      const probe = new RAPIER.Capsule((h - 2 * PR) / 2, PR);
      const hit = world.intersectionWithShape({ x: ps.feet[0], y: ps.feet[1] + h / 2 + 0.03, z: ps.feet[2] }, { x: 0, y: 0, z: 0, w: 1 }, probe, undefined, undefined, pCol);
      if (hit) return;
    } catch { /* ignore */ }
  }
  pCol.setHalfHeight((h - 2 * PR) / 2);
  ps.stance = s;
}
function stepPlayer() {
  if (!pBody || !pCol) return;
  // стойка
  const want: 0 | 1 | 2 = input.prone ? 2 : input.crouch ? 1 : 0;
  setStance(want);
  const st = ps.stance;
  // горизонтальная скорость
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  let ix = input.right, iz = -input.fwd; // вперёд = -Z в локальных координатах
  const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
  const wx = ix * cos + iz * sin, wz = -ix * sin + iz * cos;
  let speed = stanceSpeed[st];
  const moving = len > 0.01;
  if (st === 0 && input.sprint && input.fwd > 0 && moving && !ps.exhausted && ps.stamina > 0) {
    speed = PLAYER.sprint; ps.stamina = Math.max(0, ps.stamina - PLAYER.staminaDrain * DT); if (ps.stamina <= 0) ps.exhausted = true;
  } else { ps.stamina = Math.min(PLAYER.staminaMax, ps.stamina + PLAYER.staminaRegen * DT * (moving ? 0.6 : 1.4)); if (ps.exhausted && ps.stamina > 25) ps.exhausted = false; }
  const accel = ps.grounded ? 45 : 7;
  const tx = wx * speed, tz = wz * speed;
  const k = Math.min(1, accel * DT / Math.max(0.001, speed) * 1.0);
  ps.vel[0] += (tx - ps.vel[0]) * (ps.grounded ? Math.min(1, 14 * DT) : Math.min(1, 2 * DT));
  ps.vel[2] += (tz - ps.vel[2]) * (ps.grounded ? Math.min(1, 14 * DT) : Math.min(1, 2 * DT));
  void k; void accel;
  // вертикаль
  ps.vel[1] += GRAVITY * DT;
  if (ps.grounded && ps.vel[1] < 0) ps.vel[1] = 0; // на земле держит snap-to-ground; постоянный прижим мешал бы подъёму по склонам
  if (input.jump && ps.grounded && st === 0) { ps.vel[1] = PLAYER.jump; ps.grounded = false; }
  // --- сползание по крутому склону ---
  // Раньше на земле вертикальная скорость обнулялась каждый кадр, поэтому персонаж
  // «стоял» на 55° как приклеенный: разогнаться вниз было нечем. Теперь сползание — это
  // отдельная горизонтальная скорость вдоль склона, она живёт своей жизнью.
  if (ps.grounded && ps.slopeDeg >= PLAYER.slideFrom) {
    const [dx, dz] = downhill(ps.groundNormal);
    const k = Math.sin((ps.slopeDeg * Math.PI) / 180);
    ps.pushVel[0] += dx * PLAYER.slideAccel * k * DT;
    ps.pushVel[2] += dz * PLAYER.slideAccel * k * DT;
    const sp = Math.hypot(ps.pushVel[0], ps.pushVel[2]);
    if (sp > PLAYER.slideMax) { ps.pushVel[0] *= PLAYER.slideMax / sp; ps.pushVel[2] *= PLAYER.slideMax / sp; }
    ps.sliding = true;
  } else {
    // трение о землю: сползание затухает
    const damp = Math.exp(-8 * DT);
    ps.pushVel[0] *= damp; ps.pushVel[2] *= damp;
    if (Math.abs(ps.pushVel[0]) < 0.02) ps.pushVel[0] = 0;
    if (Math.abs(ps.pushVel[2]) < 0.02) ps.pushVel[2] = 0;
    ps.sliding = false;
  }
  // движение
  const desired = { x: (ps.vel[0] + ps.pushVel[0]) * DT, y: ps.vel[1] * DT, z: (ps.vel[2] + ps.pushVel[2]) * DT };
  cc.computeColliderMovement(pCol, desired);
  const m = cc.computedMovement();
  const grounded = cc.computedGrounded();
  // Нормаль опоры — отдельным лучом вниз. Столкновения character controller'а пусты,
  // когда персонаж стоит без движения (это и было причиной «склона 0°»), а луч есть всегда.
  const prevFeet = pBody.translation();
  const gRay = new RAPIER.Ray({ x: prevFeet.x, y: prevFeet.y, z: prevFeet.z }, { x: 0, y: -1, z: 0 });
  const gHit = world.castRayAndGetNormal(gRay, (stanceH[st] / 2) + 0.45, true, undefined, undefined, pCol);
  if (gHit) {
    ps.groundNormal = { x: gHit.normal.x, y: gHit.normal.y, z: gHit.normal.z };
    ps.slopeDeg = Math.acos(Math.max(-1, Math.min(1, gHit.normal.y))) * 180 / Math.PI;
  } else {
    ps.groundNormal = { x: 0, y: 1, z: 0 };
    ps.slopeDeg = 0;
  }
  const t = pBody.translation();
  const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
  pBody.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
  // реальная скорость по результату (чтобы упираться в стены)
  ps.vel[0] = m.x / DT; ps.vel[2] = m.z / DT;
  if (grounded && ps.vel[1] <= 0) ps.vel[1] = 0;
  if (!grounded && m.y > desired.y + 1e-5 && ps.vel[1] > 0) ps.vel[1] = m.y / DT; // потолок/ступень
  if (ps.vel[1] > 0 && m.y < desired.y * 0.5) ps.vel[1] = 0; // удар головой
  const h = stanceH[st];
  ps.feet = [nx, ny - h / 2, nz];
  // (флаг sliding теперь ставится в блоке сползания выше)
  // падение
  if (!grounded) { if (ps.wasGrounded) ps.airTopY = ps.feet[1]; else ps.airTopY = Math.max(ps.airTopY, ps.feet[1]); }
  if (grounded && !ps.wasGrounded) {
    const drop = ps.airTopY - ps.feet[1];
    if (drop > PLAYER.fallDamageFrom) ps.hp -= (drop - PLAYER.fallDamageFrom) * 14;
    if (drop > PLAYER.fallDamageFrom) ps.hurtAt = PLAYER.hpRegenDelay;
  }
  ps.wasGrounded = grounded; ps.grounded = grounded;
  // РЕГЕНЕРАЦИЯ ЗДОРОВЬЯ (как в Battlefield): после боя здоровье медленно возвращается.
  // Раньше HP умело только падать, и любой ушиб навсегда выводил игрока из боя.
  if (ps.hp < ps.hpLimit) {
    if (ps.hurtAt > 0) ps.hurtAt -= DT;
    else ps.hp = Math.min(ps.hpLimit, ps.hp + PLAYER.hpRegen * DT);
  } else ps.hurtAt = 0;
  // упал за карту / умер -> респавн
  if (ps.feet[1] < -60 || ps.hp <= 0) { spawnPlayer(ps.spawn); }
}

// ---------- техника (ТЗ п.4.3) ----------
// Машина — кинематическое тело с СОБСТВЕННОЙ ходовой: шаг считается в game/vehicleRig.ts
// по высотам земли под колёсами (castRay вниз), а в мир она отдаёт позицию. Так физика
// не «воюет» с пружинами подвески, а поведение (букс, разворот гусениц, повреждения
// узлов) остаётся предсказуемым и проверяемым тестом.
interface VehicleRT {
  desc: VehicleDesc;
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number; yawRate: number; steer: number;
  gear: -1 | 0 | 1;
  throttle: number; steerIn: number; handbrake: boolean;
  damaged: { track: boolean; engine: boolean; turret: boolean };
  rb: RAPIER.RigidBody;
}
const vehicles = new Map<number, VehicleRT>();
/** в какой машине игрок (−1 — пешком) */
let playerVehicle = -1;

function vehicleContacts(v: VehicleRT) {
  const spec = v.desc;
  const c = Math.cos(v.yaw), s2 = Math.sin(v.yaw);
  return spec.wheels.map(w => {
    const x = w.pos[0] * c + w.pos[2] * s2;
    const z = -w.pos[0] * s2 + w.pos[2] * c;
    const ox = v.pos[0] + x, oy = v.pos[1] + w.pos[1], oz = v.pos[2] + z;
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: 0, y: -1, z: 0 });
    const hit = world.castRayAndGetNormal(ray, w.radius + w.travel + 0.6, true);
    if (!hit) return { ground: null as number | null, normal: [0, 1, 0] as [number, number, number], surface: 'dirt' };
    const meta = colMeta.get(hit.collider.handle);
    const gy = oy - hit.timeOfImpact;
    return {
      ground: gy,
      normal: [hit.normal.x, hit.normal.y, hit.normal.z] as [number, number, number],
      surface: (meta?.surface ?? 'dirt') as string,
    };
  });
}

function addVehicle(v: VehicleDesc) {
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(v.pos[0], v.pos[1], v.pos[2]));
  world.createCollider(RAPIER.ColliderDesc.cuboid(v.size[0] / 2, v.size[1] / 2, v.size[2] / 2)
    .setFriction(0.6).setRestitution(0.05), rb);
  vehicles.set(v.id, {
    desc: v, pos: [...v.pos], vel: [0, 0, 0], yaw: v.yaw, yawRate: 0, steer: 0, gear: 1,
    throttle: 0, steerIn: 0, handbrake: false,
    damaged: { track: false, engine: false, turret: false }, rb,
  });
}

function removeVehicle(id: number) {
  const v = vehicles.get(id);
  if (!v) return;
  world.removeRigidBody(v.rb); vehicles.delete(id);
  if (playerVehicle === id) { playerVehicle = -1; if (pBody) ps.feet = [...v.pos]; }
}

/** Шаг всех машин: ходовая, столкновения корпусом (таран) и высадка игрока. */
function stepVehicles() {
  for (const v of vehicles.values()) {
    const contacts = vehicleContacts(v);
    const st = {
      spec: vehicleSpecOf(v.desc), pos: v.pos, vel: v.vel, yaw: v.yaw, yawRate: v.yawRate,
      steer: v.steer, gear: v.gear, damaged: v.damaged,
    } as any;
    const r = stepVehicleLocal(st, DT, { throttle: v.throttle, steer: v.steerIn, handbrake: v.handbrake }, contacts);
    v.vel[1] += (r.force[1] / v.desc.mass - 9.81) * DT;
    v.vel[0] += (r.force[0] / v.desc.mass) * DT;
    v.vel[2] += (r.force[2] / v.desc.mass) * DT;
    v.vel[0] *= 0.995; v.vel[2] *= 0.995;
    v.pos[0] += v.vel[0] * DT; v.pos[1] += v.vel[1] * DT; v.pos[2] += v.vel[2] * DT;
    v.yawRate += r.torqueY * DT;
    v.yaw += v.yawRate * DT;
    v.steer = st.steer;
    // корпус не проваливается сквозь землю и не улетает: держим на поверхности
    const gy = contacts.find(c => c.ground != null)?.ground ?? null;
    const minY = (gy ?? v.pos[1]) + v.desc.wheels[0].radius * 0.5;
    if (v.pos[1] < minY) { v.pos[1] = minY; if (v.vel[1] < 0) v.vel[1] = 0; }
    v.rb.setNextKinematicTranslation({ x: v.pos[0], y: v.pos[1], z: v.pos[2] });
    v.rb.setNextKinematicRotation({ x: 0, y: Math.sin(v.yaw / 2), z: 0, w: Math.cos(v.yaw / 2) });

    // игрок внутри: его положение = сиденье машины (камера едет вместе с ней)
    if (playerVehicle === v.desc.id && pBody) {
      const c = Math.cos(v.yaw), s2 = Math.sin(v.yaw);
      const seatX = v.pos[0] + (-0.35 * c + 0.2 * s2), seatZ = v.pos[2] + (0.35 * s2 + 0.2 * c);
      ps.feet = [seatX, v.pos[1] + 0.4, seatZ];
      ps.vel = [...v.vel]; ps.grounded = true;
      pBody.setNextKinematicTranslation({ x: seatX, y: ps.feet[1] + stanceH[ps.stance] / 2, z: seatZ });
    }
    // таран: если впереди препятствие и скорость высокая — импульс и урон (ТЗ 4.3)
    const speed = Math.hypot(v.vel[0], v.vel[2]);
    if (speed > 3) {
      const ray = new RAPIER.Ray({ x: v.pos[0], y: v.pos[1] + 0.6, z: v.pos[2] },
        { x: Math.sin(v.yaw), y: 0, z: Math.cos(v.yaw) });
      const hit = world.castRay(ray, v.desc.size[2] / 2 + 0.4, true, undefined, undefined, vehicles.get(v.desc.id)!.rb as any);
      if (hit) {
        const meta = colMeta.get(hit.collider.handle);
        const other = meta?.bodyId ?? -1;
        const otherRb = bodies.get(other);
        const mOther = otherRb ? Math.max(1, otherRb.mass()) : 5000;   // стена — «очень тяжёлая»
        const mEff = (v.desc.mass * mOther) / (v.desc.mass + mOther);
        const imp = mEff * speed;
        otherRb?.wakeUp();
        otherRb?.applyImpulse({ x: ray.dir.x * imp, y: imp * 0.06, z: ray.dir.z * imp }, true);
        // встречный урон: чем «твёрже» цель, тем больнее машине
        const hardness = meta?.building ? 1 : 0.25;
        const dmg = Math.min(45, (imp / Math.max(1, v.desc.mass)) * 3.2 * hardness);
        if (dmg > 0.5) {
          v.vel[0] *= 0.35; v.vel[2] *= 0.35;
          if (dmg > 12) {   // сильный удар ломает гусеницу/двигатель
            if (v.desc.drive === 'tracked') v.damaged.track = true; else v.damaged.engine = true;
          }
        }
      }
    }
    (self as any).postMessage({
      type: 'vehicle', id: v.desc.id, pos: [...v.pos], yaw: v.yaw,
      speed: speed * 3.6, wheelComp: r.wheels.map(w => w.compression), slip: r.wheels.some(w => w.slip),
      damaged: { ...v.damaged },
    } satisfies FromWorker);
  }
}

/**
 * Мост между описанием машины из воркера и функциями ходовой из game/vehicleRig.ts.
 * Описание приходит из основного потока (VehicleDesc), поэтому здесь собираем
 * VehicleSpec «на лету» — без импорта таблицы VEHICLES в воркер.
 */
function vehicleSpecOf(d: VehicleDesc) {
  return {
    id: d.specId, name: d.specId, model: d.specId, drive: d.drive, mass: d.mass,
    maxSpeed: d.maxSpeed, power: d.power, steerMax: d.steerMax, pivotRate: d.pivotRate,
    size: d.size, armor: 0, crew: 0, wheels: d.wheels,
  } as any;
}

// ---------- тела ----------
function colliderDesc(s: Shape): RAPIER.ColliderDesc | null {
  let d: RAPIER.ColliderDesc | null = null;
  switch (s.t) {
    case 'box': d = RAPIER.ColliderDesc.cuboid(...s.he); if (s.rotY) d.setRotation({ x: 0, y: Math.sin(s.rotY / 2), z: 0, w: Math.cos(s.rotY / 2) }); break;
    case 'ball': d = RAPIER.ColliderDesc.ball(s.r); break;
    case 'cyl': d = RAPIER.ColliderDesc.cylinder(s.hh, s.r); break;
    case 'hull': d = RAPIER.ColliderDesc.convexHull(s.points instanceof Float32Array ? s.points : new Float32Array(s.points)); break;
    case 'trimesh': d = RAPIER.ColliderDesc.trimesh(s.verts, s.idx); break;
    case 'heightfield': d = RAPIER.ColliderDesc.heightfield(s.nrows, s.ncols, s.heights, { x: s.scale[0], y: s.scale[1], z: s.scale[2] }); break;
  }
  if (d && 'pos' in s && s.pos) d.setTranslation(...s.pos);
  return d;
}
function addBody(b: BodyDesc) {
  const rb = world.createRigidBody((b.kind === 'static' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
    .setTranslation(...b.pos).setLinearDamping(b.linDamp ?? 0.05).setAngularDamping(b.angDamp ?? 0.2).setCanSleep(true).setCcdEnabled(b.kind === 'dynamic'));
  const q = b.quat ?? (b.rotY ? [0, Math.sin(b.rotY / 2), 0, Math.cos(b.rotY / 2)] : null);
  if (q) rb.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
  const n = b.shapes.length;
  b.shapes.forEach((s, si) => {
    const d = colliderDesc(s); if (!d) { console.warn('collider failed', b.id, s.t); return; }
    d.setFriction(b.friction ?? 0.7).setRestitution(b.restitution ?? 0.1);
    if (b.kind === 'dynamic' && b.mass) d.setMass(b.mass / n);
    const col = world.createCollider(d, rb);
    // панель дома: каждая форма — отдельная панель, panel = индекс в спецификации
    const panel = b.building ? (b.panels?.[si] ?? si) : -1;
    colMeta.set(col.handle, {
      bodyId: b.id, panel, surface: (b.surface ?? 'concrete') as Surface,
      building: !!b.building, thin: !!b.thin, group: b.group ?? 0,
    });
    if (b.building && panel >= 0) panelCols.set(`${b.id}:${panel}`, col);
  });
  bodies.set(b.id, rb);
  if (b.kind === 'dynamic') { dynIds.add(b.id); if (b.sleeping) rb.sleep(); }
}

/** Удаление одной панели: коллайдер из физики убираем, тело дома остаётся. */
function removePanel(bodyId: number, panel: number) {
  const key = `${bodyId}:${panel}`;
  const col = panelCols.get(key);
  if (col) { colMeta.delete(col.handle); world.removeCollider(col, false); panelCols.delete(key); }
}
function explosion(pos: [number, number, number], radius: number, impulse: number) {
  for (const id of dynIds) {
    const rb = bodies.get(id)!; const t = rb.translation();
    const dx = t.x - pos[0], dy = t.y - pos[1] + 0.3, dz = t.z - pos[2]; const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    const fall = 1 - d / radius; const mass = Math.max(rb.mass(), 1);
    const j = impulse * fall * Math.sqrt(mass) * 0.1; // импульс ~ sqrt(m): лёгкие улетают, тяжёлые чуть сдвигаются
    const inv = 1 / Math.max(d, 0.3);
    rb.wakeUp(); rb.applyImpulse({ x: dx * inv * j, y: (dy * inv + 0.6) * j, z: dz * inv * j }, true);
    rb.applyTorqueImpulse({ x: (Math.random() - 0.5) * j * 0.1, y: (Math.random() - 0.5) * j * 0.1, z: (Math.random() - 0.5) * j * 0.1 }, true);
  }
  if (pBody) { // ударная волна отбрасывает игрока
    const dx = ps.feet[0] - pos[0], dy = ps.feet[1] + 1 - pos[1], dz = ps.feet[2] - pos[2]; const d = Math.hypot(dx, dy, dz);
    if (d < radius) { const f = (1 - d / radius) * 22; const inv = 1 / Math.max(d, 0.5); ps.vel[0] += dx * inv * f; ps.vel[1] += (dy * inv + 0.5) * f * 0.7; ps.vel[2] += dz * inv * f; ps.grounded = false; ps.hp -= (1 - d / radius) * 35; ps.hurtAt = PLAYER.hpRegenDelay; }
  }
}

// ---------- баллистика ----------
// Каждый снаряд интегрируется подшагами: пуля летит 900 м/с = 15 м за кадр, поэтому
// одиночный луч «от точки до точки» пропускал бы стены. Подшаг 1/600 с даёт 1,5 м —
// этого достаточно, чтобы заметить панель толщиной 0.32 м.
const impactsOut: Impact[] = [];
const _hitVec = { x: 0, y: 0, z: 0 };

function stepProjectile(tr: Tracer, dt: number) {
  const n = Math.max(1, Math.min(40, Math.ceil(dt / BALLISTICS.substep)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    tr.prev = [tr.pos[0], tr.pos[1], tr.pos[2]];
    const v = Math.hypot(tr.vel[0], tr.vel[1], tr.vel[2]);
    if (v < 1e-4) return false;
    // сопротивление воздуха: a = -k * v * v_vec
    const kk = (BALLISTICS.dragK / (tr.bc ?? 1)) * v;
    tr.vel[0] += -kk * tr.vel[0] * h;
    tr.vel[1] += (-kk * tr.vel[1] + BALLISTICS.gravity) * h;
    tr.vel[2] += -kk * tr.vel[2] * h;
    const nx = tr.pos[0] + tr.vel[0] * h, ny = tr.pos[1] + tr.vel[1] * h, nz = tr.pos[2] + tr.vel[2] * h;
    const dx = nx - tr.pos[0], dy = ny - tr.pos[1], dz = nz - tr.pos[2];
    const seg = Math.hypot(dx, dy, dz);
    if (seg < 1e-6) continue;
    const dir = { x: dx / seg, y: dy / seg, z: dz / seg };
    const ray = new RAPIER.Ray({ x: tr.pos[0], y: tr.pos[1], z: tr.pos[2] }, dir);
    // снаряд не должен попадать в собственный ствол/игрока — исключаем коллайдер игрока
    const hit = world.castRayAndGetNormal(ray, seg, true, undefined, undefined, pCol ?? undefined);
    if (!hit) { tr.pos = [nx, ny, nz]; continue; }

    const meta = colMeta.get(hit.collider.handle);
    const point: [number, number, number] = [tr.pos[0] + dir.x * hit.timeOfImpact, tr.pos[1] + dir.y * hit.timeOfImpact, tr.pos[2] + dir.z * hit.timeOfImpact];
    const normal: [number, number, number] = [hit.normal.x, hit.normal.y, hit.normal.z];
    const surface: Surface = meta?.surface ?? 'dirt';
    // угол к нормали: 0 — в лоб
    const cosA = Math.abs(dir.x * normal[0] + dir.y * normal[1] + dir.z * normal[2]);
    const angleDeg = Math.acos(Math.min(1, cosA)) * 180 / Math.PI;

    if (tr.explosive) {
      // РПГ/ВОГ: взрыв в точке попадания, дальше снаряд не летит
      impactsOut.push({ kind: 'explosive', tracer: tr.id, pos: point, normal, surface, penetrated: false, damage: tr.explosive.damage, bodyId: meta?.bodyId ?? -1, panel: meta?.panel ?? -1 });
      explosion(point, tr.explosive.radius, 260);
      return false;
    }

    const { penetrated, remain } = penetrationResult(tr.penetration, surface, angleDeg);
    const s = SURFACES[surface];
    // урон по материалу: пробитие «тратится», остаток = сила удара
    const dmg = Math.max(1, tr.penetration * 26 * s.dmgMul);
    impactsOut.push({ kind: 'bullet', tracer: tr.id, pos: point, normal, surface, penetrated, damage: dmg, bodyId: meta?.bodyId ?? -1, panel: meta?.panel ?? -1 });

    // рикошет: скользящее попадание по металлу/бетону — пуля уходит в сторону
    const ric = angleDeg < s.ricochet && Math.random() < (s.ricochet - angleDeg) / s.ricochet * 0.8;
    if (ric && !penetrated) {
      const d = { x: dir.x, y: dir.y, z: dir.z };
      const dot = d.x * normal[0] + d.y * normal[1] + d.z * normal[2];
      tr.vel = [d.x - 2 * dot * normal[0], d.y - 2 * dot * normal[1], d.z - 2 * dot * normal[2]];
      const sp = Math.hypot(tr.vel[0], tr.vel[1], tr.vel[2]) * 0.65;
      const l = Math.hypot(tr.vel[0], tr.vel[1], tr.vel[2]) || 1;
      tr.vel = [tr.vel[0] / l * sp, tr.vel[1] / l * sp, tr.vel[2] / l * sp];
      tr.pos = [point[0] + normal[0] * 0.02, point[1] + normal[1] * 0.02, point[2] + normal[2] * 0.02];
      tr.penetration = remain * 0.5;
      continue;
    }
    if (!penetrated) return false; // пуля осталась в стене/броне
    // пробила: летит дальше с меньшей скоростью и пробитием
    const speed = Math.hypot(tr.vel[0], tr.vel[1], tr.vel[2]) * 0.55;
    const l = Math.hypot(tr.vel[0], tr.vel[1], tr.vel[2]) || 1;
    tr.vel = [tr.vel[0] / l * speed, tr.vel[1] / l * speed, tr.vel[2] / l * speed];
    tr.pos = [point[0] + dir.x * 0.35, point[1] + dir.y * 0.35, point[2] + dir.z * 0.35];
    tr.penetration = remain;
  }
  return true;
}

let lastTracerSend = 0;
function stepTracers(dt: number) {
  if (!tracers.length) return;
  impactsOut.length = 0;
  const alive: Tracer[] = [];
  for (const tr of tracers) {
    tr.life -= dt;
    if (tr.life <= 0) continue;
    if (stepProjectile(tr, dt)) alive.push(tr);
  }
  tracers = alive;
  if (impactsOut.length) (self as any).postMessage({ type: 'impacts', impacts: impactsOut.slice() } satisfies FromWorker);
  const nowMs = performance.now();
  if (tracers.length && nowMs - lastTracerSend > 33) { // 30 Гц достаточно для отрисовки трассеров
    lastTracerSend = nowMs;
    (self as any).postMessage({ type: 'tracers', tracers: tracers.map(t => ({ ...t })) } satisfies FromWorker);
  }
}

// ---------- цикл ----------
let acc = 0, last = 0, stepMs = 0;
function snapshot() {
  const awake: number[] = [];
  for (const id of dynIds) { const rb = bodies.get(id)!; if (!rb.isSleeping()) awake.push(id); }
  const ids = new Int32Array(awake.length), tf = new Float32Array(awake.length * 7);
  awake.forEach((id, i) => { const rb = bodies.get(id)!; const t = rb.translation(), r = rb.rotation(); ids[i] = id; tf.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], i * 7); });
  const player: PlayerState | null = pBody ? { pos: [...ps.feet] as any, vel: [...ps.vel] as any, grounded: ps.grounded, stance: ps.stance, stamina: ps.stamina, hp: ps.hp, sliding: ps.sliding, eye: stanceEye[ps.stance], slope: ps.slopeDeg } : null;
  const msg: FromWorker = { type: 'snapshot', t: performance.now(), ids, tf, player, awake: awake.length, total: dynIds.size, stepMs };
  (self as any).postMessage(msg, [ids.buffer, tf.buffer]);
}
function loop() {
  const now = performance.now(); acc += Math.min(0.1, (now - last) / 1000); last = now;
  let n = 0;
  while (acc >= DT && n < 5) { const t0 = performance.now(); stepVehicles(); stepPlayer(); stepTracers(DT); world.step(eventQueue); stepMs = stepMs * 0.9 + (performance.now() - t0) * 0.1; acc -= DT; n++; }
  if (n) snapshot();
  setTimeout(loop, 3);
}

(self as any).onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': break;
    case 'addBodies': m.bodies.forEach(addBody); break;
    case 'removeBody': { const rb = bodies.get(m.id); if (rb) { world.removeRigidBody(rb); bodies.delete(m.id); dynIds.delete(m.id); } break; }
    case 'input': input = m.input; break;
    case 'spawnPlayer': spawnPlayer(m.pos); break;
    case 'impulse': { const rb = bodies.get(m.id); rb?.applyImpulse({ x: m.imp[0], y: m.imp[1], z: m.imp[2] }, true); break; }
    case 'explosion': explosion(m.pos, m.radius, m.impulse); break;
    case 'heal': ps.hp = Math.min(ps.hpLimit, ps.hp + Math.max(0, m.hp)); break;
    case 'hurt': if (m.damage > 0) { ps.hp -= m.damage; ps.hurtAt = PLAYER.hpRegenDelay; } break;
    case 'maxHp': {
      // предел здоровья от класса: поддержка крепче, разведчик хрупче.
      // Текущее HP НЕ поднимаем (иначе смена класса = бесплатное лечение).
      ps.hpLimit = m.hp;
      ps.hp = Math.min(ps.hp, ps.hpLimit);
      break;
    }
    case 'shoot': tracers.push({ ...m.tracer }); break;
    case 'removePanel': removePanel(m.bodyId, m.panel); break;
    case 'addVehicle': addVehicle(m.v); break;
    case 'removeVehicle': removeVehicle(m.id); break;
    case 'drive': {
      const v = vehicles.get(m.id); if (!v) break;
      v.throttle = Math.max(-1, Math.min(1, m.throttle));
      v.steerIn = Math.max(-1, Math.min(1, m.steer));
      v.handbrake = m.handbrake;
      v.gear = v.throttle < 0 ? -1 : 1;
      if (playerVehicle === m.id && pBody) ps.grounded = true;
      break;
    }
    case 'enterVehicle': {
      // сесть можно только рядом с машиной (2.5 м), иначе игнорируем
      const v = vehicles.get(m.id);
      if (!v) { playerVehicle = -1; break; }
      const d = Math.hypot(ps.feet[0] - v.pos[0], ps.feet[2] - v.pos[2]);
      playerVehicle = d < 4 ? m.id : -1;
      if (playerVehicle >= 0) { ps.stance = 0; }
      break;
    }
    case 'damageVehicle': {
      const v = vehicles.get(m.id); if (!v) break;
      if (m.part === 'track') v.damaged.track = true;
      if (m.part === 'engine') v.damaged.engine = true;
      if (m.part === 'turret') v.damaged.turret = true;
      break;
    }
    case 'ray': {
      // Луч от камеры. Нужен, чтобы ствол смотрел РОВНО в перекрестие, а не «примерно».
      const ray = new RAPIER.Ray({ x: m.origin[0], y: m.origin[1], z: m.origin[2] }, { x: m.dir[0], y: m.dir[1], z: m.dir[2] });
      const hit = world.castRay(ray, m.max, true, undefined, undefined, pCol ?? undefined);
      const out: FromWorker = hit
        ? { type: 'ray', id: m.id, dist: hit.timeOfImpact, point: [
            m.origin[0] + m.dir[0] * hit.timeOfImpact, m.origin[1] + m.dir[1] * hit.timeOfImpact, m.origin[2] + m.dir[2] * hit.timeOfImpact] }
        : { type: 'ray', id: m.id, dist: null };
      (self as any).postMessage(out);
      break;
    }
  }
};

(async () => {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = DT;
  eventQueue = new RAPIER.EventQueue(true);
  cc = world.createCharacterController(0.02);
  cc.enableAutostep(PLAYER.stepHeight, 0.2, false);
  cc.enableSnapToGround(0.35);
  cc.setMaxSlopeClimbAngle((PLAYER.slopeMax * Math.PI) / 180);
  cc.setMinSlopeSlideAngle((PLAYER.slopeMax * Math.PI) / 180);
  cc.setApplyImpulsesToDynamicBodies(true);
  cc.setCharacterMass(80);
  cc.setUp({ x: 0, y: 1, z: 0 });
  last = performance.now();
  (self as any).postMessage({ type: 'ready' } satisfies FromWorker);
  loop();
})();
