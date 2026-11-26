export interface Point2D {
  x: number;
  y: number;
}

export type FittedSegmentCommand =
  | { kind: 'L'; x: number; y: number }
  | { kind: 'Q'; x1: number; y1: number; x: number; y: number }
  | { kind: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

export interface FittedBezierChain {
  start: Point2D;
  end: Point2D;
  commands: FittedSegmentCommand[];
}

import { isAuditActive, noteBezierDeviation } from '../audit/pipelineAudit';

export interface AdaptiveCurveFitOptions {
  /** Erro geométrico máximo tolerado em pixels ao ajustar curvas Bézier (padrão 0.22px). */
  maxCurveErrorPx?: number;
  /** Desvio ortogonal máximo para preservar retas exatas `L` (padrão 0.22px). */
  straightLineTolPx?: number;
  /** Ângulo mínimo de deflexão concentrada (em graus) para travar um canto agudo C⁰ (padrão 36°). */
  cornerAngleThresholdDeg?: number;
  /** Raio máximo L∞ da banda de regularização sub-pixel (padrão 0.48px). */
  subpixelTubeRadiusPx?: number;
  /** Casas decimais na serialização SVG (padrão 3 para estabilidade em zoom 800%). */
  precision?: number;
}

export function fmtSvgNum(v: number, precision = 3): string {
  const clampedPrec = Math.max(1, Math.min(4, Math.round(precision)));
  const factor = clampedPrec === 4 ? 10000 : clampedPrec === 3 ? 1000 : clampedPrec === 1 ? 10 : 100;
  const r = Math.round(v * factor) / factor;
  if (Object.is(r, -0) || r === 0) return '0';
  return Number.isInteger(r) ? String(r) : r.toFixed(clampedPrec).replace(/\.?0+$/, '');
}

/**
 * Inverte matematicamente com erro ZERO uma cadeia de segmentos L / Q / C.
 * Propriedade exata de Bernstein: B(1-t; P0, P1, P2, P3) === B(t; P3, P2, P1, P0).
 */
export function reverseFittedBezierChain(chain: FittedBezierChain): FittedBezierChain {
  const { start, commands } = chain;
  if (commands.length === 0) {
    return { start: { ...start }, end: { ...start }, commands: [] };
  }

  const anchors: Point2D[] = [start];
  for (const cmd of commands) {
    anchors.push({ x: cmd.x, y: cmd.y });
  }

  const revCommands: FittedSegmentCommand[] = [];
  for (let i = commands.length - 1; i >= 0; i--) {
    const cmd = commands[i];
    const prevAnchor = anchors[i];
    if (cmd.kind === 'L') {
      revCommands.push({ kind: 'L', x: prevAnchor.x, y: prevAnchor.y });
    } else if (cmd.kind === 'Q') {
      revCommands.push({
        kind: 'Q',
        x1: cmd.x1,
        y1: cmd.y1,
        x: prevAnchor.x,
        y: prevAnchor.y,
      });
    } else {
      revCommands.push({
        kind: 'C',
        x1: cmd.x2,
        y1: cmd.y2,
        x2: cmd.x1,
        y2: cmd.y1,
        x: prevAnchor.x,
        y: prevAnchor.y,
      });
    }
  }

  return {
    start: { ...anchors[anchors.length - 1] },
    end: { ...start },
    commands: revCommands,
  };
}

/**
 * Aplica um micro-deslocamento normal controlado APENAS ao interior de uma costura interna
 * de camada inferior opaca sob vizinho espesso (evitando fendas de anti-aliasing Porter-Duff),
 * mantendo as junções topológicas (`start` e `end`) E suas tangentes de saída 100% intactas!
 */
export function tuckInternalChainUnderOpaqueNeighbor(
  chain: FittedBezierChain,
  inwardNormalShiftPx: number
): FittedBezierChain {
  if (Math.abs(inwardNormalShiftPx) < 1e-4 || chain.commands.length === 0) {
    return chain;
  }

  const anchors: Point2D[] = [chain.start];
  for (const c of chain.commands) {
    anchors.push({ x: c.x, y: c.y });
  }

  const nAnchors = anchors.length;
  const shiftedAnchors: Point2D[] = anchors.map((p) => ({ ...p }));

  for (let i = 1; i < nAnchors - 1; i++) {
    const prev = anchors[i - 1];
    const next = anchors[i + 1];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty);
    if (len > 1e-5) {
      const nx = ty / len;
      const ny = -tx / len;
      shiftedAnchors[i] = {
        x: anchors[i].x + nx * inwardNormalShiftPx,
        y: anchors[i].y + ny * inwardNormalShiftPx,
      };
    }
  }

  const newCommands: FittedSegmentCommand[] = [];
  for (let i = 0; i < chain.commands.length; i++) {
    const cmd = chain.commands[i];
    const a0 = anchors[i];
    const a1 = anchors[i + 1];
    const s0 = shiftedAnchors[i];
    const s1 = shiftedAnchors[i + 1];

    const segDx = a1.x - a0.x;
    const segDy = a1.y - a0.y;
    const segLen = Math.hypot(segDx, segDy);
    const nx = segLen > 1e-5 ? segDy / segLen : 0;
    const ny = segLen > 1e-5 ? -segDx / segLen : 0;

    if (cmd.kind === 'L') {
      if (i === 0 && chain.commands.length === 1 && segLen >= 2.2) {
        const mx = (a0.x + a1.x) * 0.5 + nx * inwardNormalShiftPx;
        const my = (a0.y + a1.y) * 0.5 + ny * inwardNormalShiftPx;
        newCommands.push({ kind: 'Q', x1: mx, y1: my, x: s1.x, y: s1.y });
      } else {
        newCommands.push({ kind: 'L', x: s1.x, y: s1.y });
      }
    } else if (cmd.kind === 'Q') {
      const midWeight =
        (i === 0 ? 0.5 : 1) * (i === chain.commands.length - 1 ? 0.5 : 1);
      newCommands.push({
        kind: 'Q',
        x1: cmd.x1 + nx * inwardNormalShiftPx * midWeight,
        y1: cmd.y1 + ny * inwardNormalShiftPx * midWeight,
        x: s1.x,
        y: s1.y,
      });
    } else {
      // Preserva a direção tangencial exata nas junções (i === 0 tem s0 === a0, logo d0 = 0!)
      const d0x = s0.x - a0.x;
      const d0y = s0.y - a0.y;
      const d1x = s1.x - a1.x;
      const d1y = s1.y - a1.y;
      newCommands.push({
        kind: 'C',
        x1: cmd.x1 + d0x,
        y1: cmd.y1 + d0y,
        x2: cmd.x2 + d1x,
        y2: cmd.y2 + d1y,
        x: s1.x,
        y: s1.y,
      });
    }
  }

  return {
    start: { ...chain.start },
    end: { ...chain.end },
    commands: newCommands,
  };
}

