// ЗВУК (п.3): выстрелы, попадания по разным материалам, взрывы, обрушение.
//
// Всё синтезируется через Web Audio API — никаких файлов: в проекте нет ни одного
// звукового ассета, а качать нельзя. Процедурные звуки здесь даже уместнее: выстрел
// АК и удар по бетону — это короткий шум + фильтр + огибающая, и их можно параметризовать.
//
// Ключевые решения:
//  • Один AudioContext, создаётся ТОЛЬКО после первого клика/нажатия (политика браузеров:
//    до жеста пользователя контекст «suspended» и звука не будет — молча не работает).
//  • Позиционирование: PannerNode с HRTF для выстрелов/взрывов в мире, попадания по
//    своему оружию — без панорамы (близко к игроку).
//  • Скорость звука: взрыв слышен позже по расстоянию (343 м/с) — ТЗ, раздел 12.
//  • Бюджет: не больше N одновременных источников; при переполнении новые глушатся.
import type * as THREE from 'three';

const SOUND_SPEED = 343;
/** сколько источников озвучиваем одновременно — больше не слышно, только треск */
const MAX_VOICES = 24;

type Surface = 'concrete' | 'panel' | 'brick' | 'wood' | 'metal' | 'glass' | 'plaster' | 'armor' | 'dirt' | 'water';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  /** ограничение по числу одновременных выстрелов (серия из 30 в секунду) */
  private lastShot = 0;
  enabled = true;
  /** насколько громко (настройки/меню могут менять) */
  volume = 0.7;

  /** Включает звук. Вызывать из обработчика клика/нажатия — иначе браузер заблокирует. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;                    // браузер без Web Audio — игра работает без звука
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // мягкий компрессор: серия выстрелов не должна «рвать» динамики
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    // буфер белого шума на 1 с — основа всех выстрелов и попаданий
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  get ready() { return !!this.ctx && !!this.noise && this.ctx.state === 'running'; }

  /** Источник шума с фильтром и огибающей — база для всех эффектов. */
  private burst(opts: {
    dur: number; freq: number; q?: number; type?: BiquadFilterType; gain?: number;
    attack?: number; at?: number; sweepTo?: number; pan?: number;
  }) {
    if (!this.ctx || !this.noise || !this.master) return null;
    if (this.voices >= MAX_VOICES) return null;
    const c = this.ctx;
    const t0 = c.currentTime + (opts.at ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 1 + Math.random() * 0.15;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1.2;
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), t0 + opts.dur);
    const g = c.createGain();
    const peak = opts.gain ?? 0.35;
    const atk = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    let node: AudioNode = g;
    if (opts.pan !== undefined && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p); node = p;
    }
    src.connect(f).connect(g);
    node.connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
    this.voices++;
    src.onended = () => { this.voices--; };
    return src;
  }

  /** Тон с огибающей — для металлического звона и «удара» в броню. */
  private tone(freq: number, dur: number, gain = 0.12, at = 0, type: OscillatorType = 'sine') {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t0 = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.6), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  /** Выстрел: щелчок пороха + низкий «бум» + хвост эха. */
  shot(kind: 'rifle' | 'pistol' | 'sniper' | 'mg' | 'rpg',
       at?: [number, number, number], listener?: [number, number, number]) {
    if (!this.ready) return;
    // дальние выстрелы ботов: тише и с панорамой (иначе 16 стволов вокруг = каша)
    const vol = at && listener ? this.attenuation(at, listener, 55) : 1;
    if (vol < 0.04) return;
    const pan = at && listener ? this.pan(at, listener) : undefined;
    const now = performance.now();
    if (now - this.lastShot < 28) return;        // защита от дребезга на автоогне
    this.lastShot = now;
    const p = {
      rifle: { f: 1400, d: 0.22, g: 0.4 },
      pistol: { f: 1100, d: 0.16, g: 0.3 },
      sniper: { f: 900, d: 0.38, g: 0.5 },
      mg: { f: 1200, d: 0.2, g: 0.42 },
      rpg: { f: 500, d: 0.5, g: 0.55 },
    }[kind];
    this.burst({ dur: p.d, freq: p.f, q: 0.7, gain: p.g * vol, sweepTo: p.f * 0.25, pan });
    this.tone(kind === 'rpg' ? 70 : 110, p.d * 0.8, 0.16 * vol);
    // эхо от домов: тихий повтор через 90 мс
    this.burst({ dur: p.d * 1.4, freq: p.f * 0.5, q: 0.6, gain: p.g * 0.22 * vol, at: 0.09, pan });
  }

  /** Попадание по материалу: у каждого свой характер (ТЗ: «по дереву и бетону по-разному»). */
  hit(surface: Surface, at?: [number, number, number], listener?: [number, number, number]) {
    if (!this.ready) return;
    const pan = at && listener ? this.pan(at, listener) : undefined;
    const vol = at && listener ? this.attenuation(at, listener, 40) : 1;
    if (vol < 0.03) return;
    switch (surface) {
      case 'wood':    // глухой стук полена
        this.burst({ dur: 0.09, freq: 420, q: 1.6, gain: 0.3 * vol, pan });
        break;
      case 'metal':   // звон
        this.burst({ dur: 0.06, freq: 2600, q: 3, gain: 0.22 * vol, pan });
        this.tone(2200, 0.18, 0.07 * vol);
        break;
      case 'glass':   // стекло: рассыпается
        this.burst({ dur: 0.28, freq: 5200, q: 1.1, gain: 0.28 * vol, pan, sweepTo: 2600 });
        break;
      case 'plaster':
      case 'brick':
      case 'panel':
      case 'concrete': // бетон: сухой хлопок + крошка
        this.burst({ dur: 0.1, freq: 900, q: 1.0, gain: 0.26 * vol, pan });
        this.burst({ dur: 0.16, freq: 3000, q: 0.7, gain: 0.08 * vol, pan, at: 0.02 });
        break;
      case 'armor':   // броня: рикошет
        this.tone(1500, 0.22, 0.05 * vol);
        this.burst({ dur: 0.12, freq: 1800, q: 4, gain: 0.16 * vol, pan, sweepTo: 700 });
        break;
      default:        // грунт
        this.burst({ dur: 0.12, freq: 300, q: 0.8, gain: 0.2 * vol, pan });
    }
  }

  /** Взрыв: низкий удар + грохот обломков, с задержкой по расстоянию (343 м/с). */
  explosion(at: [number, number, number], listener: [number, number, number]) {
    if (!this.ready) return;
    const dist = Math.hypot(at[0] - listener[0], at[1] - listener[1], at[2] - listener[2]);
    // задержка: далёкий взрыв слышно позже. Ограничиваем 1.2 с, иначе «отстаёт» от картинки
    const delay = Math.min(1.2, dist / SOUND_SPEED);
    const vol = this.attenuation(at, listener, 90);
    if (vol < 0.02) return;
    const pan = this.pan(at, listener);
    this.burst({ dur: 0.9, freq: 260, q: 0.6, gain: 0.75 * vol, at: delay, sweepTo: 60, pan });
    this.tone(48, 0.7, 0.28 * vol, delay);
    // обломки: серия мелких ударов после взрыва
    for (let i = 0; i < 5; i++) {
      this.burst({ dur: 0.12, freq: 700 + Math.random() * 1400, q: 1.4, gain: 0.12 * vol, at: delay + 0.15 + Math.random() * 0.5, pan });
    }
  }

  /** Обрушение здания: длинный грохот, который нарастает и стихает. */
  collapse(at: [number, number, number], listener: [number, number, number]) {
    if (!this.ready) return;
    const delay = Math.min(2.0, Math.hypot(at[0] - listener[0], at[1] - listener[1], at[2] - listener[2]) / SOUND_SPEED);
    const vol = this.attenuation(at, listener, 160);
    if (vol < 0.02) return;
    for (let i = 0; i < 8; i++) {
      this.burst({
        dur: 0.5 + Math.random() * 0.7, freq: 120 + Math.random() * 260, q: 0.5,
        gain: (0.16 + Math.random() * 0.1) * vol, at: delay + i * 0.22 + Math.random() * 0.1,
        pan: this.pan(at, listener),
      });
    }
  }

  /** Шаги: тихий короткий шорох (снег/бетон). */
  step(surface: 'snow' | 'concrete') {
    if (!this.ready) return;
    this.burst({
      dur: surface === 'snow' ? 0.11 : 0.07,
      freq: surface === 'snow' ? 1700 : 900, q: 0.8,
      gain: surface === 'snow' ? 0.06 : 0.05,
    });
  }

  /** Перезарядка: металлический лязг магазина. */
  reload() {
    if (!this.ready) return;
    this.burst({ dur: 0.08, freq: 2400, q: 3, gain: 0.14 });
    this.tone(880, 0.07, 0.05, 0.06, 'square');
    this.burst({ dur: 0.1, freq: 1500, q: 2, gain: 0.12, at: 0.16 });
  }

  /** Панорама −1…1 по направлению на источник относительно взгляда игрока. */
  private pan(at: readonly number[], listener: readonly number[], yaw = this.listenerYaw): number {
    const dx = at[0] - listener[0], dz = at[2] - listener[2];
    const d = Math.hypot(dx, dz) || 1;
    // «право» при взгляде yaw (0 = −Z): (−cos yaw, 0, sin yaw)... берём через синус угла
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    return Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / d));
  }

  /** Направление взгляда игрока в радианах (main.ts обновляет каждый кадр). */
  listenerYaw = 0;

  private attenuation(at: readonly number[], listener: readonly number[], ref: number): number {
    const d = Math.hypot(at[0] - listener[0], at[1] - listener[1], at[2] - listener[2]);
    // обратный квадрат со «сглаживанием» у нуля: вблизи не глушит, вдали убывает
    return 1 / (1 + (d * d) / (ref * ref));
  }

  dispose() { void this.ctx?.close(); this.ctx = null; }
}

/** Позиция слушателя из камеры (для удобства вызовов из main.ts). */
export function listenerPos(cam: THREE.Camera): [number, number, number] {
  return [cam.position.x, cam.position.y, cam.position.z];
}
