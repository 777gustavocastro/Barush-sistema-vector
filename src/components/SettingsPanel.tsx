import React from 'react';
import {
  Wand2,
  Sparkles,
  PenTool,
  ChevronDown,
  RotateCcw,
  SlidersHorizontal,
  Play,
  Loader2,
} from 'lucide-react';
import type {
  AdvancedSettings,
  VectorizerProfileId,
  VectorizerUIState,
} from '../types/vectorizer';
import {
  ADVANCED_SETTINGS_META,
  VECTORIZER_PROFILES,
} from '../constants/vectorizerConfig';

interface SettingsPanelProps {
  uiState: VectorizerUIState;
  selectedProfile: VectorizerProfileId;
  advancedSettings: AdvancedSettings;
  isAdvancedOpen: boolean;
  onSelectProfile: (profile: VectorizerProfileId) => void;
  onChangeSetting: (key: keyof AdvancedSettings, value: number) => void;
  onToggleAdvanced: () => void;
  onResetDefaults: () => void;
  onRequestVectorizeInfo: () => void;
}

const PROFILE_ICONS: Record<VectorizerProfileId, React.ReactNode> = {
  auto: <Wand2 className="h-4 w-4" />,
  high_fidelity: <Sparkles className="h-4 w-4" />,
  logo_illustration: <PenTool className="h-4 w-4" />,
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  uiState,
  selectedProfile,
  advancedSettings,
  isAdvancedOpen,
  onSelectProfile,
  onChangeSetting,
  onToggleAdvanced,
  onResetDefaults,
  onRequestVectorizeInfo,
}) => {
  const isInitial = uiState === 'initial';
  const isProcessing = uiState === 'processing';
  const controlsDisabled = isProcessing;

  const activeProfileObj =
    VECTORIZER_PROFILES.find((p) => p.id === selectedProfile) ?? VECTORIZER_PROFILES[0];

  const hasCustomChanges = Object.keys(activeProfileObj.defaults).some((key) => {
    const typedKey = key as keyof AdvancedSettings;
    return advancedSettings[typedKey] !== activeProfileObj.defaults[typedKey];
  });

  return (
    <aside
      aria-labelledby="settings-panel-heading"
      className="w-full lg:w-[350px] xl:w-[376px] shrink-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 flex flex-col overflow-hidden"
    >
      {/* Cabeçalho do painel de configurações */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
          <h2 id="settings-panel-heading" className="text-sm font-semibold text-zinc-100">
            Configurações de Vetorização
          </h2>
        </div>

        {isInitial && (
          <span className="rounded bg-zinc-800/90 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            Aguardando imagem
          </span>
        )}
      </div>

      <div className="flex-1 space-y-5 p-5">
        {/* Seleção de Perfis */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-medium text-zinc-300">Perfil de vetorização</span>
            <span className="text-[11px] text-zinc-500">3 predefinições</span>
          </div>

          <div role="radiogroup" aria-label="Perfis de vetorização" className="space-y-2.5">
            {VECTORIZER_PROFILES.map((profile) => {
              const isSelected = selectedProfile === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={controlsDisabled}
                  onClick={() => onSelectProfile(profile.id)}
                  className={`w-full text-left rounded-xl border p-3.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'border-indigo-500/60 bg-indigo-500/10 shadow-xs'
                      : 'border-zinc-800/90 bg-zinc-950/50 hover:border-zinc-700 hover:bg-zinc-950/80'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                        isSelected
                          ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                      }`}
                    >
                      {PROFILE_ICONS[profile.id]}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm font-medium ${
                            isSelected ? 'text-zinc-100' : 'text-zinc-200'
                          }`}
                        >
                          {profile.label}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isSelected
                              ? 'bg-indigo-500/20 text-indigo-300'
                              : 'bg-zinc-800/80 text-zinc-400'
                          }`}
                        >
                          {profile.shortTag}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        {profile.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Seção recolhível: Configurações avançadas */}
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 overflow-hidden">
          <button
            type="button"
            aria-expanded={isAdvancedOpen}
            aria-controls="advanced-settings-region"
            onClick={onToggleAdvanced}
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-900/60 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-200">
                Configurações avançadas
              </span>
              {hasCustomChanges && (
                <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                  Personalizado
                </span>
              )}
            </div>
            <ChevronDown
              className={`h-4 w-4 text-zinc-400 transition-transform duration-200 ${
                isAdvancedOpen ? 'rotate-180 text-zinc-200' : ''
              }`}
            />
          </button>

          {isAdvancedOpen && (
            <div
              id="advanced-settings-region"
              className="border-t border-zinc-800/80 px-4 py-4 space-y-4"
            >
              {ADVANCED_SETTINGS_META.map((item) => {
                const currentValue = advancedSettings[item.key];
                return (
                  <div key={item.key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`setting-${item.key}`}
                        className="text-xs font-medium text-zinc-300"
                      >
                        {item.label}
                      </label>
                      <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-indigo-300">
                        {currentValue}
                        {item.unit}
                      </span>
                    </div>

                    <input
                      id={`setting-${item.key}`}
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      disabled={controlsDisabled}
                      value={currentValue}
                      onChange={(event) =>
                        onChangeSetting(item.key, Number(event.target.value))
                      }
                      className="studio-slider w-full"
                    />

                    <p className="text-[11px] leading-snug text-zinc-500">
                      {item.description}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Botão para restaurar os padrões */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={onResetDefaults}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 text-zinc-400" />
            Restaurar padrões
          </button>

          <span className="text-[11px] text-zinc-500">
            Perfil: <strong className="font-medium text-zinc-300">{activeProfileObj.label}</strong>
          </span>
        </div>
      </div>

      {/* Rodapé com ação principal de vetorização */}
      <div className="border-t border-zinc-800/80 bg-zinc-950/60 p-4">
        <button
          type="button"
          disabled={isInitial || isProcessing}
          onClick={onRequestVectorizeInfo}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processando vetorização...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 fill-current" />
              Vetorizar imagem
            </>
          )}
        </button>

        {isInitial && (
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            Envie uma imagem na área superior para liberar a ação de vetorização.
          </p>
        )}
      </div>
    </aside>
  );
};
