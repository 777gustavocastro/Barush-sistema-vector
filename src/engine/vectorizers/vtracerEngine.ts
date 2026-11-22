import type { Options as VTracerOptions } from '@visioncortex/vtracer';
import type {
  DetectedImageCategory,
  RawRgbaImage,
  VectorizationParameters,
} from '../types';
import { getVTracerBinding } from './vtracerRuntime';

/**
 * Constrói os parâmetros nativos do VTracer priorizando FIDELIDADE VISUAL MÁXIMA:
 * 1) Preservação integral de cores 24-bit (omite maxColors quando >= 128 para evitar pré-quantização/posterização);
 * 2) Empilhamento hierárquico ('stacked') livre de fendas e sem fragmentar formas em anéis recortados;
 * 3) Curvas spline Bézier com spliceThreshold equilibrado (preserva pontos de inflexão de asas, corpos e letras);
 * 4) filterSpeckle=1 e simplify desligado por padrão para jamais apagar pequenos detalhes ou deformar pontas.
 */
export function buildVTracerOptions(
  params: VectorizationParameters,
  detectedCategory?: DetectedImageCategory
): VTracerOptions {
  // Não pré-quantiza cores em artes ricas quando colorCount >= 128 (paleta completa 24-bit!)
  const shouldCapColors = params.colorCount < 128;
  const maxColors = shouldCapColors
    ? Math.max(2, Math.min(127, Math.round(params.colorCount)))
    : undefined;

  // Máxima precisão cromática por canal (8 bits = 256 níveis por canal R, G, B)
  const colorPrecision =
    params.detailPrecision >= 70
      ? 8
      : Math.max(5, Math.min(8, Math.round(4 + (params.detailPrecision / 100) * 4)));

  // Diferença entre camadas adaptativa: valores baixos (3..6) preservam degradês, sombras e nuances sutis
  let baseLayerDiff: number;
  if (detectedCategory === 'typography_text') {
    baseLayerDiff = Math.max(3, Math.round(22 - (params.detailPrecision / 100) * 19));
  } else if (
    detectedCategory === 'gradient_logo' ||
    params.profile === 'high_fidelity'
  ) {
    baseLayerDiff = Math.max(3, Math.round(24 - (params.detailPrecision / 100) * 20));
  } else if (detectedCategory === 'solid_logo') {
    // Em logos de cores chapadas, layerDifference moderado (6..10) evita anéis de anti-aliasing sem perder cores reais
    baseLayerDiff = Math.max(5, Math.round(28 - (params.detailPrecision / 100) * 21));
  } else {
    baseLayerDiff = Math.max(4, Math.round(28 - (params.detailPrecision / 100) * 23));
  }

  // Preserva detalhes pequenos, acentos e extremidades finas (filterSpeckle = 1 quando noiseRemoval <= 15)
  const filterSpeckle =
    params.noiseRemoval <= 15
      ? 1
      : Math.max(1, Math.round(1 + ((params.noiseRemoval - 15) / 85) * 14));

  // Sensibilidade de contornos calibrada (38°..95°) para manter pontas vivas de asas e cantos de letras sem facetar curvas
  const cornerThreshold = Math.max(
    34,
    Math.min(96, Math.round(96 - (params.contourSensitivity / 100) * 56))
  );

  // spliceThreshold controlado (28°..54°) para preservar curvas em 'S' orgânicas sem deformar inflexões
  const spliceThreshold = Math.max(
    26,
    Math.min(56, Math.round(26 + (params.curveSmoothness / 100) * 28))
  );

  const lengthThreshold = Number(
    (3.5 + ((100 - params.detailPrecision) / 100) * 2.8).toFixed(2)
  );
  const maxIterations = Math.max(10, Math.round(10 + (params.curveSmoothness / 100) * 10));

  // Simplificação desligada por padrão (<= 15) para não deformar letras, pontas nem curvas delicadas
  const simplify =
    params.pathSimplification > 15
      ? Number((((params.pathSimplification - 15) / 85) * 1.65).toFixed(2))
      : undefined;

  const pathPrecision = params.detailPrecision >= 75 ? 4 : 3;

  const useWatershed =
    detectedCategory === 'gradient_logo' || detectedCategory === 'complex_illustration';
  const watershedDetail = Math.max(
    160,
    Math.min(250, Math.round(150 + (params.detailPrecision / 100) * 100))
  );

  return {
    clustering: params.profile === 'monochrome_logo' ? 'bw' : useWatershed ? 'watershed' : 'color-cluster',
    ...(useWatershed ? { watershedDetail } : {}),
    hierarchical: 'stacked',
    mode: params.curveSmoothness <= 8 ? 'polygon' : 'spline',
    colorPrecision,
    layerDifference: baseLayerDiff,
    filterSpeckle,
    cornerThreshold,
    lengthThreshold,
    spliceThreshold,
    maxIterations,
    pathPrecision,
    ...(maxColors !== undefined ? { maxColors } : {}),
    ...(simplify !== undefined ? { simplify } : {}),
  };
}

/**
 * Executa vetorização real via VTracer (WebAssembly local) a partir de buffer RGBA8.
 */
export async function vectorizeWithVTracer(
  image: RawRgbaImage,
  params: VectorizationParameters,
  detectedCategory?: DetectedImageCategory
): Promise<string> {
  const vtracer = await getVTracerBinding();
  const options = buildVTracerOptions(params, detectedCategory);
  return vtracer.convertPixels(image.data, image.width, image.height, options);
}
