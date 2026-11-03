// Боты для M2: пока это мишени-манекены с HP, которые умеют умирать физически (рэгдолл).
// Полноценный ИИ (navmesh, отряды, 32×32) — этап M5; здесь важна проверка попаданий:
// пуля бьёт по зоне (голова ×2.5, корпус ×1, ноги ×0.7), тело получает импульс и падает.
import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { PhysicsClient } from '../physics/client';
import { WalkAnim } from './anim.ts';
import { blastDamage } from './blastEffects.ts';

export interface Bot {
  id: number;
  hp: number;
  maxHp: number;
  object: THREE.Object3D;
  bodyId: number;
  /** высота, от пола до макушки — нужна для зон попадания */
  height: number;
  dead: boolean;
  /** цвет формы: 0 — свой, 1 — противник */
  side: number;
  /** процедурная ходьба по костям скелета (в модели нет клипов) */
  anim?: WalkAnim;
  /** текущая скорость для анимации, м/с (ставит squads.ts) */
  moveSpeed?: number;
}

export class Bots {
  list: Bot[] = [];
  lib: AssetLibrary; phys: PhysicsClient; scene: THREE.Scene;
  onDeath: ((b: Bot) => void) | null = null;

  constructor(scene: THREE.Scene, lib: AssetLibrary, phys: PhysicsClient) {
    this.scene = scene; this.lib = lib; this.phys = phys;
  }

  spawn(id: string, pos: [number, number, number], rotY = 0, side = 1): Bot | null {
    if (!this.lib.has(id)) return null;
    const inst = this.lib.make(id);
    const obj = inst.object;
    obj.position.set(...pos); obj.rotation.y = rotY;
    this.scene.add(obj);
    const h = inst.item.size ? inst.item.size[1] : 1.8;
    // Свои материалы на бота: иначе затемнение при смерти и любые правки цвета
    // «протекают» на всех остальных ботов (общий кэш модели).
    obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material | THREE.Material[];
      m.material = Array.isArray(mat) ? mat.map(x => x.clone()) : mat.clone();
    });
    // физика: капсула по высоте модели. Пока живой — кинематический (стоит), после смерти — падает.
    const bodyId = this.phys.add({
      kind: 'dynamic', pos: [pos[0], pos[1] + h / 2, pos[2]], mass: 80, friction: 0.9,
      linDamp: 0.2, angDamp: 0.9, shapes: [{ t: 'box', he: [0.3, h / 2, 0.22] }],
      surface: 'dirt', group: 0x0008, sleeping: false,
    }, obj);
    // Ходьба: в soldier.glb нет клипов, но есть скелет → анимируем костями.
    // Если кости не нашлись (другая модель) — WalkAnim.ok === false, и бот просто едет.
    // id модели нужен, чтобы взять готовую карту костей (у моделей разные скелеты)
    const anim = new WalkAnim(obj, id);
    const bot: Bot = { id: this.list.length, hp: 100, maxHp: 100, object: obj, bodyId, height: h, dead: false, side, anim, moveSpeed: 0 };
    this.list.push(bot);
    return bot;
  }

  /** Убрать всех (новая волна) — и объекты, и тела физики. */
  clear() {
    for (const b of this.list) {
      b.object.removeFromParent();
      this.phys.removeBody(b.bodyId);
    }
    this.list.length = 0;
  }

  /** Применить попадание. Возвращает true, если бот умер этим выстрелом. */
  hit(bot: Bot, damage: number, point: [number, number, number]) {
    if (bot.dead) return false;
    // зона попадания по локальной высоте
    const rel = (point[1] - bot.object.position.y) / bot.height;
    const mult = rel > 0.82 ? 2.5 : rel > 0.45 ? 1.0 : 0.7;
    bot.hp -= damage * mult;
    if (bot.hp <= 0) { this.kill(bot); return true; }
    return false;
  }

  /** Урон от ударной волны всем живым бойцам в радиусе, с плавным затуханием. */
  blast(pos: [number, number, number], radius: number, damage: number): number {
    let killed = 0;
    for (const bot of this.list) {
      if (bot.dead) continue;
      const p = bot.object.position;
      const distance = Math.hypot(p.x - pos[0], p.y + bot.height * 0.5 - pos[1], p.z - pos[2]);
      const amount = blastDamage(distance, radius, damage);
      if (amount <= 0) continue;
      bot.hp -= amount;
      if (bot.hp <= 0) { this.kill(bot); killed++; }
    }
    return killed;
  }

  /** Смерть: тело становится рэгдоллом (импульс от направления пули). */
  kill(bot: Bot) {
    bot.dead = true; bot.hp = 0;
    bot.anim?.reset();
    // «мягкое» падение: гасим вращение и роняем на бок импульсом
    this.phys.post({ type: 'impulse', id: bot.bodyId, imp: [(Math.random() - 0.5) * 40, -30, (Math.random() - 0.5) * 40] });
    // ВАЖНО: материалы у копий модели ОБЩИЕ (SkeletonUtils.clone не клонирует материалы).
    // Раньше здесь множился цвет материала — и каждый убитый бот затемнял ВСЕХ, включая
    // живых: к третьей волне солдаты становились чёрными силуэтами (скриншот пользователя).
    // Теперь гасим только этот экземпляр — свой клон материала на меш.
    bot.object.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const arr = Array.isArray(src) ? src : [src];
      const dimmed = arr.map(mat => {
        if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mat;
        const c = mat.clone();
        c.color.multiplyScalar(0.55);
        return c;
      });
      m.material = Array.isArray(src) ? dimmed : dimmed[0];
    });
    this.onDeath?.(bot);
  }

  /** Ближайший бот к точке в радиусе — для попаданий по телу (пока без полноценного рейкаста по костям). */
  nearest(p: [number, number, number], radius = 0.8) {
    let best: Bot | null = null, bd = radius;
    for (const b of this.list) {
      if (b.dead) continue;
      const t = b.object.position;
      const d = Math.hypot(t.x - p[0], (t.y + b.height * 0.5) - p[1], t.z - p[2]);
      // попадание считается по горизонтали + высоте, с поправкой на габарит
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  alive() { return this.list.filter(b => !b.dead).length; }

  aliveBy(side: number) { return this.list.filter(b => !b.dead && b.side === side).length; }

  /** Живые бойцы стороны — для режима матча (точки захвата, билеты). */
  refs(): { side: 0 | 1; alive: boolean; pos: [number, number, number]; holding: boolean }[] {
    return this.list.map(b => ({
      side: (b.side ? 1 : 0) as 0 | 1,
      alive: !b.dead,
      pos: [b.object.position.x, b.object.position.y, b.object.position.z] as [number, number, number],
      holding: false,
    }));
  }
}
