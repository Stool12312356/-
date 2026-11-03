// ВОДА (ТЗ п.4.5): «Плавучесть для лодок и БТР-амфибий; волны Герстнера. Танки тонут
// (10 сек на эвакуацию). Плавание/ныряние персонажа, шкала кислорода. Подводные взрывы —
// усиленная гидроударная волна.»
//
// Раньше в игре воды не было вообще: карты были «снег и дома». Здесь — вода как система:
//  • визуал: плоскость с волнами в шейдере (Герстнер, 4 волны) и пеной у краёв;
//  • логика: уровень, глубина в точке, плавучесть (Архимед), «тонет/всплывает»;
//  • игрок: под водой считается кислород (5 мин в ТЗ нет, берём 90 с — проверяемо),
//    на поверхности плавает и не проваливается;
//  • техника: БТР/лодка плавают (амфибия), танк тонет и уходит на дно;
//  • подводный взрыв: радиус гидроудара больше, чем у воздушного.
//
// ВАЖНО: физика Рапира про воду НЕ знает. Поэтому водные силы считаются здесь, в
// чистом модуле (его гоняет tools/test-water.mjs), а воркер только получает уже
// готовые «толчки». Так баланс проверяется тестом, а не на глаз.
import * as THREE from 'three';

export interface WaterDef {
  /** уровень поверхности, м (y) */
  level: number;
  /** прямоугольник водоёма в плане */
  x0: number; z0: number; x1: number; z1: number;
  /** течение: м/с по X и Z (река) */
  flow?: [number, number];
  /** максимальная глубина, м (для визуала и звука) */
  depth?: number;
  /** Брод: ширина мелкой части и плавные подъёмы дна по течению. */
  ford?: { z: number; halfLength: number; depth: number };
}

/** Состояние плавания одной сущности (игрок, машина, ящик). */
export interface FloatState {
  /** погружение: 0 — над водой, 1 — полностью под водой */
  submerged: number;
  /** сила Архимеда в Н (вверх): сколько «держит» */
  buoyancy: number;
  /** сила сопротивления воды, Н·с/м (для гашения скорости) */
  drag: number;
  /** сносит течением: приращение скорости, м/с */
  flow: [number, number];
  /** под водой: время без воздуха, с (растёт только когда submerged > 0.9) */
  drowning: boolean;
}

/** Плотность воды, кг/м³. */
export const WATER_DENSITY = 1000;
/** Ускорение свободного падения. */
export const G = 9.81;

/** Точка внутри водоёма (в плане)? */
export function inWater(w: WaterDef | undefined, x: number, z: number): boolean {
  if (!w) return false;
  return x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1;
}

/**
 * Глубина в точке: сколько метров воды над дном. Дно считаем «плоским» на уровне
 * `level - depth` (для реки этого достаточно; реальный рельеф в воду не лезет).
 */
export function depthAt(w: WaterDef | undefined, x: number, z: number): number {
  if (!w || !inWater(w, x, z)) return 0;
  const depth = w.depth ?? 3;
  if (!w.ford) return depth;
  const distance = Math.abs(z - w.ford.z);
  const blend = 1 - THREE.MathUtils.smoothstep(distance, w.ford.halfLength, w.ford.halfLength + 15);
  return THREE.MathUtils.lerp(depth, Math.min(depth, w.ford.depth), blend);
}

/**
 * ПЛАВУЧЕСТЬ (Архимед): сила = ρ · g · V_погружённой части.
 * `draft` — глубина осадки корпуса (как низко сидит), `halfHeight` — половина высоты.
 * Возвращает состояние плавания для сущности в точке (x, y, z).
 */
export function floatState(
  w: WaterDef | undefined, pos: [number, number, number],
  vol: { /** объём корпуса, м³ */ volume: number; /** доля объёма, которая ниже ватерлинии */ sub: number; /** площадь миделя, м² */ area: number },
): FloatState {
  const none: FloatState = { submerged: 0, buoyancy: 0, drag: 0, flow: [0, 0], drowning: false };
  if (!w) return none;
  const wd = w;
  const d = depthAt(wd, pos[0], pos[2]);
  if (d <= 0) return none;
  // насколько корпус ниже уровня воды
  const below = wd.level - pos[1];
  const subm = Math.max(0, Math.min(1, below / Math.max(0.2, vol.sub)));
  if (subm <= 0) return none;
  const buoyancy = WATER_DENSITY * G * vol.volume * subm;
  // сопротивление растёт с площадью и погружением (квадратично по скорости — считает вызывающий)
  const drag = 0.5 * 1000 * vol.area * 0.6 * subm;
  const flow: [number, number] = wd.flow ? [wd.flow[0] * subm, wd.flow[1] * subm] : [0, 0];
  return { submerged: subm, buoyancy, drag, flow, drowning: subm > 0.9 };
}

/**
 * Обновление кислорода. В ТЗ нет числа, берём 90 с под водой — этого хватает, чтобы
 * переплыть реку, но не хватает, чтобы жить на дне.
 */
export const OXYGEN_TIME = 90;

