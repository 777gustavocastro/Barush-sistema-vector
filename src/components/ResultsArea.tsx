import React, { useRef, useState } from 'react';
import {
  Columns2,
  SplitSquareHorizontal,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Image as ImageIcon,
  PenTool,
  MoveHorizontal,
  Sparkles,
  FileCheck2,
  Upload,
} from 'lucide-react';
import type {
  AdvancedSettings,
  CanvasBackground,
  ComparisonMode,
  SourceImageInfo,
  VectorizerProfileId,
  VectorizerUIState,
} from '../types/vectorizer';
import { PROCESSING_STEPS, VECTORIZER_PROFILES } from '../constants/vectorizerConfig';
import { IllustrativeArtwork } from './IllustrativeArtwork';

interface ResultsAreaProps {
  uiState: VectorizerUIState;
  sourceImage: SourceImageInfo | null;
  selectedProfile: VectorizerProfileId;
  advancedSettings: AdvancedSettings;
  comparisonMode: ComparisonMode;
  canvasBackground: CanvasBackground;
  zoom: number;
  sliderPosition: number;
  onChangeComparisonMode: (mode: ComparisonMode) => void;
  onChangeBackground: (bg: CanvasBackground) => void;
  onChangeZoom: (zoom: number) => void;
  onChangeSliderPosition: (pos: number) => void;
  onRequestDownloadInfo: () => void;
  onRequestRevectorizeInfo: () => void;
  onClearToUpload: () => void;
}

const ZOOM_MIN = 50;
const ZOOM_MAX = 250;
const ZOOM_STEP = 25;

function getBackgroundClass(bg: CanvasBackground): string {
  switch (bg) {
    case 'transparent':
      return 'bg-checkerboard-dark';
    case 'white':
      return 'bg-white';
    case 'dark':
      return 'bg-zinc-950';
  }
}

function getLabelBadgeStyle(bg: CanvasBackground): string {
  if (bg === 'white') {
    return 'border-zinc-300/90 bg-zinc-900/85 text-zinc-100';
  }
  return 'border-zinc-700/80 bg-zinc-900/90 text-zinc-200';
}

