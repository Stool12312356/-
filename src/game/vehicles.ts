// ТЕХНИКА (ТЗ п.4.3): данные машин, ходовая, покрытия, таран.
//
// Раздел ТЗ требует «raycast vehicle»: 4–10 колёс с подвеской, трением, радиусом,
// ведущими/рулевыми; для брони — гусеничная модель. Массы — реальные (ТЗ прямо их
// перечисляет: Т-72 ~41 т, БМП-2 ~14 т, БТР-80 ~13.6 т, УАЗ ~1.7 т, Урал ~8 т).
//
// Здесь только ДАННЫЕ и МАТЕМАТИКА ходовой: их можно проверить без физического
// движка (tools/test-vehicles.mjs) — разгон, тормозной путь, поворот, сцепление
// на покрытии. Сам шаг физики (raycast по колёсам) делает physics/worker.ts,
// потому что только он знает про мир.

export type DriveType = 'wheeled' | 'tracked';

/** Покрытия из ТЗ: разное сцепление и сопротивление качению. */
export interface SurfaceGrip {
  /** коэффициент сцепления с дорогой (1.0 — асфальт) */
  grip: number;
  /** сопротивление качению, доля силы тяжести */
  roll: number;
  /** с какой скоростью машина вязнет (м/с): 0 — не вязнет */
  sink: number;
}

export const VEHICLE_SURFACES: Record<string, SurfaceGrip> = {
  asphalt: { grip: 1.0, roll: 0.012, sink: 0 },
  concrete: { grip: 0.98, roll: 0.013, sink: 0 },
  dirt: { grip: 0.72, roll: 0.03, sink: 0 },
  mud: { grip: 0.45, roll: 0.075, sink: 2.5 },
  snow: { grip: 0.5, roll: 0.05, sink: 1.6 },
  ice: { grip: 0.16, roll: 0.008, sink: 0 },
};

export interface WheelSpec {
  /** позиция точки подвески в локальных координатах машины (x — вправо, y — вверх, z — вперёд) */
  pos: [number, number, number];
  /** радиус колеса, м */
  radius: number;
  /** ход подвески, м */
  travel: number;
  /** жёсткость пружины, Н/м */
  stiffness: number;
  /** демпфирование, Н·с/м */
  damping: number;
  /** ведущее колесо (получает тягу) */
  drive: boolean;
  /** рулевое колесо */
  steer: boolean;
}

export interface VehicleSpec {
  id: string;
  name: string;
  /** модель из манифеста */
  model: string;
  drive: DriveType;
  /** масса, кг (ТЗ) */
  mass: number;
  /** максимальная скорость по шоссе, м/с */
  maxSpeed: number;
  /** сила тяги на ведущих, Н */
  power: number;
  /** максимальный угол поворота колёс, рад */
  steerMax: number;
  /** габариты машины (для коллайдера и тарана), м */
  size: [number, number, number];
  /** броня: толщина в мм (для пробития снарядами) */
  armor: number;
  /** экипаж, мест */
  crew: number;
  wheels: WheelSpec[];
  /** гусеничная модель: скорость разворота на месте, рад/с */
  pivotRate?: number;
}

/** Колесо с параметрами по умолчанию — чтобы не расписывать каждое вручную. */
function wheel(pos: [number, number, number], o: Partial<WheelSpec> = {}): WheelSpec {
  return {
    pos, radius: 0.45, travel: 0.25, stiffness: 22000, damping: 2400,
    drive: false, steer: false, ...o,
  };
}

/** Колёсная формула 4×4: передние рулевые, задние ведущие (или наоборот). */
function wheels4(halfTrack: number, base: number, radius: number, rearDrive = true): WheelSpec[] {
  const x = halfTrack, z = base / 2;
  return [
    wheel([-x, radius, z], { radius, steer: true, drive: !rearDrive }),
    wheel([x, radius, z], { radius, steer: true, drive: !rearDrive }),
    wheel([-x, radius, -z], { radius, drive: rearDrive }),
    wheel([x, radius, -z], { radius, drive: rearDrive }),
  ];
}

/** Колёсная формула 6×6: рулевая первая ось, ведущие — все. */
function wheels6(halfTrack: number, base: number, radius: number): WheelSpec[] {
  const x = halfTrack;
  return [-base / 2, 0, base / 2].flatMap((z, i) => [
    wheel([-x, radius, z], { radius, steer: i === 0, drive: true }),
    wheel([x, radius, z], { radius, steer: i === 0, drive: true }),
  ]);
}

/**
 * Гусеничная модель: 8 опорных катков «в линию» (по 4 на борт) + 2 ведущих колеса.
 * Поворот — разностью скоростей бортов, поэтому рулевых колёс нет.
 */
