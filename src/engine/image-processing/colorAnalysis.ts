import type {
  ColorAnalysisReport,
  DetectedImageCategory,
  RawRgbaImage,
  TunedSliderValues,
  VectorEngineKind,
} from '../types';

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
      .join('')
  );
}

const CATEGORY_LABELS: Record<DetectedImageCategory, string> = {
  monochrome_logo: 'Logo monocromático / Alto contraste',
  color_logo: 'Logo colorido / Arte vetorial plana',
  icon_drawing: 'Ícone / Desenho de traço nítido',
  illustration_pattern: 'Ilustração / Estampa multicor',
  detailed_artwork: 'Arte rica em pequenos detalhes',
  photograph: 'Fotografia / Imagem de tons contínuos',
};

function computePercentileFromHist(hist: Int32Array, total: number, quantile: number): number {
  if (total <= 0) return 0;
  const target = Math.max(1, Math.round(total * quantile));
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

function buildRecommendedParameters(
  category: DetectedImageCategory,
  metrics: {
    estimatedDistinctColors: number;
    fineColorBins: number;
    noiseLevel: number;
    smallDetailDensity: number;
    gradientRatio: number;
  }
): TunedSliderValues {
  // Ajusta remoção de ruído proporcionalmente ao ruído medido, protegendo detalhes finos
  const detailProtectionCap = metrics.smallDetailDensity > 0.14 ? 22 : 65;
  const adaptiveNoise = Math.min(
    detailProtectionCap,
    Math.max(8, Math.round(12 + metrics.noiseLevel * 0.65))
  );

  switch (category) {
    case 'monochrome_logo':
      return {
        colorCount: 2,
        detailPrecision: metrics.smallDetailDensity > 0.12 ? 86 : 78,
        curveSmoothness: 80,
        pathSimplification: metrics.smallDetailDensity > 0.12 ? 20 : 38,
        noiseRemoval: Math.max(18, adaptiveNoise),
        contourSensitivity: 74,
      };

    case 'icon_drawing':
      return {
        colorCount: Math.max(2, Math.min(8, metrics.estimatedDistinctColors + 1)),
        detailPrecision: 86,
        curveSmoothness: 72,
        pathSimplification: 22,
        noiseRemoval: Math.min(28, adaptiveNoise),
        contourSensitivity: 82,
      };

    case 'color_logo':
      return {
        colorCount: Math.max(4, Math.min(16, metrics.estimatedDistinctColors + 2)),
        detailPrecision: 82,
        curveSmoothness: 82,
        pathSimplification: 32,
        noiseRemoval: Math.max(16, adaptiveNoise),
        contourSensitivity: 76,
      };

    case 'detailed_artwork':
      return {
        colorCount: Math.max(16, Math.min(48, Math.round(metrics.fineColorBins * 0.45))),
        detailPrecision: 92,
        curveSmoothness: 55,
        pathSimplification: 8,
        noiseRemoval: Math.min(15, adaptiveNoise),
        contourSensitivity: 88,
      };

    case 'photograph':
      return {
        colorCount: 40,
        detailPrecision: 84,
        curveSmoothness: 58,
        pathSimplification: 18,
        noiseRemoval: Math.max(20, Math.min(45, adaptiveNoise)),
        contourSensitivity: 70,
      };

    case 'illustration_pattern':
    default:
      return {
        colorCount: Math.max(12, Math.min(32, metrics.estimatedDistinctColors + 4)),
        detailPrecision: 80,
        curveSmoothness: 68,
        pathSimplification: 24,
        noiseRemoval: adaptiveNoise,
        contourSensitivity: 74,
      };
  }
}

/**
 * Inteligência de análise de imagem: avalia 8 critérios reais (cores, contraste, complexidade,
 * contornos, gradientes, transparência, ruídos e detalhes pequenos) para selecionar o motor
 * e calibrar parâmetros sob medida para cada categoria de imagem.
 */
export function analyzeImageColors(image: RawRgbaImage): ColorAnalysisReport {
  const { data, width, height } = image;
  const totalPixels = width * height;

  if (totalPixels === 0 || data.length < totalPixels * 4) {
    const fallbackParams: TunedSliderValues = {
      colorCount: 16,
      detailPrecision: 75,
      curveSmoothness: 68,
      pathSimplification: 30,
      noiseRemoval: 25,
      contourSensitivity: 70,
    };
    return {
      width,
      height,
      totalPixels: 0,
      hasTransparency: false,
      transparentPixelRatio: 0,
      meanOpaqueLuminance: 128,
      estimatedDistinctColors: 0,
      fineColorBins: 0,
      luminanceContrast: 0,
      complexityScore: 0,
      edgeDensity: 0,
      gradientRatio: 0,
      noiseLevel: 0,
      smallDetailDensity: 0,
      isMonochromeCandidate: false,
      detectedCategory: 'illustration_pattern',
      categoryLabel: CATEGORY_LABELS.illustration_pattern,
      dominantHexColors: [],
      recommendedEngine: 'vtracer',
      recommendedParameters: fallbackParams,
    };
  }

  // 1. Análise de paleta, luminância e transparência
  const stride = Math.max(1, Math.floor(totalPixels / 65536));
  const coarseBuckets = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();
  const fineBuckets = new Map<number, number>();
  const lumHistogram = new Int32Array(256);

  let sampledPixels = 0;
  let transparentCount = 0;
  let opaqueSamples = 0;
  let opaqueLumSum = 0;
  let nearExtremeLuminanceCount = 0;
  let lowSaturationCount = 0;

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
    const lum = Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
    lumHistogram[lum]++;
    opaqueLumSum += lum;

    if (lum <= 50 || lum >= 205) {
      nearExtremeLuminanceCount++;
    }

    const maxCh = Math.max(r, g, b);
    const minCh = Math.min(r, g, b);
    if (maxCh - minCh <= 24) {
      lowSaturationCount++;
    }

    const coarseKey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const existing = coarseBuckets.get(coarseKey);
    if (existing) {
      existing.count++;
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
    } else {
      coarseBuckets.set(coarseKey, { count: 1, rSum: r, gSum: g, bSum: b });
    }

    const fineKey = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    fineBuckets.set(fineKey, (fineBuckets.get(fineKey) ?? 0) + 1);
  }

  const minSignificantCoarse = Math.max(1, Math.floor(opaqueSamples * 0.0025));
  const significantBuckets = [...coarseBuckets.values()]
    .filter((entry) => entry.count >= minSignificantCoarse)
    .sort((a, b) => b.count - a.count);

  const minSignificantFine = Math.max(1, Math.floor(opaqueSamples * 0.0008));
  let fineColorBins = 0;
  for (const count of fineBuckets.values()) {
    if (count >= minSignificantFine) fineColorBins++;
  }

  const dominantHexColors = significantBuckets.slice(0, 8).map((entry) =>
    rgbToHex(entry.rSum / entry.count, entry.gSum / entry.count, entry.bSum / entry.count)
  );

  const transparentPixelRatio = sampledPixels > 0 ? transparentCount / sampledPixels : 0;
  const meanOpaqueLuminance = opaqueSamples > 0 ? opaqueLumSum / opaqueSamples : 128;

  const p02 = computePercentileFromHist(lumHistogram, opaqueSamples, 0.02);
  const p98 = computePercentileFromHist(lumHistogram, opaqueSamples, 0.98);
  const compositeLumContrast = opaqueSamples > 0 ? (p98 - p02) / 255 : 0;
  // Quando há fundo transparente + figura monocromática uniforme (ex.: logo todo preto ou todo branco em PNG transparente), há contraste alfa-figura máximo
  const luminanceContrast =
    transparentPixelRatio >= 0.08 && transparentPixelRatio <= 0.96
      ? Math.max(compositeLumContrast, 0.85)
      : compositeLumContrast;

  // 2. Análise espacial 2D: contornos, gradientes suaves, ruídos isolados e detalhes pequenos
  const gridW = Math.min(width, 240);
  const gridH = Math.min(height, 240);
  const lumGrid = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    const srcY = Math.min(height - 1, Math.floor((gy * height) / gridH));
    for (let gx = 0; gx < gridW; gx++) {
      const srcX = Math.min(width - 1, Math.floor((gx * width) / gridW));
      const idx = (srcY * width + srcX) * 4;
      const alpha = data[idx + 3] / 255;
      // Compõe contra cinza neutro contrastante caso haja transparência para medir bordas alfa também
      const bg = meanOpaqueLuminance > 180 ? 20 : 245;
      const r = data[idx] * alpha + bg * (1 - alpha);
      const g = data[idx + 1] * alpha + bg * (1 - alpha);
      const b = data[idx + 2] * alpha + bg * (1 - alpha);
      lumGrid[gy * gridW + gx] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  let sharpEdgePixels = 0;
  let smoothGradPixels = 0;
  let noiseOutlierPixels = 0;
  let fineFlipPixels = 0;
  const interiorTotal = Math.max(1, (gridW - 2) * (gridH - 2));

  for (let y = 1; y < gridH - 1; y++) {
    const row = y * gridW;
    for (let x = 1; x < gridW - 1; x++) {
      const c = lumGrid[row + x];
      const left = lumGrid[row + x - 1];
      const right = lumGrid[row + x + 1];
      const up = lumGrid[row - gridW + x];
      const down = lumGrid[row + gridW + x];

      const gx = Math.abs(right - left);
      const gy = Math.abs(down - up);
      const gradMag = gx + gy;

      if (gradMag >= 34) {
        sharpEdgePixels++;
      } else if (gradMag >= 5) {
        smoothGradPixels++;
      }

      // Detecção de ruído isolado (center difere da vizinhança, mas vizinhos concordam entre si)
      const neighborMean = (left + right + up + down) * 0.25;
      const neighborSpread = Math.max(Math.abs(left - right), Math.abs(up - down));
      if (Math.abs(c - neighborMean) >= 18 && neighborSpread <= 12) {
        noiseOutlierPixels++;
      }

      // Detecção de traços finos / microdetalhes (inversão rápida de sinal na derivada local)
      const d1x = c - left;
      const d2x = right - c;
      const d1y = c - up;
      const d2y = down - c;
      if (
        (d1x * d2x < -140 && Math.abs(d1x) > 12 && Math.abs(d2x) > 12) ||
        (d1y * d2y < -140 && Math.abs(d1y) > 12 && Math.abs(d2y) > 12)
      ) {
        fineFlipPixels++;
      }
    }
  }

  const edgeDensity = Number((sharpEdgePixels / interiorTotal).toFixed(4));
  const activeTransitionTotal = Math.max(1, sharpEdgePixels + smoothGradPixels);
  const gradientRatio = Number((smoothGradPixels / activeTransitionTotal).toFixed(4));
  const rawNoiseRatio = noiseOutlierPixels / interiorTotal;
  const noiseLevel = Math.min(100, Math.round(rawNoiseRatio * 1200));
  const smallDetailDensity = Number((fineFlipPixels / interiorTotal).toFixed(4));

  const estimatedDistinctColors = Math.max(1, significantBuckets.length);
  const lowSatRatio = opaqueSamples > 0 ? lowSaturationCount / opaqueSamples : 0;
  const bimodalRatio = opaqueSamples > 0 ? nearExtremeLuminanceCount / opaqueSamples : 0;

  // Complexidade global combinada (0..100)
  const complexityScore = Math.min(
    100,
    Math.round(
      Math.min(35, fineColorBins * 0.28) +
        Math.min(30, edgeDensity * 180) +
        Math.min(20, gradientRatio * 28) +
        Math.min(15, smallDetailDensity * 150)
    )
  );

  // Verifica espalhamento cromático entre os buckets opacos significativos
  let maxOpaqueColorSpread = 0;
  if (significantBuckets.length >= 2) {
    const top = significantBuckets[0];
    const r0 = top.rSum / top.count;
    const g0 = top.gSum / top.count;
    const b0 = top.bSum / top.count;
    for (let i = 1; i < significantBuckets.length; i++) {
      const cur = significantBuckets[i];
      const ri = cur.rSum / cur.count;
      const gi = cur.gSum / cur.count;
      const bi = cur.bSum / cur.count;
      const dist = Math.hypot(ri - r0, gi - g0, bi - b0);
      if (dist > maxOpaqueColorSpread) {
        maxOpaqueColorSpread = dist;
      }
    }
  }

  // Agrupa buckets opacos próximos (ex.: suavização de bordas/anti-aliasing entre tinta e papel branco)
  const colorClusters: Array<{ r: number; g: number; b: number; lum: number; count: number }> = [];
  for (const b of significantBuckets) {
    const r = b.rSum / b.count;
    const g = b.gSum / b.count;
    const bl = b.bSum / b.count;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const match = colorClusters.find((c) => Math.hypot(c.r - r, c.g - g, c.b - bl) <= 48);
    if (match) {
      match.count += b.count;
    } else {
      colorClusters.push({ r, g, b: bl, lum, count: b.count });
    }
  }

  // 1) Silhueta de cor única sobre fundo transparente (preserva inclusive branco sobre transparente; exclui ícones bicolores + alfa)
  const isSingleColorOnAlpha =
    transparentPixelRatio >= 0.08 &&
    transparentPixelRatio <= 0.97 &&
    maxOpaqueColorSpread <= 48 &&
    gradientRatio < 0.42;

  // 2) Arte/logo monocromático clássico de tinta escura sobre fundo branco opaco
  const hasWhitePaperAndSingleDarkInk =
    transparentPixelRatio < 0.08 &&
    colorClusters.length === 2 &&
    Math.max(colorClusters[0].lum, colorClusters[1].lum) >= 238 &&
    Math.min(colorClusters[0].lum, colorClusters[1].lum) <= 80;

  const isClassicBimodalMono =
    opaqueSamples > 0 &&
    (hasWhitePaperAndSingleDarkInk ||
      (colorClusters.length <= 2 &&
        lowSatRatio >= 0.88 &&
        bimodalRatio >= 0.68 &&
        transparentPixelRatio < 0.08)) &&
    luminanceContrast >= 0.35 &&
    gradientRatio < 0.45;

  const isMonochromeCandidate = isSingleColorOnAlpha || isClassicBimodalMono;

  // Classificação automática entre as categorias
  let detectedCategory: DetectedImageCategory;
  if (isMonochromeCandidate) {
    detectedCategory = smallDetailDensity > 0.14 ? 'icon_drawing' : 'monochrome_logo';
  } else if (fineColorBins >= 75 && gradientRatio >= 0.52) {
    detectedCategory = 'photograph';
  } else if (smallDetailDensity >= 0.11 || (edgeDensity >= 0.22 && fineColorBins >= 20)) {
    detectedCategory = 'detailed_artwork';
  } else if (estimatedDistinctColors <= 6 && gradientRatio < 0.38) {
    detectedCategory = edgeDensity >= 0.12 ? 'icon_drawing' : 'color_logo';
  } else if (estimatedDistinctColors <= 14 && gradientRatio < 0.48) {
    detectedCategory = 'color_logo';
  } else {
    detectedCategory = 'illustration_pattern';
  }

  const recommendedEngine: VectorEngineKind = isMonochromeCandidate ? 'potrace' : 'vtracer';
  const recommendedParameters = buildRecommendedParameters(detectedCategory, {
    estimatedDistinctColors,
    fineColorBins,
    noiseLevel,
    smallDetailDensity,
    gradientRatio,
  });

  return {
    width,
    height,
    totalPixels,
    hasTransparency: transparentCount > 0,
    transparentPixelRatio: Number(transparentPixelRatio.toFixed(4)),
    meanOpaqueLuminance: Math.round(meanOpaqueLuminance),
    estimatedDistinctColors,
    fineColorBins,
    luminanceContrast: Number(luminanceContrast.toFixed(3)),
    complexityScore,
    edgeDensity,
    gradientRatio,
    noiseLevel,
    smallDetailDensity,
    isMonochromeCandidate,
    detectedCategory,
    categoryLabel: CATEGORY_LABELS[detectedCategory],
    dominantHexColors,
    recommendedEngine,
    recommendedParameters,
  };
}
