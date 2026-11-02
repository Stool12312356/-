// Боты для M2: пока это мишени-манекены с HP, которые умеют умирать физически (рэгдолл).
// Полноценный ИИ (navmesh, отряды, 32×32) — этап M5; здесь важна проверка попаданий:
// пуля бьёт по зоне (голова ×2.5, корпус ×1, ноги ×0.7), тело получает импульс и падает.
import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { PhysicsClient } from '../physics/client';

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
    // физика: капсула по высоте модели. Пока живой — кинематический (стоит), после смерти — падает.
    const bodyId = this.phys.add({
      kind: 'dynamic', pos: [pos[0], pos[1] + h / 2, pos[2]], mass: 80, friction: 0.9,
      linDamp: 0.2, angDamp: 0.9, shapes: [{ t: 'box', he: [0.3, h / 2, 0.22] }],
      surface: 'dirt', group: 0x0008, sleeping: false,
    }, obj);
    const bot: Bot = { id: this.list.length, hp: 100, maxHp: 100, object: obj, bodyId, height: h, dead: false, side };
    this.list.push(bot);
    return bot;
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

  /** Смерть: тело становится рэгдоллом (импульс от направления пули). */
  kill(bot: Bot) {
    bot.dead = true; bot.hp = 0;
    // «мягкое» падение: гасим вращение и роняем на бок импульсом
    this.phys.post({ type: 'impulse', id: bot.bodyId, imp: [(Math.random() - 0.5) * 40, -30, (Math.random() - 0.5) * 40] });
    bot.object.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.MeshStandardMaterial).color?.multiplyScalar(0.7); });
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
}
