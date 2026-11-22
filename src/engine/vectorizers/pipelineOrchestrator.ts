import type {
  DetectedImageCategory,
  ProgressCallback,
  RawRgbaImage,
  TunedSliderValues,
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
  upscaleRgbaCatmullRom,
} from '../image-processing/filters';
import { vectorizeWithVTracer } from './vtracerEngine';
import { vectorizeWithPotrace } from './potraceEngine';
import {
  normalizeSvgForEditorsAndScaling,
  optimizeVectorSvg,
} from '../optimization/svgoOptimizer';
import { validateSvgStructure } from '../validation/fileValidator';
import { reconstructNativeSvgGradients } from '../gradients/svgGradientReconstructor';
import { reconstructHighPrecisionTypographySvg } from '../typography/typographyProcessor';
import {
  organizeVTracerPathsIntoObjects,
  reconstructImageAsEditableObjects,
} from '../reconstruction/objectVectorReconstructor';
import {
  evaluateAndSelectBestCandidate,
  type VectorSvgCandidateInput,
} from '../quality/qualityEvaluator';

function isStrictlyMonochromeRequest(
  params: VectorizationParameters,
  detectedCategory: DetectedImageCategory,
  isMonochromeCandidate: boolean
): boolean {
  if (params.engine === 'potrace' || params.profile === 'monochrome_logo') {
    return true;
  }
  return (
    params.engine !== 'vtracer' &&
    isMonochromeCandidate &&
    detectedCategory === 'monochrome_drawing' &&
    params.colorCount <= 3
  );
}

function chooseSubpixelUpscaleFactor(
  width: number,
  height: number,
  category: DetectedImageCategory,
  detailPrecision: number,
  enabled: boolean
): 1 | 2 | 3 {
  if (!enabled || detailPrecision < 65) return 1;
  const longest = Math.max(width, height);
  const pixels = width * height;

  if (category === 'typography_text') {
    if (longest <= 480) return 3;
    if (longest <= 1050) return 2;
    return 1;
  }

  if (
    category === 'gradient_logo' ||
    category === 'solid_logo' ||
    category === 'complex_illustration'
  ) {
    if (longest <= 360 && pixels <= 110_000) return 3;
    if (longest <= 920 && pixels <= 640_000) return 2;
  }

  return 1;
}

export interface InternalPipelineRunOutput {
  result: VectorizationPipelineResult;
  candidates: VectorSvgCandidateInput[];
}

/**
 * Pipeline de Reconstrução Vetorial Avançada (100% Editável, ZERO Raster):
 * - Etapa A: Análise perceptual OpenCV + diagnóstico de paleta 24-bit, bordas, gradientes, transparências e texto.
 * - Etapa B & C: Separação de objetos (<g id="objeto-N">) e reconstrução geométrica em curvas Bézier cúbicas.
 * - Seção 3 & 6: Reconstrução nativa de <linearGradient>, <radialGradient>, multi-stops, stop-opacity e <clipPath>.
 * - Seção 4: Geração e comparação de candidatos complementares com VTracer ajustado por categoria.
 * - Seção 5: Tipografia 100% vetorial letra por letra (<path id="letra-...">).
 * - Seção 10 & 11: Seleção perceptual multi-candidato (SSIM + CIE ΔE + Contornos + Gradientes) e auditoria anti-raster.
 */
