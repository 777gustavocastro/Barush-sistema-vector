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

/**
 * Diferença perceptual internacional ISO/CIE 11664-6:2014 (CIEDE2000 / ΔE₀₀) a partir de coordenadas CIELAB.
 */
export function deltaECiede2000FromLab(
  L1: number,
  a1: number,
  b1: number,
  L2: number,
  a2: number,
  b2: number
): number {
  const avgL = (L1 + L2) * 0.5;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) * 0.5;

  const avgC7 = Math.pow(avgC, 7);
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + 6103515625))); // 25^7 = 6103515625

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) * 0.5;

  const radToDeg = 180 / Math.PI;
  const degToRad = Math.PI / 180;

  let h1p = C1p < 1e-6 ? 0 : Math.atan2(b1, a1p) * radToDeg;
  if (h1p < 0) h1p += 360;
  let h2p = C2p < 1e-6 ? 0 : Math.atan2(b2, a2p) * radToDeg;
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p >= 1e-6) {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) {
      dhp = diff;
    } else if (diff > 180) {
      dhp = diff - 360;
    } else {
      dhp = diff + 360;
    }
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * 0.5 * degToRad);

  let avgHp = h1p + h2p;
  if (C1p * C2p < 1e-6) {
    avgHp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    avgHp = (h1p + h2p) * 0.5;
  } else if (h1p + h2p < 360) {
    avgHp = (h1p + h2p + 360) * 0.5;
  } else {
    avgHp = (h1p + h2p - 360) * 0.5;
  }

  const T =
    1 -
    0.17 * Math.cos((avgHp - 30) * degToRad) +
    0.24 * Math.cos(2 * avgHp * degToRad) +
    0.32 * Math.cos((3 * avgHp + 6) * degToRad) -
    0.2 * Math.cos((4 * avgHp - 63) * degToRad);

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const avgCp7 = Math.pow(avgCp, 7);
  const RC = 2 * Math.sqrt(avgCp7 / (avgCp7 + 6103515625));

  const lDiffSq = (avgL - 50) * (avgL - 50);
  const SL = 1 + (0.015 * lDiffSq) / Math.sqrt(20 + lDiffSq);
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;
  const RT = -Math.sin(2 * dTheta * degToRad) * RC;

  const nL = dLp / SL;
  const nC = dCp / SC;
  const nH = dHp / SH;

  return Math.sqrt(Math.max(0, nL * nL + nC * nC + nH * nH + RT * nC * nH));
}

export function deltaECiede2000Srgb8(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  if (r1 === r2 && g1 === g2 && b1 === b2) return 0;
  const [L1, a1, bl1] = srgb8ToCieLab(r1, g1, b1);
  const [L2, a2, bl2] = srgb8ToCieLab(r2, g2, b2);
  return deltaECiede2000FromLab(L1, a1, bl1, L2, a2, bl2);
}

/**
 * Alpha Matting Dual-Space (Linear-RGB + sRGB + OKLab):
 * Determina se um pixel observado `(rPx, gPx, bPx)` é uma mistura real de anti-aliasing entre
 * `FG=(r1, g1, b1)` e `BG=(r2, g2, b2)` (mesmo quando cores complementares curvam no espaço OKLab),
 * distinguindo-o rigorosamente de um contorno intencional escuro/claro ou de uma 3ª cor real!
 */
