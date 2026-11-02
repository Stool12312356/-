// БАЛАНС БОЯ (по просьбе: «боты не должны убивать за пару тычек»).
//
// Раньше бот стрелял очередью по 5–7 выстрелов и каждый попадал на 18 урона: игрок
// умирал за ~2.5 с просто потому, что рядом оказался один бот. Теперь правила такие:
//
//  1. У бота урон за выстрел маленький (10), а точность падает с дистанцией;
//  2. Пока игрок НЕ видел источника огня, бот бьёт «вразброс» (× 0.55) — первый контакт
//     не убивает, у тебя есть время понять, откуда стреляют;
//  3. Есть «период неуязвимости»: после попадания игрок 0.35 с не получает урон от ботов
//     (это же спасает от 8 ботов, стреляющих одновременно);
//  4. Урон по игроку ограничен долей максимального HP (не больше 22% за один выстрел);
//  5. За секунду в игрока может попасть не больше N выстрелов (rate limit).
//
// Всё это — чистые функции без three, поэтому проверяется test-balance.mjs:
// он СТРЕЛЯЕТ по модели игрока и печатает, за сколько секунд его убьют 1, 3 и 8 ботов.
import type { BotSkill } from './botai.ts';

export const BALANCE = {
  /** урон одного выстрела бота по игроку */
  damage: 10,
  /** потолок урона за один выстрел, доля HP */
  maxSharePerShot: 0.22,
  /** невидимый стрелок (первый контакт) — множитель урона */
  unseenMul: 0.55,
  /** «неуязвимость» после попадания, с */
  graceAfterHit: 0.35,
  /** сколько попаданий в секунду максимум засчитывается (даже если стреляют 8 ботов) */
  hitsPerSecond: 3,
  /** разброс по дистанции: множитель точности на 10 м и на 60 м */
  falloffNear: 1.0,
  falloffFar: 0.45,
  /** сколько времени нужно, чтобы «разглядеть» стрелка и перестать быть в штрафе */
  revealTime: 1.2,
} as const;

/** Шанс попадания бота по игроку с учётом сложности и дистанции. */
export function hitChance(skill: BotSkill, dist: number): number {
  const base = skill === 'veteran' ? 0.5 : skill === 'sergeant' ? 0.4 : 0.26;
  const k = Math.max(0, Math.min(1, (dist - 10) / 50));
  const falloff = BALANCE.falloffNear + (BALANCE.falloffFar - BALANCE.falloffNear) * k;
  return base * falloff;
}

/** Урон выстрела бота по игроку (с учётом «не видел стрелка» и потолка). */
export function damageToPlayer(skill: BotSkill, maxHp: number, seen: boolean): number {
  const base = BALANCE.damage * (skill === 'veteran' ? 1.15 : skill === 'sergeant' ? 1 : 0.85);
  const withMul = base * (seen ? 1 : BALANCE.unseenMul);
  return Math.min(maxHp * BALANCE.maxSharePerShot, withMul);
}

/**
 * Учёт попаданий: grace-период и лимит попаданий в секунду.
 * Один экземпляр на игрока, живёт в main.ts.
 */
export class HitGate {
  private lastHit = -99;
  private hitTimes: number[] = [];

  /** Можно ли засчитать попадание сейчас (t — секунды игрового времени). */
  allow(t: number): boolean {
    if (t - this.lastHit < BALANCE.graceAfterHit) return false;
    this.hitTimes = this.hitTimes.filter(x => t - x < 1);
    if (this.hitTimes.length >= BALANCE.hitsPerSecond) return false;
    this.hitTimes.push(t);
    this.lastHit = t;
    return true;
  }

  reset() { this.lastHit = -99; this.hitTimes.length = 0; }
}

/**
 * Сколько секунд бот убивает игрока при непрерывном контакте — для теста и для HUD.
 * Считаем «в среднем»: выстрелы идут очередями по 5 с паузами 0.7–1.6 с.
 */
export function timeToKill(skill: BotSkill, maxHp: number, dist: number, bots = 1): number {
  const chance = hitChance(skill, dist);
  const dmg = damageToPlayer(skill, maxHp, true);
  // средний темп: очередь 5 выстрелов по 0.1 с + пауза 1.15 с → 5 выстрелов за 1.65 с
  const shotsPerSec = 5 / 1.65;
  // потолок попаданий в секунду: 8 ботов не могут влить больше, чем пропускает HitGate
  const effective = Math.min(bots * chance * shotsPerSec, BALANCE.hitsPerSecond);
  const dps = effective * dmg;
  // первый контакт — штраф по урону, поэтому первые ~2 секунды идут медленнее
  const firstContact = BALANCE.unseenMul;
  const avgDps = dps * (firstContact + 1) / 2;
  return avgDps > 0 ? maxHp / avgDps : Infinity;
}

/** Правдоподобно ли, что ботов можно «перестрелять»: сводка для HUD и лога. */
export function balanceReport(maxHp = 100) {
  const skills: BotSkill[] = ['private', 'sergeant', 'veteran'];
  return skills.map(s => ({
    skill: s,
    ttk1: timeToKill(s, maxHp, 20, 1),
    ttk3: timeToKill(s, maxHp, 20, 3),
    ttk8: timeToKill(s, maxHp, 20, 8),
  }));
}
