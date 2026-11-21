import type {
  AcceptedFormat,
  AdvancedSettingMeta,
  AdvancedSettings,
  ProfileDefinition,
  SourceImageInfo,
  UIStateOption,
} from '../types/vectorizer';

export const ACCEPTED_FORMATS: AcceptedFormat[] = ['PNG', 'JPG', 'JPEG', 'WebP'];

export const ACCEPTED_MIME_TYPES: Record<string, AcceptedFormat> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/jpg': 'JPEG',
  'image/webp': 'WebP',
};

export const ILLUSTRATIVE_SOURCE_IMAGE: SourceImageInfo = {
  name: 'amostra-marca-geometrica.png',
  format: 'PNG',
  sizeLabel: '428 KB',
  dimensionsLabel: '1200 × 1200 px',
  previewUrl: null,
  isIllustrative: true,
};

export const VECTORIZER_PROFILES: ProfileDefinition[] = [
  {
    id: 'auto',
    label: 'Automático',
    shortTag: 'Recomendado',
    description:
      'Equilibra definição de contornos, paleta de cores e suavidade para uso geral sem ajustes manuais.',
    defaults: {
      colorCount: 16,
      detailPrecision: 72,
      curveSmoothness: 65,
      pathSimplification: 40,
      noiseRemoval: 35,
      contourSensitivity: 68,
    },
  },
  {
    id: 'high_fidelity',
    label: 'Alta fidelidade',
    shortTag: 'Máximo detalhe',
    description:
      'Preserva nuances cromáticas, microdetalhes e transições complexas com maior densidade de caminhos.',
    defaults: {
      colorCount: 48,
      detailPrecision: 94,
      curveSmoothness: 45,
      pathSimplification: 15,
      noiseRemoval: 18,
      contourSensitivity: 90,
    },
  },
  {
    id: 'logo_illustration',
    label: 'Logo e ilustração',
    shortTag: 'Traço limpo',
    description:
      'Otimizado para marcas, ícones e artes planas com curvas Bézier limpas e número reduzido de nós.',
    defaults: {
      colorCount: 8,
      detailPrecision: 80,
      curveSmoothness: 85,
      pathSimplification: 65,
      noiseRemoval: 60,
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
    description: 'Limite máximo de cores distintas na paleta vetorial gerada.',
    min: 2,
    max: 64,
    step: 1,
    unit: ' cores',
  },
  {
    key: 'detailPrecision',
    label: 'Precisão dos detalhes',
    description: 'Nível de retenção de formas pequenas, cantos agudos e elementos finos.',
    min: 10,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'curveSmoothness',
    label: 'Suavidade das curvas',
    description: 'Intensidade da interpolação em curvas Bézier para evitar bordas serrilhadas.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'pathSimplification',
    label: 'Simplificação dos caminhos',
    description: 'Reduz pontos de ancoragem redundantes para gerar um arquivo SVG mais leve.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'noiseRemoval',
    label: 'Remoção de ruídos',
    description: 'Filtra artefatos de compressão e manchas isoladas da imagem original.',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  {
    key: 'contourSensitivity',
    label: 'Sensibilidade dos contornos',
    description: 'Limiar de detecção de contraste entre regiões adjacentes da imagem.',
    min: 10,
    max: 100,
    step: 1,
    unit: '%',
  },
];

export const UI_STATE_OPTIONS: UIStateOption[] = [
  {
    id: 'initial',
    stepNumber: 1,
    label: 'Tela inicial sem imagem',
    shortLabel: 'Inicial',
    description: 'Estado vazio inicial focado no envio da imagem e orientação de uso.',
  },
  {
    id: 'image_loaded',
    stepNumber: 2,
    label: 'Imagem carregada',
    shortLabel: 'Carregada',
    description: 'Imagem selecionada com pré-visualização original e metadados prontos.',
  },
  {
    id: 'settings_ready',
    stepNumber: 3,
    label: 'Configurações disponíveis',
    shortLabel: 'Configurações',
    description: 'Perfis e parâmetros avançados abertos para ajuste fino antes de vetorizar.',
  },
  {
    id: 'processing',
    stepNumber: 4,
    label: 'Processamento em andamento',
    shortLabel: 'Processando',
    description: 'Indicador visual de progresso e etapas durante o processamento.',
  },
  {
    id: 'completed',
    stepNumber: 5,
    label: 'Resultado concluído',
    shortLabel: 'Concluído',
    description: 'Comparação interativa lado a lado ou deslizante entre original e vetorizada.',
  },
  {
    id: 'error',
    stepNumber: 6,
    label: 'Erro durante o processamento',
    shortLabel: 'Erro',
    description: 'Feedback claro de falha com opções imediatas de recuperação.',
  },
  {
    id: 'ready_for_download',
    stepNumber: 7,
    label: 'Arquivo pronto para download',
    shortLabel: 'Download SVG',
    description: 'Resumo final do arquivo vetorial preparado para exportação em SVG.',
  },
];

export const PROCESSING_STEPS = [
  { id: 'decode', label: 'Análise estrutural da imagem', status: 'done' as const },
  { id: 'palette', label: 'Quantização e agrupamento de cores', status: 'done' as const },
  { id: 'bezier', label: 'Traçado de curvas e contornos vetoriais', status: 'active' as const },
  { id: 'optimize', label: 'Simplificação de caminhos e montagem SVG', status: 'pending' as const },
];
