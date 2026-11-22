export type SupportedRasterFormat = 'png' | 'jpg' | 'jpeg' | 'webp';

export type VectorEngineKind = 'vtracer' | 'potrace' | 'hybrid_fidelity';

export type ResultOutputMode = 'editable_vector' | 'max_visual_fidelity';

export type EnginePresetProfile =
  | 'auto'
  | 'high_fidelity'
  | 'logo_illustration'
  | 'monochrome_logo';

export type DetectedImageCategory =
  | 'gradient_logo'
  | 'solid_logo'
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
  /** Modo de resultado: 'editable_vector' (caminhos/formas/gradientes 100% vetoriais) ou 'max_visual_fidelity' (fidelidade máxima, podendo gerar SVG híbrido identificado). */
  outputMode?: ResultOutputMode;
  engine?: 'vtracer' | 'potrace' | 'auto';
  autoTune?: boolean;
  optimizeSvg?: boolean;
  reconstructGradients?: boolean;
  enhanceTypography?: boolean;
  subpixelUpscale?: boolean;
  maxWorkingDimension?: number;
}

export interface VectorizationProgressEvent {
  stageId: 'analyze' | 'preprocess' | 'trace' | 'gradients_typography' | 'optimize' | 'validate';
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
  pathCount: number;
  gradientCount: number;
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

export interface QualityComparisonReport {
  pixelSimilarityPct: number;
  psnrDb: number;
  contourFidelityPct: number;
  colorFidelityPct: number;
  meanAbsoluteError: number;
}

export interface VectorizationPipelineResult {
  svg: string;
  rawSvgBeforeOptimization: string;
  outputMode: ResultOutputMode;
  isHybridRasterSvg: boolean;
  engineUsed: VectorEngineKind;
  adaptiveStrategyLabel: string;
  effectiveParameters: TunedSliderValues;
  colorAnalysis: ColorAnalysisReport;
  optimization: SvgOptimizationResult | null;
  validation: SvgValidationReport;
  qualityReport?: QualityComparisonReport;
  reconstructedGradientCount: number;
  detectedTypographyCount: number;
  upscaleFactorUsed: number;
  originalWidth: number;
  originalHeight: number;
  workingWidth: number;
  workingHeight: number;
  wasDownscaled: boolean;
  durationMs: number;
}
