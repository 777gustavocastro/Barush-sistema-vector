import type {
  ColorAnalysisReport,
  RawRgbaImage,
  VectorizationPipelineResult,
  VectorizationProgressEvent,
} from '../engine/types';

export type AcceptedFormat = 'PNG' | 'JPG' | 'JPEG' | 'WebP';

export type VectorizerProfileId = 'auto' | 'high_fidelity' | 'logo_illustration';

export interface AdvancedSettings {
  colorCount: number;
  detailPrecision: number;
  curveSmoothness: number;
  pathSimplification: number;
  noiseRemoval: number;
  contourSensitivity: number;
}

export type VectorizerUIState =
  | 'initial'
  | 'image_loaded'
  | 'processing'
  | 'completed'
  | 'error';

export type ComparisonMode = 'side_by_side' | 'slider' | 'overlay' | 'pixel_diff';

export type CanvasBackground = 'transparent' | 'white' | 'dark';

export interface SourceImageInfo {
  name: string;
  format: AcceptedFormat;
  byteLength: number;
  sizeLabel: string;
  width: number;
  height: number;
  dimensionsLabel: string;
  previewUrl: string;
  rgbaImage: RawRgbaImage;
  colorAnalysis: ColorAnalysisReport;
}

export interface ProfileDefinition {
  id: VectorizerProfileId;
  label: string;
  shortTag: string;
  description: string;
  defaults: AdvancedSettings;
}

export interface AdvancedSettingMeta {
  key: keyof AdvancedSettings;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export type { VectorizationPipelineResult, VectorizationProgressEvent };
