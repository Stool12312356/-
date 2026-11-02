// РЕЖИМ «ШТУРМ» (ТЗ п.7.1) — точки захвата, билеты, волны подкреплений.
//
// Почему отдельный модуль, а не код в main.ts: правил много (сколько точек, кто чей,
// как быстро идёт захват, когда наступает победа), и без теста они превращаются в
// «вроде работает». Здесь — чистая логика без three.js: её гоняет tools/test-modes.mjs
// настоящими тиками (1/30 с), поэтому баланс проверяется, а не ощущается.
//
// Правила (по ТЗ):
//  • N точек, каждая нейтральна при старте (ничья), у неё радиус захвата;
//  • одна сторона захватывает точку, если её бойцов внутри больше, и никто не мешает
//    (перевес считается по «силе»: 1 за бойца, 1.5 за бойца, который стоит на точке);
//  • у каждой стороны билеты. Смерть бойца = −1 билет. Владелец БОЛЬШИНСТВА точек
//    медленно снимает билеты с противника (это и есть «счёт», как в Battlefield);
//  • проигрыш: билеты кончились. Плюс лимит времени матча, тогда решает, у кого
//    билетов больше.
export type Side = 0 | 1 | -1;   // 0 — своя сторона (СССР), 1 — противник, -1 — ничья

export interface CapturePoint {
  id: string;
  name: string;
  pos: [number, number, number];
  radius: number;
  owner: Side;
  /** 0…1 прогресс захвата: в какую сторону идёт перевес */
  progress: number;
  /** кто сейчас захватывает — для цвета маркера в HUD */
  capturing: Side;
}

export interface SoldierRef {
  side: Side;
  alive: boolean;
  pos: [number, number, number];
  /** стоит на точке (не бежит) */
  holding: boolean;
}

export interface MatchConfig {
  /** сколько билетов у каждой стороны */
  tickets: number;
  /** время матча, с */
  timeLimit: number;
  /** сколько билетов в секунду снимает владелец большинства точек */
  bleed: number;
  /** скорость захвата: 0…1 за секунду при перевесе 1 */
  captureRate: number;
}

export const DEFAULT_MATCH: MatchConfig = { tickets: 300, timeLimit: 15 * 60, bleed: 1.4, captureRate: 0.1 };

export type MatchState = 'running' | 'win' | 'lose' | 'draw';

export class Match {
  cfg: MatchConfig;
  points: CapturePoint[];
  tickets: [number, number];
  time = 0;
  state: MatchState = 'running';
  /** чем закончилось — для HUD и фида */
  reason = '';

  constructor(points: CapturePoint[], cfg: Partial<MatchConfig> = {}) {
    this.cfg = { ...DEFAULT_MATCH, ...cfg };
    this.points = points;
    this.tickets = [this.cfg.tickets, this.cfg.tickets];
  }

  /**
   * Один тик. soldiers — все бойцы (игрок + боты обеих сторон).
   * Возвращает события тика: захваты, потери билетов, конец матча.
   */
  update(dt: number, soldiers: readonly SoldierRef[]): string[] {
    const ev: string[] = [];
    if (this.state !== 'running') return ev;
    this.time += dt;

    // --- точки: перевес живой силы внутри радиуса
    for (const p of this.points) {
      let s0 = 0, s1 = 0;
      for (const s of soldiers) {
        if (!s.alive || s.side < 0) continue;
        const dx = s.pos[0] - p.pos[0], dz = s.pos[2] - p.pos[2];
        if (dx * dx + dz * dz > p.radius * p.radius) continue;
        if (Math.abs(s.pos[1] - p.pos[1]) > 4) continue;    // на другом этаже — не считается
        const w = s.holding ? 1.5 : 1;
        if (s.side === 0) s0 += w; else s1 += w;
      }
      if (s0 === s1) { p.capturing = -1; continue; }        // ничья по силе — захват стоит
      const side: Side = s0 > s1 ? 0 : 1;
      const ratio = Math.min(4, Math.abs(s0 - s1));
      p.capturing = side;
      if (p.owner === side) {
        // владелец «отмывает» прогресс обратно к 1
        p.progress = Math.min(1, p.progress + this.cfg.captureRate * ratio * 0.5 * dt);
        continue;
      }
      if (p.owner === -1) {
        // НЕЙТРАЛЬНАЯ точка: прогресс копит тот, у кого перевес.
        // Раньше здесь вычитался прогресс, и точка «захватывалась» за один тик.
        p.progress += this.cfg.captureRate * ratio * dt;
        if (p.progress >= 1) {
          p.owner = side; p.progress = 1; p.capturing = -1;
          ev.push(`${p.name}: ${side === 0 ? 'захвачена нами' : 'захвачена противником'}`);
        }
        continue;
      }
      // ЧУЖАЯ точка: сначала снимаем прогресс владельца до 0, потом она нейтральна
      p.progress -= this.cfg.captureRate * ratio * dt;
      if (p.progress <= 0) {
        p.owner = -1; p.progress = 0;
        ev.push(`${p.name}: нейтрализована`);
      }
    }

    // --- «перевес по точкам»: владелец большинства снимает билеты
    const own = this.points.filter(p => p.owner === 0).length;
    const enemy = this.points.filter(p => p.owner === 1).length;
    if (own > enemy) {
      const k = 1 + (own - enemy) * 0.5;
      this.tickets[1] -= this.cfg.bleed * k * dt;
      if (own === this.points.length) this.tickets[1] -= this.cfg.bleed * dt;   // полный контроль
    } else if (enemy > own) {
      const k = 1 + (enemy - own) * 0.5;
      this.tickets[0] -= this.cfg.bleed * k * dt;
    }
    this.tickets[0] = Math.max(0, this.tickets[0]);
    this.tickets[1] = Math.max(0, this.tickets[1]);

    // --- конец матча
    if (this.tickets[0] <= 0 && this.tickets[1] <= 0) { this.state = 'draw'; this.reason = 'билеты кончились у обеих сторон'; }
    else if (this.tickets[0] <= 0) { this.state = 'lose'; this.reason = 'наши билеты кончились'; }
    else if (this.tickets[1] <= 0) { this.state = 'win'; this.reason = 'противник потерял все билеты'; }
    else if (this.time >= this.cfg.timeLimit) {
      this.state = this.tickets[0] > this.tickets[1] ? 'win' : this.tickets[0] < this.tickets[1] ? 'lose' : 'draw';
      this.reason = 'время вышло, решают билеты';
    }
    return ev;
  }

  /** Смерть бойца: −1 билет его стороне. */
  casualty(side: Side) {
    if (side !== 0 && side !== 1) return;
    if (this.state !== 'running') return;
    this.tickets[side] = Math.max(0, this.tickets[side] - 1);
  }

  /** Точка, в которой стоит боец (для «holds point» и HUD). */
  pointAt(pos: readonly number[]): CapturePoint | null {
    for (const p of this.points) {
      const dx = pos[0] - p.pos[0], dz = pos[2] - p.pos[2];
      if (dx * dx + dz * dz <= p.radius * p.radius && Math.abs(pos[1] - p.pos[1]) < 4) return p;
    }
    return null;
  }

  /** Ближайшая точка к стороне, которую надо атаковать (для ботов). */
  targetPoint(side: Side): CapturePoint | null {
    const bad = this.points.filter(p => p.owner !== side);
    if (!bad.length) return null;
    return bad[0];
  }

  hud(): string {
    const t = Math.max(0, Math.ceil(this.cfg.timeLimit - this.time));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
}
