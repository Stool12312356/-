// tools/lib/recolor.mjs — перекраска текстур модели в зимнюю палитру.
// Вызывается из tools/convert.mjs, если в config/recolor.json у файла указано "winter".
//
// Метод: каждая текстура переводится в HSL, приглушается насыщенность, светлые тона
// поднимаются к холодному белому, тёмные уводятся в синий. Так техника и солдат
// выглядят «в снегу», но рисунок (камуфляж, надписи) остаётся на месте.
import sharp from 'sharp';

const FROST = { hue: 210, satMul: 0.55, lightAdd: 0.06, mixWhite: 0.22 };

/** Перекрашивает все текстуры документа. Возвращает число изменённых текстур. */
export async function recolorWinter(doc, sharpImpl = sharp) {
  let n = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const mime = tex.getMimeType();
    if (!/jpe?g|png|webp/.test(mime)) continue;      // KTX2 и прочее не трогаем
    const src = Buffer.from(tex.getImage());
    if (!src.length) continue;
    try {
      const img = sharpImpl(src);
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      for (let i = 0; i < data.length; i += ch) {
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2, d = max - min;
        let h = 0, s = 0;
        if (d > 1e-6) {
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          else if (max === g) h = ((b - r) / d + 2) / 6;
          else h = ((r - g) / d + 4) / 6;
        }
        // приглушаем цвет, уводим оттенок к холодному, подмешиваем «снег» в светлые тона
        const s2 = s * FROST.satMul;
        const l2 = Math.min(1, l + FROST.lightAdd * (0.35 + l));
        const snow = FROST.mixWhite * Math.max(0, l - 0.45);
        let rgb = hsl2rgb(FROST.hue / 360 * 0.16 + h * 0.55, s2, l2);
        rgb = rgb.map(v => v * (1 - snow) + 0.93 * snow);
        data[i] = clamp(rgb[0]); data[i + 1] = clamp(rgb[1]); data[i + 2] = clamp(rgb[2]);
      }
      const out = await sharpImpl(data, { raw: { width: info.width, height: info.height, channels: ch } })
        .webp({ quality: 82 }).toBuffer();
      tex.setImage(out).setMimeType('image/webp');
      n++;
    } catch (e) {
      console.warn('  recolor: текстура пропущена —', e.message);
    }
  }
  return n;
}

const clamp = v => Math.max(0, Math.min(255, Math.round(v * 255)));

function hsl2rgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2(p, q, h + 1 / 3), hue2(p, q, h), hue2(p, q, h - 1 / 3)];
}
function hue2(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
