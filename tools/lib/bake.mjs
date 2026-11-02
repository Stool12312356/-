// Запекание скина (bind pose) в обычную геометрию для статичных скинned-моделей без анимаций.
import { Accessor } from '@gltf-transform/core';
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
export function bakeSkins(doc) {
  const root = doc.getRoot(); if (root.listAnimations().length) return 0;
  const scene = root.listScenes()[0]; let n = 0;
  for (const node of root.listNodes()) {
    const skin = node.getSkin(), mesh = node.getMesh(); if (!skin || !mesh) continue;
    const joints = skin.listJoints(); const ibmAcc = skin.getInverseBindMatrices();
    const M = joints.map((j, i) => { const ibm = []; ibmAcc.getElement(i, ibm); return mul(j.getWorldMatrix(), ibm); });
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); if (!J || !W) continue;
      const v = [0, 0, 0], jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v); J.getElement(i, jj); W.getElement(i, ww);
        let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0; const nv = [0, 0, 0]; if (nor) nor.getElement(i, nv);
        for (let k = 0; k < 4; k++) { const w = ww[k]; if (!w) continue; const m = M[jj[k]];
          x += w * (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]); y += w * (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]); z += w * (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
          nx += w * (m[0] * nv[0] + m[4] * nv[1] + m[8] * nv[2]); ny += w * (m[1] * nv[0] + m[5] * nv[1] + m[9] * nv[2]); nz += w * (m[2] * nv[0] + m[6] * nv[1] + m[10] * nv[2]); }
        pos.setElement(i, [x, y, z]); if (nor) { const l = Math.hypot(nx, ny, nz) || 1; nor.setElement(i, [nx / l, ny / l, nz / l]); }
      }
      p.setAttribute('JOINTS_0', null); p.setAttribute('WEIGHTS_0', null);
    }
    node.setSkin(null); node.setTranslation([0, 0, 0]); node.setRotation([0, 0, 0, 1]); node.setScale([1, 1, 1]);
    node.getParentNode()?.removeChild(node); scene.addChild(node); n++;
  }
  return n;
}
