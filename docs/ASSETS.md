# Модели: что уже в игре и чего не хватает

Актуально на этом коммите. В игре **76 настоящих моделей из 81 предмета**,
заглушками остались три мелочи (о них в конце).

## Как проверить у себя

```cmd
npm install
npm run assets
npm run dev
```

Ожидаемый итог:

```
manifest: 81 предметов | реальных моделей: 76 | заглушек: 3 | процедурных: 2 | неопознанных файлов: 0
```

`public/assets/game` ≈ 25 МБ, `public/assets/game-low` ≈ 13 МБ.
Сжатые модели уже лежат в репозитории, поэтому игра работает даже без
`assets/models` — сырые исходники нужны только для пересборки.

## Откуда что взято

1. Папка `модели` на Диске — 36 отдельных моделей.
2. Папка «исходники для игры» — 9 моделей (УАЗ, ГАЗ-66, КамАЗ, ЛиАЗ, трамвай,
   ГАЗ-24, ВАЗ-2105, Ми-8, противник `forest_soldier_outdated`).
3. Три пака, которые `tools/split.mjs` режет на части по `config/splits.json`:
   - `ak-74_pack_game_asset.glb` (46 МБ) → 6 автоматов + 3 прицепа/планки;
   - `abandoned_soviet_garages_pack_game-ready.glb` (11 МБ) → 4 гаража;
   - `low_poly_winter_tree_pack.glb` (16 МБ) → 9 деревьев, 3 куста, 2 изгороди,
     лес, снег и талый снег.

## Полная таблица «файл → предмет»

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
| claymore_explosive.glb | Claymore |
| mine-01.glb | Мина МОН-50-замена (`mine01`) |
| tactical_first_aid_kit.glb | Аптечка |
| ammo_box.glb | Ящик боеприпасов |
| drone.glb | Дрон-разведчик |
| fpv_drone.glb | FPV-дрон |
| sniper.glb | Снайперская (AWM/L96) |
| pgm_ultima_ratio__game-ready_sniper_rifle.glb | PGM Ultima Ratio |
| m4_-_fps_weapon_animations_pack_v.1.glb | M4 + руки, анимации |
| ak-74_pack → ak74_wood.glb | АК-74 (дерево) |
| ak-74_pack → ak74m.glb | АК-74М |
| ak-74_pack → ak74m_1p29.glb | АК-74М с 1П29 |
| ak-74_pack → ak74_wood_rail.glb | АК-74 с планкой |
| ak-74_pack → ak74_beryl.glb | АК-74 «Берилл» |
| ak-74_pack → ak74_tactical.glb | АК-74 тактический |
| ak-74_pack → att_1p29/att_side_rail/att_pica_optic.glb | Прицел 1П29, боковая планка, планка Пикатинни |
| t-90a.glb | Т-90А |
| bmp-2.glb | БМП-2 |
| btr-80ak.glb | БТР-80 |
| brdm-2.glb | БРДМ-2 |
| zsu-23-4v1_shilka_ussr.glb | ЗСУ-23-4 «Шилка» |
| ural-4320.glb | Урал-4320 |
| uaz_001.glb | УАЗ-469 |
| gaz_66.glb | ГАЗ-66 |
| kamaz_5330.glb | КамАЗ |
| liaz_-_677.glb | ЛиАЗ |
| tatra_t3_reworked.glb | Трамвай Tatra T3 |
| gaz_24.glb | ГАЗ-24 «Волга» |
| vaz-2105.glb | ВАЗ-2105 |
| mi-8.glb | Ми-8 |
| hind_attack_helicopter.glb | Ми-24 |
| mh-6_little_bird_low_poly.glb | MH-6 Little Bird |
| m1a2_sep_v2.glb | M1A2 Abrams |
| m2_bradley.glb | M2 Bradley |
| su-25.glb | Су-25 |
| pubg_boat.glb | Катер |
| assault_boat.glb | Штурмовая лодка |
| soldier.glb | Солдат (зимний камуфляж) |
| forest_soldier_outdated.glb | Противник (зимний камуфляж) |
| lenin_monument.glb | Памятник Ленину |
| old_soviet_bus_stop.glb | Автобусная остановка |
| beer_pub_kiosk_pivnaya.glb | Киоск «Пивная» |
| гаражи (пак) | garage_a…garage_d |
| деревья (пак) | wtree_a…wtree_i, wshrub_a…c, whedge_a/b, wforest |
| снег (пак) | snow_ground, snow_melting |

## Что осталось заглушками

| id | Почему |
|---|---|
| `aks74u` | В паке АК-74 отдельной модели АКС-74У нет (есть складной приклад у «Берилла») — отдельного файла нет, подменять не будем. |
| `barrel` | Бочки как отдельной модели в наборах нет. |
| `crate` | Деревянного ящика как отдельной модели нет. |
| `khrushchevka`, `brezhnevka` | Процедурные здания с мебелью (по ТЗ они должны разрушаться) — генерируются кодом, а не берутся из файла. |

## Важно про масштаб

У моделей со Sketchfab поза хранится в костях, а не в вершинах. `tools/lib/bake.mjs`
теперь запекает эту позу **до** замера габаритов, иначе масштаб и коллайдер считаются
по «раздетому» скелету. Именно из-за этого РПК раньше выходил 5,3 × 19,6 × 1,04 м —
теперь 0,06 × 0,30 × 1,04 м. Если появится новая модель с странными габаритами,
сборка теперь сама печатает предупреждение `похоже на чужой масштаб` — лечится
`targetLength`/`targetHeight` в `config/catalog.json`.
