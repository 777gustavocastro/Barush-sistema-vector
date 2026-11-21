import type {
  RawRgbaImage,
  VectorEngineKind,
  VectorizationParameters,
  VectorizationPipelineResult,
} from '../types';
import { decodeImageBytesToRgba } from '../image-processing/imageCodec';
import { analyzeImageColors } from '../image-processing/colorAnalysis';
import { quantizeColorLevels, reduceImageNoise } from '../image-processing/filters';
import { vectorizeWithVTracer } from './vtracerEngine';
import { vectorizeWithPotrace } from './potraceEngine';
import { optimizeVectorSvg } from '../optimization/svgoOptimizer';
import { validateSvgStructure } from '../validation/fileValidator';

function selectTargetEngine(
  params: VectorizationParameters,
  isMonochromeCandidate: boolean
): VectorEngineKind {
  if (params.engine === 'vtracer' || params.engine === 'potrace') {
    return params.engine;
  }
  if (params.profile === 'monochrome_logo') {
    return 'potrace';
  }
  if (params.profile === 'auto' && isMonochromeCandidate && params.colorCount <= 4) {
    return 'potrace';
  }
  if (params.profile === 'logo_illustration' && isMonochromeCandidate && params.colorCount <= 2) {
    return 'potrace';
  }
  return 'vtracer';
}

/**
 * Executa o pipeline completo e desacoplado de vetorização local sobre uma imagem RGBA8:
 * 1. Análise cromática e recomendação de motor
 * 2. Redução de ruídos e segmentação opcional de cores
 * 3. Vetorização via VTracer (principal) ou Potrace (monocromático/alto contraste)
 * 4. Otimização fiel com SVGO
 * 5. Validação estrutural do SVG final
 */
export async function runVectorizationOnRgba(
  sourceImage: RawRgbaImage,
  params: VectorizationParameters
): Promise<VectorizationPipelineResult> {
  const startedAt = performance.now();

  const colorAnalysis = analyzeImageColors(sourceImage);
  const engineUsed = selectTargetEngine(params, colorAnalysis.isMonochromeCandidate);

  // Pré-processamento local: redução de ruídos e segmentação cromática quando aplicável
  let processed = reduceImageNoise(sourceImage, params.noiseRemoval);
  if (engineUsed === 'vtracer' && params.profile === 'logo_illustration' && params.colorCount <= 16) {
    processed = quantizeColorLevels(processed, params.colorCount);
  }

  const rawSvgBeforeOptimization =
    engineUsed === 'potrace'
      ? await vectorizeWithPotrace(processed, params)
      : await vectorizeWithVTracer(processed, params);

  const shouldOptimize = params.optimizeSvg !== false;
  const optimization = shouldOptimize
    ? optimizeVectorSvg(rawSvgBeforeOptimization, {
        floatPrecision: params.detailPrecision >= 80 ? 3 : 2,
      })
    : null;

  const finalSvg = optimization ? optimization.svg : rawSvgBeforeOptimization;
  const validation = validateSvgStructure(finalSvg);

  return {
    svg: finalSvg,
    rawSvgBeforeOptimization,
    engineUsed,
    colorAnalysis,
    optimization,
    validation,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

/**
 * Executa o pipeline completo a partir dos bytes brutos do arquivo (PNG, JPG, JPEG ou WebP).
 */
export async function runVectorizationFromBytes(
  fileBytes: Uint8Array,
  params: VectorizationParameters,
  fileNameHint?: string
): Promise<VectorizationPipelineResult> {
  const rgbaImage = await decodeImageBytesToRgba(fileBytes, fileNameHint);
  return runVectorizationOnRgba(rgbaImage, params);
}
