import type {
  ProgressCallback,
  RawRgbaImage,
  VectorizationParameters,
  VectorizationPipelineResult,
} from '../types';
import type { WorkerVectorizeRequest, WorkerVectorizeResponse } from './vectorizer.worker';
import { runVectorizationOnRgba } from '../vectorizers/pipelineOrchestrator';
import {
  evaluateAndSelectBestCandidate,
  type VectorSvgCandidateInput,
} from '../quality/qualityEvaluator';
import { optimizeVectorSvg } from '../optimization/svgoOptimizer';
import { validateSvgStructure } from '../validation/fileValidator';

export interface AsyncVectorizeOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/**
 * Executa a reconstrução vetorial em Web Worker dedicado no navegador e, ao receber
 * os candidatos vetoriais puros, realiza a avaliação perceptual real (SSIM + CIE ΔE + Contornos)
 * no Canvas nativo do navegador caso o Worker não possua DOM para rasterizar o SVG!
 */
export async function executeVectorizationAsync(
  image: RawRgbaImage,
  params: VectorizationParameters,
  options: AsyncVectorizeOptions = {}
): Promise<VectorizationPipelineResult> {
  const { onProgress, signal } = options;

  if (signal?.aborted) {
    throw new DOMException('Processamento cancelado pelo usuário.', 'AbortError');
  }

  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    const workerOut = await new Promise<{
      result: VectorizationPipelineResult;
      candidates: VectorSvgCandidateInput[];
    }>((resolve, reject) => {
      const worker = new Worker(
        new URL('./vectorizer.worker.ts', import.meta.url),
        { type: 'module' }
      );

      let settled = false;

      const cleanup = () => {
        signal?.removeEventListener('abort', handleAbort);
        worker.terminate();
      };

      const handleAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('Processamento cancelado pelo usuário.', 'AbortError'));
      };

      signal?.addEventListener('abort', handleAbort, { once: true });

      worker.onmessage = (ev: MessageEvent<WorkerVectorizeResponse>) => {
        const msg = ev.data;
        if (!msg) return;

        if (msg.type === 'progress') {
          onProgress?.(msg.event);
          return;
        }

        if (msg.type === 'success') {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({ result: msg.result, candidates: msg.candidates });
          return;
        }

        if (msg.type === 'error') {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (errEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(errEvent.message || 'Falha na execução do worker de vetorização.')
        );
      };

      const transferableCopy = new Uint8Array(image.data.byteLength);
      transferableCopy.set(image.data);

      const request: WorkerVectorizeRequest = {
        type: 'vectorize',
        rgbaBuffer: transferableCopy.buffer,
        width: image.width,
        height: image.height,
        sourceFormat: image.sourceFormat,
        params,
      };

      worker.postMessage(request, [transferableCopy.buffer]);
    });

    // No navegador, avalia todos os candidatos via Canvas real para selecionar o melhor resultado perceptual!
    if (!workerOut.result.qualityReport && workerOut.candidates.length > 0) {
      const { winner, winnerQuality } = await evaluateAndSelectBestCandidate(
        image,
        workerOut.candidates,
        workerOut.result.colorAnalysis.hasTransparency,
        workerOut.result.colorAnalysis.gradientRatio
      );

      const shouldOptimize = params.optimizeSvg !== false;
      const optimization = shouldOptimize
        ? optimizeVectorSvg(winner.svg, {
            floatPrecision: workerOut.result.effectiveParameters.detailPrecision >= 75 ? 4 : 3,
          })
        : null;

      const finalSvg = optimization ? optimization.svg : winner.svg;
      const validation = validateSvgStructure(finalSvg);
      if (!validation.valid || validation.hasEmbeddedRaster) {
        throw new Error(`Falha na validação vetorial estrita: ${validation.errors.join(' ')}`);
      }

      return {
        ...workerOut.result,
        svg: finalSvg,
        rawSvgBeforeOptimization: winner.svg,
        engineUsed: winner.engineKind,
        selectedCandidateLabel: winner.label,
        optimization,
        validation,
        qualityReport: winnerQuality,
        reconstructedGradientCount: validation.gradientCount,
        reconstructedObjectCount: validation.objectCount,
      };
    }

    return workerOut.result;
  }

  return runVectorizationOnRgba(image, params, onProgress);
}
