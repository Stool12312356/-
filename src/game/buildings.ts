// Процедурные советские панельки: хрущёвка (5 эт.) и брежневка (9 эт.).
// Моделей зданий пользователь не даёт намеренно: нужна разрушаемость и интерьер,
// а готовый GLB — это монолит, внутри которого ничего нет.
//
// M3: здание собирается из ВОКСЕЛЕЙ (см. voxel.ts). Генератор выдаёт набор блоков:
//  - стены — блоки 0.45 × 0.45 × толщина стены (мелкие: важны для геймплея);
//  - перекрытия и крыша — блоки 1.0 × 0.3 × 1.0 (крупнее: их 1500 штук, мельче нельзя по FPS);
//  - проёмы (окна/двери) — это просто отсутствующие блоки, дыр в геометрии не остаётся;
//  - несущие стены помечены bearing — обвал секции считается по ним.
import * as THREE from 'three';
import type { Surface } from '../shared/types';
import type { VoxelWall } from './voxel';

export interface BuildOpts {
  kind: 'khrushchevka' | 'brezhnevka';
  sections?: number;
  floors?: number;
  seed?: number;
}

export interface WindowBox {
  pos: [number, number, number]; size: [number, number, number]; rotY: number; section: number; floor: number;
}

export interface InteriorProp {
  kind: 'bed' | 'table' | 'chair' | 'wardrobe' | 'sofa' | 'shelf' | 'tv' | 'carpet' | 'fridge' | 'lamp';
  pos: [number, number, number];
  rotY: number;
  section: number;
  floor: number;
}

