// tools/lib/vmpose.mjs — ЕДИНАЯ математика посадки вьюмодели.
// Используется и предпросмотром (tools/preview-viewmodel.mjs), и тестом (tools/test-viewmodel.mjs).
// ВАЖНО: это зеркало src/game/combat.ts:placeViewModel. Если меняете позу там — меняйте здесь,
// иначе тест будет проверять не то, что видит игрок.
export const FOV_HIP = 75;

/** Поза вьюмодели. top/rear — габариты модели в её локальных осях (масштаб учтён). */
export function poseFor(cfg, { top, rear, opticLift = 0, adsT = 0 }) {
  const adsY = -top - opticLift;
  const adsZ = -(rear + 0.20);
  return {
    pos: [
      cfg.x * (1 - adsT),
      cfg.y * (1 - adsT) + adsY * adsT,
      cfg.z * (1 - adsT) + adsZ * adsT,
    ],
    rotY: (1 - adsT) * (0.035 + (cfg.rotY * Math.PI) / 180) + adsT * ((cfg.rotY * Math.PI) / 180),
    adsT,
  };
}

/** Проекция точки (в пространстве камеры) в экранные доли 0..1. Камера смотрит в -Z. */
export function project(p, fov, aspect) {
  const tanY = Math.tan((fov * Math.PI) / 180 / 2);
  const z = -p[2];
  return [0.5 + p[0] / (z * tanY * aspect) / 2, 0.5 - p[1] / (z * tanY) / 2, z];
}

export const ADS_FOV = { rifle: 55, scoped: 22, pistol: 55 };
