import * as THREE from 'three';
import { tex } from '../render/tex.ts';

export const MAP_SIZE = 400, SEG = 160;
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
export function heightAt(x: number, z: number): number {
  const d = Math.max(Math.abs(x), Math.abs(z));
  const k = THREE.MathUtils.smoothstep(d, 130, 200);
  const n = Math.sin(x * 0.021) * Math.cos(z * 0.017) * 7 + Math.sin(x * 0.047 + 1.3) * Math.sin(z * 0.043) * 3 + Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.8;
  return (n + 8) * k;
}
export function buildTerrain() {
  const n = SEG + 1, step = MAP_SIZE / SEG;
  const verts = new Float32Array(n * n * 3), cols = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -MAP_SIZE / 2 + i * step, z = -MAP_SIZE / 2 + j * step, y = heightAt(x, z), o = (j * n + i) * 3;
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
  const idx = new Uint32Array(SEG * SEG * 6); let k = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
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
      uvs[(j * n + i) * 2] = i / SEG * 50;
      uvs[(j * n + i) * 2 + 1] = j / SEG * 50;
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
