import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Manifest, ManifestItem, Shape } from '../shared/types';
import { buildPlaceholder } from './placeholders';

export interface Instance { object: THREE.Group; item: ManifestItem; gltf?: GLTF; }

export class AssetLibrary {
  manifest!: Manifest;
  private byId = new Map<string, ManifestItem>();
  private gltfs = new Map<string, GLTF>();
  private colliders = new Map<string, Shape>();
  private loader = new GLTFLoader();
  base = import.meta.env.BASE_URL;

  constructor() {
    const d = new DRACOLoader(); d.setDecoderPath(this.base + 'draco/'); this.loader.setDRACOLoader(d);
  }
  async init(onProgress?: (done: number, total: number, name: string) => void) {
    // cache-bust: если в assets/models появились файлы и manifest пересобран — подхватится сразу
    this.manifest = await (await fetch(this.base + 'assets/manifest.json?' + Date.now())).json();
    this.manifest.items.forEach(i => this.byId.set(i.id, i));
    if (new URLSearchParams(location.search).has('nomodels')) this.manifest.items.forEach(i => { if (!i.placeholder) { i.placeholder = true; i.placeholderSpec = { builder: 'crate', p: { color: '#ff00ff', size: [1, 1, 1] } }; } });
    // Процедурные предметы (панельки) не имеют файла вообще — это НЕ заглушка, их строит код.
    // Раньше они попадали в список загрузки, файл падал (file === undefined) и включалась
    // аварийная маджентовая заглушка — именно её было видно на скриншотах.
    const real = this.manifest.items.filter(i => !i.placeholder && !i.procedural);
    let done = 0;
    await Promise.all(real.map(async it => {
      try {
        const gltf = await this.loader.loadAsync(this.base + (new URLSearchParams(location.search).has('lowtex') ? it.file!.replace('assets/game/', 'assets/game-low/') : it.file!));
        sanitizeMaterials(gltf.scene);
        this.gltfs.set(it.id, gltf);
      }
      catch (e) { console.error('Не загрузилась модель', it.id, e); it.placeholder = true; it.placeholderSpec = it.placeholderSpec ?? { builder: 'crate', p: { color: '#ff00ff', size: [1, 1, 1] } }; }
      if (it.collider) { try { const c = await (await fetch(this.base + it.collider)).json(); this.colliders.set(it.id, { t: 'hull', points: c.points }); } catch { /* fallback to bbox */ } }
      onProgress?.(++done, real.length, it.name);
    }));
  }
  get(id: string): ManifestItem { const i = this.byId.get(id); if (!i) throw new Error('Нет в manifest: ' + id); return i; }
  has(id: string) { return this.byId.has(id); }
  all() { return this.manifest.items; }

  /** Экземпляр модели в КАНОНИЧЕСКОЙ ориентации: перед = -Z, низ y=0 (для оружия — центр). */
  make(id: string): Instance {
    const item = this.get(id);
    const root = new THREE.Group(); root.name = id;
    if (item.placeholder) {
      if (!item.placeholderSpec) throw new Error('Нет заглушки для ' + id);
      root.add(buildPlaceholder(item.placeholderSpec));
    } else {
      const gltf = this.gltfs.get(id)!;
      const inner = skClone(gltf.scene) as THREE.Group;
      // Некоторые модели содержат «лишние» детали — например у ПМ в паке отдельно
      // лежат запасной и пустой магазины. В руках они выглядели как «магазин висит рядом».
      // Список исключений задаётся в config/catalog.json → exclude (регэкспы по именам узлов).
      const ex = this.excludeBy(gltf.scene, item.id);
      if (ex.length) {
        // Детали в паках склеены по МАТЕРИАЛУ, отдельного узла «магазин» в рантайме нет.
        // Поэтому собираем материал(ы) узлов, которые надо убрать, и прячем их на всём оружии.
        // (Дополнительно к этому tools/build-manifest.mjs при пересборке геометрии убирает
        // эти узлы из GLB — тогда исключение сработает уже по геометрии.)
        const mats = new Set<THREE.Material>();
        inner.traverse(o => {
          if (!ex.some(re => re.test(o.name))) return;
          const m = o as THREE.Mesh;
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach(x => mats.add(x)); else if (mat) mats.add(mat);
        });
        if (mats.size) inner.traverse(o => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
          if (list.length && list.every(x => mats.has(x))) o.visible = false;
        });
      }
      const n = item.normalize!;
      const wrap = new THREE.Group();
      wrap.add(inner);
      inner.scale.setScalar(n.scale); inner.rotation.y = n.rotY;
      // rotation is applied before offset (offset is in canonical space)
      wrap.position.set(...n.offset);
      root.add(wrap);
      root.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = true; } });
      return { object: root, item, gltf };
    }
    root.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
    return { object: root, item };
  }

  /** Правила исключения деталей конкретной модели (config/catalog.json → exclude). */
  private excludeCache = new Map<string, RegExp[]>();
  excludeBy(_scene: THREE.Object3D, id: string): RegExp[] {
    if (this.excludeCache.has(id)) return this.excludeCache.get(id)!;
    const out = (this.manifest.exclude?.[id] ?? []).map(r => new RegExp(r, 'i'));
    this.excludeCache.set(id, out);
    return out;
  }

  /** Физический коллайдер: для моделей — convex hull из геометрии (tools/build-manifest), для заглушек — bbox. */
  colliderFor(id: string, obj: THREE.Object3D): Shape {
    const c = this.colliders.get(id);
    if (c && !this.get(id).placeholder) return c;
    const b = new THREE.Box3().setFromObject(obj); const s = b.getSize(new THREE.Vector3()), ct = b.getCenter(new THREE.Vector3());
    return { t: 'box', he: [Math.max(s.x / 2, 0.03), Math.max(s.y / 2, 0.03), Math.max(s.z / 2, 0.03)], pos: [ct.x, ct.y, ct.z] };
  }
}

/**
 * Приведение материалов из Sketchfab к нормальному виду.
 * Проблема со скриншотов: ГАЗ-66 и Ми-8 выходили почти чёрными. У половины моделей из папки
 * metalness=1.0 при roughness≈1, а окружения (env map) в сцене нет — металл без отражений
 * честно рисуется чёрным. Это не баг модели, а баг освещения, поэтому правим на входе:
 *  - metalness выше 0.9 при отсутствии металл-карты сбрасываем в 0.1;
 *  - полностью зеркальные (metal=1, rough=0) — тонируем как стекло/хром, а не «дыру»;
 *  - baseColorFactor слишком тёмный при наличии текстуры — поднимаем до читаемого.
 * Материалы клонируются, поэтому исходные GLB и соседние экземпляры не страдают.
 */
function sanitizeMaterials(root: THREE.Object3D) {
  root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const mat of list) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) continue;
      const hasMetalMap = !!sm.metalnessMap;
      if (!hasMetalMap && sm.metalness > 0.9 && sm.roughness > 0.5) sm.metalness = 0.12;
      // «зеркало» без env map: делаем шероховатым металлом, иначе чёрное пятно
      if (!hasMetalMap && sm.metalness > 0.9 && sm.roughness < 0.15) { sm.metalness = 0.35; sm.roughness = 0.45; }
      if (!sm.envMapIntensity) sm.envMapIntensity = 0.6;
      if (sm.color && sm.map) {
        const l = 0.2126 * sm.color.r + 0.7152 * sm.color.g + 0.0722 * sm.color.b;
        if (l < 0.35) sm.color.setScalar(Math.min(1, 0.35 + l));
      }
    }
  });
}
