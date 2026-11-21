import type {
  ProgressCallback,
  RawRgbaImage,
  TunedSliderValues,
  VectorEngineKind,
  VectorizationParameters,
  VectorizationPipelineResult,
} from '../types';
import { decodeImageBytesToRgba } from '../image-processing/imageCodec';
import { analyzeImageColors } from '../image-processing/colorAnalysis';
import {
  cleanAlphaFringes,
  DEFAULT_MAX_WORKING_DIMENSION,
  downscaleRgbaIfNeeded,
  reduceImageNoise,
} from '../image-processing/filters';
import { vectorizeWithVTracer } from './vtracerEngine';
import { vectorizeWithPotrace } from './potraceEngine';
import {
  normalizeSvgForEditorsAndScaling,
  optimizeVectorSvg,
} from '../optimization/svgoOptimizer';
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
  if (params.profile === 'auto' && isMonochromeCandidate && params.colorCount <= 3) {
    return 'potrace';
  }
  if (params.profile === 'logo_illustration' && isMonochromeCandidate && params.colorCount <= 2) {
    return 'potrace';
  }
  return 'vtracer';
}

/**
 * Executa o pipeline completo e local de vetorização sobre uma imagem RGBA8:
 * 1. Inteligência de análise (8 critérios) e seleção do motor
 * 2. Limpeza de alfa, redimensionamento seguro para imagens grandes e redução de ruído
 * 3. Vetorização real via VTracer (principal) ou Potrace (monocromático/alto contraste)
 * 4. Normalização para Inkscape/Illustrator + Otimização fiel com SVGO
 * 5. Validação estrutural completa do SVG
 */
export async function runVectorizationOnRgba(
  sourceImage: RawRgbaImage,
  params: VectorizationParameters,
  onProgress?: ProgressCallback
): Promise<VectorizationPipelineResult> {
  const startedAt = performance.now();
  const originalWidth = sourceImage.width;
  const originalHeight = sourceImage.height;

  onProgress?.({
    stageId: 'analyze',
    stageLabel: 'Analisando cores, contraste, contornos e complexidade...',
    percent: 12,
  });

  const colorAnalysis = analyzeImageColors(sourceImage);

  const effectiveSliders: TunedSliderValues =
    params.profile === 'auto' && params.autoTune
      ? { ...colorAnalysis.recommendedParameters }
      : {
          colorCount: params.colorCount,
          detailPrecision: params.detailPrecision,
          curveSmoothness: params.curveSmoothness,
          pathSimplification: params.pathSimplification,
          noiseRemoval: params.noiseRemoval,
          contourSensitivity: params.contourSensitivity,
        };

  const resolvedParams: VectorizationParameters = {
    ...params,
    ...effectiveSliders,
  };

  const engineUsed = selectTargetEngine(resolvedParams, colorAnalysis.isMonochromeCandidate);

  onProgress?.({
    stageId: 'preprocess',
    stageLabel: 'Tratando transparência, escala e filtragem de ruídos...',
    percent: 32,
  });

  const maxDim = params.maxWorkingDimension ?? DEFAULT_MAX_WORKING_DIMENSION;
  const alphaCleaned = cleanAlphaFringes(sourceImage);
  const { image: scaledImage, wasDownscaled } = downscaleRgbaIfNeeded(alphaCleaned, maxDim);
  const processed = reduceImageNoise(scaledImage, resolvedParams.noiseRemoval);

  onProgress?.({
    stageId: 'trace',
    stageLabel:
      engineUsed === 'potrace'
        ? 'Traçando curvas Bézier de alto contraste com Potrace...'
        : 'Gerando camadas e curvas vetoriais com VTracer...',
    percent: 58,
  });

  const rawEngineSvg =
    engineUsed === 'potrace'
      ? await vectorizeWithPotrace(processed, resolvedParams)
      : await vectorizeWithVTracer(processed, resolvedParams);

  const normalizedRawSvg = normalizeSvgForEditorsAndScaling(
    rawEngineSvg,
    originalWidth,
    originalHeight,
    processed.width,
    processed.height
  );

  onProgress?.({
    stageId: 'optimize',
    stageLabel: 'Otimizando estrutura vetorial com SVGO...',
    percent: 84,
  });

  const shouldOptimize = params.optimizeSvg !== false;
  const optimization = shouldOptimize
    ? optimizeVectorSvg(normalizedRawSvg, {
        floatPrecision: resolvedParams.detailPrecision >= 75 ? 3 : 2,
      })
    : null;

  const finalSvg = optimization ? optimization.svg : normalizedRawSvg;

  onProgress?.({
    stageId: 'validate',
    stageLabel: 'Validando integridade dos caminhos e compatibilidade SVG...',
    percent: 96,
  });

  const validation = validateSvgStructure(finalSvg);
  if (!validation.valid) {
    throw new Error(`Falha na validação do SVG gerado: ${validation.errors.join(' ')}`);
  }

  onProgress?.({
    stageId: 'validate',
    stageLabel: 'Vetorização concluída com sucesso.',
    percent: 100,
  });

  return {
    svg: finalSvg,
    rawSvgBeforeOptimization: normalizedRawSvg,
    engineUsed,
    effectiveParameters: effectiveSliders,
    colorAnalysis,
    optimization,
    validation,
    originalWidth,
    originalHeight,
    workingWidth: processed.width,
    workingHeight: processed.height,
    wasDownscaled,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

/**
 * Executa o pipeline completo a partir dos bytes brutos do arquivo (PNG, JPG, JPEG ou WebP).
 */
export async function runVectorizationFromBytes(
  fileBytes: Uint8Array,
  params: VectorizationParameters,
  fileNameHint?: string,
  onProgress?: ProgressCallback
): Promise<VectorizationPipelineResult> {
  const rgbaImage = await decodeImageBytesToRgba(fileBytes, fileNameHint);
  return runVectorizationOnRgba(rgbaImage, params, onProgress);
}
