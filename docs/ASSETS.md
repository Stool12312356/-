# Как долить все модели

Если вы уже прогнали `npm run assets` со всеми 36 GLB в `assets/models`,
сделайте два простых шага — и все модели окажутся в игре.

## 1. Обновиться (один раз)

В вашей копии остался старый `config/catalog.json`, из-за которого сборка
падала на коллизии `barrel`/`gp25`. Скачайте свежий архив:

```
https://codeload.github.com/Stool12312356/-/zip/refs/heads/arena/1ed3ff10-repo
```

Распакуйте в новую папку, перенесите туда вашу `assets/models` (36 GLB)
и выполните:

```cmd
npm install
npm run assets
npm run dev
```

Ожидаемый итог: **36 настоящих моделей вместо 10**, размер `public/assets/game`
около 8 МБ, `game-low` около 5 МБ.

## 2. Что станет настоящим

| Файл | Предмет |
|---|---|
| akmn.glb | АКМ |
| low-poly_dragunov_svd.glb | СВД |
| low-poly_pkm.glb | ПКМ |
| low-poly_rpk.glb | РПК |
| low_-_poly_rpg_-_7_gun.glb | РПГ-7 |
| low-poly_pm_makarov.glb | ПМ |
| low-poly_gp-25_underbarrel_grenade_launcher.glb | ГП-25 |
| m30_mortar_warno.glb | Миномёт М30 |
| low-poly_rgd-5.glb | РГД-5 |
| f-1.glb | Ф-1 |
| c4_explosive.glb | C4 |
| claymore_explosive.glb | Claymore (вместо МОН-50) |
| mine-01.glb | Мина (вместо ТМ-62) |
| tactical_first_aid_kit.glb | Аптечка |
| ammo_box.glb | Ящик боеприпасов |
| drone.glb | Дрон-разведчик |
| fpv_drone.glb | FPV-дрон |
| sniper.glb | Снайперская (AWM/L96) |
| pgm_ultima_ratio__game-ready_sniper_rifle.glb | PGM Ultima Ratio |
| m4_-_fps_weapon_animations_pack_v.1.glb | M4 + руки, анимации |
| t-90a.glb | Т-90А |
| bmp-2.glb | БМП-2 |
| btr-80ak.glb | БТР-80 |
| brdm-2.glb | БРДМ-2 |
| zsu-23-4v1_shilka_ussr.glb | ЗСУ-23-4 «Шилка» |
| ural-4320.glb | Урал-4320 |
| m1a2_sep_v2.glb | M1A2 Abrams |
| m2_bradley.glb | M2 Bradley |
| mh-6_little_bird_low_poly.glb | MH-6 Little Bird |
| su-25.glb | Су-25 |
| pubg_boat.glb | Катер |
| assault_boat.glb | Штурмовая лодка |
| soldier.glb | Солдат (зимний камуфляж) |
| lenin_monument.glb | Памятник Ленину |
| old_soviet_bus_stop.glb | Автобусная остановка |
| beer_pub_kiosk_pivnaya.glb | Киоск «Пивная» |

## 3. Чего всё ещё нет

Эти три пака на Диске лежат в других папках, а не в `assets/models`:

- `ak-74_pack_game_asset.glb` (46 МБ) — из него нарезаются АК-74, АК-74М,
  АКС-74У и тактические варианты (`tools/split.mjs` + `config/splits.json`);
- `abandoned_soviet_garages_pack_game-ready.glb` (11 МБ) — гаражи;
- `low_poly_winter_tree_pack.glb` (16 МБ) — зимние деревья.

Положите их в `assets/models` и снова выполните `npm run assets` —
`split.mjs` сам вырежет из пака отдельные модели.

Без них эти предметы останутся процедурными заглушками, игра работает.
