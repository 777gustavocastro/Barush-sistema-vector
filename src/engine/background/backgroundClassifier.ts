import type { RawRgbaImage } from '../types';
import {
  deltaEOklab,
  srgb8ToOklabScaled,
  type PerceptualOklabBuffers,
} from '../color/perceptualColor';

export type BackgroundKind =
  | 'uniform_black'
  | 'uniform_white'
  | 'uniform_solid'
  | 'gradient'
  | 'true_texture'
  | 'transparent'
  | 'shadowed'
  | 'decorative'
  | 'compression_noise_uniform'
  | 'none';

export interface BackgroundClassification {
  kind: BackgroundKind;
  hasUniformCanvas: boolean;
  hasDecorativeElements: boolean;
  rgb: [number, number, number] | null;
  oklab: [number, number, number] | null;
  /** Distância de Chebyshev (max |ΔRGB|) tolerada para o fundo. */
  chebyshevTol: number;
  maxSpeckPixels: number;
}

function chebyshev(r: number, g: number, b: number, bg: [number, number, number]): number {
  return Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * Classifica a natureza real do fundo a partir da borda e de uma amostra interior.
 * Perto do preto e do branco a distância é em RGB (OKLab amplifica croma de ruído).
 * Textura intencional não é achatada; ruído de compressão sem estrutura é.
 */
export function classifyCanvasBackground(
  image: RawRgbaImage,
  oklab: PerceptualOklabBuffers
): BackgroundClassification {
  const { width, height, data } = image;
  const none: BackgroundClassification = {
    kind: 'none',
    hasUniformCanvas: false,
    hasDecorativeElements: false,
    rgb: null,
    oklab: null,
    chebyshevTol: 0,
    maxSpeckPixels: 0,
  };
  if (width < 8 || height < 8) return none;

  const corners = [0, width - 1, (height - 1) * width, (height - 1) * width + (width - 1)];
  let transparentCorners = 0;
  for (const px of corners) {
    if (data[px * 4 + 3] < 40) transparentCorners++;
  }

  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  const border: number[] = [];
  for (let x = 0; x < width; x += stepX) {
    border.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y += stepY) {
    border.push(y * width, y * width + (width - 1));
  }

  let transparentBorder = 0;
  const opaque: number[] = [];
  for (const px of border) {
    if (data[px * 4 + 3] < 40) transparentBorder++;
    else if (data[px * 4 + 3] >= 200) opaque.push(px);
  }
  if (transparentCorners >= 2 || transparentBorder >= border.length * 0.35) {
    return { ...none, kind: 'transparent' };
  }
  if (opaque.length < border.length * 0.55) return none;

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const lums: number[] = [];
  for (const px of opaque) {
    const i = px * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
    lums.push(oklab.L[px]);
  }
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  lums.sort((a, b) => a - b);
  const mid = Math.floor(opaque.length / 2);
  const rgb: [number, number, number] = [rs[mid], gs[mid], bs[mid]];
  const lab = srgb8ToOklabScaled(rgb[0], rgb[1], rgb[2]);
  const lumSpread = percentile(lums, 0.9) - percentile(lums, 0.1);

  const dists: number[] = [];
  for (const px of opaque) {
    const i = px * 4;
    dists.push(chebyshev(data[i], data[i + 1], data[i + 2], rgb));
  }
  dists.sort((a, b) => a - b);
  const p90 = percentile(dists, 0.9);
  const nearBlack = rgb[0] <= 32 && rgb[1] <= 32 && rgb[2] <= 32;
  const nearWhite = rgb[0] >= 226 && rgb[1] >= 226 && rgb[2] >= 226;
  const chebyshevTol = Math.max(
    nearBlack ? 10 : nearWhite ? 8 : 6,
    Math.min(nearBlack ? 24 : 16, Math.round(p90 * 1.35 + (nearBlack ? 6 : 3)))
  );

  let matchBorder = 0;
  for (const d of dists) {
    if (d <= chebyshevTol) matchBorder++;
  }
  const borderUniform = matchBorder >= opaque.length * 0.72 && lumSpread <= (nearBlack ? 22 : 14);

  const grid = Math.max(4, Math.floor(Math.min(width, height) / 18));
  let smooth = 0;
  let textured = 0;
  let samples = 0;
  let sumL = 0;
  let sumX = 0;
  let sumY = 0;
  let sumLL = 0;
  let sumXL = 0;
  let sumYL = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  let nFit = 0;
  for (let y = grid; y < height - grid; y += grid) {
    for (let x = grid; x < width - grid; x += grid) {
      const px = y * width + x;
      if (data[px * 4 + 3] < 200) continue;
      const d = chebyshev(data[px * 4], data[px * 4 + 1], data[px * 4 + 2], rgb);
      const lx = Math.max(0, x - 1);
      const rx = Math.min(width - 1, x + 1);
      const uy = Math.max(0, y - 1);
      const dy = Math.min(height - 1, y + 1);
      const g = Math.max(
        Math.abs(oklab.L[y * width + rx] - oklab.L[y * width + lx]),
        Math.abs(oklab.L[dy * width + x] - oklab.L[uy * width + x])
      );
      samples++;
      if (d <= chebyshevTol + 4 && g <= 6) smooth++;
      if (g >= 14 && d > chebyshevTol) textured++;
      if (d <= chebyshevTol + 18) {
        const L = oklab.L[px];
        sumL += L;
        sumX += x;
        sumY += y;
        sumLL += L * L;
        sumXL += x * L;
        sumYL += y * L;
        sumXX += x * x;
        sumYY += y * y;
        sumXY += x * y;
        nFit++;
      }
    }
  }

  let gradientFit = 0;
  if (nFit >= 12) {
    const inv = 1 / nFit;
    const mx = sumX * inv;
    const my = sumY * inv;
    const mL = sumL * inv;
    const sxx = sumXX - nFit * mx * mx;
    const syy = sumYY - nFit * my * my;
    const sxy = sumXY - nFit * mx * my;
    const sxL = sumXL - nFit * mx * mL;
    const syL = sumYL - nFit * my * mL;
    const sLL = sumLL - nFit * mL * mL;
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) > 1e-3 && sLL > 8) {
      const bx = (syy * sxL - sxy * syL) / det;
      const by = (sxx * syL - sxy * sxL) / det;
      gradientFit = Math.max(0, Math.min(1, (bx * sxL + by * syL) / sLL));
    }
  }

  const smoothRatio = samples > 0 ? smooth / samples : 0;
  const textureRatio = samples > 0 ? textured / samples : 0;
  const hasDecorativeElements = textureRatio >= 0.04 && borderUniform;

  if (!borderUniform && textureRatio >= 0.18) {
    return { ...none, kind: 'true_texture', hasDecorativeElements };
  }
  if (!borderUniform && gradientFit >= 0.72 && textureRatio < 0.12) {
    return {
      kind: 'gradient',
      hasUniformCanvas: false,
      hasDecorativeElements,
      rgb,
      oklab: lab,
      chebyshevTol,
      maxSpeckPixels: 10,
    };
  }
  if (!borderUniform) return none;

  let kind: BackgroundKind = nearBlack
    ? 'uniform_black'
    : nearWhite
      ? 'uniform_white'
      : 'uniform_solid';
  if (p90 >= (nearBlack ? 8 : 5) && smoothRatio >= 0.45 && textureRatio < 0.08) {
    kind = 'compression_noise_uniform';
  }

  let shadowPixels = 0;
  const shadowGate = nearBlack ? 18 : 10;
  for (let y = 2; y < height - 2; y += 3) {
    for (let x = 2; x < width - 2; x += 3) {
      const px = y * width + x;
      if (data[px * 4 + 3] < 200) continue;
      const dL = lab[0] - oklab.L[px];
      const d = chebyshev(data[px * 4], data[px * 4 + 1], data[px * 4 + 2], rgb);
      if (dL > shadowGate && dL < 42 && d > chebyshevTol && d < chebyshevTol + 70) {
        shadowPixels++;
      }
    }
  }
  const shadowRatio = samples > 0 ? shadowPixels / samples : 0;
  if (shadowRatio >= 0.06 && shadowRatio <= 0.45) kind = 'shadowed';
  else if (hasDecorativeElements && kind !== 'compression_noise_uniform') kind = 'decorative';

  const maxSpeckPixels = kind === 'shadowed' ? 16 : Math.max(20, Math.round(width * height * 0.0004));

  return {
    kind,
    hasUniformCanvas: true,
    hasDecorativeElements,
    rgb,
    oklab: lab,
    chebyshevTol,
    maxSpeckPixels,
  };
}

