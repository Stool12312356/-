// Запекание скина в обычную геометрию для статичных скинned-моделей без анимаций.
// Зачем: у моделей со Sketchfab персональная поза живёт в скелете (поза узлов), а не в вершинах.
// Без анимаций такая модель в игре застынет в bind-позе (руки в стороны, ствол не там),
// поэтому позу узлов «впекаем» прямо в вершины и скин снимаем.
//
// По умолчанию (как в convert.mjs) вершины переводятся в мировые координаты по ТЕКУЩЕЙ позе узлов —
// так модель выглядит ровно как в просмотрщике Sketchfab. Именно это запекание должно идти ДО расчёта
// габаритов в build-manifest.mjs, иначе коллайдер считается по «раздетому» bind-позу и выходит огромным
// (реальный случай: low-poly_rpk → 5,3 × 19,6 × 1,04 м).
import { Accessor } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';

const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Мировая матрица узла в «ресной» позе (из TRS узлов, без анимации).
function restWorld(node, cache) {
  if (cache.has(node)) return cache.get(node);
  const t = node.getTranslation(), r = node.getRotation(), s = node.getScale();
  const local = new Matrix4().compose(new Vector3(t[0], t[1], t[2]), new Quaternion(r[0], r[1], r[2], r[3]), new Vector3(s[0], s[1], s[2])).toArray();
  const parent = node.getParentNode();
  const m = parent ? mul(restWorld(parent, cache), local) : local;
  cache.set(node, m);
  return m;
}

export function bakeSkins(doc, { restPose = true } = {}) {
  const root = doc.getRoot(); if (root.listAnimations().length) return 0;
  const scene = root.listScenes()[0]; let n = 0;
  const cache = new Map();
  for (const node of root.listNodes()) {
    const skin = node.getSkin(), mesh = node.getMesh(); if (!skin || !mesh) continue;
    const joints = skin.listJoints(); const ibmAcc = skin.getInverseBindMatrices();
    // restPose: поза из TRS узлов (то, что видно в просмотрщике) — правильный вариант по умолчанию.
    // Иначе: чистая bind-поза (getWorldMatrix, т.е. с учётом покоя скелета) — может быть «T-позой».
    const world = j => restPose ? restWorld(j, cache) : j.getWorldMatrix();
    const M = joints.map((j, i) => { const ibm = []; ibmAcc.getElement(i, ibm); return mul(world(j), ibm); });
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); if (!J || !W) continue;
      const v = [0, 0, 0], jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v); J.getElement(i, jj); W.getElement(i, ww);
        let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0; const nv = [0, 0, 0]; if (nor) nor.getElement(i, nv);
        let wsum = 0;
        for (let k = 0; k < 4; k++) { const w = ww[k]; if (!w) continue; const m = M[jj[k]]; if (!m) continue; wsum += w;
          x += w * (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]); y += w * (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]); z += w * (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
          nx += w * (m[0] * nv[0] + m[4] * nv[1] + m[8] * nv[2]); ny += w * (m[1] * nv[0] + m[5] * nv[1] + m[9] * nv[2]); nz += w * (m[2] * nv[0] + m[6] * nv[1] + m[10] * nv[2]); }
        // Веса могут не суммироваться в 1 (битые скины) — тогда вершина «схлопнулась» бы в 0.
        if (wsum < 1e-4) { x = v[0]; y = v[1]; z = v[2]; }
        pos.setElement(i, [x, y, z]); if (nor) { const l = Math.hypot(nx, ny, nz) || 1; nor.setElement(i, [nx / l, ny / l, nz / l]); }
      }
      p.setAttribute('JOINTS_0', null); p.setAttribute('WEIGHTS_0', null);
    }
    node.setSkin(null); node.setTranslation([0, 0, 0]); node.setRotation([0, 0, 0, 1]); node.setScale([1, 1, 1]);
    node.getParentNode()?.removeChild(node); scene.addChild(node); n++;
  }
  if (n) { dropRig(root); cleanLightCam(root); }
  return n;
}

// После запекания кости больше ни на что не влияют: выкидываем пустые узлы скелета,
// чтобы не тащить в игру сотню невидимых нод (у персонажа их ~100).
function dropRig(root) {
  for (const node of [...root.listNodes()]) {
    if (node.getMesh() || node.getSkin()) continue;
    if (node.listChildren().length) continue;
    node.dispose();
  }
}
// В GLB со Sketchfab лежат Lamp и Camera — в игре они не нужны и добавляют шума в габариты/коллайдеры.
function cleanLightCam(root) {
  for (const node of [...root.listNodes()]) if (node.getCamera()) node.dispose();
  root.listExtensionsUsed().filter(e => /LIGHT/i.test(e.extensionName)).forEach(e => e.dispose());
}
export { Accessor };
