import type { Options as VTracerOptions } from '@visioncortex/vtracer';
import type {
  DetectedImageCategory,
  RawRgbaImage,
  VectorizationParameters,
} from '../types';
import { getVTracerBinding } from './vtracerRuntime';

export type VTracerCandidatePreset = 'balanced_spline' | 'fine_gradient_step' | 'watershed_regions';

/**
 * Constrói parâmetros calibrados do VTracer testando combinações de:
 * colorPrecision, filterSpeckle, layerDifference (gradient step), mode ('spline'),
 * pathPrecision, simplify e hierarchical ('stacked'), sem jamais eliminar pequenas regiões
 * nem reduzir cores de forma agressiva.
 */
export function buildVTracerOptions(
  params: VectorizationParameters,
  detectedCategory?: DetectedImageCategory,
  variant: VTracerCandidatePreset = 'balanced_spline'
): VTracerOptions {
  const shouldCapColors = params.colorCount < 128;
  const maxColors = shouldCapColors
    ? Math.max(2, Math.min(127, Math.round(params.colorCount)))
    : undefined;

  const colorPrecision =
    params.colorCount < 32
      ? Math.max(2, Math.min(7, Math.round(1.5 + (params.colorCount / 32) * 5.5)))
      : params.detailPrecision >= 65
        ? 8
        : Math.max(6, Math.min(8, Math.round(5 + (params.detailPrecision / 100) * 3)));

  const manualLowColorStep =
    params.colorCount < 32
      ? Math.round(((32 - Math.max(2, params.colorCount)) / 30) * 38)
      : 0;

  let baseLayerDiff: number;
  if (variant === 'fine_gradient_step') {
    baseLayerDiff = 3 + manualLowColorStep;
  } else if (detectedCategory === 'typography_text') {
    baseLayerDiff = Math.max(3, Math.round(20 - (params.detailPrecision / 100) * 17)) + manualLowColorStep;
  } else if (
    detectedCategory === 'gradient_logo' ||
    params.profile === 'high_fidelity'
  ) {
    baseLayerDiff = Math.max(3, Math.round(22 - (params.detailPrecision / 100) * 18)) + manualLowColorStep;
  } else if (detectedCategory === 'solid_logo') {
    baseLayerDiff = Math.max(5, Math.round(26 - (params.detailPrecision / 100) * 19)) + manualLowColorStep;
  } else {
    baseLayerDiff = Math.max(4, Math.round(26 - (params.detailPrecision / 100) * 21)) + manualLowColorStep;
  }

  const filterSpeckle =
    params.noiseRemoval <= 15
      ? 1
      : Math.max(1, Math.round(1 + ((params.noiseRemoval - 15) / 85) * 12));

  const cornerThreshold = Math.max(
    32,
    Math.min(95, Math.round(95 - (params.contourSensitivity / 100) * 56))
  );

  const spliceThreshold = Math.max(
    26,
    Math.min(54, Math.round(26 + (params.curveSmoothness / 100) * 26))
  );

  const lengthThreshold = Number(
    (
      3.2 +
      ((100 - params.detailPrecision) / 100) * 2.5 +
      (Math.max(0, params.pathSimplification - 10) / 90) * 3.8
    ).toFixed(2)
  );
  const maxIterations = Math.max(12, Math.round(12 + (params.curveSmoothness / 100) * 10));

  const simplify =
    params.pathSimplification > 15
      ? Number((((params.pathSimplification - 15) / 85) * 2.5).toFixed(2))
      : undefined;

  const pathPrecision =
    params.pathSimplification >= 75 ? 2 : params.detailPrecision >= 70 ? 4 : 3;

  const useWatershed = variant === 'watershed_regions';
  const watershedDetail = Math.max(
    185,
    Math.min(250, Math.round(175 + (params.detailPrecision / 100) * 75))
  );

  return {
    clustering:
      params.profile === 'monochrome_logo'
        ? 'bw'
        : useWatershed
          ? 'watershed'
          : 'color-cluster',
    ...(useWatershed ? { watershedDetail } : {}),
    hierarchical: 'stacked',
    mode: params.curveSmoothness <= 6 ? 'polygon' : 'spline',
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
  detectedCategory?: DetectedImageCategory,
  variant: VTracerCandidatePreset = 'balanced_spline'
): Promise<string> {
  const vtracer = await getVTracerBinding();
  const options = buildVTracerOptions(params, detectedCategory, variant);
  return vtracer.convertPixels(image.data, image.width, image.height, options);
}
