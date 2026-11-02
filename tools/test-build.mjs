// СМОУК-ТЕСТ СБОРКИ (M8): без браузера — проверяем, что собранный бандл можно
// разобрать, а модули игры не тянут в рантайме ничего из Node/браузерных API,
// которых нет в собранном виде (например случайный импорт three в боевую логику).
//
// Зачем: `vite build` проходит, даже если модуль импортирует то, что в браузере
// отсутствует (ошибка вылезет только при загрузке). Здесь — проверка импортов
// и наличие ключевых экспортов у новых боевых модулей.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

// 1. собранный бандл существует и не пустой
const dist = 'dist/assets';
let files = [];
try { files = readdirSync(dist).filter(f => f.endsWith('.js')); } catch { /* нет сборки */ }
check('есть собранный JS', files.length > 0, files.join(', '));
if (files.length) {
  const main = files.find(f => f.startsWith('index')) ?? files[0];
  const js = readFileSync(join(dist, main), 'utf8');
  check('бандл не пустой', js.length > 200000, `${(js.length / 1024).toFixed(0)} КБ`);
  // сборка не должна содержать явных признаков Node-модулей
  check('в бандле нет node:fs', !js.includes('node:fs'));
  // игровые системы попали в сборку
  for (const name of ['БИЛЕТЫ', 'СЕКЦИЯ ОБРУШЕНА', 'РПГ']) {
    check(`в сборке есть строка «${name}»`, js.includes(name));
  }
}

// 2. боевые модули не тянут three в рантайме (иначе логика не тестируется в Node)
const src = 'src/game';
for (const f of ['botai.ts', 'match.ts', 'maps.ts', 'audio.ts']) {
  const code = readFileSync(join(src, f), 'utf8');
  const imp = code.match(/^import .*from ['"](.+)['"]/gm) ?? [];
  // `import type` — стирается при сборке, в рантайме three не тянется
  const three = imp.filter(l => l.includes("'three'") && !/^import type /.test(l));
  check(`${f}: без three в рантайме`, three.length === 0, three.join('; '));
  const nodeOnly = imp.filter(l => /node:|fs|path/.test(l));
  check(`${f}: без Node-модулей`, nodeOnly.length === 0, nodeOnly.join('; '));
}

// 3. ключевые экспорты на месте
const exp = async (p, names) => {
  const m = await import(p);
  for (const n of names) check(`${p.split('/').pop()}: экспорт ${n}`, n in m);
};
await exp('../src/game/botai.ts', ['makeBrain', 'tickBrain', 'canSee', 'damageBrain', 'BOT_DIFFICULTY']);
await exp('../src/game/match.ts', ['Match', 'DEFAULT_MATCH']);
await exp('../src/game/maps.ts', ['buildCapturePoints', 'MAP_POINTS', 'spawnFor']);
await exp('../src/game/audio.ts', ['Audio', 'listenerPos']);
await exp('../src/game/barracks.ts', ['barracksPlan', 'shopPlan', 'buildSpecial', 'stairPlan']);

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — сборка и модули (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
