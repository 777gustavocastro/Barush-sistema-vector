import type {
  SupportedRasterFormat,
  VectorizationParameters,
  VectorizationPipelineResult,
  VectorizationProgressEvent,
} from '../types';
import { runVectorizationOnRgba } from '../vectorizers/pipelineOrchestrator';

export interface WorkerVectorizeRequest {
  type: 'vectorize';
  rgbaBuffer: ArrayBuffer;
  width: number;
  height: number;
  sourceFormat?: SupportedRasterFormat;
  params: VectorizationParameters;
}

export type WorkerVectorizeResponse =
  | { type: 'progress'; event: VectorizationProgressEvent }
  | { type: 'success'; result: VectorizationPipelineResult }
  | { type: 'error'; message: string };

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerVectorizeRequest>) => void) | null;
  postMessage: (msg: WorkerVectorizeResponse) => void;
};

workerScope.onmessage = async (event: MessageEvent<WorkerVectorizeRequest>) => {
  const payload = event.data;
  if (!payload || payload.type !== 'vectorize') return;

  try {
    const rgbaData = new Uint8Array(payload.rgbaBuffer);
    const result = await runVectorizationOnRgba(
      {
        data: rgbaData,
        width: payload.width,
        height: payload.height,
        sourceFormat: payload.sourceFormat,
      },
      payload.params,
      (progressEvent) => {
        workerScope.postMessage({ type: 'progress', event: progressEvent });
      }
    );

    workerScope.postMessage({ type: 'success', result });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Ocorreu uma falha inesperada durante a vetorização da imagem.';
    workerScope.postMessage({ type: 'error', message });
  }
};
