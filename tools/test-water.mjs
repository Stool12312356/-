// ВОДА (ТЗ п.4.5): плавучесть, течение, кислород, подводный взрыв, волны Герстнера.
//
// Тест НЕ трогает WebGL: проверяются формулы и логика (`src/game/water.ts`), то есть
// ровно то, что определяет «тонет БТР или плывёт» и «сколько секунд под водой».
import { inWater, depthAt, floatState, oxygenStep, underwaterBlast, gerstnerHeight, OXYGEN_TIME, WATER_DENSITY, G } from '../src/game/water.ts';
import { MAPS, getMap } from '../src/game/maps.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const river = { level: 0, x0: -70, z0: -300, x1: -26, z1: 300, flow: [0, 0.9], depth: 3.2 };

console.log('\nгеометрия водоёма');
check('точка в реке — это вода', inWater(river, -48, 0));
check('точка на берегу — не вода', !inWater(river, 0, 0));
check('глубина в реке', depthAt(river, -48, 100) === 3.2, `${depthAt(river, -48, 100)} м`);
check('на берегу глубина 0', depthAt(river, 0, 0) === 0);
check('без водоёма (карта без воды) — везде сухо', !inWater(undefined, 0, 0) && depthAt(undefined, 0, 0) === 0);

console.log('\nплавучесть (Архимед)');
// БТР-80: 13.6 т. Водоизмещение по ТЗ — 13.6 м³, но корпус с запасом плавучести: берём
// 16 м³ (надстройка, колёса-поплавки) — машина садится по ватерлинию, а не тонет.
const btr = { volume: 16, sub: 1.4, area: 12 };
const st = floatState(river, [-48, -0.7, 0], btr);
check('БТР в воде испытывает подъёмную силу', st.buoyancy > 0, `${(st.buoyancy / 1000).toFixed(1)} кН`);
// Равновесие: ищем осадку, при которой Архимед = весу. Она должна быть МЕНЬШЕ полного
// погружения — иначе машина ложится на дно (это и есть «плавает» или «тонет»).
let eqY = null;
for (let y = 0; y > -3; y -= 0.02) {
  if (floatState(river, [-48, y, 0], btr).buoyancy >= 13600 * G) { eqY = y; break; }
}
check('у БТР есть осадка равновесия — то есть он ПЛАВАЕТ', eqY !== null,
  eqY === null ? 'равновесия нет: потонет' : `ватерлиния на ${(-eqY).toFixed(2)} м ниже поверхности`);
// сильно утопленный корпус (ниже ватерлинии больше чем на 90% осадки) — «под водой»
check('глубоко погружённый БТР помечен как «под водой»', floatState(river, [-48, -1.6, 0], btr).submerged > 0.9,
  `${floatState(river, [-48, -1.6, 0], btr).submerged.toFixed(2)}`);
check('едва зашедший в воду корпус — не «под водой»', floatState(river, [-48, -0.2, 0], btr).submerged < 0.5);
check('сопротивление воды не нулевое', st.drag > 0);
check('течение сносит пловца на юг', st.flow[1] > 0, `${st.flow[1].toFixed(2)} м/с`);

// Т-72: 41 т. Объём 12 м³ — Архимед даёт всего ~118 кН против 402 кН веса → тонет.
const t72 = { volume: 12, sub: 1.2, area: 20 };
const stT = floatState(river, [-48, -0.6, 0], t72);
check('Т-72 тонет: Архимед слабее веса', stT.buoyancy < 41000 * G,
  `${(stT.buoyancy / 1000).toFixed(0)} кН < ${((41000 * G) / 1000).toFixed(0)} кН`);
check('над водой подъёмной силы нет', floatState(river, [-48, 6, 0], btr).buoyancy === 0);
check('вне водоёма подъёмной силы нет', floatState(river, [100, 0, 0], btr).buoyancy === 0);
check('плотность воды в формуле — 1000 кг/м³', WATER_DENSITY === 1000);

