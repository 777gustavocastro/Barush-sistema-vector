import type { ColorAnalysisReport, RawRgbaImage } from '../types';

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Analisa distribuição de cores, transparência, contraste de luminância e
 * identifica se a imagem é candidata ideal ao Potrace (monocromática/alto contraste)
 * ou ao VTracer (multicor/gradientes/ilustrações).
 */
export function analyzeImageColors(image: RawRgbaImage): ColorAnalysisReport {
  const { data, width, height } = image;
  const totalPixels = width * height;
  if (totalPixels === 0 || data.length < totalPixels * 4) {
    return {
      width,
      height,
      totalPixels: 0,
      hasTransparency: false,
      transparentPixelRatio: 0,
      estimatedDistinctColors: 0,
      luminanceContrast: 0,
      isMonochromeCandidate: false,
      dominantHexColors: [],
      recommendedEngine: 'vtracer',
    };
  }

  // Amostragem determinística para imagens grandes (até ~65k amostras)
  const stride = Math.max(1, Math.floor(totalPixels / 65536));
  const bucketCounts = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();

  let sampledPixels = 0;
  let transparentCount = 0;
  let opaqueSamples = 0;
  let nearExtremeLuminanceCount = 0;
  let lowSaturationCount = 0;
  let minLum = 255;
  let maxLum = 0;

  for (let px = 0; px < totalPixels; px += stride) {
    const offset = px * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    sampledPixels++;

    if (a < 245) {
      transparentCount++;
      if (a < 32) {
        continue;
      }
    }

    opaqueSamples++;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;

    if (lum <= 45 || lum >= 210) {
      nearExtremeLuminanceCount++;
    }

    const maxCh = Math.max(r, g, b);
    const minCh = Math.min(r, g, b);
    if (maxCh - minCh <= 22) {
      lowSaturationCount++;
    }

    // Quantização em 4 bits por canal (4096 buckets perceptuais)
    const bucketKey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const existing = bucketCounts.get(bucketKey);
    if (existing) {
      existing.count++;
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
    } else {
      bucketCounts.set(bucketKey, { count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  const minSignificantCount = Math.max(1, Math.floor(opaqueSamples * 0.002));
  const significantBuckets = [...bucketCounts.values()]
    .filter((entry) => entry.count >= minSignificantCount)
    .sort((a, b) => b.count - a.count);

  const dominantHexColors = significantBuckets.slice(0, 8).map((entry) =>
    rgbToHex(entry.rSum / entry.count, entry.gSum / entry.count, entry.bSum / entry.count)
  );

  const transparentPixelRatio = sampledPixels > 0 ? transparentCount / sampledPixels : 0;
  const luminanceContrast = opaqueSamples > 0 ? (maxLum - minLum) / 255 : 0;
  const lowSatRatio = opaqueSamples > 0 ? lowSaturationCount / opaqueSamples : 0;
  const bimodalRatio = opaqueSamples > 0 ? nearExtremeLuminanceCount / opaqueSamples : 0;
  const estimatedDistinctColors = significantBuckets.length;

  const isMonochromeCandidate =
    opaqueSamples > 0 &&
    estimatedDistinctColors <= 3 &&
    lowSatRatio >= 0.92 &&
    bimodalRatio >= 0.75 &&
    luminanceContrast >= 0.35;

  return {
    width,
    height,
    totalPixels,
    hasTransparency: transparentCount > 0,
    transparentPixelRatio,
    estimatedDistinctColors,
    luminanceContrast,
    isMonochromeCandidate,
    dominantHexColors,
    recommendedEngine: isMonochromeCandidate ? 'potrace' : 'vtracer',
  };
}
