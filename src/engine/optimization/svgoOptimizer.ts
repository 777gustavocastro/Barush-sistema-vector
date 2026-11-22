import { optimize, type Config } from 'svgo/browser';
import type { SvgOptimizationResult } from '../types';

export interface SvgOptimizeSettings {
  /** Casas decimais preservadas nas coordenadas (padrão 4 para máxima fidelidade sub-pixel). */
  floatPrecision?: number;
}

/**
 * Padroniza cabeçalho XML, namespace, dimensões físicas originais, viewBox escalável,
 * definições (<defs>) de gradientes/clipPaths e IDs únicos em <path> e <g>, garantindo
 * compatibilidade integral com Adobe Illustrator, Inkscape, Figma e navegadores.
 */
export function normalizeSvgForEditorsAndScaling(
  rawSvg: string,
  originalWidth: number,
  originalHeight: number,
  workingWidth: number,
  workingHeight: number,
  extraDefsXml = '',
  extraOverlayXml = ''
): string {
  let svg = rawSvg
    .trim()
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .trim();

  const defsBlock = extraDefsXml ? `<defs>${extraDefsXml}</defs>` : '';

  svg = svg.replace(/<svg\b([^>]*)>/i, (_fullMatch, existingAttrs: string) => {
    let attrs = existingAttrs;

    const hasViewBox = /\bviewBox\s*=\s*["'][^"']+["']/i.test(attrs);
    if (!hasViewBox) {
      attrs += ` viewBox="0 0 ${workingWidth} ${workingHeight}"`;
    }

    if (!/\bxmlns\s*=/i.test(attrs)) {
      attrs = ` xmlns="http://www.w3.org/2000/svg"${attrs}`;
    }
    if (!/\bversion\s*=/i.test(attrs)) {
      attrs = ` version="1.1"${attrs}`;
    }

    if (/\bwidth\s*=\s*["'][^"']*["']/i.test(attrs)) {
      attrs = attrs.replace(/\bwidth\s*=\s*["'][^"']*["']/i, `width="${originalWidth}"`);
    } else {
      attrs += ` width="${originalWidth}"`;
    }

    if (/\bheight\s*=\s*["'][^"']*["']/i.test(attrs)) {
      attrs = attrs.replace(/\bheight\s*=\s*["'][^"']*["']/i, `height="${originalHeight}"`);
    } else {
      attrs += ` height="${originalHeight}"`;
    }

    if (!/\bpreserveAspectRatio\s*=/i.test(attrs)) {
      attrs += ' preserveAspectRatio="xMidYMid meet"';
    }

    return `<svg${attrs}>${defsBlock}`;
  });

  if (extraOverlayXml) {
    svg = svg.replace(/<\/svg>\s*$/i, `${extraOverlayXml}</svg>`);
  }

  let pathIndex = 0;
  svg = svg.replace(/<path\b([^>]*?)(\/?>)/gi, (full, attrs: string, closeTag: string) => {
    pathIndex++;
    if (/\bid\s*=\s*["'][^"']+["']/i.test(attrs)) {
      return full;
    }
    return `<path id="caminho-${pathIndex}"${attrs}${closeTag}`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${svg}`;
}

/**
 * Configuração ultra-fiel do SVGO:
 * Preserva integralmente os grupos <g id="objeto-N">, gradientes <linearGradient>/<radialGradient>,
 * <clipPath>, opacidade e todas as alças de curvas Bézier cúbicas.
 */
export function createFidelityPreservingSvgoConfig(
  settings: SvgOptimizeSettings = {}
): Config {
  const precision = settings.floatPrecision ?? 4;

  return {
    multipass: false,
    plugins: [
      {
        name: 'preset-default',
        params: {
          floatPrecision: precision,
          overrides: {
            cleanupIds: false,
            removeXMLProcInst: false,
            mergePaths: false,
            convertShapeToPath: false,
            collapseGroups: false,
            removeUselessDefs: false,
            removeHiddenElems: false,
            removeUnknownsAndDefaults: {
              keepDataAttrs: true,
              keepRoleAttr: true,
            },
            convertPathData:
              precision >= 4
                ? false
                : {
                    floatPrecision: precision,
                    transformPrecision: precision + 1,
                  },
            cleanupNumericValues: {
              floatPrecision: precision,
            },
          },
        },
      },
    ],
  };
}

function countSvgPaths(svg: string): number {
  return [...svg.matchAll(/<path\b/gi)].length;
}

export function optimizeVectorSvg(
  rawSvg: string,
  settings: SvgOptimizeSettings = {}
): SvgOptimizationResult {
  const encoder = new TextEncoder();
  const originalBytes = encoder.encode(rawSvg).byteLength;
  const originalPathCount = countSvgPaths(rawSvg);

  const config = createFidelityPreservingSvgoConfig(settings);
  const result = optimize(rawSvg, config);
  const optimizedSvg = result.data;
  const optimizedPathCount = countSvgPaths(optimizedSvg);

  if (originalPathCount > 0 && optimizedPathCount < originalPathCount) {
    return {
      svg: rawSvg,
      originalBytes,
      optimizedBytes: originalBytes,
      savedBytes: 0,
      savedRatio: 0,
      preservedPathCount: originalPathCount,
    };
  }

  const optimizedBytes = encoder.encode(optimizedSvg).byteLength;
  const savedBytes = Math.max(0, originalBytes - optimizedBytes);
  const savedRatio = originalBytes > 0 ? savedBytes / originalBytes : 0;

  return {
    svg: optimizedSvg,
    originalBytes,
    optimizedBytes,
    savedBytes,
    savedRatio,
    preservedPathCount: optimizedPathCount,
  };
}
