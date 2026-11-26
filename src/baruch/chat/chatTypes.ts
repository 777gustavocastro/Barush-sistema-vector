import type { VectorizationPipelineResult, VectorizerProfileId } from '../../types/vectorizer';

export type BottomToolId = 'vectorize' | 'upscale' | 'mockup' | 'remove_bg';

export type HoverActionId =
  | 'vectorize'
  | 'upscale'
  | 'remove_bg'
  | 'mockup'
  | 'resize'
  | 'enhance';

export type OutputFormatOption = 'PNG' | 'PDF' | 'SVG';

export type QualityOption = '4K' | '2K';

export type AspectRatioOption =
  | '1:1'
  | '3:4'
  | '4:3'
  | '9:16'
  | '16:9'
  | '3:2'
  | '2:3'
  | '4:5'
  | '21:9'
  | 'A4';

export type VectorizeModeOption = 'auto' | 'high_fidelity' | 'logo' | 'illustration';

export type UpscaleFactorOption = '2x' | '4x';

export type MockupCategoryOption =
  | 'copos'
  | 'camisetas'
  | 'uniformes'
  | 'banners'
  | 'cartao_visitas'
  | 'impressoes';

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeLabel: string;
  isImage: boolean;
  dataUrl: string;
  file?: File;
}

export interface ChatMediaItem {
  id: string;
  label: string;
  fileName: string;
  kind: 'attached' | 'generated' | 'processed' | 'vectorized';
  imageUrl: string;
  beforeUrl?: string;
  svgMarkup?: string;
  vectorResult?: VectorizationPipelineResult;
  aspectRatio?: AspectRatioOption | string;
  qualityLabel?: string;
  outputFormat?: OutputFormatOption;
  width?: number;
  height?: number;
  operationTag?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  time: string;
  attachments?: ChatAttachment[];
  media?: ChatMediaItem;
  progress?: {
    stage: string;
    percent: number;
  };
}

export interface ChatConversation {
  id: string;
  clientId: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export function mapVectorizeModeToProfile(mode: VectorizeModeOption): VectorizerProfileId {
  if (mode === 'high_fidelity') return 'high_fidelity';
  if (mode === 'logo' || mode === 'illustration') return 'logo_illustration';
  return 'auto';
}
