export type SupportedRasterFormat = 'png' | 'jpg' | 'jpeg' | 'webp';

export type VectorEngineKind = 'vtracer' | 'potrace';

export type EnginePresetProfile = 'auto' | 'high_fidelity' | 'logo_illustration' | 'monochrome_logo';

export type DetectedImageCategory =
  | 'monochrome_logo'
  | 'color_logo'
  | 'icon_drawing'
  | 'illustration_pattern'
  | 'detailed_artwork'
  | 'photograph';

export interface TunedSliderValues {
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
  isMonochromeCandidate: boolean;
  detectedCategory: DetectedImageCategory;
  categoryLabel: string;
  dominantHexColors: string[];
  recommendedEngine: VectorEngineKind;
  recommendedParameters: TunedSliderValues;
}

export interface VectorizationParameters extends TunedSliderValues {
  profile: EnginePresetProfile;
  engine?: VectorEngineKind | 'auto';
  /** Quando verdadeiro no perfil 'auto', aplica automaticamente os parâmetros calculados pela inteligência de imagem. */
  autoTune?: boolean;
  optimizeSvg?: boolean;
  maxWorkingDimension?: number;
}

export interface VectorizationProgressEvent {
  stageId: 'analyze' | 'preprocess' | 'trace' | 'optimize' | 'validate';
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

export interface VectorizationPipelineResult {
  svg: string;
  rawSvgBeforeOptimization: string;
  engineUsed: VectorEngineKind;
  effectiveParameters: TunedSliderValues;
  colorAnalysis: ColorAnalysisReport;
  optimization: SvgOptimizationResult | null;
  validation: SvgValidationReport;
  originalWidth: number;
  originalHeight: number;
  workingWidth: number;
  workingHeight: number;
  wasDownscaled: boolean;
  durationMs: number;
}
