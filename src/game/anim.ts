// АНИМАЦИЯ ХОДЬБЫ БОТОВ (просьба: «когда у них анимация ходьбы будет»).
//
// В модели `soldier.glb` НЕТ клипов анимации (animations: [] в манифесте), но есть
// скелет: 37 узлов Grp_* (бёдра, колени, ступни, руки, предплечья, голова). Поэтому
// ходьба делается ПРОЦЕДУРНО — поворотами этих узлов по синусу:
//
//   • ноги машут в противофазе (левая вперёд — правая назад);
//   • колени сгибаются только на «заднем» шаге (иначе нога выворачивается);
//   • руки качаются в противофазе ногам;
//   • корпус чуть покачивается и покачивается вверх-вниз на каждом шаге.
//
// Почему так, а не клипы: своих анимаций нет, а «ходить по земле, не шевеля ногами»
// выглядит как скользящий манекен — на этом и был запрос. Заодно боты поворачивают
// корпус в сторону цели (torsoYaw) — видно, куда они смотрят.
import * as THREE from 'three';
import { RIG_MAP } from './rigMap.ts';

/** Записать угол в нужную ось Euler (TS не даёт индексировать Euler строкой). */
function setEulerAxis(e: THREE.Euler, axis: 'x' | 'y' | 'z', v: number) {
  if (axis === 'x') e.x = v; else if (axis === 'y') e.y = v; else e.z = v;
}

/** Насколько опустить плечи из T-позы (радианы). Подобрано рендером бота. */
export const ARM_DOWN = -1.42;

interface Joints {
  thighL?: THREE.Object3D; thighR?: THREE.Object3D;
  shinL?: THREE.Object3D; shinR?: THREE.Object3D;
  footL?: THREE.Object3D; footR?: THREE.Object3D;
  armL?: THREE.Object3D; armR?: THREE.Object3D;
  forearmL?: THREE.Object3D; forearmR?: THREE.Object3D;
  head?: THREE.Object3D; chest?: THREE.Object3D;
  /** базовые повороты костей: считаются один раз, чтобы анимация шла от них */
  base: Map<THREE.Object3D, THREE.Euler>;
}

/** Ищем кости по именам Sketchfab-скелета (латинская транслитерация вьетнамских). */
function findJoint(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse(o => { if (!found && re.test(o.name)) found = o; });
  return found;
}

export class WalkAnim {
  joints: Joints;
  /** исходная (rest) поза костей — для сброса и подбора базовой позы */
  private rest!: Map<THREE.Object3D, THREE.Euler>;
  /** фаза шага, радианы */
  phase = 0;
  /** текущая «скорость» анимации (0 — стоит) */
  speed = 0;
  /** наклон корпуса в сторону цели, радианы */
  torsoYaw = 0;

  /**
   * @param root модель бота
   * @param rigId id модели (soldier_ussr / soldier_opfor): по нему берём готовую карту
   *   костей из src/game/rigMap.ts. Без карты кости ищутся по именам (первая модель).
   */
  constructor(root: THREE.Object3D, rigId?: string) {
    const base = new Map<THREE.Object3D, THREE.Euler>();
    const joints: Joints = {
      thighL: findJoint(root, /^Grp_Dui_l_/),
      thighR: findJoint(root, /^Grp_Dui_r_/),
      shinL: findJoint(root, /^Grp_Cangchan_l_/),
      shinR: findJoint(root, /^Grp_Cangchan_r_/),
      footL: findJoint(root, /^Grp_Giay_l_/),
      footR: findJoint(root, /^Grp_Giay_r_/),
      armL: findJoint(root, /^Grp_Baptay_l_/),
      armR: findJoint(root, /^Grp_Baptay_r_/),
      forearmL: findJoint(root, /^Grp_Cangtay_l_/),
      forearmR: findJoint(root, /^Grp_Cangtay_r_/),
      head: findJoint(root, /^Grp_Dau_/),
      chest: findJoint(root, /^Grp_Than_/),
      base,
    };
    // Вторая модель (OPFOR): имена костей — `Bone.*`, по регэкспам не найти.
    // Берём карту, сгенерированную tools/rig-map.mjs по весам скиннинга
    // (угадывание «по положению узла» давало шпагат — проверено рендером).
    if (rigId && RIG_MAP[rigId]) {
      const byName = new Map<string, THREE.Object3D>();
      root.traverse(o => { if (o.name) byName.set(o.name, o); });
      for (const [k, name] of Object.entries(RIG_MAP[rigId].joints)) {
        const o = byName.get(name);
        if (o) (joints as any)[k] = o;
      }
    }
    for (const j of Object.values(joints)) {
      if (j && j instanceof THREE.Object3D) base.set(j, j.rotation.clone());
    }
    this.joints = joints;
    // rest-поза (как в GLB) — от неё считаются все подборы базовой позы
    this.rest = new Map([...base].map(([o, e]) => [o, e.clone()]));
    // БАЗОВАЯ ПОЗА: у модели rest-поза = T-поза (руки в стороны). Если её не опустить,
    // бот стоит с раскинутыми руками — ровно то, что видно на скриншоте.
    // Опускаем плечи вращением вокруг локальной оси Z (проверено рендером
    // tools/preview-bot.mjs) и чуть сгибаем локти.
    this.applyBasePose(root);
  }

