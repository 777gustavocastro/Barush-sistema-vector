export type SupportedRasterFormat = 'png' | 'jpg' | 'jpeg' | 'webp';

export type VectorEngineKind = 'vtracer' | 'potrace';

export type EnginePresetProfile = 'auto' | 'high_fidelity' | 'logo_illustration' | 'monochrome_logo';

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
  estimatedDistinctColors: number;
  luminanceContrast: number;
  isMonochromeCandidate: boolean;
  dominantHexColors: string[];
  recommendedEngine: VectorEngineKind;
}

export interface VectorizationParameters {
  profile: EnginePresetProfile;
  engine?: VectorEngineKind | 'auto';
  colorCount: number;
  detailPrecision: number;
  curveSmoothness: number;
  pathSimplification: number;
  noiseRemoval: number;
  contourSensitivity: number;
  optimizeSvg?: boolean;
}

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
  colorAnalysis: ColorAnalysisReport;
  optimization: SvgOptimizationResult | null;
  validation: SvgValidationReport;
  durationMs: number;
}
