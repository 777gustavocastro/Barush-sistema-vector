import {
  unmixDualSpaceBoundaryMatting,
  unmixPerceptualBoundaryCoverage,
  type PerceptualOklabBuffers,
} from '../color/perceptualColor';
import type { Point2D } from './adaptiveBezierFitter';

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface SubpixelEdgeInput {
  width: number;
  height: number;
  labelMap: Int32Array;
  oklab: PerceptualOklabBuffers;
  rgbaBytes: Uint8Array;
  hasUniformBg: boolean;
  backgroundOklab: [number, number, number] | null;
  backgroundRgb?: [number, number, number] | null;
  regionMeanOklab: Map<number, [number, number, number]>;
  regionMeanAlpha?: Map<number, number>;
  /** Deslocamento normal aditivo por região (usado pelo auto-reparo de espessura de contornos na Etapa 2). */
  regionBoundaryBiasPx?: Map<number, number>;
  /** Posições sub-pixel globalmente consistentes para vértices de junção (evita degraus em T-junctions!). */
  junctionSubpixelCoords?: Map<number, Point2D>;
}

export interface CrackEdgeDescriptor {
  fromVid: number;
  toVid: number;
  dir: 0 | 1 | 2 | 3; // 0=E (out N), 1=S (out E), 2=W (out S), 3=N (out W)
  insideLabel: number;
  outsideLabel: number;
  inPx: number;
  outPx: number;
}

const DIR_OUT_NX = [0, 1, 0, -1] as const;
const DIR_OUT_NY = [-1, 0, 1, 0] as const;

/**
 * Amostra a cor local decontaminada do interior de uma região `targetLabel` caminhando `1..3px`
 * ao longo da normal `(stepDx, stepDy)` a partir do pixel de borda `startPx`.
 * Isso evita usar pixels contaminados por anti-aliasing ou anéis de compressão JPEG 8×8 (Gibbs ringing)
 * e também funciona perfeitamente em regiões com degradê contínuo!
 */
function sampleLocalPureAnchorRgbAndLab(
  startPx: number,
  targetLabel: number,
  stepDx: number,
  stepDy: number,
  input: SubpixelEdgeInput
): {
  r: number;
  g: number;
  b: number;
  a: number;
  L: number;
  okA: number;
  okB: number;
} {
  const { width, height, labelMap, rgbaBytes, oklab } = input;
  const x0 = startPx % width;
  const y0 = (startPx - x0) / width;

  let bestR = 0;
  let bestG = 0;
  let bestB = 0;
  let bestA = 0;
  let bestL = 0;
  let bestOkA = 0;
  let bestOkB = 0;
  let count = 0;

  // Prioriza profundidades 2..3px (livres de anti-aliasing e ringing de borda)
  for (let depth = 3; depth >= 1; depth--) {
    const sx = x0 + stepDx * depth;
    const sy = y0 + stepDy * depth;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
    const sp = sy * width + sx;
    if (labelMap[sp] !== targetLabel) continue;

    // Verifica se este pixel é interior 4-conexo (sem mistura direta com outra região)
    const isInterior =
      sx > 0 &&
      sx + 1 < width &&
      sy > 0 &&
      sy + 1 < height &&
      labelMap[sp - 1] === targetLabel &&
      labelMap[sp + 1] === targetLabel &&
      labelMap[sp - width] === targetLabel &&
      labelMap[sp + width] === targetLabel;

    if (isInterior || depth >= 2) {
      const i4 = sp * 4;
      bestR += rgbaBytes[i4];
      bestG += rgbaBytes[i4 + 1];
      bestB += rgbaBytes[i4 + 2];
      bestA += rgbaBytes[i4 + 3];
      bestL += oklab.L[sp];
      bestOkA += oklab.a[sp];
      bestOkB += oklab.b[sp];
      count++;
      if (count >= 2) break;
    }
  }

  if (count > 0) {
    const inv = 1 / count;
    return {
      r: bestR * inv,
      g: bestG * inv,
      b: bestB * inv,
      a: bestA * inv,
      L: bestL * inv,
      okA: bestOkA * inv,
      okB: bestOkB * inv,
    };
  }

  // Para traços finos de 1–2px sem núcleo interior profundo: busca o pixel local de maior pureza
  // (extremo de contraste na vizinhança 3×3 da própria região)
  let fallbackSp = startPx;
  const meanLab = input.regionMeanOklab.get(targetLabel);
  if (meanLab) {
    let bestDistToMean = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y0 + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x0 + dx;
        if (nx < 0 || nx >= width) continue;
        const np = ny * width + nx;
        if (labelMap[np] !== targetLabel) continue;
        const d = Math.hypot(
          oklab.L[np] - meanLab[0],
          oklab.a[np] - meanLab[1],
          oklab.b[np] - meanLab[2]
        );
        if (d < bestDistToMean) {
          bestDistToMean = d;
          fallbackSp = np;
        }
      }
    }
  }

  const f4 = fallbackSp * 4;
  return {
    r: rgbaBytes[f4],
    g: rgbaBytes[f4 + 1],
    b: rgbaBytes[f4 + 2],
    a: rgbaBytes[f4 + 3],
    L: oklab.L[fallbackSp],
    okA: oklab.a[fallbackSp],
    okB: oklab.b[fallbackSp],
  };
}

