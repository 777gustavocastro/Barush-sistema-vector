import { optimize, type Config } from 'svgo/browser';
import type { SvgOptimizationResult } from '../types';

export interface SvgOptimizeSettings {
  /** Casas decimais preservadas nas coordenadas (padrão 3 para alta fidelidade). */
  floatPrecision?: number;
}

/**
 * Configuração conservadora do SVGO projetada especificamente para preservar
 * 100% da fidelidade geométrica dos caminhos (<path>), transformações (<g>),
 * camadas de cor e atributo viewBox, removendo apenas metadados redundantes
 * (DOCTYPE, comentários, espaços supérfluos e atributos vazios).
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
            // Não funde caminhos distintos para manter camadas vetoriais editáveis
            mergePaths: false,
            // Não converte primitivas geométricas explicitamente preservadas
            convertShapeToPath: false,
            // Mantém grupos estruturais com transformações do Potrace/VTracer intactos
            collapseGroups: false,
            // Mantém precisão elevada nas coordenadas das curvas Bézier
            convertPathData: {
              floatPrecision: precision,
              transformPrecision: precision + 1,
            },
            cleanupNumericValues: {
              floatPrecision: precision,
            },
            // Nunca remove elementos potencialmente visíveis por heurística de tamanho
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

  // Salvaguarda de integridade: se qualquer <path> for removido acidentalmente, preserva o original
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
