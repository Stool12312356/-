// Процедурные советские панельки: хрущёвка (5 эт.) и брежневка (9 эт.).
// Моделей зданий пользователь не даёт намеренно: нужна разрушаемость и интерьер,
// а готовый GLB — это монолит, внутри которого ничего нет.
//
// Как устроено:
//  - здание = сетка квартир, каждая квартира = коробка из 4 стен + пол/потолок + проёмы (двери/окна);
//  - стены режутся на панели (2-3 м), панель — отдельный статичный коллайдер с HP и материалом;
//  - по фасаду каждого этажа идёт несущая пояс-панель (большой HP, «колонна» из ТЗ);
//  - уничтожение панели -> она превращается в физические обломки, в стене остаётся дыра,
//    через которую можно пройти; когда несущих не осталось — здание складывается (макро-обрушение).
// Всё это НЕ подключено к физике напрямую: экспортируем чистое описание (панели + коробки),
// а навешивает его scene/damage-слой. Так же можно тестировать без браузера.
import * as THREE from 'three';

export type Material = 'concrete' | 'panel' | 'brick' | 'wood' | 'glass' | 'metal' | 'plaster';
export interface BuildOpts {
  /** id дома в манифесте: khrushchevka | brezhnevka */
  kind: 'khrushchevka' | 'brezhnevka';
  /** число секций (подъездов) */
  sections?: number;
  /** этажей; по умолчанию 5 / 9 */
  floors?: number;
  seed?: number;
}

export interface WallPanel {
  /** центр панели в мировых координатах */
  pos: [number, number, number];
  size: [number, number, number];
  rotY: number;
  material: Material;
  hp: number;
  /** несущая: обрушение секции считается по ним */
  loadBearing: boolean;
  /** секция (подъезд), к которой относится панель */
  section: number;
  floor: number;
}

export interface WindowBox {
  pos: [number, number, number]; size: [number, number, number]; rotY: number; section: number; floor: number;
}

export interface BuildingSpec {
  kind: string;
  name: string;
  /** полный габарит здания */
  size: [number, number, number];
  floors: number;
  sections: number;
  panels: WallPanel[];
  windows: WindowBox[];
  /** точки несущих панелей по секциям */
  loadBearingBySection: number[][];
  /** где стоит мебель/предметы интерьера */
  props: InteriorProp[];
  /** лестничные клетки (проёмы в перекрытиях) */
  stairs: { pos: [number, number, number]; section: number }[];
}

export interface InteriorProp {
  kind: 'bed' | 'table' | 'chair' | 'wardrobe' | 'sofa' | 'shelf' | 'tv' | 'carpet' | 'fridge' | 'lamp';
  pos: [number, number, number];
  rotY: number;
  size: [number, number, number];
  section: number;
  floor: number;
}

// --- детерминированный «случайный»: одинаковый дом при каждом запуске ---
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// HP подобраны под реальное ощущение: автомат прошивает панель за ~8 попаданий,
// РПГ сносит кусок стены целиком, несущую — с 1-2 попаданий.
const HP: Record<Material, number> = {
  concrete: 620, panel: 430, brick: 520, wood: 120, glass: 20, metal: 240, plaster: 90,
};

/** Размеры по типам домов. Всё в метрах, как в реальности. */
const TYPES = {
  khrushchevka: { floors: 5, floorH: 2.8, sectionW: 12.6, depth: 12.0, panelW: 2.6, name: 'Хрущёвка (5 эт., разрушаемая)' },
  brezhnevka: { floors: 9, floorH: 2.9, sectionW: 13.2, depth: 12.6, panelW: 2.9, name: 'Брежневка (9 эт., разрушаемая)' },
} as const;

/**
 * Строит описание дома. Начало координат — центр здания на уровне земли (y=0),
 * фасад смотрит в -Z (как остальные модели в проекте).
 */
