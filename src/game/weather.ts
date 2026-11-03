// ПОГОДА И ВРЕМЯ СУТОК (ТЗ п.9: «смена дня/ночи, погода (дождь, туман, снегопад)»).
//
// Раньше на карте всегда был один и тот же пасмурный зимний полдень: небо #cdd9e4,
// туман 120–420 м, солнце 2.4. Играть в этом можно, но «снегопад» и «ночь» из ТЗ
// отсутствовали как класс. Здесь они есть — и переключаются клавишей N и в консоли
// (`weather.set('snow-storm')`, `weather.set('night')`).
//
// ВАЖНО про производительность: снегопад — это Points с одной геометрией. Частицы
// двигаются в шейдере по времени (uTime), а не в JS: 6000 снежинок не должны стоить
// 6000 обновлений на кадр. Всё остальное (туман, свет) — смена нескольких чисел.
import * as THREE from 'three';

export type WeatherPreset = 'clear' | 'snow' | 'storm' | 'fog' | 'night' | 'noon';

export interface WeatherState {
  /** цвет неба и тумана */
  sky: string;
  /** туман: near / far, м */
  fog: [number, number];
  /** сила солнца и полусферы */
  sun: number;
  hemi: number;
  /** цвет солнца */
  sunColor: string;
  /** экспозиция рендера */
  exposure: number;
  /** интенсивность снегопада 0..1 */
  snow: number;
  /** скорость снега (м/с вниз) */
  fall: number;
  /** ветер по X/Z */
  wind: [number, number];
  /** ночь: включить фары/фонари подсветку */
  night: boolean;
}

export const WEATHER: Record<WeatherPreset, { label: string; state: WeatherState }> = {
  clear: {
    label: 'Ясно, мороз',
    state: { sky: '#c3d4e6', fog: [180, 520], sun: 2.5, hemi: 1.15, sunColor: '#fff2da', exposure: 0.97, snow: 0.12, fall: 1.1, wind: [0.5, 0.15], night: false },
  },
  noon: {
    label: 'Полдень, пасмурно',
    state: { sky: '#cdd9e4', fog: [120, 420], sun: 2.4, hemi: 1.15, sunColor: '#fff1d6', exposure: 0.95, snow: 0.25, fall: 1.3, wind: [0.8, 0.3], night: false },
  },
  snow: {
    label: 'Снегопад',
    state: { sky: '#b8c6d4', fog: [60, 260], sun: 1.5, hemi: 1.3, sunColor: '#f2f6fb', exposure: 0.92, snow: 0.7, fall: 2.2, wind: [1.4, 0.7], night: false },
  },
  storm: {
    label: 'Метель',
    state: { sky: '#9aa8b6', fog: [25, 150], sun: 0.8, hemi: 1.5, sunColor: '#eef3f9', exposure: 0.88, snow: 1.0, fall: 4.5, wind: [7, 3.2], night: false },
  },
  fog: {
    label: 'Туман',
    state: { sky: '#c8ced4', fog: [12, 95], sun: 1.1, hemi: 1.25, sunColor: '#e8ecef', exposure: 0.9, snow: 0.05, fall: 0.6, wind: [0.2, 0.1], night: false },
  },
  night: {
    label: 'Ночь',
    state: { sky: '#111a26', fog: [35, 190], sun: 0.22, hemi: 0.3, sunColor: '#9fb6d8', exposure: 1.15, snow: 0.4, fall: 1.6, wind: [1.0, 0.4], night: true },
  },
};

const ORDER: WeatherPreset[] = ['noon', 'snow', 'storm', 'fog', 'night', 'clear'];

/** Снегопад: одна геометрия, движение в шейдере по uTime. */
class Snowfall {
  private points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  readonly max = 6000;

