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
  FileCheck2,
  Upload,
  Search,
  Waypoints,
  Play,
} from 'lucide-react';
import type {
  AdvancedSettings,
  CanvasBackground,
  ComparisonMode,
  SourceImageInfo,
  VectorizationPipelineResult,
  VectorizationProgressEvent,
  VectorizerProfileId,
  VectorizerUIState,
} from '../types/vectorizer';
import { PIPELINE_STAGES_ORDER, VECTORIZER_PROFILES } from '../constants/vectorizerConfig';
import { RealSvgViewport } from './RealSvgViewport';
import { formatBytes } from './UploadArea';

interface ResultsAreaProps {
  uiState: VectorizerUIState;
  sourceImage: SourceImageInfo | null;
  vectorResult: VectorizationPipelineResult | null;
  progressEvent: VectorizationProgressEvent | null;
  errorMessage: string | null;
  hasUnappliedChanges: boolean;
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
  onDownloadSvg: () => void;
  onStartVectorize: () => void;
  onClearToUpload: () => void;
}

const ZOOM_MIN = 50;
const ZOOM_MAX = 600;

function nextZoomStep(current: number, direction: 'in' | 'out'): number {
  const steps = [50, 75, 100, 150, 200, 300, 400, 600];
  if (direction === 'in') {
    return steps.find((s) => s > current) ?? ZOOM_MAX;
  }
  return [...steps].reverse().find((s) => s < current) ?? ZOOM_MIN;
}

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
  vectorResult,
  progressEvent,
  errorMessage,
  hasUnappliedChanges,
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
  onDownloadSvg,
  onStartVectorize,
  onClearToUpload,
}) => {
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [highlightPaths, setHighlightPaths] = useState(false);
  const [detailLoupeEnabled, setDetailLoupeEnabled] = useState(false);
  const [loupeCoords, setLoupeCoords] = useState<{ xPct: number; yPct: number } | null>(null);

  const hasResult = uiState === 'completed' && vectorResult !== null;
  const isProcessing = uiState === 'processing';
  const isError = uiState === 'error';
  const isInitial = uiState === 'initial' || !sourceImage;
  const isLoadedPreProcess = uiState === 'image_loaded' && sourceImage !== null;

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
    const clamped = Math.max(2, Math.min(98, Math.round(pct)));
    onChangeSliderPosition(clamped);
  };

  const handleLoupePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!detailLoupeEnabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    setLoupeCoords({ xPct, yPct });
  };

  const bgClass = getBackgroundClass(canvasBackground);
  const badgeStyle = getLabelBadgeStyle(canvasBackground);

  const activeStageIndex = progressEvent
    ? PIPELINE_STAGES_ORDER.findIndex((s) => s.id === progressEvent.stageId)
    : 0;

  const aspectStyle: React.CSSProperties | undefined = sourceImage
    ? {
        aspectRatio: `${sourceImage.width} / ${sourceImage.height}`,
      }
    : undefined;

  return (
    <section
      aria-labelledby="results-area-heading"
      className="flex-1 min-w-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 flex flex-col overflow-hidden"
    >
      {/* Barra de ferramentas superior */}
      <div className="border-b border-zinc-800/80 bg-zinc-950/50 px-4 py-3 sm:px-5">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          {/* Título + Alternador de comparação */}
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2.5">
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
                data-testid="mode-side-by-side"
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
                data-testid="mode-slider"
                disabled={!hasResult}
                onClick={() => onChangeComparisonMode('slider')}
                title={
                  hasResult
                    ? 'Alternar para controle deslizante de comparação'
                    : 'Disponível após concluir a vetorização'
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

          {/* Controles de Zoom + Lupa de Detalhes + Destacar Caminhos + Fundo */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Zoom */}
            <div
              role="group"
              aria-label="Controles de zoom"
              className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
            >
              <button
                type="button"
                data-testid="zoom-out-button"
                disabled={isInitial || zoom <= ZOOM_MIN}
                onClick={() => onChangeZoom(nextZoomStep(zoom, 'out'))}
                aria-label="Diminuir zoom"
                title="Diminuir zoom"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>

              <span
                data-testid="zoom-readout"
                className="min-w-[52px] text-center font-mono text-xs font-medium text-zinc-200"
              >
                {zoom}%
              </span>

              <button
                type="button"
                data-testid="zoom-in-button"
                disabled={isInitial || zoom >= ZOOM_MAX}
                onClick={() => onChangeZoom(nextZoomStep(zoom, 'in'))}
                aria-label="Aumentar zoom"
                title="Aumentar zoom (até 600%)"
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

            {/* Ampliação dos detalhes (Lupa sincronizada 4x) */}
            <button
              type="button"
              data-testid="toggle-detail-loupe"
              disabled={!hasResult}
              onClick={() => {
                setDetailLoupeEnabled((prev) => !prev);
                setLoupeCoords(null);
              }}
              title="Ampliação dos detalhes (Lupa sincronizada 4× sobre pixels e curvas)"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                detailLoupeEnabled && hasResult
                  ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Lupa 4×</span>
            </button>

            {/* Destacar caminhos vetoriais reais */}
            <button
              type="button"
              data-testid="toggle-wireframe"
              disabled={!hasResult}
              onClick={() => setHighlightPaths((prev) => !prev)}
              title="Destacar os contornos dos caminhos vetoriais editáveis no SVG"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                highlightPaths && hasResult
                  ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Waypoints className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Caminhos</span>
            </button>

            {/* Fundo (Transparente, Branco, Escuro) */}
            <div
              role="group"
              aria-label="Cor de fundo da visualização"
              className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
            >
              <button
                type="button"
                data-testid="bg-transparent"
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
                data-testid="bg-white"
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
                data-testid="bg-dark"
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

      {/* Faixa de resumo do arquivo SVG pronto para download */}
      {hasResult && vectorResult && (
        <div
          data-testid="svg-ready-banner"
          className="border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-3 sm:px-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                <FileCheck2 className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-emerald-200">
                    SVG vetorial validado e pronto
                  </span>
                  <span className="rounded bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                    {outputSvgFilename}
                  </span>
                  <span className="rounded bg-zinc-900/90 border border-zinc-700/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                    {vectorResult.engineUsed === 'potrace' ? 'Potrace WASM' : 'VTracer WASM'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-emerald-200/80">
                  <strong>{vectorResult.validation.pathCount}</strong> caminhos editáveis ·{' '}
                  <strong>{formatBytes(vectorResult.validation.byteLength)}</strong>
                  {vectorResult.optimization && vectorResult.optimization.savedRatio > 0.01 && (
                    <>
                      {' '}
                      (SVGO economizou {(vectorResult.optimization.savedRatio * 100).toFixed(0)}%)
                    </>
                  )}{' '}
                  · processado em {vectorResult.durationMs} ms
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="banner-download-svg-button"
              onClick={onDownloadSvg}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-xs hover:bg-emerald-400 transition-colors cursor-pointer shrink-0"
            >
              <Download className="h-4 w-4" />
              Baixar SVG
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
                A imagem enviada será exibida nesta área para inspeção de resolução, transparência e
                cores originais.
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
                O arquivo SVG real com curvas escaláveis aparecerá aqui com suporte a zoom de até
                600%, lupa 4× e comparação deslizante.
              </p>
            </div>
          </div>
        )}

        {/* ESTADO 2: Imagem carregada aguardando vetorização */}
        {isLoadedPreProcess && sourceImage && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            {/* Quadro Original */}
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-auto flex items-center justify-center min-h-[320px] p-4 ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
                <span className="rounded border border-zinc-700/70 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                  {sourceImage.dimensionsLabel}
                </span>
              </div>

              <div
                className="max-w-full max-h-[340px] transition-transform duration-150 ease-out"
                style={{
                  ...aspectStyle,
                  transform: `scale(${zoom / 100})`,
                }}
              >
                <img
                  src={sourceImage.previewUrl}
                  alt={sourceImage.name}
                  className="w-full h-full object-contain select-none"
                  style={zoom >= 250 ? { imageRendering: 'pixelated' } : undefined}
                  draggable={false}
                />
              </div>
            </div>

            {/* Quadro Vetorizada pronto para iniciar */}
            <div className="relative rounded-xl border border-zinc-800 bg-zinc-950/75 p-6 flex flex-col items-center justify-center text-center min-h-[320px]">
              <div className="absolute top-3 left-3 z-10">
                <span className="rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-xs font-medium text-zinc-300">
                  Vetorizada
                </span>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-3.5">
                <PenTool className="h-5 w-5" />
              </div>

              <h3 className="text-sm font-semibold text-zinc-100">
                Pronta para vetorizar localmente
              </h3>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-400">
                Identificamos <strong>{sourceImage.colorAnalysis.categoryLabel}</strong>. Clique em{' '}
                <strong>Vetorizar imagem</strong> ou ajuste os controles ao lado.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2 w-full max-w-xs text-left">
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

              <button
                type="button"
                onClick={onStartVectorize}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-500 transition-colors cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Vetorizar imagem agora
              </button>
            </div>
          </div>
        )}

        {/* ESTADO 3: Processamento assíncrono em andamento */}
        {isProcessing && sourceImage && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center min-h-[320px] p-4 ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
              </div>

              <div
                className="max-w-full max-h-[340px] opacity-80"
                style={aspectStyle}
              >
                <img
                  src={sourceImage.previewUrl}
                  alt={sourceImage.name}
                  className="w-full h-full object-contain select-none"
                  draggable={false}
                />
              </div>
            </div>

            <div
              data-testid="processing-panel"
              className="relative rounded-xl border border-indigo-500/30 bg-zinc-950/85 p-6 flex flex-col items-center justify-center min-h-[320px]"
            >
              <div className="absolute top-3 left-3 z-10">
                <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-200">
                  Vetorizada · Processando
                </span>
              </div>

              <div className="w-full max-w-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Vetorizando em WebAssembly
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {progressEvent?.stageLabel ?? 'Inicializando motor vetorial local...'}
                    </p>
                  </div>
                </div>

                <div className="mb-5">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-zinc-400">Progresso real</span>
                    <span className="font-mono text-indigo-300">
                      {progressEvent?.percent ?? 8}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-200"
                      style={{ width: `${progressEvent?.percent ?? 8}%` }}
                    />
                  </div>
                </div>

                <ul className="space-y-2">
                  {PIPELINE_STAGES_ORDER.map((stage, idx) => {
                    const status =
                      idx < activeStageIndex
                        ? 'done'
                        : idx === activeStageIndex
                          ? 'active'
                          : 'pending';

                    return (
                      <li
                        key={stage.id}
                        className="flex items-center gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2 text-xs"
                      >
                        {status === 'done' && (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        )}
                        {status === 'active' && (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-400" />
                        )}
                        {status === 'pending' && (
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-700" />
                        )}
                        <span
                          className={
                            status === 'pending'
                              ? 'text-zinc-500'
                              : status === 'active'
                                ? 'font-medium text-zinc-100'
                                : 'text-zinc-300'
                          }
                        >
                          {stage.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ESTADO 4: Erro durante o processamento */}
        {isError && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            {sourceImage && (
              <div
                className={`relative rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center min-h-[320px] p-4 ${bgClass}`}
              >
                <div className="absolute top-3 left-3 z-10">
                  <span
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                  >
                    Original
                  </span>
                </div>

                <div className="max-w-full max-h-[340px]" style={aspectStyle}>
                  <img
                    src={sourceImage.previewUrl}
                    alt={sourceImage.name}
                    className="w-full h-full object-contain select-none"
                    draggable={false}
                  />
                </div>
              </div>
            )}

            <div
              role="alert"
              data-testid="processing-error-panel"
              className="relative rounded-xl border border-rose-500/35 bg-rose-950/20 p-6 flex flex-col items-center justify-center text-center min-h-[320px]"
            >
              <div className="absolute top-3 left-3 z-10">
                <span className="rounded-md border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200">
                  Vetorizada · Erro
                </span>
              </div>

              <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/35 bg-rose-500/15 text-rose-400">
                <AlertTriangle className="h-6 w-6" />
              </div>

              <h3 className="text-sm font-semibold text-zinc-100">
                Não foi possível concluir a vetorização
              </h3>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-300">
                {errorMessage ??
                  'Verifique se o arquivo de imagem está íntegro ou ajuste os parâmetros e tente novamente.'}
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={onStartVectorize}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-500 transition-colors cursor-pointer"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Tentar novamente
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

        {/* ESTADO 5: Resultado concluído — Comparação Lado a Lado */}
        {hasResult && sourceImage && vectorResult && comparisonMode === 'side_by_side' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            {/* Painel Original */}
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-auto flex items-center justify-center min-h-[340px] p-4 ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original
                </span>
                <span className="rounded border border-zinc-700/70 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                  {sourceImage.format} · {sourceImage.dimensionsLabel}
                </span>
              </div>

              <div
                onPointerMove={handleLoupePointerMove}
                onPointerLeave={() => setLoupeCoords(null)}
                className={`relative max-w-full max-h-[360px] transition-transform duration-150 ease-out ${
                  detailLoupeEnabled ? 'cursor-crosshair' : ''
                }`}
                style={{
                  ...aspectStyle,
                  transform: `scale(${zoom / 100})`,
                }}
              >
                <img
                  src={sourceImage.previewUrl}
                  alt={`Original: ${sourceImage.name}`}
                  className="w-full h-full object-contain block select-none"
                  style={zoom >= 250 ? { imageRendering: 'pixelated' } : undefined}
                  draggable={false}
                />

                {/* Lupa 4x sincronizada na Original */}
                {detailLoupeEnabled && loupeCoords && (
                  <div
                    className={`pointer-events-none absolute z-30 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-indigo-400 shadow-2xl overflow-hidden ${bgClass}`}
                    style={{
                      left: `${loupeCoords.xPct}%`,
                      top: `${loupeCoords.yPct}%`,
                    }}
                  >
                    <div
                      className="w-full h-full"
                      style={{
                        transform: 'scale(4)',
                        transformOrigin: `${loupeCoords.xPct}% ${loupeCoords.yPct}%`,
                      }}
                    >
                      <img
                        src={sourceImage.previewUrl}
                        alt=""
                        className="w-full h-full object-contain block"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Painel Vetorizada (SVG Real no DOM) */}
            <div
              className={`relative rounded-xl border border-indigo-500/40 overflow-auto flex items-center justify-center min-h-[340px] p-4 ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 pointer-events-none">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Vetorizada
                </span>
                <span className="rounded border border-indigo-500/40 bg-indigo-950/85 px-2 py-0.5 text-[10px] font-mono text-indigo-200">
                  SVG Vetorial · {vectorResult.validation.pathCount} caminhos
                </span>
              </div>

              <div
                onPointerMove={handleLoupePointerMove}
                onPointerLeave={() => setLoupeCoords(null)}
                className={`relative max-w-full max-h-[360px] transition-transform duration-150 ease-out ${
                  detailLoupeEnabled ? 'cursor-crosshair' : ''
                }`}
                style={{
                  ...aspectStyle,
                  transform: `scale(${zoom / 100})`,
                }}
              >
                <RealSvgViewport
                  svgMarkup={vectorResult.svg}
                  highlightPaths={highlightPaths}
                />

                {/* Lupa 4x sincronizada no SVG Real */}
                {detailLoupeEnabled && loupeCoords && (
                  <div
                    className={`pointer-events-none absolute z-30 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-400 shadow-2xl overflow-hidden ${bgClass}`}
                    style={{
                      left: `${loupeCoords.xPct}%`,
                      top: `${loupeCoords.yPct}%`,
                    }}
                  >
                    <div
                      className="w-full h-full"
                      style={{
                        transform: 'scale(4)',
                        transformOrigin: `${loupeCoords.xPct}% ${loupeCoords.yPct}%`,
                      }}
                    >
                      <RealSvgViewport
                        svgMarkup={vectorResult.svg}
                        highlightPaths={highlightPaths}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ESTADO 5: Resultado concluído — Controle Deslizante de Comparação */}
        {hasResult && sourceImage && vectorResult && comparisonMode === 'slider' && (
          <div className="flex flex-col gap-3 h-full">
            <div
              ref={splitContainerRef}
              data-testid="split-comparison-stage"
              onPointerDown={(event) => {
                setIsDraggingSplit(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSplitFromClientX(event.clientX);
              }}
              onPointerMove={(event) => {
                if (isDraggingSplit) {
                  updateSplitFromClientX(event.clientX);
                }
                handleLoupePointerMove(event);
              }}
              onPointerUp={() => setIsDraggingSplit(false)}
              onPointerCancel={() => setIsDraggingSplit(false)}
              onPointerLeave={() => setLoupeCoords(null)}
              className={`relative rounded-xl border border-zinc-800 overflow-hidden min-h-[360px] flex-1 select-none cursor-ew-resize touch-none ${bgClass}`}
            >
              {/* Camada base: SVG Vetorial Real (lado direito) */}
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div
                  className="max-w-full max-h-[360px] w-full h-full flex items-center justify-center transition-transform duration-150 ease-out"
                  style={{
                    transform: `scale(${zoom / 100})`,
                  }}
                >
                  <div className="max-w-full max-h-full" style={aspectStyle}>
                    <RealSvgViewport
                      svgMarkup={vectorResult.svg}
                      highlightPaths={highlightPaths}
                    />
                  </div>
                </div>
              </div>

              {/* Camada superior recortada: Imagem Original (lado esquerdo) */}
              <div
                className={`absolute inset-0 flex items-center justify-center p-4 ${bgClass}`}
                style={{
                  clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`,
                }}
              >
                <div
                  className="max-w-full max-h-[360px] w-full h-full flex items-center justify-center transition-transform duration-150 ease-out"
                  style={{
                    transform: `scale(${zoom / 100})`,
                  }}
                >
                  <div className="max-w-full max-h-full" style={aspectStyle}>
                    <img
                      src={sourceImage.previewUrl}
                      alt={`Original: ${sourceImage.name}`}
                      className="w-full h-full object-contain block select-none"
                      style={zoom >= 250 ? { imageRendering: 'pixelated' } : undefined}
                      draggable={false}
                    />
                  </div>
                </div>
              </div>

              {/* Rótulos fixos nos cantos */}
              <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Original ({sourceImage.format})
                </span>
              </div>

              <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2">
                <span className="rounded-md border border-indigo-500/40 bg-indigo-950/85 px-2.5 py-1 text-xs font-medium text-indigo-200">
                  SVG Vetorial ({vectorResult.validation.pathCount} caminhos)
                </span>
              </div>

              {/* Linha divisória e alça */}
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.8)]"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-indigo-400 bg-zinc-950 text-indigo-300 shadow-lg">
                  <MoveHorizontal className="h-4 w-4" />
                </div>
              </div>
            </div>

            {/* Controle acessível do divisor */}
            <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3.5 py-2">
              <span className="text-xs font-medium text-zinc-400 shrink-0">Original</span>
              <input
                type="range"
                data-testid="split-range-input"
                min={2}
                max={98}
                value={sliderPosition}
                aria-label="Controle deslizante de comparação entre imagem original e SVG vetorizado"
                onChange={(event) => onChangeSliderPosition(Number(event.target.value))}
                className="studio-slider flex-1"
              />
              <span className="text-xs font-medium text-indigo-300 shrink-0">SVG Vetorizado</span>
              <span className="font-mono text-[11px] text-zinc-400 w-10 text-right">
                {sliderPosition}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Rodapé de ações da Área de Resultados */}
      <div className="border-t border-zinc-800/80 bg-zinc-950/70 px-4 py-3.5 sm:px-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            {hasResult && vectorResult ? (
              hasUnappliedChanges ? (
                <span className="text-amber-300">
                  Parâmetros alterados · clique em <strong>Vetorizar novamente</strong> para
                  atualizar o resultado.
                </span>
              ) : (
                <span>
                  Compatível com Inkscape e Illustrator · Proporção{' '}
                  <strong className="font-mono text-zinc-200">
                    {vectorResult.originalWidth}×{vectorResult.originalHeight}
                  </strong>
                  {vectorResult.wasDownscaled && (
                    <span className="text-zinc-500">
                      {' '}
                      (otimizada em {vectorResult.workingWidth}×{vectorResult.workingHeight})
                    </span>
                  )}
                </span>
              )
            ) : isProcessing ? (
              <span>Processamento local assíncrono em execução...</span>
            ) : isError ? (
              <span className="text-rose-300">
                Processamento interrompido. Ajuste as opções ou tente novamente.
              </span>
            ) : isInitial ? (
              <span>Nenhuma imagem selecionada no momento.</span>
            ) : (
              <span>Imagem analisada e pronta para conversão em SVG vetorial.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              data-testid="revectorize-button"
              disabled={isInitial || isProcessing}
              onClick={onStartVectorize}
              className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                hasUnappliedChanges && hasResult
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  : 'border-zinc-700/90 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Vetorizar novamente
            </button>

            <button
              type="button"
              data-testid="download-svg-button"
              disabled={!hasResult}
              onClick={onDownloadSvg}
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
