import type { ToWorker, FromWorker, BodyDesc, PlayerInput, PlayerState, Tracer, Impact } from '../shared/types';
import * as THREE from 'three';

/** Мост main-thread <-> physics worker. Хранит два последних снапшота и интерполирует для рендера. */
export class PhysicsClient {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  ready: Promise<void>;
  private objects = new Map<number, THREE.Object3D>();
  private prev = new Map<number, Float32Array>(); private cur = new Map<number, Float32Array>();
  private tPrev = 0; private tCur = 0; private nextId = 1;
  player: PlayerState | null = null; private playerPrev: PlayerState | null = null;
  stats = { awake: 0, total: 0, stepMs: 0 };
  /** битовая маска необязательных сообщений: трассеры и попадания шлются, только если включены */
  traceEnabled = true;
  /** последние трассеры (обновляется воркером 60 раз/с) */
  tracers: Tracer[] = [];
  /** попадания, накопившиеся с прошлого кадра — забираются игрой и очищаются */
  private impactQueue: Impact[] = [];
  private impactCb: ((i: Impact) => void) | null = null;
  onImpact(cb: (i: Impact) => void) { this.impactCb = cb; }
  takeImpacts(): Impact[] { const q = this.impactQueue; this.impactQueue = []; return q; }
  private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion();

  constructor() {
    this.ready = new Promise(res => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'ready') res();
        else if (m.type === 'snapshot') this.onSnap(m);
        else if (m.type === 'tracers') this.tracers = m.tracers;
        else if (m.type === 'ray') { if (m.id === this.raySeq) { this.rayDist = m.dist; this.rayPoint = m.point ?? null; } }
        else if (m.type === 'impacts') { for (const i of m.impacts) { this.impactQueue.push(i); this.impactCb?.(i); } if (this.impactQueue.length > 512) this.impactQueue.splice(0, 256); }
      };
    });
  }
  /** последний ответ на probe(): дистанция до того, во что смотрит камера */
  private raySeq = 0; rayDist: number | null = null; rayPoint: [number, number, number] | null = null;
  /** Спросить у физики, куда упирается луч. Ответ придёт в следующем кадре (rayDist). */
  probe(origin: number[], dir: number[], max = 200) {
    this.raySeq++;
    this.post({ type: 'ray', id: this.raySeq, origin: origin as [number, number, number], dir: dir as [number, number, number], max });
  }
  newId() { return this.nextId++; }
  post(m: ToWorker, transfer: Transferable[] = []) { this.worker.postMessage(m, transfer); }
  /** многоколоночный статичный дом: одна физическая сущность, много панелей */
  /** @param panels индекс панели для каждой формы в desc.shapes */
  addBuilding(desc: Omit<BodyDesc, 'id'>, panels: number[]): number {
    const id = this.nextId++;
    this.post({ type: 'addBodies', bodies: [{ ...desc, id, panels } as BodyDesc] });
    return id;
  }
  /** Добавляет физическое тело и привязывает к нему Object3D (может быть null для невидимых). */
  add(desc: Omit<BodyDesc, 'id'>, obj?: THREE.Object3D): number {
    const id = this.nextId++;
    this.post({ type: 'addBodies', bodies: [{ ...desc, id }] });
    if (obj && desc.kind === 'dynamic') this.objects.set(id, obj);
    return id;
  }
  sendInput(i: PlayerInput) { this.post({ type: 'input', input: i }); }
  /** выстрел: снаряд становится физическим телом внутри воркера */
  shoot(t: Omit<Tracer, 'prev' | 'life'> & { life?: number }) {
    this.post({ type: 'shoot', tracer: { prev: [...t.pos], life: t.life ?? 3, ...t } as Tracer });
  }
  removePanel(bodyId: number, panel: number) { this.post({ type: 'removePanel', bodyId, panel }); }
  private onSnap(m: Extract<FromWorker, { type: 'snapshot' }>) {
    this.prev = this.cur; this.cur = new Map(); this.tPrev = this.tCur; this.tCur = performance.now();
    for (let i = 0; i < m.ids.length; i++) this.cur.set(m.ids[i], m.tf.subarray(i * 7, i * 7 + 7));
    this.playerPrev = this.player; this.player = m.player; this.stats = { awake: m.awake, total: m.total, stepMs: m.stepMs };
    // тела, уснувшие между снапшотами: фиксируем их финальную позу точно
    for (const [id, p] of this.prev) if (!this.cur.has(id)) { const o = this.objects.get(id); if (o) { o.position.set(p[0], p[1], p[2]); o.quaternion.set(p[3], p[4], p[5], p[6]); } }
  }
  /** Вызывать каждый кадр рендера: интерполяция между снапшотами. */
  interpolate(): { pos: THREE.Vector3; vel: THREE.Vector3 } | null {
    const dt = Math.max(8, Math.min(40, this.tCur - this.tPrev || 16.7));
    const a = Math.min(1, Math.max(0, (performance.now() - this.tCur) / dt));
    for (const [id, c] of this.cur) {
      const obj = this.objects.get(id); if (!obj) continue;
      const p = this.prev.get(id) ?? c;
      obj.position.set(p[0] + (c[0] - p[0]) * a, p[1] + (c[1] - p[1]) * a, p[2] + (c[2] - p[2]) * a);
      this.q.set(p[3], p[4], p[5], p[6]); this.q2.set(c[3], c[4], c[5], c[6]); obj.quaternion.copy(this.q.slerp(this.q2, a));
    }
    if (!this.player) return null;
    const pp = this.playerPrev ?? this.player;
    return {
      pos: new THREE.Vector3(pp.pos[0] + (this.player.pos[0] - pp.pos[0]) * a, pp.pos[1] + (this.player.pos[1] - pp.pos[1]) * a, pp.pos[2] + (this.player.pos[2] - pp.pos[2]) * a),
      vel: new THREE.Vector3(...this.player.vel),
    };
  }
}