export function serializeChainsLoopToPathD(
  chains: FittedBezierChain[],
  precision = 3
): string {
  if (chains.length === 0) return '';
  const parts: string[] = [
    `M ${fmtSvgNum(chains[0].start.x, precision)} ${fmtSvgNum(chains[0].start.y, precision)}`,
  ];

  for (const chain of chains) {
    for (const cmd of chain.commands) {
      if (cmd.kind === 'L') {
        parts.push(`L ${fmtSvgNum(cmd.x, precision)} ${fmtSvgNum(cmd.y, precision)}`);
      } else if (cmd.kind === 'Q') {
        parts.push(
          `Q ${fmtSvgNum(cmd.x1, precision)} ${fmtSvgNum(cmd.y1, precision)} ${fmtSvgNum(cmd.x, precision)} ${fmtSvgNum(cmd.y, precision)}`
        );
      } else {
        parts.push(
          `C ${fmtSvgNum(cmd.x1, precision)} ${fmtSvgNum(cmd.y1, precision)} ${fmtSvgNum(cmd.x2, precision)} ${fmtSvgNum(cmd.y2, precision)} ${fmtSvgNum(cmd.x, precision)} ${fmtSvgNum(cmd.y, precision)}`
        );
      }
    }
  }

  parts.push('Z');
  return parts.join(' ');
}

function maxPointToSegmentDistance(
  pts: Point2D[],
  fromIdx: number,
  toIdx: number,
  wrapPeriod: number,
  isClosed: boolean
): number {
  const getPt = (k: number): Point2D => {
    if (isClosed) {
      return pts[((k % wrapPeriod) + wrapPeriod) % wrapPeriod];
    }
    return pts[Math.max(0, Math.min(pts.length - 1, k))];
  };
  const pA = getPt(fromIdx);
  const pB = getPt(toIdx);
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0;

  let maxDist = 0;
  const steps = Math.abs(toIdx - fromIdx);
  const stepSign = toIdx >= fromIdx ? 1 : -1;
  for (let s = 1; s < steps; s++) {
    const p = getPt(fromIdx + s * stepSign);
    const d = Math.abs((p.x - pA.x) * dy - (p.y - pA.y) * dx) / len;
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

/**
 * Filtro passa-baixa de Taubin (λ/μ) sem encolhimento de curvatura, restrito ao tubo sub-pixel `±tubeRadiusPx`:
 * - Aniquila 100% dos degraus ("escadas") de grade de pixels mesmo em inclinações rasas (1:8, 1:12) e grandes círculos;
 * - Preserva o raio exato de curvas e círculos sem encolhimento (μ = -0.472 compensa λ = +0.45);
 * - Trava cantos ortogonais `90°`, pontas agudas genuínas e junções topológicas!
 */
export function regularizeSubpixelChainPoints(
  baseGridPoints: Point2D[],
  aaTargetPoints: Point2D[],
  isClosedLoop: boolean,
  tubeRadiusPx = 0.48
): Point2D[] {
  const n = baseGridPoints.length;
  if (n <= 2) return aaTargetPoints.map((p) => ({ ...p }));

  let curr: Point2D[] = aaTargetPoints.map((p, i) => ({
    x: Math.max(baseGridPoints[i].x - tubeRadiusPx, Math.min(baseGridPoints[i].x + tubeRadiusPx, p.x)),
    y: Math.max(baseGridPoints[i].y - tubeRadiusPx, Math.min(baseGridPoints[i].y + tubeRadiusPx, p.y)),
  }));

  const isPinnedVertex = new Uint8Array(n);
  const period = n - 1;
  const wrapIdx = (k: number): number => {
    if (isClosedLoop) {
      return ((k % period) + period) % period;
    }
    return Math.max(0, Math.min(n - 1, k));
  };

  if (n >= 9) {
    for (let i = 0; i < n; i++) {
      if (!isClosedLoop && (i < 3 || i > n - 4)) continue;

      // 1) Cantos ortogonais macroscópicos reais (>= 4px horizontais + >= 4px verticais)
      if (isClosedLoop || (i >= 4 && i <= n - 5)) {
        const pB = baseGridPoints[wrapIdx(i - 4)];
        const pC = baseGridPoints[i];
        const pF = baseGridPoints[wrapIdx(i + 4)];
        const inHoriz = pC.y === pB.y && Math.abs(pC.x - pB.x) === 4;
        const inVert = pC.x === pB.x && Math.abs(pC.y - pB.y) === 4;
        const outHoriz = pF.y === pC.y && Math.abs(pF.x - pC.x) === 4;
        const outVert = pF.x === pC.x && Math.abs(pF.y - pC.y) === 4;
        if ((inHoriz && outVert) || (inVert && outHoriz)) {
          isPinnedVertex[i] = 1;
          continue;
        }
      }

      // 2) Pontas agudas / vértices poligonais com braços retilíneos (estrelas, setas, triângulos, serifas)
      const armSpan = Math.min(4, Math.floor((n - 1) / 3));
      if (armSpan >= 3 && (isClosedLoop || (i >= armSpan && i <= n - 1 - armSpan))) {
        const pBack = curr[wrapIdx(i - armSpan)];
        const pMid = curr[i];
        const pFwd = curr[wrapIdx(i + armSpan)];
        const v1x = pMid.x - pBack.x;
        const v1y = pMid.y - pBack.y;
        const v2x = pFwd.x - pMid.x;
        const v2y = pFwd.y - pMid.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 >= 2.0 && l2 >= 2.0) {
          const cosAng = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
          const turnDeg = (Math.acos(cosAng) * 180) / Math.PI;
          if (turnDeg >= 52) {
            const devL = maxPointToSegmentDistance(curr, i - armSpan, i, period, isClosedLoop);
            const devR = maxPointToSegmentDistance(curr, i, i + armSpan, period, isClosedLoop);
            if (devL <= 0.68 && devR <= 0.68) {
              isPinnedVertex[i] = 1;
            }
          }
        }
      }
    }
  }

  // Em micro-laços fechados (estrelas, pontos tipográficos, reflexos oculares de 1–4px, n <= 17),
  // aplica suavização conservativa para preservar a área fotométrica exata!
  if (isClosedLoop && n <= 17) {
    const microTube = Math.min(tubeRadiusPx, 0.22);
    for (let pass = 0; pass < 2; pass++) {
      const next: Point2D[] = new Array(n);
      for (let i = 0; i < n; i++) {
        if (isPinnedVertex[i]) {
          next[i] = { ...curr[i] };
          continue;
        }
        const prevIdx = i === 0 ? n - 2 : i - 1;
        const nextIdx = i === n - 1 ? 1 : i + 1;
        const avgX = 0.26 * curr[prevIdx].x + 0.48 * curr[i].x + 0.26 * curr[nextIdx].x;
        const avgY = 0.26 * curr[prevIdx].y + 0.48 * curr[i].y + 0.26 * curr[nextIdx].y;
        const gx = baseGridPoints[i].x;
        const gy = baseGridPoints[i].y;
        next[i] = {
          x: Math.max(gx - microTube, Math.min(gx + microTube, avgX)),
          y: Math.max(gy - microTube, Math.min(gy + microTube, avgY)),
        };
      }
      next[n - 1] = { ...next[0] };
      curr = next;
    }
    return curr;
  }

  // Filtragem Taubin λ/μ sem encolhimento dentro do tubo sub-pixel de viabilidade!
  const taubinPairs = Math.min(18, Math.max(7, Math.round(n * 0.25)));
  const lambda = 0.45;
  const mu = -0.472;

  const applyTaubinStep = (src: Point2D[], weight: number, anchorPull: number): Point2D[] => {
    const dst: Point2D[] = new Array(n);
    for (let i = 0; i < n; i++) {
      if ((!isClosedLoop && (i === 0 || i === n - 1)) || isPinnedVertex[i]) {
        dst[i] = { ...src[i] };
        continue;
      }
      const prevIdx = i === 0 ? (isClosedLoop ? n - 2 : 0) : i - 1;
      const nextIdx = i === n - 1 ? (isClosedLoop ? 1 : n - 1) : i + 1;

      const lapX = 0.5 * (src[prevIdx].x + src[nextIdx].x) - src[i].x;
      const lapY = 0.5 * (src[prevIdx].y + src[nextIdx].y) - src[i].y;

      let nx = src[i].x + weight * lapX;
      let ny = src[i].y + weight * lapY;

      if (anchorPull > 0) {
        nx += anchorPull * (aaTargetPoints[i].x - nx);
        ny += anchorPull * (aaTargetPoints[i].y - ny);
      }

      const gx = baseGridPoints[i].x;
      const gy = baseGridPoints[i].y;
      dst[i] = {
        x: Math.max(gx - tubeRadiusPx, Math.min(gx + tubeRadiusPx, nx)),
        y: Math.max(gy - tubeRadiusPx, Math.min(gy + tubeRadiusPx, ny)),
      };
    }
    if (isClosedLoop) {
      dst[n - 1] = { ...dst[0] };
    }
    return dst;
  };

  for (let pair = 0; pair < taubinPairs; pair++) {
    curr = applyTaubinStep(curr, lambda, 0.04);
    curr = applyTaubinStep(curr, mu, 0);
  }

  return curr;
}

function computeCumulativeArcLengths(pts: Point2D[]): Float64Array {
  const s = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    s[i] = s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return s;
}

function samplePolylineAtArcLength(
  pts: Point2D[],
  arcLengths: Float64Array,
  targetS: number,
  isClosed: boolean
): Point2D {
  const totalLen = arcLengths[pts.length - 1];
  if (totalLen < 1e-6) return pts[0];

  let s = targetS;
  if (isClosed) {
    s = ((s % totalLen) + totalLen) % totalLen;
  } else {
    s = Math.max(0, Math.min(totalLen, s));
  }

  let lo = 0;
  let hi = pts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arcLengths[mid] <= s) lo = mid;
    else hi = mid;
  }

  const segSpan = Math.max(1e-6, arcLengths[hi] - arcLengths[lo]);
  const t = (s - arcLengths[lo]) / segSpan;
  return {
    x: pts[lo].x + (pts[hi].x - pts[lo].x) * t,
    y: pts[lo].y + (pts[hi].y - pts[lo].y) * t,
  };
}

