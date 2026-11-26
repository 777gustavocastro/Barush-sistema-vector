import React, { useEffect, useRef, useState } from 'react';
import {
  Columns2,
  SplitSquareHorizontal,
  Layers,
  ScanSearch,
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
  ShieldCheck,
  Info,
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

const ZOOM_MIN = 25;
const ZOOM_MAX = 800;

function nextZoomStep(current: number, direction: 'in' | 'out'): number {
  const steps = [25, 50, 75, 100, 150, 200, 300, 400, 600, 800];
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
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(65);
  const [highlightPaths, setHighlightPaths] = useState(false);
  const [detailLoupeEnabled, setDetailLoupeEnabled] = useState(false);
  const [loupeCoords, setLoupeCoords] = useState<{ xPct: number; yPct: number } | null>(null);
  const [showStage2Details, setShowStage2Details] = useState(false);

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

  // Renderiza mapa térmico de diferença de pixels quando o modo 'pixel_diff' está ativo
  useEffect(() => {
    if (comparisonMode !== 'pixel_diff' || !hasResult || !sourceImage || !vectorResult) {
      return;
    }
    const canvas = diffCanvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const w = sourceImage.width;
    const h = sourceImage.height;
    canvas.width = w;
    canvas.height = h;

    const svgBlob = new Blob([vectorResult.svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      if (cancelled) return;
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      const dctx = canvas.getContext('2d');
      if (!octx || !dctx) return;

      octx.drawImage(img, 0, 0, w, h);
      const vecPixels = octx.getImageData(0, 0, w, h).data;
      const origPixels = sourceImage.rgbaImage.data;
      const outImg = dctx.createImageData(w, h);
      const out = outImg.data;

      for (let i = 0; i < origPixels.length; i += 4) {
        const oa = origPixels[i + 3] / 255;
        const va = vecPixels[i + 3] / 255;
        const dr = Math.abs(origPixels[i] * oa - vecPixels[i] * va);
        const dg = Math.abs(origPixels[i + 1] * oa - vecPixels[i + 1] * va);
        const db = Math.abs(origPixels[i + 2] * oa - vecPixels[i + 2] * va);
        const err = Math.min(255, ((dr + dg + db) / 3) * 3.5);

        // Escala visual: azul escuro (0 erro) -> ciano -> amarelo -> vermelho intenso (erro alto)
        out[i] = Math.min(255, Math.max(0, (err - 60) * 2.2));
        out[i + 1] = err < 128 ? err * 1.6 : Math.max(0, 255 - (err - 128) * 2);
        out[i + 2] = Math.max(24, 180 - err * 1.2);
        out[i + 3] = 255;
      }

      dctx.putImageData(outImg, 0, 0);
      URL.revokeObjectURL(svgUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
    };
    img.src = svgUrl;

    return () => {
      cancelled = true;
    };
  }, [comparisonMode, hasResult, sourceImage, vectorResult]);

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
          {/* Título + 4 Modos de Comparação (Seção 10) */}
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2.5">
            <h2
              id="results-area-heading"
              className="text-sm font-semibold text-zinc-100 shrink-0"
            >
              Comparação e Inspeção
            </h2>

            <div
              role="group"
              aria-label="Modo de comparação visual"
              className="inline-flex flex-wrap items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
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
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  comparisonMode === 'slider' && hasResult
                    ? 'bg-zinc-800 text-zinc-100 shadow-2xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <SplitSquareHorizontal className="h-3.5 w-3.5" />
                <span>Deslizante</span>
              </button>

              <button
                type="button"
                data-testid="mode-overlay"
                disabled={!hasResult}
                onClick={() => onChangeComparisonMode('overlay')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  comparisonMode === 'overlay' && hasResult
                    ? 'bg-zinc-800 text-zinc-100 shadow-2xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Sobreposição</span>
              </button>

              <button
                type="button"
                data-testid="mode-pixel-diff"
                disabled={!hasResult}
                onClick={() => onChangeComparisonMode('pixel_diff')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  comparisonMode === 'pixel_diff' && hasResult
                    ? 'bg-zinc-800 text-zinc-100 shadow-2xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <ScanSearch className="h-3.5 w-3.5" />
                <span>Diferença</span>
              </button>
            </div>
          </div>

          {/* Controles de Zoom + Lupa + Caminhos + Fundo */}
          <div className="flex flex-wrap items-center gap-2">
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
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                disabled={isInitial || zoom === 100}
                onClick={() => onChangeZoom(100)}
                className="inline-flex items-center gap-1 rounded-md border-l border-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Maximize2 className="h-3 w-3" />
                <span className="hidden sm:inline">100%</span>
              </button>
            </div>

            <button
              type="button"
              data-testid="toggle-detail-loupe"
              disabled={!hasResult}
              onClick={() => {
                setDetailLoupeEnabled((prev) => !prev);
                setLoupeCoords(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                detailLoupeEnabled && hasResult
                  ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Lupa 4×</span>
            </button>

            <button
              type="button"
              data-testid="toggle-wireframe"
              disabled={!hasResult}
              onClick={() => setHighlightPaths((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                highlightPaths && hasResult
                  ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Waypoints className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Contornos</span>
            </button>

            <div
              role="group"
              aria-label="Cor de fundo da visualização"
              className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
            >
              <button
                type="button"
                data-testid="bg-transparent"
                onClick={() => onChangeBackground('transparent')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  canvasBackground === 'transparent'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="h-3 w-3 rounded-xs border border-zinc-600 bg-checkerboard-light shrink-0" />
                <span className="hidden sm:inline">Transp.</span>
              </button>

              <button
                type="button"
                data-testid="bg-white"
                onClick={() => onChangeBackground('white')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  canvasBackground === 'white'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="h-3 w-3 rounded-xs border border-zinc-400 bg-white shrink-0" />
                <span className="hidden sm:inline">Branco</span>
              </button>

              <button
                type="button"
                data-testid="bg-dark"
                onClick={() => onChangeBackground('dark')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  canvasBackground === 'dark'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="h-3 w-3 rounded-xs border border-zinc-600 bg-zinc-950 shrink-0" />
                <span className="hidden sm:inline">Escuro</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Painel de Validação de Vetorização Real e Métricas Perceptuais (Seção 10 e Seção 11) */}
      {hasResult && vectorResult && (
        <div
          data-testid="svg-ready-banner"
          className="border-b border-emerald-500/25 bg-emerald-950/20 px-4 py-3 sm:px-5 space-y-2.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                <FileCheck2 className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-200">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    SVG 100% Vetorial Validado (Zero Raster)
                  </span>
                  <span className="rounded bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                    {outputSvgFilename}
                  </span>
                  <span className="rounded bg-zinc-900/90 border border-zinc-700/80 px-1.5 py-0.5 text-[10px] text-indigo-200">
                    {vectorResult.selectedCandidateLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-300">
                  Tamanho <strong>{formatBytes(vectorResult.validation.byteLength)}</strong> · Sem{' '}
                  <code>&lt;image&gt;</code>, PNG, JPEG ou Base64 · processado em{' '}
                  {vectorResult.durationMs} ms
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
              Baixar SVG Editável
            </button>
          </div>

          {/* Inventário Estrutural Obrigatório (Seção 11) + Métricas Perceptuais (Seção 10) */}
          <div
            data-testid="vector-structural-metrics"
            className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-9 gap-1.5 text-[11px]"
          >
            <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2.5 py-1.5">
              <span className="block text-[10px] text-zinc-500">Objetos</span>
              <span data-testid="metric-objects" className="font-mono font-semibold text-zinc-100">
                {vectorResult.validation.objectCount}
              </span>
            </div>
            <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2.5 py-1.5">
              <span className="block text-[10px] text-zinc-500">Caminhos</span>
              <span data-testid="metric-paths" className="font-mono font-semibold text-zinc-100">
                {vectorResult.validation.pathCount}
              </span>
            </div>
            <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2.5 py-1.5">
              <span className="block text-[10px] text-zinc-500">Gradientes</span>
              <span data-testid="metric-gradients" className="font-mono font-semibold text-indigo-300">
                {vectorResult.validation.gradientCount}
              </span>
            </div>
            <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2.5 py-1.5">
              <span className="block text-[10px] text-zinc-500">Grupos &lt;g&gt;</span>
              <span data-testid="metric-groups" className="font-mono font-semibold text-zinc-100">
                {vectorResult.validation.groupCount}
              </span>
            </div>
            <div className="rounded-lg bg-zinc-950/80 border border-zinc-800 px-2.5 py-1.5">
              <span className="block text-[10px] text-zinc-500">Dimensões</span>
              <span data-testid="metric-dimensions" className="font-mono font-semibold text-zinc-100">
                {vectorResult.originalWidth}×{vectorResult.originalHeight}
              </span>
            </div>

            {vectorResult.qualityReport && (
              <>
                <div
                  title="SSIM (Structural Similarity Index em janelas 8×8): mede fidelidade estrutural e luminância local (100% = estrutura idêntica)."
                  className="rounded-lg bg-zinc-950/80 border border-emerald-500/25 px-2.5 py-1.5"
                >
                  <span className="block text-[10px] text-zinc-500">SSIM</span>
                  <span data-testid="metric-ssim" className="font-mono font-semibold text-emerald-300">
                    {vectorResult.qualityReport.ssimPct}%
                  </span>
                </div>
                <div
                  title="CIEDE2000 (ΔE₀₀): padrão perceptual internacional ISO/CIE. Valores ΔE₀₀ < 1.0 são imperceptíveis ao olho humano."
                  className="rounded-lg bg-zinc-950/80 border border-emerald-500/25 px-2.5 py-1.5"
                >
                  <span className="block text-[10px] text-zinc-500">Cores (ΔE₀₀)</span>
                  <span data-testid="metric-ciede2000" className="font-mono font-semibold text-emerald-300">
                    {vectorResult.qualityReport.colorFidelityPct}% (ΔE₀₀{' '}
                    {vectorResult.qualityReport.meanDeltaE2000 ?? vectorResult.qualityReport.meanDeltaELab})
                  </span>
                </div>
                <div
                  title="Fidelidade geométrica de contornos (Sobel F1 + Distância média bidirecional de Chamfer em pixels)."
                  className="rounded-lg bg-zinc-950/80 border border-emerald-500/25 px-2.5 py-1.5"
                >
                  <span className="block text-[10px] text-zinc-500">Contornos</span>
                  <span data-testid="metric-contours" className="font-mono font-semibold text-emerald-300">
                    {vectorResult.qualityReport.contourFidelityPct}%
                    {vectorResult.qualityReport.chamferDistancePx !== undefined
                      ? ` (${vectorResult.qualityReport.chamferDistancePx}px)`
                      : ''}
                  </span>
                </div>
                <div
                  title="Sobreposição de silhueta (IoU) e Relação Sinal-Ruído de Pico (PSNR em dB)."
                  className="rounded-lg bg-zinc-950/80 border border-emerald-500/25 px-2.5 py-1.5"
                >
                  <span className="block text-[10px] text-zinc-500">IoU · PSNR</span>
                  <span data-testid="metric-iou-psnr" className="font-mono font-semibold text-emerald-300">
                    {vectorResult.qualityReport.iouPct ?? vectorResult.qualityReport.gradientContinuityPct}% ·{' '}
                    {vectorResult.qualityReport.psnrDb}dB
                  </span>
                </div>
              </>
            )}
          </div>

          {vectorResult.qualityGate && (
            <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/75 px-3 py-2 text-[11px] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-indigo-300">Controle de qualidade</span>
                <span
                  data-testid="quality-gate-status"
                  className={
                    vectorResult.qualityGate.approved
                      ? 'font-mono text-emerald-300'
                      : 'font-mono text-amber-300'
                  }
                >
                  {vectorResult.qualityGate.approved ? 'Aprovado' : 'Revisão'} · confiança{' '}
                  {vectorResult.qualityGate.confidence}
                </span>
              </div>
              <p className="text-zinc-300">{vectorResult.qualityGate.summary}</p>
              <ul className="grid gap-1 text-zinc-400 sm:grid-cols-2">
                <li>1. Visual: {vectorResult.qualityGate.visualFidelity.verdict}</li>
                <li>2. Geometria: {vectorResult.qualityGate.geometricFidelity.verdict}</li>
                <li>3. Fundo: {vectorResult.qualityGate.backgroundIntegrity.verdict}</li>
                <li>4. Preservado: {vectorResult.qualityGate.preservedDetails.join(' ') || '—'}</li>
                <li>5. Perdido: {vectorResult.qualityGate.lostRegions.join(' ') || 'nenhuma região'}</li>
                <li>6. Extra: {vectorResult.qualityGate.extraRegions.join(' ') || 'nenhuma região'}</li>
                <li>7. Contornos: {vectorResult.qualityGate.contourQuality.verdict}</li>
                <li>8. Gradientes: {vectorResult.qualityGate.gradientQuality.verdict}</li>
                <li>9. Zoom: {vectorResult.qualityGate.zoom.verdict}</li>
                <li>10. Edição: {vectorResult.qualityGate.editability.verdict}</li>
              </ul>
              {vectorResult.qualityGate.reviewNotes.length > 0 && (
                <p className="text-amber-200/90">
                  Revisão: {vectorResult.qualityGate.reviewNotes.slice(0, 3).join(' ')}
                </p>
              )}
            </div>
          )}

          {/* Barra de Diagnóstico Científico A vs B vs C e Explicação de Métricas Reais (Prompt 02 Seções 10, 11 e 14) */}
          {vectorResult.qualityReport && (
            <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/75 px-3 py-2 text-[11px] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-zinc-300">
                  <span className="font-semibold text-indigo-300">
                    Auditoria Multiescala Supersampling:
                  </span>
                  {vectorResult.stage2Report?.initialMetricsB &&
                    vectorResult.stage2Report?.finalMetricsC && (
                      <span className="font-mono text-zinc-300">
                        ΔE₀₀ {vectorResult.stage2Report.initialMetricsB.meanDeltaE2000} →{' '}
                        <strong className="text-emerald-300">
                          {vectorResult.stage2Report.finalMetricsC.meanDeltaE2000}
                        </strong>
                        {' · '}
                        Reparos automáticos:{' '}
                        <strong className="text-indigo-200">
                          {vectorResult.stage2Report.appliedRepairs?.length ?? 0}
                        </strong>
                        {' · '}
                        Regiões auditadas:{' '}
                        <strong>{vectorResult.stage2Report.inspectedRegionCount}</strong>
                      </span>
                    )}
                  {vectorResult.qualityReport.hausdorffP99Px !== undefined && (
                    <span className="font-mono text-zinc-400">
                      Hausdorff P99: {vectorResult.qualityReport.hausdorffP99Px}px
                    </span>
                  )}
                  {vectorResult.stage2Report?.contourThicknessConsistencyPct !== undefined && (
                    <span className="font-mono text-emerald-300/90">
                      Espessura: {vectorResult.stage2Report.contourThicknessConsistencyPct}%
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {comparisonMode !== 'pixel_diff' && (
                    <button
                      type="button"
                      onClick={() => onChangeComparisonMode('pixel_diff')}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-200 hover:border-indigo-500/60 hover:text-indigo-200 cursor-pointer"
                    >
                      Ver mapa de diferenças
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="toggle-stage2-report"
                    onClick={() => setShowStage2Details((prev) => !prev)}
                    className="rounded border border-indigo-500/35 bg-indigo-950/40 px-2 py-0.5 text-[10px] font-medium text-indigo-200 hover:bg-indigo-900/40 cursor-pointer"
                  >
                    {showStage2Details ? 'Ocultar guia de métricas' : 'Explicar métricas e regiões'}
                  </button>
                </div>
              </div>

              {showStage2Details && (
                <div
                  data-testid="stage2-detailed-panel"
                  className="border-t border-zinc-800/90 pt-2.5 space-y-2 text-[11px] text-zinc-300"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2">
                      <strong className="text-zinc-100 block">
                        SSIM ({vectorResult.qualityReport.ssimPct}%) &amp; PSNR ({vectorResult.qualityReport.psnrDb} dB)
                      </strong>
                      <span className="text-zinc-400">
                        Medem semelhança estrutural local em blocos 8×8 e relação sinal-ruído real entre a imagem original e o SVG renderizado em supersampling 2×.
                      </span>
                    </div>
                    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2">
                      <strong className="text-zinc-100 block">
                        CIEDE2000 Médio ({vectorResult.qualityReport.meanDeltaE2000 ?? vectorResult.qualityReport.meanDeltaELab}) · P95 ({vectorResult.qualityReport.p95DeltaE2000 ?? '-'})
                      </strong>
                      <span className="text-zinc-400">
                        Diferença perceptual humana ISO/CIE de cor e subtons. Valores abaixo de 1.0 são indistinguíveis a olho nu; P95 expõe desvios localizados.
                      </span>
                    </div>
                    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2">
                      <strong className="text-zinc-100 block">
                        Chamfer ({vectorResult.qualityReport.chamferDistancePx ?? 0}px) · Hausdorff Máx ({vectorResult.qualityReport.hausdorffDistancePx ?? 0}px) · IoU ({vectorResult.qualityReport.iouPct ?? 100}%)
                      </strong>
                      <span className="text-zinc-400">
                        Desvio geométrico médio e máximo dos contornos vetoriais em pixels e índice exato de interseção sobre união (IoU) das máscaras.
                      </span>
                    </div>
                  </div>

                  {vectorResult.stage2Report?.appliedRepairs &&
                    vectorResult.stage2Report.appliedRepairs.length > 0 && (
                      <div className="rounded border border-indigo-500/25 bg-indigo-950/20 p-2">
                        <strong className="text-indigo-200 block mb-1">
                          Correções Automáticas Aplicadas na Etapa 2 ({vectorResult.stage2Report.appliedRepairs.length}):
                        </strong>
                        <ul className="space-y-0.5 text-zinc-300 list-disc list-inside">
                          {vectorResult.stage2Report.appliedRepairs.slice(0, 6).map((rep, idx) => (
                            <li key={idx}>
                              <code className="text-indigo-300">{rep.svgElementId ?? `reg-${rep.affectedRegionId}`}</code>:{' '}
                              {rep.technicalJustification}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {vectorResult.stage2Report?.defects &&
                    vectorResult.stage2Report.defects.length > 0 && (
                      <div className="rounded border border-amber-500/25 bg-amber-950/20 p-2">
                        <strong className="text-amber-200 block mb-1">
                          Regiões com Atenção Localizada ({vectorResult.stage2Report.defects.length}):
                        </strong>
                        <ul className="space-y-0.5 text-amber-100/90 list-disc list-inside">
                          {vectorResult.stage2Report.defects.slice(0, 5).map((def) => (
                            <li key={def.defectId}>
                              [{def.boundingBox.minX},{def.boundingBox.minY}] {def.description} ({def.probableCause})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {vectorResult.technicalLimitationsNote && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-200">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
              <span>{vectorResult.technicalLimitationsNote}</span>
            </div>
          )}
        </div>
      )}

      {/* Palco principal de visualização */}
      <div className="flex-1 bg-studio-dots p-4 sm:p-5 flex flex-col justify-center min-h-[360px] lg:min-h-[430px]">
        {isInitial && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[330px]">
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 p-6 flex flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
                <ImageIcon className="h-5 w-5" />
              </div>
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300">
                Referência Original
              </span>
              <p className="mt-2.5 max-w-xs text-xs leading-relaxed text-zinc-500">
                Usada exclusivamente como referência para reconstrução geométrica e comparação de qualidade.
              </p>
            </div>

            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 p-6 flex flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
                <PenTool className="h-5 w-5" />
              </div>
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300">
                SVG 100% Vetorial Editável
              </span>
              <p className="mt-2.5 max-w-xs text-xs leading-relaxed text-zinc-500">
                Objetos separados, curvas Bézier cúbicas, gradientes nativos e letras convertidas em caminhos.
              </p>
            </div>
          </div>
        )}

        {isLoadedPreProcess && sourceImage && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
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

            <div className="relative rounded-xl border border-zinc-800 bg-zinc-950/75 p-6 flex flex-col items-center justify-center text-center min-h-[320px]">
              <div className="absolute top-3 left-3 z-10">
                <span className="rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-xs font-medium text-zinc-300">
                  SVG Editável
                </span>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-3.5">
                <PenTool className="h-5 w-5" />
              </div>

              <h3 className="text-sm font-semibold text-zinc-100">
                Pronta para reconstrução 100% vetorial
              </h3>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-400">
                Categoria detectada: <strong>{sourceImage.colorAnalysis.categoryLabel}</strong>. O
                resultado conterá apenas caminhos, grupos e gradientes editáveis.
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
                    Curvas Bézier
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
                Reconstruir em SVG Vetorial
              </button>
            </div>
          </div>
        )}

        {isProcessing && sourceImage && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center min-h-[320px] p-4 ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Referência Original
                </span>
              </div>

              <div className="max-w-full max-h-[340px] opacity-80" style={aspectStyle}>
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
                  Reconstruindo Vetores
                </span>
              </div>

              <div className="w-full max-w-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Pipeline de Reconstrução Vetorial
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {progressEvent?.stageLabel ?? 'Inicializando OpenCV e motores Bézier...'}
                    </p>
                  </div>
                </div>

                <div className="mb-5">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-zinc-400">Progresso</span>
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
              <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/35 bg-rose-500/15 text-rose-400">
                <AlertTriangle className="h-6 w-6" />
              </div>

              <h3 className="text-sm font-semibold text-zinc-100">
                Não foi possível concluir a reconstrução
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

        {/* MODO 1: Lado a Lado */}
        {hasResult && sourceImage && vectorResult && comparisonMode === 'side_by_side' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-[380px]">
            <div
              className={`relative rounded-xl border border-zinc-800 overflow-auto flex items-center justify-center min-h-[340px] p-4 ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  Referência Original
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

            <div
              className={`relative rounded-xl border border-indigo-500/40 overflow-auto flex items-center justify-center min-h-[340px] p-4 ${bgClass}`}
            >
              <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 pointer-events-none">
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}
                >
                  SVG Vetorial
                </span>
                <span className="rounded border border-indigo-500/40 bg-indigo-950/85 px-2 py-0.5 text-[10px] font-mono text-indigo-200">
                  {vectorResult.validation.objectCount} objetos · {vectorResult.validation.pathCount} caminhos · {vectorResult.validation.gradientCount} gradientes
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

        {/* MODO 2: Controle Deslizante */}
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
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div
                  className="max-w-full max-h-[360px] w-full h-full flex items-center justify-center transition-transform duration-150 ease-out"
                  style={{ transform: `scale(${zoom / 100})` }}
                >
                  <div className="max-w-full max-h-full" style={aspectStyle}>
                    <RealSvgViewport
                      svgMarkup={vectorResult.svg}
                      highlightPaths={highlightPaths}
                    />
                  </div>
                </div>
              </div>

              <div
                className={`absolute inset-0 flex items-center justify-center p-4 ${bgClass}`}
                style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
              >
                <div
                  className="max-w-full max-h-[360px] w-full h-full flex items-center justify-center transition-transform duration-150 ease-out"
                  style={{ transform: `scale(${zoom / 100})` }}
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

              <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2">
                <span className={`rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur-xs ${badgeStyle}`}>
                  Original ({sourceImage.format})
                </span>
              </div>

              <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2">
                <span className="rounded-md border border-indigo-500/40 bg-indigo-950/85 px-2.5 py-1 text-xs font-medium text-indigo-200">
                  SVG 100% Vetorial ({vectorResult.validation.pathCount} caminhos)
                </span>
              </div>

              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.8)]"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-indigo-400 bg-zinc-950 text-indigo-300 shadow-lg">
                  <MoveHorizontal className="h-4 w-4" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3.5 py-2">
              <span className="text-xs font-medium text-zinc-400 shrink-0">Original</span>
              <input
                type="range"
                data-testid="split-range-input"
                min={2}
                max={98}
                value={sliderPosition}
                aria-label="Controle deslizante de comparação"
                onChange={(event) => onChangeSliderPosition(Number(event.target.value))}
                className="studio-slider flex-1"
              />
              <span className="text-xs font-medium text-indigo-300 shrink-0">SVG Vetorial</span>
              <span className="font-mono text-[11px] text-zinc-400 w-10 text-right">
                {sliderPosition}%
              </span>
            </div>
          </div>
        )}

        {/* MODO 3: Sobreposição Direta com Controle de Opacidade */}
        {hasResult && sourceImage && vectorResult && comparisonMode === 'overlay' && (
          <div className="flex flex-col gap-3 h-full">
            <div
              data-testid="overlay-comparison-stage"
              className={`relative rounded-xl border border-zinc-800 overflow-auto min-h-[360px] flex-1 flex items-center justify-center p-4 ${bgClass}`}
            >
              <div className="pointer-events-none absolute top-3 left-3 z-20">
                <span className="rounded-md border border-indigo-500/40 bg-zinc-950/90 px-2.5 py-1 text-xs font-medium text-indigo-200">
                  Sobreposição: Original × SVG Vetorial ({overlayOpacity}%)
                </span>
              </div>

              <div
                className="relative max-w-full max-h-[360px] transition-transform duration-150 ease-out"
                style={{
                  ...aspectStyle,
                  transform: `scale(${zoom / 100})`,
                }}
              >
                <img
                  src={sourceImage.previewUrl}
                  alt={`Original: ${sourceImage.name}`}
                  className="w-full h-full object-contain block select-none"
                  draggable={false}
                />
                <div
                  className="absolute inset-0"
                  style={{ opacity: overlayOpacity / 100 }}
                >
                  <RealSvgViewport
                    svgMarkup={vectorResult.svg}
                    highlightPaths={highlightPaths}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3.5 py-2">
              <span className="text-xs font-medium text-zinc-400 shrink-0">100% Original</span>
              <input
                type="range"
                data-testid="overlay-opacity-input"
                min={0}
                max={100}
                value={overlayOpacity}
                aria-label="Opacidade do SVG sobre a imagem original"
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="studio-slider flex-1"
              />
              <span className="text-xs font-medium text-indigo-300 shrink-0">100% SVG</span>
              <span className="font-mono text-[11px] text-zinc-400 w-10 text-right">
                {overlayOpacity}%
              </span>
            </div>
          </div>
        )}

        {/* MODO 4: Mapa Térmico de Diferença de Pixels */}
        {hasResult && sourceImage && vectorResult && comparisonMode === 'pixel_diff' && (
          <div className="flex flex-col gap-3 h-full">
            <div
              data-testid="pixel-diff-stage"
              className="relative rounded-xl border border-zinc-800 bg-zinc-950 overflow-auto min-h-[360px] flex-1 flex items-center justify-center p-4"
            >
              <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2">
                <span className="rounded-md border border-indigo-500/40 bg-zinc-900/90 px-2.5 py-1 text-xs font-medium text-zinc-100">
                  Diferença de Pixels Amplificada (Azul = Idêntico · Vermelho = Divergência)
                </span>
              </div>

              <canvas
                ref={diffCanvasRef}
                className="max-w-full max-h-[360px] object-contain transition-transform duration-150 ease-out"
                style={{ transform: `scale(${zoom / 100})` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Rodapé de ações */}
      <div className="border-t border-zinc-800/80 bg-zinc-950/70 px-4 py-3.5 sm:px-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            {hasResult && vectorResult ? (
              hasUnappliedChanges ? (
                <span className="text-amber-300">
                  Parâmetros alterados · clique em <strong>Reconstruir novamente</strong> para
                  atualizar o SVG.
                </span>
              ) : (
                <span>
                  Editável no Adobe Illustrator e Inkscape · ViewBox{' '}
                  <strong className="font-mono text-zinc-200">
                    {vectorResult.validation.viewBox ?? `${vectorResult.originalWidth}×${vectorResult.originalHeight}`}
                  </strong>
                </span>
              )
            ) : isProcessing ? (
              <span>Reconstruindo objetos, curvas Bézier e gradientes localmente...</span>
            ) : isError ? (
              <span className="text-rose-300">
                Processamento interrompido. Ajuste as opções ou tente novamente.
              </span>
            ) : isInitial ? (
              <span>Nenhuma imagem selecionada no momento.</span>
            ) : (
              <span>Imagem pronta para reconstrução em SVG 100% vetorial.</span>
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
              Reconstruir novamente
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
