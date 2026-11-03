// tools/lib/glb.mjs — чтение GLB в треугольники (мировые координаты документа) без браузера.
// Нужно предпросмотру вьюмодели и тестам: в песочнице нет chromium, но геометрию проверить надо.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

// ---------- математика матриц (строка = ось) ----------
const I = () => ({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], t: [0, 0, 0] });
const mul = (m, n) => ({
  a: [0, 1, 2].map(i => m.a[0] * n.a[i] + m.b[0] * n.b[i] + m.c[0] * n.c[i]),
  b: [0, 1, 2].map(i => m.a[1] * n.a[i] + m.b[1] * n.b[i] + m.c[1] * n.c[i]),
  c: [0, 1, 2].map(i => m.a[2] * n.a[i] + m.b[2] * n.b[i] + m.c[2] * n.c[i]),
  t: [0, 1, 2].map(i => m.a[i] * n.t[0] + m.b[i] * n.t[1] + m.c[i] * n.t[2] + m.t[i]),
});
const apply = (m, p) => [0, 1, 2].map(i => m.a[i] * p[0] + m.b[i] * p[1] + m.c[i] * p[2] + m.t[i]);
const T = (x, y, z) => ({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], t: [x, y, z] });
const S = s => ({ a: [s, 0, 0], b: [0, s, 0], c: [0, 0, s], t: [0, 0, 0] });
const RX = r => ({ a: [1, 0, 0], b: [0, Math.cos(r), Math.sin(r)], c: [0, -Math.sin(r), Math.cos(r)], t: [0, 0, 0] });
const RY = r => ({ a: [Math.cos(r), 0, -Math.sin(r)], b: [0, 1, 0], c: [Math.sin(r), 0, Math.cos(r)], t: [0, 0, 0] });
const RZ = r => ({ a: [Math.cos(r), Math.sin(r), 0], b: [-Math.sin(r), Math.cos(r), 0], c: [0, 0, 1], t: [0, 0, 0] });

/** Треугольники узла GLB в локальных координатах документа (без нормализации). */
function nodeTris(doc, filter) {
  const tris = [];
  const scene = doc.getRoot().listScenes()[0];
  const walk = (node, m, nm) => {
    const mm = node.getMatrix();
    let local;
    if (mm) local = { a: [mm[0], mm[1], mm[2]], b: [mm[4], mm[5], mm[6]], c: [mm[8], mm[9], mm[10]], t: [mm[12], mm[13], mm[14]] };
    else {
      const r = node.getRotation(), s = node.getScale();
      const [x, y, z, w] = r;
      const rot = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                   [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                   [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
      local = { a: rot[0].map(v => v * s[0]), b: rot[1].map(v => v * s[1]), c: rot[2].map(v => v * s[2]), t: node.getTranslation() };
    }
    const cur = mul(m, local);
    const name = node.getName();
    const mesh = node.getMesh?.();
    if (mesh && !(filter && filter.test(name))) for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), v = [0, 0, 0];
      const get = i => apply(cur, [pos.getElement(i, v)[0], v[1], v[2]]);
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        tris.push([get(idx ? idx.getScalar(i) : i), get(idx ? idx.getScalar(i + 1) : i + 1), get(idx ? idx.getScalar(i + 2) : i + 2)]);
      }
    }
    node.listChildren().forEach(c => walk(c, cur, name));
  };
  scene.listChildren().forEach(c => walk(c, I(), ''));
  return tris;
}


/** Нормализация как в AssetLibrary.make(): масштаб → поворот → смещение из манифеста. */
export function normalizeTris(tris, n) {
  return tris.map(t => t.map(p => apply(T(...n.offset), apply(S(n.scale), apply(RY(n.rotY), p)))));
}

export async function loadTris(file, exclude) {
  const doc = await io.read(file);
  const re = exclude && exclude.length ? new RegExp(exclude.join('|'), 'i') : null;
  return nodeTris(doc, re);
}

export function bounds(tris) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
  return { mn, mx, size: mx.map((v, i) => v - mn[i]) };
}
