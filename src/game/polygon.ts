// СОВЕТСКИЙ ПОЛИГОН: выставка ВСЕХ ассетов (реальные модели / заглушки подписаны),
// рампы, строения, ящики. Вызывается ТОЛЬКО для карты mode: 'training' (см. main.ts):
// раньше эта выставка стояла и на спальном районе, и на заводе — пользователь попросил
// убрать её с играбельных карт.
//
// РАСКЛАДКА (важно): стрельбище в maps.ts — это линия огня по X (−60…40) и мишени
// на 25/50/100/200 м. Выставка поэтому стоит СЕВЕРНЕЕ (z < −25), рампы и башня —
// южнее (z > 40), а стол с оружием — в тылу у линии огня (z = 18), чтобы он не
// загораживал мишени.
import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { PhysicsClient } from '../physics/client';
import { buildTerrain } from './terrain';

/**
 * Подпись-табличка над экспонатом.
 * БАГ (виден на скриншоте из квартиры): у спрайта стоял `depthTest: false`, поэтому
 * подписи полигона рисовались ПОВЕРХ стен дома — игрок внутри квартиры видел на
 * кирпичной стене зеленоватые полоски и «обрывки текста». Теперь подписи уважают
 * глубину: их видно только там, где они реально перед стеной.
 */
function label(text: string, real: boolean, scale = 1): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,10,10,.72)'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = real ? '#4ade80' : '#fb923c'; g.fillRect(0, 0, 10, 96);
  g.font = 'bold 34px sans-serif'; g.fillStyle = '#fff'; g.fillText(text, 24, 42);
  g.font = '24px sans-serif'; g.fillStyle = real ? '#4ade80' : '#fb923c'; g.fillText(real ? 'РЕАЛЬНАЯ МОДЕЛЬ' : 'ЗАГЛУШКА (нет файла)', 24, 78);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  })); s.scale.set(3 * scale, 0.5625 * scale, 1); s.renderOrder = 10; return s;
}

/**
 * ГДЕ СТОИТ ВЫСТАВКА (данные, а не числа по коду).
 *
 * Раскладку проверяет `tools/test-maps.mjs`: выставка не должна попадать на линию огня
 * и на мишени (иначе стреляешь в музей, а не в цель). Поэтому числа вынесены сюда —
 * тест сверяет их с данными карты полигона.
 */
export const POLYGON_LAYOUT = {
  /** ряд реальной техники (t90a, bmp2, mi24…) — севернее всего */
  rowRealZ: -48,
  /** два ряда техники-заглушек */
  rowPhZ: [-72, -88] as const,
  /** стол с оружием и гаджетами — в тылу линии огня */
  weaponTableZ: 18,
  /** рампы (склоны) и башня — южнее, на отдельных площадках */
  rampZ: 56,
  tower: [126, 74] as const,
  /** пирамида ящиков и бочки */
  cratesZ: 84,
  /**
   * «Мёртвая зона» — линия огня и сектор мишеней: тут НИЧЕГО из выставки не ставим.
   * Совпадает с улицей «Линия огня» из maps.ts (проверяется тестом).
   */
  keepClear: { x0: -60, z0: -6, x1: 40, z1: 2 },
};

