// Прицельная сетка (ПКМ). Пользователь: «сделай у всего оружия обычный прицел — при ПКМ
// появляется прицельная сетка, а оружие не видно». Раньше прицел был только у СВД моделью
// 1П29, которую прикручивали к оружию обрезком — она уезжала и закрывала пол-экрана.
//
// Здесь сетка рисуется НЕ в 3D, а оверлеем поверх кадра: так она всегда ровно по центру,
// не зависит от модели, не ломается от отдачи и не стоит ни одного дров-колла.

const SVG = (inner: string, size = 100) =>
  `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/**
 * Оптический прицел (ПСО-1). ВАЖНО: в центре НЕ ДОЛЖНО быть заливки.
 * Раньше здесь был чёрный диск r=47 — он закрывал весь центр экрана, и в прицел ничего
 * не было видно (претензия «у прицела посередине ничего не видно»). Теперь только тонкое
 * кольцо-окуляр, а внутри — прозрачное стекло с сеткой. Затемнение по краям рисует
 * CSS-виньетка (см. show()), а не SVG.
 */
const OPTIC = SVG(`
  <circle cx="50" cy="50" r="46.5" fill="none" stroke="rgba(0,0,0,0.9)" stroke-width="3"/>
  <circle cx="50" cy="50" r="44.6" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.5"/>
  <!-- толстые брусы от края к центру, как у настоящей оптики -->
  <g stroke-linecap="butt">
    <g stroke="rgba(255,255,255,0.45)" stroke-width="2.4">
      <line x1="50" y1="7" x2="50" y2="30"/><line x1="50" y1="70" x2="50" y2="93"/>
      <line x1="7" y1="50" x2="30" y2="50"/><line x1="70" y1="50" x2="93" y2="50"/>
    </g>
    <g stroke="#0b0b0b" stroke-width="1.2">
      <line x1="50" y1="7" x2="50" y2="30"/><line x1="50" y1="70" x2="50" y2="93"/>
      <line x1="7" y1="50" x2="30" y2="50"/><line x1="70" y1="50" x2="93" y2="50"/>
    </g>
  </g>
  <!-- тонкие нити к центру -->
  <g stroke="rgba(255,255,255,0.45)" stroke-width="0.9">
    <line x1="50" y1="30" x2="50" y2="46.6"/><line x1="50" y1="53.4" x2="50" y2="70"/>
    <line x1="30" y1="50" x2="46.6" y2="50"/><line x1="53.4" y1="50" x2="70" y2="50"/>
  </g>
  <g stroke="#0b0b0b" stroke-width="0.5">
    <line x1="50" y1="30" x2="50" y2="46.6"/><line x1="50" y1="53.4" x2="50" y2="70"/>
    <line x1="30" y1="50" x2="46.6" y2="50"/><line x1="53.4" y1="50" x2="70" y2="50"/>
  </g>
  <!-- прицельные марки на вертикали (дальномерная шкала) -->
  <g stroke="#0b0b0b" stroke-width="0.8">
    <line x1="46.5" y1="57" x2="53.5" y2="57"/>
    <line x1="47.5" y1="63" x2="52.5" y2="63"/>
    <line x1="48.2" y1="69" x2="51.8" y2="69"/>
    <line x1="46.5" y1="43" x2="53.5" y2="43"/>
  </g>
  <g stroke="rgba(255,255,255,0.4)" stroke-width="1.7">
    <line x1="46.5" y1="57" x2="53.5" y2="57"/>
    <line x1="47.5" y1="63" x2="52.5" y2="63"/>
  </g>
  <circle cx="50" cy="50" r="0.75" fill="#e8342b"/>
`);

/** Обычный прицел: перекрестие с засечками, центр свободен. */
const IRON = SVG(`
  <g stroke="#000" stroke-width="1.5" stroke-linecap="butt">
    <line x1="50" y1="6" x2="50" y2="38"/>
    <line x1="50" y1="62" x2="50" y2="94"/>
    <line x1="6" y1="50" x2="38" y2="50"/>
    <line x1="62" y1="50" x2="94" y2="50"/>
  </g>
  <g stroke="rgba(255,255,255,0.55)" stroke-width="0.6">
    <line x1="50" y1="6" x2="50" y2="38"/>
    <line x1="50" y1="62" x2="50" y2="94"/>
    <line x1="6" y1="50" x2="38" y2="50"/>
    <line x1="62" y1="50" x2="94" y2="50"/>
  </g>
  <circle cx="50" cy="50" r="0.9" fill="#000"/>
