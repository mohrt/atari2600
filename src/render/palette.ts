import type { TvStandard } from '../atari2600';

/**
 * The 128-colour palettes, as 0xAABBGGRR words ready for ImageData. Colours
 * are generated from the TIA's colour model: 16 hues (phase steps of the
 * colour burst) by 8 luminances. Index = colour register value >> 1.
 */

const CHROMA = 0.19;

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function rgbWord(y: number, u: number, v: number): number {
  const r = clamp(y + 1.14 * v);
  const g = clamp(y - 0.395 * u - 0.581 * v);
  const b = clamp(y + 2.032 * u);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

function luminance(lum: number): number {
  return lum === 0 ? 0.06 : 0.06 + (lum / 7) * 0.88;
}

/** NTSC: hue 0 is grey; hues 1-15 step 25.7 degrees from the colour burst (gold). */
function ntscPalette(): Uint32Array {
  const palette = new Uint32Array(128);
  for (let hue = 0; hue < 16; hue++) {
    for (let lum = 0; lum < 8; lum++) {
      const y = luminance(lum);
      if (hue === 0) {
        palette[hue * 8 + lum] = rgbWord(lum === 0 ? 0 : y, 0, 0);
        continue;
      }
      const angle = ((180 - (hue - 1) * 25.7) * Math.PI) / 180;
      palette[hue * 8 + lum] = rgbWord(y, CHROMA * Math.cos(angle), CHROMA * Math.sin(angle));
    }
  }
  return palette;
}

/**
 * PAL: hues 0, 1, 14 and 15 are grey; even and odd hues 2-13 run around the
 * colour wheel in opposite directions (the PAL phase alternation).
 */
function palPalette(): Uint32Array {
  const palette = new Uint32Array(128);
  for (let hue = 0; hue < 16; hue++) {
    for (let lum = 0; lum < 8; lum++) {
      const y = luminance(lum);
      if (hue < 2 || hue > 13) {
        palette[hue * 8 + lum] = rgbWord(lum === 0 ? 0 : y, 0, 0);
        continue;
      }
      const degrees = hue % 2 === 0 ? 165 - ((hue - 2) / 2) * 30 : -165 + ((hue - 3) / 2) * 30;
      const angle = (degrees * Math.PI) / 180;
      palette[hue * 8 + lum] = rgbWord(y, CHROMA * Math.cos(angle), CHROMA * Math.sin(angle));
    }
  }
  return palette;
}

/** SECAM: eight fixed colours chosen by luminance alone. */
function secamPalette(): Uint32Array {
  const colors = [0x000000, 0x2121ff, 0xf03c79, 0xff50ff, 0x7fff00, 0x7fffff, 0xffff3f, 0xffffff];
  const palette = new Uint32Array(128);
  for (let i = 0; i < 128; i++) {
    const rgb = colors[i & 7];
    palette[i] = (0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | (rgb >> 16)) >>> 0;
  }
  return palette;
}

export const PALETTES: Record<TvStandard, Uint32Array> = {
  ntsc: ntscPalette(),
  pal: palPalette(),
  secam: secamPalette(),
};
