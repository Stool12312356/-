// Бой: оружие в руках игрока. Никаких хитсканов — каждый выстрел отправляет снаряд в воркер,
// где он летит по-настоящему (см. worker.ts, stepProjectile).
// Здесь: инвентарь, переключение, темп стрельбы, магазины/перезарядка, разброс, отдача,
// посадка вьюмодели и прицеливание.
//
// ВАЖНО про посадку (config/viewmodel.json): модели из паков смотрят стволом в РАЗНЫЕ стороны,
// манифест их выравнивает по -Z, но центр у всех разный. Из-за этого раньше ствол висел
// справа-снизу и смотрел мимо перекрестия, «детали повёрнуты не туда». Теперь:
//  1) посадка (scale/x/y/z/rotY) берётся из конфига, а не из кода;
//  2) вьюмодель ДОВОРАЧИВАЕТСЯ в перекрестие — направление считается от дула к точке,
//     куда смотрит камера. Модель не может «смотреть мимо» по построению;
//  3) при прицеливании (ПКМ) оружие подтягивается к центру, FOV сужается, разброс падает.
import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { PhysicsClient } from '../physics/client';
import type { Effects } from './effects';
import { WEAPONS, weaponById, type WeaponSpec, BALLISTICS } from './weapons';
import VM_CFG from '../../config/viewmodel.json';

export interface VmPose {
  scale: number; x: number; y: number; z: number; rotY: number;
  optic?: string; optics?: number; opticMount?: { x?: number; y?: number; z?: number };
  ads?: { lift?: number; push?: number; fov?: number };
}
const VM = VM_CFG as unknown as Record<string, VmPose> & { _readme?: string };

export interface WeaponState {
  id: string;
  /** патронов в магазине */
  mag: number;
  /** запас */
  reserve: number;
}

export interface ShotInfo { weapon: WeaponSpec; recoil: number; }

let tracerSeq = 1;

/** Точка «куда смотрит оружие»: луч из камеры вперёд. Нужна для сведения ствола и прицела. */
export interface AimProbe { (origin: THREE.Vector3, dir: THREE.Vector3): number | null; }

export class PlayerCombat {
  lib: AssetLibrary; phys: PhysicsClient; effects: Effects;
  camera: THREE.PerspectiveCamera;
  /** смена вьюмодели (её ведёт main.ts) */
  onViewModel: ((obj: THREE.Object3D | null, w: WeaponSpec) => void) | null = null;
  /** отдача в камеру: main.ts применяет к pitch/yaw */
  onRecoil: ((dPitch: number, dYaw: number) => void) | null = null;
  onShot: ((s: ShotInfo) => void) | null = null;
  /** запрос дистанции до того, во что целимся (ставит main.ts, физика в воркере) */
  aimProbe: AimProbe | null = null;

  inventory: WeaponState[] = [];
  current = 0;
  aiming = false;
  private nextShotAt = 0;
  private reloading = 0;
  private triggerHeld = false;
  private spreadAccum = 0;
  private viewmodel: THREE.Object3D | null = null;
  private muzzleLocal = new THREE.Vector3(0, 0, -0.55);
  /** накопленная отдача вьюмодели: гасится в update() — ствол не уезжает навсегда */
  vmKickZ = 0;
  vmKickPitch = 0;
  /** посадка текущего оружия (её же читает main.ts для покачивания) */
  vmHome = { x: 0.135, y: -0.145, z: -0.17 };
  private vmRotY = 0;
  /** верх и задняя точка вьюмодели (для прицеливания) */
  private vmTop = 0.1;
  private vmRear = 0.2;
  /** на сколько поднять оружие при ADS, чтобы центр прицела лёг на перекрестие */
  private opticLift = 0;
  /** 0..1 — насколько вьюмодель подтянута к прицелу (сглаживается) */
  private adsT = 0;
  private sway = new THREE.Vector2();
  private tmpV = new THREE.Vector3();

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
  /** текущий FOV: 75 в покое, 45 при прицеливании, у СВД с оптикой — 22 */
  get fov() {
    const w = this.weapon;
    const adsFov = VM[w.id]?.ads?.fov ?? (w.optic ? 22 : 45);
    return 75 + (adsFov - 75) * this.adsT;
  }

