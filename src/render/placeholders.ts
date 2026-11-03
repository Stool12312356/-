// Процедурные low-poly заглушки. КАЖДЫЙ предмет имеет СВОЮ геометрию (по builder + params из catalog.json).
// Каноническая ориентация: перед = -Z, низ техники/пропсов на y=0, оружие центрировано.
import * as THREE from 'three';

type P = Record<string, any>;
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (c: string, rough = 0.85, metal = 0.1) => {
  const k = c + rough + metal;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, flatShading: true }));
  return matCache.get(k)!;
};
const add = (g: THREE.Object3D, m: THREE.Mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = true; g.add(m); return m;
};
const box = (w: number, h: number, d: number, c: string, r = 0.85, mt = 0.1) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, r, mt));
const cyl = (rt: number, rb: number, h: number, c: string, seg = 12, r = 0.8, mt = 0.2) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c, r, mt));
const sph = (r: number, c: string, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(c)); m.scale.set(sx, sy, sz); return m; };
const X = Math.PI / 2;
const METAL = '#2b2d2f', WOOD = '#8a5a2b', PLUM = '#6a2f2a', OLIVE = '#4d5a36', CONCRETE = '#9a9a92';

function wheel(r: number, w: number) { const m = cyl(r, r, w, '#1b1b1b', 16, 0.95, 0); m.rotation.z = X; return m; }

