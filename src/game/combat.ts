// Бой: оружие в руках игрока. Никаких хитсканов — каждый выстрел отправляет снаряд в воркер,
// где он летит по-настоящему (см. worker.ts, stepProjectile).
// Здесь: инвентарь, переключение, темп стрельбы, магазины/перезарядка, разброс, отдача.
import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { PhysicsClient } from '../physics/client';
import type { Effects } from './effects';
import { WEAPONS, weaponById, type WeaponSpec, BALLISTICS } from './weapons';

/**
 * Посадка оружия в руках. Значения подобраны так, чтобы:
 *  - пистолет не занимал пол-экрана (он короткий, ставим ближе к центру и мельче);
 *  - снайперка не торчала из кадра (длинная, ставим дальше и с наклоном);
 *  - гранатомёт не закрывал обзор трубой.
 */
const VM: Record<string, { scale: number; x: number; y: number; z: number; optics?: number }> = {
  pm: { scale: 1.15, x: 0.20, y: -0.20, z: -0.34 },
  ak74: { scale: 0.95, x: 0.17, y: -0.20, z: -0.40 },
  ak74m: { scale: 0.95, x: 0.17, y: -0.20, z: -0.40 },
  akm: { scale: 0.95, x: 0.17, y: -0.20, z: -0.40 },
  rpk: { scale: 0.85, x: 0.18, y: -0.21, z: -0.44 },
  pkm: { scale: 0.75, x: 0.19, y: -0.22, z: -0.48 },
  m4a1: { scale: 0.95, x: 0.17, y: -0.20, z: -0.40 },
  svd: { scale: 0.72, x: 0.17, y: -0.19, z: -0.46, optics: 0.5 },
  awm_l96: { scale: 0.72, x: 0.17, y: -0.19, z: -0.46 },
  pgm_ur: { scale: 0.72, x: 0.17, y: -0.19, z: -0.46 },
  rpg7: { scale: 0.62, x: 0.19, y: -0.24, z: -0.30 },
};

export interface WeaponState {
  id: string;
  /** патронов в магазине */
  mag: number;
  /** запас */
  reserve: number;
}

export interface ShotInfo { weapon: WeaponSpec; recoil: number; }

let tracerSeq = 1;

export class PlayerCombat {
  lib: AssetLibrary; phys: PhysicsClient; effects: Effects;
  camera: THREE.PerspectiveCamera;
  /** смена вьюмодели (её ведёт main.ts) */
  onViewModel: ((obj: THREE.Object3D | null, w: WeaponSpec) => void) | null = null;
  /** отдача в камеру: main.ts применяет к pitch/yaw */
  onRecoil: ((dPitch: number, dYaw: number) => void) | null = null;
  onShot: ((s: ShotInfo) => void) | null = null;

  inventory: WeaponState[] = [];
  current = 0;
  private nextShotAt = 0;
  private reloading = 0;
  private triggerHeld = false;
  private spreadAccum = 0;
  private viewmodel: THREE.Object3D | null = null;
  private muzzleLocal = new THREE.Vector3(0, 0, -0.55);

  constructor(lib: AssetLibrary, phys: PhysicsClient, effects: Effects, camera: THREE.PerspectiveCamera) {
    this.lib = lib; this.phys = phys; this.effects = effects; this.camera = camera;
    // стартовый набор: автомат, снайперка, гранатомёт, пистолет
    for (const [id, res] of [['ak74', 180], ['svd', 40], ['rpg7', 6], ['pm', 48]] as const) {
      const w = WEAPONS.find(x => x.id === id);
      if (w) this.inventory.push({ id, mag: w.mag, reserve: res });
    }
  }

  get weapon(): WeaponSpec { return weaponById(this.inventory[this.current].id); }
  get state(): WeaponState { return this.inventory[this.current]; }
  get isReloading() { return this.reloading > 0; }

  /**
   * Вьюмодель. Раньше модели вставлялись «как есть» в масштабе 1:1 — ПМ (0.16 м)
   * и СВД (1.2 м) выглядели одинаково огромными, а оптика 1П29 перекрывала пол-экрана.
   * Теперь всё приводится к одному экранному размеру и общей посадке «в руках».
   */
  equip(i: number) {
    if (i < 0 || i >= this.inventory.length) return;
    this.current = i; this.reloading = 0;
    const w = this.weapon;
    this.viewmodel?.removeFromParent();
    this.viewmodel = null;
    if (this.lib.has(w.model)) {
      const inst = this.lib.make(w.model);
      this.viewmodel = inst.object;
      const size = inst.item.size ?? [0.1, 0.2, 1];
      const len = Math.max(size[0], size[2]);
      // экранный размер: длинное оружие виднеется дальше, пистолет ближе к камере
      const vm = VM[w.id] ?? { scale: 1, x: 0.16, y: -0.19, z: -0.42 };
      this.viewmodel.scale.setScalar(vm.scale);
      this.vmHome = { x: vm.x, y: vm.y, z: vm.z };
      this.muzzleLocal.set(0, 0.02, -len * 0.5 * vm.scale - 0.06);
      // прицел: ставим на планку и УМЕНЬШАЕМ — иначе он размером с голову
      if (w.optic && this.lib.has(w.optic)) {
        const oi = this.lib.make(w.optic);
        const os = oi.item.size ?? [0.08, 0.17, 0.2];
        const o = oi.object;
        o.scale.setScalar(vm.optics ?? 0.55);
        o.position.set(0, size[1] * 0.55 + (os[1] * (vm.optics ?? 0.55)) / 2, -0.02);
        this.viewmodel.add(o);
      }
    }
    this.onViewModel?.(this.viewmodel, w);
  }
  /** посадка вьюмодели в экране: подбирается по оружию (x — вправо, y — вниз, z — от камеры) */
  vmHome = { x: 0.16, y: -0.19, z: -0.42 };

