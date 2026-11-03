// ДВОР И УЛИЦЫ КАРТЫ (по плану квартала).
//
// План пользователя — не только дома: на нём есть улицы с бордюрами, проезды внутри
// квартала, детская площадка, гаражи, деревья, машины во дворах и забор вокруг
// квартала бараков. Без этого «спальный район» выглядит как дома в чистом поле
// (что и было видно на скриншотах: снег, одинокая панелька, ничего вокруг).
//
// Всё это ставится по ДАННЫМ карты (map.greenery / map.dressing / map.streets),
// поэтому план и мир не расходятся: tools/plan-city.mjs рисует то же самое.
import * as THREE from 'three';
import type { PhysicsClient } from '../physics/client.ts';
import { heightAt } from './terrain.ts';

export type DressingKind =
  | 'tree' | 'tree_snow' | 'bench' | 'playground' | 'garage' | 'car' | 'bus' | 'kiosk' | 'fence' | 'bin' | 'lamp';

export interface DressingItem {
  kind: DressingKind;
  pos: [number, number, number];
  rotY?: number;
  /** для машин: цвет кузова */
  color?: string;
}

/** Как выглядит каждый предмет двора. Простые формы: их видно издалека и они дешёвые. */
function build(kind: DressingKind, color?: string): THREE.Group {
  const g = new THREE.Group();
  const m = (c: string, r = 0.85, metal = 0.05) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: metal });
  const box = (w: number, h: number, d: number, c: string, y = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c));
    o.position.y = y + h / 2; o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  const cyl = (r: number, h: number, c: string, y = 0, seg = 10) => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m(c));
    o.position.y = y + h / 2; o.castShadow = true; g.add(o); return o;
  };
  switch (kind) {
    case 'tree': {
      cyl(0.16, 4.2, '#4a3a2c');
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9 - i * 0.45, 2.4, 8), m('#24483a'));
        cone.position.y = 3.4 + i * 1.15; cone.castShadow = true; g.add(cone);
      }
      break;
    }
    case 'tree_snow': {
      cyl(0.14, 4.6, '#4a3a2c');
      // голая крона зимой: ветки + снег на них (как в плане — «деревья в снегу»)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 2.6, 5), m('#5c4c40'));
        br.position.set(Math.cos(a) * 0.6, 4.6 + (i % 2) * 0.5, Math.sin(a) * 0.6);
        br.rotation.set(0.5 * Math.cos(a), 0, 0.5 * Math.sin(a));
        g.add(br);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5), m('#e8f1f7', 0.95));
        cap.scale.set(1, 0.5, 1);
        cap.position.set(Math.cos(a) * 1.1, 5.7 + (i % 2) * 0.5, Math.sin(a) * 1.1);
        g.add(cap);
      }
      break;
    }
    case 'bench': {
      box(1.8, 0.08, 0.45, '#7a5a34', 0.45);
      box(1.8, 0.35, 0.06, '#7a5a34', 0.75);
      for (const s of [-1, 1]) box(0.08, 0.45, 0.4, '#3a3a3a', 0).position.x = s * 0.75;
      break;
    }
    case 'playground': {
      // качели + песочница + горка: узнаваемая детская площадка
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), m('#b03434'));
        leg.position.set(s * 1.6, 1.25, 0); leg.rotation.z = s * 0.28; g.add(leg);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), m('#b03434'));
      bar.rotation.z = Math.PI / 2; bar.position.y = 2.4; g.add(bar);
      box(0.5, 0.06, 0.25, '#2a4a8a', 0.6).position.x = -0.5;
      box(2.6, 0.35, 2.6, '#c9b98a', 0).position.set(2.6, 0, 3.2);      // песочница
      box(2.6, 0.5, 0.12, '#8a7040', 0).position.set(2.6, 0, 1.95);
      const hill = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 2.6), m('#cfd6dd'));
      hill.position.set(-3.2, 1.1, 2.4); hill.rotation.x = -0.42; g.add(hill);
      box(1.4, 1.2, 1.4, '#4a7ab0', 0).position.set(-3.2, 0, 1.4);
      break;
    }
    case 'garage': {
      box(3.4, 2.4, 6, '#6b7280', 0);
      box(3.0, 2.0, 0.12, '#8a5a2a', 0.2).position.z = 3.02;
      box(3.6, 0.16, 6.2, '#4a4f59', 2.4);
      break;
    }
    case 'car': {
      const c = color ?? '#8a3a3a';
      box(1.8, 0.62, 4.1, c, 0.35);
      box(1.65, 0.55, 2.0, c, 0.95).position.z = -0.1;
      box(1.6, 0.4, 1.5, '#22303a', 1.05).position.z = -0.1;
      for (const x of [-0.85, 0.85]) for (const z of [-1.35, 1.35]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10), m('#181a1a', 0.95));
        w.rotation.z = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w);
      }
      break;
    }
    case 'bus': {
      box(2.5, 2.6, 10, '#c9b23a', 0.4);
      for (const z of [-3.4, -1.1, 1.1, 3.4]) box(2.3, 0.9, 1.5, '#22303a', 1.7).position.z = z;
      for (const z of [-3.2, 3.2]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10), m('#181a1a', 0.95));
        w.rotation.z = Math.PI / 2; w.position.set(-1.2, 0.5, z); g.add(w);
        const w2 = w.clone(); w2.position.x = 1.2; g.add(w2);
      }
      break;
    }
    case 'kiosk': {
      box(3.2, 2.6, 2.2, '#7a8a9a', 0);
      box(2.6, 0.9, 0.1, '#9ec0d8', 1.5).position.z = 1.12;
      box(3.6, 0.16, 2.6, '#44515e', 2.6);
      break;
    }
    case 'fence': {
      // секция забора 2.4 м: бетонные столбики и сетка
      for (const s of [-1, 1]) box(0.18, 1.9, 0.18, '#9aa0a6', 0).position.x = s * 1.2;
      const net = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.05), m('#7f8a92', 0.9, 0.6));
      net.position.y = 0.95; g.add(net);
      break;
    }
    case 'bin': {
      cyl(0.32, 0.9, '#3f5a3a', 0);
      break;
    }
    case 'lamp': {
      cyl(0.09, 6.2, '#4a4f55');
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), m('#6a7078', 0.6, 0.4));
      head.position.set(0.45, 6.2, 0); g.add(head);
      break;
    }
  }
  return g;
}

