import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdvancedSettings,
  CanvasBackground,
  ComparisonMode,
  SourceImageInfo,
  VectorizationPipelineResult,
  VectorizationProgressEvent,
  VectorizerProfileId,
  VectorizerUIState,
} from './types/vectorizer';
import {
  DEFAULT_ADVANCED_SETTINGS,
  VECTORIZER_PROFILES,
} from './constants/vectorizerConfig';
import {
  buildSvgExportArtifact,
  createSvgBlob,
  executeVectorizationAsync,
  TempResourceManager,
  validateSvgStructure,
} from './engine';
import { Header } from './components/Header';
import { UploadArea } from './components/UploadArea';
import { SettingsPanel } from './components/SettingsPanel';
import { ResultsArea } from './components/ResultsArea';

export function App() {
  const tempManagerRef = useRef<TempResourceManager>(new TempResourceManager());
  const abortControllerRef = useRef<AbortController | null>(null);

  const [uiState, setUIState] = useState<VectorizerUIState>('initial');
  const [sourceImage, setSourceImage] = useState<SourceImageInfo | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<VectorizerProfileId>('auto');
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>({
    ...DEFAULT_ADVANCED_SETTINGS,
  });
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('side_by_side');
  const [canvasBackground, setCanvasBackground] = useState<CanvasBackground>('transparent');
  const [zoom, setZoom] = useState<number>(100);
  const [sliderPosition, setSliderPosition] = useState<number>(50);

  const [vectorResult, setVectorResult] = useState<VectorizationPipelineResult | null>(null);
  const [progressEvent, setProgressEvent] = useState<VectorizationProgressEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasUnappliedChanges, setHasUnappliedChanges] = useState<boolean>(false);

  useEffect(() => {
    const tempManager = tempManagerRef.current;
    return () => {
      abortControllerRef.current?.abort();
      tempManager.disposeAll();
    };
  }, []);

  const handleSelectFile = useCallback(
    (file: File, decoded: Omit<SourceImageInfo, 'previewUrl'>) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      if (sourceImage?.previewUrl) {
        tempManagerRef.current.revokeObjectUrl(sourceImage.previewUrl);
      }

      const previewUrl = tempManagerRef.current.registerObjectUrl(file);
      const nextSource: SourceImageInfo = {
        ...decoded,
        previewUrl,
      };

      setSourceImage(nextSource);
      setVectorResult(null);
      setProgressEvent(null);
      setErrorMessage(null);
      setHasUnappliedChanges(false);
      setZoom(100);
      setComparisonMode('side_by_side');

      if (selectedProfile === 'auto') {
        setAdvancedSettings({ ...decoded.colorAnalysis.recommendedParameters });
      }

      setUIState('image_loaded');
    },
    [selectedProfile, sourceImage?.previewUrl]
  );

  const handleBeginFileDecode = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSourceImage(null);
    setVectorResult(null);
    setProgressEvent(null);
    setErrorMessage(null);
    setUIState('initial');
  }, []);

  const handleClearImage = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (sourceImage?.previewUrl) {
      tempManagerRef.current.revokeObjectUrl(sourceImage.previewUrl);
    }

    setSourceImage(null);
    setVectorResult(null);
    setProgressEvent(null);
    setErrorMessage(null);
    setHasUnappliedChanges(false);
    setZoom(100);
    setComparisonMode('side_by_side');
    setUIState('initial');
  }, [sourceImage?.previewUrl]);

  const handleSelectProfile = (profileId: VectorizerProfileId) => {
    setSelectedProfile(profileId);
    if (profileId === 'auto' && sourceImage) {
      setAdvancedSettings({ ...sourceImage.colorAnalysis.recommendedParameters });
    } else {
      const preset = VECTORIZER_PROFILES.find((item) => item.id === profileId);
      if (preset) {
        setAdvancedSettings({ ...preset.defaults });
      }
    }

    if (uiState === 'completed') {
      setHasUnappliedChanges(true);
    }
  };

  const handleChangeSetting = (key: keyof AdvancedSettings, value: number) => {
    setAdvancedSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
    if (uiState === 'completed') {
      setHasUnappliedChanges(true);
    }
  };

  const handleResetDefaults = () => {
    setSelectedProfile('auto');
    if (sourceImage) {
      setAdvancedSettings({ ...sourceImage.colorAnalysis.recommendedParameters });
    } else {
      setAdvancedSettings({ ...DEFAULT_ADVANCED_SETTINGS });
    }
    if (uiState === 'completed') {
      setHasUnappliedChanges(true);
    }
  };

  const handleCancelVectorize = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setProgressEvent(null);
    setUIState(vectorResult ? 'completed' : sourceImage ? 'image_loaded' : 'initial');
  }, [sourceImage, vectorResult]);

  const handleStartVectorize = useCallback(async () => {
    if (!sourceImage) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorMessage(null);
    setUIState('processing');
    setProgressEvent({
      stageId: 'analyze',
      stageLabel: 'Etapa A: Inicializando análise OpenCV e reconstrução vetorial...',
      percent: 8,
    });

    try {
      const result = await executeVectorizationAsync(
        sourceImage.rgbaImage,
        {
          profile: selectedProfile,
          engine: 'auto',
          autoTune: false,
          reconstructGradients: true,
          enhanceTypography: true,
          subpixelUpscale: true,
          colorCount: advancedSettings.colorCount,
          detailPrecision: advancedSettings.detailPrecision,
          curveSmoothness: advancedSettings.curveSmoothness,
          pathSimplification: advancedSettings.pathSimplification,
          noiseRemoval: advancedSettings.noiseRemoval,
          contourSensitivity: advancedSettings.contourSensitivity,
          optimizeSvg: true,
        },
        {
          signal: controller.signal,
          onProgress: (ev) => setProgressEvent(ev),
        }
      );

      if (controller.signal.aborted) return;

      setVectorResult(result);
      setHasUnappliedChanges(false);
      setProgressEvent(null);
      setUIState('completed');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Erro inesperado durante a reconstrução vetorial da imagem.';
      setErrorMessage(msg);
      setProgressEvent(null);
      setUIState('error');
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [advancedSettings, selectedProfile, sourceImage]);

  const handleDownloadSvg = useCallback(() => {
    if (!vectorResult || !sourceImage) return;

    const validation = validateSvgStructure(vectorResult.svg);
    if (!validation.valid || validation.hasEmbeddedRaster) {
      setErrorMessage(
        `O arquivo SVG foi bloqueado na validação anti-raster pré-download: ${validation.errors.join(' ')}`
      );
      setUIState('error');
      return;
    }

    const artifact = buildSvgExportArtifact(vectorResult.svg, sourceImage.name);
    const blob = createSvgBlob(artifact);
    const downloadUrl = tempManagerRef.current.registerObjectUrl(blob);

    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = artifact.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    window.setTimeout(() => {
      tempManagerRef.current.revokeObjectUrl(downloadUrl);
    }, 5000);
  }, [sourceImage, vectorResult]);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <Header uiState={uiState} />

      <main className="flex-1 mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-5">
        <UploadArea
          uiState={uiState}
          sourceImage={sourceImage}
          onSelectFile={handleSelectFile}
          onClearImage={handleClearImage}
          onBeginFileDecode={handleBeginFileDecode}
        />

        <div className="flex flex-col lg:flex-row items-stretch gap-5">
          <SettingsPanel
            uiState={uiState}
            sourceImage={sourceImage}
            selectedProfile={selectedProfile}
            advancedSettings={advancedSettings}
            isAdvancedOpen={isAdvancedOpen}
            hasUnappliedChanges={hasUnappliedChanges}
            onSelectProfile={handleSelectProfile}
            onChangeSetting={handleChangeSetting}
            onToggleAdvanced={() => setIsAdvancedOpen((prev) => !prev)}
            onResetDefaults={handleResetDefaults}
            onStartVectorize={() => void handleStartVectorize()}
            onCancelVectorize={handleCancelVectorize}
          />

          <ResultsArea
            uiState={uiState}
            sourceImage={sourceImage}
            vectorResult={vectorResult}
            progressEvent={progressEvent}
            errorMessage={errorMessage}
            hasUnappliedChanges={hasUnappliedChanges}
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
            onDownloadSvg={handleDownloadSvg}
            onStartVectorize={() => void handleStartVectorize()}
            onClearToUpload={handleClearImage}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
