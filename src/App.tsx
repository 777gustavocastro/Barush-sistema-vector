import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import type {
  AdvancedSettings,
  CanvasBackground,
  ComparisonMode,
  SourceImageInfo,
  VectorizerProfileId,
  VectorizerUIState,
} from './types/vectorizer';
import {
  DEFAULT_ADVANCED_SETTINGS,
  ILLUSTRATIVE_SOURCE_IMAGE,
  VECTORIZER_PROFILES,
} from './constants/vectorizerConfig';
import { Header } from './components/Header';
import { UploadArea } from './components/UploadArea';
import { SettingsPanel } from './components/SettingsPanel';
import { ResultsArea } from './components/ResultsArea';

export function App() {
  const [uiState, setUIState] = useState<VectorizerUIState>('initial');
  const [userImage, setUserImage] = useState<SourceImageInfo | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<VectorizerProfileId>('auto');
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>({
    ...DEFAULT_ADVANCED_SETTINGS,
  });
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('side_by_side');
  const [canvasBackground, setCanvasBackground] = useState<CanvasBackground>('transparent');
  const [zoom, setZoom] = useState<number>(100);
  const [sliderPosition, setSliderPosition] = useState<number>(50);
  const [stageNotice, setStageNotice] = useState<string | null>(null);

  // Libera URL de objeto anterior ao desmontar ou trocar de imagem
  useEffect(() => {
    return () => {
      if (userImage?.previewUrl) {
        URL.revokeObjectURL(userImage.previewUrl);
      }
    };
  }, [userImage]);

  // Define qual imagem exibir nos estados não-iniciais (prioriza arquivo do usuário ou usa amostra ilustrativa)
  const activeSourceImage: SourceImageInfo | null =
    uiState === 'initial' ? null : (userImage ?? ILLUSTRATIVE_SOURCE_IMAGE);

  const handleSelectUIState = (nextState: VectorizerUIState) => {
    setStageNotice(null);
    setUIState(nextState);

    if (nextState === 'settings_ready') {
      setIsAdvancedOpen(true);
    }

    if (nextState !== 'completed' && nextState !== 'ready_for_download') {
      setComparisonMode('side_by_side');
    }
  };

  const handleSelectFile = (fileInfo: SourceImageInfo) => {
    setStageNotice(null);
    setUserImage(fileInfo);
    setZoom(100);
    setUIState('image_loaded');
  };

  const handleClearImage = () => {
    setStageNotice(null);
    setUserImage(null);
    setZoom(100);
    setUIState('initial');
  };

  const handleSelectProfile = (profileId: VectorizerProfileId) => {
    setSelectedProfile(profileId);
    const preset = VECTORIZER_PROFILES.find((item) => item.id === profileId);
    if (preset) {
      setAdvancedSettings({ ...preset.defaults });
    }
  };

  const handleChangeSetting = (key: keyof AdvancedSettings, value: number) => {
    setAdvancedSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleResetDefaults = () => {
    setSelectedProfile('auto');
    setAdvancedSettings({ ...DEFAULT_ADVANCED_SETTINGS });
  };

  const showEtapa1Notice = (context: 'vectorize' | 'download') => {
    if (context === 'vectorize') {
      setStageNotice(
        'Etapa 1 — Interface concluída: o motor real de processamento vetorial será integrado na próxima etapa. Use a barra «Estados da interface» no topo para inspecionar todos os cenários visuais.'
      );
    } else {
      setStageNotice(
        'Etapa 1 — Exportação visual pronta: a geração e o download real do arquivo SVG serão conectados na próxima etapa.'
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <Header uiState={uiState} onSelectUIState={handleSelectUIState} />

      <main className="flex-1 mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-5">
        {/* Aviso informativo discreto quando o usuário aciona botões que dependem da Etapa 2 */}
        {stageNotice && (
          <div
            role="status"
            className="flex items-start sm:items-center justify-between gap-3 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-200"
          >
            <div className="flex items-start sm:items-center gap-2.5">
              <Info className="h-4 w-4 shrink-0 text-indigo-400 mt-0.5 sm:mt-0" />
              <span>{stageNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setStageNotice(null)}
              aria-label="Fechar aviso"
              className="rounded-md p-1 text-indigo-300 hover:bg-indigo-500/20 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 1. ÁREA DE ENVIO */}
        <UploadArea
          uiState={uiState}
          sourceImage={activeSourceImage}
          onSelectFile={handleSelectFile}
          onClearImage={handleClearImage}
        />

        {/* 2. ÁREA DE CONFIGURAÇÕES + 3. ÁREA DE RESULTADOS */}
        <div className="flex flex-col lg:flex-row items-stretch gap-5">
          <SettingsPanel
            uiState={uiState}
            selectedProfile={selectedProfile}
            advancedSettings={advancedSettings}
            isAdvancedOpen={isAdvancedOpen}
            onSelectProfile={handleSelectProfile}
            onChangeSetting={handleChangeSetting}
            onToggleAdvanced={() => setIsAdvancedOpen((prev) => !prev)}
            onResetDefaults={handleResetDefaults}
            onRequestVectorizeInfo={() => showEtapa1Notice('vectorize')}
          />

          <ResultsArea
            uiState={uiState}
            sourceImage={activeSourceImage}
            selectedProfile={selectedProfile}
            advancedSettings={advancedSettings}
            comparisonMode={comparisonMode}
            canvasBackground={canvasBackground}
            zoom={zoom}
            sliderPosition={sliderPosition}
            onChangeComparisonMode={setComparisonMode}
            onChangeBackground={setCanvasBackground}
            onChangeZoom={setZoom}
            onChangeSliderPosition={setSliderPosition}
            onRequestDownloadInfo={() => showEtapa1Notice('download')}
            onRequestRevectorizeInfo={() => showEtapa1Notice('vectorize')}
            onClearToUpload={handleClearImage}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