function matchesBackground(
  px: number,
  data: Uint8Array,
  bg: [number, number, number],
  tol: number,
  lab: [number, number, number] | null,
  oklab: PerceptualOklabBuffers,
  nearExtreme: boolean
): boolean {
  const i = px * 4;
  if (data[i + 3] < 12) return true;
  if (chebyshev(data[i], data[i + 1], data[i + 2], bg) <= tol) return true;
  if (!nearExtreme && lab) {
    return deltaEOklab(oklab.L[px], oklab.a[px], oklab.b[px], lab[0], lab[1], lab[2]) <= 3.2;
  }
  return false;
}

function chebyshevToForeground(
  px: number,
  width: number,
  height: number,
  data: Uint8Array,
  bg: [number, number, number],
  tol: number
): boolean {
  const x = px % width;
  const y = (px - x) / width;
  const neighbors = [
    x > 0 ? px - 1 : -1,
    x + 1 < width ? px + 1 : -1,
    y > 0 ? px - width : -1,
    y + 1 < height ? px + width : -1,
  ];
  for (const nPx of neighbors) {
    if (nPx < 0) continue;
    const i = nPx * 4;
    if (chebyshev(data[i], data[i + 1], data[i + 2], bg) > tol + 36) return true;
  }
  return false;
}