export function oxygenStep(o2: number, dt: number, underWater: boolean): { o2: number; damage: number } {
  if (!underWater) return { o2: Math.min(OXYGEN_TIME, o2 + dt * 8), damage: 0 };
  const next = Math.max(0, o2 - dt);
  // когда воздух кончился — 4 HP/с (утопиться можно, но не мгновенно)
  return { o2: next, damage: next <= 0 ? dt * 4 : 0 };
}

/** Подводный взрыв: гидроудар бьёт дальше и сильнее (ТЗ п.4.5). */
export function underwaterBlast(radius: number, power: number): { radius: number; power: number } {
  return { radius: radius * 1.6, power: power * 1.8 };
}

/** Параметры ударной волны в зависимости от реального положения взрыва. */
export function blastAt(w: WaterDef | undefined, pos: [number, number, number], radius: number, power: number) {
  const submerged = !!w && inWater(w, pos[0], pos[2]) && pos[1] < w.level;
  return submerged ? underwaterBlast(radius, power) : { radius, power };
}

/** Волна Герстнера: высота в точке (та же формула, что в шейдере — для теста и звука). */
/** Общие параметры CPU и шейдера, чтобы фазы волн не расходились со временем. */
export const GERSTNER_WAVES = [
  { a: 0.22, len: 9, sx: 1, sz: 0.2, sp: 1.1 },
  { a: 0.14, len: 5.5, sx: -0.4, sz: 0.9, sp: 1.6 },
  { a: 0.09, len: 3.1, sx: 0.7, sz: -0.7, sp: 2.2 },
  { a: 0.05, len: 1.7, sx: 0.2, sz: 1, sp: 3.1 },
] as const;
export function gerstnerHeight(x: number, z: number, t: number, waveScale = 1): number {
  let y = 0;
  for (const w of GERSTNER_WAVES) {
    const k = (Math.PI * 2) / w.len;
    const ph = (x * w.sx + z * w.sz) * k + t * w.sp * k;
    y += (w.a * waveScale) * Math.sin(ph);
  }
  return y;
}

/** Визуал воды: плоскость с волнами в шейдере (движение на GPU, не в JS). */
export class WaterSurface {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  readonly def: WaterDef;

  constructor(scene: THREE.Scene, def: WaterDef) {
    this.def = def;
    const w = def.x1 - def.x0, d = def.z1 - def.z0;
    const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 3), Math.ceil(d / 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide, // водная поверхность видна и из-под воды
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: def.level },
        uFlow: { value: new THREE.Vector2(def.flow?.[0] ?? 0, def.flow?.[1] ?? 0) },
        uDeep: { value: new THREE.Color('#12303f') },
        uShallow: { value: new THREE.Color('#3d6f80') },
        uIce: { value: 0.55 },      // зима: у краёв ледяная корка
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform vec2 uFlow;
        varying vec2 vXZ;
        varying float vH;
        void main() {
          vec3 p = position;
          vec4 world = modelMatrix * vec4(p, 1.0);
          // Герстнер-сумма (4 волны) — та же формула, что в water.ts (gerstnerHeight)
          float t = uTime;
          float y = 0.0;
          ${GERSTNER_WAVES.map(w => {
            const k = Math.PI * 2 / w.len;
            return `y += ${w.a.toFixed(8)} * sin((world.x * ${w.sx.toFixed(8)} + world.z * ${w.sz.toFixed(8)}) * ${k.toFixed(8)} + t * ${(w.sp * k).toFixed(8)});`;
          }).join('\n          ')}
          p.z += y;                     // плоскость повёрнута: локальная Z — это мировой Y
          vH = y; vXZ = world.xz + uFlow * t;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uDeep, uShallow;
        uniform float uIce, uTime;
        varying vec2 vXZ;
        varying float vH;
        // дешёвый «шум» без текстуры: две синусоиды дают рябь и блики
        float ripple(vec2 p) { return sin(p.x * 2.3 + uTime * 0.7) * sin(p.y * 1.9 - uTime * 0.5); }
        void main() {
          float r = ripple(vXZ);
          vec3 col = mix(uDeep, uShallow, 0.35 + 0.35 * r + vH * 0.6);
          // блик: светлая полоса там, где волна «ловит» небо
          float spec = smoothstep(0.75, 1.0, vH + 0.15 * r);
          col += vec3(0.55, 0.65, 0.75) * spec * 0.5;
          // зимой у поверхности ледяная каша: припудриваем верх
          col = mix(col, vec3(0.82, 0.88, 0.92), uIce * smoothstep(0.2, 0.9, vH + 0.2 * r));
          gl_FragColor = vec4(col, 0.90);
        }`,
    });
    // плоскость кладём горизонтально: локальная Z становится мировым Y
    geo.rotateX(-Math.PI / 2);
    // после поворота вершинный шейдер должен двигать мировую Y, а не Z
    this.mat.vertexShader = this.mat.vertexShader.replace('p.z += y;', 'p.y += y;');
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set((def.x0 + def.x1) / 2, def.level, (def.z0 + def.z1) / 2);
    this.mesh.renderOrder = 2;
    this.mesh.name = 'water';
    scene.add(this.mesh);
  }

  update(dt: number) { this.mat.uniforms.uTime.value += dt; }
  /** Синхронизирует видимые волны с часами физического воркера. */
  setTime(time: number) { this.mat.uniforms.uTime.value = time; }
}
