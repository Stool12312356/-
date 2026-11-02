// Окружение для PBR. Металл в three.js без env map физически корректен, но визуально чёрен:
// PBR-металл не имеет диффузного отражения и берёт весь цвет из окружения.
// На скриншотах из-за этого ГАЗ-66 и Ми-8 были чёрными силуэтами.
// Решение: рисуем крошечную зимнюю панораму в canvas, гоняем её через PMREMGenerator,
// получаем irradiance/radiance-карты и ставим их в scene.environment. Плюс подбираем
// envMapIntensity, чтобы техника не выцветала.
import * as THREE from 'three';

export function setupEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const W = 256, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  // небо: сверху холодное, к горизонту светлое (пасмурная зима)
  const sky = g.createLinearGradient(0, 0, 0, H * 0.52);
  sky.addColorStop(0, '#5f7d9c'); sky.addColorStop(0.65, '#b9c8d6'); sky.addColorStop(1, '#e6ecf1');
  g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.52);
  // земля: снег с серым бетоном
  const gr = g.createLinearGradient(0, H * 0.52, 0, H);
  gr.addColorStop(0, '#dfe4e7'); gr.addColorStop(0.4, '#b9bdb8'); gr.addColorStop(1, '#6f736c');
  g.fillStyle = gr; g.fillRect(0, H * 0.52, W, H * 0.48);
  // солнце — яркое пятно, от которого бликует металл
  const sun = g.createRadialGradient(W * 0.68, H * 0.2, 2, W * 0.68, H * 0.2, 42);
  sun.addColorStop(0, 'rgba(255,247,228,1)'); sun.addColorStop(0.25, 'rgba(255,240,210,.75)'); sun.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = sun; g.fillRect(0, 0, W, H);
  // пара тёмных силуэтов зданий у горизонта — чтобы в отражениях не было «мыла»
  g.fillStyle = 'rgba(58,64,70,.55)';
  for (let i = 0; i < 7; i++) { const bw = 14 + (i % 3) * 9, bh = 8 + (i % 4) * 6; g.fillRect((i * 37) % W, H * 0.52 - bh, bw, bh); }

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  tex.dispose(); pmrem.dispose();
  return env;
}