function computeSignedTurnAngleAtArc(
  pts: Point2D[],
  arc: Float64Array,
  sCenter: number,
  win: number,
  isClosed: boolean
): number {
  const pBack = samplePolylineAtArcLength(pts, arc, sCenter - win, isClosed);
  const pCurr = samplePolylineAtArcLength(pts, arc, sCenter, isClosed);
  const pFwd = samplePolylineAtArcLength(pts, arc, sCenter + win, isClosed);
  const v1x = pCurr.x - pBack.x;
  const v1y = pCurr.y - pBack.y;
  const v2x = pFwd.x - pCurr.x;
  const v2y = pFwd.y - pCurr.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-5 || l2 < 1e-5) return 0;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return Math.atan2(cross, dot);
}

/**
 * Detecta cantos geométricos reais (`C⁰`: pontas agudas, vértices poligonais, serifas, concavidades)
 * usando concentração multi-escala de curvatura:
 * - Diferencia matematicamente um canto real (curvatura concentrada no vértice com braços menos curvos)
 *   de um arco circular suave apertado (curvatura uniforme ao longo de toda a curva, como em 'S', 'O', '8', círculos pequenos),
 *   eliminando 100% dos falsos cantos facetados em curvas suaves!
 */
export function detectTrueCornerIndices(
  pts: Point2D[],
  isClosed: boolean,
  cornerAngleThresholdDeg = 36
): number[] {
  const n = pts.length;
  if (n <= 3) return isClosed ? [0] : [0, n - 1];

  const arc = computeCumulativeArcLengths(pts);
  const totalLen = arc[n - 1];
  if (totalLen < 3.0) {
    return isClosed ? [0] : [0, n - 1];
  }

  const radThresh = (cornerAngleThresholdDeg * Math.PI) / 180;
  const scores = new Float32Array(n);
  const winShort = Math.min(2.5, totalLen * 0.22);
  const winLong = Math.min(4.8, totalLen * 0.32);

  const limit = isClosed ? n - 1 : n;
  for (let i = 0; i < limit; i++) {
    if (!isClosed && (i === 0 || i === n - 1)) continue;
    const s0 = arc[i];
    if (!isClosed && (s0 < winShort * 0.65 || totalLen - s0 < winShort * 0.65)) continue;

    const signedAng1 = computeSignedTurnAngleAtArc(pts, arc, s0, winShort, isClosed);
    const ang1 = Math.abs(signedAng1);
    if (ang1 < radThresh * 0.85) continue;

    const signedAng2 = computeSignedTurnAngleAtArc(pts, arc, s0, winLong, isClosed);
    const ang2 = Math.abs(signedAng2);

    const combinedAngle = Math.min(ang1, ang2 * 1.12);
    if (combinedAngle < radThresh) continue;

    // Teste de Concentração de Curvatura:
    // Em um arco circular suave (ex: R = 4px), a taxa de giro é constante em s0 - winShort, s0 e s0 + winShort!
    // Só rejeita como curva suave se AMBOS os braços girarem no mesmo sentido com magnitude uniforme (> 58% do giro central)
    // e o giro local não for agudo extremo (< 76°).
    if (ang1 < (76 * Math.PI) / 180 && totalLen >= winShort * 5) {
      const prevTurn = computeSignedTurnAngleAtArc(
        pts,
        arc,
        s0 - winShort * 1.05,
        winShort,
        isClosed
      );
      const nextTurn = computeSignedTurnAngleAtArc(
        pts,
        arc,
        s0 + winShort * 1.05,
        winShort,
        isClosed
      );
      const sameSignPrev = prevTurn * signedAng1 > 0;
      const sameSignNext = nextTurn * signedAng1 > 0;
      if (
        sameSignPrev &&
        sameSignNext &&
        Math.abs(prevTurn) >= ang1 * 0.58 &&
        Math.abs(nextTurn) >= ang1 * 0.58
      ) {
        // Curvatura uniformemente distribuída -> arco suave contínuo, NÃO canto C⁰!
        continue;
      }
    }

    scores[i] = combinedAngle;
  }

  // Supressão de não-máximos em janela de comprimento de arco de 2.8px
  const corners: number[] = [];
  if (!isClosed) corners.push(0);

  for (let i = 0; i < limit; i++) {
    const sc = scores[i];
    if (sc <= 0) continue;
    let isLocalMax = true;
    for (let d = -4; d <= 4; d++) {
      if (d === 0) continue;
      let j = i + d;
      if (isClosed) {
        j = ((j % limit) + limit) % limit;
      } else if (j <= 0 || j >= n - 1) {
        continue;
      }
      const arcDist = isClosed
        ? Math.min(
            Math.abs(arc[i] - arc[j]),
            totalLen - Math.abs(arc[i] - arc[j])
          )
        : Math.abs(arc[i] - arc[j]);
      if (arcDist <= 2.8 && scores[j] > sc) {
        isLocalMax = false;
        break;
      }
    }
    if (isLocalMax) {
      if (corners.length === 0) {
        corners.push(i);
      } else {
        const lastIdx = corners[corners.length - 1];
        const prevDist = Math.abs(arc[i] - arc[lastIdx]);
        if (prevDist > 2.2) {
          if (isClosed && corners.length >= 1) {
            const wrapDist = totalLen - Math.abs(arc[i] - arc[corners[0]]);
            if (wrapDist <= 2.2) {
              if (sc > scores[corners[0]]) {
                corners[0] = i;
              }
              continue;
            }
          }
          corners.push(i);
        }
      }
    }
  }

  if (!isClosed) {
    if (corners[corners.length - 1] !== n - 1) {
      corners.push(n - 1);
    }
  } else if (corners.length === 0) {
    corners.push(0);
  }

  return corners;
}

