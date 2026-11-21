import type {
  ProgressCallback,
  RawRgbaImage,
  VectorizationParameters,
  VectorizationPipelineResult,
} from '../types';
import type { WorkerVectorizeRequest, WorkerVectorizeResponse } from './vectorizer.worker';
import { runVectorizationOnRgba } from '../vectorizers/pipelineOrchestrator';

export interface AsyncVectorizeOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/**
 * Executa a vetorização de forma assíncrona em Web Worker dedicado no navegador
 * (mantendo a interface fluida a 60 FPS sem travar a thread principal),
 * com suporte a cancelamento imediato e liberação de memória WASM.
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
    return await new Promise<VectorizationPipelineResult>((resolve, reject) => {
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
          resolve(msg.result);
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

      // Faz cópia isolada do buffer para transferência zero-copy (mantendo o buffer original disponível para re-vetorizações!)
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
  }

  // Ambiente Node.js (testes/CLI)
  return runVectorizationOnRgba(image, params, onProgress);
}
