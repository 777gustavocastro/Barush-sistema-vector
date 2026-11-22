import type {
  CandidateEvaluationSummary,
  QualityComparisonReport,
  RawRgbaImage,
} from '../types';
import { validateSvgStructure } from '../validation/fileValidator';

function isNodeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) &&
    typeof window === 'undefined'
  );
}

/**
 * Rasteriza o SVG gerado exatamente nas dimensões (width x height) da imagem original
 * em memória temporária APENAS para avaliação comparativa de qualidade (jamais incorporado ao SVG!).
 */
export async function rasterizeSvgAtExactSize(
  svgMarkup: string,
  targetWidth: number,
  targetHeight: number,
  opaqueBackgroundRgb?: [number, number, number]
): Promise<RawRgbaImage | null> {
  if (isNodeRuntime()) {
    try {
      const resvgPkg = '@resvg/resvg-js';
      const { Resvg } = await import(/* @vite-ignore */ resvgPkg);
      const bgStr = opaqueBackgroundRgb
        ? `rgb(${opaqueBackgroundRgb[0]}, ${opaqueBackgroundRgb[1]}, ${opaqueBackgroundRgb[2]})`
        : undefined;
      const resvg = new Resvg(svgMarkup, {
        fitTo: { mode: 'width', value: targetWidth },
        ...(bgStr ? { background: bgStr } : {}),
      });
      const rendered = resvg.render();
      return {
        width: rendered.width,
        height: rendered.height,
        data: new Uint8Array(
          rendered.pixels.buffer,
          rendered.pixels.byteOffset,
          rendered.pixels.byteLength
        ),
      };
    } catch {
      return null;
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      return await new Promise<RawRgbaImage>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Contexto 2D indisponível'));
            return;
          }
          if (opaqueBackgroundRgb) {
            ctx.fillStyle = `rgb(${opaqueBackgroundRgb[0]}, ${opaqueBackgroundRgb[1]}, ${opaqueBackgroundRgb[2]})`;
            ctx.fillRect(0, 0, targetWidth, targetHeight);
          }
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
          resolve({
            width: targetWidth,
            height: targetHeight,
            data: new Uint8Array(imgData.data.buffer),
          });
        };
        img.onerror = () => reject(new Error('Falha ao renderizar SVG para comparação'));
        img.src = url;
      });
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return null;
}

function srgbToLab(r8: number, g8: number, b8: number): [number, number, number] {
  let r = r8 / 255;
  let g = g8 / 255;
  let b = b8 / 255;

  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Calcula métricas perceptuais e estruturais completas (Seção 10):
 * 1) SSIM (Structural Similarity Index em janelas 8x8)
 * 2) Diferença perceptual de cores CIE ΔE76 no espaço Lab
 * 3) Fidelidade estrutural de contornos (Sobel F1 com tolerância 1px)
 * 4) Análise de continuidade de gradientes (penaliza faixas de posterização/banding)
 * 5) Semelhança global de pixels e PSNR
 */
