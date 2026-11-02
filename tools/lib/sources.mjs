// Список исходных файлов: обычные GLB из assets/models + части, вырезанные из паков (assets/_split).
import fs from 'fs';
export const SRC = 'assets/models', SPLIT = 'assets/_split';
export function listSources() {
  const splits = fs.existsSync('config/splits.json') ? JSON.parse(fs.readFileSync('config/splits.json', 'utf8')) : {};
  const packs = new Set(Object.keys(splits).filter(k => !k.startsWith('_')));
  const out = [];
  if (fs.existsSync(SRC)) for (const f of fs.readdirSync(SRC)) if (/\.(glb|gltf)$/i.test(f) && !packs.has(f)) out.push({ name: f, path: `${SRC}/${f}`, pack: null });
  for (const [pack, parts] of Object.entries(splits)) { if (pack.startsWith('_')) continue; for (const id of Object.keys(parts)) { const p = `${SPLIT}/${id}.glb`; if (fs.existsSync(p)) out.push({ name: `${id}.glb`, path: p, pack }); } }
  return out;
}
