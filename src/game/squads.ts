// УПРАВЛЕНИЕ БОЙЦАМИ В БОЮ: соединяет «мозг» (botai.ts) с моделями (bots.ts),
// физикой и режимом (match.ts). Здесь же — лучи для стрельбы ботов и подсчёт урона.
//
// Почему отдельный модуль: main.ts и так 400+ строк, а тут своя забота —
// каждый тик прогнать N мозгов, подвинуть модели, проверить попадания.
//
// Боты используют ТУ ЖЕ физику, что игрок: их позиция берётся из тела, шаг — телепорт
// по земле с проверкой «не в стену» (кинематическая капсула на 30 ботов — это дорого,
// а на результат не влияет: боты ходят по земле снаружи дома).
import type * as THREE from 'three';
import type { PhysicsClient } from '../physics/client';
import type { Match } from './match';
import { Bots, type Bot } from './bots';
import { BOT_WEAPON, makeBrain, tickBrain, type BotBrain, type BotSkill } from './botai';
import { BALANCE, HitGate, damageToPlayer, hitChance } from './balance';
import type { Effects } from './effects';

export interface SquadHit {
  /** кто получил урон: 'player' или id бота */
  target: 'player' | number;
  damage: number;
  from: [number, number, number];
}

export class Squads {
  bots: Bots;
  match: Match;
  phys: PhysicsClient;
  effects: Effects | null;
  brains: BotBrain[] = [];
  skill: BotSkill = 'sergeant';
  /** попадания за тик — забирает main.ts (урон игроку, эффекты, счёт) */
  hits: SquadHit[] = [];
  /** очередь выстрелов для звука: main.ts проигрывает их с задержкой по расстоянию */
  shots: { pos: [number, number, number]; side: 0 | 1 }[] = [];
  onKill: ((victim: Bot, killer: 0 | 1) => void) | null = null;
  /**
   * БАЛАНС: сколько ботов одновременно «ведут» игрока. Восемь стволов в одну цель —
   * это не бой, а расстрел; по ТЗ боты ещё и должны делить цели между собой.
   */
  maxOnPlayer = 3;
  /** не даёт убить за пару тычек: grace-период + лимит попаданий в секунду */
  hitGate = new HitGate();
  /** игровое время для HitGate */
  private clock = 0;
  /** сколько секунд игрок уже под обстрелом (для штрафа «не видел стрелка») */
  underFire = 0;
  /** текущий предел HP игрока (класс может быть крепче) — ставит main.ts */
  playerMaxHp = 100;

  constructor(bots: Bots, match: Match, phys: PhysicsClient, effects: Effects | null) {
    this.bots = bots; this.match = match; this.phys = phys; this.effects = effects;
  }

  /** Синхронизировать мозги со списком живых ботов (после волны/смерти). */
  sync(playerPos: [number, number, number]) {
    const alive = this.bots.list.filter(b => !b.dead);
    // мозгов меньше, чем ботов → создаём
    while (this.brains.length < alive.length) {
      const b = alive[this.brains.length];
      const brain = makeBrain(b.side ? 1 : 0, [b.object.position.x, b.object.position.y, b.object.position.z], this.skill);
      this.brains.push(brain);
    }
    this.brains.length = alive.length;
    alive.forEach((b, i) => {
      const br = this.brains[i];
      br.pos = [b.object.position.x, b.object.position.y, b.object.position.z];
      br.dead = b.dead;
      // точка цели: атаковать ближайшую не свою точку захвата
      if (!br.goal) {
        const p = this.match.targetPoint(br.side);
        if (p) br.goal = [p.pos[0], p.pos[1], p.pos[2]];
      }
    });
    void playerPos;
  }