export function unmixDualSpaceBoundaryMatting(
  rPx: number,
  gPx: number,
  bPx: number,
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): {
  isTrueAntialiasBlend: boolean;
  coverageOfFirst: number;
  blendResidualSrgb: number;
} {
  // 1) Espaço sRGB (usado por muitos motores 2D como Cairo, Canvas2D, Skia sRGB)
  const vxS = r1 - r2;
  const vyS = g1 - g2;
  const vzS = b1 - b2;
  const denomS = vxS * vxS + vyS * vyS + vzS * vzS;
  if (denomS < 16) {
    return { isTrueAntialiasBlend: true, coverageOfFirst: 0.5, blendResidualSrgb: 0 };
  }

  const rawTS = ((rPx - r2) * vxS + (gPx - g2) * vyS + (bPx - b2) * vzS) / denomS;
  const clampedTS = Math.max(0, Math.min(1, rawTS));
  const resSrgb = Math.hypot(
    rPx - (r2 + clampedTS * vxS),
    gPx - (g2 + clampedTS * vyS),
    bPx - (b2 + clampedTS * vzS)
  );

  // 2) Espaço Linear-RGB (usado por renderizadores fisicamente corretos como Resvg, CoreGraphics, Blender)
  const lrPx = SRGB_TO_LINEAR_LUT[rPx & 255];
  const lgPx = SRGB_TO_LINEAR_LUT[gPx & 255];
  const lbPx = SRGB_TO_LINEAR_LUT[bPx & 255];
  const lr1 = SRGB_TO_LINEAR_LUT[r1 & 255];
  const lg1 = SRGB_TO_LINEAR_LUT[g1 & 255];
  const lb1 = SRGB_TO_LINEAR_LUT[b1 & 255];
  const lr2 = SRGB_TO_LINEAR_LUT[r2 & 255];
  const lg2 = SRGB_TO_LINEAR_LUT[g2 & 255];
  const lb2 = SRGB_TO_LINEAR_LUT[b2 & 255];

  const vxL = lr1 - lr2;
  const vyL = lg1 - lg2;
  const vzL = lb1 - lb2;
  const denomL = vxL * vxL + vyL * vyL + vzL * vzL;

  let clampedTL = clampedTS;
  let resLinScaled = resSrgb;
  let rawTL = rawTS;
  if (denomL > 1e-5) {
    rawTL = ((lrPx - lr2) * vxL + (lgPx - lg2) * vyL + (lbPx - lb2) * vzL) / denomL;
    clampedTL = Math.max(0, Math.min(1, rawTL));
    resLinScaled =
      Math.hypot(
        lrPx - (lr2 + clampedTL * vxL),
        lgPx - (lg2 + clampedTL * vyL),
        lbPx - (lb2 + clampedTL * vzL)
      ) * 255;
  }

  const useLin = resLinScaled < resSrgb;
  const bestResidual = useLin ? resLinScaled : resSrgb;
  const bestRawT = useLin ? rawTL : rawTS;
  const bestCov = useLin ? clampedTL : clampedTS;

  // Para ser anti-aliasing genuíno (e NÃO um contorno preto/branco intencional):
  // 1) A projeção não pode extrapolar além de [-0.08, 1.08] das duas cores vizinhas;
  // 2) O desvio ortogonal ao segmento [C2, C1] deve ser baixo (<= 16/255 + 4% do comprimento da corda).
  const chordSrgb = Math.sqrt(denomS);
  const maxAllowedRes = Math.min(26, 13.5 + chordSrgb * 0.045);
  const isTrueAntialiasBlend =
    bestRawT >= -0.08 && bestRawT <= 1.08 && bestResidual <= maxAllowedRes;

  return {
    isTrueAntialiasBlend,
    coverageOfFirst: bestCov,
    blendResidualSrgb: bestResidual,
  };
}

/**
 * Decontaminação de Cor de Borda (Alpha Matting / Unpremultiply Local):
 * Remove a contaminação cromática do fundo/vizinho `(rBg, gBg, bBg)` sobre um pixel de borda
 * com cobertura estimada `alphaCov ∈ (0, 1]`, preservando a tonalidade real da região sem clarear/escurecer!
 */
export function decontaminateBoundaryPixelSrgb8(
  rObs: number,
  gObs: number,
  bObs: number,
  rBg: number,
  gBg: number,
  bBg: number,
  alphaCov: number
): [number, number, number] {
  const a = Math.max(0.32, Math.min(1, alphaCov));
  if (a >= 0.97) return [rObs, gObs, bObs];
  const inv = 1 / a;
  const oneMinusA = 1 - a;
  return [
    Math.max(0, Math.min(255, Math.round((rObs - oneMinusA * rBg) * inv))),
    Math.max(0, Math.min(255, Math.round((gObs - oneMinusA * gBg) * inv))),
    Math.max(0, Math.min(255, Math.round((bObs - oneMinusA * bBg) * inv))),
  ];
}

export function hexToRgb8(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}
