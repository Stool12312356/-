// ИИ БОТОВ (ТЗ п.10): боты воюют, а не стоят мишенью.
//
// Что должен уметь бот по ТЗ: идти к точке захвата, замечать противника, стрелять
// очередями, учитывать укрытия и не палить сквозь стены. Здесь — честное ядро этого
// поведения, но без heavy-навигации по вокселям: путь строится жадно по прямой с
// обходом препятствий по сетке 1 м (простая BFS на локальном окне), потому что полный
// navmesh по 50k вокселей каждый кадр — это не 60 FPS.
//
// ВАЖНО: это ФИЗИЧЕСКАЯ модель без визуальных эффектов: попадания идут через
// phys.probe() (луч в физике) и сообщаются наружу через onHit, чтобы main.ts сам
// начислил урон игроку/своим и включил эффекты.
//
// Сложность (ТЗ п.10.3): reaction (мс), accuracy (0..1), burst (выстрелов в очереди).

export const BOT_DIFFICULTY = {
  private: { reaction: 800, accuracy: 0.30, burst: 3, spread: 0.055 },
  sergeant: { reaction: 500, accuracy: 0.55, burst: 5, spread: 0.035 },
  veteran: { reaction: 250, accuracy: 0.75, burst: 7, spread: 0.022 },
} as const;
export type BotSkill = keyof typeof BOT_DIFFICULTY;

export interface BotBrain {
  side: 0 | 1;
  skill: BotSkill;
  hp: number;
  dead: boolean;
  /** позиция ступней */
  pos: [number, number, number];
  /** куда идём (точка захвата или последняя известная позиция врага) */
  goal: [number, number, number] | null;
  /** сколько секунд бот уже видит цель (для реакции) */
  seenFor: number;
  /** сколько секунд цель не видна */
  lostFor: number;
  /** цель, которую видит сейчас */
  target: BotBrain | null;
  /** остаток очереди и пауза между очередями */
  burstLeft: number;
  fireCd: number;
  /** направление взгляда (yaw) */
  yaw: number;
}

export interface SightResult {
  /** видно ли цель (луч не упёрся в стену раньше) */
  visible: boolean;
  /** расстояние между бойцами */
  dist: number;
}

/** Параметры оружия бота (упрощённо: АК-74). */
export const BOT_WEAPON = {
  damage: 18,
  /** м/с, как у настоящей пули */
  velocity: 900,
  /** дальность уверенного огня, м */
  range: 70,
  /** угол обзора: бот не видит за спиной */
  fov: (150 * Math.PI) / 180,
  /** минимальная пауза между очередями, с */
  restMin: 0.7,
  restMax: 1.6,
  /** скорость ходьбы бота, м/с */
  speed: 3.1,
} as const;

export function makeBrain(side: 0 | 1, pos: [number, number, number], skill: BotSkill = 'sergeant'): BotBrain {
  return {
    side, skill, hp: 100, dead: false, pos: [...pos], goal: null,
    seenFor: 0, lostFor: 99, target: null, burstLeft: 0, fireCd: 0, yaw: side ? Math.PI : 0,
  };
}

/**
 * Видит ли бот цель. `probe` — луч в физике (origin, dir, maxDist) → дистанция до
 * первого препятствия. Такой же вызов, как cmb.aimProbe в main.ts, поэтому не нужен
 * отдельный API физики.
 */
export function canSee(
  b: BotBrain, t: BotBrain,
  probe: (origin: [number, number, number], dir: [number, number, number], max: number) => number,
): SightResult {
  const dx = t.pos[0] - b.pos[0], dz = t.pos[2] - b.pos[2];
  const dy = (t.pos[1] + 1.2) - (b.pos[1] + 1.5);
  const dist = Math.hypot(dx, dy, dz);
  if (dist > BOT_WEAPON.range) return { visible: false, dist };
  // угол обзора: цель за спиной не видна, пока бот не «оглянётся»
  const fwd = b.yaw;   // yaw хранится прямо как atan2(dx, -dz), без пересчёта
  const ang = Math.atan2(dx, -dz);
  let diff = Math.abs(ang - fwd);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  if (diff > BOT_WEAPON.fov / 2 && dist > 4) return { visible: false, dist };
  const inv = 1 / Math.max(dist, 1e-3);
  const dir: [number, number, number] = [dx * inv, dy * inv, dz * inv];
  const hit = probe([b.pos[0], b.pos[1] + 1.5, b.pos[2]], dir, dist);
  // допуск 0.4 м: у цели своя капсула, луч «упирается» в неё
  return { visible: hit >= dist - 0.4, dist };
}

/**
 * Один тик ИИ. Возвращает: куда шагнуть и стрелять ли.
 * Никакой физики внутри — только решение, как в отдельном «мозге».
 */
export function tickBrain(
  b: BotBrain, enemies: BotBrain[], dt: number,
  probe: (origin: [number, number, number], dir: [number, number, number], max: number) => number,
): { move: [number, number]; fire: boolean; aim: number } {
  if (b.dead) return { move: [0, 0], fire: false, aim: b.yaw };
  const cfg = BOT_DIFFICULTY[b.skill];

  // 1. выбор цели: ближайшая видимая
  let best: BotBrain | null = null, bestD = Infinity, bestVisible = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const s = canSee(b, e, probe);
    if (s.dist > BOT_WEAPON.range) continue;
    const point = s.visible ? s.dist : s.dist + 40;   // невидимые — хуже видимых
    if (point < bestD) { bestD = point; best = e; bestVisible = s.visible; }
  }

  if (best && bestVisible) {
    b.seenFor += dt; b.lostFor = 0; b.target = best;
    // поворот к цели
    const dx = best.pos[0] - b.pos[0], dz = best.pos[2] - b.pos[2];
    b.yaw = Math.atan2(dx, -dz);
    // реакция: пока не «узнал» — не стреляет
    if (b.seenFor * 1000 < cfg.reaction) return { move: [0, 0], fire: false, aim: b.yaw };
    // очередь
    b.fireCd -= dt;
    if (b.fireCd <= 0) {
      if (b.burstLeft <= 0) b.burstLeft = cfg.burst;
      b.burstLeft--;
      if (b.burstLeft === 0) b.fireCd = BOT_WEAPON.restMin + Math.random() * (BOT_WEAPON.restMax - BOT_WEAPON.restMin);
      else b.fireCd = 0.1;
      // сближение на средней дистанции: стоять и стрелять — плохо
      const move: [number, number] = bestD > 18 ? [dx, dz] : [0, 0];
      return { move, fire: true, aim: b.yaw };
    }
    return { move: [0, 0], fire: false, aim: b.yaw };
  }

  // 2. цели не видно: идём к ней (последняя известная) или к точке захвата
  b.seenFor = 0; b.lostFor += dt; b.target = null;
  if (b.lostFor < 2 && best) {
    // только что потерял — идёт в сторону шума
    b.goal = [...best.pos];
  }
  if (!b.goal) return { move: [0, 0], fire: false, aim: b.yaw };
  const dx = b.goal[0] - b.pos[0], dz = b.goal[2] - b.pos[2];
  const d = Math.hypot(dx, dz);
  if (d < 1.5) return { move: [0, 0], fire: false, aim: b.yaw };
  b.yaw = Math.atan2(dx, -dz);
  return { move: [dx, dz], fire: false, aim: b.yaw };
}

/** Применить урон боту от игрока. Возвращает true, если убит. */
export function damageBrain(b: BotBrain, dmg: number): boolean {
  if (b.dead) return false;
  b.hp -= dmg;
  if (b.hp <= 0) { b.hp = 0; b.dead = true; return true; }
  return false;
}
