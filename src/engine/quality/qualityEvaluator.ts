import type {
  CandidateEvaluationSummary,
  QualityComparisonReport,
  RawRgbaImage,
} from '../types';
import { deltaECiede2000FromLab } from '../color/perceptualColor';
import { computeExactEuclideanDistanceTransform } from '../stage2/stage2Diagnostics';
import { renderSvgSupersampled } from '../stage2/supersampledSvgRenderer';
import { validateSvgStructure } from '../validation/fileValidator';
import { isAuditActive, noteCandidate } from '../audit/pipelineAudit';

/**
 * Rasteriza o SVG gerado com Supersampling (`2×`) e integração de área pré-multiplicada
 * exatamente nas dimensões (width x height) da imagem original APENAS para avaliação comparativa
 * (funciona em Node, Main Thread e Web Worker via OffscreenCanvas — jamais incorporado ao SVG!).
 */
export async function rasterizeSvgAtExactSize(
  svgMarkup: string,
  targetWidth: number,
  targetHeight: number,
  opaqueBackgroundRgb?: [number, number, number]
): Promise<RawRgbaImage | null> {
  return renderSvgSupersampled(svgMarkup, targetWidth, targetHeight, {
    opaqueBackgroundRgb,
  });
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

  // Amostragem perceptual CIE Lab + CIEDE2000 (passo adaptativo rápido)
  const labStep = Math.max(1, Math.floor(Math.sqrt(totalPixels / 16000)));
  let deltaESum = 0;
  let deltaE2000Sum = 0;
  let deltaECount = 0;
  const de2000Hist = new Int32Array(1001);

  const tlA = original.data[3];
  const bgR0 = original.data[0];
  const bgG0 = original.data[1];
  const bgB0 = original.data[2];
  const cornerOffsets = [
    0,
    (width - 1) * 4,
    (height - 1) * original.width * 4,
    ((height - 1) * original.width + (width - 1)) * 4,
  ];
  let matchingOpaqueCorners = 0;
  let transparentCorners = 0;
  for (const cOff of cornerOffsets) {
    if (original.data[cOff + 3] < 30) {
      transparentCorners++;
    } else if (
      Math.abs(original.data[cOff] - bgR0) +
        Math.abs(original.data[cOff + 1] - bgG0) +
        Math.abs(original.data[cOff + 2] - bgB0) <=
      28
    ) {
      matchingOpaqueCorners++;
    }
  }
  const hasTransparentCanvas = transparentCorners >= 2 || tlA < 30;
  const hasUniformOpaqueBg = !hasTransparentCanvas && matchingOpaqueCorners >= 3;
  let fgInter = 0;
  let fgUni = 0;

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

      let oCov: number;
      let vCov: number;
      if (hasTransparentCanvas) {
        oCov = original.data[oIdx + 3] < 10 ? 0 : original.data[oIdx + 3] / 255;
        vCov = renderedSvg.data[vIdx + 3] < 10 ? 0 : renderedSvg.data[vIdx + 3] / 255;
      } else if (hasUniformOpaqueBg) {
        const oL1 =
          Math.abs(original.data[oIdx] - bgR0) +
          Math.abs(original.data[oIdx + 1] - bgG0) +
          Math.abs(original.data[oIdx + 2] - bgB0);
        const vL1 = Math.abs(vr - bgR0) + Math.abs(vg - bgG0) + Math.abs(vb - bgB0);
        oCov = oL1 <= 16 ? 0 : Math.min(1, (oL1 - 16) / 140);
        vCov = vL1 <= 16 ? 0 : Math.min(1, (vL1 - 16) / 140);
      } else {
        oCov = original.data[oIdx + 3] / 255;
        vCov = renderedSvg.data[vIdx + 3] / 255;
      }
      fgInter += Math.min(oCov, vCov);
      fgUni += Math.max(oCov, vCov);

      if (sampleLabRow && x % labStep === 0) {
        const [ol, oaLab, obLab] = srgbToLab(or, og, ob);
        const [vl, vaLab, vbLab] = srgbToLab(vr, vg, vb);
        const de = Math.hypot(ol - vl, oaLab - vaLab, obLab - vbLab);
        const de00 = deltaECiede2000FromLab(ol, oaLab, obLab, vl, vaLab, vbLab);
        deltaESum += de;
        deltaE2000Sum += de00;
        de2000Hist[Math.min(1000, Math.round(de00 * 10))]++;
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
  const meanDeltaE2000 = deltaECount > 0 ? Number((deltaE2000Sum / deltaECount).toFixed(2)) : 0;
  let p95DeltaE2000 = 0;
  if (deltaECount > 0) {
    let acc = 0;
    const target95 = Math.floor(deltaECount * 0.95);
    for (let b = 0; b <= 1000; b++) {
      acc += de2000Hist[b];
      if (acc >= target95) {
        p95DeltaE2000 = Number((b / 10).toFixed(2));
        break;
      }
    }
  }
  const iouPct = fgUni > 0 ? Number(((fgInter / fgUni) * 100).toFixed(2)) : 100;
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
  const origEdgesSupport = new Uint8Array(width * height);
  const vecEdges = new Uint8Array(width * height);
  const vecEdgesSupport = new Uint8Array(width * height);
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
      const oL4 = (idx - 1) * 4;
      const oR4 = (idx + 1) * 4;
      const oU4 = (idx - width) * 4;
      const oD4 = (idx + width) * 4;
      const oChroma =
        0.5 *
        Math.max(
          Math.abs(original.data[oR4] - original.data[oL4]) +
            Math.abs(original.data[oD4] - original.data[oU4]),
          Math.abs(original.data[oR4 + 1] - original.data[oL4 + 1]) +
            Math.abs(original.data[oD4 + 1] - original.data[oU4 + 1]),
          Math.abs(original.data[oR4 + 2] - original.data[oL4 + 2]) +
            Math.abs(original.data[oD4 + 2] - original.data[oU4 + 2])
        );
      const oMag = Math.max(Math.abs(ogx) + Math.abs(ogy), oChroma);

      const vgx = vecLum[idx + 1] - vecLum[idx - 1];
      const vgy = vecLum[idx + width] - vecLum[idx - width];
      const vChroma =
        0.5 *
        Math.max(
          Math.abs(renderedSvg.data[oR4] - renderedSvg.data[oL4]) +
            Math.abs(renderedSvg.data[oD4] - renderedSvg.data[oU4]),
          Math.abs(renderedSvg.data[oR4 + 1] - renderedSvg.data[oL4 + 1]) +
            Math.abs(renderedSvg.data[oD4 + 1] - renderedSvg.data[oU4 + 1]),
          Math.abs(renderedSvg.data[oR4 + 2] - renderedSvg.data[oL4 + 2]) +
            Math.abs(renderedSvg.data[oD4 + 2] - renderedSvg.data[oU4 + 2])
        );
      const vMag = Math.max(Math.abs(vgx) + Math.abs(vgy), vChroma);

      if (oMag >= 13) origEdgesSupport[idx] = 1;
      if (oMag >= edgeThresh) {
        origEdges[idx] = 1;
        origEdgeCount++;
      }
      if (vMag >= 13) vecEdgesSupport[idx] = 1;
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

  // Distância de Chamfer e Distância de Hausdorff exatas via EDT 2D O(W·H) com histerese
  const dtOrig = computeExactEuclideanDistanceTransform(origEdgesSupport, width, height);
  const dtVec = computeExactEuclideanDistanceTransform(vecEdgesSupport, width, height);
  let sumO2V = 0;
  let sumV2O = 0;
  let maxHausdorff = 0;
  const hBins = new Int32Array(501);
  for (let i = 0; i < width * height; i++) {
    if (origEdges[i]) {
      const d = dtVec[i];
      sumO2V += d;
      if (d > maxHausdorff) maxHausdorff = d;
      hBins[Math.min(500, Math.round(d * 10))]++;
    }
    if (vecEdges[i]) {
      const d = dtOrig[i];
      sumV2O += d;
      if (d > maxHausdorff) maxHausdorff = d;
      hBins[Math.min(500, Math.round(d * 10))]++;
    }
  }
  const chamferDistancePx =
    origEdgeCount > 0 && vecEdgeCount > 0
      ? Number((0.5 * (sumO2V / origEdgeCount + sumV2O / vecEdgeCount)).toFixed(3))
      : 0;
  let hausdorffP99Px = 0;
  const totEdgePts = origEdgeCount + vecEdgeCount;
  if (totEdgePts > 0) {
    let accH = 0;
    const t99 = Math.floor(totEdgePts * 0.99);
    for (let b = 0; b <= 500; b++) {
      accH += hBins[b];
      if (accH >= t99) {
        hausdorffP99Px = Number((b / 10).toFixed(2));
        break;
      }
    }
  }

  return {
    ssimPct,
    pixelSimilarityPct,
    psnrDb,
    contourFidelityPct,
    colorFidelityPct,
    meanDeltaELab,
    meanDeltaE2000,
    p95DeltaE2000,
    chamferDistancePx,
    hausdorffDistancePx: Number(maxHausdorff.toFixed(2)),
    hausdorffP99Px,
    iouPct,
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
    if (isAuditActive() && q) {
      const struct = validateSvgStructure(candidates[0].svg);
      noteCandidate({
        candidateId: candidates[0].candidateId,
        engineKind: candidates[0].engineKind,
        pathCount: struct.pathCount,
        objectCount: struct.objectCount,
        gradientCount: struct.gradientCount,
        ssimPct: q.ssimPct,
        deltaE2000: q.meanDeltaE2000 ?? q.meanDeltaELab,
        chamferPx: q.chamferDistancePx ?? 0,
        iouPct: q.iouPct ?? 0,
        contourFidelityPct: q.contourFidelityPct,
        gradientContinuityPct: q.gradientContinuityPct,
        selected: true,
      });
    }
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

    // Penaliza perda localizada de detalhes (ex.: estrela/olho apagado que eleva Hausdorff mesmo com média global alta!)
    const localizedDefectPenalty =
      ((q.hausdorffDistancePx ?? 0) > 4.5
        ? Math.min(10.0, ((q.hausdorffDistancePx ?? 0) - 4.5) * 0.32)
        : 0) +
      ((q.chamferDistancePx ?? 0) > 0.35
        ? Math.min(6.0, ((q.chamferDistancePx ?? 0) - 0.35) * 2.4)
        : 0);

    const compositeScore = Number(
      (
        q.ssimPct * 0.34 +
        q.colorFidelityPct * 0.3 +
        q.contourFidelityPct * 0.2 +
        q.gradientContinuityPct * 0.16 +
        nativeGradBonus +
        topologyCleanBonus -
        excessiveFragmentationPenalty -
        localizedDefectPenalty
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
  if (isAuditActive()) {
    for (const summary of summaries) {
      const cand = candidates.find((item) => item.candidateId === summary.candidateId);
      const q = reports[candidates.findIndex((item) => item.candidateId === summary.candidateId)];
      if (!cand || !q) continue;
      noteCandidate({
        candidateId: summary.candidateId,
        engineKind: cand.engineKind,
        pathCount: summary.pathCount,
        objectCount: summary.objectCount,
        gradientCount: summary.gradientCount,
        ssimPct: summary.ssimPct,
        deltaE2000: q.meanDeltaE2000 ?? q.meanDeltaELab,
        chamferPx: q.chamferDistancePx ?? 0,
        iouPct: q.iouPct ?? 0,
        contourFidelityPct: summary.contourFidelityPct,
        gradientContinuityPct: summary.gradientContinuityPct,
        selected: summary.candidateId === bestSummary.candidateId,
      });
    }
  }

  if (winnerReport) {
    winnerReport.evaluatedCandidates = summaries;
  }

  return {
    winner: candidates[chosenIdx],
    winnerQuality: winnerReport,
  };
}
