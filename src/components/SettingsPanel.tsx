import React from 'react';
import {
  Wand2,
  Sparkles,
  PenTool,
  ChevronDown,
  RotateCcw,
  SlidersHorizontal,
  Play,
  Square,
  Cpu,
  ShieldCheck,
} from 'lucide-react';
import type {
  AdvancedSettings,
  SourceImageInfo,
  VectorizerProfileId,
  VectorizerUIState,
} from '../types/vectorizer';
import {
  ADVANCED_SETTINGS_META,
  VECTORIZER_PROFILES,
} from '../constants/vectorizerConfig';

interface SettingsPanelProps {
  uiState: VectorizerUIState;
  sourceImage: SourceImageInfo | null;
  selectedProfile: VectorizerProfileId;
  advancedSettings: AdvancedSettings;
  isAdvancedOpen: boolean;
  hasUnappliedChanges: boolean;
  onSelectProfile: (profile: VectorizerProfileId) => void;
  onChangeSetting: (key: keyof AdvancedSettings, value: number) => void;
  onToggleAdvanced: () => void;
  onResetDefaults: () => void;
  onStartVectorize: () => void;
  onCancelVectorize: () => void;
}

const PROFILE_ICONS: Record<VectorizerProfileId, React.ReactNode> = {
  auto: <Wand2 className="h-4 w-4" />,
  high_fidelity: <Sparkles className="h-4 w-4" />,
  logo_illustration: <PenTool className="h-4 w-4" />,
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  uiState,
  sourceImage,
  selectedProfile,
  advancedSettings,
  isAdvancedOpen,
  hasUnappliedChanges,
  onSelectProfile,
  onChangeSetting,
  onToggleAdvanced,
  onResetDefaults,
  onStartVectorize,
  onCancelVectorize,
}) => {
  const isInitial = uiState === 'initial' || !sourceImage;
  const isProcessing = uiState === 'processing';
  const controlsDisabled = isProcessing;

  const activeProfileObj =
    VECTORIZER_PROFILES.find((p) => p.id === selectedProfile) ?? VECTORIZER_PROFILES[0];

  const baselineDefaults =
    selectedProfile === 'auto' && sourceImage
      ? sourceImage.colorAnalysis.recommendedParameters
      : activeProfileObj.defaults;

  const hasCustomChanges = Object.keys(baselineDefaults).some((key) => {
    const typedKey = key as keyof AdvancedSettings;
    return advancedSettings[typedKey] !== baselineDefaults[typedKey];
  });

  const analysis = sourceImage?.colorAnalysis ?? null;

  return (
    <aside
      aria-labelledby="settings-panel-heading"
      className="w-full lg:w-[350px] xl:w-[380px] shrink-0 rounded-2xl border border-zinc-800/90 bg-zinc-900/50 flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
          <h2 id="settings-panel-heading" className="text-sm font-semibold text-zinc-100">
            Reconstrução Vetorial
          </h2>
        </div>

        {isInitial && (
          <span className="rounded bg-zinc-800/90 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            Aguardando imagem
          </span>
        )}
      </div>

      <div className="flex-1 space-y-5 p-5">
        {/* Selo permanente de Vetor 100% Editável e Zero Raster */}
        <div
          data-testid="pure-vector-guarantee"
          className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3.5 py-2.5 flex items-start gap-2.5"
        >
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed text-zinc-300">
            <strong className="font-semibold text-emerald-200 block">
              SVG 100% Vetorial Editável (Zero Raster)
            </strong>
            Objetos separados (<code className="text-emerald-300">&lt;g&gt;</code>), curvas Bézier,
            gradientes nativos e letras em caminhos para Illustrator e Inkscape.
          </div>
        </div>

        {/* Diagnóstico da Inteligência de Imagem */}
        {analysis && (
          <div
            data-testid="image-intelligence-card"
            className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-200">
                <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                Diagnóstico OpenCV
              </span>
              <span className="rounded bg-indigo-500/20 px-2 py-0.5 font-mono text-[10px] font-medium text-indigo-200">
                {analysis.isMonochromeCandidate ? 'Bézier Mono' : 'OpenCV + Bézier + VTracer'}
              </span>
            </div>

            <p className="text-xs text-zinc-200 font-medium">{analysis.categoryLabel}</p>

            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <div className="rounded bg-zinc-950/70 border border-zinc-800/80 px-2 py-1">
                <span className="block text-[10px] text-zinc-500">Complexidade</span>
                <span className="font-mono text-zinc-200">{analysis.complexityScore}/100</span>
              </div>
              <div className="rounded bg-zinc-950/70 border border-zinc-800/80 px-2 py-1">
                <span className="block text-[10px] text-zinc-500">Degradês</span>
                <span className="font-mono text-zinc-200">
                  {Math.round(analysis.gradientRatio * 100)}%
                </span>
              </div>
              <div className="rounded bg-zinc-950/70 border border-zinc-800/80 px-2 py-1">
                <span className="block text-[10px] text-zinc-500">Tipografia</span>
                <span className="font-mono text-zinc-200">
                  {analysis.typographyRegions.length > 0
                    ? `${analysis.typographyRegions.length} reg.`
                    : 'Auto'}
                </span>
              </div>
            </div>

            {analysis.dominantHexColors.length > 0 && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[10px] text-zinc-500 mr-1">Tons principais:</span>
                {analysis.dominantHexColors.slice(0, 6).map((hex, i) => (
                  <span
                    key={`${hex}-${i}`}
                    title={hex}
                    className="h-3.5 w-3.5 rounded-full border border-zinc-700 shadow-2xs"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Perfis de Reconstrução */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-medium text-zinc-300">Perfil de reconstrução</span>
            <span className="text-[11px] text-zinc-500">3 perfis</span>
          </div>

          <div role="radiogroup" aria-label="Perfis de reconstrução" className="space-y-2.5">
            {VECTORIZER_PROFILES.map((profile) => {
              const isSelected = selectedProfile === profile.id;
              return (
                <button
                  key={profile.id}
                  data-testid={`profile-${profile.id}`}
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

        {/* Configurações avançadas */}
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 overflow-hidden">
          <button
            type="button"
            data-testid="toggle-advanced-settings"
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
                      <span
                        data-testid={`value-${item.key}`}
                        className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-indigo-300"
                      >
                        {currentValue}
                        {item.unit}
                      </span>
                    </div>

                    <input
                      id={`setting-${item.key}`}
                      data-testid={`slider-${item.key}`}
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

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            data-testid="reset-defaults-button"
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

      <div className="border-t border-zinc-800/80 bg-zinc-950/60 p-4 space-y-2">
        {isProcessing ? (
          <button
            type="button"
            data-testid="cancel-vectorize-button"
            onClick={onCancelVectorize}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/25 transition-colors cursor-pointer"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Cancelar processamento
          </button>
        ) : (
          <button
            type="button"
            data-testid="start-vectorize-button"
            disabled={isInitial}
            onClick={onStartVectorize}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Play className="h-4 w-4 fill-current" />
            {uiState === 'completed'
              ? hasUnappliedChanges
                ? 'Aplicar ajustes e reconstruir'
                : 'Reconstruir novamente'
              : 'Reconstruir em SVG Vetorial'}
          </button>
        )}

        {isInitial && (
          <p className="text-center text-[11px] text-zinc-500">
            Envie uma imagem na área superior para liberar a reconstrução vetorial.
          </p>
        )}

        {uiState === 'completed' && hasUnappliedChanges && (
          <p className="text-center text-[11px] text-amber-300/90">
            Parâmetros alterados. Clique acima para reconstruir um novo SVG editável.
          </p>
        )}
      </div>
    </aside>
  );
};
