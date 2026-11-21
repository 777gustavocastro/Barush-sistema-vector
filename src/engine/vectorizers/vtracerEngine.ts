import type { Options as VTracerOptions } from '@visioncortex/vtracer';
import type { RawRgbaImage, VectorizationParameters } from '../types';
import { getVTracerBinding } from './vtracerRuntime';

/**
 * Mapeia os parâmetros padronizados do sistema para as opções nativas do motor VTracer,
 * garantindo que todos os 6 controles avançados influenciem efetivamente a saída vetorial
 * sem remover detalhes importantes sem autorização explícita.
 */
export function buildVTracerOptions(params: VectorizationParameters): VTracerOptions {
  const isHighFidelity = params.profile === 'high_fidelity';
  const isLogo = params.profile === 'logo_illustration' || params.profile === 'monochrome_logo';

  const maxColors = Math.max(2, Math.min(64, Math.round(params.colorCount)));
  const colorPrecision = isHighFidelity
    ? 8
    : Math.max(4, Math.min(8, Math.round(4 + (params.detailPrecision / 100) * 4)));

  // Diferença mínima entre camadas (menor valor = preserva sutilezas e detalhes finos)
  const layerDifference = isHighFidelity
    ? Math.max(3, Math.round(24 - (params.detailPrecision / 100) * 19))
    : Math.max(5, Math.round(44 - (params.detailPrecision / 100) * 34));

  // Filtro de manchas/ruído (mantém 1px quando noiseRemoval é baixo para preservar microdetalhes)
  const filterSpeckle =
    params.noiseRemoval <= 12
      ? 1
      : Math.max(1, Math.round(1 + (params.noiseRemoval / 100) * 18));

  // Sensibilidade dos contornos -> cornerThreshold (maior sensibilidade = menor ângulo = cantos vivos preservados)
  const cornerThreshold = Math.max(
    20,
    Math.min(115, Math.round(115 - (params.contourSensitivity / 100) * 80))
  );

  // Suavidade das curvas -> spliceThreshold, lengthThreshold e iterações
  const spliceThreshold = Math.max(
    12,
    Math.min(92, Math.round(15 + (params.curveSmoothness / 100) * 70))
  );
  const lengthThreshold = Number((3.5 + ((100 - params.detailPrecision) / 100) * 4.5).toFixed(2));
  const maxIterations = Math.max(6, Math.round(8 + (params.curveSmoothness / 100) * 8));

  // Simplificação dos caminhos: desligada por padrão quando <= 10 para não eliminar detalhes
  const simplify =
    params.pathSimplification > 10
      ? Number(((params.pathSimplification / 100) * 2.5).toFixed(2))
      : undefined;

  const pathPrecision = params.detailPrecision >= 75 ? 3 : 2;

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
    maxIterations,
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
