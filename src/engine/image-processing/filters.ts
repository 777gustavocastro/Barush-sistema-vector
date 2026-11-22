import type { RawRgbaImage } from '../types';

export const MIN_IMAGE_DIMENSION = 8;
export const MAX_IMAGE_DIMENSION = 8192;
export const DEFAULT_MAX_WORKING_DIMENSION = 2400;

export function validateImageDimensions(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_IMAGE_DIMENSION ||
    height < MIN_IMAGE_DIMENSION
  ) {
    throw new Error(
      `Dimensões muito pequenas (${width}×${height} px). Envie uma imagem com pelo menos ${MIN_IMAGE_DIMENSION}×${MIN_IMAGE_DIMENSION} pixels.`
    );
  }
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > 36_000_000
  ) {
    throw new Error(
      `Dimensões excedem o limite seguro de memória (${width}×${height} px). O máximo suportado é ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION} px (até 36 MP).`
    );
  }
}

/**
 * Redimensiona proporcionalmente buffers muito grandes por amostragem em área ponderada por alfa,
 * evitando estouro de memória WebAssembly e mantendo nitidez e cores fiéis sem halo escuro em bordas transparentes.
 */
export function downscaleRgbaIfNeeded(
  image: RawRgbaImage,
  maxDimension = DEFAULT_MAX_WORKING_DIMENSION
): { image: RawRgbaImage; wasDownscaled: boolean } {
  validateImageDimensions(image.width, image.height);

  const longestSide = Math.max(image.width, image.height);
  if (longestSide <= maxDimension) {
    return { image, wasDownscaled: false };
  }

  const scale = maxDimension / longestSide;
  const targetWidth = Math.max(MIN_IMAGE_DIMENSION, Math.round(image.width * scale));
  const targetHeight = Math.max(MIN_IMAGE_DIMENSION, Math.round(image.height * scale));
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  const src = image.data;
  const xRatio = image.width / targetWidth;
  const yRatio = image.height / targetHeight;

  for (let ty = 0; ty < targetHeight; ty++) {
    const syStart = Math.floor(ty * yRatio);
    const syEnd = Math.min(image.height, Math.ceil((ty + 1) * yRatio));

    for (let tx = 0; tx < targetWidth; tx++) {
      const sxStart = Math.floor(tx * xRatio);
      const sxEnd = Math.min(image.width, Math.ceil((tx + 1) * xRatio));

      let rPremult = 0;
      let gPremult = 0;
      let bPremult = 0;
      let alphaSum = 0;
      let count = 0;

      for (let sy = syStart; sy < syEnd; sy++) {
        const rowOffset = sy * image.width;
        for (let sx = sxStart; sx < sxEnd; sx++) {
          const sIdx = (rowOffset + sx) * 4;
          const a = src[sIdx + 3];
          rPremult += src[sIdx] * a;
          gPremult += src[sIdx + 1] * a;
          bPremult += src[sIdx + 2] * a;
          alphaSum += a;
          count++;
        }
      }

      const dIdx = (ty * targetWidth + tx) * 4;
      if (count === 0 || alphaSum === 0) {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      } else {
        out[dIdx] = Math.round(rPremult / alphaSum);
        out[dIdx + 1] = Math.round(gPremult / alphaSum);
        out[dIdx + 2] = Math.round(bPremult / alphaSum);
        out[dIdx + 3] = Math.round(alphaSum / count);
      }
    }
  }

  return {
    image: {
      data: out,
      width: targetWidth,
      height: targetHeight,
      sourceFormat: image.sourceFormat,
    },
    wasDownscaled: true,
  };
}

function catmullRomWeight(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  // Catmull-Rom (a = -0.5): interpola exatamente pelos pontos originais com tangentes C1 contínuas
  const w0 = -0.5 * t + t2 - 0.5 * t3;
  const w1 = 1.0 - 2.5 * t2 + 1.5 * t3;
  const w2 = 0.5 * t + 2.0 * t2 - 1.5 * t3;
  const w3 = -0.5 * t2 + 0.5 * t3;
  return [w0, w1, w2, w3];
}