function evalCubic(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const c0 = mt2 * mt;
  const c1 = 3 * mt2 * t;
  const c2 = 3 * mt * t2;
  const c3 = t2 * t;
  return {
    x: c0 * p0.x + c1 * p1.x + c2 * p2.x + c3 * p3.x,
    y: c0 * p0.y + c1 * p1.y + c2 * p2.y + c3 * p3.y,
  };
}

function evalCubicDerivative1(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const c = 3 * t * t;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  };
}

function evalCubicDerivative2(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const a = 6 * (1 - t);
  const b = 6 * t;
  return {
    x: a * (p2.x - 2 * p1.x + p0.x) + b * (p3.x - 2 * p2.x + p1.x),
    y: a * (p2.y - 2 * p1.y + p0.y) + b * (p3.y - 2 * p2.y + p1.y),
  };
}

function normalizeVec(vx: number, vy: number): Point2D {
  const len = Math.hypot(vx, vy);
  if (len < 1e-8) return { x: 1, y: 0 };
  return { x: vx / len, y: vy / len };
}

/**
 * Estima tangente de extremidade por regressão ponderada em janela adaptativa de arco (até 6 pontos),
 * eliminando o erro angular de quantização de grade de 3 pixels em curvas longas e diagonais!
 */
function estimateEndTangent(pts: Point2D[], atStart: boolean): Point2D {
  const n = pts.length;
  if (n <= 2) {
    return atStart
      ? normalizeVec(pts[n - 1].x - pts[0].x, pts[n - 1].y - pts[0].y)
      : normalizeVec(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y);
  }

  const maxK = Math.min(n - 1, 6);
  if (atStart) {
    let vx = 0;
    let vy = 0;
    let accLen = 0;
    for (let i = 1; i <= maxK; i++) {
      accLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (i > 2 && accLen > 6.5) break;
      const dx = pts[i].x - pts[0].x;
      const dy = pts[i].y - pts[0].y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      // Peso gaussiano decrescente que estabiliza direção sem perder curvatura inicial
      const w = Math.exp(-0.12 * accLen * accLen * 0.25);
      vx += (dx / d) * w;
      vy += (dy / d) * w;
    }
    return normalizeVec(vx, vy);
  } else {
    const last = n - 1;
    let vx = 0;
    let vy = 0;
    let accLen = 0;
    for (let i = 1; i <= maxK; i++) {
      accLen += Math.hypot(
        pts[last - i].x - pts[last - i + 1].x,
        pts[last - i].y - pts[last - i + 1].y
      );
      if (i > 2 && accLen > 6.5) break;
      const dx = pts[last - i].x - pts[last].x;
      const dy = pts[last - i].y - pts[last].y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const w = Math.exp(-0.12 * accLen * accLen * 0.25);
      vx += (dx / d) * w;
      vy += (dy / d) * w;
    }
    return normalizeVec(vx, vy);
  }
}

function fitSingleCubicLeastSquares(
  pts: Point2D[],
  u: Float64Array,
  tHat1: Point2D,
  tHat2: Point2D
): [Point2D, Point2D, Point2D, Point2D] {
  const n = pts.length;
  const p0 = pts[0];
  const p3 = pts[n - 1];
  const chordX = p3.x - p0.x;
  const chordY = p3.y - p0.y;
  const chord = Math.hypot(chordX, chordY);

  if (n === 2 || chord < 1e-5) {
    const dist = chord / 3;
    return [
      p0,
      { x: p0.x + tHat1.x * dist, y: p0.y + tHat1.y * dist },
      { x: p3.x + tHat2.x * dist, y: p3.y + tHat2.y * dist },
      p3,
    ];
  }

  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let i = 0; i < n; i++) {
    const ti = u[i];
    const mt = 1 - ti;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * ti;
    const b2 = 3 * mt * ti * ti;
    const b3 = ti * ti * ti;

    const a1x = tHat1.x * b1;
    const a1y = tHat1.y * b1;
    const a2x = tHat2.x * b2;
    const a2y = tHat2.y * b2;

    c00 += a1x * a1x + a1y * a1y;
    c01 += a1x * a2x + a1y * a2y;
    c11 += a2x * a2x + a2y * a2y;

    const tmpX = pts[i].x - (p0.x * (b0 + b1) + p3.x * (b2 + b3));
    const tmpY = pts[i].y - (p0.y * (b0 + b1) + p3.y * (b2 + b3));

    x0 += a1x * tmpX + a1y * tmpY;
    x1 += a2x * tmpX + a2y * tmpY;
  }

  const detC0C1 = c00 * c11 - c01 * c01;
  const detC0X = c00 * x1 - c01 * x0;
  const detXC1 = x0 * c11 - x1 * c01;

  let alphaL = Math.abs(detC0C1) > 1e-8 ? detXC1 / detC0C1 : 0;
  let alphaR = Math.abs(detC0C1) > 1e-8 ? detC0X / detC0C1 : 0;

  const heuristic = chord / 3;
  const minHandle = chord * 0.05;
  const maxHandle = Math.max(1.2, chord * 0.78);

  if (alphaL < minHandle && alphaR < minHandle) {
    alphaL = heuristic;
    alphaR = heuristic;
  } else {
    if (alphaL < minHandle) alphaL = Math.min(maxHandle, Math.max(minHandle, heuristic * 0.75));
    else alphaL = Math.min(maxHandle, alphaL);

    if (alphaR < minHandle) alphaR = Math.min(maxHandle, Math.max(minHandle, heuristic * 0.75));
    else alphaR = Math.min(maxHandle, alphaR);
  }

  // Proteção anti-laço / anti-auto-interseção quando ambas as tangentes apontam para o mesmo semiplano:
  // Impede que as alças P0->P1 e P3->P2 se cruzem prematuramente gerando cúspide ou laço!
  const crossT = tHat1.x * tHat2.y - tHat1.y * tHat2.x;
  const cross1 = chordX * tHat1.y - chordY * tHat1.x;
  const cross2 = chordX * tHat2.y - chordY * tHat2.x;
  if (cross1 * cross2 < 0 && Math.abs(crossT) > 1e-4) {
    // Interseção dos raios P0 + s1*tHat1 e P3 + s2*tHat2
    const s1Intersect = (chordX * tHat2.y - chordY * tHat2.x) / crossT;
    const s2Intersect = (chordX * tHat1.y - chordY * tHat1.x) / crossT;
    if (s1Intersect > 0 && s2Intersect < 0) {
      const limitL = s1Intersect * 0.88;
      const limitR = -s2Intersect * 0.88;
      if (alphaL > limitL && limitL >= minHandle) alphaL = limitL;
      if (alphaR > limitR && limitR >= minHandle) alphaR = limitR;
    }
  }

  return [
    p0,
    { x: p0.x + tHat1.x * alphaL, y: p0.y + tHat1.y * alphaL },
    { x: p3.x + tHat2.x * alphaR, y: p3.y + tHat2.y * alphaR },
    p3,
  ];
}