export function buildBuilding(opts: BuildOpts): BuildingSpec {
  const T = TYPES[opts.kind];
  const floors = opts.floors ?? T.floors;
  const sections = opts.sections ?? 3;
  const rnd = rng(opts.seed ?? (opts.kind === 'khrushchevka' ? 1971 : 1982));

  const secW = T.sectionW, depth = T.depth, floorH = T.floorH;
  const W = secW * sections, D = depth, H = floors * floorH;
  const panels: WallPanel[] = [];
  const windows: WindowBox[] = [];
  const props: InteriorProp[] = [];
  const stairs: BuildingSpec['stairs'] = [];
  const loadBearingBySection: number[][] = Array.from({ length: sections }, () => []);

  const HX = W / 2, HZ = D / 2;
  const wallT = 0.32;      // толщина панели
  const innerT = 0.14;     // межкомнатная перегородка

  /** разрезает отрезок стены на равные панели и добавляет их */
  const addWall = (
    x0: number, z0: number, x1: number, z1: number, y: number, h: number,
    material: Material, loadBearing: boolean, section: number, floor: number,
    thick = wallT, targetW = T.panelW,
  ) => {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const n = Math.max(1, Math.round(len / targetW));
    const pl = len / n;
    const rotY = Math.atan2(dx, dz); // панель длиной по локальной оси Z
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cx = x0 + dx * t, cz = z0 + dz * t;
      panels.push({
        pos: [cx, y + h / 2, cz],
        size: [thick, h, pl],
        rotY, material, hp: HP[material] * (loadBearing ? 2.4 : 1),
        loadBearing, section, floor,
      });
      if (loadBearing) loadBearingBySection[section].push(panels.length - 1);
    }
  };

  /** окно/дверь: визуальная коробка (стекло и рама) + вырез в стене уже учтён разбиением */
  const addOpening = (
    x0: number, z0: number, x1: number, z1: number, y: number, h: number,
    section: number, floor: number, isDoor: boolean,
  ) => {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const rotY = Math.atan2(dx, dz);
    // окно: 2,1x1,5 на уровне груди; дверь: 0,9x2,05 от пола
    const ww = isDoor ? 0.95 : Math.min(2.1, len * 0.7);
    const wh = isDoor ? 2.05 : 1.5;
    const wy = isDoor ? y + wh / 2 : y + 1.35;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    windows.push({ pos: [cx, wy, cz], size: [0.08, wh, ww], rotY, section, floor });
  };

  // ---------- фасады ----------
  for (let s = 0; s < sections; s++) {
    const sx0 = -HX + s * secW, sx1 = sx0 + secW;
    for (let f = 0; f < floors; f++) {
      const y = f * floorH;
      // Этаж режем не «глухой» стеной, а поясом панелей с проёмами:
      // под окнами — низкая панель, над окнами — перемычка, между — простенки.
      // Для простоты и скорости физики: фасад = панели на всю высоту этажа,
      // но каждая вторая панель помечена проёмом и в физике имеет вырез (коробки),
      // поэтому игрок видит окна и может прострелить их.
      const front = -HZ, back = HZ;
      const colsOnSection = Math.max(1, Math.round(secW / T.panelW));
      for (let c = 0; c < colsOnSection; c++) {
        const px0 = sx0 + (c * secW) / colsOnSection, px1 = sx0 + ((c + 1) * secW) / colsOnSection;
        const hasWindow = (c % 2 === 0) && f > 0;         // первый этаж — без окон, там подъезд
        const isDoorEntrance = f === 0 && c === Math.floor(colsOnSection / 2);
        if (hasWindow || isDoorEntrance) {
          // панель с проёмом: низ (подоконник) + верх (перемычка) + два простенка по бокам
          const sillH = hasWindow ? 0.75 : (isDoorEntrance ? 0 : 2.05);
          const lintelH = hasWindow ? floorH - 0.75 - 1.5 : (isDoorEntrance ? floorH - 2.05 : floorH);
          const opW = hasWindow ? Math.min(2.0, (px1 - px0) * 0.72) : 1.6;
          const sideW = ((px1 - px0) - opW) / 2;
          const midX = (px0 + px1) / 2;
          // подоконная часть
          if (sillH > 0.02) panels.push({ pos: [midX, y + sillH / 2, front], size: [wallT, sillH, opW], rotY: 0, material: 'concrete', hp: HP.concrete * 0.6, loadBearing: false, section: s, floor: f });
          // перемычка
          if (lintelH > 0.02) panels.push({ pos: [midX, y + sillH + (hasWindow ? 1.5 : 2.05) + lintelH / 2, front], size: [wallT, lintelH, opW], rotY: 0, material: 'concrete', hp: HP.concrete * 0.6, loadBearing: false, section: s, floor: f });
          // простенки по бокам — вот они несущие
          if (sideW > 0.05) for (const sgn of [-1, 1]) {
            const cxp = midX + sgn * (opW / 2 + sideW / 2);
            panels.push({ pos: [cxp, y + floorH / 2, front], size: [wallT, floorH, sideW], rotY: 0, material: 'panel', hp: HP.panel * 2.2, loadBearing: true, section: s, floor: f });
            loadBearingBySection[s].push(panels.length - 1);
          }
          addOpening(px0, front, px1, front, y, floorH, s, f, isDoorEntrance);
        } else {
          // глухая панель на всю высоту этажа
          addWall(px0, front, px1, front, y, floorH, 'panel', true, s, f);
        }
        // задняя стена: глухая, несущая, с двумя окнами
        addWall(px0, back, px1, back, y, floorH, 'panel', true, s, f);
      }
      // торцевые стены — только у первого и последнего подъезда
      const sideL = sx0, sideR = sx1;
      if (s === 0) addWall(sideL, front + wallT, sideL, back - wallT, y, floorH, 'panel', true, s, f);
      if (s === sections - 1) addWall(sideR, front + wallT, sideR, back - wallT, y, floorH, 'panel', true, s, f);
      // межподъездная стена (внутри дома, поэтому не несущая — её можно пробить)
      if (s > 0) addWall(sx0, front, sx0, back, y, floorH, 'brick', false, s, f, 0.2);
      // «несущий пояс» по фасаду — та самая колонна, обрушение по ней
      panels.push({ pos: [sx0 + secW / 2, y + floorH / 2, front + wallT / 2 + 0.02], size: [wallT * 0.9, floorH, 0.5], rotY: 0, material: 'concrete', hp: HP.concrete * 1.8, loadBearing: true, section: s, floor: f });
      loadBearingBySection[s].push(panels.length - 1);
    }
    // крыша-плита по секции
    panels.push({ pos: [sx0 + secW / 2, H + 0.15, 0], size: [secW, 0.3, D], rotY: 0, material: 'concrete', hp: HP.concrete * 1.4, loadBearing: false, section: s, floor: floors });
    // межэтажные перекрытия (полы) — тонкие, их можно пробить сверху вниз
    for (let f = 1; f <= floors; f++) {
      panels.push({ pos: [sx0 + secW / 2, f * floorH - 0.12, 0], size: [secW, 0.24, D], rotY: 0, material: 'concrete', hp: HP.concrete * 0.5, loadBearing: false, section: s, floor: f });
    }
    stairs.push({ pos: [sx0 + secW * 0.5, 0, D * 0.28], section: s });
  }

  // ---------- интерьер квартир ----------
  // В секции 2 квартиры на этаж (по 2-3 комнаты), между ними лестничная клетка у фасада сзади.
  for (let s = 0; s < sections; s++) {
    const sx0 = -HX + s * secW;
    for (let f = 0; f < floors; f++) {
      const y = f * floorH;
      // левая и правая квартиры
      for (const side of [-1, 1]) {
        const qx = sx0 + secW / 2 + side * secW * 0.26;
        const qw = secW * 0.44, qd = D * 0.74;
        const base = [qx, y, D * 0.06] as [number, number, number];
        // кровать
        if (rnd() > 0.15) props.push({ kind: 'bed', pos: [base[0] + side * qw * 0.22, y, base[2] + qd * 0.28], rotY: side > 0 ? Math.PI : 0, size: [0.95, 0.55, 2.05], section: s, floor: f });
        // шкаф у межкомнатной стены
        props.push({ kind: 'wardrobe', pos: [base[0] - side * qw * 0.28, y, base[2] + qd * 0.3], rotY: side > 0 ? 0 : Math.PI, size: [0.6, 1.85, 1.1], section: s, floor: f });
        // стол + стулья (на кухне, у задней стены)
        props.push({ kind: 'table', pos: [base[0] + side * qw * 0.15, y, base[2] - qd * 0.28], rotY: 0, size: [0.8, 0.75, 1.2], section: s, floor: f });
        if (rnd() > 0.35) props.push({ kind: 'chair', pos: [base[0] + side * qw * 0.15 - 0.75, y, base[2] - qd * 0.28], rotY: Math.PI / 2, size: [0.45, 0.9, 0.45], section: s, floor: f });
        if (rnd() > 0.5) props.push({ kind: 'chair', pos: [base[0] + side * qw * 0.15 + 0.75, y, base[2] - qd * 0.28], rotY: -Math.PI / 2, size: [0.45, 0.9, 0.45], section: s, floor: f });
        // диван в «зале»
        if (f > 1 || rnd() > 0.4) props.push({ kind: 'sofa', pos: [base[0] - side * qw * 0.1, y, base[2] + qd * 0.02], rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2, size: [0.9, 0.8, 2.1], section: s, floor: f });
        // телевизор на тумбе
        if (rnd() > 0.2) props.push({ kind: 'tv', pos: [base[0] + side * qw * 0.3, y, base[2] + qd * 0.02], rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2, size: [0.6, 1.0, 0.5], section: s, floor: f });
        // холодильник
        if (rnd() > 0.3) props.push({ kind: 'fridge', pos: [base[0] + side * qw * 0.36, y, base[2] - qd * 0.34], rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2, size: [0.65, 1.7, 0.65], section: s, floor: f });
        // книжная полка
        if (rnd() > 0.45) props.push({ kind: 'shelf', pos: [base[0] - side * qw * 0.02, y, base[2] - qd * 0.4], rotY: 0, size: [1.2, 1.9, 0.3], section: s, floor: f });
        // ковёр (плоский, без физики)
        if (rnd() > 0.25) props.push({ kind: 'carpet', pos: [base[0], y + 0.01, base[2] + qd * 0.12], rotY: 0, size: [2.4, 0.02, 1.8], section: s, floor: f });
        // люстра под потолком
        if (rnd() > 0.3) props.push({ kind: 'lamp', pos: [base[0], y + floorH - 0.45, base[2]], rotY: 0, size: [0.4, 0.5, 0.4], section: s, floor: f });
      }
    }
  }

  return {
    kind: opts.kind, name: T.name,
    size: [W, H, D], floors, sections,
    panels, windows, loadBearingBySection, props, stairs,
  };
}

