import type { PotraceOptions } from 'esm-potrace-wasm';
import type { RawRgbaImage, VectorizationParameters } from '../types';
import {
  binarizeForMonochromeWithColor,
  upscaleRgbaCatmullRom,
} from '../image-processing/filters';

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
  // turdsize=1 preserva pequenos pontos, acentos, serifas e extremidades finas
  const turdsize =
    params.noiseRemoval <= 15
      ? 1
      : Math.max(1, Math.round(1 + ((params.noiseRemoval - 15) / 85) * 14));

  // alphamax equilibrado para preservar tanto cantos reais quanto curvas suaves
  const alphamax = Number((0.45 + (params.curveSmoothness / 100) * 0.72).toFixed(3));

  // opttolerance baixo (0.04..0.45) para máxima precisão geométrica das curvas Bézier
  const opttolerance =
    params.pathSimplification <= 12
      ? 0.045
      : Number((0.05 + (params.pathSimplification / 100) * 0.45).toFixed(3));

  return {
    turdsize,
    turnpolicy: 4, // POTRACE_TURNPOLICY_MINORITY (excelente para tipografia e pontas)
    alphamax,
    opticurve: params.curveSmoothness >= 8 ? 1 : 0,
    opttolerance,
    pathonly: false,
    extractcolors: false, // Potrace é usado exclusivamente em modo monocromático puro de alta precisão
    posterizelevel: 2,
    posterizationalgorithm: 0,
  };
}

/**
 * Executa vetorização via Potrace exclusivamente para imagens monocromáticas e desenhos P&B,
 * utilizando super-amostragem bicúbica em imagens pequenas/médias para curvas sub-pixel perfeitas.
 */
export async function vectorizeWithPotrace(
  image: RawRgbaImage,
  params: VectorizationParameters
): Promise<string> {
  const potraceMod = await loadPotraceModule();
  const options = buildPotraceOptions(params);

  const longest = Math.max(image.width, image.height);
  const workingImg =
    params.subpixelUpscale !== false && longest <= 900
      ? upscaleRgbaCatmullRom(image, 2)
      : image;

  const binarized = binarizeForMonochromeWithColor(workingImg, params.contourSensitivity);
  const prepared = binarized.image;
  const foregroundHex = binarized.foregroundHex;

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

/**
 * Traça uma máscara binária (0/1) com Potrace de alta precisão e retorna um grupo <g> posicionado
 * com o preenchimento desejado (cor sólida ou referência url(#gradiente) nativa do SVG).
 */
export async function traceMaskWithPotraceToSvgElements(
  binaryMask: Uint8Array,
  width: number,
  height: number,
  fillValue: string,
  offsetX: number,
  offsetY: number,
  scale: number,
  groupId: string,
  customOpts?: { alphamax?: number; opttolerance?: number; turdsize?: number }
): Promise<string> {
  if (width < 2 || height < 2) return '';

  let hasActive = false;
  for (let i = 0; i < binaryMask.length; i++) {
    if (binaryMask[i]) {
      hasActive = true;
      break;
    }
  }
  if (!hasActive) return '';

  const potraceMod = await loadPotraceModule();
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < binaryMask.length; i++) {
    const val = binaryMask[i] ? 0 : 255;
    const idx = i * 4;
    rgba[idx] = val;
    rgba[idx + 1] = val;
    rgba[idx + 2] = val;
    rgba[idx + 3] = 255;
  }

  const rawSvg = await potraceMod.potrace(
    { data: rgba, width, height },
    {
      turdsize: customOpts?.turdsize ?? 1,
      turnpolicy: 4,
      alphamax: customOpts?.alphamax ?? 0.88,
      opticurve: 1,
      opttolerance: customOpts?.opttolerance ?? 0.05,
      pathonly: false,
      extractcolors: false,
    }
  );

  const innerMatch = rawSvg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!innerMatch) return '';

  let inner = innerMatch[1].trim();
  if (!/<path\b/i.test(inner)) return '';

  inner = inner.replace(/fill="#000000"/gi, `fill="${fillValue}"`);
  if (!/\bfill\s*=/i.test(inner)) {
    inner = `<g fill="${fillValue}">${inner}</g>`;
  }

  const tx = Number(offsetX.toFixed(3));
  const ty = Number(offsetY.toFixed(3));
  const sc = Number(scale.toFixed(6));

  const transformAttr =
    tx === 0 && ty === 0 && sc === 1
      ? ''
      : sc === 1
        ? ` transform="translate(${tx},${ty})"`
        : ` transform="translate(${tx},${ty}) scale(${sc})"`;

  return `<g id="${groupId}"${transformAttr}>${inner}</g>`;
}