export async function runVectorizationOnRgbaInternal(
  sourceImage: RawRgbaImage,
  params: VectorizationParameters,
  onProgress?: ProgressCallback
): Promise<InternalPipelineRunOutput> {
  const startedAt = performance.now();
  const originalWidth = sourceImage.width;
  const originalHeight = sourceImage.height;

  onProgress?.({
    stageId: 'analyze',
    stageLabel: 'Etapa A: Analisando regiões, bordas, degradês e tipografia com OpenCV...',
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

  const maxDim = params.maxWorkingDimension ?? DEFAULT_MAX_WORKING_DIMENSION;
  const alphaCleaned = cleanAlphaFringes(sourceImage);
  const { image: baseWorkingImage, wasDownscaled } = downscaleRgbaIfNeeded(
    alphaCleaned,
    maxDim
  );
  const denoisedImage = reduceImageNoise(baseWorkingImage, resolvedParams.noiseRemoval);

  const candidates: VectorSvgCandidateInput[] = [];
  let upscaleFactor: 1 | 2 | 3 = 1;

  if (
    isStrictlyMonochromeRequest(
      resolvedParams,
      colorAnalysis.detectedCategory,
      colorAnalysis.isMonochromeCandidate
    )
  ) {
    onProgress?.({
      stageId: 'reconstruct_bezier',
      stageLabel: 'Reconstruindo curvas Bézier monocromáticas em coordenadas planas...',
      percent: 55,
    });

    const monoRaw = await vectorizeWithPotrace(denoisedImage, resolvedParams);
    const monoNorm = normalizeSvgForEditorsAndScaling(
      monoRaw,
      originalWidth,
      originalHeight,
      denoisedImage.width,
      denoisedImage.height
    );
    candidates.push({
      candidateId: 'potrace-bezier-puro',
      label: 'Curvas Bézier Monocromáticas Sub-Pixel',
      engineKind: 'potrace_bezier',
      svg: monoNorm,
    });
  } else {
    onProgress?.({
      stageId: 'segment_objects',
      stageLabel: 'Etapa B: Separando objetos independentes e regiões cromáticas (OpenCV)...',
      percent: 30,
    });

    // Reconstrução tipográfica letra por letra em coordenadas da imagem de trabalho (1:1)
    let typoBaseDefs = '';
    let typoBaseGroups = '';
    if (
      params.enhanceTypography !== false &&
      colorAnalysis.typographyRegions.length > 0 &&
      resolvedParams.detailPrecision >= 65
    ) {
      const scaleOrigToBase = baseWorkingImage.width / originalWidth;
      const typoRes = await reconstructHighPrecisionTypographySvg(
        alphaCleaned,
        colorAnalysis.typographyRegions,
        scaleOrigToBase,
        200
      );
      typoBaseDefs = typoRes.defsXml;
      typoBaseGroups = typoRes.groupsXml;
    }

    // CANDIDATO 1: Reconstrução Orientada a Objetos OpenCV + Curvas Bézier Cúbicas + Gradientes SVG Nativos Multi-Stop
    const totalWorkPixels = denoisedImage.width * denoisedImage.height;
    if (totalWorkPixels <= 950_000) {
      onProgress?.({
        stageId: 'reconstruct_bezier',
        stageLabel: 'Etapa C: Reconstruindo objetos editáveis, curvas Bézier e gradientes SVG nativos...',
        percent: 50,
      });

      const objRec = await reconstructImageAsEditableObjects(
        denoisedImage,
        resolvedParams,
        colorAnalysis.detectedCategory,
        typoBaseDefs,
        typoBaseGroups,
        colorAnalysis.typographyRegions
      );

      const cand1Svg = normalizeSvgForEditorsAndScaling(
        objRec.svg,
        originalWidth,
        originalHeight,
        denoisedImage.width,
        denoisedImage.height
      );

      candidates.push({
        candidateId: 'opencv-objetos-gradientes',
        label: 'OpenCV Objetos + Bézier + Gradientes SVG Nativos',
        engineKind: 'opencv_bezier_gradients',
        svg: cand1Svg,
      });
    }

    // CANDIDATO 2 & 3: VTracer Multi-Configuração Aperfeiçoado + Organização em Objetos + Gradientes Nativos + Tipografia 3×
    onProgress?.({
      stageId: 'gradients_typography',
      stageLabel: 'Gerando candidatos complementares VTracer Spline + Gradientes Nativos...',
      percent: 68,
    });

    upscaleFactor = chooseSubpixelUpscaleFactor(
      denoisedImage.width,
      denoisedImage.height,
      colorAnalysis.detectedCategory,
      resolvedParams.detailPrecision,
      params.subpixelUpscale !== false
    );

    const traceInputImage =
      upscaleFactor === 2 || upscaleFactor === 3
        ? upscaleRgbaCatmullRom(denoisedImage, upscaleFactor)
        : denoisedImage;

    const viewBoxWidth = traceInputImage.width;
    const viewBoxHeight = traceInputImage.height;
    const coordScaleFromBase = viewBoxWidth / baseWorkingImage.width;

    let gradDefsXml = '';
    let gradLayersXml = '';
    if (
      params.reconstructGradients !== false &&
      resolvedParams.colorCount >= 16 &&
      (colorAnalysis.detectedCategory === 'gradient_logo' ||
        colorAnalysis.detectedCategory === 'complex_illustration' ||
        colorAnalysis.gradientRatio >= 0.18)
    ) {
      const gradRes = await reconstructNativeSvgGradients(
        denoisedImage,
        coordScaleFromBase
      );
      gradDefsXml = gradRes.defsXml;
      gradLayersXml = gradRes.layersXml;
    }

    let typoScaledDefs = '';
    let typoScaledGroups = '';
    if (
      params.enhanceTypography !== false &&
      colorAnalysis.typographyRegions.length > 0 &&
      resolvedParams.detailPrecision >= 65
    ) {
      const scaleOrigToViewBox = viewBoxWidth / originalWidth;
      const typoScaled = await reconstructHighPrecisionTypographySvg(
        alphaCleaned,
        colorAnalysis.typographyRegions,
        scaleOrigToViewBox,
        200
      );
      typoScaledDefs = typoScaled.defsXml;
      typoScaledGroups = typoScaled.groupsXml;
    }

    // Variante VTracer A: Spline equilibrado com agrupamento em objetos + gradientes nativos
    const rawVtSpline = await vectorizeWithVTracer(
      traceInputImage,
      resolvedParams,
      colorAnalysis.detectedCategory,
      'balanced_spline'
    );
    const groupedVtSpline = organizeVTracerPathsIntoObjects(
      rawVtSpline,
      viewBoxWidth,
      viewBoxHeight
    );
    const cand2Svg = normalizeSvgForEditorsAndScaling(
      groupedVtSpline,
      originalWidth,
      originalHeight,
      viewBoxWidth,
      viewBoxHeight,
      `${gradDefsXml}${typoScaledDefs}`,
      `${gradLayersXml}${typoScaledGroups}`
    );

    candidates.push({
      candidateId: 'vtracer-spline-gradientes',
      label: 'VTracer Spline + Objetos + Gradientes Nativos',
      engineKind: 'vtracer_rek_gradients',
      svg: cand2Svg,
    });

    // Variante VTracer B: Passo fino de gradiente / Watershed para artes complexas e degradês ricos
    if (
      colorAnalysis.detectedCategory === 'gradient_logo' ||
      colorAnalysis.detectedCategory === 'complex_illustration' ||
      colorAnalysis.detectedCategory === 'photograph'
    ) {
      const secondVariant =
        colorAnalysis.detectedCategory === 'gradient_logo'
          ? 'fine_gradient_step'
          : 'watershed_regions';
      const rawVtFine = await vectorizeWithVTracer(
        traceInputImage,
        resolvedParams,
        colorAnalysis.detectedCategory,
        secondVariant
      );
      const groupedVtFine = organizeVTracerPathsIntoObjects(
        rawVtFine,
        viewBoxWidth,
        viewBoxHeight
      );
      const cand3Svg = normalizeSvgForEditorsAndScaling(
        groupedVtFine,
        originalWidth,
        originalHeight,
        viewBoxWidth,
        viewBoxHeight,
        `${gradDefsXml}${typoScaledDefs}`,
        `${gradLayersXml}${typoScaledGroups}`
      );

      candidates.push({
        candidateId: 'vtracer-detalhe-multicamada',
        label: 'Reconstrução Multi-Camada Detalhada + Gradientes Nativos',
        engineKind: 'vtracer_rek_gradients',
        svg: cand3Svg,
      });
    }
  }

  onProgress?.({
    stageId: 'evaluate_candidates',
    stageLabel: 'Avaliando candidatos por SSIM, ΔE perceptual, contornos e gradientes...',
    percent: 84,
  });

  const { winner, winnerQuality } = await evaluateAndSelectBestCandidate(
    sourceImage,
    candidates,
    colorAnalysis.hasTransparency,
    colorAnalysis.gradientRatio
  );

  const shouldOptimize = params.optimizeSvg !== false;
  const targetFloatPrecision =
    resolvedParams.pathSimplification >= 65
      ? 2
      : resolvedParams.detailPrecision >= 75 && resolvedParams.pathSimplification <= 30
        ? 4
        : 3;
  const optimization = shouldOptimize
    ? optimizeVectorSvg(winner.svg, {
        floatPrecision: targetFloatPrecision,
      })
    : null;

  const finalSvg = optimization ? optimization.svg : winner.svg;

  onProgress?.({
    stageId: 'validate',
    stageLabel: 'Validando XML 100% vetorial (zero raster, caminhos e gradientes editáveis)...',
    percent: 96,
  });

  const validation = validateSvgStructure(finalSvg);
  if (!validation.valid || validation.hasEmbeddedRaster) {
    throw new Error(`Falha na validação vetorial estrita: ${validation.errors.join(' ')}`);
  }

  const technicalLimitationsNote =
    colorAnalysis.detectedCategory === 'photograph'
      ? 'Fotografia contínua reconstruída por aproximação vetorial em camadas editáveis (sem incorporar pixels raster). Microtexturas fotográficas de sensor são representadas por regiões geométricas e gradientes aproximados.'
      : undefined;

  onProgress?.({
    stageId: 'validate',
    stageLabel: 'Reconstrução vetorial 100% editável concluída.',
    percent: 100,
  });

  const result: VectorizationPipelineResult = {
    svg: finalSvg,
    rawSvgBeforeOptimization: winner.svg,
    engineUsed: winner.engineKind,
    selectedCandidateLabel: winner.label,
    adaptiveStrategyLabel: colorAnalysis.categoryLabel,
    technicalLimitationsNote,
    effectiveParameters: effectiveSliders,
    colorAnalysis,
    optimization,
    validation,
    qualityReport: winnerQuality,
    reconstructedGradientCount: validation.gradientCount,
    reconstructedObjectCount: validation.objectCount,
    detectedTypographyCount: colorAnalysis.typographyRegions.length,
    upscaleFactorUsed: upscaleFactor,
    originalWidth,
    originalHeight,
    workingWidth: baseWorkingImage.width,
    workingHeight: baseWorkingImage.height,
    wasDownscaled,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };

  return { result, candidates };
}

export async function runVectorizationOnRgba(
  sourceImage: RawRgbaImage,
  params: VectorizationParameters,
  onProgress?: ProgressCallback
): Promise<VectorizationPipelineResult> {
  const { result } = await runVectorizationOnRgbaInternal(sourceImage, params, onProgress);
  return result;
}

export async function runVectorizationFromBytes(
  fileBytes: Uint8Array,
  params: VectorizationParameters,
  fileNameHint?: string,
  onProgress?: ProgressCallback
): Promise<VectorizationPipelineResult> {
  const rgbaImage = await decodeImageBytesToRgba(fileBytes, fileNameHint);
  return runVectorizationOnRgba(rgbaImage, params, onProgress);
}
