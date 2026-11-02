# Как обновиться до текущей версии

Важно: проект, который вы распаковали из старого архива, — **устаревший**.
В нём другой `package.json` (со старой bash-строкой `TEXMAX=128 ... node` и без
`tools/lib/recolor.mjs`). Поэтому `npm run assets` там падал и будет падать.

Актуальная версия живёт в ветке `arena/1ed3ff10-repo` на GitHub.

## Скачать свежий архив

Откройте и нажмите «Code → Download ZIP»:

```
https://github.com/Stool12312356/-/archive/refs/heads/arena/1ed3ff10-repo.zip
```

Прямая ссылка для скачивания:

```
https://codeload.github.com/Stool12312356/-/zip/refs/heads/arena/1ed3ff10-repo
```

Распакуйте в **новую** папку (не поверх старой, иначе останется мусор
от прежних скриптов). В архиве уже есть:

- код игры `src/`
- 10 сжатых моделей `public/assets/game` (6 МБ)
- коллайдеры `public/assets/colliders`
- готовый `public/assets/manifest.json` (81 предмет)
- все скрипты `tools/`, включая `lib/recolor.mjs`

То есть **игра запустится сразу**, даже без сырых моделей.

## Проверка, что версия правильная

В корне проекта выполните:

```cmd
node -e "console.log(require('./package.json').scripts.assets)"
```

Должно вывести:

```
node tools/split.mjs && node tools/convert.mjs && node tools/convert.mjs --low && node tools/build-manifest.mjs
```

Если вместо этого видите `npm run convert && ...` — это старая версия, скачайте архив заново.

## Дальше

```cmd
npm install
npm run dev
```

Открыть `http://localhost:5173`. Модели догружать не обязательно — на полигоне
будут 10 настоящих и 69 заглушек.

Если хотите довести до всех 49 моделей — см. `docs/WHATS-NEXT.md`.