/** Ставит все предметы двора и улиц и возвращает их общее число. */
export function spawnDressing(
  scene: THREE.Scene, phys: PhysicsClient,
  items: readonly DressingItem[],
  opts: { collider?: boolean } = {},
): { count: number; group: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'dressing';
  const collider = opts.collider ?? true;
  // геометрия переиспользуется: 200 деревьев — это не 200 новых буферов
  const cache = new Map<string, THREE.Group>();
  for (const it of items) {
    const key = it.kind + '|' + (it.color ?? '');
    let proto = cache.get(key);
    if (!proto) { proto = build(it.kind, it.color); cache.set(key, proto); }
    const obj = proto.clone(true);
    const y = heightAt(it.pos[0], it.pos[2]);
    obj.position.set(it.pos[0], y + (it.pos[1] ?? 0), it.pos[2]);
    obj.rotation.y = it.rotY ?? 0;
    obj.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } });
    group.add(obj);
    if (collider && ['garage', 'car', 'bus', 'kiosk', 'fence'].includes(it.kind)) {
      const b = new THREE.Box3().setFromObject(obj);
      const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      phys.add({
        kind: 'static', pos: [c.x, c.y, c.z], friction: 0.7,
        shapes: [{ t: 'box', he: [s.x / 2, s.y / 2, s.z / 2], rotY: it.rotY ?? 0 }],
        surface: it.kind === 'car' || it.kind === 'bus' ? 'metal' : 'concrete',
      }, obj);
    }
  }
  scene.add(group);
  return { count: items.length, group };
}
