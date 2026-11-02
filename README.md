# Красный Шторм — M1 (ассеты + физическое ядро + полигон)

Одиночный шутер в браузере, 100% офлайн (сервера нет). Стек: Three.js, Rapier3D (WASM, Web Worker, 60 Гц), TypeScript, Vite.

## Запуск
```
npm install
npm run dev          # http://localhost:5173  (manifest пересобирается автоматически)
npm run build && npm run preview   # статическая сборка в dist/
```
Параметры URL для слабых машин: `?lowtex` (текстуры 128px), `?noshadow`, `?lowres`.

## Ассеты (папка Google Drive)
1. `npm run download` — gdown в `assets/models/`
2. `npm run assets` — конвертация (`tools/convert.mjs`: Specular-Glossiness→PBR, Draco, текстуры WebP ≤512/1024) + `tools/build-manifest.mjs` (классификация, нормализация масштаба/ориентации, коллайдеры convex hull → `public/assets/colliders/`, реестр `public/assets/manifest.json`)
3. **Правило «одна модель — один предмет»**: `config/catalog.json` описывает каждый предмет и regexp имени файла. Если один файл подходит под два id — сборка манифеста падает с ошибкой. Если файла нет — рисуется отдельная процедурная заглушка (`placeholder:true`), а не чужая модель. Положите нужный файл (например `ak74.glb`) в `assets/models`, выполните `npm run assets` — заглушка заменится без правки кода.

Реестр в игре: клавиша **Tab** (какие модели настоящие, какие — заглушки).

## Документация

- `docs/SPEC.md` — техническое задание (ТЗ v2.0)
- `docs/SETUP-WINDOWS.md` — установка на Windows, ошибки npm и PowerShell
- `docs/UPDATE.md` — как скачать актуальную версию (старый архив устарел)
- `docs/WHATS-NEXT.md` — что осталось сделать и почему часть шагов за вами