// ---------- визуал ----------

const MAT: Record<string, THREE.MeshStandardMaterial> = {};
function mat(key: string, color: string, rough = 0.92, metal = 0.02, extra?: THREE.MeshStandardMaterialParameters) {
  const k = key;
  if (!MAT[k]) MAT[k] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  return MAT[k];
}
export function facadeMaterial(kind: string) {
  // панелька: голубовато-серый бетон с расшивкой (полосы швов делаем геометрией — дешёво и без текстур)
  return kind === 'khrushchevka' ? mat('kh', '#b9b5a8', 0.95) : mat('br', '#a9adb2', 0.9);
}

/**
 * Собирает меш здания по спецификации. Все панели складываются в ОДИН BufferGeometry
 * (по материалу) — иначе 600 отдельных мешей убьют FPS.
 * Возвращает группу и карту «индекс панели → BufferGeometry-диапазон» для удаления при разрушении.
 */
export function buildBuildingMesh(spec: BuildingSpec, kind: string): { group: THREE.Group; panelMeshes: Map<number, THREE.Mesh> } {
  const group = new THREE.Group(); group.name = 'building_' + kind;
  const panelMeshes = new Map<number, THREE.Mesh>();
  const facade = facadeMaterial(kind);

  // стены: каждый материал — свои меши; панели разных HP всё равно визуально одинаковы,
  // но нам нужна возможность убрать ОДНУ панель, поэтому каждая панель — отдельный меш.
  // Чтобы не плодить драв-коллы, используем InstancedMesh по материалу, а «удаление» = scale 0.
  const byMat = new Map<THREE.Material, number[]>();
  spec.panels.forEach((p, i) => {
    const m = p.material === 'brick' ? mat('brick', '#8d5a44', 0.95) : p.material === 'glass' ? mat('glass', '#9fc4d8', 0.1, 0.1, { transparent: true, opacity: 0.35 }) : facade;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m)!.push(i);
  });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const [m, idxs] of byMat) {
    const inst = new THREE.InstancedMesh(geo, m, idxs.length);
    inst.castShadow = true; inst.receiveShadow = true; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    idxs.forEach((pi, k) => {
      const p = spec.panels[pi];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY);
      pos.set(...p.pos); scl.set(...p.size);
      mtx.compose(pos, q, scl); inst.setMatrixAt(k, mtx);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    // индекс панели → (mesh, instanceIndex), чтобы потом спрятать ровно одну
    idxs.forEach((pi, k) => panelMeshes.set(pi, { instanceId: inst.id, mesh: inst, i: k } as unknown as THREE.Mesh));
  }
  // окна: стекло + рама
  const glassMat = mat('win', '#8fb6cc', 0.15, 0.05, { transparent: true, opacity: 0.42 });
  const frameMat = mat('frame', '#e8e4dc', 0.8);
  for (const w of spec.windows) {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1] - 0.14, w.size[2] - 0.14), glassMat);
    g.add(glass);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w.size[0] * 0.9, 0.08, w.size[2]), frameMat);
    fr.position.y = -w.size[1] / 2 + 0.04; g.add(fr);
    const fm = new THREE.Mesh(new THREE.BoxGeometry(w.size[0] * 0.9, 0.06, 0.06), frameMat);
    fm.position.y = 0; g.add(fm);
    g.position.set(...w.pos); g.rotation.y = w.rotY;
    group.add(g);
  }
  return { group, panelMeshes };
}

