import {
  fitAdaptiveBezierChain,
  regularizeSubpixelChainPoints,
  reverseFittedBezierChain,
  serializeChainsLoopToPathD,
  tuckInternalChainUnderOpaqueNeighbor,
  type AdaptiveCurveFitOptions,
  type FittedBezierChain,
  type Point2D,
} from '../geometry/adaptiveBezierFitter';
import {
  unmixPerceptualBoundaryCoverage,
  type PerceptualOklabBuffers,
} from '../color/perceptualColor';

interface CrackDirectedEdge {
  fromVid: number;
  toVid: number;
  dir: 0 | 1 | 2 | 3; // 0=E, 1=S, 2=W, 3=N
  insideLabel: number;
  outsideLabel: number;
  inPx: number;
  outPx: number;
  used: boolean;
}

interface RawExtractedLoop {
  regionId: number;
  edges: CrackDirectedEdge[];
  signedArea: number;
  isOuter: boolean;
}

export interface RegionTopologyMetadata {
  zRank: number;
  isSemiTransparent: boolean;
  meanOklab: [number, number, number];
}

export interface PlanarTopologyBuildInput {
  width: number;
  height: number;
  labelMap: Int32Array;
  oklab: PerceptualOklabBuffers;
  alphaBytes: Uint8Array;
  hasUniformBg: boolean;
  backgroundOklab: [number, number, number] | null;
  regionMeta: Map<number, RegionTopologyMetadata>;
  curveOptions?: AdaptiveCurveFitOptions;
  enablePorterDuffSeamTuck?: boolean;
}

export interface RegionVectorGeometry {
  regionId: number;
  outerLoopCount: number;
  holeLoopCount: number;
  usesEvenOdd: boolean;
  pathD: string;
}

export interface PlanarTopologyResult {
  geometriesByRegion: Map<number, RegionVectorGeometry>;
  sharedCanonicalChainCount: number;
  junctionVertexCount: number;
}

function computeLoopSignedArea(edges: CrackDirectedEdge[], gridStride: number): number {
  let area2 = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const x0 = e.fromVid % gridStride;
    const y0 = (e.fromVid - x0) / gridStride;
    const x1 = e.toVid % gridStride;
    const y1 = (e.toVid - x1) / gridStride;
    area2 += x0 * y1 - x1 * y0;
  }
  return area2 * 0.5;
}

/**
 * Constrói o Grafo Topológico Planar Exato sobre a grade de pixels:
 * 1. Extrai arestas orientadas (half-edges) entre cada par de regiões adjacentes;
 * 2. Identifica junções topológicas (encontro de >= 3 regiões);
 * 3. Ajusta CADA fronteira compartilhada UMA ÚNICA VEZ em sub-pixel e reutiliza a curva Bézier
 *    exata invertida na região vizinha (zero fendas, zero sobreposições indevidas, zero vazamentos);
 * 4. Preserva todos os espaços vazios/buracos reais (`fill-rule="evenodd"`).
 */
