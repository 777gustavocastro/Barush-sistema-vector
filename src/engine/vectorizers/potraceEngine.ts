import type { PotraceOptions } from 'esm-potrace-wasm';
import type { RawRgbaImage, VectorizationParameters } from '../types';
import { binarizeForMonochromeWithColor } from '../image-processing/filters';

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
  // turdsize: suprime speckles/ruídos em pixels quadrados (preserva detalhes quando noiseRemoval é baixo)
  const turdsize =
    params.noiseRemoval <= 10
      ? 1
      : Math.max(1, Math.round(1 + (params.noiseRemoval / 100) * 16));

  // alphamax: limiar de vértices (0 = polígono puro, 1.334 = sem cantos agudos)
  const alphamax = Number((0.25 + (params.curveSmoothness / 100) * 1.05).toFixed(3));

  // opttolerance: tolerância de simplificação de curvas Bézier (0.08 preciso .. 0.85 simplificado)
  const opttolerance = Number((0.08 + (params.pathSimplification / 100) * 0.75).toFixed(3));

  const useMultiLevelPosterize = params.colorCount > 2 && params.profile !== 'monochrome_logo';

  return {
    turdsize,
    turnpolicy: 4, // POTRACE_TURNPOLICY_MINORITY (ótimo para logos e tipografia)
    alphamax,
    opticurve: params.curveSmoothness >= 12 ? 1 : 0,
    opttolerance,
    pathonly: false,
    extractcolors: useMultiLevelPosterize,
    posterizelevel: useMultiLevelPosterize
      ? Math.min(8, Math.max(2, Math.round(params.colorCount / 2)))
      : 2,
    posterizationalgorithm: 0,
  };
}

/**
 * Executa vetorização via Potrace (ideal para imagens monocromáticas, logos e alto contraste),
 * preservando a cor real predominante da figura monocromática (inclusive branco sobre transparente).
 */
export async function vectorizeWithPotrace(
  image: RawRgbaImage,
  params: VectorizationParameters
): Promise<string> {
  const potraceMod = await loadPotraceModule();
  const options = buildPotraceOptions(params);

  let prepared = image;
  let foregroundHex: string | null = null;

  if (options.extractcolors === false) {
    const binarized = binarizeForMonochromeWithColor(image, params.contourSensitivity);
    prepared = binarized.image;
    foregroundHex = binarized.foregroundHex;
  }

  const clamped = new Uint8ClampedArray(
    prepared.data.buffer,
    prepared.data.byteOffset,
    prepared.data.byteLength
  );

  let svg = await potraceMod.potrace(
    {
      data: clamped,
      width: prepared.width,
      height: prepared.height,
    },
    options
  );

  if (foregroundHex && foregroundHex.toLowerCase() !== '#000000') {
    svg = svg.replace(/fill="#000000"/gi, `fill="${foregroundHex}"`);
  }

  return svg;
}
