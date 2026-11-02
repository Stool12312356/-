// РЕЖИМ «ШТУРМ» (ТЗ п.7): проверяем правила тиками по 1/30 с — не «выглядит правильно»,
// а конкретно: точки захватываются только при перевесе, билеты текут владельцу большинства,
// смерть снимает билет, матч заканчивается по билетам и по времени.
import { Match, DEFAULT_MATCH } from '../src/game/match.ts';
import { buildCapturePoints, MAP_POINTS } from '../src/game/maps.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const DT = 1 / 30;
const soldier = (side, x, z, holding = true, y = 0) => ({ side, alive: true, holding, pos: [x, y, z] });

// 1. карта даёт точки в советском антураже
{
  const pts = buildCapturePoints('spalny');
  check('на карте есть точки захвата (не меньше 5)', pts.length >= 5, `${pts.length}: ${pts.map(p => p.name).join(', ')}`);
  check('все точки нейтральны на старте', pts.every(p => p.owner === -1));
  const minD = Math.min(...pts.flatMap((a, i) => pts.slice(i + 1).map(b => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]))));
  check('точки разнесены (не одна куча)', minD > 11, `минимум ${minD.toFixed(1)} м между точками`);
  check('карта описана данными (готова к добавлению новых)', Object.keys(MAP_POINTS).length >= 1, Object.keys(MAP_POINTS).join(', '));
  check('у каждой точки есть радиус захвата', pts.every(p => p.radius >= 5));
}

// 2. захват требует перевеса и времени
{
  const m = new Match(buildCapturePoints('spalny').slice(0, 1));
  const p = m.points[0];
  // один наш боец на точке: захват идёт, но не мгновенно
  m.update(DT, [soldier(0, p.pos[0], p.pos[2])]);
  check('захват не мгновенный', p.owner === -1 && p.progress > 0 && p.progress < 0.2, `прогресс ${p.progress.toFixed(2)}`);
  // ждём
  for (let i = 0; i < 400; i++) m.update(DT, [soldier(0, p.pos[0], p.pos[2])]);
  check('один боец захватывает точку за ~10 с', p.owner === 0, `владелец ${p.owner}, прошло ${(400 * DT).toFixed(1)} с`);

  // 3. равные силы — прогресс стоит
  const m2 = new Match(buildCapturePoints('spalny').slice(0, 1));
  const q = m2.points[0];
  for (let i = 0; i < 60; i++) m2.update(DT, [soldier(0, q.pos[0], q.pos[2]), soldier(1, q.pos[0], q.pos[2])]);
  check('при равных силах захват стоит', q.owner === -1 && q.progress < 1e-6, `прогресс ${q.progress.toFixed(3)}`);
}

// 4. перевес по точкам снимает билеты
{
  const pts = buildCapturePoints('spalny');
  const m = new Match(pts, { ...DEFAULT_MATCH, bleed: 5 });
  pts[0].owner = 0; pts[1].owner = 0; pts[2].owner = 0;
  const t0 = m.tickets[1];
  for (let i = 0; i < 300; i++) m.update(DT, []);
  const lost = t0 - m.tickets[1];
  check('владелец большинства точек снимает билеты', lost > 30 && lost < 200, `−${lost.toFixed(0)} за ${(300 * DT).toFixed(0)} с`);
  const m2 = new Match(buildCapturePoints('spalny'), { ...DEFAULT_MATCH, bleed: 5 });
  m2.points[0].owner = 0; m2.points[1].owner = 1;
  const a = m2.tickets[0], b = m2.tickets[1];
  for (let i = 0; i < 300; i++) m2.update(DT, []);
  check('равное число точек — билеты не текут', Math.abs(a - m2.tickets[0]) < 1e-6 && Math.abs(b - m2.tickets[1]) < 1e-6);
}

// 5. смерть снимает билет, конец матча по билетам
{
  const m = new Match(buildCapturePoints('spalny'), { tickets: 10 });
  for (let i = 0; i < 10; i++) m.casualty(1);
  m.update(DT, []);
  check('смерть бойца снимает билет', m.tickets[1] === 0, `билеты противника ${m.tickets[1]}`);
  check('победа при нуле билетов у противника', m.state === 'win', `${m.state}: ${m.reason}`);
}

// 6. конец по времени сравнивает билеты
{
  const m = new Match(buildCapturePoints('spalny'), { tickets: 100, timeLimit: 5 });
  m.tickets = [70, 40];
  for (let i = 0; i < 200; i++) m.update(DT, []);
  check('по времени выигрывает тот, у кого больше билетов', m.state === 'win', `${m.state}: ${m.reason}`);
  check('HUD показывает время', /^\d+:\d\d$/.test(m.hud()), m.hud());
}

// 7. свой боец внутри радиуса на другом этаже не захватывает точку на земле
{
  const m = new Match(buildCapturePoints('spalny').slice(0, 1));
  const p = m.points[0];
  for (let i = 0; i < 60; i++) m.update(DT, [soldier(0, p.pos[0], p.pos[2], true, p.pos[1] + 6)]);
  check('этаж учитывается (сверху точку не берут)', p.owner === -1, `владелец ${p.owner}`);
}

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — режим «Штурм» (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
