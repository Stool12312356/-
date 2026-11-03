// РИГ: превращает GLB-модель бота в дерево THREE.Object3D (как GLTFLoader),
// чтобы прогнать по нему ту же анимацию (src/game/anim.ts) и отрендерить офлайн.
//
// Зачем: в песочнице нет браузера, а «боты стоят в T-позе» — это то, что видно глазами.
// Здесь поза собирается ровно как в игре: узлы с TRS + СКИННИНГ (у OPFOR-модели
// геометрия привязана к костям, без учёта скина она всегда рисуется в bind-позе,
// то есть в T-позе — на этом и была ошибка первой проверки).
import * as THREE from 'three';

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};

/**
 * @param doc документ gltf-transform (уже прочитанный)
 * @returns корень-группа: узлы повторяют GLB, у примитивов сохранены скин-данные
 */
export function buildRig(doc) {
  const root = new THREE.Group();
  root.name = 'rig';
  const byNode = new Map();          // gltf-узел → THREE.Object3D
  const prims = [];                  // примитивы для скиннинга

  const scene = doc.getRoot().listScenes()[0];
  const visit = (node, parent) => {
    const o = new THREE.Object3D();
    o.name = node.getName() || 'node';
    const t = node.getTranslation(), r = node.getRotation(), s = node.getScale();
    o.position.set(t[0], t[1], t[2]);
    o.quaternion.set(r[0], r[1], r[2], r[3]);
    o.scale.set(s[0], s[1], s[2]);
    parent.add(o);
    byNode.set(node, o);

    const mesh = node.getMesh();
    if (mesh) {
      const skin = node.getSkin();
      const joints = skin ? skin.listJoints().map(j => byNode.get(j) ?? null) : null;
      if (skin && joints.some(j => !j)) {
        // кости могут быть ещё не созданы (порядок обхода) — дочиним после обхода
        prims.push({ pending: skin, node: o, mesh });
      } else {
        for (const prim of mesh.listPrimitives()) prims.push({ node: o, prim, joints, skin });
      }
    }
    for (const child of node.listChildren()) visit(child, o);
  };
  for (const n of scene.listChildren()) visit(n, root);

  // второй проход: скины, у которых кости объявлены позже
  for (const p of prims) {
    if (!p.pending) continue;
    const joints = p.pending.listJoints().map(j => byNode.get(j) ?? null);
    const ibm = p.pending.getInverseBindMatrices();
    for (const prim of p.mesh.listPrimitives()) prims.push({ node: p.node, prim, joints, skin: p.pending });
  }
  const real = prims.filter(p => !p.pending);

  // скин-данные: позиции, суставы, веса, обратные бинд-матрицы
  for (const p of real) {
    const pos = p.prim.getAttribute('POSITION');
    const idx = p.prim.getIndices();
    p.pos = pos;
    p.idx = idx;
    const J = p.prim.getAttribute('JOINTS_0');
    const W = p.prim.getAttribute('WEIGHTS_0');
    p.skinned = !!(p.joints && J && W);
    if (p.skinned) {
      p.J = J; p.W = W;
      p.ibm = [];
      // обратные бинд-матрицы лежат в СКИНЕ (не в примитиве): без них скиннинг
      // растягивает конечности в «паутину» — на этом и была ошибка первого рендера
      const ibmAcc = p.skin?.getInverseBindMatrices();
      if (!ibmAcc) console.warn('скин без inverseBindMatrices — скиннинг будет неверным');
      else for (let i = 0; i < p.joints.length; i++) { const m = new Array(16); ibmAcc.getElement(i, m); p.ibm.push(m); }
    }
  }
  return { root, prims: real, byNode };
}

/** Углы/позиции треугольника в МИРОВЫХ координатах с учётом скиннинга. */
export function worldTris(rig) {
  rig.root.updateMatrixWorld(true);
  const out = [];
  // getElement из gltf-transform пишет в ЧИСЛОВОЙ массив: с THREE.Vector3 он молча
  // теряет значения (получаются нули — модель «исчезала» из рендера)
  const v = [0, 0, 0];
  // матрицы скиннинга: jointWorld × inverseBind (как в GLTFLoader)
  const skinCache = new Map();
  const skinMat = (p) => {
    if (skinCache.has(p)) return skinCache.get(p);
    const arr = p.joints.map((j, i) => {
      if (!j) return new THREE.Matrix4();
      const w = j.matrixWorld.clone();
      const m = new THREE.Matrix4();
      if (p.ibm && p.ibm[i]) m.fromArray(p.ibm[i]);
      return w.multiply(m);
    });
    skinCache.set(p, arr);
    return arr;
  };

  const at = (p, i) => {
    const j = p.idx ? p.idx.getScalar(i) : i;
    p.pos.getElement(j, v);
    if (!p.skinned) {
      const w = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(p.node.matrixWorld);
      return [w.x, w.y, w.z];
    }
    const jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
    p.J.getElement(j, jj); p.W.getElement(j, ww);
    const mats = skinMat(p);
    let x = 0, y = 0, z = 0, tot = 0;
    for (let k = 0; k < 4; k++) {
      const w = ww[k]; if (!w) continue;
      const m = mats[jj[k]]; if (!m) continue;
      const t = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(m);
      x += t.x * w; y += t.y * w; z += t.z * w; tot += w;
    }
    // вес не просуммировался (битые данные скина) — рисуем вершину как есть,
    // иначе она «прилипает» к началу координат и в кадре появляются длинные шипы
    if (!tot) {
      const w = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(p.node.matrixWorld);
      return [w.x, w.y, w.z];
    }
    return [x, y, z];
  };

  for (const p of rig.prims) {
    const count = p.idx ? p.idx.getCount() : p.pos.getCount();
    for (let i = 0; i + 2 < count; i += 3) out.push([at(p, i), at(p, i + 1), at(p, i + 2)]);
  }
  return out;
}
