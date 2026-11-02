// tools/download-assets.mjs — скачивание ассетов с Google Drive в assets/models.
// Заменяет прежний download-assets.sh: bash-скрипт на Windows из npm не запускается.
//
// Что нужно: Python + gdown. Если их нет — скрипт не падает, а печатает инструкцию.
//   pip install gdown
//
// Использование:
//   npm run download                       — папка по умолчанию из ТЗ
//   npm run download -- <ссылка на папку>  — своя папка
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const DEFAULT_FOLDER =
  'https://drive.google.com/drive/folders/16bUDSprbcVa8LK6XvUVTvexYXqhx45wG?usp=sharing';

const url = process.argv[2] || DEFAULT_FOLDER;
fs.mkdirSync('assets/models', { recursive: true });

const candidates = process.platform === 'win32'
  ? [['py', ['-m', 'gdown']], ['python', ['-m', 'gdown']], ['gdown', []]]
  : [['gdown', []], ['python3', ['-m', 'gdown']], ['python', ['-m', 'gdown']]];

let done = false;
for (const [cmd, pre] of candidates) {
  const args = [...pre, '--folder', url, '-O', 'assets/models', '--remaining-ok'];
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error && r.error.code === 'ENOENT') continue;   // команды нет — пробуем следующую
  done = r.status === 0;
  break;
}

if (!done) {
  console.error(`
⚠ Скачать автоматически не удалось.

Вариант 1 — поставить gdown и повторить:
    pip install gdown
    npm run download

Вариант 2 — вручную: открыть папку в браузере, скачать GLB
и положить их в assets/models, затем выполнить:
    npm run assets
`);
  process.exit(0); // не роняем сборку: игра запустится на заглушках
}
console.log('Готово: models в assets/models. Дальше — npm run assets');