/**
 * Pinta a máscara de fundo (1 = fundo) com flood a partir da borda, furos da mesma cor
 * e absorção de manchas de compressão. Pixels de objeto (contraste acima da tolerância) ficam de fora.
 */
export function paintUniformBackgroundMask(
  image: RawRgbaImage,
  oklab: PerceptualOklabBuffers,
  classification: BackgroundClassification,
  isBackgroundPx: Uint8Array
): void {
  const { width, height, data } = image;
  const total = width * height;
  isBackgroundPx.fill(0);

  if (!classification.hasUniformCanvas || !classification.rgb) {
    for (let i = 0; i < total; i++) {
      if (data[i * 4 + 3] < 12) isBackgroundPx[i] = 1;
    }
    return;
  }

  const bg = classification.rgb;
  const tol = classification.chebyshevTol;
  const nearExtreme =
    classification.kind === 'uniform_black' ||
    classification.kind === 'uniform_white' ||
    classification.kind === 'compression_noise_uniform' ||
    classification.kind === 'shadowed' ||
    classification.kind === 'decorative';
  const isBg = (px: number) =>
    matchesBackground(px, data, bg, tol, classification.oklab, oklab, nearExtreme);

  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const seed = (px: number) => {
    if (isBackgroundPx[px] || !isBg(px)) return;
    isBackgroundPx[px] = 1;
    queue[tail++] = px;
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + (width - 1));
  }
  while (head < tail) {
    const px = queue[head++];
    const x = px % width;
    const y = (px - x) / width;
    const stepTo = (nPx: number) => {
      if (nPx < 0 || isBackgroundPx[nPx] || !isBg(nPx)) return;
      if (chebyshevToForeground(nPx, width, height, data, bg, tol)) return;
      isBackgroundPx[nPx] = 1;
      queue[tail++] = nPx;
    };
    stepTo(x > 0 ? px - 1 : -1);
    stepTo(x + 1 < width ? px + 1 : -1);
    stepTo(y > 0 ? px - width : -1);
    stepTo(y + 1 < height ? px + width : -1);
  }

  const seen = new Uint8Array(total);
  const protect = tol + (classification.kind === 'uniform_black' ? 14 : 10);
  for (let start = 0; start < total; start++) {
    if (isBackgroundPx[start] || seen[start]) continue;
    if (data[start * 4 + 3] < 12) {
      isBackgroundPx[start] = 1;
      continue;
    }
    let qh = 0;
    let qt = 0;
    queue[qt++] = start;
    seen[start] = 1;
    let count = 0;
    let touchesBorder = false;
    let maxDist = 0;
    let sumDist = 0;
    while (qh < qt) {
      const px = queue[qh++];
      count++;
      const i = px * 4;
      const dist = chebyshev(data[i], data[i + 1], data[i + 2], bg);
      sumDist += dist;
      if (dist > maxDist) maxDist = dist;
      const x = px % width;
      const y = (px - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      const nbs = [
        x > 0 ? px - 1 : -1,
        x + 1 < width ? px + 1 : -1,
        y > 0 ? px - width : -1,
        y + 1 < height ? px + width : -1,
      ];
      for (const nPx of nbs) {
        if (nPx < 0 || seen[nPx] || isBackgroundPx[nPx]) continue;
        seen[nPx] = 1;
        queue[qt++] = nPx;
      }
    }
    const meanDist = sumDist / Math.max(1, count);
    const hole =
      !touchesBorder && meanDist <= tol && maxDist <= protect && count >= 4;
    const speck =
      count <= classification.maxSpeckPixels && meanDist <= tol + 2 && maxDist <= protect;
    if (hole || speck) {
      for (let k = 0; k < qt; k++) isBackgroundPx[queue[k]] = 1;
    }
  }
}
