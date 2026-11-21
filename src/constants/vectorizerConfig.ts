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
    shortTag: 'Padrão inteligente',
    description:
      'Analisa cores, contraste, gradientes, transparência e detalhes para escolher motor e parâmetros ideais.',
    defaults: {
      colorCount: 16,
      detailPrecision: 80,
      curveSmoothness: 70,
      pathSimplification: 26,
      noiseRemoval: 25,
      contourSensitivity: 74,
    },
  },
  {
    id: 'high_fidelity',
    label: 'Alta fidelidade',
    shortTag: 'Máximo detalhe',
    description:
      'Prioriza preservação rigorosa de cores, contornos sutis, formas pequenas e transições cromáticas.',
    defaults: {
      colorCount: 48,
      detailPrecision: 94,
      curveSmoothness: 52,
      pathSimplification: 8,
      noiseRemoval: 12,
      contourSensitivity: 90,
    },
  },
  {
    id: 'logo_illustration',
    label: 'Logo e ilustração',
    shortTag: 'Traço limpo',
    description:
      'Prioriza curvas Bézier suaves, formas limpas, contornos bem definidos e filtragem de ruídos.',
    defaults: {
      colorCount: 10,
      detailPrecision: 82,
      curveSmoothness: 86,
      pathSimplification: 42,
      noiseRemoval: 45,
      contourSensitivity: 78,
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
    description: 'Limite máximo de cores distintas preservadas na paleta vetorial.',
    min: 2,
    max: 64,
    step: 1,
    unit: ' cores',
  },
  {
    key: 'detailPrecision',
    label: 'Precisão dos detalhes',
    description: 'Retenção de microformas, elementos finos e fidelidade entre camadas.',
    min: 10,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'curveSmoothness',
    label: 'Suavidade das curvas',
    description: 'Interpolação em curvas Bézier contínuas para eliminar serrilhados.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'pathSimplification',
    label: 'Simplificação dos caminhos',
    description: 'Reduz nós redundantes para gerar caminhos mais leves sem deformar a arte.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'noiseRemoval',
    label: 'Remoção de ruídos',
    description: 'Filtra artefatos de compressão e manchas isoladas antes e durante o traçado.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'contourSensitivity',
    label: 'Sensibilidade dos contornos',
    description: 'Detecção de cantos vivos e transições de contraste entre regiões.',
    min: 10,
    max: 100,
    step: 1,
    unit: '%',
  },
];

export const PIPELINE_STAGES_ORDER = [
  { id: 'analyze' as const, label: 'Análise inteligente de cores, contraste e detalhes' },
  { id: 'preprocess' as const, label: 'Tratamento de transparência, escala e ruídos' },
  { id: 'trace' as const, label: 'Traçado geométrico de curvas e contornos vetoriais' },
  { id: 'optimize' as const, label: 'Otimização fiel de estrutura com SVGO' },
  { id: 'validate' as const, label: 'Validação de caminhos editáveis e proporções' },
];
