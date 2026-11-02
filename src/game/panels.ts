// ПАНЕЛИ ДОМА (M4). Сначала делаем ДЕТАЛИ, потом собираем из них дом, как конструктор.
//
// Почему заново: воксельная стена из «кирпичиков 1.4 × 0.7» выглядела рваной решёткой —
// окна были дырами произвольной формы, торцы — голыми рёбрами, а на фасаде висели
// отдельные блоки. Теперь стена — это ПАНЕЛЬ заводского вида: ровный прямоугольник
// с рамкой, у неё есть паспорт (тип, материал, вес) и раскладка на воксели для разрушения.
//
// Каталог деталей (PANEL_KINDS):
//   wall     — глухая стена
//   window   — стена с оконным проёмом (в игре: зелёная коробка ТЗ = «панель с окном»)
//   door     — стена с дверным проёмом (вход в подъезд)
//   balcony  — панель с балконным блоком (ограждение + плита)
//   brick    — межсекционная стена (кирпич)
//   slab     — плита перекрытия (пол/потолок)
//   roof     — кровельная плита
//   stair    — марш лестницы в подъезде
//   landing  — лестничная площадка
// Дом = набор этих деталей + мебель. Ничего «просто нарисованного» в геометрии нет:
// всё, что видно, — это деталь из каталога.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Surface } from '../shared/types.ts';

/** Тип детали. */
export type PanelKind = 'wall' | 'window' | 'door' | 'balcony' | 'brick' | 'slab' | 'roof' | 'stair' | 'landing';

export interface PanelDef {
  kind: PanelKind;
  /** горизонтальная деталь (плита/кровля/площадка): толщина по Y, глубина — второй размер */
  horizontal?: boolean;
  /** ширина × высота в метрах (деталь изготавливается под эти габариты) */
  w: number;
  h: number;
  thickness: number;
  material: Surface;
  color: string;
  /** проём: доля ширины/высоты, вырезаемая из панели (окно/дверь) */
  opening?: { x0: number; x1: number; y0: number; y1: number };
  /** стекло в проёме */
  glass?: boolean;
  /** шаг вокселя (раскладка панели на куски): чем мельче — тем аккуратнее пробоина */
  voxel: { w: number; h: number; d: number };
  /** прочность: сколько «единиц» урона держит панель */
  hp: number;
  /** сколько обломков рождается при разрушении */
  debris: number;
  /** балкон: плита + ограждение */
  balcony?: boolean;
}

const VX = 0.375, VY = 0.35;

/** Фабрика деталей: ширина панели подбирается под секцию, чтобы стыки были ровными. */
export function panelDef(kind: PanelKind, w: number, h: number): PanelDef {
  const base = { w, h, thickness: 0.32, voxel: { w: VX, h: VY, d: 0.32 } };
  switch (kind) {
    case 'window':
      return { ...base, kind, material: 'panel', color: '#cfcabd', hp: 120, debris: 10,
        opening: { x0: 0.22, x1: 0.78, y0: 0.36, y1: 0.90 }, glass: true };
    case 'door':
      return { ...base, kind, material: 'panel', color: '#c9c4b7', hp: 150, debris: 12,
        opening: { x0: 0.36, x1: 0.64, y0: 0, y1: 0.78 } };
    case 'balcony':
      return { ...base, kind, material: 'panel', color: '#c6c1b4', hp: 130, debris: 14, balcony: true,
        opening: { x0: 0.30, x1: 0.70, y0: 0.34, y1: 0.86 }, glass: true };
    case 'brick':
      return { ...base, kind, thickness: 0.2, voxel: { w: 0.35, h: 0.175, d: 0.2 }, material: 'brick', color: '#9c6a50', hp: 80, debris: 8 };
    case 'slab':
      return { ...base, kind, horizontal: true, thickness: 0.24, voxel: { w: 0.9, h: 0.24, d: 0.9 }, material: 'concrete', color: '#b8b3a7', hp: 220, debris: 6 };
    case 'roof':
      return { ...base, kind, horizontal: true, thickness: 0.3, voxel: { w: 0.9, h: 0.3, d: 0.9 }, material: 'concrete', color: '#a9a496', hp: 260, debris: 6 };
    case 'stair':
      return { ...base, kind, thickness: 0.9, voxel: { w: 0.3, h: 0.175, d: 0.18 }, material: 'concrete', color: '#ada79b', hp: 200, debris: 5 };
    case 'landing':
      return { ...base, kind, horizontal: true, thickness: 0.22, voxel: { w: 0.8, h: 0.22, d: 0.8 }, material: 'concrete', color: '#b2ac9f', hp: 200, debris: 5 };
    case 'wall':
    default:
      return { ...base, kind: 'wall', material: 'panel', color: '#cfcabd', hp: 140, debris: 10 };
  }
}

// ---------- геометрия детали ----------

