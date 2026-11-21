import type { Options as VTracerOptions } from '@visioncortex/vtracer';
import type { RawRgbaImage, VectorizationParameters } from '../types';
import { getVTracerBinding } from './vtracerRuntime';

/**
 * Mapeia os parâmetros padronizados do sistema para as opções nativas do motor VTracer.
 */
export function buildVTracerOptions(params: VectorizationParameters): VTracerOptions {
  const isHighFidelity = params.profile === 'high_fidelity';
  const isLogo = params.profile === 'logo_illustration' || params.profile === 'monochrome_logo';

  // Precisão cromática (1..8 bits) e limite máximo de cores
  const maxColors = Math.max(2, Math.min(64, Math.round(params.colorCount)));
  const colorPrecision = isHighFidelity
    ? 8
    : Math.max(3, Math.min(8, Math.round(3 + (params.detailPrecision / 100) * 5)));

  // Diferença mínima entre camadas (menor valor = maior fidelidade aos gradientes)
  const layerDifference = isHighFidelity
    ? Math.max(4, Math.round(28 - (params.detailPrecision / 100) * 22))
    : Math.max(8, Math.round(48 - (params.detailPrecision / 100) * 34));

  // Filtro de manchas/ruído (filterSpeckle em pixels)
  const filterSpeckle = Math.max(1, Math.round(1 + (params.noiseRemoval / 100) * 18));

  // Limiar de cantos (cornerThreshold em graus: maior = cantos mais suaves)
  const cornerThreshold = Math.max(
    25,
    Math.min(115, Math.round(115 - (params.contourSensitivity / 100) * 75))
  );

  // Suavidade e emenda de curvas Bézier (spliceThreshold e lengthThreshold)
  const spliceThreshold = Math.max(15, Math.min(90, Math.round(20 + (params.curveSmoothness / 100) * 60)));
  const lengthThreshold = Number((3.5 + ((100 - params.detailPrecision) / 100) * 4.5).toFixed(2));

  // Simplificação geométrica opcional (0 = desligada; até 2.4 px)
  const simplify =
    params.pathSimplification > 15
      ? Number(((params.pathSimplification / 100) * 2.2).toFixed(2))
      : undefined;

  // Casas decimais nas coordenadas do SVG
  const pathPrecision = params.detailPrecision >= 80 ? 3 : 2;

  return {
    clustering: params.profile === 'monochrome_logo' ? 'bw' : 'color-cluster',
    hierarchical: isLogo ? 'cutout' : 'stacked',
    mode: params.curveSmoothness <= 10 ? 'polygon' : 'spline',
    maxColors,
    colorPrecision,
    layerDifference,
    filterSpeckle,
    cornerThreshold,
    lengthThreshold,
    spliceThreshold,
    maxIterations: isHighFidelity ? 14 : 10,
    pathPrecision,
    ...(simplify !== undefined ? { simplify } : {}),
  };
}

/**
 * Executa vetorização real via VTracer (WebAssembly local) a partir de buffer RGBA8.
 */
export async function vectorizeWithVTracer(
  image: RawRgbaImage,
  params: VectorizationParameters
): Promise<string> {
  const vtracer = await getVTracerBinding();
  const options = buildVTracerOptions(params);
  return vtracer.convertPixels(image.data, image.width, image.height, options);
}