/**
 * Super-amostragem sub-pixel bicúbica Catmull-Rom monotônica (clamped) em espaço alfa pré-multiplicado.
 * Elimina o serrilhado de grade de 1px em asas, diagonais, pontas finas e tipografia ANTES da
 * reconstrução de splines Bézier, sem jamais introduzir halos de overshoot (ringing) nas bordas.
 */
export function upscaleRgbaCatmullRom(
  image: RawRgbaImage,
  scaleFactor: 2 | 3
): RawRgbaImage {
  const { width: srcW, height: srcH, data: src } = image;
  const dstW = srcW * scaleFactor;
  const dstH = srcH * scaleFactor;

  // Passo 1: Interpolação horizontal (srcW -> dstW, altura srcH) em float pré-multiplicado
  const horiz = new Float32Array(dstW * srcH * 4);

  const xIndices = new Int32Array(dstW * 4);
  const xWeights = new Float32Array(dstW * 4);
  for (let dx = 0; dx < dstW; dx++) {
    const srcPos = (dx + 0.5) / scaleFactor - 0.5;
    const ix = Math.floor(srcPos);
    const t = srcPos - ix;
    const [w0, w1, w2, w3] = catmullRomWeight(t);
    const base = dx * 4;
    xIndices[base] = Math.max(0, Math.min(srcW - 1, ix - 1));
    xIndices[base + 1] = Math.max(0, Math.min(srcW - 1, ix));
    xIndices[base + 2] = Math.max(0, Math.min(srcW - 1, ix + 1));
    xIndices[base + 3] = Math.max(0, Math.min(srcW - 1, ix + 2));
    xWeights[base] = w0;
    xWeights[base + 1] = w1;
    xWeights[base + 2] = w2;
    xWeights[base + 3] = w3;
  }

  for (let y = 0; y < srcH; y++) {
    const srcRow = y * srcW * 4;
    const dstRow = y * dstW * 4;
    for (let dx = 0; dx < dstW; dx++) {
      const k = dx * 4;
      const i0 = srcRow + xIndices[k] * 4;
      const i1 = srcRow + xIndices[k + 1] * 4;
      const i2 = srcRow + xIndices[k + 2] * 4;
      const i3 = srcRow + xIndices[k + 3] * 4;
      const w0 = xWeights[k];
      const w1 = xWeights[k + 1];
      const w2 = xWeights[k + 2];
      const w3 = xWeights[k + 3];

      const a0 = src[i0 + 3] / 255;
      const a1 = src[i1 + 3] / 255;
      const a2 = src[i2 + 3] / 255;
      const a3 = src[i3 + 3] / 255;

      const p1r = src[i1] * a1;
      const p2r = src[i2] * a2;
      const p1g = src[i1 + 1] * a1;
      const p2g = src[i2 + 1] * a2;
      const p1b = src[i1 + 2] * a1;
      const p2b = src[i2 + 2] * a2;

      const rVal = src[i0] * a0 * w0 + p1r * w1 + p2r * w2 + src[i3] * a3 * w3;
      const gVal = src[i0 + 1] * a0 * w0 + p1g * w1 + p2g * w2 + src[i3 + 1] * a3 * w3;
      const bVal = src[i0 + 2] * a0 * w0 + p1b * w1 + p2b * w2 + src[i3 + 2] * a3 * w3;
      const aVal = a0 * w0 + a1 * w1 + a2 * w2 + a3 * w3;

      // Clamping monotônico entre os vizinhos centrais (zero halo/overshoot!)
      const outIdx = dstRow + k;
      horiz[outIdx] = Math.max(Math.min(p1r, p2r), Math.min(Math.max(p1r, p2r), rVal));
      horiz[outIdx + 1] = Math.max(Math.min(p1g, p2g), Math.min(Math.max(p1g, p2g), gVal));
      horiz[outIdx + 2] = Math.max(Math.min(p1b, p2b), Math.min(Math.max(p1b, p2b), bVal));
      horiz[outIdx + 3] = Math.max(Math.min(a1, a2), Math.min(Math.max(a1, a2), aVal));
    }
  }

  // Passo 2: Interpolação vertical (srcH -> dstH) e desmultiplicação por alfa
  const out = new Uint8Array(dstW * dstH * 4);
  for (let dy = 0; dy < dstH; dy++) {
    const srcPos = (dy + 0.5) / scaleFactor - 0.5;
    const iy = Math.floor(srcPos);
    const t = srcPos - iy;
    const [w0, w1, w2, w3] = catmullRomWeight(t);

    const r0 = Math.max(0, Math.min(srcH - 1, iy - 1)) * dstW * 4;
    const r1 = Math.max(0, Math.min(srcH - 1, iy)) * dstW * 4;
    const r2 = Math.max(0, Math.min(srcH - 1, iy + 1)) * dstW * 4;
    const r3 = Math.max(0, Math.min(srcH - 1, iy + 2)) * dstW * 4;

    const dstRow = dy * dstW * 4;
    for (let dx = 0; dx < dstW; dx++) {
      const col = dx * 4;
      const p1r = horiz[r1 + col];
      const p2r = horiz[r2 + col];
      const p1g = horiz[r1 + col + 1];
      const p2g = horiz[r2 + col + 1];
      const p1b = horiz[r1 + col + 2];
      const p2b = horiz[r2 + col + 2];
      const a1 = horiz[r1 + col + 3];
      const a2 = horiz[r2 + col + 3];

      const rPm = Math.max(
        Math.min(p1r, p2r),
        Math.min(
          Math.max(p1r, p2r),
          horiz[r0 + col] * w0 + p1r * w1 + p2r * w2 + horiz[r3 + col] * w3
        )
      );
      const gPm = Math.max(
        Math.min(p1g, p2g),
        Math.min(
          Math.max(p1g, p2g),
          horiz[r0 + col + 1] * w0 + p1g * w1 + p2g * w2 + horiz[r3 + col + 1] * w3
        )
      );
      const bPm = Math.max(
        Math.min(p1b, p2b),
        Math.min(
          Math.max(p1b, p2b),
          horiz[r0 + col + 2] * w0 + p1b * w1 + p2b * w2 + horiz[r3 + col + 2] * w3
        )
      );
      const aFinal = Math.max(
        Math.min(a1, a2),
        Math.min(
          Math.max(a1, a2),
          horiz[r0 + col + 3] * w0 + a1 * w1 + a2 * w2 + horiz[r3 + col + 3] * w3
        )
      );

      const outIdx = dstRow + col;
      if (aFinal <= 0.015) {
        out[outIdx] = 0;
        out[outIdx + 1] = 0;
        out[outIdx + 2] = 0;
        out[outIdx + 3] = 0;
      } else {
        out[outIdx] = Math.max(0, Math.min(255, Math.round(rPm / aFinal)));
        out[outIdx + 1] = Math.max(0, Math.min(255, Math.round(gPm / aFinal)));
        out[outIdx + 2] = Math.max(0, Math.min(255, Math.round(bPm / aFinal)));
        out[outIdx + 3] = Math.max(0, Math.min(255, Math.round(aFinal * 255)));
      }
    }
  }

  return {
    data: out,
    width: dstW,
    height: dstH,
    sourceFormat: image.sourceFormat,
  };
}

