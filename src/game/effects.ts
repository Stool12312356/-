// Визуал стрельбы: трассеры, искры от попаданий, пробоины, вспышка ствола, дым.
// Всё пулится: линии трассеров — один LineSegments, искры — Points, декали — InstancedMesh.
// Иначе на 30 выстрелов в секунду браузер захлебнётся созданием объектов.
import * as THREE from 'three';
import type { Tracer, Impact, Surface } from '../shared/types';
import { SURFACES } from './weapons';

const TRACER_MAX = 192;
const SPARK_MAX = 600;
const DECAL_MAX = 420;

const decalTex = (() => {
  // круглая пробоина с тёмным центром и светлой каймой — рисуется один раз на canvas
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(10,10,10,1)'); grd.addColorStop(0.35, 'rgba(30,28,26,.95)');
  grd.addColorStop(0.62, 'rgba(120,115,105,.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

export class Effects {
  private scene: THREE.Scene;
  private tracerGeo: THREE.BufferGeometry;
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;
  private tracerLines: THREE.LineSegments;
  /** хвост трассера живёт 90 мс — как настоящая трассирующая пуля */
  private tracerAge = new Map<number, number>();

  private sparkGeo: THREE.BufferGeometry;
  /** пыль разрушения: облачка, которые живут пару секунд */
  private puffGeo = new THREE.IcosahedronGeometry(0.5, 1);
  private dustPuffs: { puff: THREE.Mesh; v: THREE.Vector3; life: number; t: number }[] = [];
  private sparkPos: Float32Array;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private sparkColor: Float32Array;
  private sparkPoints: THREE.Points;
  private sparkHead = 0;

  private decals: THREE.InstancedMesh;
  private decalHead = 0;
  private decalDummy = new THREE.Object3D();

  private muzzle: THREE.PointLight;
  private muzzleT = 0;

  // --- ОГОНЬ после взрыва ---
  // Пул из нескольких «костров»: пламя (плоские билборды-пятна), короткий свет и дым.
  // Без пула каждый взрыв создавал бы материалы и лампы — на серии выстрелов это
  // просадка кадров и утечка памяти. Огонь живёт 6–9 с и гаснет сам.
  private fires: { pos: THREE.Vector3; t: number; life: number; flame: THREE.Mesh; light: THREE.PointLight; dust: number }[] = [];
  private static readonly FIRE_MAX = 6;
  private fireGeo = new THREE.IcosahedronGeometry(0.55, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // --- трассеры ---
    this.tracerPos = new Float32Array(TRACER_MAX * 6);
    this.tracerCol = new Float32Array(TRACER_MAX * 6);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    this.tracerLines = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.tracerLines.frustumCulled = false; this.tracerLines.renderOrder = 5;
    scene.add(this.tracerLines);

    // --- искры ---
    this.sparkPos = new Float32Array(SPARK_MAX * 3);
    this.sparkVel = new Float32Array(SPARK_MAX * 3);
    this.sparkLife = new Float32Array(SPARK_MAX);
    this.sparkColor = new Float32Array(SPARK_MAX * 3);
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkColor, 3));
    for (let i = 0; i < SPARK_MAX; i++) this.sparkPos[i * 3 + 1] = -999;
    this.sparkPoints = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparkPoints.frustumCulled = false;
    scene.add(this.sparkPoints);

    // --- пробоины ---
    const plane = new THREE.PlaneGeometry(0.16, 0.16);
    const mat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.decals = new THREE.InstancedMesh(plane, mat, DECAL_MAX);
    this.decals.frustumCulled = false; this.decals.count = DECAL_MAX;
    this.decalDummy.scale.setScalar(0.0001); this.decalDummy.updateMatrix();
    for (let i = 0; i < DECAL_MAX; i++) this.decals.setMatrixAt(i, this.decalDummy.matrix);
    scene.add(this.decals);

    // --- вспышка ствола ---
    this.muzzle = new THREE.PointLight('#ffd9a0', 0, 12, 2);
    scene.add(this.muzzle);
  }

  /** Вызывать каждый кадр. Лёгкая вспышка у ствола. */
  /** живые трассеры ботов (обновляются в update) */
  private botTrails: { a: [number, number, number]; b: [number, number, number]; color: string; t: number }[] = [];
  private botTrailPool: THREE.Line[] = [];

  flash(pos: THREE.Vector3) {
    this.muzzle.position.copy(pos); this.muzzle.intensity = 26; this.muzzleT = 0.06;
  }

  /** Обновление трассеров из воркера. */
  updateTracers(tracers: Tracer[], camera: THREE.Camera) {
    const p = this.tracerPos, c = this.tracerCol;
    let n = 0;
    const now = performance.now();
    const seen = new Set<number>();
    for (const t of tracers) {
      if (n >= TRACER_MAX) break;
      seen.add(t.id);
      const age = now - (this.tracerAge.get(t.id) ?? now);
      if (!this.tracerAge.has(t.id)) this.tracerAge.set(t.id, now);
      // хвост: линия от предыдущей позиции к текущей
      const ax = t.prev[0], ay = t.prev[1], az = t.prev[2];
      const bx = t.pos[0], by = t.pos[1], bz = t.pos[2];
      p[n * 6 + 0] = ax; p[n * 6 + 1] = ay; p[n * 6 + 2] = az;
      p[n * 6 + 3] = bx; p[n * 6 + 4] = by; p[n * 6 + 5] = bz;
      const fade = Math.max(0.15, 1 - age / 900);
      // у дульного среза ярко-жёлтый, дальше красноватый
      c[n * 6 + 0] = 1.0 * fade; c[n * 6 + 1] = 0.82 * fade; c[n * 6 + 2] = 0.35 * fade;
      c[n * 6 + 3] = 1.0 * fade; c[n * 6 + 4] = 0.55 * fade; c[n * 6 + 5] = 0.18 * fade;
      n++;
    }
    for (const id of [...this.tracerAge.keys()]) if (!seen.has(id)) this.tracerAge.delete(id);
    for (let i = n; i < TRACER_MAX; i++) { p[i * 6 + 2] = -9999; p[i * 6 + 5] = -9999; }
    this.tracerGeo.setDrawRange(0, n * 2);
    (this.tracerGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    void camera;
  }

  /**
   * Короткий ЛУЧ БОТА (не пуля игрока): нарисовать сегмент на пару кадров.
   * Пуля игрока живёт в воркере физики (там баллистика), а выстрел бота — это
   * «попал/промахнулся» с вероятностью по сложности, поэтому рисуем прямой отрезок.
   */
  botTrail(a: [number, number, number], b: [number, number, number], color = '#ffe9a8') {
    const life = 0.07;
    this.botTrails.push({ a, b, color, t: life });
  }

  /** Отрисовка трассеров ботов: один Line на выстрел, не больше 24 одновременно. */
  private drawBotTrails() {
    // убираем линии, которых больше нет в списке
    while (this.botTrailPool.length > this.botTrails.length) {
      this.botTrailPool.pop()!.removeFromParent();
    }
    for (let i = 0; i < this.botTrails.length && i < 24; i++) {
      const t = this.botTrails[i];
      let ln = this.botTrailPool[i];
      if (!ln) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: t.color, transparent: true, opacity: 0.85, depthWrite: false }));
        this.botTrailPool[i] = ln;
        this.scene.add(ln);
      }
      const pos = ln.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, t.a[0], t.a[1], t.a[2]);
      pos.setXYZ(1, t.b[0], t.b[1], t.b[2]);
      pos.needsUpdate = true;
      ln.geometry.setDrawRange(0, 2);
      ln.visible = true;
    }
    for (let i = this.botTrails.length; i < this.botTrailPool.length; i++) this.botTrailPool[i].visible = false;
  }

  /** Попадание: искры + пробоина. Цвет зависит от материала. */
  impact(i: Impact) {
    if (i.kind === 'explosive') return;
    const s = SURFACES[i.surface];
    const col = new THREE.Color(s.color);
    const cnt = i.penetrated ? 4 : 9;
    for (let k = 0; k < cnt; k++) {
      const idx = this.sparkHead++ % SPARK_MAX;
      this.sparkPos[idx * 3] = i.pos[0]; this.sparkPos[idx * 3 + 1] = i.pos[1]; this.sparkPos[idx * 3 + 2] = i.pos[2];
      const sp = 1.5 + Math.random() * 4;
      this.sparkVel[idx * 3] = (i.normal[0] + (Math.random() - 0.5) * 1.4) * sp;
      this.sparkVel[idx * 3 + 1] = (i.normal[1] + (Math.random() - 0.5) * 1.4) * sp + 1.2;
      this.sparkVel[idx * 3 + 2] = (i.normal[2] + (Math.random() - 0.5) * 1.4) * sp;
      this.sparkLife[idx] = 0.18 + Math.random() * 0.22;
      // у металла искры белые, у бетона — пыль
      this.sparkColor[idx * 3] = i.surface === 'metal' || i.surface === 'armor' ? 1 : col.r * 1.2;
      this.sparkColor[idx * 3 + 1] = i.surface === 'metal' || i.surface === 'armor' ? 1 : col.g * 1.2;
      this.sparkColor[idx * 3 + 2] = i.surface === 'metal' || i.surface === 'armor' ? 0.95 : col.b * 1.2;
    }
    // Пробоина. Важно: раньше декаль приклеивалась к поверхности ВСЕГДА, и при стрельбе
    // в стену рядом с прицелом появлялись «мухи» на земле/в воздухе. Теперь:
    //  - только твёрдые поверхности, не земля/вода и не пробитая насквозь пуля;
    //  - смещение строго по нормали, чтобы не проваливаться внутрь стены;
    //  - размер зависит от калибра.
    if (i.surface !== 'dirt' && i.surface !== 'water' && !i.penetrated) {
      const d = this.decalDummy;
      d.position.set(i.pos[0] + i.normal[0] * 0.012, i.pos[1] + i.normal[1] * 0.012, i.pos[2] + i.normal[2] * 0.012);
      // плоскость пробоины смотрит по нормали
      const n = new THREE.Vector3(...i.normal);
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      d.rotateZ(Math.random() * Math.PI * 2);
      const sc = (0.6 + Math.random() * 0.7) * (i.surface === 'glass' ? 1.8 : 1);
      d.scale.setScalar(sc); d.updateMatrix();
      this.decals.setMatrixAt(this.decalHead++ % DECAL_MAX, d.matrix);
      this.decals.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Пыль от разрушения (в духе референса): мягкие полупрозрачные пятна, всплывают и
   * рассеиваются. Раньше при выбивании стены не было вообще никакой пыли — дом «таял».
   */
  dust(pos: [number, number, number], count = 6, spread = 1.4) {
    const n = Math.min(24, count);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#c9c3b4', transparent: true, opacity: 0.35 + Math.random() * 0.2, depthWrite: false,
      });
      const puff = new THREE.Mesh(this.puffGeo, mat);
      puff.position.set(
        pos[0] + (Math.random() - 0.5) * spread,
        pos[1] + (Math.random() - 0.2) * spread,
        pos[2] + (Math.random() - 0.5) * spread,
      );
      puff.scale.setScalar(0.3 + Math.random() * 0.4);
      this.scene.add(puff);
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6);
      this.dustPuffs.push({ puff, v, life: 1.4 + Math.random() * 1.2, t: 0 });
    }
  }

  /** Взрыв: облако + ударная волна (упрощённо). */
  explosion(pos: [number, number, number], radius: number) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, depthWrite: false }));
    ball.position.set(...pos); this.scene.add(ball);
    const light = new THREE.PointLight('#ffa040', 900, radius * 4, 2); light.position.set(pos[0], pos[1] + 1.5, pos[2]); this.scene.add(light);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 650;
      ball.scale.setScalar(1 + k * radius * 0.55);
      (ball.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      light.intensity = Math.max(0, 900 * (1 - k));
      if (k < 1) requestAnimationFrame(anim); else { this.scene.remove(ball); this.scene.remove(light); }
    };
    requestAnimationFrame(anim);
    // осколки-искры
    for (let k = 0; k < 40; k++) {
      const idx = this.sparkHead++ % SPARK_MAX;
      this.sparkPos[idx * 3] = pos[0]; this.sparkPos[idx * 3 + 1] = pos[1] + 0.4; this.sparkPos[idx * 3 + 2] = pos[2];
      const sp = 6 + Math.random() * 14;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      this.sparkVel[idx * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.sparkVel[idx * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 1.4;
      this.sparkVel[idx * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.sparkLife[idx] = 0.5 + Math.random() * 0.7;
      this.sparkColor[idx * 3] = 1; this.sparkColor[idx * 3 + 1] = 0.72; this.sparkColor[idx * 3 + 2] = 0.3;
    }
  }

  /** Подводный взрыв: пузырь и расходящееся кольцо на поверхности, без огня. */
  waterExplosion(pos: [number, number, number], radius: number, surfaceY: number) {
    const bubbleGeo = new THREE.SphereGeometry(1, 16, 12);
    const bubbleMat = new THREE.MeshBasicMaterial({ color: '#a4e0ef', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
    bubble.position.set(...pos); this.scene.add(bubble);
    const ringGeo = new THREE.RingGeometry(0.88, 1, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#d6f3ff', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos[0], surfaceY + 0.12, pos[2]);
    ring.renderOrder = 3; this.scene.add(ring);
    const t0 = performance.now();
    const anim = () => {
      const k = Math.min(1, (performance.now() - t0) / 850);
      bubble.scale.setScalar(0.4 + k * radius * 0.35);
      bubbleMat.opacity = 0.5 * (1 - k);
      ring.scale.setScalar(0.5 + k * radius);
      ringMat.opacity = 0.8 * (1 - k);
      if (k < 1) requestAnimationFrame(anim);
      else { bubble.removeFromParent(); ring.removeFromParent(); bubbleGeo.dispose(); bubbleMat.dispose(); ringGeo.dispose(); ringMat.dispose(); }
    };
    requestAnimationFrame(anim);
  }

  /**
   * Огонь на месте взрыва (п.2: «огонь после взрыва»).
   * Пламя — два вложенных икосаэдра (оранжевый и жёлтый), они пульсируют и растут,
   * рядом короткий источник света, который подсвечивает стены. Всё из пула.
   */
  fire(pos: [number, number, number], scale = 1) {
    // если рядом уже горит — только усилить, а не плодить костры
    for (const f of this.fires) {
      if (f.pos.distanceTo(new THREE.Vector3(pos[0], pos[1], pos[2])) < 1.6) { f.t = Math.max(0, f.t - 1.2); return; }
    }
    if (this.fires.length >= Effects.FIRE_MAX) {
      const old = this.fires.shift();
      if (old) { old.flame.removeFromParent(); (old.flame.material as THREE.Material).dispose(); old.light.removeFromParent(); }
    }
    const mat = new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const flame = new THREE.Mesh(this.fireGeo, mat);
    flame.position.set(pos[0], pos[1] + 0.35 * scale, pos[2]);
    flame.scale.setScalar(0.55 * scale);
    flame.renderOrder = 4;
    this.scene.add(flame);
    const light = new THREE.PointLight('#ff7a20', 26 * scale, 11 * scale, 2);
    light.position.set(pos[0], pos[1] + 1.1 * scale, pos[2]);
    this.scene.add(light);
    this.fires.push({ pos: new THREE.Vector3(pos[0], pos[1], pos[2]), t: 0, life: 6 + Math.random() * 3, flame, light, dust: 0 });
  }

  /** Сколько костров горит (для HUD/тестов). */
  get fireCount() { return this.fires.length; }

  update(dt: number) {
    // трассеры ботов: короткие отрезки, живут 0.07 с
    for (let i = this.botTrails.length - 1; i >= 0; i--) {
      const t = this.botTrails[i];
      t.t -= dt;
      if (t.t > 0) continue;
      this.botTrails.splice(i, 1);
      // вернуть линию в пул, а не создавать новую (иначе 30 ботов = 30 геометрий в секунду)
      const ln = this.botTrailPool.pop();
      if (ln) ln.removeFromParent();
    }
    this.drawBotTrails();
    // огонь: пульсирует, гаснет, оставляет дым
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.flame.removeFromParent();
        (f.flame.material as THREE.Material).dispose();
        f.light.removeFromParent();
        this.fires.splice(i, 1);
        continue;
      }
      const flicker = 0.82 + Math.sin(f.t * 17 + i) * 0.12 + Math.random() * 0.08;
      f.flame.scale.setScalar((0.5 + Math.sin(f.t * 3) * 0.08) * flicker * (1 - k * 0.55));
      f.flame.position.y = f.pos.y + 0.35 + Math.sin(f.t * 5.5) * 0.07;
      (f.flame.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k) * flicker;
      f.light.intensity = 26 * (1 - k) * flicker;
      // дым: раз в 0.35 с поднимается облачко
      f.dust += dt;
      if (f.dust > 0.35) { f.dust = 0; this.dust([f.pos.x, f.pos.y + 1.0, f.pos.z], 1, 0.6); }
    }
    // пыль: всплывает, раздувается и гаснет
    for (let i = this.dustPuffs.length - 1; i >= 0; i--) {
      const d = this.dustPuffs[i];
      d.t += dt;
      const k = d.t / d.life;
      if (k >= 1) {
        d.puff.removeFromParent();
        (d.puff.material as THREE.Material).dispose();
        this.dustPuffs.splice(i, 1);
        continue;
      }
      d.puff.position.addScaledVector(d.v, dt);
      d.v.multiplyScalar(1 - Math.min(1, dt * 1.6));
      d.puff.scale.setScalar(0.3 + k * 2.2);
      (d.puff.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
    }
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzle.intensity = 0; else this.muzzle.intensity *= 0.6; }
    // искры: гравитация + затухание
    let any = false;
    for (let i = 0; i < SPARK_MAX; i++) {
      if (this.sparkLife[i] <= 0) continue;
      any = true;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 14 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -999;
    }
    if (any) {
      (this.sparkGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.sparkGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
