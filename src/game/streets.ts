// УЛИЦЫ И ДВОРОВЫЕ ПРОЕЗДЫ КАРТЫ.
//
// На плане квартала (схема пользователя) видны четыре улицы по периметру и сетка
// проездов внутри двора. Раньше на их месте был просто снег, и район читался как
// «дома в поле». Здесь — асфальт с бордюром, разметкой и снежной кашей по краям.
//
// Геометрия: улица — это прямоугольник в плане (x0,z0)-(x1,z1). Всё рисуется
// плоскими мешами на 2 см выше земли, поэтому не мешает физике террейна.
import * as THREE from 'three';
import type { PhysicsClient } from '../physics/client.ts';
import { heightAt } from './terrain.ts';

export interface StreetDef {
  name?: string;
  x0: number; z0: number; x1: number; z1: number;
  /** ширина разметки/бордюра, м */
  curb?: number;
  /** дворовый проезд (уже, без разметки) */
  lane?: boolean;
}

/** Снег по краям дороги: зимой асфальт не бывает чистым. */
const SNOW = '#dfe7ee';
const ASPHALT = '#4a4d52';
const ASPHALT_LANE = '#565a60';
const CURB = '#9aa0a6';
const MARK = '#d8d2b8';

/**
 * Строит дороги карты. Возвращает меш-группу и счётчик, чтобы тест мог проверить,
 * что улицы не проходят сквозь дома.
 */
export function spawnStreets(
  scene: THREE.Scene, phys: PhysicsClient, streets: readonly StreetDef[],
): { count: number; group: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'streets';
  const asphalt = new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 0.95 });
  const laneMat = new THREE.MeshStandardMaterial({ color: ASPHALT_LANE, roughness: 0.97 });
  const snowMat = new THREE.MeshStandardMaterial({ color: SNOW, roughness: 0.9 });
  const curbMat = new THREE.MeshStandardMaterial({ color: CURB, roughness: 0.85 });
  const markMat = new THREE.MeshStandardMaterial({ color: MARK, roughness: 0.8 });

  for (const s of streets) {
    const w = Math.abs(s.x1 - s.x0), d = Math.abs(s.z1 - s.z0);
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    const y = Math.max(heightAt(s.x0, s.z0), heightAt(s.x1, s.z1), heightAt(cx, cz)) + 0.02;
    // полотно: чуть шире, чем проезжая часть — чтобы не было щелей на стыках улиц
    const road = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), s.lane ? laneMat : asphalt);
    road.position.set(cx, y, cz); road.receiveShadow = true; group.add(road);

    // бордюр по длинным сторонам (у дворовых проездов его нет)
    if (!s.lane) {
      const cw = 0.35;
      const along = w > d;
      const curbs = along
        ? [[cx, y + 0.05, s.z0 - cw / 2, w, cw], [cx, y + 0.05, s.z1 + cw / 2, w, cw]]
        : [[s.x0 - cw / 2, y + 0.05, cz, cw, d], [s.x1 + cw / 2, y + 0.05, cz, cw, d]];
      for (const [x, cy, z, cwid, cdep] of curbs) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(cwid, 0.16, cdep), curbMat);
        c.position.set(x, cy, z); c.receiveShadow = true; group.add(c);
      }
      // разметка: пунктир по центру (5 м штрих, 5 м разрыв)
      const len = along ? w : d;
      const n = Math.floor(len / 10);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + 5 + i * 10;
        const mk = along
          ? new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.01, 0.16), markMat)
          : new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 3.5), markMat);
        mk.position.set(along ? cx + t : cx, y + 0.05, along ? cz : cz + t);
        group.add(mk);
      }
      // снежная каша по краям полотна
      const band = along
        ? [[cx, y + 0.06, s.z0 - 1.0, w, 2.0], [cx, y + 0.06, s.z1 + 1.0, w, 2.0]]
        : [[s.x0 - 1.0, y + 0.06, cz, 2.0, d], [s.x1 + 1.0, y + 0.06, cz, 2.0, d]];
      for (const [x, y2, z, bw, bd] of band) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.04, bd), snowMat);
        b.position.set(x, y2, z); b.receiveShadow = true; group.add(b);
      }
    }
  }
  scene.add(group);
  // дороги — часть террейна: физикой не нужны (пол уже есть), но край бордюра
  // не должен быть «ярой»: оставляем только визуал, чтобы не плодить тела
  void phys;
  return { count: streets.length, group };
}

/** Проверка «улица не идёт сквозь дом» — используется тестом и при правке карты. */
export function streetHitsBox(s: StreetDef, box: { x0: number; z0: number; x1: number; z1: number }): boolean {
  return s.x0 < box.x1 && s.x1 > box.x0 && s.z0 < box.z1 && s.z1 > box.z0;
}
