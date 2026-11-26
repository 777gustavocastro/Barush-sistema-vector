import type {
  AcceptedFormat,
  AdvancedSettingMeta,
  AdvancedSettings,
  ProfileDefinition,
} from '../types/vectorizer';

export const ACCEPTED_FORMATS: AcceptedFormat[] = ['PNG', 'JPG', 'JPEG', 'WebP'];

export const ACCEPTED_MIME_TYPES: Record<string, AcceptedFormat> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/jpg': 'JPEG',
  'image/webp': 'WebP',
};

export const VECTORIZER_PROFILES: ProfileDefinition[] = [
  {
    id: 'auto',
    label: 'Automático',
    shortTag: 'Motor inteligente',
    description:
      'Analisa com OpenCV objetos, contornos, degradês, sombras e tipografia, selecionando o melhor candidato 100% vetorial.',
    defaults: {
      colorCount: 256,
      detailPrecision: 95,
      curveSmoothness: 68,
      pathSimplification: 0,
      noiseRemoval: 0,
      contourSensitivity: 86,
    },
  },
  {
    id: 'high_fidelity',
    label: 'Alta fidelidade',
    shortTag: 'Máximo detalhe',
    description:
      'Paleta 24-bit integral sem redução de cores, microformas, reflexos, gradientes multi-stop e letras em curvas 3×.',
    defaults: {
      colorCount: 256,
      detailPrecision: 98,
      curveSmoothness: 64,
      pathSimplification: 0,
      noiseRemoval: 0,
      contourSensitivity: 90,
    },
  },
  {
    id: 'logo_illustration',
    label: 'Logo e ilustração',
    shortTag: 'Objetos e curvas',
    description:
      'Prioriza separação limpa em objetos (<g>), curvas Bézier suaves e degradês nativos para Illustrator e Inkscape.',
    defaults: {
      colorCount: 192,
      detailPrecision: 92,
      curveSmoothness: 76,
      pathSimplification: 8,
      noiseRemoval: 8,
      contourSensitivity: 84,
    },
  },
];

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  ...VECTORIZER_PROFILES[0].defaults,
};

export const ADVANCED_SETTINGS_META: AdvancedSettingMeta[] = [
  {
    key: 'colorCount',
    label: 'Quantidade de cores',
    description: 'Paleta máxima preservada (valores >= 128 mantêm fidelidade 24-bit sem redução agressiva).',
    min: 2,
    max: 256,
    step: 1,
    unit: ' cores',
  },
  {
    key: 'detailPrecision',
    label: 'Precisão dos detalhes',
    description: 'Retenção de pequenos elementos, pontas de penas, olhos, reflexos e letras.',
    min: 10,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'curveSmoothness',
    label: 'Suavidade das curvas',
    description: 'Ajuste de curvas Bézier cúbicas contínuas sem serrilhamento.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'pathSimplification',
    label: 'Simplificação dos caminhos',
    description: 'Reduz apenas nós colineares redundantes sem deformar contornos originais.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'noiseRemoval',
    label: 'Remoção de ruídos',
    description: 'Filtra artefatos de compressão preservando detalhes pequenos reais.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'contourSensitivity',
    label: 'Sensibilidade dos contornos',
    description: 'Precisão em extremidades vivas, cantos tipográficos e bordas entre objetos.',
    min: 10,
    max: 100,
    step: 1,
    unit: '%',
  },
];

export const PIPELINE_STAGES_ORDER = [
  { id: 'analyze' as const, label: 'Etapa A: Análise OpenCV de regiões, bordas e cores' },
  { id: 'segment_objects' as const, label: 'Etapa B: Separação em objetos independentes (<g>)' },
  { id: 'reconstruct_bezier' as const, label: 'Etapa C: Reconstrução geométrica em curvas Bézier' },
  { id: 'stage2_refinement' as const, label: 'Etapa D: Refinamento iterativo e auto-reparo (CIEDE2000, Chamfer, IoU)' },
  { id: 'gradients_typography' as const, label: 'Gradientes SVG nativos e tipografia em caminhos' },
  { id: 'evaluate_candidates' as const, label: 'Seleção multi-candidato supersampling (SSIM, ΔE2000 e Hausdorff)' },
  { id: 'validate' as const, label: 'Auditoria XML anti-raster e validação editável' },
];
