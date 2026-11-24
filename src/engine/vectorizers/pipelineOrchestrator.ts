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
import { inspectAndSanitizeSvgContours } from '../geometry/contourInspector';
import { validateSvgStructure } from '../validation/fileValidator';
import { buildUniversalVectorizationReport } from '../quality/universalQualityGate';
import {
  beginPipelineAudit,
  countStrongEdges,
  countThinRuns,
  finishPipelineAudit,
  noteResolution,
} from '../audit/pipelineAudit';
import { reconstructNativeSvgGradients } from '../gradients/svgGradientReconstructor';
import {
  buildExactTypographyInkMask,
  reconstructHighPrecisionTypographySvg,
} from '../typography/typographyProcessor';
import { inpaintTypographyInkMask } from '../opencv/opencvSegmenter';
import {
  organizeVTracerPathsIntoObjects,
  reconstructImageAsEditableObjects,
} from '../reconstruction/objectVectorReconstructor';
import {
  evaluateAndSelectBestCandidate,
  type VectorSvgCandidateInput,
} from '../quality/qualityEvaluator';
import {
  getRegisteredStage2Hooks,
  type Stage2InspectionReport,
  type VectorReconstructionSceneGraph,
} from '../stage2/reconstructionSceneGraph';

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
  beginPipelineAudit();
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
      ? {
          ...colorAnalysis.recommendedParameters,
          noiseRemoval: Math.max(
            colorAnalysis.recommendedParameters.noiseRemoval,
            params.noiseRemoval ?? 0
          ),
        }
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
  noteResolution({
    originalWidth,
    originalHeight,
    workingWidth: denoisedImage.width,
    workingHeight: denoisedImage.height,
    wasDownscaled,
    strongEdgesBefore: countStrongEdges(alphaCleaned.data, alphaCleaned.width, alphaCleaned.height),
    strongEdgesAfter: countStrongEdges(baseWorkingImage.data, baseWorkingImage.width, baseWorkingImage.height),
    thinRunsBefore: countThinRuns(alphaCleaned.data, alphaCleaned.width, alphaCleaned.height),
    thinRunsAfter: countThinRuns(baseWorkingImage.data, baseWorkingImage.width, baseWorkingImage.height),
  });

  const candidates: VectorSvgCandidateInput[] = [];
  let upscaleFactor: 1 | 2 | 3 = 1;
  let primarySceneGraph: VectorReconstructionSceneGraph | undefined;
  let stage2Report: Stage2InspectionReport | undefined;

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
    const monoSanitized = inspectAndSanitizeSvgContours(
      monoRaw,
      denoisedImage,
      1,
      resolvedParams.pathSimplification >= 65 ? 2 : 3
    ).svg;
    const monoNorm = normalizeSvgForEditorsAndScaling(
      monoSanitized,
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

    const totalWorkPixels = denoisedImage.width * denoisedImage.height;
    if (totalWorkPixels <= 1_800_000) {
      const objRec = await reconstructImageAsEditableObjects(
        denoisedImage,
        resolvedParams,
        colorAnalysis.detectedCategory,
        '',
        '',
        []
      );
      primarySceneGraph = objRec.sceneGraph;
      stage2Report = objRec.stage2Report;
      let objSceneSvg = objRec.svg;

      const stage2Hooks = getRegisteredStage2Hooks();
      for (const hook of stage2Hooks) {
        const hookReport = await hook.inspectScene(primarySceneGraph, denoisedImage, null);
        stage2Report = {
          ...stage2Report,
          passed: stage2Report.passed && hookReport.passed,
          defects: [...stage2Report.defects, ...hookReport.defects],
        };
        if (!hookReport.passed && hook.autoRepairScene) {
          const repaired = await hook.autoRepairScene(primarySceneGraph, hookReport, denoisedImage);
          if (repaired) {
            primarySceneGraph = repaired;
            objSceneSvg = repaired.svgMarkup;
          }
        }
      }

      if (resolvedParams.engine === 'auto') {
        const candObjMono = normalizeSvgForEditorsAndScaling(
          objSceneSvg,
          originalWidth,
          originalHeight,
          denoisedImage.width,
          denoisedImage.height
        );
        candidates.push({
          candidateId: 'opencv-topologia-bezier-gradientes',
          label: 'Topologia Planar OKLab + Objetos de Traço Editáveis',
          engineKind: 'opencv_bezier_gradients',
          svg: candObjMono,
        });
      }
    }
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

    // CANDIDATO 1: Motor Universal Topológico (OpenCV + OKLab + Fronteiras Compartilhadas + Bézier + Gradientes SVG)
    const totalWorkPixels = denoisedImage.width * denoisedImage.height;
    if (totalWorkPixels <= 1_800_000) {
      onProgress?.({
        stageId: 'stage2_refinement',
        stageLabel:
          'Etapa C & D: Topologia planar OKLab + Ciclo iterativo de refinamento e correção automática...',
        percent: 52,
      });

      const scaleOrigToWork = denoisedImage.width / originalWidth;
      const scaledTypoBoxes =
        scaleOrigToWork === 1
          ? colorAnalysis.typographyRegions
          : colorAnalysis.typographyRegions.map((tr) => ({
              ...tr,
              x: Math.round(tr.x * scaleOrigToWork),
              y: Math.round(tr.y * scaleOrigToWork),
              width: Math.max(2, Math.round(tr.width * scaleOrigToWork)),
              height: Math.max(2, Math.round(tr.height * scaleOrigToWork)),
            }));

      let objSceneSvg = '';
      const objRec = await reconstructImageAsEditableObjects(
        denoisedImage,
        resolvedParams,
        colorAnalysis.detectedCategory,
        typoBaseDefs,
        typoBaseGroups,
        scaledTypoBoxes
      );
      primarySceneGraph = objRec.sceneGraph;
      stage2Report = objRec.stage2Report;
      objSceneSvg = objRec.svg;

      // Executa hooks externos adicionais caso registrados sem perder o histórico A->B->C da Etapa 2
      const stage2Hooks = getRegisteredStage2Hooks();
      for (const hook of stage2Hooks) {
        const hookReport = await hook.inspectScene(primarySceneGraph, denoisedImage, null);
        stage2Report = {
          ...stage2Report,
          passed: stage2Report.passed && hookReport.passed,
          defects: [...stage2Report.defects, ...hookReport.defects],
        };
        if (!hookReport.passed && hook.autoRepairScene) {
          const repaired = await hook.autoRepairScene(primarySceneGraph, hookReport, denoisedImage);
          if (repaired) {
            primarySceneGraph = repaired;
            objSceneSvg = repaired.svgMarkup;
          }
        }
      }

      const cand1Svg = normalizeSvgForEditorsAndScaling(
        objSceneSvg,
        originalWidth,
        originalHeight,
        denoisedImage.width,
        denoisedImage.height
      );

      candidates.push({
        candidateId: 'opencv-topologia-bezier-gradientes',
        label: 'Topologia Planar OKLab + Bézier + Gradientes SVG Nativos',
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

    // Remove tinta tipográfica antes de alimentar VTracer para evitar contornos duplicados sob as letras vetoriais!
    const vtracerSubstrate =
      params.enhanceTypography !== false &&
      colorAnalysis.typographyRegions.length > 0 &&
      resolvedParams.detailPrecision >= 65
        ? inpaintTypographyInkMask(
            denoisedImage,
            buildExactTypographyInkMask(
              denoisedImage,
              colorAnalysis.typographyRegions,
              denoisedImage.width / originalWidth
            )
          )
        : denoisedImage;

    const traceInputImage =
      upscaleFactor === 2 || upscaleFactor === 3
        ? upscaleRgbaCatmullRom(vtracerSubstrate, upscaleFactor)
        : vtracerSubstrate;

    const viewBoxWidth = traceInputImage.width;
    const viewBoxHeight = traceInputImage.height;
    const coordScaleFromBase = viewBoxWidth / baseWorkingImage.width;

    // Só sobrepõe gradientes auxiliares em VTracer quando a imagem excedeu o orçamento do motor topológico (> 1.8MP),
    // evitando contornos sobrepostos duplicados sobre formas já vetorizadas!
    let gradDefsXml = '';
    let gradLayersXml = '';
    if (
      totalWorkPixels > 1_800_000 &&
      params.reconstructGradients !== false &&
      resolvedParams.colorCount >= 16 &&
      (colorAnalysis.detectedCategory === 'gradient_logo' ||
        colorAnalysis.detectedCategory === 'complex_illustration' ||
        colorAnalysis.gradientRatio >= 0.18)
    ) {
      const gradRes = await reconstructNativeSvgGradients(
        vtracerSubstrate,
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

    // Variante VTracer A: Spline equilibrado com agrupamento em objetos + gradientes nativos + saneamento de contornos
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
    const sanitizedVtSpline = inspectAndSanitizeSvgContours(
      groupedVtSpline,
      denoisedImage,
      denoisedImage.width / viewBoxWidth,
      resolvedParams.pathSimplification >= 65 ? 2 : 3
    ).svg;
    const cand2Svg = normalizeSvgForEditorsAndScaling(
      sanitizedVtSpline,
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
      const sanitizedVtFine = inspectAndSanitizeSvgContours(
        groupedVtFine,
        denoisedImage,
        denoisedImage.width / viewBoxWidth,
        resolvedParams.pathSimplification >= 65 ? 2 : 3
      ).svg;
      const cand3Svg = normalizeSvgForEditorsAndScaling(
        sanitizedVtFine,
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

  const qualityGate = await buildUniversalVectorizationReport({
    svg: finalSvg,
    original: sourceImage,
    quality: winnerQuality,
    validation,
    category: colorAnalysis.detectedCategory,
    reviewDefects: stage2Report?.defects?.map((defect) => defect.description) ?? [],
  });

  const residualNoiseHigh =
    colorAnalysis.noiseLevel >= 9.5 ||
    (winnerQuality?.p95DeltaE2000 !== undefined && winnerQuality.p95DeltaE2000 >= 7.5);

  const technicalLimitationsNote = [
    colorAnalysis.detectedCategory === 'photograph'
      ? 'Fotografia contínua reconstruída por aproximação vetorial em camadas editáveis (zero pixels raster). Microtexturas estocásticas de sensor/JPEG são representadas por regiões geométricas e gradientes aproximados em vez de fragmentos artificiais.'
      : residualNoiseHigh
        ? 'A imagem contém microvariações estocásticas ou compressão com perdas que não possuem equivalente analítico exato em curvas Bézier; o motor priorizou geometria limpa sem criar fragmentos artificiais de ruído.'
        : undefined,
    qualityGate.approved ? undefined : qualityGate.summary,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

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
    qualityGate,
    sceneGraph: primarySceneGraph,
    stage2Report,
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
    pipelineAudit: finishPipelineAudit(),
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
