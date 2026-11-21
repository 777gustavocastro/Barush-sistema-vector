import React from 'react';
import { Layers, ShieldCheck, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { VectorizerUIState } from '../types/vectorizer';

interface HeaderProps {
  uiState: VectorizerUIState;
}

export const Header: React.FC<HeaderProps> = ({ uiState }) => {
  const renderStatusPill = () => {
    switch (uiState) {
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-medium text-indigo-200">
            <Loader2 className="h-3 w-3 animate-spin text-indigo-300" />
            Vetorizando localmente...
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            SVG pronto para download
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/35 bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-200">
            <AlertCircle className="h-3 w-3 text-rose-400" />
            Falha no processamento
          </span>
        );
      case 'image_loaded':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-200">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            Imagem pronta para vetorizar
          </span>
        );
      case 'initial':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            Aguardando imagem
          </span>
        );
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
              <Layers className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-sm font-semibold tracking-tight text-zinc-100 truncate">
                Barush Vector
              </span>
              <span className="hidden sm:inline-block h-3.5 w-px bg-zinc-800" />
              <span className="hidden sm:inline-block text-xs text-zinc-400 truncate">
                Sistema Profissional de Vetorização SVG
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {renderStatusPill()}
            <span
              title="Todo o processamento ocorre localmente no seu dispositivo via WebAssembly, sem envio para servidores externos."
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-zinc-400"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              100% Local · Offline
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
