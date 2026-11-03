import * as THREE from 'three';
import { tex } from '../render/tex.ts';
import type { WaterDef } from './water.ts';

/**
 * РАЗМЕР МИРА. По ТЗ п.9 у карт разный масштаб: «Спальный район» и «Заводская
 * площадка» — 2×2 км (игровая зона 400 м, дальше холмы), «Пригород» — 4×4 км
 * (игровая зона 800 м), «Портовый город» — 3×3 км.
 *
 * Раньше это были константы 400/160: сетка террейна и физика земли были прибиты
 * к одному размеру, поэтому большие карты физически не помещались. Теперь размер —
 * параметр со значением по умолчанию (старый 400 м), а шаг сетки остаётся ~2.5 м:
 * SEG считается от размера, чтобы плотность треугольников не менялась.
 */
export const MAP_SIZE = 400;
/** Шаг сетки террейна, м. 400/160 = 2.5 м — привычная плотность. */
export const TERRAIN_STEP = 2.5;
/** Базовый SEG для 400 м (совместимость со старым кодом). */
export const SEG = Math.round(MAP_SIZE / TERRAIN_STEP);

/** Сколько сегментов нужно для мира заданного размера при шаге ~2.5 м. */
export const segFor = (size: number) => Math.round(size / TERRAIN_STEP);
/**
 * ЗИМА. Раньше газон красился зелёным (`#4f6a34`), и посреди снега лежало летнее поле.
 * Теперь земля — снег: слегка голубой в тени, тёплый на солнце, с редкими
 * проталинами на холмах. Цвет вершин задаёт оттенок, карта травы — фактуру
 * (зимой она читается как снежная крупа, поэтому её и оставляем).
 */
const SNOW_SHADE = '#b9c4cf';   // снег в тени / на ровном месте
const SNOW_SUN = '#eef3f7';     // снег на солнце и на вершинах
const SNOW_ICE = '#a8b6c4';     // наледь и проталины в низинах
/** Яркость зимнего света: снег не должен быть серым бетоном. */
export const WINTER = { snow: SNOW_SUN, shade: SNOW_SHADE, ice: SNOW_ICE } as const;
/** Высота рельефа. Центральная зона 260x260 м плоская (полигон), дальше холмы. */
let currentSize = MAP_SIZE;
let basin: WaterDef | undefined;
/** Настройки только текущей карты: при смене карты прежний размер не сохраняется. */
export function setWorldSize(size: number) { currentSize = size; return size; }
export const worldSize = () => currentSize;
export function setTerrainWater(w?: WaterDef) { basin = w; }
export function heightAt(x: number, z: number): number {
  const d = Math.max(Math.abs(x), Math.abs(z));
  // Плоская игровая зона — 85% от половины мира: у 400 м это 170 м, у 800 м — 340 м.
  // Раньше было 130/200 при любом размере, и на большой карте спавны попадали в холмы
  // (машины «висели» на 4–8 м над землёй — поймал test-vehicle-scene).
  const flat = (worldSize() / 2) * 0.85;
  const k = THREE.MathUtils.smoothstep(d, flat, flat + 60);
  const n = Math.sin(x * 0.021) * Math.cos(z * 0.017) * 7 + Math.sin(x * 0.047 + 1.3) * Math.sin(z * 0.043) * 3 + Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.8;
  const ground = (n + 8) * k;
  if (!basin || x < basin.x0 || x > basin.x1 || z < basin.z0 || z > basin.z1) return ground;
  // Мягкий берег шириной 10 м: поверхность и физический trimesh используют одно дно.
  const edge = Math.min(x - basin.x0, basin.x1 - x, z - basin.z0, basin.z1 - z);
  const blend = THREE.MathUtils.smoothstep(edge, 0, 10);
  return THREE.MathUtils.lerp(ground, basin.level - (basin.depth ?? 3), blend);
}
export function buildTerrain(size = MAP_SIZE) {
  setWorldSize(size);
  const SEGN = segFor(size);
  const n = SEGN + 1, step = size / SEGN;
  const verts = new Float32Array(n * n * 3), cols = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -size / 2 + i * step, z = -size / 2 + j * step, y = heightAt(x, z), o = (j * n + i) * 3;
    verts[o] = x; verts[o + 1] = y; verts[o + 2] = z;
    const t = Math.sin(x * 0.3) * Math.cos(z * 0.27) * 0.5 + 0.5;
    if (y < 0.05 && Math.abs(x) < 125 && Math.abs(z) < 125) {
      // бетонная площадка: зимой она присыпана снегом — снег лежит в швах и по краям
      c.set('#8f9089').lerp(new THREE.Color('#c9ccd0'), t * 0.55 + 0.15);
      c.lerp(new THREE.Color(1, 1, 1), 0.12);   // присыпано снегом
    } else {
      // снег: чем выше, тем светлее; в низинах — голубоватая наледь
      const high = Math.min(1, Math.max(0, y / 12));
      // ВАЖНО: THREE.Color переводит hex в ЛИНЕЙНОЕ пространство (#eef3f7 → 0.78).
      // Светлее этого снег не станет, поэтому дополнительно «выбеливаем» к 1.0 —
      // иначе на экране получается серый бетон вместо снега.
      c.set(SNOW_ICE).lerp(new THREE.Color(SNOW_SHADE), Math.min(1, t * 0.7 + 0.2));
      c.lerp(new THREE.Color(SNOW_SUN), high * 0.85 + t * 0.1);
      c.lerp(new THREE.Color(1, 1, 1), 0.35 + high * 0.25 + t * 0.08);
    }
    cols.set([c.r, c.g, c.b], o);
  }
  const idx = new Uint32Array(SEGN * SEGN * 6); let k = 0;
  for (let j = 0; j < SEGN; j++) for (let i = 0; i < SEGN; i++) {
    const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
    idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  // Снег: отдельная карта snow.jpg (или процедурная, если файла нет).
  // РАНЬШЕ здесь была карта травы — она зеленью подмешивалась к цвету вершин, и
  // зимняя земля получалась болотно-зелёной. Пользователь: «трава зелёная, а должна
  // быть белая, так как зима». Теперь трава не используется вообще.
  const grass = tex('snow') ?? tex('ground');
  if (grass) {
    // UV по мировым координатам: 400 м / 8 м = 50 повторов — масштаб травы ~8 м на тайл
    const uvs = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      uvs[(j * n + i) * 2] = i / SEGN * (size / 8);
      uvs[(j * n + i) * 2 + 1] = j / SEGN * (size / 8);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, flatShading: false,
    ...(grass ? { map: grass } : {}),
  }));
  mesh.receiveShadow = true;
  return { mesh, verts, idx };
}
