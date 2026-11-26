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
  const turdsize =
    params.noiseRemoval <= 15
      ? 1
      : Math.max(1, Math.round(1 + ((params.noiseRemoval - 15) / 85) * 14));

  const alphamax = Number((0.45 + (params.curveSmoothness / 100) * 0.72).toFixed(3));

  const opttolerance =
    params.pathSimplification <= 12
      ? 0.045
      : Number((0.05 + (params.pathSimplification / 100) * 0.45).toFixed(3));

  return {
    turdsize,
    turnpolicy: 4, // POTRACE_TURNPOLICY_MINORITY
    alphamax,
    opticurve: params.curveSmoothness >= 8 ? 1 : 0,
    opttolerance,
    pathonly: false,
    extractcolors: false,
    posterizelevel: 2,
    posterizationalgorithm: 0,
  };
}

function fmtCoord(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  if (Object.is(r, -0) || r === 0) return '0';
  return Number.isInteger(r) ? String(r) : r.toFixed(3).replace(/\.?0+$/, '');
}

/**
 * Converte um atributo `d` gerado pelo Potrace (que opera em espaço escalado 10x e invertido em Y:
 * `translate(0, maskHeight) scale(0.1, -0.1)`) diretamente para coordenadas absolutas planas
 * no `viewBox` raiz do SVG, sem acúmulo de erro de arredondamento e sem matrizes `scale(0.1,-0.1)`.
 */
export function convertPotracePathDataToRootSpace(
  dAttr: string,
  maskHeight: number,
  offsetX: number,
  offsetY: number,
  scale: number
): string {
  const tokens = dAttr.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return '';

  const toRootX = (px: number) => fmtCoord(offsetX + px * 0.1 * scale);
  const toRootY = (py: number) => fmtCoord(offsetY + (maskHeight - py * 0.1) * scale);

  const out: string[] = [];
  let i = 0;
  let cmd = '';
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const isCmd = (tok: string) => /^[a-zA-Z]$/.test(tok);

  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i++];
    }
    if (!cmd) break;

    switch (cmd) {
      case 'M':
      case 'm': {
        const rel = cmd === 'm';
        let first = true;
        while (i + 1 < tokens.length && !isCmd(tokens[i])) {
          const nx = Number(tokens[i++]);
          const ny = Number(tokens[i++]);
          curX = rel ? curX + nx : nx;
          curY = rel ? curY + ny : ny;
          if (first) {
            startX = curX;
            startY = curY;
            out.push(`M ${toRootX(curX)} ${toRootY(curY)}`);
            first = false;
          } else {
            out.push(`L ${toRootX(curX)} ${toRootY(curY)}`);
          }
        }
        break;
      }
      case 'L':
      case 'l': {
        const rel = cmd === 'l';
        while (i + 1 < tokens.length && !isCmd(tokens[i])) {
          const nx = Number(tokens[i++]);
          const ny = Number(tokens[i++]);
          curX = rel ? curX + nx : nx;
          curY = rel ? curY + ny : ny;
          out.push(`L ${toRootX(curX)} ${toRootY(curY)}`);
        }
        break;
      }
      case 'H':
      case 'h': {
        const rel = cmd === 'h';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const nx = Number(tokens[i++]);
          curX = rel ? curX + nx : nx;
          out.push(`L ${toRootX(curX)} ${toRootY(curY)}`);
        }
        break;
      }
      case 'V':
      case 'v': {
        const rel = cmd === 'v';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const ny = Number(tokens[i++]);
          curY = rel ? curY + ny : ny;
          out.push(`L ${toRootX(curX)} ${toRootY(curY)}`);
        }
        break;
      }
      case 'C':
      case 'c': {
        const rel = cmd === 'c';
        while (i + 5 < tokens.length && !isCmd(tokens[i])) {
          const x1 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y1 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x2 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y2 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          curX = x;
          curY = y;
          out.push(
            `C ${toRootX(x1)} ${toRootY(y1)} ${toRootX(x2)} ${toRootY(y2)} ${toRootX(x)} ${toRootY(y)}`
          );
        }
        break;
      }
      case 'S':
      case 's': {
        const rel = cmd === 's';
        while (i + 3 < tokens.length && !isCmd(tokens[i])) {
          const x2 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y2 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          curX = x;
          curY = y;
          out.push(`S ${toRootX(x2)} ${toRootY(y2)} ${toRootX(x)} ${toRootY(y)}`);
        }
        break;
      }
      case 'Q':
      case 'q': {
        const rel = cmd === 'q';
        while (i + 3 < tokens.length && !isCmd(tokens[i])) {
          const x1 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y1 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          curX = x;
          curY = y;
          out.push(`Q ${toRootX(x1)} ${toRootY(y1)} ${toRootX(x)} ${toRootY(y)}`);
        }
        break;
      }
      case 'Z':
      case 'z': {
        curX = startX;
        curY = startY;
        out.push('Z');
        cmd = '';
        break;
      }
      default: {
        // Ignora token desconhecido com segurança
        i++;
        break;
      }
    }
  }

  return out.join(' ');
}

