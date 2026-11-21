import React from 'react';
import { Layers, Eye } from 'lucide-react';
import type { VectorizerUIState } from '../types/vectorizer';
import { UI_STATE_OPTIONS } from '../constants/vectorizerConfig';

interface HeaderProps {
  uiState: VectorizerUIState;
  onSelectUIState: (state: VectorizerUIState) => void;
}

export const Header: React.FC<HeaderProps> = ({ uiState, onSelectUIState }) => {
  const currentOption = UI_STATE_OPTIONS.find((item) => item.id === uiState);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        {/* Linha principal de identidade */}
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
                Estúdio de Vetorização de Imagens
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              Protótipo Visual · Etapa 1
            </span>
          </div>
        </div>

        {/* Barra de inspeção dos estados visuais da interface */}
        <div className="border-t border-zinc-900 py-2.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs text-zinc-400 shrink-0">
            <Eye className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <span className="font-medium text-zinc-300">Estados da interface:</span>
            {currentOption && (
              <span className="hidden xl:inline text-zinc-500">
                — {currentOption.description}
              </span>
            )}
          </div>

          <nav
            aria-label="Navegação entre estados visuais do protótipo"
            className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 no-scrollbar"
          >
            {UI_STATE_OPTIONS.map((option) => {
              const isActive = option.id === uiState;
              const isError = option.id === 'error';

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectUIState(option.id)}
                  title={`${option.label}: ${option.description}`}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer border ${
                    isActive
                      ? isError
                        ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                        : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                      : 'border-zinc-800/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <span
                    className={`font-mono text-[10px] ${
                      isActive
                        ? isError
                          ? 'text-rose-300'
                          : 'text-indigo-300'
                        : 'text-zinc-500'
                    }`}
                  >
                    {option.stepNumber}.
                  </span>
                  <span>{option.shortLabel}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};