export interface BuildingSpec {
  kind: string;
  name: string;
  size: [number, number, number];
  floors: number;
  sections: number;
  walls: VoxelWall[];
  windows: WindowBox[];
  props: InteriorProp[];
  /** статистика для тестов/логов */
  voxels: { walls: number; slabs: number };
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const TYPES = {
  khrushchevka: { floors: 5, floorH: 2.8, sectionW: 12.6, depth: 12.0, name: 'Хрущёвка (5 эт., разрушаемая)' },
  brezhnevka: { floors: 9, floorH: 2.9, sectionW: 13.2, depth: 12.6, name: 'Брежневка (9 эт., разрушаемая)' },
} as const;

// Размер вокселя стены и перекрытия.
// Это ПАНЕЛЬНЫЙ дом: кирпич 1.4 × 0.7 м — ровно шаг реальной панели. Мельче нельзя:
// при 0.45 м на дом выходило 26 000 блоков (физика и FPS умирали), а пробоину
// размером с дверь всё равно даёт один залп РПГ (радиус 2.6 м).
const VX = 1.4;
const VY = 0.7;
const SLAB = 2.5;

export function buildBuilding(opts: BuildOpts): BuildingSpec {
  const T = TYPES[opts.kind];
  const floors = opts.floors ?? T.floors;
  const sections = opts.sections ?? 3;
  const rnd = rng(opts.seed ?? (opts.kind === 'khrushchevka' ? 1971 : 1982));

  const secW = T.sectionW, D = T.depth, floorH = T.floorH;
  const W = secW * sections, H = floors * floorH;
  const HX = W / 2, HZ = D / 2;
  const wallT = 0.32;
  const innerT = 0.18;

  const walls: VoxelWall[] = [];
  const windows: WindowBox[] = [];
  const props: InteriorProp[] = [];
  let wallCells = 0, slabCells = 0;

  /**
   * Кладёт стену из вокселей. Координаты — мировые, дом ещё не сдвинут
   * (сдвиг делает VoxelBuilding через group.position, но физика хочет мировые —
   * поэтому генератор работает в локальных координатах дома, а VoxelBuilding
   * вычитает origin при сборке коллайдеров).
   */
  const addWall = (
    x0: number, z0: number, x1: number, z1: number, y: number, h: number,
    material: Surface, bearing: boolean, section: number, floor: number,
    thick = wallT, opts2: { skip?: (cx: number, cz: number, cy: number) => boolean; column?: boolean } = {},
  ) => {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const along = Math.abs(dx) >= Math.abs(dz);
    const nx = Math.max(1, Math.round(len / VX));
    const ny = Math.max(1, Math.round(h / VY));
    const cw = len / nx, ch = h / ny;
    const rotY = along ? 0 : Math.PI / 2;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const t = (i + 0.5) / nx;
        const cx = x0 + dx * t, cz = z0 + dz * t;
        const cy = y + (j + 0.5) * ch;
        if (opts2.skip?.(cx, cz, cy)) continue;
        walls.push({
          pos: [cx, cy, cz],
          size: along ? [cw, ch, thick] : [thick, ch, cw],
          rotY, material, bearing, section, floor,
          column: opts2.column === true,
        });
        wallCells++;
      }
    }
  };

  /** перекрытие/крыша: крупные блоки */
  const addSlab = (x0: number, z0: number, x1: number, z1: number, y: number, thick: number, material: Surface, section: number, floor: number) => {
    const nx = Math.max(1, Math.round((x1 - x0) / SLAB));
    const nz = Math.max(1, Math.round((z1 - z0) / SLAB));
    const cw = (x1 - x0) / nx, cd = (z1 - z0) / nz;
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      walls.push({
        pos: [x0 + (i + 0.5) * cw, y, z0 + (k + 0.5) * cd],
        size: [cw, thick, cd], rotY: 0, material, bearing: false, section, floor,
      });
      slabCells++;
    }
  };

  /** окно: вырезаем воксели в проёме, но оставляем подоконник и перемычку */
  const openWindow = (cx: number, cz: number, along: boolean, wWidth: number, isDoor: boolean) => {
    const halfW = wWidth / 2;
    const sill = isDoor ? 0 : 0.85;
    const top = isDoor ? 2.1 : 2.05;   // окно до 2.05 от пола этажа
    return (px: number, pz: number, py: number) => {
      const alongPos = along ? px : pz;
      const centerPos = along ? cx : cz;
      const across = along ? pz : px;
      const plane = along ? cz : cx;
      if (Math.abs(across - plane) > 0.5) return false;
      if (Math.abs(alongPos - centerPos) > halfW) return false;
      return py > sill && py < top;
    };
  };

  for (let s = 0; s < sections; s++) {
    const sx0 = -HX + s * secW, sx1 = sx0 + secW;
    const midX = (sx0 + sx1) / 2;
    for (let f = 0; f < floors; f++) {
      const y = f * floorH;
      // ---- фасад (-Z) и задняя стена (+Z) ----
      for (const [z, isFront] of [[-HZ, true], [HZ, false]] as const) {
        const cols = Math.max(1, Math.round(secW / 3.2));
        for (let c = 0; c < cols; c++) {
          const cx = sx0 + (c + 0.5) * (secW / cols);
          const isDoor = isFront && f === 0 && c === Math.floor(cols / 2);
          const hasWin = !isDoor && (c % 2 === 0 || !isFront) && !(isFront && f === 0);
          const skip = hasWin ? openWindow(cx, z, true, 2.1, false)
            : isDoor ? openWindow(cx, z, true, 1.1, true)
              : undefined;
          addWall(sx0, z, sx1, z, y, floorH, 'panel', true, s, f, wallT, { skip });
          if (hasWin) windows.push({ pos: [cx, y + 1.45, z], size: [0.06, 1.2, 2.0], rotY: 0, section: s, floor: f });
          if (isDoor) windows.push({ pos: [cx, y + 1.05, z], size: [0.06, 2.1, 1.1], rotY: 0, section: s, floor: f });
        }
      }
      // ---- торцевые стены ----
      if (s === 0) {
        addWall(-HX, -HZ + wallT, -HX, HZ - wallT, y, floorH, 'panel', true, s, f);
        addWall(-HX - 0.1, -HZ, -HX - 0.1, -HZ + 1.4, y, floorH, 'concrete', true, s, f, 0.5, { column: true });
        addWall(-HX - 0.1, HZ - 1.4, -HX - 0.1, HZ, y, floorH, 'concrete', true, s, f, 0.5, { column: true });
      }
      if (s === sections - 1) {
        addWall(HX, -HZ + wallT, HX, HZ - wallT, y, floorH, 'panel', true, s, f);
        addWall(HX + 0.1, -HZ, HX + 0.1, -HZ + 1.4, y, floorH, 'concrete', true, s, f, 0.5, { column: true });
        addWall(HX + 0.1, HZ - 1.4, HX + 0.1, HZ, y, floorH, 'concrete', true, s, f, 0.5, { column: true });
      }
      // ---- межсекционная стена (можно пробить) ----
      if (s > 0) addWall(sx0, -HZ + wallT, sx0, HZ - wallT, y, floorH, 'brick', false, s, f, innerT);
      // ---- несущий пояс по центру фасада (обрушение считается по нему) ----
      addWall(midX - 0.7, -HZ - wallT / 2, midX + 0.7, -HZ - wallT / 2, y, floorH, 'concrete', true, s, f, 0.5, { column: true });
    }
    // ---- перекрытия и крыша ----
    addSlab(sx0, -HZ, sx1, HZ, floors * floorH + 0.15, 0.3, 'concrete', s, floors); // крыша
    for (let f = 1; f <= floors; f++) addSlab(sx0, -HZ, sx1, HZ, f * floorH - 0.12, 0.24, 'concrete', s, f);

    // ---- интерьер квартир ----
    for (let f = 0; f < floors; f++) {
      const y = f * floorH;
      for (const side of [-1, 1]) {
        const qx = midX + side * secW * 0.25;
        const qw = secW * 0.42, qd = D * 0.7;
        const baseZ = D * 0.04;
        if (rnd() > 0.1) props.push({ kind: 'bed', pos: [qx + side * qw * 0.22, y, baseZ + qd * 0.3], rotY: side > 0 ? Math.PI : 0, section: s, floor: f });
        if (rnd() > 0.3) props.push({ kind: 'wardrobe', pos: [qx - side * qw * 0.3, y, baseZ + qd * 0.32], rotY: side > 0 ? 0 : Math.PI, section: s, floor: f });
        props.push({ kind: 'table', pos: [qx + side * qw * 0.12, y, baseZ - qd * 0.3], rotY: 0, section: s, floor: f });
        if (rnd() > 0.35) props.push({ kind: 'chair', pos: [qx + side * qw * 0.12 - 0.75, y, baseZ - qd * 0.3], rotY: Math.PI / 2, section: s, floor: f });
        if (rnd() > 0.5) props.push({ kind: 'chair', pos: [qx + side * qw * 0.12 + 0.75, y, baseZ - qd * 0.3], rotY: -Math.PI / 2, section: s, floor: f });
        if (f > 1 || rnd() > 0.35) props.push({ kind: 'sofa', pos: [qx - side * qw * 0.08, y, baseZ], rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2, section: s, floor: f });
        if (rnd() > 0.2) props.push({ kind: 'tv', pos: [qx + side * qw * 0.3, y, baseZ], rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2, section: s, floor: f });
        if (rnd() > 0.3) props.push({ kind: 'fridge', pos: [qx + side * qw * 0.34, y, baseZ - qd * 0.34], rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2, section: s, floor: f });
        if (rnd() > 0.45) props.push({ kind: 'shelf', pos: [qx - side * qw * 0.02, y, baseZ - qd * 0.4], rotY: 0, section: s, floor: f });
        if (rnd() > 0.25) props.push({ kind: 'carpet', pos: [qx, y + 0.01, baseZ + qd * 0.12], rotY: 0, section: s, floor: f });
        if (rnd() > 0.3) props.push({ kind: 'lamp', pos: [qx, y + floorH - 0.45, baseZ], rotY: 0, section: s, floor: f });
      }
    }
  }

  return {
    kind: opts.kind, name: T.name,
    size: [W, H, D], floors, sections,
    walls, windows, props,
    voxels: { walls: wallCells, slabs: slabCells },
  };
}

