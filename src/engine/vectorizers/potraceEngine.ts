import type { PotraceOptions } from 'esm-potrace-wasm';
import type { RawRgbaImage, VectorizationParameters } from '../types';
import { binarizeForMonochrome } from '../image-processing/filters';

interface PotraceModule {
  init: () => Promise<void>;
  potrace: (
    source: { data: Uint8ClampedArray; width: number; height: number },
    options?: PotraceOptions
  ) => Promise<string>;
}

let potraceReadyPromise: Promise<PotraceModule> | null = null;

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined'
  );
}

/**
 * Carrega e inicializa o binário WebAssembly do Potrace (esm-potrace-wasm),
 * garantindo compatibilidade tanto no Navegador quanto em Node.js ESM.
 */
async function loadPotraceModule(): Promise<PotraceModule> {
  if (!potraceReadyPromise) {
    potraceReadyPromise = (async () => {
      if (isNodeRuntime()) {
        const modSpec = 'node:module';
        const pathSpec = 'node:path';
        const urlSpec = 'node:url';
        const { createRequire } = await import(/* @vite-ignore */ modSpec);
        const { dirname } = await import(/* @vite-ignore */ pathSpec);
        const { fileURLToPath } = await import(/* @vite-ignore */ urlSpec);

        const g = globalThis as Record<string, unknown>;
        if (!g.require) {
          g.require = createRequire(import.meta.url);
        }
        if (!g.__filename) {
          const currentFile = fileURLToPath(import.meta.url);
          g.__filename = currentFile;
          g.__dirname = dirname(currentFile);
        }
      }

      const mod = (await import('esm-potrace-wasm')) as unknown as PotraceModule;
      await mod.init();
      return mod;
    })();
  }
  return potraceReadyPromise;
}

export function buildPotraceOptions(params: VectorizationParameters): PotraceOptions {
  // turdsize: suprime speckles/ruídos em pixels quadrados
  const turdsize = Math.max(1, Math.round(1 + (params.noiseRemoval / 100) * 16));

  // alphamax: limiar de vértices (0 = polígono puro, 1.334 = sem cantos agudos)
  const alphamax = Number((0.35 + (params.curveSmoothness / 100) * 0.95).toFixed(3));

  // opttolerance: tolerância de simplificação de curvas Bézier (0.1 preciso .. 1.0 simplificado)
  const opttolerance = Number((0.12 + (params.pathSimplification / 100) * 0.68).toFixed(3));

  const useMultiLevelPosterize = params.colorCount > 2 && params.profile !== 'monochrome_logo';

  return {
    turdsize,
    turnpolicy: 4, // POTRACE_TURNPOLICY_MINORITY (ótimo para logos e tipografia)
    alphamax,
    opticurve: params.curveSmoothness >= 15 ? 1 : 0,
    opttolerance,
    pathonly: false,
    extractcolors: useMultiLevelPosterize,
    posterizelevel: useMultiLevelPosterize ? Math.min(8, Math.max(2, Math.round(params.colorCount / 2))) : 2,
    posterizationalgorithm: 0,
  };
}

/**
 * Executa vetorização via Potrace (ideal para imagens monocromáticas, logos e alto contraste).
 */
export async function vectorizeWithPotrace(
  image: RawRgbaImage,
  params: VectorizationParameters
): Promise<string> {
  const potraceMod = await loadPotraceModule();
  const options = buildPotraceOptions(params);

  const prepared =
    options.extractcolors === false
      ? binarizeForMonochrome(image, params.contourSensitivity)
      : image;

  const clamped = new Uint8ClampedArray(
    prepared.data.buffer,
    prepared.data.byteOffset,
    prepared.data.byteLength
  );

  return potraceMod.potrace(
    {
      data: clamped,
      width: prepared.width,
      height: prepared.height,
    },
    options
  );
}
