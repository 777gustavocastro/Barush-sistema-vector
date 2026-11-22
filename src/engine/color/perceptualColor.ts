import type { RawRgbaImage } from '../types';

const SRGB_TO_LINEAR_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface PerceptualOklabBuffers {
  width: number;
  height: number;
  /** Luminosidade perceptual L escalada em 0..100 (1 unidade ≈ 1 JND). */
  L: Float32Array;
  /** Eixo cromático verde-vermelho escalado em ~[-100..100]. */
  a: Float32Array;
  /** Eixo cromático azul-amarelo escalado em ~[-100..100]. */
  b: Float32Array;
  /** Canal alfa normalizado em 0..100. */
  alpha: Float32Array;
  /** Croma perceptual sqrt(a² + b²). */
  chroma: Float32Array;
}

export function srgb8ToOklabScaled(
  r8: number,
  g8: number,
  b8: number
): [number, number, number] {
  const lr = SRGB_TO_LINEAR_LUT[r8 & 255];
  const lg = SRGB_TO_LINEAR_LUT[g8 & 255];
  const lb = SRGB_TO_LINEAR_LUT[b8 & 255];

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100;
  const a = (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 250;
  const b = (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * 250;

  return [L, a, b];
}

export function oklabScaledToSrgb8(
  L100: number,
  a250: number,
  b250: number
): [number, number, number] {
  const L = L100 / 100;
  const a = a250 / 250;
  const b = b250 / 250;

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = Math.max(0, Math.min(1, +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s));
  const lg = Math.max(0, Math.min(1, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s));
  const lb = Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));

  const toSrgb8 = (lin: number): number => {
    const encoded = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(encoded * 255)));
  };

  return [toSrgb8(lr), toSrgb8(lg), toSrgb8(lb)];
}

export function srgb8ToCieLab(r8: number, g8: number, b8: number): [number, number, number] {
  const r = SRGB_TO_LINEAR_LUT[r8 & 255];
  const g = SRGB_TO_LINEAR_LUT[g8 & 255];
  const b = SRGB_TO_LINEAR_LUT[b8 & 255];

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaEOklab(
  L1: number,
  a1: number,
  b1: number,
  L2: number,
  a2: number,
  b2: number
): number {
  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

export function computePerceptualOklabBuffers(image: RawRgbaImage): PerceptualOklabBuffers {
  const { width, height, data } = image;
  const total = width * height;
  const L = new Float32Array(total);
  const a = new Float32Array(total);
  const b = new Float32Array(total);
  const alpha = new Float32Array(total);
  const chroma = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r8 = data[idx];
    const g8 = data[idx + 1];
    const b8 = data[idx + 2];
    const a8 = data[idx + 3];

    const lr = SRGB_TO_LINEAR_LUT[r8];
    const lg = SRGB_TO_LINEAR_LUT[g8];
    const lb = SRGB_TO_LINEAR_LUT[b8];

    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

    const Lv = (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100;
    const av = (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 250;
    const bv = (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * 250;

    L[i] = Lv;
    a[i] = av;
    b[i] = bv;
    alpha[i] = (a8 / 255) * 100;
    chroma[i] = Math.hypot(av, bv);
  }

  return { width, height, L, a, b, alpha, chroma };
}

/**
 * Desmistura linear exata de cobertura sub-pixel `C_px ≈ (1 - α)·C_bg + α·C_fg` em espaço perceptual OKLab.
 * Retorna `coverage ∈ [0, 1]` e o erro residual ortogonal `orthogonalResidual` (em unidades ΔE_ok):
 * - Quando `orthogonalResidual <= 4.5`: o pixel é genuinamente anti-aliasing entre `C_fg` e `C_bg`!
 * - Quando `orthogonalResidual > 4.5`: o pixel pertence a uma TERCEIRA cor real (ex.: contorno fino preto,
 *   detalhe interno ou reflexo) e NÃO deve ser engolido pela região vizinha!
 */
export function unmixPerceptualBoundaryCoverage(
  pxL: number,
  pxA: number,
  pxB: number,
  fgL: number,
  fgA: number,
  fgB: number,
  bgL: number,
  bgA: number,
  bgB: number
): { coverage: number; orthogonalResidual: number; chordLength: number } {
  const vx = fgL - bgL;
  const vy = fgA - bgA;
  const vz = fgB - bgB;
  const denom = vx * vx + vy * vy + vz * vz;
  const chordLength = Math.sqrt(denom);

  if (denom < 1.0) {
    return { coverage: 0.5, orthogonalResidual: 0, chordLength };
  }

  const wx = pxL - bgL;
  const wy = pxA - bgA;
  const wz = pxB - bgB;

  const rawT = (wx * vx + wy * vy + wz * vz) / denom;
  const coverage = Math.max(0, Math.min(1, rawT));

  const projL = bgL + coverage * vx;
  const projA = bgA + coverage * vy;
  const projB = bgB + coverage * vz;

  const orthogonalResidual = Math.hypot(pxL - projL, pxA - projA, pxB - projB);
  return { coverage, orthogonalResidual, chordLength };
}
