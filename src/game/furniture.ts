// Мебель для интерьеров домов: процедурная, из примитивов.
// Сливается по материалам в structure.ts — 250 предметов дают ~10 драу-коллов.
import * as THREE from 'three';

const MAT: Record<string, THREE.MeshStandardMaterial> = {};
function mat(key: string, color: string, rough = 0.92, metal = 0.02, extra?: THREE.MeshStandardMaterialParameters) {
  if (!MAT[key]) MAT[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  return MAT[key];
}

const FURN: Record<string, () => THREE.Group> = {
  bed: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 2.05), mat('wood', '#8a5a2b', 0.85)); b.position.y = 0.225; g.add(b); const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 1.9), mat('linen', '#d8d2c4', 0.95)); m.position.y = 0.56; g.add(m); const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.4), mat('linen2', '#c9c2b2')); p.position.set(0, 0.72, -0.75); g.add(p); return g; },
  table: () => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.2), mat('wood2', '#9a6a3a')); t.position.y = 0.72; g.add(t); for (const [x, z] of [[-0.32, -0.5], [0.32, -0.5], [-0.32, 0.5], [0.32, 0.5]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), mat('wood3', '#7a5028')); l.position.set(x, 0.35, z); g.add(l); } return g; },
  chair: () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), mat('wood2', '#9a6a3a')); s.position.y = 0.45; g.add(s); const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), mat('wood3', '#7a5028')); b.position.set(0, 0.7, -0.2); g.add(b); for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat('wood3', '#7a5028')); l.position.set(x, 0.22, z); g.add(l); } return g; },
  wardrobe: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.85, 1.1), mat('ward', '#6b4a2e', 0.7)); b.position.y = 0.925; g.add(b); return g; },
  sofa: () => { const g = new THREE.Group(); const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 2.1), mat('sofa', '#7a4a3a', 0.95)); seat.position.y = 0.3; g.add(seat); const back = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 2.1), mat('sofa', '#7a4a3a')); back.position.set(-0.34, 0.62, 0); g.add(back); return g; },
  shelf: () => { const g = new THREE.Group(); const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.9, 0.05), mat('wood3', '#7a5028')); back.position.set(0, 0.95, -0.12); g.add(back); for (let i = 0; i < 4; i++) { const sh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.3), mat('wood2', '#9a6a3a')); sh.position.set(0, 0.3 + i * 0.5, 0); g.add(sh); } return g; },
  // Телевизор. Раньше это была тёмная коробка 0.5×0.42 на низкой тумбе — на скриншоте
  // игрока она читалась как «посторонний чёрный куб», висящий у стены. Теперь это
  // телевизор узнаваемой формы: панель с экраном, подставка и тумба под ним.
  tv: () => {
    const g = new THREE.Group();
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 0.42), mat('wood3', '#6b4a2e'));
    cabinet.position.y = 0.225; g.add(cabinet);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.52, 0.07), mat('tvbody', '#23211f', 0.5));
    frame.position.set(0, 0.74, 0); g.add(frame);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.44, 0.02),
      mat('tvglass', '#1b2733', 0.25, 0.1, { emissive: new THREE.Color('#12202c'), emissiveIntensity: 0.5 }));
    screen.position.set(0, 0.74, 0.045); g.add(screen);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.2), mat('tvbody', '#23211f', 0.5));
    foot.position.set(0, 0.475, 0); g.add(foot);
    return g;
  },
  fridge: () => { const g = new THREE.Group(); const f = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.7, 0.65), mat('fridge', '#d8d8d0', 0.5, 0.15)); f.position.y = 0.85; g.add(f); return g; },
  carpet: () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 1.8), mat('carpet', '#7a3a3a', 1)); g.add(c); return g; },
  lamp: () => { const g = new THREE.Group(); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6), mat('metal2', '#444', 0.4, 0.6)); rod.position.y = 0.2; g.add(rod); const sh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.22, 10, 1, true), mat('lamp', '#e8dfc8', 0.9, 0, { side: THREE.DoubleSide })); sh.position.y = -0.02; g.add(sh); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat('bulb', '#fff2c0', 0.4, 0, { emissive: new THREE.Color('#ffe8a0'), emissiveIntensity: 1.8 })); bulb.position.y = -0.08; g.add(bulb); return g; },
};
export function buildFurniture(kind: string): THREE.Group | null {
  const f = FURN[kind] ?? EXTRA[kind];
  return f ? f() : null;
}
export const FURNITURE_KINDS = Object.keys(FURN);

/**
 * Мебель, которой не хватало для планировки: кухонный гарнитур, унитаз, ванна, мойка.
 * Раньше на плане эти комнаты «затыкали» обычными шкафами — выглядело как склад.
 */
const M = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.05 });
const EXTRA: Record<string, () => THREE.Group> = {
  kitchen: () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 0.55), M('#c9c3b2'));
    body.position.y = 0.425; g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 0.6), M('#8d8a85'));
    top.position.y = 0.88; g.add(top);
    for (let i = 0; i < 4; i++) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.04), M('#b8b2a2'));
      door.position.set(-0.82 + i * 0.55, 0.45, 0.29); g.add(door);
    }
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.4), M('#9aa0a6'));
    hood.position.set(0.3, 1.75, 0.1); g.add(hood);
    g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return g;
  },
  toilet: () => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.5), M('#e8e8e6'));
    base.position.y = 0.2; g.add(base);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 14), M('#f2f2f0'));
    seat.position.y = 0.43; g.add(seat);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.18), M('#e2e2e0'));
    tank.position.set(0, 0.65, -0.18); g.add(tank);
    g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
    return g;
  },
  bath: () => {
    const g = new THREE.Group();
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 0.75), M('#eef0f2'));
    tub.position.y = 0.275; g.add(tub);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.58), M('#cfd6dc'));
    inner.position.y = 0.42; g.add(inner);
    g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
    return g;
  },
  sink: () => {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.42), M('#f0f2f4'));
    bowl.position.y = 0.82; g.add(bowl);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), M('#b9c0c6'));
    tap.position.set(0, 1.0, -0.16); g.add(tap);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.16), M('#e6e8ea'));
    ped.position.y = 0.39; g.add(ped);
    return g;
  },
};
