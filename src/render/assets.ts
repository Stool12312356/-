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
    const real = this.manifest.items.filter(i => !i.placeholder);
    let done = 0;
    await Promise.all(real.map(async it => {
      try { this.gltfs.set(it.id, await this.loader.loadAsync(this.base + (new URLSearchParams(location.search).has('lowtex') ? it.file!.replace('assets/game/', 'assets/game-low/') : it.file!))); }
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

  /** Физический коллайдер: для моделей — convex hull из геометрии (tools/build-manifest), для заглушек — bbox. */
  colliderFor(id: string, obj: THREE.Object3D): Shape {
    const c = this.colliders.get(id);
    if (c && !this.get(id).placeholder) return c;
    const b = new THREE.Box3().setFromObject(obj); const s = b.getSize(new THREE.Vector3()), ct = b.getCenter(new THREE.Vector3());
    return { t: 'box', he: [Math.max(s.x / 2, 0.03), Math.max(s.y / 2, 0.03), Math.max(s.z / 2, 0.03)], pos: [ct.x, ct.y, ct.z] };
  }
}