const B: Record<string, (p: P) => THREE.Group> = {
  rifle(p) {
    const g = new THREE.Group(); const L = p.len ?? 0.9; const st = p.stock;
    add(g, box(0.045, 0.07, L * 0.34, METAL), 0, 0, -L * 0.02);
    add(g, cyl(0.009, 0.009, L * 0.42, '#111', 8), 0, 0.012, -L * 0.4, X);
    add(g, box(0.04, 0.045, L * 0.25, st === 'wood' ? WOOD : st === 'plum' ? PLUM : '#222'), 0, -0.005, -L * 0.22);
    add(g, box(0.02, 0.03, 0.05, '#111'), 0, 0.045, -L * 0.5);
    if (st !== 'folded') add(g, box(0.035, 0.09, L * 0.22, st === 'skeleton' ? '#222' : st === 'wood' ? WOOD : PLUM), 0, -0.02, L * 0.32, -0.15);
    else add(g, box(0.01, 0.07, L * 0.25, '#222'), 0.03, 0, L * 0.3);
    add(g, box(0.03, 0.09, 0.035, '#222'), 0, -0.075, L * 0.08, 0.35);
    if (p.mag === 'curved') add(g, box(0.03, 0.17, 0.05, '#c28a2a'), 0, -0.12, -L * 0.07, 0.35);
    else add(g, box(0.03, 0.1, 0.05, '#222'), 0, -0.085, -L * 0.03);
    if (p.scope) add(g, cyl(0.02, 0.02, 0.28, '#111', 10), 0, 0.075, -0.02, X);
    return g;
  },
  mg(p) {
    const g = B.rifle({ ...p, mag: 'none', stock: 'wood' });
    add(g, cyl(0.014, 0.014, p.len * 0.42, '#111', 8), 0, 0.012, -p.len * 0.4, X);
    add(g, box(0.1, 0.1, 0.12, p.belt ? '#4d5a36' : '#222'), 0, -0.1, 0);
    add(g, cyl(0.004, 0.004, 0.25, '#111', 6), -0.04, -0.07, -p.len * 0.45, 0.4, 0, 0.3);
    add(g, cyl(0.004, 0.004, 0.25, '#111', 6), 0.04, -0.07, -p.len * 0.45, 0.4, 0, -0.3);
    return g;
  },
  launcher(p) {
    const g = new THREE.Group(); const L = p.len ?? 1;
    add(g, cyl(0.04, 0.04, L, OLIVE, 12), 0, 0, 0, X);
    if (p.warhead) add(g, new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 10), mat('#3a4a2a')), 0, 0, -L / 2 - 0.08, -X);
    add(g, box(0.03, 0.08, 0.04, '#222'), 0, -0.07, 0.05);
    if (p.tripod) for (const s of [-1, 0, 1]) add(g, cyl(0.012, 0.012, 0.9, '#222', 6), s * 0.3, -0.4, 0.1, 0, 0, s * 0.5);
    return g;
  },
  pistol() { const g = new THREE.Group(); add(g, box(0.03, 0.04, 0.16, METAL)); add(g, box(0.028, 0.1, 0.04, '#222'), 0, -0.06, 0.05, 0.2); return g; },
  grenade(p) { const g = new THREE.Group(); const m = sph(0.035, p.shape === 'ribbed' ? '#5a6a30' : '#3a4a2a', 1, p.shape === 'egg' ? 1.25 : 1.1, 1); add(g, m); add(g, cyl(0.012, 0.012, 0.03, '#999', 8), 0, 0.05, 0); return g; },
  brick() { const g = new THREE.Group(); add(g, box(0.2, 0.05, 0.1, '#d8d0b0')); add(g, box(0.04, 0.02, 0.04, '#c22'), 0, 0.035, 0); return g; },
  claymore() { const g = new THREE.Group(); add(g, box(0.22, 0.13, 0.06, OLIVE)); for (const s of [-1, 1]) add(g, cyl(0.004, 0.004, 0.1, '#111', 5), s * 0.07, -0.1, 0.02, 0, 0, s * 0.3); return g; },
  mine() { const g = new THREE.Group(); add(g, cyl(0.16, 0.16, 0.1, '#3a3a2a', 20)); add(g, cyl(0.03, 0.03, 0.04, '#888', 10), 0, 0.07, 0); return g; },
  crate(p) {
    const g = new THREE.Group(); const [w, h, d] = p.size ?? [0.5, 0.3, 0.3];
    add(g, box(w, h, d, p.color ?? '#777'), 0, h / 2, 0);
    if (p.cross) { add(g, box(w * 0.5, h * 0.2, 0.004, '#c00'), 0, h / 2, d / 2 + 0.003); add(g, box(w * 0.14, h * 0.6, 0.004, '#c00'), 0, h / 2, d / 2 + 0.003); }
    else add(g, box(w * 1.02, h * 0.1, d * 1.02, '#3a2a15'), 0, h * 0.9, 0);
    return g;
  },
  drone() { const g = new THREE.Group(); add(g, box(0.18, 0.05, 0.18, '#222')); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { add(g, cyl(0.005, 0.005, 0.2, '#444', 4), x * 0.1, 0, z * 0.1, 0, 0, X); add(g, cyl(0.07, 0.07, 0.005, '#999', 14), x * 0.2, 0.03, z * 0.2); } return g; },

  wheeled(p) {
    const g = new THREE.Group(); const { len: L, w: W, h: H, wheels: n } = p as { len: number; w: number; h: number; wheels: number };
    const r = Math.min(0.55, H * 0.2), body = p.body;
    const col = body === 'apc' ? '#4f5a40' : body === 'jeep' ? '#5a6a3a' : body === 'truck' ? '#55603e' : body === 'bus' ? '#d8a020' : body === 'sedan' ? (L > 4.3 ? '#1e1e22' : '#b04030') : '#777';
    const rows = n / 2;
    for (let i = 0; i < rows; i++) {
      const z = -L / 2 + L * 0.14 + (L * 0.72) * (rows === 1 ? 0 : i / (rows - 1));
      for (const s of [-1, 1]) add(g, wheel(r, 0.25), s * (W / 2 - 0.12), r, z);
    }
    const ch = r * 0.8;
    if (body === 'apc') { add(g, box(W * 0.92, H * 0.5, L, col), 0, r + H * 0.28, 0); add(g, box(W * 0.8, H * 0.2, L * 0.4, col), 0, r + H * 0.62, -L * 0.3, 0.12); add(g, cyl(W * 0.28, W * 0.3, H * 0.2, col, 10), 0, r + H * 0.72, L * 0.05); add(g, cyl(0.04, 0.04, L * 0.3, '#222', 8), 0, r + H * 0.74, -L * 0.2, X); }
    else if (body === 'jeep') { add(g, box(W, H * 0.3, L, col), 0, r + 0.2, 0); add(g, box(W * 0.95, H * 0.3, L * 0.5, col), 0, r + H * 0.5, L * 0.12); add(g, box(W * 0.9, 0.05, L * 0.5, '#2a3320'), 0, r + H * 0.68, L * 0.12); }
    else if (body === 'sedan') { add(g, box(W, H * 0.35, L, col), 0, r + 0.15, 0); add(g, box(W * 0.9, H * 0.3, L * 0.5, col), 0, r + H * 0.5, L * 0.05); add(g, box(W * 0.85, 0.02, L * 0.42, '#334'), 0, r + H * 0.5, L * 0.05); }
    else if (body === 'bus') { add(g, box(W, H - r, L, col), 0, r + (H - r) / 2, 0); add(g, box(W * 1.01, 0.5, L * 0.9, '#223'), 0, r + (H - r) * 0.65, 0); }
    else { add(g, box(W * 0.95, H * 0.45, L * 0.28, col), 0, r + H * 0.4, -L * 0.36); add(g, box(W * 0.92, 0.4, L * 0.62, '#6a4a2a'), 0, r + 0.55, L * 0.17); add(g, box(W * 0.95, 0.12, L * 0.66, col), 0, r + 0.3, L * 0.17); if (body === 'truck' && L > 6.5) add(g, box(W * 0.95, H * 0.5, L * 0.6, '#6a7a4a'), 0, r + 1.1, L * 0.17); }
    return g;
  },
  tracked(p) {
    const g = new THREE.Group(); const { len: L, w: W, h: H } = p as any;
    for (const s of [-1, 1]) add(g, box(0.5, H * 0.35, L, '#222'), s * (W / 2 - 0.25), H * 0.2, 0);
    add(g, box(W * 0.8, H * 0.35, L * 0.92, '#55603e'), 0, H * 0.4, 0);
    add(g, box(W * 0.7, H * 0.35, L * 0.4, '#55603e'), 0, H * 0.75, L * 0.1);
    for (const s of [-1, 1, -0.4, 0.4]) add(g, cyl(0.04, 0.04, L * 0.28, '#222', 8), s * W * 0.12, H * 0.8, -L * 0.2, X);
    return g;
  },
  bike() { const g = new THREE.Group(); add(g, wheel(0.35, 0.12), 0, 0.35, -0.9); add(g, wheel(0.35, 0.12), 0, 0.35, 0.8); add(g, box(0.3, 0.3, 1.2, '#4d5a36'), 0, 0.7, 0); add(g, wheel(0.33, 0.12), 0.95, 0.33, 0.1); add(g, box(0.55, 0.35, 1.2, '#4d5a36'), 0.95, 0.65, 0.1); return g; },
  heli(p) {
    const g = new THREE.Group(); const L = p.len;
    add(g, sph(1, '#556040', 1, 1.1, L * 0.2), 0, 2, 0); add(g, box(0.5, 0.6, L * 0.5, '#556040'), 0, 2.4, L * 0.35);
    add(g, cyl(0.1, 0.1, 2, '#333', 8), 0, 3.4, 0); add(g, box(p.rotor, 0.04, 0.35, '#222'), 0, 3.5, 0); add(g, box(0.35, 0.04, p.rotor, '#222'), 0, 3.5, 0);
    for (const s of [-1, 1]) add(g, cyl(0.07, 0.07, L * 0.4, '#333', 6), s * 1.2, 0.5, 0, X);
    return g;
  },
  jet() {
    const g = new THREE.Group(); add(g, cyl(0.7, 0.4, 13, '#667058', 12), 0, 2.2, 0, X); add(g, new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6, 12), mat('#667058')), 0, 2.2, -7.2, -X);
    add(g, box(14.4, 0.12, 2.8, '#667058'), 0, 2.2, 0.8); add(g, box(5, 0.1, 1.8, '#667058'), 0, 2.4, 5.6); add(g, box(0.12, 2.2, 2, '#667058'), 0, 3.4, 5.5);
    for (const s of [-1, 1]) add(g, cyl(0.45, 0.4, 3.4, '#444', 10), s * 1.0, 2.0, 3.5, X); return g;
  },
  boat(p) {
    const g = new THREE.Group(); const L = p.len, W = p.w;
    if (p.round) { const t = new THREE.Mesh(new THREE.TorusGeometry(W / 2, 0.22, 8, 20), mat('#e0a030')); t.scale.set(1, L / W, 1); t.rotation.x = X; t.position.y = 0.25; t.castShadow = true; g.add(t); }
    else { add(g, box(W, 0.9, L * 0.75, '#6a7a8a'), 0, 0.5, L * 0.1); add(g, new THREE.Mesh(new THREE.ConeGeometry(W * 0.7, L * 0.3, 4), mat('#6a7a8a')), 0, 0.5, -L * 0.42, -X, 0, 0).scale.set(1, 1, 0.6); add(g, box(W * 0.7, 0.8, L * 0.25, '#889'), 0, 1.3, 0.1 * L); }
    return g;
  },
  humanoid(p) {
    const g = new THREE.Group(); const c = p.color ?? '#5a6a3a';
    add(g, box(0.4, 0.6, 0.22, c), 0, 1.2, 0); add(g, sph(0.11, '#d8b090'), 0, 1.65, 0); add(g, sph(0.125, '#3a4a2a', 1, 0.7, 1), 0, 1.72, 0);
    for (const s of [-1, 1]) { add(g, box(0.16, 0.9, 0.18, '#3a4430'), s * 0.11, 0.45, 0); add(g, box(0.1, 0.55, 0.1, c), s * 0.27, 1.2, -0.05, -0.5); }
    return g;
  },
  panel(p) {
    const g = new THREE.Group(); const { floors: F, sections: S, secW: SW, depth: D } = p; const fh = 2.8, W = S * SW, H = F * fh;
    add(g, box(W, H, D, '#b9b5a8', 0.95, 0), 0, H / 2, 0);
    add(g, box(W + 0.3, 0.4, D + 0.3, '#6a6a68'), 0, H + 0.2, 0);
    const win = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 1.4, 0.1), mat('#1b2a3a', 0.2, 0.3), F * S * 2 * 2);
    const m4 = new THREE.Matrix4(); let k = 0;
    for (let f = 0; f < F; f++) for (let s = 0; s < S; s++) for (const w of [-1, 1]) for (const side of [1, -1]) { m4.makeTranslation(-W / 2 + SW * (s + 0.5) + w * SW * 0.22, f * fh + 1.6, side * (D / 2 + 0.02)); win.setMatrixAt(k++, m4); }
    g.add(win);
    for (let s = 0; s < S; s++) add(g, box(1.6, 2.2, 0.15, '#4a3a2a'), -W / 2 + SW * (s + 0.5), 1.1, D / 2 + 0.05);
    return g;
  },
  garage() { const g = new THREE.Group(); add(g, box(3, 2.3, 5.5, '#6a7080', 0.6, 0.5), 0, 1.15, 0); add(g, box(2.6, 2.0, 0.08, '#8a5a2a'), 0, 1.0, 2.78); return g; },
  kiosk() { const g = new THREE.Group(); const b = box(2.5, 2.6, 2, '#7a8a9a'); add(g, b, 0, 1.3, 0); add(g, box(2.2, 0.8, 0.05, '#88b'), 0, 1.6, 1.02); add(g, box(2.9, 0.12, 2.4, '#445'), 0, 2.7, 0); return g; },
  busstop() { const g = new THREE.Group(); add(g, box(4, 0.1, 1.6, '#d8d8d0'), 0, 2.4, 0); for (const s of [-1, 1]) add(g, box(0.1, 2.4, 1.5, '#8a8a82'), s * 1.9, 1.2, 0); add(g, box(3.8, 2.0, 0.08, '#667'), 0, 1.3, -0.75); add(g, box(2.5, 0.08, 0.5, '#6a4a2a'), 0, 0.5, -0.4); return g; },
  monument() { const g = new THREE.Group(); add(g, box(4, 4, 4, '#777770'), 0, 2, 0); add(g, box(1.2, 5, 0.8, '#3a3a38'), 0, 6.5, 0); add(g, sph(0.4, '#3a3a38'), 0, 9.3, 0); add(g, box(0.4, 0.4, 3, '#3a3a38'), 0.5, 8, -1, 0.3); return g; },
  swing() { const g = new THREE.Group(); for (const s of [-1, 1]) { add(g, cyl(0.04, 0.04, 2.6, '#b03030', 6), s * 1.2, 1.2, 0.6, 0.3); add(g, cyl(0.04, 0.04, 2.6, '#b03030', 6), s * 1.2, 1.2, -0.6, -0.3); } add(g, cyl(0.04, 0.04, 2.6, '#b03030', 6), 0, 2.3, 0, 0, 0, X); add(g, box(0.4, 0.05, 0.2, '#2a4a8a'), 0, 0.55, 0); return g; },
  // ЗИМА: ёлки в снегу (тёмно-зелёные лапы + белые шапки), лиственные — голые
  // ветки с наледью. Раньше на снегу стояли летние зелёные кроны.
  tree(p) {
    const g = new THREE.Group();
    if (p.type === 'spruce') {
      add(g, cyl(0.15, 0.2, 1.5, '#4a3a2a', 6), 0, 0.75, 0);
      for (let i = 0; i < 4; i++) {
        const r = 1.8 - i * 0.35;
        add(g, new THREE.Mesh(new THREE.ConeGeometry(r, 2.2, 8), mat('#25453a')), 0, 2 + i * 1.3, 0);
        add(g, new THREE.Mesh(new THREE.ConeGeometry(r * 0.82, 0.9, 8), mat('#e8f1f7', 0.9)), 0, 2 + i * 1.3 + 0.75, 0);
      }
    } else {
      add(g, cyl(0.12, 0.2, 5, '#5a4a3a', 6), 0, 2.5, 0);
      // голая крона: несколько тонких веток и снежные шапки на них
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(g, cyl(0.03, 0.06, 2.4, '#5f5148', 5), Math.cos(a) * 0.7, 6 + (i % 2) * 0.5, Math.sin(a) * 0.7, 0.5 * Math.cos(a), 0, 0.5 * Math.sin(a));
        add(g, sph(0.55, '#e8f1f7', 1, 0.55, 1), Math.cos(a) * 1.2, 6.9 + (i % 2) * 0.5, Math.sin(a) * 1.2);
      }
      add(g, sph(0.9, '#e8f1f7', 1, 0.5, 1), 0, 7.6, 0);
    }
    return g;
  },
  barrel() { const g = new THREE.Group(); add(g, cyl(0.29, 0.29, 0.88, '#8a2a1a', 14), 0, 0.44, 0); add(g, cyl(0.3, 0.3, 0.04, '#555', 14), 0, 0.5, 0); return g; },

  // Прицелы и планки. Труба оптики + кронштейн, боковая планка — пластина с пазами.
  scope(p) {
    const g = new THREE.Group();
    const rail = p.rail === true;         // только планка, без оптики
    if (rail) {
      add(g, box(0.05, 0.02, 0.22, '#3a3a3a', 0.5, 0.6));
      for (let i = 0; i < 5; i++) add(g, box(0.055, 0.012, 0.015, '#222', 0.4, 0.7), 0, 0.016, -0.08 + i * 0.04);
      return g;
    }
    const fast = p.side === true;         // боковой кронштейн «ласточкин хвост»
    const L = p.len ?? 0.26;
    add(g, cyl(0.021, 0.021, L, '#1a1a1c', 14), 0, 0, 0, X);
    for (const s of [-1, 1]) add(g, cyl(0.026, 0.026, 0.012, '#111', 14), 0, 0, s * L * 0.42, X);
    add(g, box(0.03, 0.035, 0.05, '#2a2a2a'), 0, -0.033, fast ? -0.05 : 0);
    if (fast) add(g, box(0.026, 0.05, 0.12, '#333', 0.5, 0.6), -0.035, -0.05, 0);
    if (p.holo) add(g, box(0.035, 0.045, 0.06, '#222'), 0, 0.033, 0);
    return g;
  },
};

export function buildPlaceholder(spec: { builder: string; p: P }): THREE.Group {
  const f = B[spec.builder];
  if (!f) throw new Error('Нет builder заглушки: ' + spec.builder);
  const g = f(spec.p ?? {}); g.userData.placeholder = true; return g;
}
export const PLACEHOLDER_BUILDERS = Object.keys(B);
