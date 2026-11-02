export interface ManifestItem {
  id: string; name: string; category: string; faction: string;
  placeholder: boolean; placeholderSpec?: { builder: string; p: Record<string, any> };
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
}
export interface PlayerInput {
  yaw: number; pitch: number; fwd: number; right: number;
  jump: boolean; sprint: boolean; crouch: boolean; prone: boolean;
}
export type ToWorker =
  | { type: 'init' }
  | { type: 'addBodies'; bodies: BodyDesc[] }
  | { type: 'removeBody'; id: number }
  | { type: 'input'; input: PlayerInput }
  | { type: 'spawnPlayer'; pos: [number, number, number] }
  | { type: 'impulse'; id: number; imp: [number, number, number] }
  | { type: 'explosion'; pos: [number, number, number]; radius: number; impulse: number };
export interface PlayerState {
  pos: [number, number, number]; vel: [number, number, number]; grounded: boolean; stance: 0 | 1 | 2;
  stamina: number; hp: number; sliding: boolean; eye: number;
}
export type FromWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; t: number; ids: Int32Array; tf: Float32Array; player: PlayerState | null; awake: number; total: number; stepMs: number };