export function buildPolygon(scene: THREE.Scene, lib: AssetLibrary, phys: PhysicsClient, size = 400) {
  // --- рельеф ---
  const t = buildTerrain(size); scene.add(t.mesh);
  phys.add({ kind: 'static', pos: [0, 0, 0], friction: 0.9, shapes: [{ t: 'trimesh', verts: t.verts, idx: t.idx }] });

  const staticBox = (x: number, y: number, z: number, w: number, h: number, d: number, color: string, quat?: THREE.Quaternion) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.position.set(x, y, z); if (quat) m.quaternion.copy(quat); m.castShadow = m.receiveShadow = true; scene.add(m);
    phys.add({ kind: 'static', pos: [x, y, z], quat: quat ? [quat.x, quat.y, quat.z, quat.w] : undefined, friction: 0.9, shapes: [{ t: 'box', he: [w / 2, h / 2, d / 2] }] });
    return m;
  };
  // Предмет мог исчезнуть из манифеста (правки ТЗ: mon50→claymore, tm62→mine01 и т.п.).
  // Один отсутствующий id не должен ронять весь полигон — пропускаем его и пишем в консоль.
  const missing = new Set<string>();
  const place = (id: string, x: number, z: number, o: { y?: number; rotY?: number; dyn?: boolean; lab?: boolean; mass?: number } = {}) => {
    if (!lib.has(id)) { if (!missing.has(id)) { missing.add(id); console.warn('Полигон: нет в манифесте, пропущено —', id); } return null; }
    const inst = lib.make(id); const obj = inst.object; const item = inst.item;
    const shape = lib.colliderFor(id, obj);
    const box = new THREE.Box3().setFromObject(obj); const size = box.getSize(new THREE.Vector3());
    const y = o.y ?? 0.02; const rotY = o.rotY ?? 0;
    obj.position.set(x, y, z); obj.rotation.y = rotY; scene.add(obj);
    if (o.lab !== false) { const l = label(item.name, !item.placeholder, Math.max(0.5, Math.min(1.6, size.length() / 8))); l.position.set(x, y + box.max.y + 0.8 + Math.min(1, size.y * 0.1), z); scene.add(l); }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    if (o.dyn === false) phys.add({ kind: 'static', pos: [x, y, z], quat: [q.x, q.y, q.z, q.w], shapes: [shape] });
    else phys.add({ kind: 'dynamic', pos: [x, y, z], quat: [q.x, q.y, q.z, q.w], mass: o.mass ?? item.mass ?? 20, shapes: [shape], sleeping: true, friction: 0.8, angDamp: 0.5 }, obj);
    return obj;
  };

  // --- ряд A: реальная техника из папки Drive (лицом к игроку) ---
  const real = ['t90a', 'bmp2', 'm1a2', 'm2', 'mi24', 'mh6'];
  real.forEach((id, i) => place(id, -45 + i * 18, POLYGON_LAYOUT.rowRealZ, { rotY: Math.PI }));
  // --- ряды B: техника-заглушки (каждая своя форма) ---
  const vph = ['btr80', 'brdm2', 'zsu234', 'uaz469', 'gaz66', 'ural4320', 'mi8', 'su25', 'pubg_boat', 'assault_boat', 'vaz2105', 'volga24', 'liaz', 'tatra_t3', 'kamaz'];
  vph.forEach((id, i) => place(id, -62 + (i % 8) * 17, i < 8 ? POLYGON_LAYOUT.rowPhZ[0] : POLYGON_LAYOUT.rowPhZ[1], { rotY: Math.PI }));

  // --- стол с оружием и гаджетами ---
  const items = ['akm', 'ak74', 'aks74u', 'svd', 'pkm', 'rpk', 'rpg7', 'pm', 'gp25', 'mortar_m30', 'rgd5', 'f1', 'c4', 'claymore', 'mine01', 'medkit', 'ammobox', 'drone_scout', 'fpv_drone', 'm4a1', 'awm_l96', 'pgm_ur'];
  const slot = 1.45, tx = -(items.length * slot) / 2;
  staticBox(0, 0.45, POLYGON_LAYOUT.weaponTableZ, items.length * slot + 2, 0.9, 1.8, '#5a4a3a');
  items.forEach((id, i) => {
    if (!lib.has(id)) { if (!missing.has(id)) { missing.add(id); console.warn('Полигон: нет в манифесте, пропущено —', id); } return; }
    const inst = lib.make(id); const b = new THREE.Box3().setFromObject(inst.object); const s = b.getSize(new THREE.Vector3());
    // оружие кладём «лёжа»: длинная сторона вдоль оси стола (X) — разворачиваем на 90°, чтобы все влезли
    const longZ = s.z > s.x * 1.5 && s.z > 0.5;
    const o = place(id, tx + i * slot + slot / 2, POLYGON_LAYOUT.weaponTableZ, { y: 0.92 + (longZ ? s.y / 2 : s.y / 2) + (b.min.y < -0.001 ? 0 : 0), rotY: longZ ? Math.PI / 2 : 0, lab: false, mass: 6 });
    void o;
    const l = label(inst.item.name, !inst.item.placeholder, 0.5); l.position.set(tx + i * slot + slot / 2, 1.9 + (i % 2) * 0.45, POLYGON_LAYOUT.weaponTableZ); scene.add(l);
    inst.object.removeFromParent();
  });

  // --- рампы для проверки склонов и скольжения (>50° — скользим) ---
  [[30, 0x8a8a80], [45, 0x9a9a70], [55, 0xa07070]].forEach(([deg, col], i) => {
    const a = (deg as number) * Math.PI / 180, L = 14, x = 60 + i * 15;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0));
    const h = Math.sin(a) * L / 2 - 0.3 * Math.cos(a) - 0.02; // нижняя кромка вровень с землёй
    staticBox(x, h, POLYGON_LAYOUT.rampZ, 8, 0.6, L, '#' + (col as number).toString(16), q);
    const l = label(`Склон ${deg}°${(deg as number) > 50 ? ' (скольжение)' : ''}`, true, 0.5); l.position.set(x, 3, POLYGON_LAYOUT.rampZ + 10); scene.add(l);
  });
  // ступени
  for (let i = 0; i < 8; i++) staticBox(110, 0.15 + i * 0.3, 62 - i * 0.7, 4, 0.3 + i * 0.3, 0.7, '#7a7a74');
  // платформа 8 м для проверки урона от падения (>6 м)
  staticBox(POLYGON_LAYOUT.tower[0], 4, POLYGON_LAYOUT.tower[1], 6, 8, 6, '#6a6a64');
  { const l = label('Башня 8 м: прыжок = урон от падения', true, 0.7); l.position.set(POLYGON_LAYOUT.tower[0], 9.5, POLYGON_LAYOUT.tower[1]); scene.add(l); }

  // --- строения ---
  // Панельки НЕ ставятся здесь: это процедурные дома с интерьером и разрушаемостью,
  // их собирает buildings.ts (SpassBuilding в main.ts). Ставить их как «модель» нельзя —
  // файла нет, и получилась бы маджентовая заглушка (баг со скриншотов 2026-11-02).
  for (let i = 0; i < 5; i++) place('garage_' + 'abcd'[i % 4], 40 + i * 7.5, -30, { dyn: false, lab: i === 0, rotY: Math.PI });
  place('kiosk', 90, -60, { dyn: false }); place('busstop', 96, -40, { dyn: false, rotY: -Math.PI / 2 });
  place('lenin', 20, -20, { dyn: false });
  // зимний пак: ёлки/кусты/изгороди из low_poly_winter_tree_pack
  const winter = ['wtree_a', 'wtree_b', 'wtree_c', 'wtree_d', 'wtree_e', 'wtree_f', 'wtree_g', 'wtree_h', 'wtree_i'];
  for (let i = 0; i < 9; i++) place(winter[i], -95 + i * 8, -26 + (i % 3) * 7, { dyn: false, lab: false });
  for (let i = 0; i < 3; i++) place(['wshrub_a', 'wshrub_b', 'wshrub_c'][i], -88 + i * 5, -6, { dyn: false, lab: false });
  place('whedge_a', -60, -14, { dyn: false, lab: false, rotY: Math.PI / 2 });
  { const l = label('Зимние деревья и кусты (реальный пак)', true, 0.5); l.position.set(-80, 16, -26); scene.add(l); }

  // --- ящики и бочки (физика: пирамида) ---
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5 - r; c++) place('crate', -105 + c * 1.02 + r * 0.51, POLYGON_LAYOUT.cratesZ, { y: 0.46 + r * 0.92, lab: false, mass: 25 });
  for (let i = 0; i < 12; i++) place('barrel', -105 + (i % 4) * 0.7, POLYGON_LAYOUT.cratesZ + 7 + Math.floor(i / 4) * 0.7, { y: 0.45, lab: false, mass: 40 });
  { const l = label('Ящики и бочки: стреляй / взрыв (G)', true, 0.7); l.position.set(-103, 5, POLYGON_LAYOUT.cratesZ + 3); scene.add(l); }
  // Мишени-манекены сюда НЕ ставим: они принадлежат стрельбищу и создаются из данных
  // карты (`map.targets` → spawnTargets в main.ts), иначе стояли бы в двух местах.
  return { t };
}
