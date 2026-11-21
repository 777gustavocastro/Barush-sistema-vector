import type { RawRgbaImage } from '../types';

/**
 * Filtro mediano seletivo 3x3 preservador de bordas para redução de ruídos de compressão (JPEG/WebP)
 * e manchas isoladas sem borrar contornos nítidos.
 */
export function reduceImageNoise(image: RawRgbaImage, strengthPercent: number): RawRgbaImage {
  if (strengthPercent <= 5 || image.width < 3 || image.height < 3) {
    return image;
  }

  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  out.set(data);

  // Quanto maior strengthPercent (0..100), menor o limiar para substituir outliers de ruído
  const outlierThreshold = Math.max(12, Math.round(90 - strengthPercent * 0.65));
  const rWin = new Int32Array(9);
  const gWin = new Int32Array(9);
  const bWin = new Int32Array(9);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const centerIdx = (y * width + x) * 4;
      const alpha = data[centerIdx + 3];
      if (alpha < 16) continue;

      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const rowOffset = (y + dy) * width;
        for (let dx = -1; dx <= 1; dx++) {
          const nIdx = (rowOffset + (x + dx)) * 4;
          rWin[k] = data[nIdx];
          gWin[k] = data[nIdx + 1];
          bWin[k] = data[nIdx + 2];
          k++;
        }
      }

      rWin.sort();
      gWin.sort();
      bWin.sort();

      const medR = rWin[4];
      const medG = gWin[4];
      const medB = bWin[4];

      const diff =
        Math.abs(data[centerIdx] - medR) +
        Math.abs(data[centerIdx + 1] - medG) +
        Math.abs(data[centerIdx + 2] - medB);

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

/**
 * Segmentação/quantização uniforme de cores no espaço RGB para simplificar gradientes ruidosos
 * quando o número alvo de cores é baixo (ex.: logos e ilustrações planas).
 */
export function quantizeColorLevels(image: RawRgbaImage, targetColorCount: number): RawRgbaImage {
  const clampedColors = Math.max(2, Math.min(64, Math.round(targetColorCount)));
  if (clampedColors >= 48) {
    return image;
  }

  const levelsPerChannel = Math.max(2, Math.round(Math.cbrt(clampedColors * 2)));
  const step = 255 / (levelsPerChannel - 1);
  const { data, width, height } = image;
  const out = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 20) {
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = 0;
      continue;
    }
    out[i] = Math.round(Math.round(data[i] / step) * step);
    out[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
    out[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
    out[i + 3] = a >= 240 ? 255 : a;
  }

  return {
    data: out,
    width,
    height,
    sourceFormat: image.sourceFormat,
  };
}

/**
 * Calcula limiar automático pelo método de Otsu e binariza a imagem para alto contraste
 * antes do envio ao Potrace (tratando transparência como fundo branco).
 */
export function binarizeForMonochrome(
  image: RawRgbaImage,
  contourSensitivity = 68
): RawRgbaImage {
  const { data, width, height } = image;
  const totalPixels = width * height;
  const histogram = new Int32Array(256);
  const luminances = new Uint8Array(totalPixels);

  for (let px = 0; px < totalPixels; px++) {
    const idx = px * 4;
    const alpha = data[idx + 3] / 255;
    // Compõe sobre fundo branco para garantir contraste consistente em PNG/WebP transparentes
    const r = data[idx] * alpha + 255 * (1 - alpha);
    const g = data[idx + 1] * alpha + 255 * (1 - alpha);
    const b = data[idx + 2] * alpha + 255 * (1 - alpha);
    const lum = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    luminances[px] = lum;
    histogram[lum]++;
  }

  // Limiar ótimo de Otsu
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

  // Ajuste fino baseado na sensibilidade dos contornos (10..100 -> -25..+25)
  const sensitivityShift = Math.round(((contourSensitivity - 55) / 45) * 22);
  const finalThreshold = Math.max(20, Math.min(235, otsuThreshold + sensitivityShift));

  const out = new Uint8Array(data.length);
  for (let px = 0; px < totalPixels; px++) {
    const idx = px * 4;
    const isForeground = luminances[px] <= finalThreshold;
    const val = isForeground ? 0 : 255;
    out[idx] = val;
    out[idx + 1] = val;
    out[idx + 2] = val;
    out[idx + 3] = 255;
  }

  return {
    data: out,
    width,
    height,
    sourceFormat: image.sourceFormat,
  };
}
