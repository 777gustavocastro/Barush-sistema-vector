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
  | 'settings_ready'
  | 'processing'
  | 'completed'
  | 'error'
  | 'ready_for_download';

export type ComparisonMode = 'side_by_side' | 'slider';

export type CanvasBackground = 'transparent' | 'white' | 'dark';

export interface SourceImageInfo {
  name: string;
  format: AcceptedFormat;
  sizeLabel: string;
  dimensionsLabel: string;
  previewUrl: string | null;
  isIllustrative: boolean;
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

export interface UIStateOption {
  id: VectorizerUIState;
  stepNumber: number;
  label: string;
  shortLabel: string;
  description: string;
}