const matCache = new Map<string, THREE.Material>();
function solid(color: string, rough = 0.9, metal = 0.02) {
  const k = `s|${color}|${rough}|${metal}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(k)!;
}
function glassMat() {
  const k = 'glass';
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({
    color: '#9dc0d2', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.34, side: THREE.DoubleSide,
    depthWrite: false,
  }));
  return matCache.get(k)!;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};

/**
 * Собирает геометрию детали в её локальных осях: центр панели в (0, 0, 0),
 * ширина по X, высота по Y, толщина по Z. Проём вырезается по-настоящему (4 куска),
 * а не «нарисован текстурой» — чтобы через окно было видно и чтобы внутрь можно было залезть.
 */
export function buildPanelGeometry(def: PanelDef): { body: THREE.BufferGeometry; glass?: THREE.BufferGeometry } {
  const { w, h, thickness: t, opening } = def;
  if (def.horizontal) {
    // Плита: w по X, h (глубина) по Z, толщина по Y. Раньше горизонтальные детали
    // собирались как вертикальные, и вместо пола получались узкие балки-«доски».
    const rim = 0.05;
    const parts = [
      box(w, t, h, 0, 0, 0),
      box(w, t + 0.03, rim, 0, 0, h / 2 - rim / 2),
      box(w, t + 0.03, rim, 0, 0, -h / 2 + rim / 2),
      box(rim, t + 0.03, h, -w / 2 + rim / 2, 0, 0),
      box(rim, t + 0.03, h, w / 2 - rim / 2, 0, 0),
    ];
    const body = mergeGeometries(parts, false)!;
    body.computeVertexNormals();
    return { body };
  }
  const half = t / 2;
  const parts: THREE.BufferGeometry[] = [];
  if (!opening) {
    parts.push(box(w, h, t, 0, 0, 0));
  } else {
    const ox0 = -w / 2 + opening.x0 * w, ox1 = -w / 2 + opening.x1 * w;
    const oy0 = -h / 2 + opening.y0 * h, oy1 = -h / 2 + opening.y1 * h;
    // низ проёма
    if (oy0 > -h / 2 + 1e-3) parts.push(box(w, oy0 + h / 2, t, 0, (-h / 2 + oy0) / 2, 0));
    // верх проёма
    if (oy1 < h / 2 - 1e-3) parts.push(box(w, h / 2 - oy1, t, 0, (oy1 + h / 2) / 2, 0));
    // боковины
    if (ox0 > -w / 2 + 1e-3) parts.push(box(ox0 + w / 2, oy1 - oy0, t, (-w / 2 + ox0) / 2, (oy0 + oy1) / 2, 0));
    if (ox1 < w / 2 - 1e-3) parts.push(box(w / 2 - ox1, oy1 - oy0, t, (ox1 + w / 2) / 2, (oy0 + oy1) / 2, 0));
  }
  // рамка панели: тонкий поясок по периметру — именно он даёт «заводской» вид вместо решётки
  const rim = 0.045;
  parts.push(box(w, rim, t + 0.03, 0, h / 2 - rim / 2, 0));
  parts.push(box(w, rim, t + 0.03, 0, -h / 2 + rim / 2, 0));
  parts.push(box(rim, h, t + 0.03, -w / 2 + rim / 2, 0, 0));
  parts.push(box(rim, h, t + 0.03, w / 2 - rim / 2, 0, 0));
  // балкон: плита снизу и ограждение
  if (def.balcony) {
    parts.push(box(w * 0.92, 0.14, 1.1, 0, -h / 2 + 0.07, half + 0.55));
    parts.push(box(w * 0.92, 0.9, 0.06, 0, -h / 2 + 0.52, half + 1.05));
    parts.push(box(0.06, 0.9, 1.1, -w * 0.46, -h / 2 + 0.52, half + 0.55));
    parts.push(box(0.06, 0.9, 1.1, w * 0.46, -h / 2 + 0.52, half + 0.55));
  }
  const body = mergeGeometries(parts, false)!;
  body.computeVertexNormals();
  let glass: THREE.BufferGeometry | undefined;
  if (def.glass && opening) {
    const gw = (opening.x1 - opening.x0) * w, gh = (opening.y1 - opening.y0) * h;
    const cx = -w / 2 + ((opening.x0 + opening.x1) / 2) * w;
    const cy = -h / 2 + ((opening.y0 + opening.y1) / 2) * h;
    glass = box(gw * 0.98, gh * 0.98, 0.03, cx, cy, 0);
  }
  return { body, glass };
}

/** Общий материал панели (все панели одного цвета сливаются в один InstancedMesh). */
export function panelMaterial(def: PanelDef) { return solid(def.color); }
export { glassMat };

// ---------- раскладка панели на воксели ----------

export interface PanelVoxel {
  /** локальные координаты центра относительно центра панели */
  p: [number, number, number];
  size: [number, number, number];
  /** вырезан проёмом */
  inOpening: boolean;
  alive: boolean;
}

/**
 * Раскладка панели на куски для разрушения. Куски, попавшие в проём, помечаются
 * inOpening: они существуют только как «будущие обломки» по краю проёма, но не в физике.
 */
export function layoutPanel(def: PanelDef): PanelVoxel[] {
  const { w, h, thickness: t, opening, voxel } = def;
  if (def.horizontal) {
    const nx = Math.max(1, Math.round(w / voxel.w));
    const nz = Math.max(1, Math.round(h / (voxel.d || voxel.w)));
    const cw = w / nx, cd = h / nz;
    const out: PanelVoxel[] = [];
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      out.push({ p: [-w / 2 + (i + 0.5) * cw, 0, -h / 2 + (k + 0.5) * cd], size: [cw, t, cd], inOpening: false, alive: true });
    }
    return out;
  }
  const nx = Math.max(1, Math.round(w / voxel.w));
  const ny = Math.max(1, Math.round(h / voxel.h));
  const cw = w / nx, ch = h / ny;
  const out: PanelVoxel[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = -w / 2 + (i + 0.5) * cw;
    const y = -h / 2 + (j + 0.5) * ch;
    const fx = (x + w / 2) / w, fy = (y + h / 2) / h;
    const inOpening = !!opening && fx > opening.x0 && fx < opening.x1 && fy > opening.y0 && fy < opening.y1;
    out.push({ p: [x, y, 0], size: [cw, ch, t], inOpening, alive: true });
  }
  return out;
}
