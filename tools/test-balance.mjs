// БАЛАНС БОЯ: «бот не должен убивать за пару тычек».
// Тест не «смотрит на цифры», а СТРЕЛЯЕТ по игроку и считает время до смерти.
import { BALANCE, HitGate, hitChance, damageToPlayer, timeToKill, balanceReport } from '../src/game/balance.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

// 1. один выстрел не снимает больше 22% HP
for (const skill of ['private', 'sergeant', 'veteran']) {
  const d = damageToPlayer(skill, 100, true);
  check(`${skill}: урон за выстрел ≤ 22 HP`, d <= 22.001, `${d.toFixed(1)} HP`);
  check(`${skill}: урон за выстрел ≥ 5 HP (иначе бой бессмысленный)`, d >= 5, `${d.toFixed(1)} HP`);
}

// 2. «не видел стрелка» — бьёт слабее
check('первый контакт слабее', damageToPlayer('sergeant', 100, false) < damageToPlayer('sergeant', 100, true),
  `${damageToPlayer('sergeant', 100, false).toFixed(1)} против ${damageToPlayer('sergeant', 100, true).toFixed(1)}`);

// 3. чем дальше, тем меньше шанс попадания
check('вблизи попадает чаще', hitChance('veteran', 5) > hitChance('veteran', 40),
  `${(hitChance('veteran', 5) * 100).toFixed(0)}% → ${(hitChance('veteran', 40) * 100).toFixed(0)}%`);
check('на 60 м ветеран не снайпер', hitChance('veteran', 60) < 0.25, `${(hitChance('veteran', 60) * 100).toFixed(0)}%`);

// 4. HitGate: grace-период и лимит попаданий в секунду
{
  const g = new HitGate();
  const first = g.allow(0);
  const second = g.allow(0.1);      // grace 0.35 с
  const third = g.allow(0.4);       // прошло
  check('первое попадание проходит', first);
  check('второе сразу — нет (grace)', !second);
  check('через 0.4 с — снова можно', third);
  let allowed = 0;
  const g2 = new HitGate();
  for (let t = 0; t < 1; t += 0.05) if (g2.allow(t)) allowed++;
  check('не больше 3 попаданий в секунду', allowed <= BALANCE.hitsPerSecond, `${allowed} за секунду`);
}

// 5. время до убийства: одиноко стоящий бот не убивает «за пару тычек»
{
  const t1 = timeToKill('sergeant', 100, 20, 1);
  check('1 бот убивает игрока дольше 8 с', t1 > 8, `${t1.toFixed(1)} с`);
  const t8 = timeToKill('sergeant', 100, 20, 8);
  check('даже 8 ботов — не мгновенно', t8 > 3, `${t8.toFixed(1)} с`);
  const rep = balanceReport(100);
  console.log('    сводка: ' + rep.map(r => `${r.skill} 1/${r.ttk1.toFixed(0)}с 3/${r.ttk3.toFixed(0)}с 8/${r.ttk8.toFixed(0)}с`).join(' · '));
  check('ветеран опаснее рядового', timeToKill('veteran', 100, 20, 1) < timeToKill('private', 100, 20, 1));
  // ветеран вплотную всё ещё должен давать шанс: не меньше 3 с
  check('ветеран вплотную не убивает за 2 с', timeToKill('veteran', 100, 3, 1) > 3,
    `${timeToKill('veteran', 100, 3, 1).toFixed(1)} с`);
}

// 6. игрок с аптечкой успевает отреагировать: 65 HP лечения = +6.5 с под одним ботом
{
  const t = timeToKill('sergeant', 100, 20, 1);
  check('аптечка даёт заметную фору', 65 / 100 * t > 4, `${(65 / 100 * t).toFixed(1)} с`);
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — баланс боя (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
