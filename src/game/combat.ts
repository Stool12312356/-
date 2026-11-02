// Бой: оружие в руках игрока. Никаких хитсканов — каждый выстрел отправляет снаряд в воркер,
// где он летит по-настоящему (см. worker.ts, stepProjectile).
// Здесь: инвентарь, переключение, темп стрельбы, магазины/перезарядка, разброс, отдача.
import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { PhysicsClient } from '../physics/client';
import type { Effects } from './effects';
import { WEAPONS, weaponById, type WeaponSpec, BALLISTICS } from './weapons';

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

  /** Взять оружие в руки: строим вьюмодель из его модели (реальная или заглушка). */
  equip(i: number) {
    if (i < 0 || i >= this.inventory.length) return;
    this.current = i; this.reloading = 0;
    const w = this.weapon;
    this.viewmodel?.removeFromParent();
    this.viewmodel = null;
    if (this.lib.has(w.model)) {
      const inst = this.lib.make(w.model);
      this.viewmodel = inst.object;
      // оружие в манифесте нормализовано: длина по Z ~1 м, центр в нуле
      const size = inst.item.size ?? [0.1, 0.2, 1];
      this.muzzleLocal.set(0, 0.02, -(size[2] ?? 1) * 0.5 - 0.05);
      // прицел, если задан и есть в манифесте — ставим сверху
      if (w.optic && this.lib.has(w.optic)) {
        const o = this.lib.make(w.optic).object;
        o.position.set(0, 0.075, 0.02); o.scale.setScalar(1.1);
        this.viewmodel.add(o);
      }
    }
    this.onViewModel?.(this.viewmodel, w);
  }

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

  private kickViewmodel(amount: number) {
    if (!this.viewmodel) return;
    this.viewmodel.position.z += amount;
    this.viewmodel.rotation.x -= amount * 2.2;
  }

  update(dt: number) {
    // автоогонь держим, пока нажата кнопка
    if (this.triggerHeld) {
      const w = this.weapon;
      if (w.auto) this.tryFire();
    }
    // разброс восстанавливается
    this.spreadAccum = Math.max(0, this.spreadAccum - dt * 42);
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