  constructor(scene: THREE.Scene) {
    const n = this.max;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // куб 120×60×120 вокруг камеры: частицы «перезаворачиваются» по высоте
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 60;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uFall: { value: 1.3 }, uWind: { value: new THREE.Vector2(0.8, 0.3) },
        uOpacity: { value: 0.25 }, uCam: { value: new THREE.Vector3() }, uSize: { value: 2.2 },
        uPixel: { value: 1 },
      },
      vertexShader: /* glsl */`
        attribute float aSeed;
        uniform float uTime, uFall, uSize, uPixel;
        uniform vec2 uWind;
        uniform vec3 uCam;
        varying float vA;
        void main() {
          vec3 p = position;
          // падение + снос ветром; по высоте — «заворот» на 60 м
          float y = mod(p.y - uTime * uFall * (0.7 + aSeed * 0.6), 60.0);
          p.x = mod(p.x + uTime * uWind.x * (0.6 + aSeed), 120.0) - 60.0;
          p.z = mod(p.z + uTime * uWind.y * (0.6 + aSeed), 120.0) - 60.0;
          // куб следует за камерой: снег есть везде, где стоит игрок
          vec3 world = vec3(uCam.x + p.x, uCam.y - 22.0 + y, uCam.z + p.z);
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          // ближние снежинки крупнее, дальние — точки
          float d = -mv.z;
          gl_PointSize = uSize * uPixel * (14.0 / max(d, 1.0)) * (0.6 + aSeed * 0.8);
          vA = smoothstep(90.0, 25.0, d) * (0.35 + aSeed * 0.65);
        }`,
      fragmentShader: /* glsl */`
        uniform float uOpacity;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.12, r) * uOpacity * vA;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  update(dt: number, cam: THREE.Vector3, state: WeatherState, pixelRatio: number) {
    const u = this.mat.uniforms;
    u.uTime.value += dt;
    u.uFall.value = state.fall;
    (u.uWind.value as THREE.Vector2).set(state.wind[0], state.wind[1]);
    (u.uCam.value as THREE.Vector3).copy(cam);
    u.uOpacity.value = 0.10 + 0.30 * state.snow;
    u.uPixel.value = pixelRatio;
    // при нулевом снеге частицы не рисуем вовсе (не тратим заполнение экрана)
    this.points.visible = state.snow > 0.01;
    // густоту регулируем отрисовкой части облака: drawRange дешевле, чем два класса
    const geo = this.points.geometry as THREE.BufferGeometry;
    geo.setDrawRange(0, Math.round(this.max * Math.min(1, 0.15 + state.snow)));
  }
}

/** Ночная подсветка: фонари и окна домов светятся — иначе ночь = чёрный экран. */
function nightGlow(scene: THREE.Scene): THREE.Group {
  const g = new THREE.Group();
  g.name = 'night-glow';
  const warm = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.85 });
  // «окна» — плоские прямоугольники, расставленные по фасадам игровой зоны
  for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), warm);
    const side = i % 4;
    const t = (i * 37) % 160 - 80;
    if (side === 0) m.position.set(t, 4 + (i % 6) * 2.6, -52);
    if (side === 1) m.position.set(t, 4 + (i % 6) * 2.6, 44);
    if (side === 2) m.position.set(-50, 4 + (i % 6) * 2.6, t);
    if (side === 3) m.position.set(46, 4 + (i % 6) * 2.6, t);
    m.rotation.y = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
    g.add(m);
  }
  // пятна фонарей на снегу — дешёвые «круги света»
  const pool = new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: 0.16, depthWrite: false });
  for (const [x, z] of [[-26, -34], [-26, -3], [34, -34], [34, -3], [-8, -6], [30, -46]]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(7, 20), pool);
    c.rotation.x = -Math.PI / 2; c.position.set(x, 0.07, z); g.add(c);
  }
  g.visible = false;
  scene.add(g);
  return g;
}

export class Weather {
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private renderer: THREE.WebGLRenderer;
  private fogColor = new THREE.Color();
  private snowfx: Snowfall;
  private glow: THREE.Group;
  private index = 0;
  preset: WeatherPreset = 'noon';
  state: WeatherState;
  private time = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight) {
    this.scene = scene; this.renderer = renderer; this.sun = sun; this.hemi = hemi;
    this.state = { ...WEATHER.noon.state };
    this.snowfx = new Snowfall(scene);
    this.glow = nightGlow(scene);
    this.apply('noon');
  }

  /** Мгновенно применить пресет. */
  apply(preset: WeatherPreset) {
    this.preset = preset;
    this.index = ORDER.indexOf(preset);
    this.state = { ...WEATHER[preset].state };
    this.fogColor.set(this.state.sky);
    // на карте фон — это цвет (не текстура/куб): если вдруг фон другой, ставим цвет
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.fogColor);
    else this.scene.background = this.fogColor.clone();
    if (!(this.scene.fog instanceof THREE.Fog)) this.scene.fog = new THREE.Fog(this.fogColor, this.state.fog[0], this.state.fog[1]);
    else {
      (this.scene.fog as THREE.Fog).color.copy(this.fogColor);
      (this.scene.fog as THREE.Fog).near = this.state.fog[0];
      (this.scene.fog as THREE.Fog).far = this.state.fog[1];
    }
    this.sun.intensity = this.state.sun;
    this.sun.color.set(this.state.sunColor);
    this.hemi.intensity = this.state.hemi;
    this.renderer.toneMappingExposure = this.state.exposure;
    // ночью солнце «луна» — светим почти отвесно, чтобы были видны силуэты
    if (this.state.night) this.sun.position.set(-40, 70, 30);
    else this.sun.position.set(60, 90, 40);
    this.glow.visible = this.state.night;
    return WEATHER[preset].label;
  }

  /** Следующая погода по кругу (клавиша N в игре). */
  next() {
    this.index = (this.index + 1) % ORDER.length;
    return this.apply(ORDER[this.index]);
  }

  get label() { return WEATHER[this.preset].label; }

  /** Вызывается каждый кадр из игрового цикла. */
  update(dt: number, camera: THREE.PerspectiveCamera) {
    this.time += dt;
    // ночью окна «дышат»: не все горят одновременно — иначе стена огней
    if (this.state.night) {
      const k = 0.6 + 0.4 * Math.sin(this.time * 0.7);
      this.glow.children.forEach((c, i) => {
        const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (m && m.opacity === m.opacity) m.opacity = i < 90 ? 0.55 + 0.4 * ((i * 13 % 7) / 7) * k : 0.12 * k;
      });
    }
    this.snowfx.update(dt, camera.position, this.state, this.renderer.getPixelRatio());
  }
}
