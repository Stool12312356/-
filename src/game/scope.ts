// Прицельная сетка (ПКМ). Пользователь: «сделай у всего оружия обычный прицел — при ПКМ
// появляется прицельная сетка, а оружие не видно». Раньше прицел был только у СВД моделью
// 1П29, которую прикручивали к оружию обрезком — она уезжала и закрывала пол-экрана.
//
// Здесь сетка рисуется НЕ в 3D, а оверлеем поверх кадра: так она всегда ровно по центру,
// не зависит от модели, не ломается от отдачи и не стоит ни одного дров-колла.

const SVG = (inner: string, size = 100) =>
  `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/** Оптический прицел: круг с толстыми брусами и тонким перекрестием (как ПСО-1). */
const OPTIC = SVG(`
  <circle cx="50" cy="50" r="47" fill="rgba(0,0,0,0.92)" stroke="#000" stroke-width="1"/>
  <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>
  <g stroke="#000" stroke-width="1.6" stroke-linecap="butt">
    <line x1="50" y1="3" x2="50" y2="30"/>
    <line x1="50" y1="70" x2="50" y2="97"/>
    <line x1="3" y1="50" x2="30" y2="50"/>
    <line x1="70" y1="50" x2="97" y2="50"/>
  </g>
  <g stroke="#000" stroke-width="0.6">
    <line x1="50" y1="30" x2="50" y2="70"/>
    <line x1="30" y1="50" x2="70" y2="50"/>
  </g>
  <g stroke="#000" stroke-width="0.9">
    <line x1="45.5" y1="58" x2="54.5" y2="58"/>
    <line x1="46.5" y1="64" x2="53.5" y2="64"/>
    <line x1="47.5" y1="70" x2="52.5" y2="70"/>
    <line x1="45.5" y1="42" x2="54.5" y2="42"/>
  </g>
  <circle cx="50" cy="50" r="0.7" fill="#ff2b2b"/>
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
  /** «окуляр» — затемнение по краям при оптике */
  private vignette: HTMLDivElement;
  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.id = 'scope';
    Object.assign(this.el.style, {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: '20',
    } as CSSStyleDeclaration);
    this.vignette = document.createElement('div');
    Object.assign(this.vignette.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', background: 'radial-gradient(circle at center, rgba(0,0,0,0) 34%, rgba(0,0,0,0.85) 46%, #000 52%)', display: 'none', zIndex: '19',
    } as CSSStyleDeclaration);
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
    this.vignette.style.display = vis && kind === 'optic' ? 'block' : 'none';
    this.el.style.opacity = String(strength);
    // при оптике затемнение растёт вместе с приближением
    this.vignette.style.opacity = String(strength * (kind === 'optic' ? 1 : 0));
  }

  hide() { this.el.style.display = 'none'; this.vignette.style.display = 'none'; this.setNativeCrosshair(true); }
}

/** Для отладки/тестов: геометрия сетки в долях кадра (центр всегда 0.5, 0.5). */
export const RETICLE_CENTER = { x: 0.5, y: 0.5 } as const;
