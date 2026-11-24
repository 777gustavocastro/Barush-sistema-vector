import type {
  Stage2InspectionReport,
  VectorReconstructionSceneGraph,
} from './stage2/reconstructionSceneGraph';
import type { UniversalVectorizationReport } from './quality/universalQualityGate';
import type { PipelineAuditReport } from './audit/pipelineAudit';

export type SupportedRasterFormat = 'png' | 'jpg' | 'jpeg' | 'webp';

export type VectorEngineKind =
  | 'opencv_bezier_gradients'
  | 'vtracer_rek_gradients'
  | 'potrace_bezier';

export type EnginePresetProfile =
  | 'auto'
  | 'high_fidelity'
  | 'logo_illustration'
  | 'monochrome_logo';

export type DetectedImageCategory =
  | 'gradient_logo'
  | 'solid_logo'
  | 'icon_graphic'
  | 'character_illustration'
  | 'metallic_lighting'
  | 'complex_illustration'
  | 'monochrome_drawing'
  | 'typography_text'
  | 'photograph';

export interface TunedSliderValues {
  /** Quantidade alvo de cores (2..256; valores >= 128 preservam paleta completa 24-bit sem pré-quantização). */
  colorCount: number;
  detailPrecision: number;
  curveSmoothness: number;
  pathSimplification: number;
  noiseRemoval: number;
  contourSensitivity: number;
}

export interface RawRgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
  sourceFormat?: SupportedRasterFormat;
}

export interface TypographyRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  glyphCount: number;
  isSingleColorInk: boolean;
  inkHex: string;
  backgroundHex: string;
  confidence: number;
}

export interface ColorAnalysisReport {
  width: number;
  height: number;
  totalPixels: number;
  hasTransparency: boolean;
  transparentPixelRatio: number;
  meanOpaqueLuminance: number;
  estimatedDistinctColors: number;
  fineColorBins: number;
  luminanceContrast: number;
  complexityScore: number;
  edgeDensity: number;
  gradientRatio: number;
  noiseLevel: number;
  smallDetailDensity: number;
  hasTypography: boolean;
  typographyRegions: TypographyRegion[];
  hasMetallicOrLighting?: boolean;
  isMonochromeCandidate: boolean;
  detectedCategory: DetectedImageCategory;
  categoryLabel: string;
  adaptiveStrategySummary: string;
  dominantHexColors: string[];
  recommendedEngine: 'vtracer' | 'potrace';
  recommendedParameters: TunedSliderValues;
}

export interface VectorizationParameters extends TunedSliderValues {
  profile: EnginePresetProfile;
  engine?: 'vtracer' | 'potrace' | 'auto';
  autoTune?: boolean;
  optimizeSvg?: boolean;
  reconstructGradients?: boolean;
  enhanceTypography?: boolean;
  subpixelUpscale?: boolean;
  maxWorkingDimension?: number;
}

export interface VectorizationProgressEvent {
  stageId:
    | 'analyze'
    | 'segment_objects'
    | 'reconstruct_bezier'
    | 'gradients_typography'
    | 'stage2_refinement'
    | 'evaluate_candidates'
    | 'validate';
  stageLabel: string;
  percent: number;
}

export type ProgressCallback = (event: VectorizationProgressEvent) => void;

export interface SvgValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  width: number | null;
  height: number | null;
  viewBox: string | null;
  objectCount: number;
  groupCount: number;
  pathCount: number;
  gradientCount: number;
  linearGradientCount: number;
  radialGradientCount: number;
  clipPathCount: number;
  totalVectorElements: number;
  hasEmbeddedRaster: boolean;
  byteLength: number;
}

export interface SvgOptimizationResult {
  svg: string;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
  savedRatio: number;
  preservedPathCount: number;
}

export interface CandidateEvaluationSummary {
  candidateId: string;
  label: string;
  ssimPct: number;
  perceptualColorPct: number;
  contourFidelityPct: number;
  gradientContinuityPct: number;
  compositeScore: number;
  objectCount: number;
  pathCount: number;
  gradientCount: number;
}

export interface QualityComparisonReport {
  /** Índice de Similaridade Estrutural SSIM em escala 0..100%. */
  ssimPct: number;
  /** Semelhança global por pixels em escala 0..100%. */
  pixelSimilarityPct: number;
  /** PSNR em dB. */
  psnrDb: number;
  /** Fidelidade estrutural de contornos (Sobel F1) em 0..100%. */
  contourFidelityPct: number;
  /** Fidelidade cromática perceptual baseada em CIE ΔE Lab / CIEDE2000 (0..100%). */
  colorFidelityPct: number;
  /** Diferença perceptual média de cor CIE ΔE76 no espaço Lab. */
  meanDeltaELab: number;
  /** Diferença perceptual média internacional ISO/CIE CIEDE2000 (ΔE₀₀). */
  meanDeltaE2000?: number;
  /** Percentil 95 de diferença cromática CIEDE2000 (revela desvios localizados). */
  p95DeltaE2000?: number;
  /** Distância média bidirecional de contornos (Chamfer Distance) em pixels. */
  chamferDistancePx?: number;
  /** Distância máxima de desvio geométrico de contorno (Hausdorff Distance) em pixels. */
  hausdorffDistancePx?: number;
  /** Percentil 99 da distância de Hausdorff em pixels. */
  hausdorffP99Px?: number;
  /** Intersection over Union (IoU) da máscara de silhueta em 0..100%. */
  iouPct?: number;
  /** Continuidade e fidelidade de transições/gradientes (0..100%). */
  gradientContinuityPct: number;
  /** Erro absoluto médio por canal (0..255). */
  meanAbsoluteError: number;
  /** Candidatos avaliados durante a reconstrução e pontuação comparativa. */
  evaluatedCandidates?: CandidateEvaluationSummary[];
}

export interface VectorizationPipelineResult {
  svg: string;
  rawSvgBeforeOptimization: string;
  engineUsed: VectorEngineKind;
  selectedCandidateLabel: string;
  adaptiveStrategyLabel: string;
  technicalLimitationsNote?: string;
  effectiveParameters: TunedSliderValues;
  colorAnalysis: ColorAnalysisReport;
  optimization: SvgOptimizationResult | null;
  validation: SvgValidationReport;
  qualityReport?: QualityComparisonReport;
  qualityGate?: UniversalVectorizationReport;
  pipelineAudit?: PipelineAuditReport;
  sceneGraph?: VectorReconstructionSceneGraph;
  stage2Report?: Stage2InspectionReport;
  reconstructedGradientCount: number;
  reconstructedObjectCount: number;
  detectedTypographyCount: number;
  upscaleFactorUsed: number;
  originalWidth: number;
  originalHeight: number;
  workingWidth: number;
  workingHeight: number;
  wasDownscaled: boolean;
  durationMs: number;
}
