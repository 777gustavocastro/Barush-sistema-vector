import {
  fitAdaptiveBezierChain,
  reverseFittedBezierChain,
  serializeChainsLoopToPathD,
  tuckInternalChainUnderOpaqueNeighbor,
  type AdaptiveCurveFitOptions,
  type FittedBezierChain,
} from '../geometry/adaptiveBezierFitter';
import {
  computeExactSubpixelEdgeNormalShift,
  reconstructSubpixelChainTargets,
  type CrackEdgeDescriptor,
  type SubpixelEdgeInput,
} from '../geometry/subpixelEdgeLocalizer';
import {
  oklabScaledToSrgb8,
  type PerceptualOklabBuffers,
} from '../color/perceptualColor';
import { isAuditActive, noteTopology } from '../audit/pipelineAudit';

interface CrackDirectedEdge extends CrackEdgeDescriptor {
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
  meanAlpha?: number;
  hasThickInterior?: boolean;
}

export interface PlanarTopologyBuildInput {
  width: number;
  height: number;
  labelMap: Int32Array;
  oklab: PerceptualOklabBuffers;
  alphaBytes: Uint8Array;
  hasUniformBg: boolean;
  backgroundOklab: [number, number, number] | null;
  backgroundRgb?: [number, number, number] | null;
  regionMeta: Map<number, RegionTopologyMetadata>;
  regionBoundaryBiasPx?: Map<number, number>;
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
 * 3. Localiza bordas sub-pixel locais em espaço de luz linear/sRGB sem viés de gama;
 * 4. Ajusta CADA fronteira compartilhada UMA ÚNICA VEZ em sub-pixel e reutiliza a curva Bézier
 *    exata invertida na região vizinha (zero fendas, zero sobreposições indevidas, zero vazamentos);
 * 5. Preserva todos os espaços vazios/buracos reais (`fill-rule="evenodd"`).
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
    backgroundRgb,
    regionMeta,
    regionBoundaryBiasPx,
    curveOptions = {},
    enablePorterDuffSeamTuck = true,
  } = input;

  const gridW = width + 1;
  const gridH = height + 1;
  const totalGridVerts = gridW * gridH;

  const resolvedBgRgb: [number, number, number] | null =
    backgroundRgb ??
    (backgroundOklab
      ? oklabScaledToSrgb8(backgroundOklab[0], backgroundOklab[1], backgroundOklab[2])
      : null);

  const regionMeanOklab = new Map<number, [number, number, number]>();
  const regionMeanAlpha = new Map<number, number>();
  for (const [rid, meta] of regionMeta.entries()) {
    regionMeanOklab.set(rid, meta.meanOklab);
    if (meta.meanAlpha !== undefined) {
      regionMeanAlpha.set(rid, meta.meanAlpha);
    }
  }

  const subpixelInput: SubpixelEdgeInput = {
    width,
    height,
    labelMap,
    oklab,
    rgbaBytes: alphaBytes,
    hasUniformBg,
    backgroundOklab,
    backgroundRgb: resolvedBgRgb,
    regionMeanOklab,
    regionMeanAlpha,
    regionBoundaryBiasPx,
  };

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

      let distinct = 1;
      if (lNE !== lNW) distinct++;
      if (lSW !== lNW && lSW !== lNE) distinct++;
      if (lSE !== lNW && lSE !== lNE && lSE !== lSW) distinct++;

      const isDiagonalSaddle = lNW === lSE && lNE === lSW && lNW !== lNE;

      if (distinct >= 3 || isDiagonalSaddle) {
        isJunctionVertex[vy * gridW + vx] = 1;
        junctionVertexCount++;
      }
    }
  }

  // 1B. Calcula posição sub-pixel globalmente única para cada vértice de junção (elimina degraus em T-junctions sobre círculos/contornos!)
  const junctionSubpixelCoords = new Map<number, { x: number; y: number }>();
  subpixelInput.junctionSubpixelCoords = junctionSubpixelCoords;

  const measureHorizCrackDy = (cx: number, cy: number): number | null => {
    if (cx < 0 || cx >= width) return null;
    const lUp = getLabel(cx, cy - 1);
    const lDn = getLabel(cx, cy);
    if (lUp === lDn) return null;
    const upPx = cy - 1 >= 0 && cy - 1 < height ? (cy - 1) * width + cx : -1;
    const dnPx = cy >= 0 && cy < height ? cy * width + cx : -1;
    if (lDn > 0 && dnPx >= 0) {
      const s = computeExactSubpixelEdgeNormalShift(
        {
          fromVid: cy * gridW + cx,
          toVid: cy * gridW + cx + 1,
          dir: 0,
          insideLabel: lDn,
          outsideLabel: lUp,
          inPx: dnPx,
          outPx: upPx,
        },
        subpixelInput
      );
      return -s; // dir=0 tem normal externa (0, -1)
    }
    if (lUp > 0 && upPx >= 0) {
      const s = computeExactSubpixelEdgeNormalShift(
        {
          fromVid: cy * gridW + cx + 1,
          toVid: cy * gridW + cx,
          dir: 2,
          insideLabel: lUp,
          outsideLabel: lDn,
          inPx: upPx,
          outPx: dnPx,
        },
        subpixelInput
      );
      return s; // dir=2 tem normal externa (0, +1)
    }
    return null;
  };

  const measureVertCrackDx = (cx: number, cy: number): number | null => {
    if (cy < 0 || cy >= height) return null;
    const lLt = getLabel(cx - 1, cy);
    const lRt = getLabel(cx, cy);
    if (lLt === lRt) return null;
    const ltPx = cx - 1 >= 0 && cx - 1 < width ? cy * width + (cx - 1) : -1;
    const rtPx = cx >= 0 && cx < width ? cy * width + cx : -1;
    if (lLt > 0 && ltPx >= 0) {
      const s = computeExactSubpixelEdgeNormalShift(
        {
          fromVid: cy * gridW + cx,
          toVid: (cy + 1) * gridW + cx,
          dir: 1,
          insideLabel: lLt,
          outsideLabel: lRt,
          inPx: ltPx,
          outPx: rtPx,
        },
        subpixelInput
      );
      return s; // dir=1 tem normal externa (+1, 0)
    }
    if (lRt > 0 && rtPx >= 0) {
      const s = computeExactSubpixelEdgeNormalShift(
        {
          fromVid: (cy + 1) * gridW + cx,
          toVid: cy * gridW + cx,
          dir: 3,
          insideLabel: lRt,
          outsideLabel: lLt,
          inPx: rtPx,
          outPx: ltPx,
        },
        subpixelInput
      );
      return -s; // dir=3 tem normal externa (-1, 0)
    }
    return null;
  };

  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const vid = vy * gridW + vx;
      if (!isJunctionVertex[vid]) continue;
      // Mantém bordas extremas do canvas cravadas exatamente no limite do viewBox
      if (vx === 0 || vx === width || vy === 0 || vy === height) {
        junctionSubpixelCoords.set(vid, { x: vx, y: vy });
        continue;
      }

      const dyW = measureHorizCrackDy(vx - 1, vy);
      const dyE = measureHorizCrackDy(vx, vy);
      const dxN = measureVertCrackDx(vx, vy - 1);
      const dxS = measureVertCrackDx(vx, vy);

      let dx = 0;
      let dxCnt = 0;
      if (dxN !== null) {
        dx += dxN;
        dxCnt++;
      }
      if (dxS !== null) {
        dx += dxS;
        dxCnt++;
      }

      let dy = 0;
      let dyCnt = 0;
      if (dyW !== null) {
        dy += dyW;
        dyCnt++;
      }
      if (dyE !== null) {
        dy += dyE;
        dyCnt++;
      }

      const finalDx = dxCnt > 0 ? Math.max(-0.42, Math.min(0.42, dx / dxCnt)) : 0;
      const finalDy = dyCnt > 0 ? Math.max(-0.42, Math.min(0.42, dy / dyCnt)) : 0;
      junctionSubpixelCoords.set(vid, { x: vx + finalDx, y: vy + finalDy });
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

  // 4. Cache Canônico de Cadeias Compartilhadas (garante que (A,B) e (B,A) compartilhem a EXATA MESMA curva Bézier!)
  const canonicalChainCache = new Map<string, FittedBezierChain>();

  const fitOrReuseSharedOpenChain = (chainEdges: CrackDirectedEdge[]): FittedBezierChain => {
    const inside = chainEdges[0].insideLabel;
    const outside = chainEdges[0].outsideLabel;

    if (outside === 0) {
      const { basePts, targetPts } = reconstructSubpixelChainTargets(
        chainEdges,
        gridW,
        false,
        subpixelInput
      );
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
      const { basePts, targetPts } = reconstructSubpixelChainTargets(
        chainEdges,
        gridW,
        false,
        subpixelInput
      );
      const fittedCurrent = fitAdaptiveBezierChain(basePts, targetPts, false, curveOptions);
      canonChain = inside === rMin ? fittedCurrent : reverseFittedBezierChain(fittedCurrent);
      canonicalChainCache.set(cacheKey, canonChain);
    }

    let oriented = inside === rMin ? canonChain : reverseFittedBezierChain(canonChain);

    // Micro-encaixe controlado (0.16px) APENAS sob regiões opacas com núcleo espesso (nunca sob contornos finos <= 2.5px!)
    if (enablePorterDuffSeamTuck && chainEdges.length >= 3) {
      const inMeta = regionMeta.get(inside);
      const outMeta = regionMeta.get(outside);
      const outIsThick = outMeta?.hasThickInterior !== false;
      if (
        inMeta &&
        outMeta &&
        inMeta.zRank < outMeta.zRank &&
        !outMeta.isSemiTransparent &&
        outIsThick
      ) {
        oriented = tuckInternalChainUnderOpaqueNeighbor(oriented, 0.16);
      }
    }

    return oriented;
  };

  const fitOrReuseSharedClosedLoop = (loopEdges: CrackDirectedEdge[]): FittedBezierChain => {
    const inside = loopEdges[0].insideLabel;
    const outside = loopEdges[0].outsideLabel;

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
      const { basePts, targetPts } = reconstructSubpixelChainTargets(
        orderedEdges,
        gridW,
        true,
        subpixelInput
      );
      return fitAdaptiveBezierChain(basePts, targetPts, true, curveOptions);
    }

    const rMin = Math.min(inside, outside);
    const rMax = Math.max(inside, outside);
    const cacheKey = `C:${rMin}:${rMax}:${minVid}:${orderedEdges.length}`;

    let canonClosed = canonicalChainCache.get(cacheKey);
    if (!canonClosed) {
      const { basePts, targetPts } = reconstructSubpixelChainTargets(
        orderedEdges,
        gridW,
        true,
        subpixelInput
      );
      const fitted = fitAdaptiveBezierChain(basePts, targetPts, true, curveOptions);
      canonClosed = inside === rMin ? fitted : reverseFittedBezierChain(fitted);
      canonicalChainCache.set(cacheKey, canonClosed);
    }

    return inside === rMin ? canonClosed : reverseFittedBezierChain(canonClosed);
  };

  // 5. Monta a geometria vetorial final `d` de cada região respeitando ilhas e furos reais!
  const geometriesByRegion = new Map<number, RegionVectorGeometry>();
  const precision = curveOptions.precision ?? 3;

  for (const [regionId, loops] of loopsByRegion.entries()) {
    const subpathsD: string[] = [];
    let outerLoopCount = 0;
    let holeLoopCount = 0;
    const myMeta = regionMeta.get(regionId);

    for (const loop of loops) {
      if (!loop.isOuter) {
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
          continue;
        }
        holeLoopCount++;
      } else {
        outerLoopCount++;
      }

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

  if (isAuditActive()) {
    let holes = 0;
    let evenOdd = 0;
    let openFilled = 0;
    for (const geom of geometriesByRegion.values()) {
      holes += geom.holeLoopCount;
      if (geom.usesEvenOdd) evenOdd++;
      if (geom.pathD && !/\bZ\b/i.test(geom.pathD)) openFilled++;
    }
    noteTopology({
      regionsWithPath: geometriesByRegion.size,
      sharedBoundaries: canonicalChainCache.size,
      holes,
      evenOddRegions: evenOdd,
      openFilledPaths: openFilled,
      junctionVertices: junctionVertexCount,
      tuckEnabled: enablePorterDuffSeamTuck,
    });
  }

  return {
    geometriesByRegion,
    sharedCanonicalChainCount: canonicalChainCache.size,
    junctionVertexCount,
  };
}
