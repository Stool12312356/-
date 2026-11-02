export interface ManifestItem {
  id: string; name: string; category: string; faction: string;
  placeholder: boolean; placeholderSpec?: { builder: string; p: Record<string, any> };
  /** Предмет строится кодом (панельки), файла нет и не будет — это не заглушка. */
  procedural?: string;
  mass?: number; hp?: number; locomotion?: string; note?: string;
  source?: string; file?: string; collider?: string;
  forward?: string; forwardVerified?: boolean;
  normalize?: { scale: number; rotY: number; offset: [number, number, number] };
  size?: [number, number, number]; tris?: number; animations?: string[];
}
export interface Manifest { generated: string; items: ManifestItem[]; unmappedFiles: string[]; }

export type Shape =
  | { t: 'box'; he: [number, number, number]; pos?: [number, number, number]; rotY?: number }
  | { t: 'ball'; r: number; pos?: [number, number, number] }
  | { t: 'cyl'; hh: number; r: number; pos?: [number, number, number] }
  | { t: 'hull'; points: Float32Array | number[]; pos?: [number, number, number] }
  | { t: 'trimesh'; verts: Float32Array; idx: Uint32Array }
  | { t: 'heightfield'; nrows: number; ncols: number; heights: Float32Array; scale: [number, number, number] };

export interface BodyDesc {
  id: number; kind: 'static' | 'dynamic'; pos: [number, number, number]; rotY?: number; quat?: [number, number, number, number];
  shapes: Shape[]; mass?: number; friction?: number; restitution?: number;
  linDamp?: number; angDamp?: number; sleeping?: boolean;
  /** материал поверхности (по умолчанию concrete) */
  surface?: Surface;
  /** битовая маска категории для лучей/коллизий, см. GROUP */
  group?: number;
  /** признак «это панель дома» — по нему считается урон зданию */
  building?: boolean;
  /** можно ли это пробить пулей сильнее прочего (дерево, стекло) */
  thin?: boolean;
  /** для зданий: индекс панели для каждой формы (порядок совпадает с shapes) */
  panels?: number[];
}
/** Материал поверхности: от него зависит, пробьёт ли пуля, срикошетит ли и какой будет звук. */
export type Surface = 'concrete' | 'panel' | 'brick' | 'wood' | 'metal' | 'glass' | 'plaster' | 'armor' | 'dirt' | 'water';

/** Категории тел для баллистики: пуля по-разному взаимодействует со стенами и с техникой. */
export const GROUP = {
  WORLD: 0x0001,     // террайн, статика
  BUILDING: 0x0002,  // панели домов (разрушаемые)
  PROP: 0x0004,      // техника, пропсы, обломки
  PLAYER: 0x0008,    // игрок и боты
} as const;

export interface PlayerInput {
  yaw: number; pitch: number; fwd: number; right: number;
  jump: boolean; sprint: boolean; crouch: boolean; prone: boolean;
}
/** Один шаг трассировки снаряда делает воркер: он владеет миром. */
export interface Tracer {
  id: number;                          // id снаряда на стороне игры
  pos: [number, number, number];        // текущая позиция (обновляется воркером)
  vel: [number, number, number];        // м/с
  prev: [number, number, number];       // позиция до шага — для отрисовки трассера
  life: number;                         // сколько ещё живёт, сек
  /** баллистический коэффициент: больше = меньше тормозит воздух */
  bc?: number;
  penetration: number;                  // сколько «бронепробития» осталось
  owner: number;                        // чей выстрел (0 = игрок)
  explosive?: { radius: number; damage: number }; // РПГ/ВОГ: взрыв при попадании
}

export interface Impact {
  kind: 'bullet' | 'explosive' | 'fragment';
  tracer: number;
  pos: [number, number, number];
  normal: [number, number, number];
  surface: Surface;
  /** пробила ли пуля поверхность */
  penetrated: boolean;
  /** урон, который надо нанести объекту (здание/бот/техника) */
  damage: number;
  /** id тела в физике (-1 = статика) */
  bodyId: number;
  /** id панели дома (-1 если не дом) */
  panel: number;
}

export type ToWorker =
  | { type: 'init' }
  | { type: 'addBodies'; bodies: BodyDesc[] }
  | { type: 'removeBody'; id: number }
  | { type: 'input'; input: PlayerInput }
  | { type: 'spawnPlayer'; pos: [number, number, number] }
  | { type: 'impulse'; id: number; imp: [number, number, number] }
  | { type: 'explosion'; pos: [number, number, number]; radius: number; impulse: number }
  /** добавить снаряд (пуля или ракета). direction нормализован, speed в м/с */
  | { type: 'shoot'; tracer: Tracer }
  /** убрать одну панель дома из физики (она уничтожена) */
  | { type: 'removePanel'; bodyId: number; panel: number };

export interface PlayerState {
  pos: [number, number, number]; vel: [number, number, number]; grounded: boolean; stance: 0 | 1 | 2;
  stamina: number; hp: number; sliding: boolean; eye: number;
}
export type FromWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; t: number; ids: Int32Array; tf: Float32Array; player: PlayerState | null; awake: number; total: number; stepMs: number }
  /** трассеры после шага физики (для отрисовки) */
  | { type: 'tracers'; tracers: Tracer[] }
  /** попадания за шаг: пуля/осколок/взрыв */
  | { type: 'impacts'; impacts: Impact[] };