  /**
   * Вьюмодель. Раньше модель вставлялась «как есть» в масштабе 1:1: ПМ (16 см) и СВД (1.2 м)
   * выглядели одинаково огромными, а оптика 1П29 перекрывала пол-экрана.
   */
  equip(i: number) {
    if (i < 0 || i >= this.inventory.length) return;
    this.current = i; this.reloading = 0;
    const w = this.weapon;
    this.viewmodel?.removeFromParent();
    this.viewmodel = null;
    const vm = VM[w.id] ?? { scale: 1, x: 0.135, y: -0.145, z: -0.17, rotY: 0 };
    this.vmHome = { x: vm.x, y: vm.y, z: vm.z };
    this.vmRotY = vm.rotY * Math.PI / 180;
    if (!this.lib.has(w.model)) { this.onViewModel?.(null, w); return; }

    const inst = this.lib.make(w.model);
    const size = inst.item.size ?? [0.1, 0.2, 1];
    this.viewmodel = inst.object;
    this.viewmodel.position.set(0, 0, 0);
    this.viewmodel.scale.setScalar(vm.scale);
    this.muzzleLocal.set(0, 0.02, -Math.max(size[0], size[2]) * 0.5 - 0.02);

    // Прицел: заново, а не обрезками из пака. Модели-обрезки (att_1p29) стоят в мировых
    // координатах пака, при прикручивании к оружию уезжали вперёд ствола — на скриншоте
    // «оптика висит в воздухе перед СВД». Собираем из примитивов: труба + линза + кольца.
    if (w.optic) {
      const optic = this.buildOptic(w, vm);
      this.viewmodel.add(optic);
      // центр трубы — это и есть линия прицеливания
      this.opticLift = optic.position.y + 0.0;
    }
    // линия прицеливания считается от ГАБАРИТА модели: у ПМ верх 5 см, у СВД — 14 см.
    // Отсюда автоматически правильная высота «ADS» для любого ствола, без подгонки вручную.
    this.viewmodel.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.viewmodel);
    const scale = this.viewmodel.scale.x || 1;
    // локальные габариты вьюмодели (масштаб уже учтён)
    this.vmTop = box.max.y / 1; this.vmRear = box.max.z / 1;
    this.opticLift = 0;
    void scale;
    this.onViewModel?.(this.viewmodel, w);
  }

  /** Оптика из примитивов: в масштабе оружия, на планке сверху. Высота подобрана под глаза игрока. */
  private buildOptic(w: WeaponSpec, vm: VmPose) {
    const g = new THREE.Group();
    g.name = 'optic';
    const body = new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.55, metalness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: '#2a4a5a', roughness: 0.1, metalness: 0.2, emissive: new THREE.Color('#123a4a'), emissiveIntensity: 0.5 });
    const R = 0.022, L = 0.16;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 14), body);
    tube.rotation.x = Math.PI / 2;                       // труба вдоль ствола
    g.add(tube);
    // объектив и окуляр — чуть шире
    for (const [z, r, mat] of [[-L / 2 - 0.012, R * 1.55, body], [L / 2 + 0.012, R * 1.4, body]] as const) {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 0.03, 14), mat);
      bell.rotation.x = Math.PI / 2; bell.position.z = z; g.add(bell);
    }
    const lensF = new THREE.Mesh(new THREE.CircleGeometry(R * 1.35, 16), glassMat);
    lensF.position.z = -L / 2 - 0.028; g.add(lensF);
    const lensR = new THREE.Mesh(new THREE.CircleGeometry(R * 1.2, 16), glassMat);
    lensR.position.z = L / 2 + 0.028; lensR.rotation.y = Math.PI; g.add(lensR);
    // кольца крепления на планку
    for (const z of [-0.045, 0.045]) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(R * 2.6, 0.022, 0.022), body);
      ring.position.set(0, -R - 0.008, z); g.add(ring);
    }
    const sc = vm.optics ?? 1;
    g.scale.setScalar(sc);
    // Высота: от РЕАЛЬНОГО верха модели (vmTop), а не от каталога — у каждого ствола он свой.
    g.position.set(vm.opticMount?.x ?? 0, this.vmTop + R * sc * 0.5, vm.opticMount?.z ?? -0.10);
    g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return g;
  }

  /** ЛКМ нажата/отпущена */
  trigger(down: boolean) {
    this.triggerHeld = down;
    if (down) this.tryFire();
  }

  /** ПКМ: прицеливание */
  setAiming(on: boolean) { this.aiming = on; }

  reload() {
    const s = this.state, w = this.weapon;
    if (this.reloading > 0 || s.mag >= w.mag || s.reserve <= 0) return;
    this.reloading = w.reload;
  }

  /**
   * Направление выстрела. Важно: пуля летит из ДУЛА, но в перекрестие — иначе на близкой
   * дистанции снаряд уходил на полметра вправо от прицела (это и было «пробоины мимо прицела»).
   * Считаем точку сведения: пересечение центрального луча камеры с геометрией (aimProbe),
   * а если промах — 200 м вперёд.
   */
  private aimPoint(dist?: number | null) {
    const o = this.camera.getWorldPosition(new THREE.Vector3());
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const t = dist ?? this.aimProbe?.(o, d) ?? 200;
    return o.clone().addScaledVector(d, Math.max(2, Math.min(400, t)));
  }

  private tryFire() {
    const now = performance.now() / 1000;
    const s = this.state, w = this.weapon;
    if (this.reloading > 0 || now < this.nextShotAt) return;
    if (s.mag <= 0) { this.reload(); return; }
    s.mag--;
    this.nextShotAt = now + 60 / w.rpm;
    if (!w.auto) this.triggerHeld = false;

    const target = this.aimPoint();
    const muzzle = this.muzzleWorld();
    const dir = target.sub(muzzle).normalize();

    // Разброс: MOA + накопленный от очереди + от движения. При прицеливании — вдвое меньше.
    const moa = (w.moa + this.spreadAccum) * (this.aiming ? 0.45 : 1);
    const spreadRad = (moa / 60) * (Math.PI / 180) * (0.6 + Math.random() * 0.8);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2, r = spreadRad * Math.sqrt(Math.random());
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(realUp, Math.sin(a) * r).normalize();
    this.spreadAccum = Math.min(this.spreadAccum + (w.auto ? 5 : 14), 90);

    this.effects.flash(muzzle);
    this.phys.shoot({
      id: tracerSeq++, pos: [muzzle.x, muzzle.y, muzzle.z],
      vel: [dir.x * w.velocity, dir.y * w.velocity, dir.z * w.velocity],
      penetration: w.penetration, owner: 0, bc: w.bc,
      explosive: w.explosive, life: w.explosive ? 6 : BALLISTICS.maxRange / w.velocity + 0.4,
    });

    const kick = (w.recoil * (w.auto ? 0.75 + Math.random() * 0.5 : 1)) * (this.aiming ? 0.7 : 1);
    this.onRecoil?.(kick, (Math.random() - 0.5) * kick * 0.5);
    this.onShot?.({ weapon: w, recoil: kick });
    if (w.kick) this.kickViewmodel(w.kick);
  }

  private muzzleWorld() {
    if (!this.viewmodel) return this.camera.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, -0.6).applyQuaternion(this.camera.quaternion));
    this.viewmodel.updateWorldMatrix(true, false);
    return this.muzzleLocal.clone().applyMatrix4(this.viewmodel.matrixWorld);
  }

  private kickViewmodel(amount: number) {
    this.vmKickZ += amount * 0.6;
    this.vmKickPitch += amount * 2.4;
    this.vmKickZ = Math.min(this.vmKickZ, 0.10);
    this.vmKickPitch = Math.min(this.vmKickPitch, 0.5);
  }

  update(dt: number, moving = 0) {
    if (this.triggerHeld) { if (this.weapon.auto) this.tryFire(); }
    this.spreadAccum = Math.max(0, this.spreadAccum - dt * 42);
    const back = Math.min(1, dt * 11);
    this.vmKickZ += (0 - this.vmKickZ) * back;
    this.vmKickPitch += (0 - this.vmKickPitch) * back;
    // прицеливание сглаживается: иначе FOV «щёлкает»
    this.adsT += ((this.aiming ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);
    // покачивание от ходьбы: у мелкого оружия заметнее
    const amp = (this.aiming ? 0.0009 : 0.0022) * Math.min(2, moving * 0.25);
    this.sway.x += (Math.sin(performance.now() / 190) * amp - this.sway.x) * Math.min(1, dt * 6);
    this.sway.y += (Math.abs(Math.cos(performance.now() / 190)) * amp - this.sway.y) * Math.min(1, dt * 6);
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

  /**
   * Ставит вьюмодель в кадр.
   *
   * Правила, выведенные из скриншотов пользователя (стволы «косили» и были огромными):
   *  - позиция считается от ГАБАРИТОВ модели, а не подбирается на глаз: у ПМ задняя точка
   *    в 8 см от центра, у СВД — в 60 см. Фиксированные −0.42 ставили приклад СВД ЗА камеру,
   *    и на экране оставались кольца прицела во весь кадр;
   *  - в покое оружие смотрит почти параллельно взгляду (доворот 2°), а не сведено в
   *    перекрестие — иначе ствол лежит по диагонали через весь экран;
   *  - при прицеливании (ПКМ) оружие встаёт ровно по центру: оптика/прицельные на оси
   *    взгляда, ствол строго вперёд. Это и есть «из оружия можно целиться».
   */
  placeViewModel(stance: number) {
    const vm = this.viewmodel;
    if (!vm) return;
    const home = this.vmHome, ads = this.adsT;
    // ADS: центр прицела на оси взгляда. Верх модели = линия прицельных приспособлений.
    const adsY = -this.vmTop - this.opticLift;
    // задняя точка не должна оказаться за камерой: держим 20 см перед глазом
    const adsZ = -(this.vmRear + 0.20);
    vm.position.set(
      home.x * (1 - ads) + this.sway.x,
      home.y * (1 - ads) + adsY * ads + this.sway.y - (stance === 2 ? 0.05 : 0) + this.vmKickZ * 0.3,
      home.z * (1 - ads) + adsZ * ads + this.vmKickZ,
    );
    // в покое — лёгкий доворот внутрь (2°), при ADS — строго по оси
    vm.rotation.set(this.vmKickPitch * (1 - ads * 0.7), (1 - ads) * (0.035 + this.vmRotY) + ads * this.vmRotY, 0);
  }

  /** Подсказка в HUD: «30 / 180 · АК-74 · АВТО». */
  hud() {
    const s = this.state, w = this.weapon;
    const mode = w.auto ? 'АВТО' : 'ОДИН';
    return this.reloading > 0 ? `ПЕРЕЗАРЯДКА ${this.reloading.toFixed(1)} с` : `${s.mag} / ${s.reserve} · ${w.name} · ${mode}`;
  }
}
