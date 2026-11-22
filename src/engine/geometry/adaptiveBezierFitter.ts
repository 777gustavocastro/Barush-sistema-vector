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

export interface AdaptiveCurveFitOptions {
  /** Erro geométrico máximo tolerado em pixels ao ajustar curvas Bézier (padrão 0.24px). */
  maxCurveErrorPx?: number;
  /** Desvio ortogonal máximo para preservar retas exatas `L` (padrão 0.24px). */
  straightLineTolPx?: number;
  /** Ângulo mínimo de deflexão (em graus) para travar um canto agudo C⁰ (padrão 36°). */
  cornerAngleThresholdDeg?: number;
  /** Raio máximo L∞ da banda de regularização sub-pixel (padrão 0.48px). */
  subpixelTubeRadiusPx?: number;
  /** Casas decimais na serialização SVG. */
  precision?: number;
}

export function fmtSvgNum(v: number, precision = 2): string {
  const factor = precision === 3 ? 1000 : precision === 1 ? 10 : 100;
  const r = Math.round(v * factor) / factor;
  if (Object.is(r, -0) || r === 0) return '0';
  return Number.isInteger(r) ? String(r) : r.toFixed(precision).replace(/\.?0+$/, '');
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
 * de camada inferior opaca (evitando a fenda de 25% do anti-aliasing Porter-Duff dos motores SVG),
 * mantendo as junções topológicas (`start` e `end`) 100% travadas.
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

  // Em coordenadas de tela (sentido horário com região à direita da aresta u -> v):
  // A normal apontando para FORA da região (para dentro da região vizinha sobreposta) é (+dy, -dx) / ||d||!
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
      if (i === 0 && chain.commands.length === 1) {
        // Único segmento reto entre duas junções travadas: arco quadrático sutil no ponto médio!
        const mx = (a0.x + a1.x) * 0.5 + nx * inwardNormalShiftPx;
        const my = (a0.y + a1.y) * 0.5 + ny * inwardNormalShiftPx;
        newCommands.push({ kind: 'Q', x1: mx, y1: my, x: s1.x, y: s1.y });
      } else {
        newCommands.push({ kind: 'L', x: s1.x, y: s1.y });
      }
    } else if (cmd.kind === 'Q') {
      newCommands.push({
        kind: 'Q',
        x1: cmd.x1 + nx * inwardNormalShiftPx,
        y1: cmd.y1 + ny * inwardNormalShiftPx,
        x: s1.x,
        y: s1.y,
      });
    } else {
      newCommands.push({
        kind: 'C',
        x1: cmd.x1 + (i === 0 ? nx * inwardNormalShiftPx * 0.65 : s0.x - a0.x),
        y1: cmd.y1 + (i === 0 ? ny * inwardNormalShiftPx * 0.65 : s0.y - a0.y),
        x2:
          cmd.x2 +
          (i === chain.commands.length - 1 ? nx * inwardNormalShiftPx * 0.65 : s1.x - a1.x),
        y2:
          cmd.y2 +
          (i === chain.commands.length - 1 ? ny * inwardNormalShiftPx * 0.65 : s1.y - a1.y),
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
  precision = 2
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

/**
 * Regulariza os vértices de uma cadeia da grade de pixels dentro do tubo estrito de viabilidade `±tubeRadiusPx`:
 * - Elimina 100% dos degraus ("escadas") de 1px em linhas inclinadas e curvas suaves;
 * - Incorpora o deslocamento sub-pixel real medido pelo anti-aliasing da imagem original;
 * - NUNCA deforma detalhes pequenos nem encolhe pontas agudas além de `±0.48px`!
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

  const passes = 5;
  for (let pass = 0; pass < passes; pass++) {
    const next: Point2D[] = new Array(n);
    for (let i = 0; i < n; i++) {
      if (!isClosedLoop && (i === 0 || i === n - 1)) {
        next[i] = { ...curr[i] };
        continue;
      }

      const prevIdx = i === 0 ? (isClosedLoop ? n - 2 : 0) : i - 1;
      const nextIdx = i === n - 1 ? (isClosedLoop ? 1 : n - 1) : i + 1;

      // Média ponderada + atração leve ao alvo sub-pixel de anti-aliasing
      const avgX = 0.28 * curr[prevIdx].x + 0.34 * curr[i].x + 0.28 * curr[nextIdx].x + 0.1 * aaTargetPoints[i].x;
      const avgY = 0.28 * curr[prevIdx].y + 0.34 * curr[i].y + 0.28 * curr[nextIdx].y + 0.1 * aaTargetPoints[i].y;

      const gx = baseGridPoints[i].x;
      const gy = baseGridPoints[i].y;
      next[i] = {
        x: Math.max(gx - tubeRadiusPx, Math.min(gx + tubeRadiusPx, avgX)),
        y: Math.max(gy - tubeRadiusPx, Math.min(gy + tubeRadiusPx, avgY)),
      };
    }
    if (isClosedLoop) {
      next[n - 1] = { ...next[0] };
    }
    curr = next;
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

/**
 * Detecta cantos geométricos reais (pontas agudas, vértices poligonais, serifas) usando deflexão
 * angular multi-escala, preservando pontas agudas intactas sem confundir degraus de pixel com cantos!
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
  const winShort = Math.min(2.4, totalLen * 0.22);
  const winLong = Math.min(4.6, totalLen * 0.32);

  const limit = isClosed ? n - 1 : n;
  for (let i = 0; i < limit; i++) {
    if (!isClosed && (i === 0 || i === n - 1)) continue;
    const s0 = arc[i];
    if (!isClosed && (s0 < winShort * 0.6 || totalLen - s0 < winShort * 0.6)) continue;

    const pCurr = pts[i];
    const pBack1 = samplePolylineAtArcLength(pts, arc, s0 - winShort, isClosed);
    const pFwd1 = samplePolylineAtArcLength(pts, arc, s0 + winShort, isClosed);

    const v1x = pCurr.x - pBack1.x;
    const v1y = pCurr.y - pBack1.y;
    const v2x = pFwd1.x - pCurr.x;
    const v2y = pFwd1.y - pCurr.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-4 || l2 < 1e-4) continue;

    const cos1 = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    const ang1 = Math.acos(cos1);

    const pBack2 = samplePolylineAtArcLength(pts, arc, s0 - winLong, isClosed);
    const pFwd2 = samplePolylineAtArcLength(pts, arc, s0 + winLong, isClosed);
    const u1x = pCurr.x - pBack2.x;
    const u1y = pCurr.y - pBack2.y;
    const u2x = pFwd2.x - pCurr.x;
    const u2y = pFwd2.y - pCurr.y;
    const ul1 = Math.hypot(u1x, u1y);
    const ul2 = Math.hypot(u2x, u2y);
    const cos2 =
      ul1 > 1e-4 && ul2 > 1e-4
        ? Math.max(-1, Math.min(1, (u1x * u2x + u1y * u2y) / (ul1 * ul2)))
        : cos1;
    const ang2 = Math.acos(cos2);

    // Exige consistência entre escala curta e longa para não disparar em micro-ondulações de 1px!
    const combinedAngle = Math.min(ang1, ang2 * 1.12);
    if (combinedAngle >= radThresh) {
      scores[i] = combinedAngle;
    }
  }

  // Supressão de não-máximos em janela de comprimento de arco de 2.5px
  const corners: number[] = [];
  if (!isClosed) corners.push(0);

  for (let i = 0; i < limit; i++) {
    const sc = scores[i];
    if (sc <= 0) continue;
    let isLocalMax = true;
    for (let d = -3; d <= 3; d++) {
      if (d === 0) continue;
      let j = i + d;
      if (isClosed) {
        j = ((j % limit) + limit) % limit;
      } else if (j <= 0 || j >= n - 1) {
        continue;
      }
      if (Math.abs(arc[i] - arc[j]) <= 2.6 && scores[j] > sc) {
        isLocalMax = false;
        break;
      }
    }
    if (isLocalMax) {
      if (corners.length === 0 || Math.abs(arc[i] - arc[corners[corners.length - 1]]) > 2.0) {
        corners.push(i);
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

function estimateEndTangent(pts: Point2D[], atStart: boolean): Point2D {
  const n = pts.length;
  if (atStart) {
    const k = Math.min(n - 1, 3);
    let vx = 0;
    let vy = 0;
    for (let i = 1; i <= k; i++) {
      const w = k - i + 1;
      vx += (pts[i].x - pts[0].x) * w;
      vy += (pts[i].y - pts[0].y) * w;
    }
    return normalizeVec(vx, vy);
  } else {
    const last = n - 1;
    const k = Math.min(last, 3);
    let vx = 0;
    let vy = 0;
    for (let i = 1; i <= k; i++) {
      const w = k - i + 1;
      vx += (pts[last - i].x - pts[last].x) * w;
      vy += (pts[last - i].y - pts[last].y) * w;
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
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);

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

  // Proteção anti-autointerseção / anti-laço degenerado: alças positivas limitadas a 0.85 * corda!
  const minHandle = chord * 0.04;
  const maxHandle = Math.max(1.5, chord * 0.85);
  if (alphaL < minHandle || alphaR < minHandle) {
    alphaL = chord / 3;
    alphaR = chord / 3;
  } else {
    alphaL = Math.min(maxHandle, alphaL);
    alphaR = Math.min(maxHandle, alphaR);
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
  tolPx = 0.06
): FittedSegmentCommand {
  const [p0, p1, p2, p3] = bez;
  // Uma Bézier quadrática Q(p0, q1, p3) elevada ao grau 3 possui p1 = (p0 + 2*q1)/3 e p2 = (p3 + 2*q1)/3
  const q1aX = 1.5 * p1.x - 0.5 * p0.x;
  const q1aY = 1.5 * p1.y - 0.5 * p0.y;
  const q1bX = 1.5 * p2.x - 0.5 * p3.x;
  const q1bY = 1.5 * p2.y - 0.5 * p3.y;

  // Diferença máxima entre a cúbica e a quadrática média ocorre em 3/16 * ||q1a - q1b||
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

  // Teste matemático de colinearidade: se todos os pontos estão a <= straightLineTolPx da reta P0->PLast,
  // emite um segmento de reta puro `L` (uma linha reta permanece 100% reta!).
  if (depth === 0 && chord >= 2.2) {
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
  let u: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = arc[i] / totalLen;
  }

  let bez = fitSingleCubicLeastSquares(pts, u, tHat1, tHat2);
  let { maxDistSq, splitIdx } = computeMaxBezierError(pts, u, bez);

  if (maxDistSq <= maxErrorSq) {
    out.push(tryConvertCubicToExactQuadratic(bez));
    return;
  }

  // Refinamento Newton-Raphson quando o erro está próximo do limiar
  if (maxDistSq <= maxErrorSq * 9) {
    for (let iter = 0; iter < 4; iter++) {
      u = reparameterizeNewtonRaphson(pts, u, bez);
      bez = fitSingleCubicLeastSquares(pts, u, tHat1, tHat2);
      const res = computeMaxBezierError(pts, u, bez);
      maxDistSq = res.maxDistSq;
      splitIdx = res.splitIdx;
      if (maxDistSq <= maxErrorSq) {
        out.push(tryConvertCubicToExactQuadratic(bez));
        return;
      }
    }
  }

  if (depth >= 9 || splitIdx <= 0 || splitIdx >= n - 1) {
    out.push(tryConvertCubicToExactQuadratic(bez));
    return;
  }

  // Tangente unitária central compartilhada garante continuidade tangencial G¹ perfeita no ponto de divisão!
  const prevIdx = Math.max(0, splitIdx - 2);
  const nextIdx = Math.min(n - 1, splitIdx + 2);
  const centerDir = normalizeVec(pts[nextIdx].x - pts[prevIdx].x, pts[nextIdx].y - pts[prevIdx].y);
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
 * preservando cantos agudos (`C⁰`), segmentos retos exatos (`L`), arcos parabólicos (`Q`)
 * e curvas cúbicas suaves (`C`) com continuidade tangencial `G¹`.
 */
export function fitAdaptiveBezierChain(
  baseGridPoints: Point2D[],
  aaTargetPoints: Point2D[],
  isClosedLoop: boolean,
  options: AdaptiveCurveFitOptions = {}
): FittedBezierChain {
  const maxErr = options.maxCurveErrorPx ?? 0.24;
  const straightTol = options.straightLineTolPx ?? 0.24;
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

  // Teste de círculo/elipse analítica exata para laços fechados isolados (olhos, pontos, anéis, sombras elípticas!)
  if (isClosedLoop && regPts.length >= 8) {
    const ellipseCommands = tryFitClosedAnalyticalEllipse(regPts, maxErr * 1.35);
    if (ellipseCommands) {
      return ellipseCommands;
    }
  }

  const corners = detectTrueCornerIndices(regPts, isClosedLoop, cornerDeg);
  const maxErrSq = maxErr * maxErr;
  const commands: FittedSegmentCommand[] = [];

  if (!isClosedLoop) {
    // Salvaguarda: se início e fim coincidem (ex.: laço tocando apenas 1 vértice de sela) e não há cantos intermediários,
    // insere o ponto mais distante da âncora inicial para impedir corda nula!
    if (
      corners.length === 2 &&
      regPts.length >= 4 &&
      Math.hypot(regPts[regPts.length - 1].x - regPts[0].x, regPts[regPts.length - 1].y - regPts[0].y) < 1.2
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

  // Laço fechado: se não há cantos agudos reais (apenas o ponto inicial de referência),
  // impõe tangente contínua G¹ também através da emenda `corners[0]`!
  const limit = regPts.length - 1;
  if (corners.length === 1) {
    const c0 = corners[0];
    const rotated: Point2D[] = [];
    for (let k = 0; k < limit; k++) {
      rotated.push(regPts[(c0 + k) % limit]);
    }
    rotated.push({ ...rotated[0] });

    // Tangente suave na costura do laço fechado
    const prevSeam = rotated[rotated.length - 3];
    const nextSeam = rotated[2];
    const seamDir = normalizeVec(nextSeam.x - prevSeam.x, nextSeam.y - prevSeam.y);

    // Divide em duas metades suaves para evitar que p0 === p3 colapse a corda em zero!
    const mid = Math.floor(rotated.length / 2);
    const prevMid = rotated[Math.max(0, mid - 2)];
    const nextMid = rotated[Math.min(rotated.length - 1, mid + 2)];
    const midDir = normalizeVec(nextMid.x - prevMid.x, nextMid.y - prevMid.y);

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

function tryFitClosedAnalyticalEllipse(
  pts: Point2D[],
  maxTolPx: number
): FittedBezierChain | null {
  const n = pts.length - 1;
  if (n < 8) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let signedArea2 = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    signedArea2 += p.x * q.y - q.x * p.y;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const rx = (maxX - minX) * 0.5;
  const ry = (maxY - minY) * 0.5;
  if (rx < 0.85 || ry < 0.85) return null;

  const polyArea = Math.abs(signedArea2) * 0.5;
  const ellipseArea = Math.PI * rx * ry;
  const ratio = polyArea / Math.max(0.5, ellipseArea);
  if (ratio < 0.87 || ratio > 1.13) return null;

  // Verifica desvio radial máximo de todos os pontos do contorno até a elipse analítica
  const avgR = Math.sqrt(rx * ry);
  let maxRadialPx = 0;
  for (let i = 0; i < n; i++) {
    const nx = (pts[i].x - cx) / rx;
    const ny = (pts[i].y - cy) / ry;
    const normR = Math.hypot(nx, ny);
    const radialErr = Math.abs(normR - 1) * avgR;
    if (radialErr > maxRadialPx) maxRadialPx = radialErr;
  }

  const allowedErr = rx <= 4 && ry <= 4 ? Math.max(0.52, maxTolPx * 1.6) : Math.max(0.38, maxTolPx * 1.35);
  if (maxRadialPx > allowedErr) return null;

  const k = 0.55228475;
  const kx = rx * k;
  const ky = ry * k;
  const isClockwiseInScreen = signedArea2 > 0;

  const start: Point2D = { x: cx, y: cy - ry };
  if (isClockwiseInScreen) {
    return {
      start,
      end: start,
      commands: [
        { kind: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
        { kind: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
        { kind: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
        { kind: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
      ],
    };
  }

  // Sentido anti-horário (furo interno elíptico para fill-rule="evenodd"!)
  return {
    start,
    end: start,
    commands: [
      { kind: 'C', x1: cx - kx, y1: cy - ry, x2: cx - rx, y2: cy - ky, x: cx - rx, y: cy },
      { kind: 'C', x1: cx - rx, y1: cy + ky, x2: cx - kx, y2: cy + ry, x: cx, y: cy + ry },
      { kind: 'C', x1: cx + kx, y1: cy + ry, x2: cx + rx, y2: cy + ky, x: cx + rx, y: cy },
      { kind: 'C', x1: cx + rx, y1: cy - ky, x2: cx + kx, y2: cy - ry, x: cx, y: cy - ry },
    ],
  };
}