function tracks(halfTrack: number, base: number, radius: number): WheelSpec[] {
  const out: WheelSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const z = -base / 2 + (base * i) / 3;
    out.push(wheel([-halfTrack, radius, z], { radius, drive: true, stiffness: 90000, damping: 9000 }));
    out.push(wheel([halfTrack, radius, z], { radius, drive: true, stiffness: 90000, damping: 9000 }));
  }
  return out;
}

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'uaz469', name: 'УАЗ-469', model: 'uaz469', drive: 'wheeled',
    mass: 1700, maxSpeed: 27, power: 6500, steerMax: 0.6,
    size: [1.8, 2.0, 4.1], armor: 0, crew: 4,
    wheels: wheels4(0.78, 2.4, 0.38),
  },
  {
    id: 'gaz66', name: 'ГАЗ-66', model: 'gaz66', drive: 'wheeled',
    mass: 3400, maxSpeed: 25, power: 12000, steerMax: 0.55,
    size: [2.3, 2.4, 5.7], armor: 0, crew: 12,
    wheels: wheels4(0.95, 3.3, 0.5, false),
  },
  {
    id: 'ural4320', name: 'Урал-4320', model: 'ural4320', drive: 'wheeled',
    mass: 8000, maxSpeed: 22, power: 22000, steerMax: 0.5,
    size: [2.5, 2.7, 7.4], armor: 0, crew: 3,
    wheels: wheels6(1.0, 4.4, 0.55),
  },
  {
    id: 'btr80', name: 'БТР-80', model: 'btr80', drive: 'wheeled',
    mass: 13600, maxSpeed: 22, power: 42000, steerMax: 0.5,
    size: [2.9, 2.4, 7.7], armor: 10, crew: 10,
    wheels: wheels4(1.2, 4.4, 0.6, false).concat([
      // средняя ось БТР-80: 8×8, все ведущие
      wheel([-1.2, 0.6, 0], { radius: 0.6, drive: true }),
      wheel([1.2, 0.6, 0], { radius: 0.6, drive: true }),
    ]),
  },
  {
    id: 'bmp2', name: 'БМП-2', model: 'bmp2', drive: 'tracked',
    mass: 14000, maxSpeed: 18, power: 42000, steerMax: 0, pivotRate: 0.9,
    size: [3.1, 2.3, 6.7], armor: 30, crew: 10,
    wheels: tracks(1.25, 3.9, 0.32),
  },
  {
    id: 't72', name: 'Т-72', model: 't72', drive: 'tracked',
    mass: 41000, maxSpeed: 16, power: 95000, steerMax: 0, pivotRate: 0.6,
    size: [3.6, 2.2, 9.5], armor: 200, crew: 3,
    wheels: tracks(1.5, 5.6, 0.35),
  },
];

/**
 * ГДЕ СТОИТ ТЕХНИКА НА КАРТЕ (ТЗ п.4.3: «игрок должен мочь сесть и поехать»).
 * Позиции берутся от баз сторон: у своих — УАЗ и БТР, у противника — БМП.
 * Угол — куда смотрит нос (0 — на +Z).
 */
export const VEHICLE_SPAWNS: Record<string, { id: string; pos: [number, number, number]; yaw: number }[]> = {
  // Позиции — по плану квартала (maps.ts): у своей базы на Советской и у базы врага
  // за Гагарина. Стоят на проезжей части улиц, не в домах и не на точках захвата.
  spalny: [
    { id: 'uaz469', pos: [-84, 0.6, 32], yaw: 0.0 },
    { id: 'btr80', pos: [-84, 0.8, 40], yaw: 0.0 },
    { id: 'bmp2', pos: [82, 0.6, -24], yaw: Math.PI / 2 },
  ],
  // «Пригород»: 4×4 км, техника — главное (ТЗ п.9.3). Свои машины у колхоза, враг —
  // на военной базе. Река между ними: переправа по мосту (x −62…−24) или вброд.
  port: [
    { id: 'uaz469', pos: [-245, 0.6, -135], yaw: 0 },
    { id: 'gaz66', pos: [-245, 0.8, -145], yaw: 0 },
    { id: 'btr80', pos: [245, 0.8, -135], yaw: Math.PI },
    { id: 'bmp2', pos: [245, 0.6, -145], yaw: Math.PI },
  ],
  prigorod: [
    { id: 'uaz469', pos: [-310, 0.6, 16], yaw: 0 },
    { id: 'gaz66', pos: [-310, 0.8, 26], yaw: 0 },
    { id: 'ural4320', pos: [-300, 0.8, 40], yaw: 0 },
    { id: 'btr80', pos: [300, 0.8, -60], yaw: Math.PI },
    { id: 'bmp2', pos: [292, 0.6, -80], yaw: Math.PI },
    { id: 't72', pos: [280, 0.9, -100], yaw: Math.PI },
  ],
  zavod: [
    { id: 'uaz469', pos: [-34, 0.6, -18], yaw: 0.2 },
    { id: 'btr80', pos: [-26, 0.8, -24], yaw: 1.0 },
    { id: 'bmp2', pos: [44, 0.6, -104], yaw: Math.PI },
  ],
};

