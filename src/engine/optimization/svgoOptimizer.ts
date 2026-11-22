import { optimize, type Config } from 'svgo/browser';
import type { SvgOptimizationResult } from '../types';

export interface SvgOptimizeSettings {
  /** Casas decimais preservadas nas coordenadas (padrão 4 para máxima fidelidade sub-pixel). */
  floatPrecision?: number;
}

/**
 * Padroniza cabeçalho XML, namespace, dimensões físicas originais, viewBox escalável
 * e IDs sequenciais nos caminhos (<path id="caminho-N">) para compatibilidade integral
 * com Inkscape, Adobe Illustrator, Figma e navegadores.
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

    return `<svg${attrs}>${extraDefsXml}`;
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
 * Preserva 100% da geometria sub-pixel dos caminhos Bézier, <defs> de gradientes nativos,
 * grupos de tipografia e IDs de camadas, sem arredondar alças de curvas quando floatPrecision >= 4.
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
            // Em alta precisão (>= 4), desativa reescrita de comandos d="" para preservar curvas Bézier intactas
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
