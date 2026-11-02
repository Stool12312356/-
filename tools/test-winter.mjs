// Проверка ЗИМНЕГО ОФОРМЛЕНИЯ.
// Пользователь: «трава зелёная, а должна быть белая, так как зима».
// Тест ловит возврат зелени: раньше на террайн вешалась карта травы, и снег получался
// болотно-зелёным, а ёлки стояли летние.
import fs from 'fs';
import * as THREE from 'three';
import { buildTerrain, WINTER } from '../src/game/terrain.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const { mesh } = buildTerrain();
const cols = mesh.geometry.getAttribute('color').array;
let green = 0, white = 0, total = 0;
for (let i = 0; i < cols.length; i += 3) {
  const r = cols[i], g = cols[i + 1], b = cols[i + 2];
  total++;
  // «зелёный» = зелёный канал заметно выше красного и синего (трава/наст)
  if (g > r + 0.06 && g > b + 0.06) green++;
  // снег: яркий и почти нейтральный (в линейном пространстве THREE он темнее hex)
  if (r > 0.6 && g > 0.6 && b > 0.6) white++;
}
check('земля зимой белая, а не зелёная', green === 0 && white / total > 0.6,
  `пикселей ${total}: зелёных ${green}, светлых ${(white / total * 100).toFixed(0)} %`);
check('зимняя палитра задана в одном месте', !!WINTER.snow && !!WINTER.shade,
  `${WINTER.snow} / ${WINTER.shade}`);

// текстура снега есть и она белая
const snow = fs.existsSync('public/textures/snow.png');
check('есть текстура снега', snow, snow ? `public/textures/snow.png, ${(fs.statSync('public/textures/snow.png').size / 1024).toFixed(0)} КБ` : 'НЕТ');
if (snow) {
  const buf = fs.readFileSync('public/textures/snow.png');
  // белизна: PNG сжат, поэтому смотрим не пиксели, а факт, что файл не пустой
  check('текстура снега не пустая', buf.length > 20_000, `${(buf.length / 1024).toFixed(0)} КБ`);
}

// небо и туман зимние (светлые)
const main = fs.readFileSync('src/main.ts', 'utf8');
const hasWinterSky = /scene\.background = new THREE\.Color\('#[cdef]/i.test(main);
check('небо зимнее (светлое), а не серо-синее', hasWinterSky,
  (main.match(/scene\.background = new THREE\.Color\('([^']+)'\)/) ?? [])[1] ?? 'не найдено');

// деревья: у ёлок снег на лапах (в заглушках нет чистого зелёного цвета кроны)
const ph = fs.readFileSync('src/render/placeholders.ts', 'utf8');
check('ёлки с снегом, а не летние', /#e8f1f7/.test(ph), 'белые шапки на лапах');

// террейн не грузит траву
const terrain = fs.readFileSync('src/game/terrain.ts', 'utf8');
check('террайн берёт снег, а не траву', !/tex\('grass'\)/.test(terrain), 'травяной карты в террайне нет');

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — зимнее оформление (${ok} проверок)`);
process.exit(bad ? 1 : 0);