`);

/** Прицел-«точка» для пистолета: мелкая мушка, ничего не закрывает. */
const PISTOL = SVG(`
  <g stroke="#000" stroke-width="1.2">
    <line x1="50" y1="18" x2="50" y2="43"/>
    <line x1="50" y1="57" x2="50" y2="82"/>
    <line x1="18" y1="50" x2="43" y2="50"/>
    <line x1="57" y1="50" x2="82" y2="50"/>
  </g>
  <circle cx="50" cy="50" r="0.8" fill="#000"/>
`);

/** Какой вид сетки у оружия. */
export function reticleFor(weaponId: string, scoped: boolean): 'optic' | 'iron' | 'pistol' {
  if (weaponId === 'pm') return 'pistol';
  if (scoped) return 'optic';
  return 'iron';
}

export class Scope {
  el: HTMLDivElement;
  private current = '';
  /**
   * «Окуляр» — затемнение по краям при оптике.
   * Рисуется на canvas: CSS-градиент с фиксированным радиусом в vmin растягивался в
   * вытянутом окне в эллипс и заливал пол-экрана чёрным (претензия «в центре прицела
   * ничего не видно»). Canvas знает реальный размер кадра и рисует круг ровно по окуляру.
   */
  private vignette: HTMLCanvasElement;
  private vigCtx: CanvasRenderingContext2D | null = null;
  private vigSize = { w: 0, h: 0, r: 0 };
  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.id = 'scope';
    Object.assign(this.el.style, {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: '20',
    } as CSSStyleDeclaration);
    this.vignette = document.createElement('canvas');
    this.vignette.id = 'scope-vignette';
    Object.assign(this.vignette.style, {
      position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
      pointerEvents: 'none', display: 'none', zIndex: '19',
    } as CSSStyleDeclaration);
    this.vigCtx = this.vignette.getContext('2d');
    parent.appendChild(this.vignette);
    parent.appendChild(this.el);
  }

  /** Обычный прицел (без ПКМ) — родное перекрестие игры; при прицеливании его прячем. */
  setNativeCrosshair(on: boolean) {
    const ch = document.getElementById('crosshair');
    if (ch) ch.style.opacity = on ? '0.9' : '0';
  }

  /** @param kind тип сетки, @param strength 0..1 плавность появления */
  show(kind: 'optic' | 'iron' | 'pistol', strength: number) {
    const key = kind;
    if (key !== this.current) {
      this.current = key;
      const svg = kind === 'optic' ? OPTIC : kind === 'pistol' ? PISTOL : IRON;
      this.el.innerHTML = svg;
      // размер: оптика — 62vmin, обычный прицел — 34vmin (чтобы не мешал смотреть)
      const size = kind === 'optic' ? '62vmin' : '34vmin';
      const inner = this.el.firstElementChild as SVGElement | null;
      if (inner) Object.assign(inner.style, { width: size, height: size } as CSSStyleDeclaration);
    }
    const vis = strength > 0.02;
    this.setNativeCrosshair(!vis);
    this.el.style.display = vis ? 'flex' : 'none';
    const optic = vis && kind === 'optic';
    this.vignette.style.display = optic ? 'block' : 'none';
    if (optic) this.paintVignette();
    this.el.style.opacity = String(strength);
    // при оптике затемнение растёт вместе с приближением
    this.vignette.style.opacity = String(strength * (kind === 'optic' ? 1 : 0));
  }

  /**
   * Затемнение вокруг окуляра. Радиус = половина отрисованного круга сетки (62vmin / 2),
   * поэтому стекло остаётся прозрачным, а чёрный начинается ЗА кольцом.
   */
  private paintVignette() {
    const ctx = this.vigCtx;
    if (!ctx) return;
    const w = window.innerWidth, h = window.innerHeight;
    const r = 0.62 * Math.min(w, h) / 2;          // 62vmin — размер сетки, делим на 2 = радиус
    if (this.vigSize.w !== w || this.vigSize.h !== h || this.vigSize.r !== r) {
      this.vignette.width = w; this.vignette.height = h;
      this.vigSize = { w, h, r };
      ctx.clearRect(0, 0, w, h);
      // чёрный фон
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      // «вырезаем» круг окуляра: непрозрачность 0 внутри, 1 за кольцом
      ctx.globalCompositeOperation = 'destination-out';
      const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.9, w / 2, h / 2, r * 1.02);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r * 1.02, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // сама «плёночная» непрозрачность растёт вместе с наведением
    this.vignette.style.opacity = '1';
  }

  hide() { this.el.style.display = 'none'; this.vignette.style.display = 'none'; this.setNativeCrosshair(true); }
}

/** Для отладки/тестов: геометрия сетки в долях кадра (центр всегда 0.5, 0.5). */
export const RETICLE_CENTER = { x: 0.5, y: 0.5 } as const;