// ---------- визуал окон и мебели ----------

const MAT: Record<string, THREE.MeshStandardMaterial> = {};
function mat(key: string, color: string, rough = 0.92, metal = 0.02, extra?: THREE.MeshStandardMaterialParameters) {
  if (!MAT[key]) MAT[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  return MAT[key];
}

/** Стекло в проёмах: отдельные меши, их немного (окна на фасаде). */
export function buildWindows(spec: BuildingSpec): THREE.Group {
  const g = new THREE.Group();
  const glass = mat('win', '#8fb6cc', 0.15, 0.05, { transparent: true, opacity: 0.32, side: THREE.DoubleSide });
  const frame = mat('frame', '#e8e4dc', 0.8);
  for (const w of spec.windows) {
    const gm = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]), glass);
    gm.position.set(...w.pos); gm.rotation.y = w.rotY; g.add(gm);
    // рама: две вертикальные стойки и подоконник
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w.size[0] * 1.6, 0.06, w.size[2] + 0.12), frame);
    sill.position.set(w.pos[0], w.pos[1] - w.size[1] / 2, w.pos[2]); sill.rotation.y = w.rotY; g.add(sill);
  }
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
  return g;
}

const FURN: Record<string, () => THREE.Group> = {
  bed: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 2.05), mat('wood', '#8a5a2b', 0.85)); b.position.y = 0.225; g.add(b); const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 1.9), mat('linen', '#d8d2c4', 0.95)); m.position.y = 0.56; g.add(m); const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.4), mat('linen2', '#c9c2b2')); p.position.set(0, 0.72, -0.75); g.add(p); return g; },
  table: () => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.2), mat('wood2', '#9a6a3a')); t.position.y = 0.72; g.add(t); for (const [x, z] of [[-0.32, -0.5], [0.32, -0.5], [-0.32, 0.5], [0.32, 0.5]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), mat('wood3', '#7a5028')); l.position.set(x, 0.35, z); g.add(l); } return g; },
  chair: () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), mat('wood2', '#9a6a3a')); s.position.y = 0.45; g.add(s); const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), mat('wood3', '#7a5028')); b.position.set(0, 0.7, -0.2); g.add(b); for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat('wood3', '#7a5028')); l.position.set(x, 0.22, z); g.add(l); } return g; },
  wardrobe: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.85, 1.1), mat('ward', '#6b4a2e', 0.7)); b.position.y = 0.925; g.add(b); return g; },
  sofa: () => { const g = new THREE.Group(); const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 2.1), mat('sofa', '#7a4a3a', 0.95)); seat.position.y = 0.3; g.add(seat); const back = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 2.1), mat('sofa', '#7a4a3a')); back.position.set(-0.34, 0.62, 0); g.add(back); return g; },
  shelf: () => { const g = new THREE.Group(); const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.9, 0.05), mat('wood3', '#7a5028')); back.position.set(0, 0.95, -0.12); g.add(back); for (let i = 0; i < 4; i++) { const sh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.3), mat('wood2', '#9a6a3a')); sh.position.set(0, 0.3 + i * 0.5, 0); g.add(sh); } return g; },
  tv: () => { const g = new THREE.Group(); const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mat('wood3', '#6b4a2e')); st.position.y = 0.06; g.add(st); const tv = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.42), mat('tvbody', '#2a2826', 0.6)); tv.position.y = 0.65; g.add(tv); return g; },
  fridge: () => { const g = new THREE.Group(); const f = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.7, 0.65), mat('fridge', '#d8d8d0', 0.5, 0.15)); f.position.y = 0.85; g.add(f); return g; },
  carpet: () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 1.8), mat('carpet', '#7a3a3a', 1)); g.add(c); return g; },
  lamp: () => { const g = new THREE.Group(); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6), mat('metal2', '#444', 0.4, 0.6)); rod.position.y = 0.2; g.add(rod); const sh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.22, 10, 1, true), mat('lamp', '#e8dfc8', 0.9, 0, { side: THREE.DoubleSide })); sh.position.y = -0.02; g.add(sh); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat('bulb', '#fff2c0', 0.4, 0, { emissive: new THREE.Color('#ffe8a0'), emissiveIntensity: 1.8 })); bulb.position.y = -0.08; g.add(bulb); return g; },
};
export function buildFurniture(kind: string): THREE.Group | null { const f = FURN[kind]; return f ? f() : null; }
export const FURNITURE_KINDS = Object.keys(FURN);