// ---------- мебель ----------
const FURN: Record<string, () => THREE.Group> = {
  bed: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 2.05), mat('wood', '#8a5a2b', 0.85)); b.position.y = 0.225; g.add(b); const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 1.9), mat('linen', '#d8d2c4', 0.95)); m.position.y = 0.56; g.add(m); const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.4), mat('linen2', '#c9c2b2')); p.position.set(0, 0.72, -0.75); g.add(p); return g; },
  table: () => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.2), mat('wood2', '#9a6a3a')); t.position.y = 0.72; g.add(t); for (const [x, z] of [[-0.32, -0.5], [0.32, -0.5], [-0.32, 0.5], [0.32, 0.5]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), mat('wood3', '#7a5028')); l.position.set(x, 0.35, z); g.add(l); } return g; },
  chair: () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), mat('wood2', '#9a6a3a')); s.position.y = 0.45; g.add(s); const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), mat('wood3', '#7a5028')); b.position.set(0, 0.7, -0.2); g.add(b); for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat('wood3', '#7a5028')); l.position.set(x, 0.22, z); g.add(l); } return g; },
  wardrobe: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.85, 1.1), mat('ward', '#6b4a2e', 0.7)); b.position.y = 0.925; g.add(b); const d = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.7, 0.02), mat('metal2', '#3a3a3a', 0.5, 0.8)); d.position.set(0.31, 0.95, 0); g.add(d); return g; },
  sofa: () => { const g = new THREE.Group(); const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 2.1), mat('sofa', '#7a4a3a', 0.95)); seat.position.y = 0.3; g.add(seat); const back = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 2.1), mat('sofa', '#7a4a3a')); back.position.set(-0.34, 0.62, 0); g.add(back); for (const z of [-1.0, 1.0]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.16), mat('sofa', '#6a3f31')); arm.position.set(0, 0.58, z); g.add(arm); } return g; },
  shelf: () => { const g = new THREE.Group(); const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.9, 0.05), mat('wood3', '#7a5028')); back.position.set(0, 0.95, -0.12); g.add(back); for (let i = 0; i < 4; i++) { const sh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.3), mat('wood2', '#9a6a3a')); sh.position.set(0, 0.3 + i * 0.5, 0); g.add(sh); for (let k = 0; k < 6; k++) { const bk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.2), mat('book' + (k % 4), ['#7a2a2a', '#2a4a6a', '#4a6a2a', '#6a5a2a'][k % 4], 0.9)); bk.position.set(-0.5 + k * 0.18, 0.45 + i * 0.5, 0.02); g.add(bk); } } return g; },
  tv: () => { const g = new THREE.Group(); const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mat('wood3', '#6b4a2e')); st.position.y = 0.06; g.add(st); const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), mat('metal2', '#2a2a2a', 0.5, 0.6)); leg.position.y = 0.4; g.add(leg); const tv = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.42), mat('tvbody', '#2a2826', 0.6)); tv.position.y = 0.95; g.add(tv); const scr = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.34), mat('screen', '#26343a', 0.2, 0.3)); scr.position.set(0.25, 0.95, 0); g.add(scr); return g; },
  fridge: () => { const g = new THREE.Group(); const f = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.7, 0.65), mat('fridge', '#d8d8d0', 0.5, 0.15)); f.position.y = 0.85; g.add(f); const h = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), mat('metal2', '#777', 0.4, 0.7)); h.position.set(0.34, 1.15, 0.2); g.add(h); return g; },
  carpet: () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 1.8), mat('carpet', '#7a3a3a', 1)); g.add(c); const o = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.025, 1.4), mat('carpet2', '#8a5a3a', 1)); o.position.y = 0.002; g.add(o); return g; },
  lamp: () => { const g = new THREE.Group(); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6), mat('metal2', '#444', 0.4, 0.6)); rod.position.y = 0.2; g.add(rod); const sh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.22, 10, 1, true), mat('lamp', '#e8dfc8', 0.9, 0, { side: THREE.DoubleSide })); sh.position.y = -0.02; g.add(sh); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat('bulb', '#fff2c0', 0.4, 0, { emissive: new THREE.Color('#ffe8a0'), emissiveIntensity: 1.6 })); bulb.position.y = -0.08; g.add(bulb); return g; },
};
export function buildFurniture(kind: string): THREE.Group | null {
  const f = FURN[kind]; return f ? f() : null;
}
export const FURNITURE_KINDS = Object.keys(FURN);
