// ИИ БОТОВ (ТЗ п.10): проверяем решения «мозга», а не картинку.
// Важное: бот не должен видеть сквозь стену, не должен стрелять мгновенно (реакция),
// должен идти к точке и сближаться, и не должен «слепнуть» при развороте на 90°.
import { makeBrain, canSee, tickBrain, damageBrain, BOT_WEAPON, BOT_DIFFICULTY } from '../src/game/botai.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };
const DT = 1 / 30;

// луч «в пустоте»: ничего не мешает
const open = () => 999;
// луч в стену на 8 м
const wallAt = (d) => () => d;

// 1. видит цель перед собой, не видит за стеной
{
  const a = makeBrain(0, [0, 0, 0]); a.yaw = Math.PI;       // yaw=π смотрит в +Z
  const b = makeBrain(1, [0, 0, 20]);
  check('цель в 20 м перед собой видна', canSee(a, b, open).visible);
  check('цель за стеной не видна', !canSee(a, b, wallAt(8)).visible, `стена на 8 м, цель на 20 м`);
  check('дальше дальности огня не видит', !canSee(a, makeBrain(1, [0, 0, 200]), open).visible);
}

// 2. угол обзора: за спиной не видит, но вплотную — да
{
  const a = makeBrain(0, [0, 0, 0]); a.yaw = Math.PI;       // смотрим в +Z
  const behind = makeBrain(1, [0, 0, -25]);
  check('за спиной не видит', !canSee(a, behind, open).visible);
  const close = makeBrain(1, [0, 0, -3]);
  check('вплотную за спиной замечает', canSee(a, close, open).visible);
  const side = makeBrain(1, [12, 0, 12]);
  check('в боковой полусфере видит', canSee(a, side, open).visible);
}

// 3. реакция: первая доля секунды бот не стреляет
{
  const a = makeBrain(0, [0, 0, 0], 'veteran'); a.yaw = Math.PI;
  const b = makeBrain(1, [0, 0, 15]);
  let fired = false;
  for (let i = 0; i < 3; i++) { if (tickBrain(a, [b], DT, open).fire) fired = true; }   // 0.1 с < 250 мс
  check('ветеран не стреляет мгновенно (реакция 250 мс)', !fired);
  let fired2 = false;
  for (let i = 0; i < 20; i++) { if (tickBrain(a, [b], DT, open).fire) fired2 = true; }
  check('после реакции открывает огонь', fired2);
  const priv = makeBrain(0, [0, 0, 0], 'private'); priv.yaw = Math.PI;
  const b2 = makeBrain(1, [0, 0, 15]);
  let firedPrivateEarly = false;
  for (let i = 0; i < 10; i++) { if (tickBrain(priv, [b2], DT, open).fire) firedPrivateEarly = true; }  // 0.33 с < 800 мс
  check('рядовой реагирует медленнее ветерана', !firedPrivateEarly);
}

// 4. очередь: стреляет не бесконечно, потом пауза
{
  const a = makeBrain(0, [0, 0, 0], 'sergeant'); a.yaw = Math.PI;
  const b = makeBrain(1, [0, 0, 15]);
  let shots = 0, seenRest = false, gap = 0;
  for (let i = 0; i < 120; i++) {
    const r = tickBrain(a, [b], DT, open);
    if (r.fire) { shots++; gap = 0; }
    else { gap++; if (shots > 0 && gap > 8) seenRest = true; }
  }
  check('стреляет очередями, а не сплошняком', seenRest, `${shots} выстрелов за 4 с (очередь ${BOT_DIFFICULTY.sergeant.burst})`);
  check('темп огня разумный (не автомат на 600 в/мин)', shots > 3 && shots < 46, `${shots} выстрелов за 4 с`);
}

// 5. сближение на большой дистанции и остановка вблизи
{
  const a = makeBrain(0, [0, 0, 0], 'sergeant'); a.yaw = Math.PI;
  const far = makeBrain(1, [0, 0, 40]);
  let moveFar = [0, 0];
  for (let i = 0; i < 40; i++) { const r = tickBrain(a, [far], DT, open); if (r.fire) moveFar = r.move; }
  check('на большой дистанции сближается', Math.hypot(...moveFar) > 0, `move ${moveFar.map(v => v.toFixed(1))}`);
  const a2 = makeBrain(0, [0, 0, 0], 'sergeant'); a2.yaw = Math.PI;
  const near = makeBrain(1, [0, 0, 8]);
  let moveNear = [1, 1];
  for (let i = 0; i < 40; i++) { const r = tickBrain(a2, [near], DT, open); if (r.fire) moveNear = r.move; }
  check('вблизи не бежит вперёд (стреляет с места)', Math.hypot(...moveNear) === 0);
}

// 6. путь к точке, когда цели нет
{
  const a = makeBrain(0, [0, 0, 0]);
  a.goal = [30, 0, 0];
  const r = tickBrain(a, [], DT, open);
  check('без цели идёт к точке захвата', Math.hypot(...r.move) > 0, `move ${r.move.map(v => v.toFixed(1))}`);
  a.pos = [29, 0, 0];
  const r2 = tickBrain(a, [], DT, open);
  check('на точке останавливается', Math.hypot(...r2.move) === 0);
}

// 7. урон и смерть
{
  const b = makeBrain(1, [0, 0, 0]);
  check('урон копится', !damageBrain(b, BOT_WEAPON.damage) && b.hp < 100, `hp ${b.hp}`);
  let dead = false;
  for (let i = 0; i < 10; i++) dead = damageBrain(b, BOT_WEAPON.damage) || dead;
  check('после достаточного урона умирает', dead && b.dead);
  check('мёртвый не стреляет и не идёт', (() => { const r = tickBrain(b, [], DT, open); return !r.fire && Math.hypot(...r.move) === 0; })());
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — ИИ ботов (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