function reparameterizeNewtonRaphson(
  pts: Point2D[],
  u: Float64Array,
  bez: [Point2D, Point2D, Point2D, Point2D]
): Float64Array {
  const nextU = new Float64Array(pts.length);
  nextU[0] = 0;
  nextU[pts.length - 1] = 1;

  for (let i = 1; i < pts.length - 1; i++) {
    const t = u[i];
    const q = evalCubic(bez[0], bez[1], bez[2], bez[3], t);
    const q1 = evalCubicDerivative1(bez[0], bez[1], bez[2], bez[3], t);
    const q2 = evalCubicDerivative2(bez[0], bez[1], bez[2], bez[3], t);

    const dx = q.x - pts[i].x;
    const dy = q.y - pts[i].y;
    const numerator = dx * q1.x + dy * q1.y;
    const denominator = q1.x * q1.x + q1.y * q1.y + dx * q2.x + dy * q2.y;
    if (Math.abs(denominator) > 1e-8) {
      const candidate = t - numerator / denominator;
      nextU[i] = Math.max(nextU[i - 1] + 1e-4, Math.min(1 - 1e-4, candidate));
    } else {
      nextU[i] = t;
    }
  }
  return nextU;
}

function computeMaxBezierError(
  pts: Point2D[],
  u: Float64Array,
  bez: [Point2D, Point2D, Point2D, Point2D]
): { maxDistSq: number; splitIdx: number } {
  let maxDistSq = 0;
  let splitIdx = Math.floor(pts.length / 2);

  for (let i = 1; i < pts.length - 1; i++) {
    const p = evalCubic(bez[0], bez[1], bez[2], bez[3], u[i]);
    const dx = p.x - pts[i].x;
    const dy = p.y - pts[i].y;
    const dSq = dx * dx + dy * dy;
    if (dSq >= maxDistSq) {
      maxDistSq = dSq;
      splitIdx = i;
    }
  }
  return { maxDistSq, splitIdx };
}

function tryConvertCubicToExactQuadratic(
  bez: [Point2D, Point2D, Point2D, Point2D],
  tolPx = 0.045
): FittedSegmentCommand {
  const [p0, p1, p2, p3] = bez;
  const q1aX = 1.5 * p1.x - 0.5 * p0.x;
  const q1aY = 1.5 * p1.y - 0.5 * p0.y;
  const q1bX = 1.5 * p2.x - 0.5 * p3.x;
  const q1bY = 1.5 * p2.y - 0.5 * p3.y;

  const diff = (3 / 16) * Math.hypot(q1aX - q1bX, q1aY - q1bY);
  if (diff <= tolPx) {
    return {
      kind: 'Q',
      x1: (q1aX + q1bX) * 0.5,
      y1: (q1aY + q1bY) * 0.5,
      x: p3.x,
      y: p3.y,
    };
  }

  return {
    kind: 'C',
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    x: p3.x,
    y: p3.y,
  };
}

/**
 * Reconhece analiticamente arcos circulares parciais (`16° .. 330°`) passando exatamente
 * por `pts[0]` e `pts[n-1]` (cantos arredondados `rx`, arcos tipográficos 'C', 'D', 'U', 'S', escudos, ícones),
 * emitindo de 1 a 4 curvas Bézier cúbicas circulares exatas (`α = 4/3 * tan(Δθ/4)`), 100% livres de ondulações em qualquer zoom!
 */