/**
 * Estima a cobertura fracionária `c ∈ [0, 1]` de `C1` sobre `C2` combinando sRGB e Linear-RGB
 * sem viés de gama que faz contornos pretos invadirem áreas brancas ou coloridas.
 */
function estimateUnbiasedPixelCoverage(
  pxR: number,
  pxG: number,
  pxB: number,
  pxL: number,
  pxOkA: number,
  pxOkB: number,
  c1: { r: number; g: number; b: number; L: number; okA: number; okB: number },
  c2: { r: number; g: number; b: number; L: number; okA: number; okB: number },
  defaultCoverage: number
): { coverage: number; valid: boolean } {
  const dual = unmixDualSpaceBoundaryMatting(
    pxR,
    pxG,
    pxB,
    Math.round(c1.r),
    Math.round(c1.g),
    Math.round(c1.b),
    Math.round(c2.r),
    Math.round(c2.g),
    Math.round(c2.b)
  );

  // Cobertura em espaço sRGB (padrão nativo de Canvas2D, Cairo/Inkscape, Skia 2D e PNGs gráficos)
  const vxS = c1.r - c2.r;
  const vyS = c1.g - c2.g;
  const vzS = c1.b - c2.b;
  const denomS = vxS * vxS + vyS * vyS + vzS * vzS;

  if (denomS < 12) {
    return { coverage: defaultCoverage, valid: false };
  }

  const rawCovSrgb =
    ((pxR - c2.r) * vxS + (pxG - c2.g) * vyS + (pxB - c2.b) * vzS) / denomS;
  const covSrgb = Math.max(0, Math.min(1, rawCovSrgb));
  const resSrgb = Math.hypot(
    pxR - (c2.r + covSrgb * vxS),
    pxG - (c2.g + covSrgb * vyS),
    pxB - (c2.b + covSrgb * vzS)
  );

  // Cobertura em espaço Linear-RGB (óptica fotográfica e renderizadores lineares)
  const lrPx = SRGB_TO_LIN[pxR & 255];
  const lgPx = SRGB_TO_LIN[pxG & 255];
  const lbPx = SRGB_TO_LIN[pxB & 255];
  const lr1 = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(c1.r)))];
  const lg1 = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(c1.g)))];
  const lb1 = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(c1.b)))];
  const lr2 = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(c2.r)))];
  const lg2 = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(c2.g)))];
  const lb2 = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(c2.b)))];

  const vxL = lr1 - lr2;
  const vyL = lg1 - lg2;
  const vzL = lb1 - lb2;
  const denomL = vxL * vxL + vyL * vyL + vzL * vzL;
  let covLin = covSrgb;
  let resLin = resSrgb;
  if (denomL > 1e-5) {
    const rawL = ((lrPx - lr2) * vxL + (lgPx - lg2) * vyL + (lbPx - lb2) * vzL) / denomL;
    covLin = Math.max(0, Math.min(1, rawL));
    resLin =
      Math.hypot(
        lrPx - (lr2 + covLin * vxL),
        lgPx - (lg2 + covLin * vyL),
        lbPx - (lb2 + covLin * vzL)
      ) * 255;
  }

  if (!dual.isTrueAntialiasBlend) {
    const okUnmix = unmixPerceptualBoundaryCoverage(
      pxL,
      pxOkA,
      pxOkB,
      c1.L,
      c1.okA,
      c1.okB,
      c2.L,
      c2.okA,
      c2.okB
    );
    if (okUnmix.orthogonalResidual > 6.5) {
      return { coverage: defaultCoverage, valid: false };
    }
  }

  // Seleção antissimétrica (invariante à troca c1 <-> c2!):
  // Usa Linear-RGB somente quando reduz significativamente o resíduo cromático ortogonal;
  // em bordas acromáticas (preto/branco), a média balanceada 0.72*sRGB + 0.28*Linear evita tanto
  // expansão de regiões pretas sobre brancas quanto erosão de linhas finas escuras!
  let cov: number;
  if (resLin + 2.0 < resSrgb) {
    cov = covLin;
  } else if (resSrgb + 2.0 < resLin) {
    cov = covSrgb;
  } else {
    cov = 0.72 * covSrgb + 0.28 * covLin;
  }

  return { coverage: Math.max(0, Math.min(1, cov)), valid: true };
}