  /**
   * Опустить руки из T-позы и поставить ступни на ширину плеч.
   * Вызывается один раз в конструкторе; walking-анимация уже считается от этой позы.
   */
  applyBasePose(modelRoot?: THREE.Object3D) {
    const j = this.joints;
    const root = modelRoot;
    // ВАЖНО: правим именно БАЗУ (карту base), иначе update() каждый кадр берёт старую
    // T-позу и затирает опущенные руки — из-за этого бот и стоял с раскинутыми руками.
    const set = (o: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!o) return;
      this.setLocalDelta(o, new THREE.Euler(x, y, z, 'XYZ'));
      // ЗАПОМИНАЕМ результат как новую базу: иначе первый же update() возьмёт
      // исходную T-позу и вернёт руки обратно в стороны
      const b = j.base.get(o);
      if (b) b.copy(o.rotation);
    };
    // ПЛЕЧИ: какая ось и какой знак опускают кисть — зависит от скелета, поэтому не
    // угадываем, а МЕРЯЕМ: перебираем оси и знаки, оставляем вариант с самой низкой кистью.
    const hand = j.forearmL ?? j.armL;
    const handY = () => {
      if (!hand) return 0;
      root?.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld).y;
    };
    const rest = handY();
    // порог «рука опустилась» считаем от РОСТА модели: у одной модели 1.8 м,
    // у другой — 0.11 условных единиц (масштаб задаёт манифест)
    const modelH = root ? new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y : 1.8;
    const eps = Math.max(1e-4, modelH * 0.03);
    let best: { axis: 'x' | 'y' | 'z'; sign: number; y: number } = { axis: 'z', sign: 1, y: rest };
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const sign of [1, -1]) {
        this.resetJoints();
        const d = new THREE.Euler();
        setEulerAxis(d, axis, ARM_DOWN * sign);
        this.setLocalDelta(j.armL!, d);
        this.setLocalDelta(j.armR!, new THREE.Euler(-d.x, -d.y, -d.z));
        const y = handY();
        if (y < best.y - 1e-3) best = { axis, sign, y };
      }
    }
    this.resetJoints();
    // руки заметно опустились? тогда фиксируем позу, иначе оставляем rest-позу как есть
    if (best.y < rest - eps && j.armL && j.armR) {
      const d = new THREE.Euler();
      setEulerAxis(d, best.axis, ARM_DOWN * best.sign);
      set(j.armL, d.x, d.y, d.z);
      set(j.armR, -d.x, -d.y, -d.z);
      const f = new THREE.Euler();
      setEulerAxis(f, best.axis, -0.35 * best.sign);
      set(j.forearmL, f.x, f.y, f.z);
      set(j.forearmR, -f.x, -f.y, -f.z);
    }

  }

  /**
   * Повернуть кость на ДЕЛЬТУ, заданную в МИРОВЫХ осях (X — поперёк, Y — вверх, Z — вперёд).
   *
   * Зачем: у первой модели локальные оси костей совпадают с «человеческими», у второй
   * (OPFOR) — повёрнуты вместе со скелетом. Из-за этого одинаковый код давал на второй
   * модели шпагат и руки назад. Пересчёт мировой дельты в локальную делает анимацию
   * независимой от ориентации скелета.
   */
  private setLocalDelta(o: THREE.Object3D, delta: THREE.Euler) {
    const parent = o.parent;
    const pq = new THREE.Quaternion();
    if (parent) parent.getWorldQuaternion(pq); else pq.identity();
    const dq = new THREE.Quaternion().setFromEuler(delta);
    // world = parent * local  →  local = parent⁻¹ * world
    const lq = pq.clone().invert().multiply(dq).multiply(pq);
    const base = this.joints.base.get(o);
    const bq = new THREE.Quaternion().setFromEuler(base ?? o.rotation);
    o.quaternion.copy(lq).multiply(bq);
    o.rotation.setFromQuaternion(o.quaternion);
  }

  /** Вернуть все кости в исходную (rest) позу — служебное, для подбора базовой позы. */
  private resetJoints() {
    for (const [o] of this.joints.base) {
      const rest = this.rest.get(o);
      if (rest) { o.rotation.copy(rest); this.joints.base.get(o)?.copy(rest); }
    }
  }

  /** Сбросить кость в базовую позу. */
  private resetJoint(o: THREE.Object3D) {
    const b = this.joints.base.get(o);
    if (b) o.rotation.copy(b);
  }

  /** Есть ли что анимировать (иначе модель без скелета — просто двигаем объект). */
  get ok(): boolean {
    const j = this.joints;
    return !!(j.thighL && j.thighR);
  }

  /** Список найденных костей — для теста и лога загрузки. */
  jointNames(): string[] {
    return Object.entries(this.joints)
      .filter(([, v]) => v && v instanceof THREE.Object3D)
      .map(([k]) => k)
      .filter(k => k !== 'base');
  }

  /**
   * Обновить позу.
   * @param dt секунды
   * @param moveSpeed скорость движения, м/с (0 — стоит)
   * @param aiming доводим корпус в сторону цели
   */
  update(dt: number, moveSpeed: number, torsoYaw = 0) {
    if (!this.ok) return;
    const j = this.joints;
    // частота шага зависит от скорости: на 3 м/с — примерно 1.9 шага в секунду
    const target = Math.min(1, moveSpeed / 3.1);
    this.speed += (target - this.speed) * Math.min(1, dt * 8);
    this.phase += dt * Math.PI * 2 * (0.9 + 1.0 * this.speed);
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    this.torsoYaw += (torsoYaw - this.torsoYaw) * Math.min(1, dt * 6);

    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = this.speed;                       // стоя — без махания
    const rot = (o: THREE.Object3D | undefined, x: number, y = 0, z = 0) => {
      if (!o) return;
      this.setLocalDelta(o, new THREE.Euler(x, y, z, 'XYZ'));
    };

    // НОГИ: бёдра в противофазе, колени — сгиб на заднем шаге.
    // X — поперёк тела: поворот вокруг него и есть «шаг вперёд/назад».
    rot(j.thighL, s * 0.52 * amp);
    rot(j.thighR, -s * 0.52 * amp);
    // колено сгибается НАЗАД (пятка к ягодице): знак тот же, что у «шага назад»
    rot(j.shinL, Math.max(0, -s) * 0.75 * amp);
    rot(j.shinR, Math.max(0, s) * 0.75 * amp);
    rot(j.footL, -Math.max(0, -s) * 0.25 * amp);
    rot(j.footR, -Math.max(0, s) * 0.25 * amp);

    // РУКИ: в противофазе ногам
    // опускание рук уже сделано в базовой позе (applyBasePose) — здесь только мах,
    // иначе за кадр накапливалось двойное опускание и руки уходили за спину
    rot(j.armL, -s * 0.4 * amp);
    rot(j.armR, s * 0.4 * amp);
    rot(j.forearmL, -0.35 - Math.max(0, s) * 0.2 * amp);
    rot(j.forearmR, -0.35 - Math.max(0, -s) * 0.2 * amp);

    // КОРПУС: покачивание и лёгкий наклон, голова смотрит туда же, куда корпус
    if (j.chest) this.setLocalDelta(j.chest, new THREE.Euler(0.04 * amp, this.torsoYaw * 0.55, c * 0.035 * amp, 'XYZ'));
    if (j.head) this.setLocalDelta(j.head, new THREE.Euler(-0.03 * amp, this.torsoYaw * 0.35, 0, 'XYZ'));
  }

  /** Сброс в базовую позу (смерть/рэгдолл). */
  reset() {
    for (const [o, e] of this.joints.base) o.rotation.copy(e);
  }
}

/**
 * «Пружина» шага: покачивание модели вверх-вниз. Отдельно от костей, потому что
 * общий подъём корпуса в скелете задан не у корня, а у таза.
 */
export function bobOffset(phase: number, speed: number): number {
  return Math.abs(Math.sin(phase)) * 0.035 * Math.min(1, speed / 3.1);
}
