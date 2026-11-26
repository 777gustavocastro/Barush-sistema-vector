import type { VectorizationPipelineResult, VectorizerProfileId } from '../../types/vectorizer';

export type ChatToolId =
  | 'remove_bg'
  | 'vectorize'
  | 'enhance'
  | 'upscale'
  | 'adjust'
  | 'mockup'
  | 'print_prep'
  | 'generate_pdf'
  | 'export_svg';

export type ResolutionPreset = 'standard' | 'HD' | '4K';

export type AspectRatioOption = 'product' | '1:1' | '4:3' | '16:9' | '9:16' | '3:2' | 'A4';

export type OutputFormatOption = 'SVG' | 'PDF' | 'PNG' | 'JPG' | 'WebP';

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
  width?: number;
  height?: number;
  resolutionLabel?: string;
  approved?: boolean;
  operationTag?: string;
  productName?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  time: string;
  attachments?: ChatAttachment[];
  media?: ChatMediaItem;
  fileDownload?: {
    fileName: string;
    format: string;
    sizeLabel: string;
    blobUrl: string;
  };
  progress?: {
    stage: string;
    percent: number;
  };
}

export interface ChatConversation {
  id: string;
  clientId: string;
  title: string;
  productId: string | null;
  updatedAt: string;
  messages: ChatMessage[];
}

export type ChatModelProfile = VectorizerProfileId;
