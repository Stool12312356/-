# Установка на Windows — от и до

## Ошибка `npm.ps1 не может быть загружен ... PSSecurityException`

Это **не поломка проекта и не вирус**. Windows по умолчанию запрещает
запускать `.ps1`-скрипты, а `npm` в PowerShell — как раз такой скрипт.

### Способ 1 (быстрый, ничего не менять в системе)

Используйте **cmd** вместо PowerShell: в адресной строке проводника наберите
`cmd` и Enter, либо в меню «Пуск» откройте «Командная строка».

Все команды ниже работают в cmd как есть.

### Способ 2 (разрешить npm в PowerShell, один раз)

Откройте PowerShell **от имени пользователя** (не от админа) и выполните:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

На вопрос ответьте `Y`. Это разрешает локальные скрипты, но по-прежнему
требует подписи для скачанных из интернета — безопасный компромисс.
Если нужно откатить: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined`.

### Способ 3 (обойти npm целиком)

Все скрипты запускаются напрямую через node — PowerShell это не блокирует,
потому что `node.exe` не скрипт:

```
node tools/split.mjs
node tools/convert.mjs
node tools/convert.mjs --low
node tools/build-manifest.mjs
```

---

## Полный порядок действий

Нужен **Node.js 20+** (у вас, судя по выводу, он есть). Проверить: `node -v`.

```cmd
cd C:\Users\Stool\Desktop\workspace-01a19c23-c38a-79c8-a463-f20b9b21364a

:: 1. поставить зависимости (один раз)
npm install

:: 2. положить сырые модели в assets/models  (386 МБ с Google Диска)
::    структура: assets\models\*.glb

:: 3. сжать + собрать манифест
npm run assets

:: 4. запустить и посмотреть
npm run dev
```

Открыть `http://localhost:5173`.

### Что делает `npm run assets`

| Шаг | Скрипт | Результат |
|---|---|---|
| разрезать паки на отдельные модели | `tools/split.mjs` | `assets/_split/*.glb` |
| сжать: WebP, Draco, чистка | `tools/convert.mjs` | `public/assets/game/*.glb` (~20 МБ) |
| второй проход 128px для слабых ПК | `tools/convert.mjs --low` | `public/assets/game-low/*.glb` |
| габариты, ориентация, коллайдеры, реестр | `tools/build-manifest.mjs` | `public/assets/manifest.json` + `colliders/` |

---

## Что залить обратно на Диск

В папку «Игра»:

- `public/assets/game` — сжатые модели
- `public/assets/game-low` — облегчённые (по желанию, ~3 МБ)
- `public/assets/colliders` — коллайдеры
- `public/assets/manifest.json` — реестр

Папку `assets/models` заливать **не надо** — она в `.gitignore` и весит 386 МБ.

---

## Если `npm run assets` ругается

**`Cannot find module 'sharp'`** — не встали зависимости, повторите `npm install`.

**`нет пака ak-74_pack_game_asset.glb`** — это нормально: предупреждение,
означает что пака нет в `assets/models`, остальные файлы обработаются.

**`перекраска в зимнюю пропущена (lib/recolor.mjs отсутствует)`** — так и задумано,
я отключил её до тех пор, пока файл не выгружен. Включить: положить
`tools/lib/recolor.mjs` и запустить с `RECOLOR=1`.

**Мало памяти / процесс убивает Windows** — обрабатывайте по частям:
уберите лишние файлы из `assets/models`, прогоните, верните остальные.