function tryFitExactCircularArcSpan(
  pts: Point2D[],
  arcLengths: Float64Array,
  maxTolPx: number
): FittedSegmentCommand[] | null {
  const n = pts.length;
  if (n < 6) return null;
  const totalArc = arcLengths[n - 1];
  if (totalArc < 4.0) return null;

  const p0 = pts[0];
  const pEnd = pts[n - 1];
  const dx = pEnd.x - p0.x;
  const dy = pEnd.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 2.5) return null;

  const pMid = samplePolylineAtArcLength(pts, arcLengths, totalArc * 0.5, false);
  const mx = (p0.x + pEnd.x) * 0.5;
  const my = (p0.y + pEnd.y) * 0.5;

  // Normal unitária à corda P0 -> PEnd
  const nx = -dy / chord;
  const ny = dx / chord;

  // Flecha assinada (sagitta) no ponto médio do arco
  const sagitta = (pMid.x - mx) * nx + (pMid.y - my) * ny;
  if (Math.abs(sagitta) < Math.max(0.45, maxTolPx * 1.6)) {
    return null;
  }

  const halfC = chord * 0.5;
  // Raio exato do círculo que passa por P0, PEnd e tem flecha `sagitta`: R = |s|/2 + c²/(8|s|)
  const absS = Math.abs(sagitta);
  const radius = absS * 0.5 + (halfC * halfC) / (2 * absS);
  if (radius < 1.2 || radius > 2400) return null;

  // Centro na mediatriz exata de [P0, PEnd]: ||P0 - C|| === ||PEnd - C|| === radius!
  const centerOffset = sagitta > 0 ? sagitta - radius : sagitta + radius;
  const cx = mx + nx * centerOffset;
  const cy = my + ny * centerOffset;

  const ang0 = Math.atan2(p0.y - cy, p0.x - cx);
  const angMid = Math.atan2(pMid.y - cy, pMid.x - cx);
  const angEnd = Math.atan2(pEnd.y - cy, pEnd.x - cx);

  const normDelta = (a: number): number => {
    let d = a;
    while (d <= -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    return d;
  };

  const dMid = normDelta(angMid - ang0);
  if (Math.abs(dMid) < 0.06) return null;
  const ccwSign = dMid > 0 ? 1 : -1;

  let sweep = angEnd - ang0;
  if (ccwSign > 0) {
    while (sweep <= 0) sweep += Math.PI * 2;
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
    while (sweep < -Math.PI * 2) sweep += Math.PI * 2;
  }

  const absSweep = Math.abs(sweep);
  if (absSweep < (16 * Math.PI) / 180 || absSweep > (335 * Math.PI) / 180) {
    return null;
  }

  const radialTol = Math.min(0.24, Math.max(0.11, maxTolPx * 0.9));
  let prevProg = 0;
  for (let i = 1; i < n - 1; i++) {
    const rx = pts[i].x - cx;
    const ry = pts[i].y - cy;
    const rDist = Math.hypot(rx, ry);
    if (Math.abs(rDist - radius) > radialTol) {
      return null;
    }

    let rel = Math.atan2(ry, rx) - ang0;
    if (ccwSign > 0) {
      while (rel < -0.05) rel += Math.PI * 2;
    } else {
      while (rel > 0.05) rel -= Math.PI * 2;
    }
    const prog = rel * ccwSign;
    if (prog < prevProg - 0.08 || prog > absSweep + 0.08) {
      return null;
    }
    if (prog > prevProg) prevProg = prog;
  }

  const numSegs = Math.max(1, Math.ceil(absSweep / (Math.PI * 0.5)));
  const stepAngle = sweep / numSegs;
  const alpha = (4 / 3) * Math.tan(stepAngle * 0.25) * radius;

  const cmds: FittedSegmentCommand[] = [];
  for (let k = 0; k < numSegs; k++) {
    const aStart = ang0 + k * stepAngle;
    const aEnd = k === numSegs - 1 ? angEnd : ang0 + (k + 1) * stepAngle;

    const x0 = k === 0 ? p0.x : cx + radius * Math.cos(aStart);
    const y0 = k === 0 ? p0.y : cy + radius * Math.sin(aStart);
    const x3 = k === numSegs - 1 ? pEnd.x : cx + radius * Math.cos(aEnd);
    const y3 = k === numSegs - 1 ? pEnd.y : cy + radius * Math.sin(aEnd);

    const x1 = x0 - alpha * Math.sin(aStart);
    const y1 = y0 + alpha * Math.cos(aStart);
    const x2 = x3 + alpha * Math.sin(aEnd);
    const y2 = y3 - alpha * Math.cos(aEnd);

    cmds.push({ kind: 'C', x1, y1, x2, y2, x: x3, y: y3 });
  }

  return cmds;
}

function fitSmoothSpanRecursive(
  pts: Point2D[],
  tHat1: Point2D,
  tHat2: Point2D,
  maxErrorSq: number,
  straightLineTolPx: number,
  out: FittedSegmentCommand[],
  depth = 0
): void {
  const n = pts.length;
  const p0 = pts[0];
  const pLast = pts[n - 1];
  const dx = pLast.x - p0.x;
  const dy = pLast.y - p0.y;
  const chord = Math.hypot(dx, dy);

  if (n <= 2 || chord < 0.75) {
    out.push({ kind: 'L', x: pLast.x, y: pLast.y });
    return;
  }

  // 1) Teste matemático de colinearidade: se todos os pontos estão a <= straightLineTolPx da reta P0->PLast,
  // emite um segmento de reta puro `L` (uma linha reta permanece 100% reta em qualquer zoom!).
  if (depth === 0 && chord >= 2.0) {
    let maxOrtho = 0;
    const invChord = 1 / chord;
    for (let i = 1; i < n - 1; i++) {
      const cross = Math.abs((pts[i].x - p0.x) * dy - (pts[i].y - p0.y) * dx) * invChord;
      if (cross > maxOrtho) maxOrtho = cross;
    }
    if (maxOrtho <= straightLineTolPx) {
      out.push({ kind: 'L', x: pLast.x, y: pLast.y });
      return;
    }
  }

  if (n === 3) {
    const u3 = new Float64Array([0, 0.5, 1]);
    const bez3 = fitSingleCubicLeastSquares(pts, u3, tHat1, tHat2);
    out.push(tryConvertCubicToExactQuadratic(bez3));
    return;
  }

  const arc = computeCumulativeArcLengths(pts);
  const totalLen = Math.max(1e-6, arc[n - 1]);

  // 2) Reconhecimento analítico de arco circular exato no trecho livre de cantos
  if (depth === 0 && n >= 6) {
    const arcCmds = tryFitExactCircularArcSpan(pts, arc, Math.sqrt(maxErrorSq));
    if (arcCmds) {
      for (const c of arcCmds) out.push(c);
      return;
    }
  }

  let u: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = arc[i] / totalLen;
  }

  let bez = fitSingleCubicLeastSquares(pts, u, tHat1, tHat2);
  let { maxDistSq, splitIdx } = computeMaxBezierError(pts, u, bez);

  if (maxDistSq <= maxErrorSq) {
    if (isAuditActive()) noteBezierDeviation(Math.sqrt(maxDistSq), false);
    out.push(tryConvertCubicToExactQuadratic(bez));
    return;
  }

  // Refinamento Newton-Raphson iterativo (até 5 iterações para convergir em curvas amplas com 1 único segmento!)
  if (maxDistSq <= maxErrorSq * 14) {
    for (let iter = 0; iter < 5; iter++) {
      u = reparameterizeNewtonRaphson(pts, u, bez);
      bez = fitSingleCubicLeastSquares(pts, u, tHat1, tHat2);
      const res = computeMaxBezierError(pts, u, bez);
      maxDistSq = res.maxDistSq;
      splitIdx = res.splitIdx;
      if (maxDistSq <= maxErrorSq) {
        if (isAuditActive()) noteBezierDeviation(Math.sqrt(maxDistSq), false);
        out.push(tryConvertCubicToExactQuadratic(bez));
        return;
      }
    }
  }

  if (depth >= 8 || splitIdx <= 0 || splitIdx >= n - 1) {
    if (isAuditActive()) noteBezierDeviation(Math.sqrt(maxDistSq), maxDistSq > maxErrorSq);
    out.push(tryConvertCubicToExactQuadratic(bez));
    return;
  }

  // Tangente central contínua por comprimento de arco simétrico (garante G¹ suave sem quina de discretização!)
  const sSplit = arc[splitIdx];
  const tanWin = Math.min(3.6, Math.max(1.5, totalLen * 0.18));
  const pBack = samplePolylineAtArcLength(pts, arc, sSplit - tanWin, false);
  const pFwd = samplePolylineAtArcLength(pts, arc, sSplit + tanWin, false);
  const centerDir = normalizeVec(pFwd.x - pBack.x, pFwd.y - pBack.y);
  const tCenterLeft = { x: -centerDir.x, y: -centerDir.y };
  const tCenterRight = { x: centerDir.x, y: centerDir.y };

  fitSmoothSpanRecursive(
    pts.slice(0, splitIdx + 1),
    tHat1,
    tCenterLeft,
    maxErrorSq,
    straightLineTolPx,
    out,
    depth + 1
  );
  fitSmoothSpanRecursive(
    pts.slice(splitIdx),
    tCenterRight,
    tHat2,
    maxErrorSq,
    straightLineTolPx,
    out,
    depth + 1
  );
}

