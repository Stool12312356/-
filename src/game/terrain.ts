import * as THREE from 'three';
import { tex } from '../render/tex.ts';

export const MAP_SIZE = 400, SEG = 160;
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
    if (y < 0.05 && Math.abs(x) < 125 && Math.abs(z) < 125) c.set('#6d6b64').lerp(new THREE.Color('#5d5b55'), t);          // бетонная площадка
    else c.set('#4f6a34').lerp(new THREE.Color('#6a7a3a'), t * 0.8 + y * 0.03);
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
  // Трава/бетон реальной текстурой: цвет вершин задаёт, где газон, где площадка,
  // а карта даёт фактуру (иначе земля выглядит однотонным пластиком).
  const grass = tex('grass');
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
