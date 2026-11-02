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
  /** фаза шага, радианы */
  phase = 0;
  /** текущая «скорость» анимации (0 — стоит) */
  speed = 0;
  /** наклон корпуса в сторону цели, радианы */
  torsoYaw = 0;

  constructor(root: THREE.Object3D) {
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
    for (const j of Object.values(joints)) {
      if (j && j instanceof THREE.Object3D) base.set(j, j.rotation.clone());
    }
    this.joints = joints;
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
    const set = (o: THREE.Object3D | undefined, x: number, y = 0, z = 0) => {
      if (!o) return;
      const b = j.base.get(o);
      if (b) o.rotation.set(b.x + x, b.y + y, b.z + z);
    };

    // НОГИ: бёдра в противофазе, колени — сгиб на заднем шаге
    set(j.thighL, s * 0.52 * amp);
    set(j.thighR, -s * 0.52 * amp);
    set(j.shinL, Math.max(0, -s) * 0.75 * amp);
    set(j.shinR, Math.max(0, s) * 0.75 * amp);
    set(j.footL, -Math.max(0, -s) * 0.25 * amp);
    set(j.footR, -Math.max(0, s) * 0.25 * amp);

    // РУКИ: в противофазе ногам, предплечья чуть согнуты
    set(j.armL, -s * 0.4 * amp, 0, 0.06 * amp);
    set(j.armR, s * 0.4 * amp, 0, -0.06 * amp);
    set(j.forearmL, -0.35 - Math.max(0, s) * 0.2 * amp);
    set(j.forearmR, -0.35 - Math.max(0, -s) * 0.2 * amp);

    // КОРПУС: покачивание и лёгкий наклон, голова смотрит туда же, куда корпус
    if (j.chest) {
      const b = j.base.get(j.chest);
      if (b) j.chest.rotation.set(b.x + 0.04 * amp, b.y + this.torsoYaw * 0.55, b.z + c * 0.035 * amp);
    }
    if (j.head) {
      const b = j.base.get(j.head);
      if (b) j.head.rotation.set(b.x - 0.03 * amp, b.y + this.torsoYaw * 0.35, b.z);
    }
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