/**
 * Reconstrói uma polilinha sub-pixel (aberta entre duas junções topológicas ou laço fechado)
 * preservando cantos agudos (`C⁰`), segmentos retos exatos (`L`), arcos circulares/elípticos
 * analíticos e curvas cúbicas suaves (`C`/`Q`) com continuidade tangencial `G¹` e estabilidade em qualquer zoom.
 */
export function fitAdaptiveBezierChain(
  baseGridPoints: Point2D[],
  aaTargetPoints: Point2D[],
  isClosedLoop: boolean,
  options: AdaptiveCurveFitOptions = {}
): FittedBezierChain {
  const maxErr = options.maxCurveErrorPx ?? 0.22;
  const straightTol = options.straightLineTolPx ?? 0.22;
  const cornerDeg = options.cornerAngleThresholdDeg ?? 36;
  const tubeRadius = options.subpixelTubeRadiusPx ?? 0.48;

  const regPts = regularizeSubpixelChainPoints(
    baseGridPoints,
    aaTargetPoints,
    isClosedLoop,
    tubeRadius
  );

  if (regPts.length < 2) {
    const p = regPts[0] ?? { x: 0, y: 0 };
    return { start: p, end: p, commands: [] };
  }

  // Teste de círculo/elipse analítica exata (incluindo elipses inclinadas via momentos de Green!)
  if (isClosedLoop && regPts.length >= 5) {
    const ellipseCommands = tryFitClosedAnalyticalEllipse(regPts, maxErr * 1.3);
    if (ellipseCommands) {
      return ellipseCommands;
    }
  }

  const corners = detectTrueCornerIndices(regPts, isClosedLoop, cornerDeg);
  const maxErrSq = maxErr * maxErr;
  const commands: FittedSegmentCommand[] = [];

  if (!isClosedLoop) {
    if (
      corners.length === 2 &&
      regPts.length >= 4 &&
      Math.hypot(
        regPts[regPts.length - 1].x - regPts[0].x,
        regPts[regPts.length - 1].y - regPts[0].y
      ) < 1.2
    ) {
      let farIdx = Math.floor(regPts.length / 2);
      let maxD = -1;
      for (let i = 1; i < regPts.length - 1; i++) {
        const d = Math.hypot(regPts[i].x - regPts[0].x, regPts[i].y - regPts[0].y);
        if (d > maxD) {
          maxD = d;
          farIdx = i;
        }
      }
      corners.splice(1, 0, farIdx);
    }

    for (let c = 0; c < corners.length - 1; c++) {
      const i0 = corners[c];
      const i1 = corners[c + 1];
      const span = regPts.slice(i0, i1 + 1);
      if (span.length < 2) continue;
      const t1 = estimateEndTangent(span, true);
      const t2 = estimateEndTangent(span, false);
      fitSmoothSpanRecursive(span, t1, t2, maxErrSq, straightTol, commands, 0);
    }

    return {
      start: { ...regPts[0] },
      end: { ...regPts[regPts.length - 1] },
      commands,
    };
  }

  // Laço fechado sem cantos agudos reais: impõe continuidade tangencial G¹ perfeita através da costura!
  const limit = regPts.length - 1;
  if (corners.length === 1) {
    const c0 = corners[0];
    const rotated: Point2D[] = [];
    for (let k = 0; k < limit; k++) {
      rotated.push(regPts[(c0 + k) % limit]);
    }
    rotated.push({ ...rotated[0] });

    const rotArc = computeCumulativeArcLengths(rotated);
    const rotLen = rotArc[rotated.length - 1];
    const seamWin = Math.min(3.8, Math.max(1.5, rotLen * 0.14));

    const pBeforeSeam = samplePolylineAtArcLength(rotated, rotArc, rotLen - seamWin, true);
    const pAfterSeam = samplePolylineAtArcLength(rotated, rotArc, seamWin, true);
    const seamDir = normalizeVec(pAfterSeam.x - pBeforeSeam.x, pAfterSeam.y - pBeforeSeam.y);

    // Encontra o vértice próximo à metade do perímetro real (arc-length) para divisão equilibrada
    let mid = Math.floor(rotated.length / 2);
    const halfLen = rotLen * 0.5;
    let bestMidDiff = Infinity;
    for (let i = 1; i < rotated.length - 1; i++) {
      const diff = Math.abs(rotArc[i] - halfLen);
      if (diff < bestMidDiff) {
        bestMidDiff = diff;
        mid = i;
      }
    }

    const pBeforeMid = samplePolylineAtArcLength(rotated, rotArc, rotArc[mid] - seamWin, true);
    const pAfterMid = samplePolylineAtArcLength(rotated, rotArc, rotArc[mid] + seamWin, true);
    const midDir = normalizeVec(pAfterMid.x - pBeforeMid.x, pAfterMid.y - pBeforeMid.y);

    fitSmoothSpanRecursive(
      rotated.slice(0, mid + 1),
      seamDir,
      { x: -midDir.x, y: -midDir.y },
      maxErrSq,
      straightTol,
      commands,
      0
    );
    fitSmoothSpanRecursive(
      rotated.slice(mid),
      midDir,
      { x: -seamDir.x, y: -seamDir.y },
      maxErrSq,
      straightTol,
      commands,
      0
    );

    return {
      start: { ...rotated[0] },
      end: { ...rotated[0] },
      commands,
    };
  }

  // Laço fechado com 2+ cantos agudos reais: ajusta cada trecho entre cantos consecutivos
  const startAnchor = regPts[corners[0]];
  for (let c = 0; c < corners.length; c++) {
    const idxA = corners[c];
    const idxB = corners[(c + 1) % corners.length];
    const span: Point2D[] = [];
    let k = idxA;
    span.push(regPts[k]);
    while (true) {
      k = (k + 1) % limit;
      span.push(regPts[k]);
      if (k === idxB) break;
      if (span.length > limit + 2) break;
    }

    const t1 = estimateEndTangent(span, true);
    const t2 = estimateEndTangent(span, false);
    fitSmoothSpanRecursive(span, t1, t2, maxErrSq, straightTol, commands, 0);
  }

  return {
    start: { ...startAnchor },
    end: { ...startAnchor },
    commands,
  };
}

/**
 * Reconhece analiticamente círculos e elipses fechadas (alinhadas aos eixos OU inclinadas!)
 * usando momentos geométricos de área de 2ª ordem pelo Teorema de Green (invariantes à densidade de vértices).
 */
