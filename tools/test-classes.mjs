// КЛАССЫ ПЕХОТЫ (ТЗ п.8): баланс и «не выдумывать оружие».
// Главная проверка: у каждого класса оружие ЕСТЬ В ДАННЫХ (weapons.ts), а не
// «нарисовано в интерфейсе». Плюс пассивки реально отличают классы друг от друга.
import { CLASSES, CLASS_ORDER, classWeapons, loadout, applyArmor, canRepair } from '../src/game/classes.ts';
import { WEAPONS } from '../src/game/weapons.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

check('четыре класса, как в ТЗ', CLASS_ORDER.length === 4, CLASS_ORDER.map(k => CLASSES[k].name).join(', '));

for (const id of CLASS_ORDER) {
  const c = CLASSES[id];
  const specs = classWeapons(c);
  check(`${c.name}: всё оружие есть в данных`, specs.length === c.weapons.length,
    `${specs.map(s => s.name).join(' / ')}`);
  const load = loadout(id);
  check(`${c.name}: запас патронов положительный`, load.every(([, r]) => r > 0), load.map(([w, r]) => `${w}:${r}`).join(' '));
  check(`${c.name}: есть хотя бы один гаджет`, c.gadgets.length >= 1, c.gadgets.map(g => g.name).join(', '));
}

// по ТЗ у инженера РПГ, у разведчика СВД, у поддержки ПКМ/РПК
check('инженер с РПГ', classWeapons(CLASSES.engineer).some(w => w.id === 'rpg7'));
check('разведчик со СВД', classWeapons(CLASSES.recon).some(w => w.id === 'svd'));
check('поддержка с ПКМ или РПК', classWeapons(CLASSES.support).some(w => w.id === 'pkm' || w.id === 'rpk'));
check('штурмовик с АК-74 или АКМ', classWeapons(CLASSES.assault).some(w => w.id === 'ak74' || w.id === 'akm'));

// у штурмовика вторым номером — РПГ (жалоба: «пропала РПГ, вместо неё ещё один калаш»)
check('у штурмовика есть РПГ', classWeapons(CLASSES.assault).some(w => w.id === 'rpg7'),
  classWeapons(CLASSES.assault).map(w => w.id).join(', '));
check('второй слот штурмовика — не второй автомат',
  classWeapons(CLASSES.assault).filter(w => ['ak74', 'akm', 'ak74m'].includes(w.id)).length === 1,
  classWeapons(CLASSES.assault).map(w => w.id).join(', '));

// пассивки: классы должны различаться, иначе выбор бессмысленный
{
  const speeds = CLASS_ORDER.map(id => CLASSES[id].perk.speedMul);
  check('скорость отличается между классами', new Set(speeds).size >= 2, speeds.join(', '));
  const hps = CLASS_ORDER.map(id => CLASSES[id].perk.hpMul);
  check('поддержка крепче штурмовика', CLASSES.support.perk.hpMul > CLASSES.assault.perk.hpMul);
  check('разведчик перезаряжает быстрее', CLASSES.recon.perk.reloadMul < CLASSES.support.perk.reloadMul);
  check('урон по поддержке меньше, чем по разведчику',
    applyArmor('support', 50) < applyArmor('recon', 50),
    `${applyArmor('support', 50).toFixed(1)} против ${applyArmor('recon', 50).toFixed(1)}`);
}

// ремключ только у инженера
check('чинить технику может только инженер',
  canRepair('engineer') && !canRepair('assault') && !canRepair('support') && !canRepair('recon'));

// боезапас: у инженера +15%, у остальных как есть
{
  const eng = loadout('engineer').find(([w]) => w === 'ak74m');
  const base = CLASSES.engineer.weapons.find(w => w.id === 'ak74m').reserve;
  check('инженер получает +15% боезапаса', eng[1] > base, `${base} → ${eng[1]}`);
}

// в данных оружия нет дублей id (иначе «подмена модели»)
check('id оружия уникальны', new Set(WEAPONS.map(w => w.id)).size === WEAPONS.length);

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — классы пехоты (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
