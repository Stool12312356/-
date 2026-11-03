import type { Surface } from './types';

/** Материал вокселя одинаков в игровом мире и физическом воркере. */
export const VOXEL_MATERIAL: Record<number, Surface> = {
  0: 'concrete', 1: 'concrete', 2: 'brick', 3: 'glass', 4: 'wood', 5: 'concrete',
};