export function computeQualityComparisonFromBuffers(
  original: RawRgbaImage,
  renderedSvg: RawRgbaImage
): QualityComparisonReport {
  const width = Math.min(original.width, renderedSvg.width);
  const height = Math.min(original.height, renderedSvg.height);
  const totalPixels = Math.max(1, width * height);

  let absDiffSum = 0;
  let sqDiffSum = 0;

  const origLum = new Float32Array(width * height);
  const vecLum = new Float32Array(width * height);

  // Amostragem perceptual CIE Lab (passo adaptativo para manter tempo < 8 ms)
  const labStep = Math.max(1, Math.floor(Math.sqrt(totalPixels / 16000)));
  let deltaESum = 0;
  let deltaECount = 0;

  for (let y = 0; y < height; y++) {
    const sampleLabRow = y % labStep === 0;
    for (let x = 0; x < width; x++) {
      const oIdx = (y * original.width + x) * 4;
      const vIdx = (y * renderedSvg.width + x) * 4;

      const oa = original.data[oIdx + 3] / 255;
      const va = renderedSvg.data[vIdx + 3] / 255;

      // Compõe sobre fundo branco neutro quando translúcido para comparação perceptual consistente
      const or = original.data[oIdx] * oa + 255 * (1 - oa);
      const og = original.data[oIdx + 1] * oa + 255 * (1 - oa);
      const ob = original.data[oIdx + 2] * oa + 255 * (1 - oa);

      const vr = renderedSvg.data[vIdx] * va + 255 * (1 - va);
      const vg = renderedSvg.data[vIdx + 1] * va + 255 * (1 - va);
      const vb = renderedSvg.data[vIdx + 2] * va + 255 * (1 - va);

      const dr = Math.abs(or - vr);
      const dg = Math.abs(og - vg);
      const db = Math.abs(ob - vb);
      const da = Math.abs(original.data[oIdx + 3] - renderedSvg.data[vIdx + 3]);

      absDiffSum += dr + dg + db + da;
      sqDiffSum += dr * dr + dg * dg + db * db + da * da;

      const pIdx = y * width + x;
      origLum[pIdx] = 0.299 * or + 0.587 * og + 0.114 * ob;
      vecLum[pIdx] = 0.299 * vr + 0.587 * vg + 0.114 * vb;

      if (sampleLabRow && x % labStep === 0) {
        const [ol, oaLab, obLab] = srgbToLab(or, og, ob);
        const [vl, vaLab, vbLab] = srgbToLab(vr, vg, vb);
        const de = Math.hypot(ol - vl, oaLab - vaLab, obLab - vbLab);
        deltaESum += de;
        deltaECount++;
      }
    }
  }

  const mae = absDiffSum / (totalPixels * 4);
  const mse = sqDiffSum / (totalPixels * 4);
  const psnrDb =
    mse <= 1e-6 ? 60 : Math.min(60, Number((10 * Math.log10((255 * 255) / mse)).toFixed(2)));
  const pixelSimilarityPct = Number(Math.max(0, Math.min(100, (1 - mae / 255) * 100)).toFixed(2));

  const meanDeltaELab = deltaECount > 0 ? Number((deltaESum / deltaECount).toFixed(2)) : 0;
  const colorFidelityPct = Number(
    Math.max(0, Math.min(100, (1 - meanDeltaELab / 48) * 100)).toFixed(2)
  );

  // 1. SSIM real em blocos 8x8 (Wang et al.)
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const blockSize = 8;
  let ssimSum = 0;
  let ssimBlocks = 0;

  for (let by = 0; by + blockSize <= height; by += blockSize) {
    for (let bx = 0; bx + blockSize <= width; bx += blockSize) {
      let sumX = 0, sumY = 0;
      const n = blockSize * blockSize;
      for (let dy = 0; dy < blockSize; dy++) {
        const row = (by + dy) * width + bx;
        for (let dx = 0; dx < blockSize; dx++) {
          sumX += origLum[row + dx];
          sumY += vecLum[row + dx];
        }
      }
      const muX = sumX / n;
      const muY = sumY / n;

      let varX = 0, varY = 0, covXY = 0;
      for (let dy = 0; dy < blockSize; dy++) {
        const row = (by + dy) * width + bx;
        for (let dx = 0; dx < blockSize; dx++) {
          const ux = origLum[row + dx] - muX;
          const uy = vecLum[row + dx] - muY;
          varX += ux * ux;
          varY += uy * uy;
          covXY += ux * uy;
        }
      }
      varX /= n - 1;
      varY /= n - 1;
      covXY /= n - 1;

      const ssimBlock =
        ((2 * muX * muY + c1) * (2 * covXY + c2)) /
        ((muX * muX + muY * muY + c1) * (varX + varY + c2));
      ssimSum += ssimBlock;
      ssimBlocks++;
    }
  }

  const ssimPct =
    ssimBlocks > 0
      ? Number(Math.max(0, Math.min(100, (ssimSum / ssimBlocks) * 100)).toFixed(2))
      : pixelSimilarityPct;

  // 2. Comparação de contornos (Sobel F1 com tolerância de 1px) + Continuidade de Gradientes
  const origEdges = new Uint8Array(width * height);
  const vecEdges = new Uint8Array(width * height);
  const edgeThresh = 26;
  let origEdgeCount = 0;
  let vecEdgeCount = 0;

  let smoothGradPixels = 0;
  let smoothGradConsistent = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const ogx = origLum[idx + 1] - origLum[idx - 1];
      const ogy = origLum[idx + width] - origLum[idx - width];
      const oMag = Math.abs(ogx) + Math.abs(ogy);

      const vgx = vecLum[idx + 1] - vecLum[idx - 1];
      const vgy = vecLum[idx + width] - vecLum[idx - width];
      const vMag = Math.abs(vgx) + Math.abs(vgy);

      if (oMag >= edgeThresh) {
        origEdges[idx] = 1;
        origEdgeCount++;
      }
      if (vMag >= edgeThresh) {
        vecEdges[idx] = 1;
        vecEdgeCount++;
      }

      // Zona de transição suave (gradiente real na imagem original: 1.2 <= oMag < 18)
      if (oMag >= 1.2 && oMag < 18) {
        smoothGradPixels++;
        // Penaliza degrau artificial de posterização (vMag >> oMag)
        if (Math.abs(vMag - oMag) <= 10) {
          smoothGradConsistent++;
        }
      }
    }
  }

  let matchedOrig = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (!origEdges[idx]) continue;
      if (
        vecEdges[idx] ||
        vecEdges[idx - 1] ||
        vecEdges[idx + 1] ||
        vecEdges[idx - width] ||
        vecEdges[idx + width] ||
        vecEdges[idx - width - 1] ||
        vecEdges[idx - width + 1] ||
        vecEdges[idx + width - 1] ||
        vecEdges[idx + width + 1]
      ) {
        matchedOrig++;
      }
    }
  }

  let matchedVec = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (!vecEdges[idx]) continue;
      if (
        origEdges[idx] ||
        origEdges[idx - 1] ||
        origEdges[idx + 1] ||
        origEdges[idx - width] ||
        origEdges[idx + width] ||
        origEdges[idx - width - 1] ||
        origEdges[idx - width + 1] ||
        origEdges[idx + width - 1] ||
        origEdges[idx + width + 1]
      ) {
        matchedVec++;
      }
    }
  }

  const recall = origEdgeCount > 0 ? matchedOrig / origEdgeCount : 1;
  const precision = vecEdgeCount > 0 ? matchedVec / vecEdgeCount : 1;
  const contourF1 =
    recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 1;
  const contourFidelityPct = Number((contourF1 * 100).toFixed(2));

  const gradientContinuityPct =
    smoothGradPixels >= 25
      ? Number(((smoothGradConsistent / smoothGradPixels) * 100).toFixed(2))
      : 100;

  return {
    ssimPct,
    pixelSimilarityPct,
    psnrDb,
    contourFidelityPct,
    colorFidelityPct,
    meanDeltaELab,
    gradientContinuityPct,
    meanAbsoluteError: Number(mae.toFixed(2)),
  };
}

