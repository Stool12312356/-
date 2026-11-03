// Текстуры из public/textures (скачаны tools/fetch-textures.mjs из свободных источников).
// Грузим один раз и раздаём материалам: кубик 0.5 м, поэтому повтор 1×1 на грань.
import * as THREE from 'three';

export type TexName = 'brick' | 'wood' | 'grass' | 'asphalt' | 'stone' | 'ground' | 'snow';

const cache = new Map<TexName, THREE.Texture>();
const loader = new THREE.TextureLoader();

/** Синхронно отдаёт уже загруженную текстуру (или null, пока не загрузилась). */
export function tex(name: TexName): THREE.Texture | null {
  return cache.get(name) ?? null;
}

/** Загрузить все текстуры игры. Возвращает промис — main ждёт его до старта. */
export async function loadTextures(onProgress?: (done: number, total: number, name: string) => void): Promise<void> {
  const names: TexName[] = ['brick', 'wood', 'grass', 'asphalt', 'stone', 'ground', 'snow'];
  let done = 0;
  await Promise.all(names.map(name => new Promise<void>(resolve => {
    // Расширения разные: часть ассетов — jpg из фотобанка, снег генерируется как png
    // (в проекте нет JPEG-энкодера, а тащить его ради одной текстуры незачем).
    const url = name === 'snow' ? `/textures/snow.png` : `/textures/${name}.jpg`;
    loader.load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      cache.set(name, t);
      done++; onProgress?.(done, names.length, name);
      resolve();
    }, undefined, () => {
      // текстуры нет — не роняем игру, материал останется однотонным
      done++; onProgress?.(done, names.length, name);
      resolve();
    });
  })));
}
