// Советский полигон: выставка ВСЕХ ассетов (реальные модели / заглушки подписаны), рампы, строения, ящики.
import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { PhysicsClient } from '../physics/client';
import { buildTerrain } from './terrain';

function label(text: string, real: boolean, scale = 1): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,10,10,.72)'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = real ? '#4ade80' : '#fb923c'; g.fillRect(0, 0, 10, 96);
  g.font = 'bold 34px sans-serif'; g.fillStyle = '#fff'; g.fillText(text, 24, 42);
  g.font = '24px sans-serif'; g.fillStyle = real ? '#4ade80' : '#fb923c'; g.fillText(real ? 'РЕАЛЬНАЯ МОДЕЛЬ' : 'ЗАГЛУШКА (нет файла)', 24, 78);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); s.scale.set(3 * scale, 0.5625 * scale, 1); s.renderOrder = 10; return s;
}

export function buildPolygon(scene: THREE.Scene, lib: AssetLibrary, phys: PhysicsClient) {
  // --- рельеф ---
  const t = buildTerrain(); scene.add(t.mesh);
  phys.add({ kind: 'static', pos: [0, 0, 0], friction: 0.9, shapes: [{ t: 'trimesh', verts: t.verts, idx: t.idx }] });

  const staticBox = (x: number, y: number, z: number, w: number, h: number, d: number, color: string, quat?: THREE.Quaternion) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.position.set(x, y, z); if (quat) m.quaternion.copy(quat); m.castShadow = m.receiveShadow = true; scene.add(m);
    phys.add({ kind: 'static', pos: [x, y, z], quat: quat ? [quat.x, quat.y, quat.z, quat.w] : undefined, friction: 0.9, shapes: [{ t: 'box', he: [w / 2, h / 2, d / 2] }] });
    return m;
  };
  const place = (id: string, x: number, z: number, o: { y?: number; rotY?: number; dyn?: boolean; lab?: boolean; mass?: number } = {}) => {
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
  real.forEach((id, i) => place(id, -45 + i * 18, 40, { rotY: Math.PI }));
  // --- ряды B: техника-заглушки (каждая своя форма) ---
  const vph = ['btr80', 'brdm2', 'zsu234', 'uaz469', 'gaz66', 'ural4320', 'ural_moto', 'mi8', 'su25', 'boat', 'inflatable', 'vaz2101', 'volga24', 'liaz', 'tram', 'kamaz'];
  vph.forEach((id, i) => place(id, -62 + (i % 8) * 17, i < 8 ? 12 : -14, { rotY: Math.PI }));

  // --- стол с оружием и гаджетами ---
  const items = ['akm', 'ak74', 'aks74u', 'svd', 'pkm', 'rpk', 'rpg7', 'spg9', 'pm', 'gp25', 'mortar82', 'rgd5', 'f1', 'c4', 'mon50', 'tm62', 'medkit', 'ammobox', 'wrench', 'drone', 'm4a1', 'awm_l96', 'pgm_ur'];
  const slot = 1.45, tx = -(items.length * slot) / 2;
  staticBox(0, 0.45, 76, items.length * slot + 2, 0.9, 1.8, '#5a4a3a');
  items.forEach((id, i) => {
    const inst = lib.make(id); const b = new THREE.Box3().setFromObject(inst.object); const s = b.getSize(new THREE.Vector3());
    // оружие кладём «лёжа»: длинная сторона вдоль оси стола (X) — разворачиваем на 90°, чтобы все влезли
    const longZ = s.z > s.x * 1.5 && s.z > 0.5;
    const o = place(id, tx + i * slot + slot / 2, 76, { y: 0.92 + (longZ ? s.y / 2 : s.y / 2) + (b.min.y < -0.001 ? 0 : 0), rotY: longZ ? Math.PI / 2 : 0, lab: false, mass: 6 });
    void o;
    const l = label(inst.item.name, !inst.item.placeholder, 0.5); l.position.set(tx + i * slot + slot / 2, 1.9 + (i % 2) * 0.45, 76); scene.add(l);
    inst.object.removeFromParent();
  });

  // --- рампы для проверки склонов и скольжения (>50° — скользим) ---
  [[30, 0x8a8a80], [45, 0x9a9a70], [55, 0xa07070]].forEach(([deg, col], i) => {
    const a = (deg as number) * Math.PI / 180, L = 14, x = 75 + i * 15;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0));
    const h = Math.sin(a) * L / 2 - 0.3 * Math.cos(a) - 0.02; // нижняя кромка вровень с землёй
    staticBox(x, h, 30, 8, 0.6, L, '#' + (col as number).toString(16), q);
    const l = label(`Склон ${deg}°${(deg as number) > 50 ? ' (скольжение)' : ''}`, true, 0.5); l.position.set(x, 3, 40); scene.add(l);
  });
  // ступени
  for (let i = 0; i < 8; i++) staticBox(100, 0.15 + i * 0.3, 55 - i * 0.7, 4, 0.3 + i * 0.3, 0.7, '#7a7a74');
  // платформа 8 м для проверки урона от падения (>6 м)
  staticBox(120, 4, 70, 6, 8, 6, '#6a6a64');
  { const l = label('Башня 8 м: прыжок = урон от падения', true, 0.7); l.position.set(120, 9.5, 70); scene.add(l); }

  // --- строения ---
  place('khrushchevka', -70, -85, { dyn: false, rotY: 0 }); place('brezhnevka', -10, -95, { dyn: false });
  for (let i = 0; i < 5; i++) place('garage', 40 + i * 3.4, -70, { dyn: false, lab: i === 0 });
  place('kiosk', 75, -60, { dyn: false }); place('busstop', 80, -40, { dyn: false, rotY: -Math.PI / 2 });
  place('lenin', 20, -45, { dyn: false }); place('swing', 45, -35, { dyn: false });
  for (let i = 0; i < 7; i++) { place(i % 2 ? 'tree_spruce' : 'tree_birch', -95 + i * 6, -50 + (i % 3) * 3, { dyn: false, lab: false }); }
  { const l = label('Деревья', true, 0.5); l.position.set(-80, 12, -50); scene.add(l); }

  // --- ящики и бочки (физика: пирамида) ---
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5 - r; c++) place('crate', -105 + c * 1.02 + r * 0.51, 55, { y: 0.46 + r * 0.92, lab: false, mass: 25 });
  for (let i = 0; i < 12; i++) place('barrel', -105 + (i % 4) * 0.7, 62 + Math.floor(i / 4) * 0.7, { y: 0.45, lab: false, mass: 40 });
  { const l = label('Ящики и бочки: стреляй / взрыв (G)', true, 0.7); l.position.set(-103, 5, 58); scene.add(l); }
  // мишени-манекены
  for (let i = 0; i < 6; i++) place(i % 2 ? 'soldier_opfor' : 'soldier_ussr', -30 + i * 2.5, -50, { dyn: false, lab: i < 2 });
  return { t };
}
