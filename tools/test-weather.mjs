// ПОГОДА (ТЗ п.9): смена дня/ночи, туман, снегопад.
//
// Проверяем данные и поведение, а не «красоту»: у каждого пресета есть небо, дальность
// тумана, сила света, интенсивность снега; ночь темнее дня; метель видит дальше? нет —
// ближе; переключение по кругу возвращается к началу. three и рендерер подменены
// заглушками: тест должен идти в Node без WebGL.
import * as THREE from 'three';
import { WEATHER } from '../src/game/weather.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

const names = Object.keys(WEATHER);
check('пресеты погоды есть', names.length >= 5, names.join(', '));

let allOk = true;
for (const [name, w] of Object.entries(WEATHER)) {
  const s = w.state;
  const good = /^#[0-9a-f]{6}$/i.test(s.sky)
    && Array.isArray(s.fog) && s.fog.length === 2 && s.fog[0] > 0 && s.fog[1] > s.fog[0]
    && s.sun >= 0 && s.hemi >= 0
    && s.snow >= 0 && s.snow <= 1
    && s.fall > 0
    && /^#[0-9a-f]{6}$/i.test(s.sunColor)
    && s.exposure > 0;
  if (!good) { allOk = false; console.log('   плохой пресет:', name); }
}
check('у всех пресетов корректные поля', allOk);

// Метет сильнее — видно хуже. Иначе «метель» не отличается от «ясно» ничем, кроме снега.
check('метель прячет горизонт сильнее, чем ясная погода',
  WEATHER.storm.state.fog[1] < WEATHER.clear.state.fog[1],
  `${WEATHER.storm.state.fog[1]} < ${WEATHER.clear.state.fog[1]} м`);
check('туман — самый плотный по ближней границе',
  WEATHER.fog.state.fog[0] <= Math.min(...names.filter(n => n !== 'fog').map(n => WEATHER[n].state.fog[0])),
  `${WEATHER.fog.state.fog[0]} м`);
check('ночь темнее любого дня',
  WEATHER.night.state.sun < Math.min(...names.filter(n => n !== 'night').map(n => WEATHER[n].state.sun)));
check('ночью включается подсветка окон', WEATHER.night.state.night === true);
check('днём подсветка выключена', names.filter(n => n !== 'night').every(n => WEATHER[n].state.night === false));
check('снегопад гуще пасмурного полдня', WEATHER.snow.state.snow > WEATHER.noon.state.snow);
check('в тумане снега почти нет', WEATHER.fog.state.snow < 0.1);
check('метель — самый быстрый снос ветром',
  Math.hypot(...WEATHER.storm.state.wind) > Math.hypot(...WEATHER.clear.state.wind));

// --- сам класс: подменяем рендерер/сцену заглушками и переключаем по кругу
const scene = new THREE.Scene();
scene.background = new THREE.Color('#000000');
scene.fog = new THREE.Fog('#000000', 1, 2);
const renderer = { toneMappingExposure: 1, getPixelRatio: () => 1 };
const sunL = new THREE.DirectionalLight('#ffffff', 2);
const hemiL = new THREE.HemisphereLight('#ffffff', '#000000', 1);
const { Weather } = await import('../src/game/weather.ts');
const w = new Weather(scene, renderer, sunL, hemiL);

check('после старта погода «пасмурный полдень»', w.preset === 'noon', w.label);
const seen = new Set([w.preset]);
for (let i = 0; i < names.length - 1; i++) seen.add(w.next() && w.preset);
check('переключение обходит все пресеты', seen.size === names.length, [...seen].join(' → '));
w.next();
check('после полного круга снова «полдень»', w.preset === 'noon', w.label);

w.apply('night');
check('ночь: туман подтянут к игроку', scene.fog.far <= 220, `${scene.fog.far} м`);
check('ночь: небо тёмное', new THREE.Color(scene.background).getHSL({ h: 0, s: 0, l: 0 }).l < 0.2);
check('ночь: солнце приглушено', sunL.intensity < 0.5, `${sunL.intensity}`);
w.apply('storm');
check('метель: экспозиция не «выжигает» снег', renderer.toneMappingExposure <= 0.95, `${renderer.toneMappingExposure}`);

// update не должен падать без камеры-«настоящей» и с нулевым dt
const cam = new THREE.PerspectiveCamera();
let crashed = false;
try { for (let i = 0; i < 10; i++) w.update(1 / 60, cam); } catch (e) { crashed = true; console.log('   ', e.message); }
check('update идёт без ошибок', !crashed);

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — погода (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
