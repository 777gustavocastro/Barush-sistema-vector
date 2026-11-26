import type {
  ColorAnalysisReport,
  DetectedImageCategory,
  RawRgbaImage,
  TunedSliderValues,
} from '../types';
import { detectTypographyRegions } from '../typography/typographyProcessor';

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((channel) =>
        Math.max(0, Math.min(255, Math.round(channel)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

const CATEGORY_LABELS: Record<DetectedImageCategory, string> = {
  gradient_logo: 'Logo colorido com degradês',
  solid_logo: 'Logo / Ícone com cores sólidas',
  icon_graphic: 'Ícone / Símbolo vetorial',
  character_illustration: 'Personagem / Ilustração sombreada',
  metallic_lighting: 'Superfície metálica / Iluminação',
  complex_illustration: 'Ilustração complexa / Estampa',
  monochrome_drawing: 'Desenho / Arte monocromática',
  typography_text: 'Texto e tipografia em destaque',
  photograph: 'Fotografia / Tons contínuos',
};

const STRATEGY_SUMMARIES: Record<DetectedImageCategory, string> = {
  gradient_logo:
    'Topologia de fronteiras compartilhadas + espaço perceptual OKLab + gradientes SVG nativos multi-stop e nitidez tipográfica.',
  solid_logo:
    'Fronteiras compartilhadas sem fendas + curvas Bézier precisas preservando cantos agudos, retas e vazios internos.',
  icon_graphic:
    'Geometria exata de retas, arcos e cantos C⁰ + alinhamento sub-pixel para ícones e símbolos.',
  character_illustration:
    'Separação anatômica de camadas + preservação de subtons, sombras confinadas por clipPath, olhos e contornos finos.',
  metallic_lighting:
    'Gradientes OKLab de alta resolução (23 stops) + focos especulares (fx, fy) e iluminação composta sem banding.',
  complex_illustration:
    'Paleta perceptual completa + retenção integral de microformas, sombras, reflexos e subdivisões confinadas.',
  monochrome_drawing:
    'Traçado Bézier monocromático sub-pixel de alto contraste preservando traços finos e extremidades.',
  typography_text:
    'Modo tipográfico dedicado 3× letra por letra sem simplificação destrutiva, preservando hastes, serifas e olhos.',
  photograph:
    'Segmentação perceptual OKLab controlada + aproximação vetorial em camadas e gradientes sem posterização brusca.',
};

function computePercentileFromHist(
  hist: Int32Array,
  total: number,
  quantile: number
): number {
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
    noiseLevel: number;
    smallDetailDensity: number;
  }
): TunedSliderValues {
  // NUNCA aplica filtro de ruído automaticamente em imagens limpas (preserva 100% dos detalhes originais!)
  const safeNoiseRemoval =
    metrics.noiseLevel <= 10
      ? 0
      : Math.min(
          metrics.smallDetailDensity > 0.1 ? 18 : 32,
          Math.round((metrics.noiseLevel - 10) * 0.5)
        );

  switch (category) {
    case 'gradient_logo':
    case 'metallic_lighting':
      return {
        colorCount: 256,
        detailPrecision: 96,
        curveSmoothness: 68,
        pathSimplification: 0,
        noiseRemoval: safeNoiseRemoval,
        contourSensitivity: 86,
      };

    case 'solid_logo':
    case 'icon_graphic':
      return {
        colorCount: 160,
        detailPrecision: 94,
        curveSmoothness: 70,
        pathSimplification: 4,
        noiseRemoval: safeNoiseRemoval,
        contourSensitivity: 86,
      };

    case 'character_illustration':
      return {
        colorCount: 256,
        detailPrecision: 96,
        curveSmoothness: 66,
        pathSimplification: 0,
        noiseRemoval: safeNoiseRemoval,
        contourSensitivity: 88,
      };

    case 'typography_text':
      return {
        colorCount: 128,
        detailPrecision: 98,
        curveSmoothness: 58,
        pathSimplification: 0,
        noiseRemoval: 0,
        contourSensitivity: 92,
      };

    case 'monochrome_drawing':
      return {
        colorCount: 2,
        detailPrecision: 94,
        curveSmoothness: 70,
        pathSimplification: 5,
        noiseRemoval: safeNoiseRemoval,
        contourSensitivity: 80,
      };

    case 'photograph':
      return {
        colorCount: 256,
        detailPrecision: 92,
        curveSmoothness: 60,
        pathSimplification: 6,
        noiseRemoval: Math.max(safeNoiseRemoval, metrics.noiseLevel > 15 ? 18 : 0),
        contourSensitivity: 78,
      };

    case 'complex_illustration':
    default:
      return {
        colorCount: 256,
        detailPrecision: 95,
        curveSmoothness: 64,
        pathSimplification: 0,
        noiseRemoval: safeNoiseRemoval,
        contourSensitivity: 86,
      };
  }
}

/**
 * Inteligência adaptativa de análise de imagem:
 * Avalia cores reais, contraste, contornos, gradientes, transparência, ruído, detalhes pequenos
 * e regiões de tipografia, classificando em 6 estratégias específicas e garantindo que Potrace
 * jamais seja usado em imagens coloridas ou com degradês.
 */
export function analyzeImageColors(image: RawRgbaImage): ColorAnalysisReport {
  const { data, width, height } = image;
  const totalPixels = width * height;

  if (totalPixels === 0 || data.length < totalPixels * 4) {
    const fallbackParams: TunedSliderValues = {
      colorCount: 256,
      detailPrecision: 94,
      curveSmoothness: 66,
      pathSimplification: 0,
      noiseRemoval: 0,
      contourSensitivity: 84,
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
      hasTypography: false,
      typographyRegions: [],
      isMonochromeCandidate: false,
      detectedCategory: 'complex_illustration',
      categoryLabel: CATEGORY_LABELS.complex_illustration,
      adaptiveStrategySummary: STRATEGY_SUMMARIES.complex_illustration,
      dominantHexColors: [],
      recommendedEngine: 'vtracer',
      recommendedParameters: fallbackParams,
    };
  }

  const stride = Math.max(1, Math.floor(totalPixels / 65536));
  const coarseBuckets = new Map<
    number,
    { count: number; rSum: number; gSum: number; bSum: number }
  >();
  const fineBuckets = new Map<number, number>();
  const lumHistogram = new Int32Array(256);

  let sampledPixels = 0;
  let transparentCount = 0;
  let opaqueSamples = 0;
  let opaqueLumSum = 0;
  let nearExtremeLuminanceCount = 0;
  let lowSaturationCount = 0;
  let highSaturationCount = 0;

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
    const chroma = maxCh - minCh;
    if (chroma <= 22) {
      lowSaturationCount++;
    } else if (chroma >= 45) {
      highSaturationCount++;
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

  const minSignificantCoarse = Math.max(1, Math.floor(opaqueSamples * 0.002));
  const significantBuckets = [...coarseBuckets.values()]
    .filter((entry) => entry.count >= minSignificantCoarse)
    .sort((a, b) => b.count - a.count);

  const minSignificantFine = Math.max(1, Math.floor(opaqueSamples * 0.0006));
  let fineColorBins = 0;
  for (const count of fineBuckets.values()) {
    if (count >= minSignificantFine) fineColorBins++;
  }

  const dominantHexColors = significantBuckets
    .slice(0, 8)
    .map((entry) =>
      rgbToHex(entry.rSum / entry.count, entry.gSum / entry.count, entry.bSum / entry.count)
    );

  const transparentPixelRatio = sampledPixels > 0 ? transparentCount / sampledPixels : 0;
  const meanOpaqueLuminance = opaqueSamples > 0 ? opaqueLumSum / opaqueSamples : 128;

  const p02 = computePercentileFromHist(lumHistogram, opaqueSamples, 0.02);
  const p98 = computePercentileFromHist(lumHistogram, opaqueSamples, 0.98);
  const compositeLumContrast = opaqueSamples > 0 ? (p98 - p02) / 255 : 0;
  const luminanceContrast =
    transparentPixelRatio >= 0.08 && transparentPixelRatio <= 0.96
      ? Math.max(compositeLumContrast, 0.85)
      : compositeLumContrast;

  const gridW = Math.min(width, 260);
  const gridH = Math.min(height, 260);
  const lumGrid = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    const srcY = Math.min(height - 1, Math.floor((gy * height) / gridH));
    for (let gx = 0; gx < gridW; gx++) {
      const srcX = Math.min(width - 1, Math.floor((gx * width) / gridW));
      const idx = (srcY * width + srcX) * 4;
      const alpha = data[idx + 3] / 255;
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

      if (gradMag >= 32) {
        sharpEdgePixels++;
      } else if (gradMag >= 4) {
        smoothGradPixels++;
      }

      const neighborMean = (left + right + up + down) * 0.25;
      const neighborSpread = Math.max(Math.abs(left - right), Math.abs(up - down));
      if (Math.abs(c - neighborMean) >= 20 && neighborSpread <= 10) {
        noiseOutlierPixels++;
      }

      const d1x = c - left;
      const d2x = right - c;
      const d1y = c - up;
      const d2y = down - c;
      if (
        (d1x * d2x < -130 && Math.abs(d1x) > 11 && Math.abs(d2x) > 11) ||
        (d1y * d2y < -130 && Math.abs(d1y) > 11 && Math.abs(d2y) > 11)
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
  const highSatRatio = opaqueSamples > 0 ? highSaturationCount / opaqueSamples : 0;
  const bimodalRatio = opaqueSamples > 0 ? nearExtremeLuminanceCount / opaqueSamples : 0;

  const complexityScore = Math.min(
    100,
    Math.round(
      Math.min(35, fineColorBins * 0.28) +
        Math.min(30, edgeDensity * 180) +
        Math.min(20, gradientRatio * 28) +
        Math.min(15, smallDetailDensity * 150)
    )
  );

  // Avalia espalhamento cromático estrito para garantir que Potrace NUNCA rode em imagens coloridas
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

  const colorClusters: Array<{ r: number; g: number; b: number; lum: number; count: number }> = [];
  for (const b of significantBuckets) {
    const r = b.rSum / b.count;
    const g = b.gSum / b.count;
    const bl = b.bSum / b.count;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const match = colorClusters.find((c) => Math.hypot(c.r - r, c.g - g, c.b - bl) <= 44);
    if (match) {
      match.count += b.count;
    } else {
      colorClusters.push({ r, g, b: bl, lum, count: b.count });
    }
  }

  const isSingleColorOnAlpha =
    transparentPixelRatio >= 0.08 &&
    transparentPixelRatio <= 0.98 &&
    maxOpaqueColorSpread <= 36 &&
    fineColorBins <= 8 &&
    gradientRatio < 0.34;

  const hasWhitePaperAndSingleDarkInk =
    transparentPixelRatio < 0.08 &&
    colorClusters.length === 2 &&
    highSatRatio < 0.05 &&
    Math.max(colorClusters[0].lum, colorClusters[1].lum) >= 238 &&
    Math.min(colorClusters[0].lum, colorClusters[1].lum) <= 80;

  const isClassicBimodalMono =
    opaqueSamples > 0 &&
    highSatRatio < 0.04 &&
    (hasWhitePaperAndSingleDarkInk ||
      (colorClusters.length <= 2 &&
        lowSatRatio >= 0.92 &&
        bimodalRatio >= 0.72 &&
        transparentPixelRatio < 0.08)) &&
    luminanceContrast >= 0.38 &&
    gradientRatio < 0.38;

  const isMonochromeCandidate = isSingleColorOnAlpha || isClassicBimodalMono;

  // Reconhecimento estrutural de regiões tipográficas
  const typographyRegions = detectTypographyRegions(image);
  const hasTypography = typographyRegions.length > 0;
  const typographyAreaRatio =
    typographyRegions.reduce((acc, r) => acc + r.width * r.height, 0) / Math.max(1, totalPixels);

  // Detecta assinatura metálica / iluminação especular intensa (altíssimo contraste + cristas claras + degradês)
  const specularPeakPixels = lumHistogram.slice(242).reduce((a, b) => a + b, 0);
  const deepShadowPixels = lumHistogram.slice(0, 45).reduce((a, b) => a + b, 0);
  const hasMetallicOrLighting =
    opaqueSamples > 0 &&
    gradientRatio >= 0.25 &&
    specularPeakPixels >= opaqueSamples * 0.015 &&
    deepShadowPixels >= opaqueSamples * 0.04 &&
    lowSatRatio >= 0.35;

  // Classificação adaptativa entre as 9 classes estratégicas universais
  let detectedCategory: DetectedImageCategory;
  if (hasTypography && typographyAreaRatio >= 0.32 && fineColorBins <= 35) {
    detectedCategory = 'typography_text';
  } else if (isMonochromeCandidate) {
    detectedCategory = 'monochrome_drawing';
  } else if (
    fineColorBins >= 85 &&
    gradientRatio >= 0.54 &&
    transparentPixelRatio < 0.05
  ) {
    detectedCategory = 'photograph';
  } else if (hasMetallicOrLighting && fineColorBins >= 12) {
    detectedCategory = 'metallic_lighting';
  } else if (
    width <= 300 &&
    height <= 300 &&
    colorClusters.length <= 6 &&
    fineColorBins <= 18 &&
    gradientRatio < 0.3
  ) {
    detectedCategory = 'icon_graphic';
  } else if (
    (gradientRatio >= 0.26 && fineColorBins >= 14 && (transparentPixelRatio >= 0.04 || colorClusters.length <= 12)) ||
    (fineColorBins >= 16 && fineColorBins <= 90 && gradientRatio >= 0.32)
  ) {
    detectedCategory = 'gradient_logo';
  } else if (colorClusters.length <= 8 && fineColorBins <= 22 && gradientRatio < 0.34) {
    detectedCategory = 'solid_logo';
  } else if (transparentPixelRatio >= 0.05 && colorClusters.length >= 5 && fineColorBins <= 84) {
    detectedCategory = 'character_illustration';
  } else {
    detectedCategory = 'complex_illustration';
  }

  const recommendedEngine: 'vtracer' | 'potrace' = isMonochromeCandidate ? 'potrace' : 'vtracer';
  const recommendedParameters = buildRecommendedParameters(detectedCategory, {
    noiseLevel,
    smallDetailDensity,
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
    hasTypography,
    typographyRegions,
    hasMetallicOrLighting,
    isMonochromeCandidate,
    detectedCategory,
    categoryLabel: CATEGORY_LABELS[detectedCategory],
    adaptiveStrategySummary: STRATEGY_SUMMARIES[detectedCategory],
    dominantHexColors,
    recommendedEngine,
    recommendedParameters,
  };
}