export function buildPlanarSharedTopology(
  input: PlanarTopologyBuildInput
): PlanarTopologyResult {
  const {
    width,
    height,
    labelMap,
    oklab,
    alphaBytes,
    hasUniformBg,
    backgroundOklab,
    regionMeta,
    curveOptions = {},
    enablePorterDuffSeamTuck = true,
  } = input;

  const gridW = width + 1;
  const gridH = height + 1;
  const totalGridVerts = gridW * gridH;

  const getLabel = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    const v = labelMap[y * width + x];
    return v > 0 ? v : 0;
  };

  // 1. Identifica vértices de junção topológica (onde >= 3 rótulos distintos se encontram nos 4 quadrantes)
  const isJunctionVertex = new Uint8Array(totalGridVerts);
  let junctionVertexCount = 0;

  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const lNW = getLabel(vx - 1, vy - 1);
      const lNE = getLabel(vx, vy - 1);
      const lSW = getLabel(vx - 1, vy);
      const lSE = getLabel(vx, vy);

      // Conta quantos rótulos distintos aparecem nos 4 pixels incidentes (alocação zero!)
      let distinct = 1;
      if (lNE !== lNW) distinct++;
      if (lSW !== lNW && lSW !== lNE) distinct++;
      if (lSE !== lNW && lSE !== lNE && lSE !== lSW) distinct++;

      // Também marca sela diagonal (A, B; B, A) como junção para consistência topológica
      const isDiagonalSaddle = lNW === lSE && lNE === lSW && lNW !== lNE;

      if (distinct >= 3 || isDiagonalSaddle) {
        isJunctionVertex[vy * gridW + vx] = 1;
        junctionVertexCount++;
      }
    }
  }

  // 2. Gera arestas orientadas agrupadas por região interna
  const edgesByRegion = new Map<number, CrackDirectedEdge[]>();
  const pushEdge = (edge: CrackDirectedEdge) => {
    let list = edgesByRegion.get(edge.insideLabel);
    if (!list) {
      list = [];
      edgesByRegion.set(edge.insideLabel, list);
    }
    list.push(edge);
  };

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const inside = labelMap[rowOff + x];
      if (inside <= 0) continue;
      const inPx = rowOff + x;

      // Topo: (x, y) -> (x+1, y) [Leste = 0]
      const upLbl = getLabel(x, y - 1);
      if (upLbl !== inside) {
        pushEdge({
          fromVid: y * gridW + x,
          toVid: y * gridW + (x + 1),
          dir: 0,
          insideLabel: inside,
          outsideLabel: upLbl,
          inPx,
          outPx: y > 0 ? (y - 1) * width + x : -1,
          used: false,
        });
      }

      // Direita: (x+1, y) -> (x+1, y+1) [Sul = 1]
      const rightLbl = getLabel(x + 1, y);
      if (rightLbl !== inside) {
        pushEdge({
          fromVid: y * gridW + (x + 1),
          toVid: (y + 1) * gridW + (x + 1),
          dir: 1,
          insideLabel: inside,
          outsideLabel: rightLbl,
          inPx,
          outPx: x + 1 < width ? rowOff + (x + 1) : -1,
          used: false,
        });
      }

      // Base: (x+1, y+1) -> (x, y+1) [Oeste = 2]
      const downLbl = getLabel(x, y + 1);
      if (downLbl !== inside) {
        pushEdge({
          fromVid: (y + 1) * gridW + (x + 1),
          toVid: (y + 1) * gridW + x,
          dir: 2,
          insideLabel: inside,
          outsideLabel: downLbl,
          inPx,
          outPx: y + 1 < height ? (y + 1) * width + x : -1,
          used: false,
        });
      }

      // Esquerda: (x, y+1) -> (x, y) [Norte = 3]
      const leftLbl = getLabel(x - 1, y);
      if (leftLbl !== inside) {
        pushEdge({
          fromVid: (y + 1) * gridW + x,
          toVid: y * gridW + x,
          dir: 3,
          insideLabel: inside,
          outsideLabel: leftLbl,
          inPx,
          outPx: x > 0 ? rowOff + (x - 1) : -1,
          used: false,
        });
      }
    }
  }

  // 3. Extrai todos os laços Jordan fechados por região (regra de curva à direita em selas diagonais)
  const loopsByRegion = new Map<number, RawExtractedLoop[]>();

  for (const [regionId, edgeList] of edgesByRegion.entries()) {
    const outgoingByVid = new Map<number, CrackDirectedEdge[]>();
    for (const e of edgeList) {
      let arr = outgoingByVid.get(e.fromVid);
      if (!arr) {
        arr = [];
        outgoingByVid.set(e.fromVid, arr);
      }
      arr.push(e);
    }

    const regionLoops: RawExtractedLoop[] = [];
    for (const startEdge of edgeList) {
      if (startEdge.used) continue;
      const loopEdges: CrackDirectedEdge[] = [];
      let curr: CrackDirectedEdge | undefined = startEdge;

      while (curr && !curr.used) {
        curr.used = true;
        loopEdges.push(curr);
        if (curr.toVid === startEdge.fromVid) {
          break;
        }
        const candidates = outgoingByVid.get(curr.toVid);
        if (!candidates || candidates.length === 0) break;

        let chosen: CrackDirectedEdge | undefined;
        const preferredRightTurn = ((curr.dir + 1) & 3) as 0 | 1 | 2 | 3;
        for (const cand of candidates) {
          if (!cand.used && cand.dir === preferredRightTurn) {
            chosen = cand;
            break;
          }
        }
        if (!chosen) {
          for (const cand of candidates) {
            if (!cand.used) {
              chosen = cand;
              break;
            }
          }
        }
        curr = chosen;
      }

      if (loopEdges.length >= 4) {
        const signedArea = computeLoopSignedArea(loopEdges, gridW);
        regionLoops.push({
          regionId,
          edges: loopEdges,
          signedArea,
          isOuter: signedArea > 0,
        });
      }
    }

    loopsByRegion.set(regionId, regionLoops);
  }

  // 4. Função auxiliar para estimar o deslocamento normal sub-pixel de anti-aliasing de uma aresta
  const computeEdgeNormalSubpixelShift = (e: CrackDirectedEdge): number => {
    const inMeta = regionMeta.get(e.insideLabel);
    if (!inMeta) return 0;
    const [fgL, fgA, fgB] = inMeta.meanOklab;

    if (e.outsideLabel === 0) {
      if (!hasUniformBg || !backgroundOklab) {
        const aIn = alphaBytes[e.inPx * 4 + 3] / 255;
        const aOut = e.outPx >= 0 ? alphaBytes[e.outPx * 4 + 3] / 255 : 0;
        if (aIn < 0.97 || aOut > 0.03) {
          return Math.max(-0.42, Math.min(0.42, (aIn + aOut - 1.0) * 0.42));
        }
        return 0;
      }

      const [bgL, bgA, bgB] = backgroundOklab;
      const uIn = unmixPerceptualBoundaryCoverage(
        oklab.L[e.inPx],
        oklab.a[e.inPx],
        oklab.b[e.inPx],
        fgL,
        fgA,
        fgB,
        bgL,
        bgA,
        bgB
      );
      const covIn = uIn.orthogonalResidual <= 6.5 ? uIn.coverage : 1.0;

      let covOut = 0.0;
      if (e.outPx >= 0) {
        const uOut = unmixPerceptualBoundaryCoverage(
          oklab.L[e.outPx],
          oklab.a[e.outPx],
          oklab.b[e.outPx],
          fgL,
          fgA,
          fgB,
          bgL,
          bgA,
          bgB
        );
        if (uOut.orthogonalResidual <= 6.5) {
          covOut = uOut.coverage;
        }
      }

      return Math.max(-0.44, Math.min(0.44, (covIn + covOut - 1.0) * 0.44));
    }

    // Costura interna entre duas regiões `insideLabel` e `outsideLabel`
    const outMeta = regionMeta.get(e.outsideLabel);
    if (!outMeta || e.outPx < 0) return 0;
    const [oL, oA, oB] = outMeta.meanOklab;
    const uIn = unmixPerceptualBoundaryCoverage(
      oklab.L[e.inPx],
      oklab.a[e.inPx],
      oklab.b[e.inPx],
      fgL,
      fgA,
      fgB,
      oL,
      oA,
      oB
    );
    const uOut = unmixPerceptualBoundaryCoverage(
      oklab.L[e.outPx],
      oklab.a[e.outPx],
      oklab.b[e.outPx],
      fgL,
      fgA,
      fgB,
      oL,
      oA,
      oB
    );
    if (uIn.orthogonalResidual > 7.5 && uOut.orthogonalResidual > 7.5) return 0;
    return Math.max(-0.4, Math.min(0.4, (uIn.coverage + uOut.coverage - 1.0) * 0.4));
  };

  // Normal apontando de `inside` para `outside` para cada dir (0=E -> normal N=(0,-1), 1=S -> E=(1,0), 2=W -> S=(0,1), 3=N -> W=(-1,0))
  const DIR_OUT_NX = [0, 1, 0, -1] as const;
  const DIR_OUT_NY = [-1, 0, 1, 0] as const;

  const buildChainPointsWithSubpixelTargets = (
    chainEdges: CrackDirectedEdge[],
    isClosed: boolean
  ): { basePts: Point2D[]; targetPts: Point2D[] } => {
    const m = chainEdges.length;
    const basePts: Point2D[] = new Array(m + 1);
    const targetPts: Point2D[] = new Array(m + 1);
    const shifts = new Float32Array(m);

    for (let i = 0; i < m; i++) {
      const e = chainEdges[i];
      const vx = e.fromVid % gridW;
      const vy = (e.fromVid - vx) / gridW;
      basePts[i] = { x: vx, y: vy };
      shifts[i] = computeEdgeNormalSubpixelShift(e);
    }

    const lastTo = chainEdges[m - 1].toVid;
    const endVx = lastTo % gridW;
    const endVy = (lastTo - endVx) / gridW;
    basePts[m] = { x: endVx, y: endVy };

    for (let i = 0; i <= m; i++) {
      if (!isClosed && (i === 0 || i === m)) {
        // Vértice de junção compartilhado entre >= 3 regiões: posição exata travada!
        targetPts[i] = { ...basePts[i] };
        continue;
      }

      const prevEdgeIdx = i === 0 ? m - 1 : i - 1;
      const nextEdgeIdx = i === m ? 0 : i;
      const ePrev = chainEdges[prevEdgeIdx];
      const eNext = chainEdges[nextEdgeIdx];
      const sPrev = shifts[prevEdgeIdx];
      const sNext = shifts[nextEdgeIdx];

      const dx = (DIR_OUT_NX[ePrev.dir] * sPrev + DIR_OUT_NX[eNext.dir] * sNext) * 0.5;
      const dy = (DIR_OUT_NY[ePrev.dir] * sPrev + DIR_OUT_NY[eNext.dir] * sNext) * 0.5;

      targetPts[i] = {
        x: basePts[i].x + dx,
        y: basePts[i].y + dy,
      };
    }

    if (isClosed) {
      targetPts[m] = { ...targetPts[0] };
    }

    return { basePts, targetPts };
  };

  // 5. Cache Canônico de Cadeias Compartilhadas (garante que (A,B) e (B,A) compartilhem a EXATA MESMA curva Bézier!)
  const canonicalChainCache = new Map<string, FittedBezierChain>();

  const fitOrReuseSharedOpenChain = (chainEdges: CrackDirectedEdge[]): FittedBezierChain => {
    const inside = chainEdges[0].insideLabel;
    const outside = chainEdges[0].outsideLabel;

    // Fronteira com o fundo externo (0) só pertence a `inside`: ajusta diretamente
    if (outside === 0) {
      const { basePts, targetPts } = buildChainPointsWithSubpixelTargets(chainEdges, false);
      return fitAdaptiveBezierChain(basePts, targetPts, false, curveOptions);
    }

    const rMin = Math.min(inside, outside);
    const rMax = Math.max(inside, outside);
    const startVid = chainEdges[0].fromVid;
    const endVid = chainEdges[chainEdges.length - 1].toVid;
    const midEdge = chainEdges[Math.floor(chainEdges.length / 2)];
    const midSignature = Math.min(midEdge.fromVid, midEdge.toVid);

    const canonStartVid = inside === rMin ? startVid : endVid;
    const canonEndVid = inside === rMin ? endVid : startVid;
    const cacheKey = `O:${rMin}:${rMax}:${canonStartVid}:${canonEndVid}:${chainEdges.length}:${midSignature}`;

    let canonChain = canonicalChainCache.get(cacheKey);
    if (!canonChain) {
      if (inside === rMin) {
        const { basePts, targetPts } = buildChainPointsWithSubpixelTargets(chainEdges, false);
        canonChain = fitAdaptiveBezierChain(basePts, targetPts, false, curveOptions);
      } else {
        // Ajusta e armazena na orientação canônica rMin -> rMax para simetria exata
        const { basePts, targetPts } = buildChainPointsWithSubpixelTargets(chainEdges, false);
        const fittedCurrent = fitAdaptiveBezierChain(basePts, targetPts, false, curveOptions);
        canonChain = reverseFittedBezierChain(fittedCurrent);
      }
      canonicalChainCache.set(cacheKey, canonChain);
    }

    let oriented = inside === rMin ? canonChain : reverseFittedBezierChain(canonChain);

    // Se `inside` está Z-abaixo de `outside` e `outside` é 100% opaco, aplica micro-encaixe invisível (0.28px)
    // sob `outside` para eliminar qualquer fenda de anti-aliasing Porter-Duff nos renderizadores!
    if (enablePorterDuffSeamTuck) {
      const inMeta = regionMeta.get(inside);
      const outMeta = regionMeta.get(outside);
      if (inMeta && outMeta && inMeta.zRank < outMeta.zRank && !outMeta.isSemiTransparent) {
        oriented = tuckInternalChainUnderOpaqueNeighbor(oriented, 0.28);
      }
    }

    return oriented;
  };

  const fitOrReuseSharedClosedLoop = (loopEdges: CrackDirectedEdge[]): FittedBezierChain => {
    const inside = loopEdges[0].insideLabel;
    const outside = loopEdges[0].outsideLabel;

    // Rotaciona o laço para iniciar deterministicamente no menor `fromVid` da grade!
    let minIdx = 0;
    let minVid = loopEdges[0].fromVid;
    for (let i = 1; i < loopEdges.length; i++) {
      if (loopEdges[i].fromVid < minVid) {
        minVid = loopEdges[i].fromVid;
        minIdx = i;
      }
    }
    const orderedEdges =
      minIdx === 0
        ? loopEdges
        : [...loopEdges.slice(minIdx), ...loopEdges.slice(0, minIdx)];

    if (outside === 0) {
      const { basePts, targetPts } = buildChainPointsWithSubpixelTargets(orderedEdges, true);
      // Garante ponto inicial/final regularizado coincidente
      const reg = regularizeSubpixelChainPoints(
        basePts,
        targetPts,
        true,
        curveOptions.subpixelTubeRadiusPx ?? 0.48
      );
      return fitAdaptiveBezierChain(basePts, reg, true, curveOptions);
    }

    const rMin = Math.min(inside, outside);
    const rMax = Math.max(inside, outside);
    const cacheKey = `C:${rMin}:${rMax}:${minVid}:${orderedEdges.length}`;

    let canonClosed = canonicalChainCache.get(cacheKey);
    if (!canonClosed) {
      const { basePts, targetPts } = buildChainPointsWithSubpixelTargets(orderedEdges, true);
      const fitted = fitAdaptiveBezierChain(basePts, targetPts, true, curveOptions);
      canonClosed = inside === rMin ? fitted : reverseFittedBezierChain(fitted);
      canonicalChainCache.set(cacheKey, canonClosed);
    }

    return inside === rMin ? canonClosed : reverseFittedBezierChain(canonClosed);
  };

  // 6. Monta a geometria vetorial final `d` de cada região respeitando ilhas e furos reais!
  const geometriesByRegion = new Map<number, RegionVectorGeometry>();
  const precision = curveOptions.precision ?? 2;

  for (const [regionId, loops] of loopsByRegion.entries()) {
    const subpathsD: string[] = [];
    let outerLoopCount = 0;
    let holeLoopCount = 0;
    const myMeta = regionMeta.get(regionId);

    for (const loop of loops) {
      if (!loop.isOuter) {
        // Verifica se este laço negativo é um FURO VAZIO REAL (expondo fundo 0, região Z-inferior ou translúcida)
        // ou apenas o contorno sob uma ilha filha 100% opaca desenhada POR CIMA de `regionId`!
        let mustCutHole = false;
        for (let i = 0; i < loop.edges.length; i++) {
          const outLbl = loop.edges[i].outsideLabel;
          if (outLbl === 0) {
            mustCutHole = true;
            break;
          }
          const outMeta = regionMeta.get(outLbl);
          if (!outMeta || !myMeta || outMeta.zRank < myMeta.zRank || outMeta.isSemiTransparent) {
            mustCutHole = true;
            break;
          }
        }
        if (!mustCutHole) {
          // Ilha opaca sobreposta: mantém a forma-mãe íntegra e limpa sem furo redundante!
          continue;
        }
        holeLoopCount++;
      } else {
        outerLoopCount++;
      }

      // Localiza índices de junção dentro do laço
      const junctionPositions: number[] = [];
      for (let i = 0; i < loop.edges.length; i++) {
        if (isJunctionVertex[loop.edges[i].fromVid]) {
          junctionPositions.push(i);
        }
      }

      if (junctionPositions.length === 0) {
        const closedChain = fitOrReuseSharedClosedLoop(loop.edges);
        const dStr = serializeChainsLoopToPathD([closedChain], precision);
        if (dStr) subpathsD.push(dStr);
      } else {
        const fittedChains: FittedBezierChain[] = [];
        for (let j = 0; j < junctionPositions.length; j++) {
          const idxStart = junctionPositions[j];
          const idxEnd = junctionPositions[(j + 1) % junctionPositions.length];
          const chainEdges: CrackDirectedEdge[] = [];
          let k = idxStart;
          while (true) {
            chainEdges.push(loop.edges[k]);
            k = (k + 1) % loop.edges.length;
            if (k === idxEnd) break;
            if (chainEdges.length > loop.edges.length) break;
          }

          // Subdivide também caso `outsideLabel` mude sem vértice marcado
          let subStart = 0;
          for (let s = 1; s <= chainEdges.length; s++) {
            if (
              s === chainEdges.length ||
              chainEdges[s].outsideLabel !== chainEdges[subStart].outsideLabel
            ) {
              const piece = chainEdges.slice(subStart, s);
              fittedChains.push(fitOrReuseSharedOpenChain(piece));
              subStart = s;
            }
          }
        }

        const dStr = serializeChainsLoopToPathD(fittedChains, precision);
        if (dStr) subpathsD.push(dStr);
      }
    }

    if (subpathsD.length > 0) {
      geometriesByRegion.set(regionId, {
        regionId,
        outerLoopCount,
        holeLoopCount,
        usesEvenOdd: holeLoopCount > 0 || outerLoopCount > 1,
        pathD: subpathsD.join(' '),
      });
    }
  }

  return {
    geometriesByRegion,
    sharedCanonicalChainCount: canonicalChainCache.size,
    junctionVertexCount,
  };
}