  /**
   * Тик боя.
   *
   * ВАЖНО про лучи: `phys.probe()` асинхронный — ответ приходит в следующем кадре,
   * поэтому 30 ботов на нём одновременно «видят» чужой ответ. Здесь линия огня
   * проверяется по вокселям домов (`lineOfSight`), а позиции моделей — свои у каждого
   * бота. Это ещё и дешевле: не нужен переход в воркер на каждый выстрел.
   */
  update(dt: number, los: (a: [number, number, number], b: [number, number, number]) => boolean,
    playerPos: [number, number, number], playerAlive: boolean, cameraPos: [number, number, number]) {
    this.hits.length = 0;
    this.shots.length = 0;
    this.sync(playerPos);
    const alive = this.bots.list.filter(b => !b.dead);

    // все бойцы в «мозгах»: игрок — тоже боец стороны 0 (иначе боты не стреляют по нему)
    const playerBrain: BotBrain | null = playerAlive
      ? { ...makeBrain(0, [playerPos[0], playerPos[1], playerPos[2]]), yaw: 0 }
      : null;

    this.clock += dt;
    // «под обстрелом» копится только пока по игроку реально идёт огонь (0.8 с тишины — сброс)
    this.underFire = Math.max(0, this.underFire - dt * 0.6);
    // цель «игрок» доступна только ограниченному числу ботов: остальные воюют между собой
    let onPlayer = 0;
    for (let i = 0; i < alive.length; i++) {
      const bot = alive[i], brain = this.brains[i];
      brain.side = bot.side ? 1 : 0;
      const enemies: BotBrain[] = this.brains.filter((b, j) => j !== i && !b.dead && b.side !== brain.side && alive[j]?.side !== bot.side);
      const canTargetPlayer = !!playerBrain && brain.side === 1 && onPlayer < this.maxOnPlayer;
      if (canTargetPlayer) { enemies.push(playerBrain!); onPlayer++; }

      // перед стрельбой бот должен «увидеть» и прицелиться
      // «проба» для мозга: возвращает дистанцию до цели, если линия свободна, иначе малое число
      const probe = (o: [number, number, number], d: [number, number, number], max: number) => {
        const e: [number, number, number] = [o[0] + d[0] * max, o[1] + d[1] * max, o[2] + d[2] * max];
        return los(o, e) ? max : Math.min(max, 0.5);
      };
      const cmd = tickBrain(brain, enemies, dt, probe);

      // --- движение: шаг по земле с проверкой препятствий
      if (cmd.move[0] || cmd.move[1]) {
        const len = Math.hypot(cmd.move[0], cmd.move[1]) || 1;
        const step = BOT_WEAPON.speed * dt;
        const nx = brain.pos[0] + (cmd.move[0] / len) * step;
        const nz = brain.pos[2] + (cmd.move[1] / len) * step;
        // проверка: по направлению шага нет стены (луч на 0.45 м на высоте груди)
        // шаг не в стену: проверяем саму точку шага (луч на 0.35 выше колена не нужен)
        if (los([brain.pos[0], brain.pos[1] + 1.0, brain.pos[2]],
                [nx, brain.pos[1] + 1.0, nz])) {
          brain.pos[0] = nx; brain.pos[2] = nz;
          bot.object.position.set(brain.pos[0], brain.pos[1], brain.pos[2]);
          bot.moveSpeed = BOT_WEAPON.speed;
        } else bot.moveSpeed = 0;
      } else bot.moveSpeed = 0;

      // ПОВОРОТ и ХОДЬБА: корпус доводится к цели, кости ног/рук машут по скорости.
      // Раньше модель просто «ехала» вперёд, не шевеля ногами — на это и была жалоба.
      const wantYaw = brain.target ? Math.atan2(brain.target.pos[0] - brain.pos[0], -(brain.target.pos[2] - brain.pos[2])) : brain.yaw;
      let dy = wantYaw - bot.object.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      bot.object.rotation.y += dy * Math.min(1, dt * 9);
      bot.anim?.update(dt, bot.moveSpeed ?? 0, brain.target ? dy : 0);

      // --- выстрел: луч по цели, попадание с вероятностью точности сложности
      if (cmd.fire) {
        this.shots.push({ pos: [brain.pos[0], brain.pos[1] + 1.5, brain.pos[2]], side: brain.side });
        const tgt = brain.target;
        if (tgt) {
          const dist = Math.hypot(tgt.pos[0] - brain.pos[0], tgt.pos[2] - brain.pos[2]);
          const isPlayer = tgt === playerBrain;
          // БАЛАНС (balance.ts): вероятность попадания падает с дистанцией, урон по игроку
          // небольшой и с потолком, плюс HitGate не даёт «умереть за пару тычек».
          const chance = hitChance(this.skill, dist);
          const dmg = isPlayer
            ? damageToPlayer(this.skill, this.playerMaxHp, this.underFire >= BALANCE.revealTime)
            : BOT_WEAPON.damage;
          const landed = Math.random() < chance;
          if (landed && isPlayer && !this.hitGate.allow(this.clock)) {
            // попадание «съедено» grace-периодом — но визуально выстрел был (трассер ниже)
          } else if (landed) {
            this.hits.push({ target: isPlayer ? 'player' : this.aliveIndexOf(tgt), damage: dmg, from: [...brain.pos] });
            if (isPlayer) this.underFire += dt;
            if (!isPlayer) {
              // урон своему боту — через Bots.hit (там зоны и рэгдолл)
              const victim = this.bots.list[this.aliveIndexOf(tgt)];
              if (victim && this.bots.hit(victim, dmg, [tgt.pos[0], tgt.pos[1] + 1.0, tgt.pos[2]])) {
                brain.dead = true;
                this.onKill?.(victim, brain.side === 0 ? 1 : 0);
              }
            }
          }
          // трассер и вспышка — в точку цели (или мимо, если промах)
          if (this.effects) {
            const miss = Math.random() < 0.5 ? 0.35 : -0.35;
            this.effects.botTrail(
              [brain.pos[0], brain.pos[1] + 1.5, brain.pos[2]],
              [tgt.pos[0] + miss, tgt.pos[1] + 1.1, tgt.pos[2] - miss], '#ffe9a8');
          }
        }
      }
    }
    void cameraPos;
  }

  /** Индекс живого бота → индекс в общем списке (для урона). */
  private aliveIndexOf(brain: BotBrain): number {
    const alive = this.bots.list.filter(b => !b.dead);
    const i = this.brains.indexOf(brain);
    if (i < 0) return -1;
    return this.bots.list.indexOf(alive[i]);
  }

  /** Попадание игрока по боту (из main.ts, где считается урон пули). */
  playerHit(bot: Bot, damage: number, point: [number, number, number]) {
    const killed = this.bots.hit(bot, damage, point);
    if (killed) this.onKill?.(bot, 0);
    return killed;
  }
}

/** Заглушка THREE.Object3D для типов (модуль не тянет three в рантайм тестов). */
export type { THREE };