/**
 * Limpa resíduos quase invisíveis no canal alfa (alpha <= 6) para evitar polígonos fantasmas
 * em regiões transparentes, preservando totalmente bordas suaves e semitransparentes.
 */
export function cleanAlphaFringes(image: RawRgbaImage): RawRgbaImage {
  const { data, width, height } = image;
  let hasLowAlphaNoise = false;

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0 && data[i] <= 6) {
      hasLowAlphaNoise = true;
      break;
    }
  }

  if (!hasLowAlphaNoise) {
    return image;
  }

  const out = new Uint8Array(data.length);
  out.set(data);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] <= 6) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }

  return {
    data: out,
    width,
    height,
    sourceFormat: image.sourceFormat,
  };
}

/**
 * Filtro seletivo preservador de detalhes:
 * - Quando strengthPercent <= 15 (padrão de alta fidelidade): NÃO altera um único pixel da imagem original!
 * - Quando acionado pelo usuário ou por ruído severo de compressão: remove apenas outliers isolados (1px)
 *   protegendo integralmente traços contínuos, pontas, serrilhas tipográficas e microdetalhes.
 */
export function reduceImageNoise(image: RawRgbaImage, strengthPercent: number): RawRgbaImage {
  if (strengthPercent <= 15 || image.width < 3 || image.height < 3) {
    return image;
  }

  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  out.set(data);

  const outlierThreshold = Math.max(24, Math.round(105 - strengthPercent * 0.65));
  const rWin = new Int32Array(9);
  const gWin = new Int32Array(9);
  const bWin = new Int32Array(9);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const centerIdx = (y * width + x) * 4;
      const alpha = data[centerIdx + 3];
      if (alpha < 16) continue;

      let k = 0;
      let matchingNeighbors = 0;
      const cr = data[centerIdx];
      const cg = data[centerIdx + 1];
      const cb = data[centerIdx + 2];

      for (let dy = -1; dy <= 1; dy++) {
        const rowOffset = (y + dy) * width;
        for (let dx = -1; dx <= 1; dx++) {
          const nIdx = (rowOffset + (x + dx)) * 4;
          const nr = data[nIdx];
          const ng = data[nIdx + 1];
          const nb = data[nIdx + 2];
          rWin[k] = nr;
          gWin[k] = ng;
          bWin[k] = nb;
          k++;

          if (
            (dx !== 0 || dy !== 0) &&
            Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb) <= 34
          ) {
            matchingNeighbors++;
          }
        }
      }

      // Nunca apaga nem arredonda pontas/traços conectados (mesmo 1 vizinho conectado já protege pontas finas!)
      if (matchingNeighbors >= 1 && strengthPercent < 85) {
        continue;
      }

      rWin.sort();
      gWin.sort();
      bWin.sort();

      const medR = rWin[4];
      const medG = gWin[4];
      const medB = bWin[4];

      const diff = Math.abs(cr - medR) + Math.abs(cg - medG) + Math.abs(cb - medB);

      if (diff >= outlierThreshold) {
        out[centerIdx] = medR;
        out[centerIdx + 1] = medG;
        out[centerIdx + 2] = medB;
      }
    }
  }

  return {
    data: out,
    width,
    height,
    sourceFormat: image.sourceFormat,
  };
}

function rgbChannelToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

export interface MonochromeBinarizationResult {
  image: RawRgbaImage;
  foregroundHex: string;
}

/**
 * Binariza imagens monocromáticas preservando:
 * 1) Logos escuros sobre fundo claro ou transparente (via Otsu + sensibilidade);
 * 2) Logos claros/brancos sobre fundo transparente (via máscara de opacidade alfa + cor real preservada).
 */
export function binarizeForMonochromeWithColor(
  image: RawRgbaImage,
  contourSensitivity = 68
): MonochromeBinarizationResult {
  const { data, width, height } = image;
  const totalPixels = width * height;

  let transparentPixels = 0;
  let opaqueCount = 0;
  let opaqueLumSum = 0;
  let opaqueRSum = 0;
  let opaqueGSum = 0;
  let opaqueBSum = 0;

  for (let px = 0; px < totalPixels; px++) {
    const idx = px * 4;
    const a = data[idx + 3];
    if (a < 64) {
      transparentPixels++;
    } else {
      opaqueCount++;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      opaqueRSum += r;
      opaqueGSum += g;
      opaqueBSum += b;
      opaqueLumSum += 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  const transparentRatio = totalPixels > 0 ? transparentPixels / totalPixels : 0;
  const meanOpaqueLum = opaqueCount > 0 ? opaqueLumSum / opaqueCount : 0;

  if (transparentRatio >= 0.08 && opaqueCount > 0 && meanOpaqueLum >= 200) {
    const alphaThreshold = Math.max(
      40,
      Math.min(215, Math.round(150 - ((contourSensitivity - 50) / 50) * 55))
    );
    const out = new Uint8Array(data.length);

    for (let px = 0; px < totalPixels; px++) {
      const idx = px * 4;
      const isForeground = data[idx + 3] >= alphaThreshold;
      const val = isForeground ? 0 : 255;
      out[idx] = val;
      out[idx + 1] = val;
      out[idx + 2] = val;
      out[idx + 3] = 255;
    }

    const fgHex = rgbChannelToHex(
      opaqueRSum / opaqueCount,
      opaqueGSum / opaqueCount,
      opaqueBSum / opaqueCount
    );

    return {
      image: { data: out, width, height, sourceFormat: image.sourceFormat },
      foregroundHex: fgHex,
    };
  }

  const histogram = new Int32Array(256);
  const luminances = new Uint8Array(totalPixels);

  for (let px = 0; px < totalPixels; px++) {
    const idx = px * 4;
    const alpha = data[idx + 3] / 255;
    const r = data[idx] * alpha + 255 * (1 - alpha);
    const g = data[idx + 1] * alpha + 255 * (1 - alpha);
    const b = data[idx + 2] * alpha + 255 * (1 - alpha);
    const lum = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    luminances[px] = lum;
    histogram[lum]++;
  }

  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * histogram[t];

  let sumBg = 0;
  let weightBg = 0;
  let maxVariance = -1;
  let otsuThreshold = 128;

  for (let t = 0; t < 256; t++) {
    weightBg += histogram[t];
    if (weightBg === 0) continue;
    const weightFg = totalPixels - weightBg;
    if (weightFg === 0) break;

    sumBg += t * histogram[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const betweenVariance = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);

    if (betweenVariance > maxVariance) {
      maxVariance = betweenVariance;
      otsuThreshold = t;
    }
  }

  const sensitivityShift = Math.round(((contourSensitivity - 55) / 45) * 20);
  const finalThreshold = Math.max(18, Math.min(238, otsuThreshold + sensitivityShift));

  const out = new Uint8Array(data.length);
  let fgRSum = 0;
  let fgGSum = 0;
  let fgBSum = 0;
  let fgCount = 0;

  for (let px = 0; px < totalPixels; px++) {
    const idx = px * 4;
    const isForeground = luminances[px] <= finalThreshold;
    const val = isForeground ? 0 : 255;
    out[idx] = val;
    out[idx + 1] = val;
    out[idx + 2] = val;
    out[idx + 3] = 255;

    if (isForeground && data[idx + 3] >= 64) {
      fgRSum += data[idx];
      fgGSum += data[idx + 1];
      fgBSum += data[idx + 2];
      fgCount++;
    }
  }

  const foregroundHex =
    fgCount > 0
      ? rgbChannelToHex(fgRSum / fgCount, fgGSum / fgCount, fgBSum / fgCount)
      : '#000000';

  return {
    image: { data: out, width, height, sourceFormat: image.sourceFormat },
    foregroundHex,
  };
}

export function binarizeForMonochrome(
  image: RawRgbaImage,
  contourSensitivity = 68
): RawRgbaImage {
  return binarizeForMonochromeWithColor(image, contourSensitivity).image;
}
