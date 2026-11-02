// ГАДЖЕТЫ (ТЗ п.8): проверяем, что каждый гаджет реально что-то делает и тратит заряд.
// Никакого three — только логика через hooks, поэтому тест быстрый и честный.
import { Gadgets, gadgetForKey, GADGET_KEYS } from '../src/game/gadgets.ts';
import { CLASSES, CLASS_ORDER } from '../src/game/classes.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

/** стенд: считаем, что именно вызвали */
function rig() {
  const log = { heal: 0, resupply: 0, explosions: [] };
  const hooks = {
    heal: (hp) => { log.heal += hp; },
    resupply: (m) => { log.resupply += m; },
    explode: (p, r, power) => { log.explosions.push({ p, r, power }); },
    origin: () => [0, 1.6, 0],
    aim: () => [0, 0, -1],
  };
  return { g: new Gadgets(hooks), log };
}

// 1. аптечка лечит и тратится
{
  const { g, log } = rig();
  g.setFrom([{ id: 'medkit', uses: 1 }]);
  check('аптечка в наборе', g.have('medkit'));
  check('применение аптечки', g.use('medkit') && log.heal === 65, `лечение ${log.heal}`);
  check('аптечка потрачена', !g.have('medkit'));
  check('второй раз не работает', !g.use('medkit'));
}

// 2. ящик патронов пополняет
{
  const { g, log } = rig();
  g.setFrom([{ id: 'ammo', uses: 2 }]);
  g.use('ammo');
  check('ящик даёт 3 магазина', log.resupply === 3);
  check('у ящика осталось 1 применение', g.uses('ammo') === 1);
}

// 3. С4 и граната — взрыв в мире, а не «ничего»
{
  const { g, log } = rig();
  g.setFrom([{ id: 'c4', uses: 1 }, { id: 'grenade', uses: 2 }]);
  g.use('c4');
  g.use('grenade');
  // проверяем ПОСЛЕ обоих применений: иначе первый check читает ещё не всё
  check('оба гаджета дали взрыв', log.explosions.length === 2, `${log.explosions.length} взрывов`);
  check('С4 — большой взрыв', log.explosions[0]?.power === 'big', log.explosions[0]?.power);
  check('граната — малый взрыв', log.explosions[1]?.power === 'small', log.explosions[1]?.power);
  check('граната летит вперёд по взгляду', log.explosions[1].p[2] < -10, `z=${log.explosions[1].p[2]}`);
  check('С4 ставится рядом', Math.abs(log.explosions[0].p[2]) < 3, `z=${log.explosions[0].p[2]}`);
}

// 4. мина и ремключ
{
  const { g, log } = rig();
  g.setFrom([{ id: 'mine', uses: 1 }, { id: 'wrench', uses: 5 }]);
  g.use('mine');
  check('мина взрывает', log.explosions.length === 1);
  g.use('wrench');
  check('ремключ «чинит» (перевязка)', log.heal === 25, `+${log.heal} HP`);
}

// 5. дрон даёт точку разведки
{
  const { g } = rig();
  g.setFrom([{ id: 'drone', uses: 1 }]);
  g.use('drone');
  check('дрон даёт точку впереди и выше', !!g.droneSpot && g.droneSpot[2] < -20 && g.droneSpot[1] > 10,
    g.droneSpot ? g.droneSpot.map(v => v.toFixed(1)).join(',') : 'нет');
}

// 6. у каждого класса гаджеты из данных классов и клавиши находятся
for (const id of CLASS_ORDER) {
  const c = CLASSES[id];
  const { g } = rig();
  g.setFrom(c.gadgets);
  check(`${c.name}: все гаджеты распознаны`, g.list.length === c.gadgets.length,
    g.list.map(x => x.id).join(', '));
  const usable = c.gadgets.some(x => gadgetForKey(g.list, x.id === 'medkit' || x.id === 'wrench' ? 'KeyH' : 'KeyK') !== null);
  check(`${c.name}: хотя бы один гаджет на клавише`, usable);
}

// 7. неизвестный гаджет не ломает набор
{
  const { g } = rig();
  g.setFrom([{ id: 'телепорт', uses: 1 }, { id: 'medkit', uses: 1 }]);
  check('неизвестный гаджет отбрасывается', g.list.length === 1 && g.list[0].id === 'medkit');
}

check('клавиши гаджетов заданы', Object.keys(GADGET_KEYS).length >= 3, Object.keys(GADGET_KEYS).join(', '));

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — гаджеты (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