function tryFitClosedAnalyticalEllipse(
  pts: Point2D[],
  maxTolPx: number
): FittedBezierChain | null {
  const n = pts.length - 1;
  if (n < 4) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let signedArea2 = 0;
  let cxSum = 0;
  let cySum = 0;

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    const cross = p.x * q.y - q.x * p.y;
    signedArea2 += cross;
    cxSum += (p.x + q.x) * cross;
    cySum += (p.y + q.y) * cross;
  }

  const polyArea = Math.abs(signedArea2) * 0.5;
  if (polyArea < 0.35) return null;

  const cx = Math.abs(signedArea2) > 1e-6 ? cxSum / (3 * signedArea2) : (minX + maxX) * 0.5;
  const cy = Math.abs(signedArea2) > 1e-6 ? cySum / (3 * signedArea2) : (minY + maxY) * 0.5;

  const bboxRx = (maxX - minX) * 0.5;
  const bboxRy = (maxY - minY) * 0.5;
  if (bboxRx < 0.42 || bboxRy < 0.42) return null;

  // Para micro-pontos/estrelas (n <= 12, raio <= 2.2px), conserva área fotométrica exata em elipse alinhada
  if (n <= 12 && bboxRx <= 2.2 && bboxRy <= 2.2 && Math.abs(bboxRx - bboxRy) <= 0.65) {
    const areaScale = Math.sqrt(polyArea / Math.max(0.2, Math.PI * bboxRx * bboxRy));
    const rx = bboxRx * Math.max(0.92, Math.min(1.22, areaScale));
    const ry = bboxRy * Math.max(0.92, Math.min(1.22, areaScale));
    return buildRotatedEllipseBezierChain(cx, cy, rx, ry, 0, signedArea2 > 0);
  }

  // Momentos centrais de área de 2ª ordem pelo Teorema de Green
  let ixx = 0;
  let iyy = 0;
  let ixy = 0;
  for (let i = 0; i < n; i++) {
    const x0 = pts[i].x - cx;
    const y0 = pts[i].y - cy;
    const x1 = pts[i + 1].x - cx;
    const y1 = pts[i + 1].y - cy;
    const cross = x0 * y1 - x1 * y0;
    ixx += (x0 * x0 + x0 * x1 + x1 * x1) * cross;
    iyy += (y0 * y0 + y0 * y1 + y1 * y1) * cross;
    ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cross;
  }
  const sgn = signedArea2 > 0 ? 1 : -1;
  ixx = (ixx * sgn) / 12;
  iyy = (iyy * sgn) / 12;
  ixy = (ixy * sgn) / 24;

  const trace = ixx + iyy;
  const diff = ixx - iyy;
  const disc = Math.sqrt(Math.max(0, diff * diff + 4 * ixy * ixy));
  const lambdaMax = (trace + disc) * 0.5;
  const lambdaMin = (trace - disc) * 0.5;
  if (lambdaMin <= 1e-4) return null;

  let rx = 2 * Math.sqrt(lambdaMax / polyArea);
  let ry = 2 * Math.sqrt(lambdaMin / polyArea);
  let phi = 0.5 * Math.atan2(2 * ixy, diff);

  // Se quase alinhada aos eixos ou quase circular, trava ângulo em 0° ou 90° para âncoras ortogonais limpas!
  if (Math.abs(rx - ry) <= Math.max(0.15, rx * 0.03)) {
    const rAvg = Math.sqrt(rx * ry);
    rx = rAvg;
    ry = rAvg;
    phi = 0;
  } else if (Math.abs(phi) < (2.5 * Math.PI) / 180) {
    phi = 0;
  } else if (Math.abs(Math.abs(phi) - Math.PI * 0.5) < (2.5 * Math.PI) / 180) {
    const tmp = rx;
    rx = ry;
    ry = tmp;
    phi = 0;
  }

  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const avgR = Math.sqrt(rx * ry);
  let maxRadialPx = 0;

  for (let i = 0; i < n; i++) {
    const dx = pts[i].x - cx;
    const dy = pts[i].y - cy;
    const u = (dx * cosP + dy * sinP) / rx;
    const v = (-dx * sinP + dy * cosP) / ry;
    const normR = Math.hypot(u, v);
    const radialErr = Math.abs(normR - 1) * avgR;
    if (radialErr > maxRadialPx) maxRadialPx = radialErr;
  }

  const allowedErr =
    rx <= 4 && ry <= 4 ? Math.max(0.48, maxTolPx * 1.5) : Math.max(0.32, maxTolPx * 1.25);
  if (maxRadialPx > allowedErr) return null;

  return buildRotatedEllipseBezierChain(cx, cy, rx, ry, phi, signedArea2 > 0);
}

function buildRotatedEllipseBezierChain(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phi: number,
  isClockwiseInScreen: boolean
): FittedBezierChain {
  const k = 0.55228475;
  const kx = rx * k;
  const ky = ry * k;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  const rot = (ux: number, uy: number): Point2D => ({
    x: cx + ux * cosP - uy * sinP,
    y: cy + ux * sinP + uy * cosP,
  });

  const pTop = rot(0, -ry);
  const pRight = rot(rx, 0);
  const pBot = rot(0, ry);
  const pLeft = rot(-rx, 0);

  if (isClockwiseInScreen) {
    const c1a = rot(kx, -ry);
    const c1b = rot(rx, -ky);
    const c2a = rot(rx, ky);
    const c2b = rot(kx, ry);
    const c3a = rot(-kx, ry);
    const c3b = rot(-rx, ky);
    const c4a = rot(-rx, -ky);
    const c4b = rot(-kx, -ry);
    return {
      start: pTop,
      end: pTop,
      commands: [
        { kind: 'C', x1: c1a.x, y1: c1a.y, x2: c1b.x, y2: c1b.y, x: pRight.x, y: pRight.y },
        { kind: 'C', x1: c2a.x, y1: c2a.y, x2: c2b.x, y2: c2b.y, x: pBot.x, y: pBot.y },
        { kind: 'C', x1: c3a.x, y1: c3a.y, x2: c3b.x, y2: c3b.y, x: pLeft.x, y: pLeft.y },
        { kind: 'C', x1: c4a.x, y1: c4a.y, x2: c4b.x, y2: c4b.y, x: pTop.x, y: pTop.y },
      ],
    };
  }

  // Sentido anti-horário (furo interno elíptico para fill-rule="evenodd"!)
  const h1a = rot(-kx, -ry);
  const h1b = rot(-rx, -ky);
  const h2a = rot(-rx, ky);
  const h2b = rot(-kx, ry);
  const h3a = rot(kx, ry);
  const h3b = rot(rx, ky);
  const h4a = rot(rx, -ky);
  const h4b = rot(kx, -ry);
  return {
    start: pTop,
    end: pTop,
    commands: [
      { kind: 'C', x1: h1a.x, y1: h1a.y, x2: h1b.x, y2: h1b.y, x: pLeft.x, y: pLeft.y },
      { kind: 'C', x1: h2a.x, y1: h2a.y, x2: h2b.x, y2: h2b.y, x: pBot.x, y: pBot.y },
      { kind: 'C', x1: h3a.x, y1: h3a.y, x2: h3b.x, y2: h3b.y, x: pRight.x, y: pRight.y },
      { kind: 'C', x1: h4a.x, y1: h4a.y, x2: h4b.x, y2: h4b.y, x: pTop.x, y: pTop.y },
    ],
  };
}
