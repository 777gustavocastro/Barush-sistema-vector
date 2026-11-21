import { optimize, type Config } from 'svgo/browser';
import type { SvgOptimizationResult } from '../types';

export interface SvgOptimizeSettings {
  /** Casas decimais preservadas nas coordenadas (padrão 3 para alta fidelidade). */
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
  workingHeight: number
): string {
  let svg = rawSvg
    .trim()
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .trim();

  svg = svg.replace(/<svg\b([^>]*)>/i, (_fullMatch, existingAttrs: string) => {
    let attrs = existingAttrs;

    // Preserva viewBox existente (ex.: Potrace) ou define com as dimensões de trabalho
    const hasViewBox = /\bviewBox\s*=\s*["'][^"']+["']/i.test(attrs);
    if (!hasViewBox) {
      attrs += ` viewBox="0 0 ${workingWidth} ${workingHeight}"`;
    }

    // Garante xmlns e version="1.1"
    if (!/\bxmlns\s*=/i.test(attrs)) {
      attrs = ` xmlns="http://www.w3.org/2000/svg"${attrs}`;
    }
    if (!/\bversion\s*=/i.test(attrs)) {
      attrs = ` version="1.1"${attrs}`;
    }

    // Ajusta width e height para a proporção/dimensão real da imagem original enviada
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

    return `<svg${attrs}>`;
  });

  // Garante IDs editáveis e legíveis nos elementos <path> para painéis de camadas do Inkscape / Illustrator
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
 * Configuração conservadora do SVGO projetada especificamente para preservar
 * 100% da fidelidade geométrica dos caminhos (<path>), IDs de camadas, transformações (<g>)
 * e atributo viewBox, removendo apenas metadados redundantes.
 */
export function createFidelityPreservingSvgoConfig(
  settings: SvgOptimizeSettings = {}
): Config {
  const precision = settings.floatPrecision ?? 3;

  return {
    multipass: true,
    plugins: [
      {
        name: 'preset-default',
        params: {
          floatPrecision: precision,
          overrides: {
            // Preserva IDs determinísticos dos caminhos para edição no Inkscape/Illustrator
            cleanupIds: false,
            // Preserva a declaração <?xml ...?> útil para abertura direta em softwares desktop
            removeXMLProcInst: false,
            // Não funde caminhos distintos para manter cada forma/cor separada e editável
            mergePaths: false,
            convertShapeToPath: false,
            // Mantém grupos estruturais com transformações do Potrace/VTracer intactos
            collapseGroups: false,
            convertPathData: {
              floatPrecision: precision,
              transformPrecision: precision + 1,
            },
            cleanupNumericValues: {
              floatPrecision: precision,
            },
            removeHiddenElems: false,
          },
        },
      },
    ],
  };
}

function countSvgPaths(svg: string): number {
  return [...svg.matchAll(/<path\b/gi)].length;
}

/**
 * Otimiza o arquivo SVG gerado garantindo que nenhum caminho vetorial seja perdido.
 */
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