export async function evaluateSvgVisualQuality(
  original: RawRgbaImage,
  svgMarkup: string,
  hasTransparency: boolean
): Promise<QualityComparisonReport | undefined> {
  const opaqueBg: [number, number, number] | undefined = !hasTransparency
    ? [original.data[0], original.data[1], original.data[2]]
    : undefined;

  const rendered = await rasterizeSvgAtExactSize(
    svgMarkup,
    original.width,
    original.height,
    opaqueBg
  );
  if (!rendered) return undefined;

  return computeQualityComparisonFromBuffers(original, rendered);
}

export interface VectorSvgCandidateInput {
  candidateId: string;
  label: string;
  engineKind: 'opencv_bezier_gradients' | 'vtracer_rek_gradients' | 'potrace_bezier';
  svg: string;
}

/**
 * Avalia múltiplos candidatos 100% vetoriais (sem raster) combinando SSIM, fidelidade perceptual
 * CIE ΔE Lab, contornos Sobel F1, continuidade humana de gradientes e organização editável
 * (presença de gradientes SVG reais quando a imagem possui degradês), retornando o melhor candidato!
 */
export async function evaluateAndSelectBestCandidate(
  original: RawRgbaImage,
  candidates: VectorSvgCandidateInput[],
  hasTransparency: boolean,
  sourceGradientRatio: number
): Promise<{
  winner: VectorSvgCandidateInput;
  winnerQuality: QualityComparisonReport | undefined;
}> {
  if (candidates.length === 1) {
    const q = await evaluateSvgVisualQuality(original, candidates[0].svg, hasTransparency);
    return { winner: candidates[0], winnerQuality: q };
  }

  const summaries: CandidateEvaluationSummary[] = [];
  const reports: Array<QualityComparisonReport | undefined> = [];

  const structList = candidates.map((cand) => validateSvgStructure(cand.svg));
  const minValidPathCount = structList.reduce((acc, s) => {
    if (!s.valid || s.hasEmbeddedRaster || s.pathCount <= 0) return acc;
    return Math.min(acc, s.pathCount);
  }, Number.POSITIVE_INFINITY);

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const cand = candidates[cIdx];
    const struct = structList[cIdx];
    if (!struct.valid || struct.hasEmbeddedRaster) {
      reports.push(undefined);
      continue;
    }

    const q = await evaluateSvgVisualQuality(original, cand.svg, hasTransparency);
    reports.push(q);
    if (!q) continue;

    // Pontuação composta perceptual + estrutural (valoriza gradientes nativos reais, topologia limpa e penaliza fragmentação de anti-aliasing)
    const nativeGradBonus =
      sourceGradientRatio >= 0.2 && struct.gradientCount >= 4
        ? Math.min(5.0, 2.0 + struct.gradientCount * 0.35)
        : 0;
    const topologyCleanBonus =
      cand.engineKind === 'opencv_bezier_gradients' && q.ssimPct >= 97.2 && q.colorFidelityPct >= 97.0
        ? 1.55
        : 0;
    const relativeBloatRatio =
      Number.isFinite(minValidPathCount) && minValidPathCount > 0
        ? struct.pathCount / Math.max(4, minValidPathCount)
        : 1;
    const relativeFragmentationPenalty =
      relativeBloatRatio > 3.2 ? Math.min(4.5, (relativeBloatRatio - 3.2) * 0.38) : 0;

    const fragmentationThreshold = sourceGradientRatio >= 0.2 ? 220 : 1200;
    const excessiveFragmentationPenalty =
      (struct.pathCount > fragmentationThreshold
        ? Math.min(8.5, (struct.pathCount - fragmentationThreshold) / 95)
        : 0) + relativeFragmentationPenalty;

    const compositeScore = Number(
      (
        q.ssimPct * 0.34 +
        q.colorFidelityPct * 0.3 +
        q.contourFidelityPct * 0.2 +
        q.gradientContinuityPct * 0.16 +
        nativeGradBonus +
        topologyCleanBonus -
        excessiveFragmentationPenalty
      ).toFixed(2)
    );

    summaries.push({
      candidateId: cand.candidateId,
      label: cand.label,
      ssimPct: q.ssimPct,
      perceptualColorPct: q.colorFidelityPct,
      contourFidelityPct: q.contourFidelityPct,
      gradientContinuityPct: q.gradientContinuityPct,
      compositeScore,
      objectCount: struct.objectCount,
      pathCount: struct.pathCount,
      gradientCount: struct.gradientCount,
    });
  }

  if (summaries.length === 0) {
    return { winner: candidates[0], winnerQuality: undefined };
  }

  summaries.sort((a, b) => b.compositeScore - a.compositeScore);
  const bestSummary = summaries[0];
  const winIdx = candidates.findIndex((c) => c.candidateId === bestSummary.candidateId);
  const chosenIdx = winIdx >= 0 ? winIdx : 0;
  const winnerReport = reports[chosenIdx];

  if (winnerReport) {
    winnerReport.evaluatedCandidates = summaries;
  }

  return {
    winner: candidates[chosenIdx],
    winnerQuality: winnerReport,
  };
}
