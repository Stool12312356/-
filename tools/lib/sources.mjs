// Список исходных файлов: обычные GLB из assets/models + части, вырезанные из паков (assets/_split).
import fs from 'fs';
export const SRC = 'assets/models', SPLIT = 'assets/_split', VM = 'assets/_vm';
/** id → файл «противня»: build-manifest пишет assets/_vm/<id>.glb для моделей с exclude */
const VM_BY_ID = fs.existsSync(`${VM}/_map.json`) ? JSON.parse(fs.readFileSync(`${VM}/_map.json`, 'utf8')) : {};
/** «Противень» модели без лишних деталей (собирается build-manifest по catalog.exclude).
 *  Для ПМ — без запасного магазина: файл тот же, но в игру едет облегчённая версия. */
export function vmDropIn(f) {
  const id = VM_BY_ID[f];
  const p = id ? `${VM}/${id}.glb` : `${VM}/${f}`;
  return fs.existsSync(p) ? p : null;
}
export function listSources() {
  const splits = fs.existsSync('config/splits.json') ? JSON.parse(fs.readFileSync('config/splits.json', 'utf8')) : {};
  const packs = new Set(Object.keys(splits).filter(k => !k.startsWith('_')));
  const out = [];
  if (fs.existsSync(SRC)) for (const f of fs.readdirSync(SRC)) if (/\.(glb|gltf)$/i.test(f) && !packs.has(f)) out.push({ name: f, path: vmDropIn(f) ?? `${SRC}/${f}`, pack: null, stripped: !!vmDropIn(f) });
  for (const [pack, parts] of Object.entries(splits)) { if (pack.startsWith('_')) continue; for (const id of Object.keys(parts)) { const p = `${SPLIT}/${id}.glb`; if (fs.existsSync(p)) out.push({ name: `${id}.glb`, path: p, pack }); } }
  return out;
}