export const vehicleById = (id: string) => VEHICLES.find(v => v.id === id) ?? VEHICLES[0];

// ---------------------------------------------------------------------------
// МАТЕМАТИКА ХОДОВОЙ — без физического движка, поэтому проверяется тестом.
// ---------------------------------------------------------------------------

/**
 * Тяга на колёсах с учётом сцепления: сила не может превышать μ·N, иначе колесо
 * буксует. Это то, из-за чего на льду танк «не едет», а на асфальте — рвёт.
 */
export function traction(spec: VehicleSpec, surface: string, driveWheels = spec.wheels.filter(w => w.drive).length): number {
  const g = 9.81;
  const grip = (VEHICLE_SURFACES[surface] ?? VEHICLE_SURFACES.dirt).grip;
  // ведущие колёса несут не всю массу: для колёсной схемы берём долю по числу осей
  const axles = spec.drive === 'tracked' ? 1 : Math.max(1, Math.round(spec.wheels.length / 2));
  const loadShare = spec.drive === 'tracked' ? 1 : Math.min(1, 0.55 + 0.15 * axles);
  const normal = spec.mass * g * loadShare;
  const limit = grip * normal;
  return Math.min(spec.power, limit, spec.power * Math.max(0.25, grip));
}

/**
 * Верхняя скорость НА КОНКРЕТНОМ ПОКРЫТИИ.
 *
 * Паспортная `maxSpeed` — это шоссе. На слабом сцеплении реализовать всю мощность
 * нельзя (колесо/гусеница буксует), плюс на мягком грунте добавляется сопротивление
 * качению. Отсюда: доля доступной тяги переводится в долю скорости.
 * На асфальте — паспортная, на льду УАЗ едет ~вдвое медленнее и «плывёт».
 */
export function topSpeed(spec: VehicleSpec, surface: string): number {
  const g = 9.81;
  const s = VEHICLE_SURFACES[surface] ?? VEHICLE_SURFACES.dirt;
  const asphalt = VEHICLE_SURFACES.asphalt;
  const usable = Math.max(0, traction(spec, surface) - s.roll * spec.mass * g);
  const base = Math.max(1, traction(spec, 'asphalt') - asphalt.roll * spec.mass * g);
  return Math.min(spec.maxSpeed, spec.maxSpeed * Math.sqrt(usable / base));
}

/** Время разгона 0→v, с (по средней тяге — для проверки «не улитка и не ракета»). */
export function accelTime(spec: VehicleSpec, surface: string, v: number): number {
  const F = traction(spec, surface) - (VEHICLE_SURFACES[surface] ?? VEHICLE_SURFACES.dirt).roll * spec.mass * 9.81;
  if (F <= 0) return Infinity;
  return (spec.mass * Math.min(v, topSpeed(spec, surface))) / F;
}

/**
 * Разворот гусеничной машины на месте: борта в противофазе. Возвращает угловую
 * скорость, рад/с (ТЗ: поворот на месте для гусениц).
 */
export function pivotRate(spec: VehicleSpec, surface: string): number {
  if (spec.drive !== 'tracked') return 0;
  const s = VEHICLE_SURFACES[surface] ?? VEHICLE_SURFACES.dirt;
  return (spec.pivotRate ?? 0.6) * Math.max(0.2, s.grip);
}

/**
 * ТАРАН (ТЗ): импульс столкновения и урон обоим. Масса машины против массы цели;
 * лёгкий забор сносится без последствий, бетонная стена бьёт по машине.
 */
export interface RammingResult {
  /** импульс, кг·м/с */
  impulse: number;
  /** урон машине */
  damageVehicle: number;
  /** урон цели */
  damageTarget: number;
  /** снесло ли цель (забор, гараж, киоск — да; панелька — нет) */
  destroyed: boolean;
}

export function ram(spec: VehicleSpec, speed: number, target: { mass: number; hp: number; breakable: boolean }): RammingResult {
  const v = Math.max(0, Math.min(speed, spec.maxSpeed));
  const mEff = (spec.mass * target.mass) / (spec.mass + target.mass);   // приведённая масса
  const impulse = mEff * v;
  // урон цели — доля её HP от импульса; урон машине — от того, что цель «не поддалась»
  const damageTarget = target.breakable ? target.hp : Math.min(target.hp, impulse / 900);
  const damageVehicle = target.breakable ? 0 : Math.min(60, (impulse / Math.max(1, spec.mass)) * 6);
  return { impulse, damageVehicle, damageTarget, destroyed: target.breakable && damageTarget >= target.hp };
}

/** Массы из ТЗ — проверяются тестом, чтобы цифры не «уплыли» при правках. */
export const TZ_MASSES: Record<string, number> = {
  t72: 41000, bmp2: 14000, btr80: 13600, uaz469: 1700, ural4320: 8000,
};