export const ResultsArea: React.FC<ResultsAreaProps> = ({
  uiState,
  sourceImage,
  selectedProfile,
  advancedSettings,
  comparisonMode,
  canvasBackground,
  zoom,
  sliderPosition,
  onChangeComparisonMode,
  onChangeBackground,
  onChangeZoom,
  onChangeSliderPosition,
  onRequestDownloadInfo,
  onRequestRevectorizeInfo,
  onClearToUpload,
}) => {
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [showVectorNodes, setShowVectorNodes] = useState(true);

  const hasResult = uiState === 'completed' || uiState === 'ready_for_download';
  const isProcessing = uiState === 'processing';
  const isError = uiState === 'error';
  const isInitial = uiState === 'initial';
  const isLoadedPreProcess =
    uiState === 'image_loaded' || uiState === 'settings_ready';

  const profileObj =
    VECTORIZER_PROFILES.find((p) => p.id === selectedProfile) ?? VECTORIZER_PROFILES[0];

  const outputSvgFilename = sourceImage
    ? sourceImage.name.replace(/\.(png|jpg|jpeg|webp)$/i, '') + '.svg'
    : 'vetorizado.svg';

  const updateSplitFromClientX = (clientX: number) => {
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(5, Math.min(95, Math.round(pct)));
    onChangeSliderPosition(clamped);
  };

  const bgClass = getBackgroundClass(canvasBackground);
  const badgeStyle = getLabelBadgeStyle(canvasBackground);

  return (
    <section
      aria-labelledby="results-area-heading"
      className="flex-1 min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 flex flex-col overflow-hidden"
    >
      {/* Barra de ferramentas superior da Área de Resultados */}
      <div className="border-b border-zinc-800/80 bg-zinc-950/50 px-4 py-3 sm:px-5">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          {/* Título + Alternador de modo de comparação */}
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3">
            <h2
              id="results-area-heading"
              className="text-sm font-semibold text-zinc-100 shrink-0"
            >
              Área de Resultados
            </h2>

            <div
              role="group"
              aria-label="Modo de comparação visual"
              className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
            >
              <button
                type="button"
                onClick={() => onChangeComparisonMode('side_by_side')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  comparisonMode === 'side_by_side' || !hasResult
                    ? 'bg-zinc-800 text-zinc-100 shadow-2xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
                <span>Lado a lado</span>
              </button>

              <button
                type="button"
                disabled={!hasResult}
                onClick={() => onChangeComparisonMode('slider')}
                title={
                  hasResult
                    ? 'Alternar para controle deslizante de comparação'
                    : 'Disponível quando o resultado está concluído'
                }
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  comparisonMode === 'slider' && hasResult
                    ? 'bg-zinc-800 text-zinc-100 shadow-2xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <SplitSquareHorizontal className="h-3.5 w-3.5" />
                <span>Controle deslizante</span>
              </button>
            </div>
          </div>

          {/* Controles de Zoom + Fundo do canvas */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Controle de Zoom */}
            <div
              role="group"
              aria-label="Controles de zoom"
              className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
            >
              <button
                type="button"
                disabled={isInitial || zoom <= ZOOM_MIN}
                onClick={() => onChangeZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))}
                aria-label="Diminuir zoom"
                title="Diminuir zoom"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>

              <span className="min-w-[52px] text-center font-mono text-xs font-medium text-zinc-200">
                {zoom}%
              </span>

              <button
                type="button"
                disabled={isInitial || zoom >= ZOOM_MAX}
                onClick={() => onChangeZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))}
                aria-label="Aumentar zoom"
                title="Aumentar zoom"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                disabled={isInitial || zoom === 100}
                onClick={() => onChangeZoom(100)}
                title="Restaurar zoom para 100%"
                className="inline-flex items-center gap-1 rounded-md border-l border-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Maximize2 className="h-3 w-3" />
                <span className="hidden sm:inline">100%</span>
              </button>
            </div>

            {/* Seletor de Fundo (Transparente, Branco, Escuro) */}
            <div
              role="group"
              aria-label="Cor de fundo da visualização"
              className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
            >
              <button
                type="button"
                onClick={() => onChangeBackground('transparent')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  canvasBackground === 'transparent'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Fundo transparente"
              >
                <span className="h-3 w-3 rounded-xs border border-zinc-600 bg-checkerboard-light shrink-0" />
                <span>Transparente</span>
              </button>

              <button
                type="button"
                onClick={() => onChangeBackground('white')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  canvasBackground === 'white'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Fundo branco"
              >
                <span className="h-3 w-3 rounded-xs border border-zinc-400 bg-white shrink-0" />
                <span>Branco</span>
              </button>

              <button
                type="button"
                onClick={() => onChangeBackground('dark')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  canvasBackground === 'dark'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Fundo escuro"
              >
                <span className="h-3 w-3 rounded-xs border border-zinc-600 bg-zinc-950 shrink-0" />
                <span>Escuro</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Destaque especial do estado: Arquivo pronto para download */}
      {uiState === 'ready_for_download' && (
        <div className="border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-3.5 sm:px-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                <FileCheck2 className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-emerald-200">
                    Arquivo pronto para download
                  </span>
                  <span className="rounded bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                    {outputSvgFilename}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-emerald-200/80">
                  Estrutura vetorial escalável preparada com o perfil{' '}
                  <strong>{profileObj.label}</strong> ({advancedSettings.colorCount} cores).
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onRequestDownloadInfo}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-xs hover:bg-emerald-400 transition-colors cursor-pointer shrink-0"
            >
              <Download className="h-4 w-4" />
              Baixar SVG agora
            </button>
          </div>
        </div>
      )}

      {/* Palco principal de visualização */}
      <div className="flex-1 bg-studio-dots p-4 sm:p-5 flex flex-col justify-center min-h-[360px] lg:min-h-[430px]">
        {/* ESTADO 1: Tela inicial sem imagem */}
        {isInitial && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[330px]">
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 p-6 flex flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
                <ImageIcon className="h-5 w-5" />
              </div>
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300">
                Original
              </span>
              <p className="mt-2.5 max-w-xs text-xs leading-relaxed text-zinc-500">
                A imagem enviada será exibida nesta área para inspeção de resolução, bordas e cores
                originais.
              </p>
            </div>

            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 p-6 flex flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
                <PenTool className="h-5 w-5" />
              </div>
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300">
                Vetorizada
              </span>
              <p className="mt-2.5 max-w-xs text-xs leading-relaxed text-zinc-500">
                O resultado em curvas escaláveis SVG aparecerá aqui com suporte a zoom, troca de
                fundo e comparação.
              </p>
            </div>
          </div>
        )}

        {/* ESTADOS 2 e 3: Imagem carregada / Configurações disponíveis */}
        {isLoadedPreProcess && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            {/* Quadro Original */}
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center min-h-[300px] ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
              </div>

              <div
                className="transition-transform duration-150 ease-out"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <IllustrativeArtwork
                  variant="raster"
                  customImageUrl={sourceImage?.previewUrl}
                />
              </div>
            </div>

            {/* Quadro Vetorizada aguardando execução */}
            <div className="relative rounded-xl border border-zinc-800 bg-zinc-950/75 p-6 flex flex-col items-center justify-center text-center min-h-[300px]">
              <div className="absolute top-3 left-3 z-10">
                <span className="rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-xs font-medium text-zinc-300">
                  Vetorizada
                </span>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-3.5">
                <PenTool className="h-5 w-5" />
              </div>

              <h3 className="text-sm font-semibold text-zinc-100">
                Pronta para iniciar a vetorização
              </h3>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-400">
                Revise o perfil selecionado no painel lateral ou abra as configurações avançadas
                para personalizar o resultado.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-2 w-full max-w-xs text-left">
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/70 px-3 py-2">
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
                    Perfil ativo
                  </span>
                  <span className="text-xs font-medium text-zinc-200">{profileObj.label}</span>
                </div>
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/70 px-3 py-2">
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
                    Paleta alvo
                  </span>
                  <span className="font-mono text-xs font-medium text-indigo-300">
                    {advancedSettings.colorCount} cores
                  </span>
                </div>
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/70 px-3 py-2">
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
                    Precisão
                  </span>
                  <span className="font-mono text-xs font-medium text-zinc-200">
                    {advancedSettings.detailPrecision}%
                  </span>
                </div>
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/70 px-3 py-2">
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
                    Suavidade
                  </span>
                  <span className="font-mono text-xs font-medium text-zinc-200">
                    {advancedSettings.curveSmoothness}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ESTADO 4: Processamento em andamento */}
        {isProcessing && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            {/* Original mantida para referência */}
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center min-h-[300px] ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
              </div>

              <div
                className="opacity-80 transition-transform duration-150"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <IllustrativeArtwork
                  variant="raster"
                  customImageUrl={sourceImage?.previewUrl}
                />
              </div>
            </div>

            {/* Painel de progresso na área Vetorizada */}
            <div className="relative rounded-xl border border-indigo-500/30 bg-zinc-950/85 p-6 flex flex-col items-center justify-center min-h-[300px]">
              <div className="absolute top-3 left-3 z-10">
                <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-200">
                  Vetorizada · Em andamento
                </span>
              </div>

              <div className="w-full max-w-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Processamento em andamento
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Gerando geometria vetorial com perfil {profileObj.label}
                    </p>
                  </div>
                </div>

                {/* Barra visual de progresso */}
                <div className="mb-5">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-zinc-400">Progresso ilustrativo</span>
                    <span className="font-mono text-indigo-300">68%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full w-[68%] rounded-full bg-indigo-500 transition-all" />
                  </div>
                </div>

                {/* Etapas visuais */}
                <ul className="space-y-2.5">
                  {PROCESSING_STEPS.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2 text-xs"
                    >
                      {step.status === 'done' && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      )}
                      {step.status === 'active' && (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-400" />
                      )}
                      {step.status === 'pending' && (
                        <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-700" />
                      )}
                      <span
                        className={
                          step.status === 'pending'
                            ? 'text-zinc-500'
                            : step.status === 'active'
                              ? 'font-medium text-zinc-100'
                              : 'text-zinc-300'
                        }
                      >
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ESTADO 6: Erro durante o processamento */}
        {isError && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center min-h-[300px] ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
              </div>

              <div
                className="transition-transform duration-150"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <IllustrativeArtwork
                  variant="raster"
                  customImageUrl={sourceImage?.previewUrl}
                />
              </div>
            </div>

            <div
              role="alert"
              className="relative rounded-xl border border-rose-500/35 bg-rose-950/20 p-6 flex flex-col items-center justify-center text-center min-h-[300px]"
            >
              <div className="absolute top-3 left-3 z-10">
                <span className="rounded-md border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200">
                  Vetorizada · Falha
                </span>
              </div>

              <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/35 bg-rose-500/15 text-rose-400">
                <AlertTriangle className="h-6 w-6" />
              </div>

              <h3 className="text-sm font-semibold text-zinc-100">
                Erro durante o processamento da imagem
              </h3>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-400">
                Não foi possível concluir a leitura e o traçado vetorial deste arquivo. Verifique se
                a imagem não está corrompida ou tente ajustar os parâmetros de sensibilidade.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={onRequestRevectorizeInfo}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-500 transition-colors cursor-pointer"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Vetorizar novamente
                </button>

                <button
                  type="button"
                  onClick={onClearToUpload}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Enviar outra imagem
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ESTADOS 5 e 7: Resultado concluído / Arquivo pronto para download */}
        {hasResult && comparisonMode === 'side_by_side' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            {/* Painel Original */}
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center min-h-[320px] ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
                <span className="rounded border border-zinc-700/70 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                  Bitmap
                </span>
              </div>

              <div
                className="transition-transform duration-150 ease-out"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <IllustrativeArtwork
                  variant="raster"
                  customImageUrl={sourceImage?.previewUrl}
                />
              </div>
            </div>

            {/* Painel Vetorizada */}
            <div
              className={`relative rounded-xl border border-indigo-500/35 overflow-hidden flex items-center justify-center min-h-[320px] ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Vetorizada
                </span>
                <span className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-950/85 px-2 py-0.5 text-[10px] font-medium text-indigo-200">
                  <Sparkles className="h-2.5 w-2.5" />
                  Amostra ilustrativa SVG
                </span>
              </div>

              <div className="absolute top-3 right-3 z-10">
                <button
                  type="button"
                  onClick={() => setShowVectorNodes((prev) => !prev)}
                  className="rounded-md border border-zinc-700/80 bg-zinc-900/85 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  {showVectorNodes ? 'Ocultar nós' : 'Exibir nós'}
                </button>
              </div>

              <div
                className="transition-transform duration-150 ease-out"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <IllustrativeArtwork variant="vector" showVectorNodes={showVectorNodes} />
              </div>
            </div>
          </div>
        )}

        {/* ESTADOS 5 e 7 no modo: Controle deslizante de comparação */}
        {hasResult && comparisonMode === 'slider' && (
          <div className="flex flex-col gap-3 h-full">
            <div
              ref={splitContainerRef}
              onPointerDown={(event) => {
                setIsDraggingSplit(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSplitFromClientX(event.clientX);
              }}
              onPointerMove={(event) => {
                if (isDraggingSplit) {
                  updateSplitFromClientX(event.clientX);
                }
              }}
              onPointerUp={() => setIsDraggingSplit(false)}
              onPointerCancel={() => setIsDraggingSplit(false)}
              className={`relative rounded-xl border border-zinc-800 overflow-hidden min-h-[360px] flex-1 select-none cursor-ew-resize touch-none ${bgClass}`}
            >
              {/* Camada base: Vetorizada (lado direito) */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="transition-transform duration-150 ease-out"
                  style={{ transform: `scale(${zoom / 100})` }}
                >
                  <IllustrativeArtwork variant="vector" showVectorNodes={showVectorNodes} />
                </div>
              </div>

              {/* Camada superior recortada: Original (lado esquerdo) */}
              <div
                className={`absolute inset-0 flex items-center justify-center ${bgClass}`}
                style={{
                  clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`,
                }}
              >
                <div
                  className="transition-transform duration-150 ease-out"
                  style={{ transform: `scale(${zoom / 100})` }}
                >
                  <IllustrativeArtwork
                    variant="raster"
                    customImageUrl={sourceImage?.previewUrl}
                  />
                </div>
              </div>

              {/* Rótulos fixos nos cantos */}
              <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
              </div>

              <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-950/85 px-2 py-1 text-[11px] font-medium text-indigo-200">
                  <Sparkles className="h-3 w-3" />
                  Vetorizada (Ilustrativa)
                </span>
              </div>

              {/* Linha divisória e alça do controle deslizante */}
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.8)]"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-indigo-400 bg-zinc-950 text-indigo-300 shadow-lg">
                  <MoveHorizontal className="h-4 w-4" />
                </div>
              </div>
            </div>

            {/* Controle acessível de posição do divisor */}
            <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3.5 py-2">
              <span className="text-xs font-medium text-zinc-400 shrink-0">Original</span>
              <input
                type="range"
                min={5}
                max={95}
                value={sliderPosition}
                aria-label="Controle deslizante de comparação entre imagem original e vetorizada"
                onChange={(event) => onChangeSliderPosition(Number(event.target.value))}
                className="studio-slider flex-1"
              />
              <span className="text-xs font-medium text-indigo-300 shrink-0">Vetorizada</span>
              <span className="font-mono text-[11px] text-zinc-400 w-10 text-right">
                {sliderPosition}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Rodapé de ações da Área de Resultados (Download SVG + Vetorizar novamente) */}
      <div className="border-t border-zinc-800/80 bg-zinc-950/70 px-4 py-3.5 sm:px-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            {hasResult ? (
              <span>
                Pré-visualização ilustrativa pronta · Perfil{' '}
                <strong className="font-medium text-zinc-200">{profileObj.label}</strong>
              </span>
            ) : isProcessing ? (
              <span>Aguarde a conclusão das etapas de vetorização...</span>
            ) : isError ? (
              <span className="text-rose-300">
                Processamento interrompido. Tente vetorizar novamente ou envie outro arquivo.
              </span>
            ) : isInitial ? (
              <span>Nenhuma imagem selecionada no momento.</span>
            ) : (
              <span>Imagem carregada. Configure os parâmetros e inicie a vetorização.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={isInitial || isProcessing}
              onClick={onRequestRevectorizeInfo}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700/90 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Vetorizar novamente
            </button>

            <button
              type="button"
              disabled={!hasResult}
              onClick={onRequestDownloadInfo}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Download SVG
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
