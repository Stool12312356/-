// ТЕХНИКА НА КАРТЕ: машины из VEHICLE_SPAWNS реально стоят на земле и не в зданиях.
// Проверка на данных карты (как test-maps): высота террейна, габариты домов, спавны.
import { VEHICLE_SPAWNS, VEHICLES, vehicleById, VEHICLE_SURFACES } from '../src/game/vehicles.ts';
import { MAPS } from '../src/game/maps.ts';
import { heightAt, setWorldSize } from '../src/game/terrain.ts';
import { buildVoxelHouse } from '../src/game/voxelgen.ts';
import { buildSpecial } from '../src/game/barracks.ts';

let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) { ok++; console.log(`  ok   ${n} ${i}`); } else { bad++; console.log(`  FAIL ${n} ${i}`); } };

for (const map of MAPS) {
  const list = VEHICLE_SPAWNS[map.id] ?? [];
  // Боевые карты обязаны иметь технику (ТЗ п.4.3). На полигоне её нет специально:
  // пользователь просил убрать выставку техники с играбельных карт, а полигон —
  // стрельбище, где кататься негде.
  if (map.mode === 'training') {
    check(`${map.id}: полигон без техники`, list.length === 0, `${list.length} машин`);
    continue;
  }
  check(`${map.id}: на карте есть техника`, list.length >= 2, `${list.length} машин`);
  // габариты зданий — машина не должна стоять внутри
  const bxs = [];
  for (const h of map.houses) {
    const m = buildVoxelHouse({ kind: h.kind, sections: h.sections });
    const q = Math.abs(Math.round(h.rotY / (Math.PI / 2))) % 2 === 1;
    const sx = q ? m.size[2] : m.size[0], sz = q ? m.size[0] : m.size[2];
    bxs.push([h.pos[0] - sx / 2, h.pos[2] - sz / 2, h.pos[0] + sx / 2, h.pos[2] + sz / 2, h.kind]);
  }
  for (const sp of map.specials) {
    const m = buildSpecial(sp.kind, sp.sections);
    const q = Math.abs(Math.round(sp.rotY / (Math.PI / 2))) % 2 === 1;
    const sx = q ? m.size[2] : m.size[0], sz = q ? m.size[0] : m.size[2];
    bxs.push([sp.pos[0] - sx / 2, sp.pos[2] - sz / 2, sp.pos[0] + sx / 2, sp.pos[2] + sz / 2, sp.kind]);
  }

  for (const vs of list) {
    const spec = vehicleById(vs.id);
    check(`${map.id}/${vs.id}: модель есть в данных`, !!spec && VEHICLES.includes(spec));
    // высота земли под машиной: колёса должны стоять на грунте, а не висеть/тонуть
    // ВАЖНО: рельеф зависит от размера карты (ТЗ п.9: 400 м у города, 800 у «Пригорода»),
    // поэтому размер регистрируем до проверки высот — иначе земля «в холмах».
    setWorldSize(map.size ?? 400);
    const gy = heightAt(vs.pos[0], vs.pos[2]);
    check(`${map.id}/${vs.id}: стоит на земле`, Math.abs(vs.pos[1] - gy) < 1.6,
      `y=${vs.pos[1].toFixed(2)}, земля ${gy.toFixed(2)}`);
    // не внутри здания
    const inside = bxs.find(b => vs.pos[0] > b[0] - 1 && vs.pos[0] < b[2] + 1 && vs.pos[2] > b[1] - 1 && vs.pos[2] < b[3] + 1);
    check(`${map.id}/${vs.id}: не в здании`, !inside, inside ? `внутри ${inside[4]}` : '');
    // не на точке захвата (там бой, машину нельзя «спавнить в мясорубке»)
    const onPoint = map.points.find(p => Math.hypot(p.pos[0] - vs.pos[0], p.pos[2] - vs.pos[2]) < p.radius * 0.8);
    check(`${map.id}/${vs.id}: не на точке захвата`, !onPoint, onPoint ? `на точке «${onPoint.name}»` : '');
    // рядом с базой своей стороны (ТЗ: техника у баз)
    // на больших картах (4×4 км) базы дальше друг от друга, поэтому радиус «у базы»
    // масштабируется вместе с картой: 45 м для 400-метровой, 90 м для 800-метровой
    const nearR = Math.round(45 * ((map.size ?? 400) / 400));
    const nearOwn = Math.hypot(map.spawns.own[0] - vs.pos[0], map.spawns.own[2] - vs.pos[2]) < nearR;
    const nearFoe = Math.hypot(map.spawns.foe[0] - vs.pos[0], map.spawns.foe[2] - vs.pos[2]) < nearR;
    check(`${map.id}/${vs.id}: у базы`, nearOwn || nearFoe, nearOwn ? 'своя база' : nearFoe ? 'база врага' : 'далеко от обеих');
  }
}

// покрытия: на карте «Спальный район» зимой машина должна чувствовать снег, не асфальт
check('покрытие «снег» есть в таблице', !!VEHICLE_SURFACES.snow && VEHICLE_SURFACES.snow.grip < VEHICLE_SURFACES.asphalt.grip);
check('модели техники не подменяются: у каждой машины свой id модели',
  new Set(VEHICLES.map(v => v.model)).size === VEHICLES.length,
  VEHICLES.map(v => `${v.id}→${v.model}`).join(', '));

console.log(`\nИТОГ: ${bad === 0 ? 'OK' : 'ПРОВАЛ'} — техника на картах (${ok} проверок, ${bad} ошибок)`);
process.exit(bad === 0 ? 0 : 1);