/**
 * Calcula o deslocamento sub-pixel normal exato `δ ∈ [-0.48, +0.48]` (em pixels, positivo na direção
 * da normal externa `inside -> outside`) para uma única aresta de grade.
 * Garante antissimetria estrita `δ(A -> B) === -δ(B -> A)` em todas as fronteiras compartilhadas!
 */
export function computeExactSubpixelEdgeNormalShift(
  edge: CrackEdgeDescriptor,
  input: SubpixelEdgeInput
): number {
  const {
    rgbaBytes,
    oklab,
    hasUniformBg,
    backgroundOklab,
    backgroundRgb,
    regionMeanAlpha,
    regionBoundaryBiasPx,
  } = input;

  const outNx = DIR_OUT_NX[edge.dir];
  const outNy = DIR_OUT_NY[edge.dir];
  const inBias = regionBoundaryBiasPx?.get(edge.insideLabel) ?? 0;

  if (edge.outsideLabel === 0) {
    const inAnchor = sampleLocalPureAnchorRgbAndLab(
      edge.inPx,
      edge.insideLabel,
      -outNx,
      -outNy,
      input
    );

    if (!hasUniformBg || !backgroundOklab) {
      const plateauAlpha = Math.max(
        24,
        regionMeanAlpha?.get(edge.insideLabel) ?? inAnchor.a ?? 255
      );
      const aIn = Math.min(1, rgbaBytes[edge.inPx * 4 + 3] / plateauAlpha);
      const aOut =
        edge.outPx >= 0
          ? Math.min(1, rgbaBytes[edge.outPx * 4 + 3] / plateauAlpha)
          : 0;
      if (aIn < 0.99 || aOut > 0.01) {
        const rawDelta = aIn + aOut - 1.0 + inBias;
        return Math.max(-0.48, Math.min(0.48, rawDelta));
      }
      return Math.max(-0.48, Math.min(0.48, inBias));
    }

    const bgAnchor = {
      r: backgroundRgb ? backgroundRgb[0] : 255,
      g: backgroundRgb ? backgroundRgb[1] : 255,
      b: backgroundRgb ? backgroundRgb[2] : 255,
      L: backgroundOklab[0],
      okA: backgroundOklab[1],
      okB: backgroundOklab[2],
    };

    const in4 = edge.inPx * 4;
    const cIn = estimateUnbiasedPixelCoverage(
      rgbaBytes[in4],
      rgbaBytes[in4 + 1],
      rgbaBytes[in4 + 2],
      oklab.L[edge.inPx],
      oklab.a[edge.inPx],
      oklab.b[edge.inPx],
      inAnchor,
      bgAnchor,
      1.0
    );

    let covOut = 0.0;
    if (edge.outPx >= 0) {
      const out4 = edge.outPx * 4;
      const cOut = estimateUnbiasedPixelCoverage(
        rgbaBytes[out4],
        rgbaBytes[out4 + 1],
        rgbaBytes[out4 + 2],
        oklab.L[edge.outPx],
        oklab.a[edge.outPx],
        oklab.b[edge.outPx],
        inAnchor,
        bgAnchor,
        0.0
      );
      if (cOut.valid) {
        covOut = cOut.coverage;
      }
    }

    const covIn = cIn.valid ? cIn.coverage : 1.0;
    const rawDelta = covIn + covOut - 1.0 + inBias;
    return Math.max(-0.48, Math.min(0.48, rawDelta));
  }

  // Costura interna compartilhada entre duas regiões: ordena canonicamente `rMin < rMax`
  // para garantir numericamente `shift(inside, outside) === -shift(outside, inside)` até o último bit!
  if (edge.outPx < 0) return 0;

  const rA = Math.min(edge.insideLabel, edge.outsideLabel);
  const rB = Math.max(edge.insideLabel, edge.outsideLabel);
  const sign = edge.insideLabel === rA ? 1 : -1;

  const pxA = edge.insideLabel === rA ? edge.inPx : edge.outPx;
  const pxB = edge.insideLabel === rA ? edge.outPx : edge.inPx;
  const stepIntoAx = edge.insideLabel === rA ? -outNx : outNx;
  const stepIntoAy = edge.insideLabel === rA ? -outNy : outNy;

  const anchorA = sampleLocalPureAnchorRgbAndLab(pxA, rA, stepIntoAx, stepIntoAy, input);
  const anchorB = sampleLocalPureAnchorRgbAndLab(pxB, rB, -stepIntoAx, -stepIntoAy, input);

  const pA4 = pxA * 4;
  const pB4 = pxB * 4;

  const cOnA = estimateUnbiasedPixelCoverage(
    rgbaBytes[pA4],
    rgbaBytes[pA4 + 1],
    rgbaBytes[pA4 + 2],
    oklab.L[pxA],
    oklab.a[pxA],
    oklab.b[pxA],
    anchorA,
    anchorB,
    1.0
  );
  const cOnB = estimateUnbiasedPixelCoverage(
    rgbaBytes[pB4],
    rgbaBytes[pB4 + 1],
    rgbaBytes[pB4 + 2],
    oklab.L[pxB],
    oklab.a[pxB],
    oklab.b[pxB],
    anchorA,
    anchorB,
    0.0
  );

  if (!cOnA.valid && !cOnB.valid) {
    return 0;
  }

  const covA = cOnA.valid ? cOnA.coverage : 1.0;
  const covB = cOnB.valid ? cOnB.coverage : 0.0;
  const biasA = regionBoundaryBiasPx?.get(rA) ?? 0;
  const biasB = regionBoundaryBiasPx?.get(rB) ?? 0;
  const canonShift = Math.max(-0.46, Math.min(0.46, covA + covB - 1.0 + (biasA - biasB) * 0.5));
  return sign * canonShift;
}