/**
 * Executa vetorização via Potrace para imagens monocromáticas e P&B,
 * emitindo caminhos Bézier cúbicos planos diretamente no sistema de coordenadas raiz do SVG.
 */
export async function vectorizeWithPotrace(
  image: RawRgbaImage,
  params: VectorizationParameters
): Promise<string> {
  const potraceMod = await loadPotraceModule();
  const options = buildPotraceOptions(params);

  const longest = Math.max(image.width, image.height);
  const shouldUpscale = params.subpixelUpscale !== false && longest <= 900;
  const upscaleFactor = shouldUpscale ? 2 : 1;
  const workingImg = shouldUpscale ? upscaleRgbaCatmullRom(image, 2) : image;

  const binarized = binarizeForMonochromeWithColor(workingImg, params.contourSensitivity);
  const prepared = binarized.image;
  const foregroundHex = binarized.foregroundHex || '#000000';

  const clamped = new Uint8ClampedArray(
    prepared.data.buffer,
    prepared.data.byteOffset,
    prepared.data.byteLength
  );

  const rawSvg = await potraceMod.potrace(
    {
      data: clamped,
      width: prepared.width,
      height: prepared.height,
    },
    options
  );

  const scale = 1 / upscaleFactor;
  const pathRegex = /<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/gi;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = pathRegex.exec(rawSvg)) !== null) {
    const flatD = convertPotracePathDataToRootSpace(match[1], prepared.height, 0, 0, scale);
    if (flatD) {
      paths.push(`<path id="caminho-${idx++}" fill="${foregroundHex}" d="${flatD}"/>`);
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`,
    `  <g id="objeto-1" data-tipo="monocromatico">`,
    ...paths.map((p) => `    ${p}`),
    `  </g>`,
    `</svg>`,
  ].join('\n');
}

/**
 * Traça uma máscara binária (0/1) com Potrace de alta precisão e retorna a lista de atributos `d`
 * de curvas Bézier cúbicas já convertidas para coordenadas planas na raiz do `viewBox` do SVG!
 */
export async function traceMaskToFlatBezierPathData(
  binaryMask: Uint8Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  customOpts?: { alphamax?: number; opttolerance?: number; turdsize?: number }
): Promise<string[]> {
  if (width < 2 || height < 2) return [];

  let hasActive = false;
  for (let i = 0; i < binaryMask.length; i++) {
    if (binaryMask[i]) {
      hasActive = true;
      break;
    }
  }
  if (!hasActive) return [];

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
      alphamax: customOpts?.alphamax ?? 0.92,
      opticurve: 1,
      opttolerance: customOpts?.opttolerance ?? 0.055,
      pathonly: false,
      extractcolors: false,
    }
  );

  const outD: string[] = [];
  const pathRegex = /<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(rawSvg)) !== null) {
    const flatD = convertPotracePathDataToRootSpace(match[1], height, offsetX, offsetY, scale);
    if (flatD) {
      outD.push(flatD);
    }
  }
  return outD;
}

/**
 * Wrapper compatível que retorna um grupo `<g id="...">` contendo `<path>` em coordenadas planas raiz
 * (sem `scale(0.1, -0.1)`), garantindo funcionamento exato de `gradientUnits="userSpaceOnUse"`.
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
  customOpts?: { alphamax?: number; opttolerance?: number; turdsize?: number },
  fillOpacity?: number
): Promise<string> {
  const flatPaths = await traceMaskToFlatBezierPathData(
    binaryMask,
    width,
    height,
    offsetX,
    offsetY,
    scale,
    customOpts
  );
  if (flatPaths.length === 0) return '';

  const opacityAttr =
    fillOpacity !== undefined && fillOpacity < 0.995
      ? ` fill-opacity="${Number(fillOpacity.toFixed(3))}"`
      : '';

  if (flatPaths.length === 1) {
    return `<g id="${groupId}"><path fill="${fillValue}"${opacityAttr} d="${flatPaths[0]}"/></g>`;
  }

  return `<g id="${groupId}">${flatPaths
    .map((d) => `<path fill="${fillValue}"${opacityAttr} d="${d}"/>`)
    .join('')}</g>`;
}