  /** ЛКМ нажата/отпущена */
  trigger(down: boolean) {
    this.triggerHeld = down;
    if (down) this.tryFire();
  }

  reload() {
    const s = this.state, w = this.weapon;
    if (this.reloading > 0 || s.mag >= w.mag || s.reserve <= 0) return;
    this.reloading = w.reload;
  }

  private tryFire() {
    const now = performance.now() / 1000;
    const s = this.state, w = this.weapon;
    if (this.reloading > 0 || now < this.nextShotAt) return;
    if (s.mag <= 0) { this.reload(); return; }
    s.mag--;
    this.nextShotAt = now + 60 / w.rpm;
    if (!w.auto) this.triggerHeld = false;

    // --- направление с разбросом ---
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    // разброс: MOA + накопленный от стрельбы очередью + от движения
    const moa = w.moa + this.spreadAccum;
    const spreadRad = (moa / 60) * (Math.PI / 180) * (0.6 + Math.random() * 0.8);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const a = Math.random() * Math.PI * 2, r = spreadRad * Math.sqrt(Math.random());
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    this.spreadAccum = Math.min(this.spreadAccum + (w.auto ? 5 : 14), 90);

    // --- дуло в мире ---
    const muzzle = this.muzzleLocal.clone();
    if (this.viewmodel) { this.viewmodel.updateWorldMatrix(true, false); muzzle.applyMatrix4(this.viewmodel.matrixWorld); }
    else muzzle.copy(this.camera.position).addScaledVector(dir, 0.6);
    this.effects.flash(muzzle);

    this.phys.shoot({
      id: tracerSeq++, pos: [muzzle.x, muzzle.y, muzzle.z],
      vel: [dir.x * w.velocity, dir.y * w.velocity, dir.z * w.velocity],
      penetration: w.penetration, owner: 0, bc: w.bc,
      explosive: w.explosive, life: w.explosive ? 6 : BALLISTICS.maxRange / w.velocity + 0.4,
    });

    // --- отдача ---
    const kick = w.recoil * (w.auto ? 0.75 + Math.random() * 0.5 : 1);
    this.onRecoil?.(kick, (Math.random() - 0.5) * kick * 0.5);
    this.onShot?.({ weapon: w, recoil: kick });
    if (w.kick) this.kickViewmodel(w.kick);
  }

  /** Накопленная отдача вьюмодели: гасится в update() — ствол не уезжает навсегда. */
  vmKickZ = 0;
  vmKickPitch = 0;
  private kickViewmodel(amount: number) {
    this.vmKickZ += amount * 0.6;
    this.vmKickPitch += amount * 2.4;
    this.vmKickZ = Math.min(this.vmKickZ, 0.10);
    this.vmKickPitch = Math.min(this.vmKickPitch, 0.5);
  }

  update(dt: number) {
    // автоогонь держим, пока нажата кнопка
    if (this.triggerHeld) {
      const w = this.weapon;
      if (w.auto) this.tryFire();
    }
    // разброс восстанавливается
    this.spreadAccum = Math.max(0, this.spreadAccum - dt * 42);
    // отдача вьюмодели плавно возвращается назад (раньше ствол уезжал и не возвращался)
    const back = Math.min(1, dt * 11);
    this.vmKickZ += (0 - this.vmKickZ) * back;
    this.vmKickPitch += (0 - this.vmKickPitch) * back;
    // перезарядка
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const s = this.state, w = this.weapon;
        const need = w.mag - s.mag, take = Math.min(need, s.reserve);
        s.mag += take; s.reserve -= take;
        this.reloading = 0;
      }
    }
  }

  /** Подсказка в HUD: «30 / 180 · АК-74 · АВТО». */
  hud() {
    const s = this.state, w = this.weapon;
    const mode = w.auto ? 'АВТО' : 'ОДИН';
    return this.reloading > 0 ? `ПЕРЕЗАРЯДКА ${this.reloading.toFixed(1)} с` : `${s.mag} / ${s.reserve} · ${w.name} · ${mode}`;
  }
}
