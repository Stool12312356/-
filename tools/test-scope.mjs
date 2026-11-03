// Прицеливание (ПКМ): сетка на экране, оружие скрыто, у СВД — её оптика.
// Пользователь: «нажимаю 2 — прицел уезжает вверх; верни оригинальный прицел
// и сделай у всего оружия обычный прицел: ПКМ → сетка, оружия не видно».
import { reticleFor, RETICLE_CENTER } from '../src/game/scope.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

check('сетка всегда по центру экрана', RETICLE_CENTER.x === 0.5 && RETICLE_CENTER.y === 0.5);
check('СВД — оптический прицел', reticleFor('svd', true) === 'optic');
check('АК/ПКМ — обычное перекрестие', reticleFor('ak74', false) === 'iron' && reticleFor('pkm', false) === 'iron');
check('ПМ — пистолетный прицел', reticleFor('pm', false) === 'pistol');

// Вьюмодель должна исчезать почти сразу: при 0.28 «прозрачности» оружия уже нет
const { PlayerCombat } = await import('../src/game/combat.ts').catch(() => ({ PlayerCombat: null }));
if (!PlayerCombat) {
  console.log('  · PlayerCombat тянет three — проверяем правило видимости по исходнику');
}
import fs from 'fs';
const src = fs.readFileSync(new URL('../src/game/combat.ts', import.meta.url), 'utf8');
check('оружие скрывается при прицеливании', /vm\.visible = ads < 0\.28/.test(src), 'порог 0.28');
check('посадка «под ocular» (lift/push) больше не двигает ствол', !/opticLift/.test(src));
check('в combat подключён оверлей сетки', /updateScope\(scope: Scope\)/.test(src) && /scope\.show\(/.test(src));
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
check('main.ts создаёт Scope и зовёт каждый кадр', /new Scope\(/.test(main) && /combat\.updateScope\(scope\)/.test(main));

console.log(`\nИТОГ: ${bad ? 'ПРОВАЛЫ' : 'OK'} — прицеливание: сетка на экране, оружие скрыто (${ok} проверок)`);
process.exit(bad ? 1 : 0);