/**
 * Reconstrói os alvos sub-pixel contínuos dos vértices de uma cadeia de arestas de grade:
 * 1. Filtra ruído de compressão/JPEG ao longo de arestas colineares adjacentes (mediana 3-pontos seletiva);
 * 2. Calcula a interseção vetorial EXATA `(dx, dy)` em dobras ortogonais (`ePrev.dir !== eNext.dir`),
 *    eliminando o erro de `0.5×` que gerava dentes de serra de `0.6px` em cada degrau diagonal
 *    e deformava cantos de retângulos!
 */
export function reconstructSubpixelChainTargets(
  chainEdges: ReadonlyArray<CrackEdgeDescriptor>,
  gridStride: number,
  isClosed: boolean,
  input: SubpixelEdgeInput
): { basePts: Point2D[]; targetPts: Point2D[] } {
  const m = chainEdges.length;
  const basePts: Point2D[] = new Array(m + 1);
  const targetPts: Point2D[] = new Array(m + 1);
  const rawShifts = new Float32Array(m);

  for (let i = 0; i < m; i++) {
    const e = chainEdges[i];
    const vx = e.fromVid % gridStride;
    const vy = (e.fromVid - vx) / gridStride;
    basePts[i] = { x: vx, y: vy };
    rawShifts[i] = computeExactSubpixelEdgeNormalShift(e, input);
  }

  const lastTo = chainEdges[m - 1].toVid;
  const endVx = lastTo % gridStride;
  const endVy = (lastTo - endVx) / gridStride;
  basePts[m] = { x: endVx, y: endVy };

  // Suavização tangencial leve APENAS entre arestas adjacentes de MESMA direção (rejeita spikes de JPEG/ruído sem borrar degraus!)
  const shifts = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const prevIdx = i === 0 ? (isClosed ? m - 1 : -1) : i - 1;
    const nextIdx = i === m - 1 ? (isClosed ? 0 : -1) : i + 1;
    const s0 = rawShifts[i];
    const samePrev = prevIdx >= 0 && chainEdges[prevIdx].dir === chainEdges[i].dir;
    const sameNext = nextIdx >= 0 && chainEdges[nextIdx].dir === chainEdges[i].dir;

    if (samePrev && sameNext) {
      const sP = rawShifts[prevIdx];
      const sN = rawShifts[nextIdx];
      // Rejeição de outlier isolado + ponderação [0.2, 0.6, 0.2]
      const med = Math.max(Math.min(sP, s0), Math.min(Math.max(sP, s0), sN));
      const denoised = Math.abs(s0 - med) > 0.24 ? med : s0;
      shifts[i] = 0.2 * sP + 0.6 * denoised + 0.2 * sN;
    } else if (samePrev) {
      shifts[i] = 0.25 * rawShifts[prevIdx] + 0.75 * s0;
    } else if (sameNext) {
      shifts[i] = 0.75 * s0 + 0.25 * rawShifts[nextIdx];
    } else {
      shifts[i] = s0;
    }
  }

  for (let i = 0; i <= m; i++) {
    if (!isClosed && (i === 0 || i === m)) {
      // Vértice de junção topológica compartilhado (>= 3 regiões): usa coordenada sub-pixel globalmente única!
      const vid = i === 0 ? chainEdges[0].fromVid : chainEdges[m - 1].toVid;
      const sharedJuncPos = input.junctionSubpixelCoords?.get(vid);
      targetPts[i] = sharedJuncPos ? { ...sharedJuncPos } : { ...basePts[i] };
      continue;
    }

    const prevEdgeIdx = i === 0 ? m - 1 : i - 1;
    const nextEdgeIdx = i === m ? 0 : i;
    const ePrev = chainEdges[prevEdgeIdx];
    const eNext = chainEdges[nextEdgeIdx];
    const sPrev = shifts[prevEdgeIdx];
    const sNext = shifts[nextEdgeIdx];

    const nxPrev = DIR_OUT_NX[ePrev.dir];
    const nyPrev = DIR_OUT_NY[ePrev.dir];
    const nxNext = DIR_OUT_NX[eNext.dir];
    const nyNext = DIR_OUT_NY[eNext.dir];

    let dx: number;
    let dy: number;
    if (ePrev.dir === eNext.dir) {
      // Arestas colineares: média exata do deslocamento normal perpendicular
      dx = (nxPrev * sPrev + nxNext * sNext) * 0.5;
      dy = (nyPrev * sPrev + nyNext * sNext) * 0.5;
    } else if (((ePrev.dir + 2) & 3) === eNext.dir) {
      // Espigão degenerado de ida-e-volta (180°): deslocamento nulo
      dx = 0;
      dy = 0;
    } else {
      // Arestas ortogonais (degrau de escada ou canto 90°): interseção exata das duas retas deslocadas!
      dx = nxPrev * sPrev + nxNext * sNext;
      dy = nyPrev * sPrev + nyNext * sNext;
    }

    targetPts[i] = {
      x: basePts[i].x + Math.max(-0.49, Math.min(0.49, dx)),
      y: basePts[i].y + Math.max(-0.49, Math.min(0.49, dy)),
    };
  }

  if (isClosed) {
    targetPts[m] = { ...targetPts[0] };
  }

  return { basePts, targetPts };
}
