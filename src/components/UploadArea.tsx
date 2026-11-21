import React, { useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Upload,
  X,
  RefreshCw,
  AlertCircle,
  Sparkles,
  SlidersHorizontal,
  Download,
} from 'lucide-react';
import type { AcceptedFormat, SourceImageInfo, VectorizerUIState } from '../types/vectorizer';
import { ACCEPTED_FORMATS, ACCEPTED_MIME_TYPES } from '../constants/vectorizerConfig';

interface UploadAreaProps {
  uiState: VectorizerUIState;
  sourceImage: SourceImageInfo | null;
  onSelectFile: (info: SourceImageInfo) => void;
  onClearImage: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function resolveAcceptedFormat(file: File): AcceptedFormat | null {
  const mimeMatch = ACCEPTED_MIME_TYPES[file.type.toLowerCase()];
  if (mimeMatch) {
    if (file.name.toLowerCase().endsWith('.jpeg')) return 'JPEG';
    return mimeMatch;
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'PNG';
  if (ext === 'jpg') return 'JPG';
  if (ext === 'jpeg') return 'JPEG';
  if (ext === 'webp') return 'WebP';
  return null;
}

export const UploadArea: React.FC<UploadAreaProps> = ({
  uiState,
  sourceImage,
  onSelectFile,
  onClearImage,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);

  const isProcessing = uiState === 'processing';
  const isInitial = uiState === 'initial' || !sourceImage;

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || isProcessing) return;
    const file = files[0];
    const detectedFormat = resolveAcceptedFormat(file);

    if (!detectedFormat) {
      setFormatError(
        'Formato de arquivo não aceito. Selecione uma imagem nos formatos PNG, JPG, JPEG ou WebP.'
      );
      return;
    }

    setFormatError(null);
    const previewUrl = URL.createObjectURL(file);
    const img = new window.Image();

    img.onload = () => {
      onSelectFile({
        name: file.name,
        format: detectedFormat,
        sizeLabel: formatBytes(file.size),
        dimensionsLabel: `${img.naturalWidth} × ${img.naturalHeight} px`,
        previewUrl,
        isIllustrative: false,
      });
    };

    img.onerror = () => {
      onSelectFile({
        name: file.name,
        format: detectedFormat,
        sizeLabel: formatBytes(file.size),
        dimensionsLabel: 'Dimensões não identificadas',
        previewUrl,
        isIllustrative: false,
      });
    };

    img.src = previewUrl;
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isProcessing) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const triggerFileDialog = () => {
    if (!isProcessing) {
      fileInputRef.current?.click();
    }
  };

  return (
    <section aria-labelledby="upload-area-heading" className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {isInitial ? (
        /* Estado inicial: Área principal de arrastar e soltar com orientação clara */
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            {/* Zona de arrastar e soltar */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={triggerFileDialog}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  triggerFileDialog();
                }
              }}
              className={`flex-1 rounded-xl border-2 border-dashed px-6 py-6 sm:py-7 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isDragging
                  ? 'border-indigo-400 bg-indigo-500/10'
                  : 'border-zinc-700/80 bg-zinc-950/60 hover:border-zinc-600 hover:bg-zinc-950/90'
              }`}
            >
              <div className="mx-auto flex max-w-lg flex-col items-center text-center">
                <div
                  className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border transition-colors ${
                    isDragging
                      ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-300'
                      : 'border-zinc-800 bg-zinc-900 text-indigo-400'
                  }`}
                >
                  <ImageIcon className="h-6 w-6" />
                </div>

                <h1
                  id="upload-area-heading"
                  className="text-base sm:text-lg font-semibold text-zinc-100"
                >
                  Arraste e solte sua imagem aqui para começar
                </h1>

                <p className="mt-1.5 text-sm text-zinc-400">
                  Envie logotipos, ilustrações, ícones ou artes digitais para preparar a vetorização
                  em curvas escaláveis.
                </p>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      triggerFileDialog();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors cursor-pointer"
                  >
                    <Upload className="h-4 w-4" />
                    Selecionar imagem
                  </button>
                </div>

                {/* Formatos aceitos */}
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <span className="text-xs text-zinc-500">Formatos aceitos:</span>
                  {ACCEPTED_FORMATS.map((fmt) => (
                    <span
                      key={fmt}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-300"
                    >
                      {fmt}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Orientação sobre como iniciar para usuários iniciantes */}
            <div className="lg:w-80 xl:w-96 shrink-0 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Como iniciar
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Fluxo direto em três passos simples:
              </p>

              <ol className="mt-4 space-y-3.5">
                <li className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-indigo-400">
                    <Upload className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-200">1. Envie sua imagem</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Arraste um arquivo PNG, JPG, JPEG ou WebP ou clique em selecionar imagem.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-indigo-400">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-200">2. Escolha o perfil</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Use o modo Automático ou personalize cores, curvas e precisão dos detalhes.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-indigo-400">
                    <Download className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-200">3. Compare e baixe em SVG</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Inspecione o resultado lado a lado ou com controle deslizante antes de baixar.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          </div>

          {formatError && (
            <div
              role="alert"
              className="mt-4 flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{formatError}</span>
            </div>
          )}
        </div>
      ) : (
        /* Barra compacta de envio quando já existe imagem carregada (mantém drag & drop e troca rápida) */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-xl border px-4 py-3 transition-all ${
            isDragging
              ? 'border-indigo-400 bg-indigo-500/10'
              : 'border-zinc-800/90 bg-zinc-900/60'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden text-indigo-400">
                {sourceImage.previewUrl ? (
                  <img
                    src={sourceImage.previewUrl}
                    alt={sourceImage.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1
                    id="upload-area-heading"
                    className="text-sm font-medium text-zinc-100 truncate max-w-[240px] sm:max-w-xs md:max-w-md"
                  >
                    {sourceImage.name}
                  </h1>
                  <span className="rounded border border-zinc-700/80 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-300">
                    {sourceImage.format}
                  </span>
                  {sourceImage.isIllustrative && (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      <Sparkles className="h-2.5 w-2.5" />
                      Amostra ilustrativa
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-400 font-mono">
                  {sourceImage.dimensionsLabel} · {sourceImage.sizeLabel}
                  <span className="hidden md:inline font-sans text-zinc-500">
                    {' '}
                    · Arraste outra imagem PNG, JPG, JPEG ou WebP para substituir
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isProcessing}
                onClick={triggerFileDialog}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-800/70 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Selecionar imagem
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={onClearImage}
                title="Remover imagem e voltar à tela inicial"
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Remover</span>
              </button>
            </div>
          </div>

          {formatError && (
            <div
              role="alert"
              className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
              <span>{formatError}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