console.log('\nкислород (ТЗ: под водой дышать нечем)');
let o2 = OXYGEN_TIME;
check('на воздухе кислород полный', oxygenStep(o2, 1, false).o2 === OXYGEN_TIME);
const under1 = oxygenStep(OXYGEN_TIME, 1, true);
check('под водой кислород убывает на 1 с за секунду', Math.abs(under1.o2 - (OXYGEN_TIME - 1)) < 1e-9);
check('пока воздух есть — урона нет', under1.damage === 0);
const drown = oxygenStep(0, 1, true);
check('без воздуха — урон', drown.damage > 0, `${drown.damage} HP/с`);
check('всплыл — воздух восстанавливается', oxygenStep(10, 2, false).o2 > 10);
check('кислород не уходит в минус', oxygenStep(0.2, 5, true).o2 === 0);

console.log('\nподводный взрыв и волны');
const air = underwaterBlast(10, 100);
check('под водой удар шире, чем в воздухе', air.radius > 10 && air.power > 100, `${air.radius.toFixed(0)} м, ${air.power.toFixed(0)}`);
const h1 = gerstnerHeight(0, 0, 0), h2 = gerstnerHeight(3, 2, 1.5);
check('волна меняет высоту по времени и месту', Math.abs(h1 - h2) > 0.01, `${h1.toFixed(3)} vs ${h2.toFixed(3)}`);
let maxH = 0;
for (let t = 0; t < 20; t += 0.1) for (let x = -50; x < 50; x += 7) maxH = Math.max(maxH, Math.abs(gerstnerHeight(x, 7, t)));
check('амплитуда волны разумная (< 1 м)', maxH < 1 && maxH > 0.1, `${maxH.toFixed(2)} м`);

console.log('\nвода на картах');
const pg = getMap('prigorod');
check('на «Пригороде» есть река', !!pg.water, pg.water ? `${pg.water.x1 - pg.water.x0} м шириной` : '');
check('у реки есть уровень и течение', !!pg.water && pg.water.level === 0 && !!pg.water.flow);
check('река пересекает карту с севера на юг', !!pg.water && (pg.water.z1 - pg.water.z0) > (pg.water.x1 - pg.water.x0) * 5);
check('через реку есть мост (переправа)', !!pg.dressing?.some(d => d.kind === 'bridge'));
const bridge = pg.dressing?.find(d => d.kind === 'bridge');
const bridgeStreet = pg.streets?.find(s => s.name === 'Мост');
check('мост стоит на реке', !!bridge && !!pg.water && bridge.pos[0] > pg.water.x0 && bridge.pos[0] < pg.water.x1,
  bridge ? `x=${bridge.pos[0]}` : '');
check('мост совпадает с дорожной секцией «Мост»', !!bridgeStreet && !!bridge
  && bridge.pos[0] > bridgeStreet.x0 && bridge.pos[0] < bridgeStreet.x1
  && bridge.pos[2] > bridgeStreet.z0 && bridge.pos[2] < bridgeStreet.z1);
check('брод даёт вторую переправу (мелководье)', pg.points.some(p => p.name === 'Брод'));
// ГЛАВНОЕ: точка захвата не должна стоять в воде — иначе её «берут» на дне реки.
// Исключения: «Мост через реку» стоит НА мосту (это и правильно — переправа),
// «Брод» — мелководье. Остальные точки должны быть на сухом.
const onBridgeOrFord = new Set(['Мост через реку', 'Брод']);
const inRiver = pg.points.filter(p => pg.water && p.pos[0] > pg.water.x0 && p.pos[0] < pg.water.x1
  && p.pos[2] > pg.water.z0 && p.pos[2] < pg.water.z1 && !onBridgeOrFord.has(p.name));
check('точки захвата не в воде (кроме моста и брода)', inRiver.length === 0, inRiver.map(p => p.name).join(', '));
// дома и постройки тоже не должны стоять в реке
const wetBuildings = [...pg.houses, ...pg.specials].filter(d => pg.water
  && d.pos[0] > pg.water.x0 - 6 && d.pos[0] < pg.water.x1 + 6);
check('дома не в реке', wetBuildings.length === 0, wetBuildings.map(d => d.kind).join(', '));
// на остальных боевых картах сухо — вода не должна «протекать» из карты в карту
const others = MAPS.filter(m => m.id !== 'prigorod');
check('на других картах воды нет', others.every(m => !m.water), others.map(m => m.id).join(', '));
// карта в 4 раза больше города по площади
check('«Пригород» крупнее городской карты', (pg.size ?? 400) >= 800, `${pg.size} м`);

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — вода (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
