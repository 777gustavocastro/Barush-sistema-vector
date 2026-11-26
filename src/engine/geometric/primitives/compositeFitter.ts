import {
  geometricAcceptance,
  type Point2D,
} from '../contract/geometricContract';
import {
  arcToSvgCommand,
  fitCircularArcPrimitive,
  fitEllipticalArcPrimitive,
} from './arcFitter';
import { fitInfiniteLineTLS, fitLineSegment, intersectLines, type FittedLineModel } from './lineFitter';
import {
  fmtNum,
  type CompositePrimitive,
  type CompositeSegment,
} from './types';

/**
 * Detecta cantos reais em um contorno fechado usando janela de direção local (evitando ruído de 1 px).
 */
function detectTrueCornerIndices(points: Point2D[], minTurnDeg = 32): number[] {
  const n = points.length;
  if (n < 12) return [];

  // Janela pequena (~2.5 px em contorno subpixel) para detectar cantos próximos em pontas de traços (ex.: 4-8 px)
  const win = 3;
  const turnAngles = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const prev = points[(i - win + n) % n];
    const curr = points[i];
    const next = points[(i + win) % n];
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-4 || l2 < 1e-4) continue;
    const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    turnAngles[i] = (Math.acos(dot) * 180) / Math.PI;
  }

  // Supressão de não-máximos em janela circular de raio `win`
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    const val = turnAngles[i];
    if (val < minTurnDeg) continue;
    let isMax = true;
    for (let k = -win; k <= win; k++) {
      if (k === 0) continue;
      if (turnAngles[(i + k + n) % n] > val) {
        isMax = false;
        break;
      }
    }
    if (isMax) corners.push(i);
  }

  // Filtra cantos muito próximos entre si (< 3 pontos)
  const minSep = 3;
  const filtered: number[] = [];
  for (const idx of corners) {
    if (filtered.length === 0) {
      filtered.push(idx);
    } else {
      const last = filtered[filtered.length - 1];
      if (idx - last >= minSep) filtered.push(idx);
    }
  }
  if (filtered.length >= 2) {
    const wrapGap = n - filtered[filtered.length - 1] + filtered[0];
    if (wrapGap < minSep) filtered.pop();
  }
  return filtered;
}

function sliceClosedChain(points: Point2D[], startIdx: number, endIdx: number): Point2D[] {
  const n = points.length;
  const out: Point2D[] = [];
  let i = startIdx;
  for (let guard = 0; guard <= n; guard++) {
    out.push(points[i]);
    if (i === endIdx) break;
    i = (i + 1) % n;
  }
  return out;
}

function intersectLineWithCircleNear(
  line: FittedLineModel,
  cx: number,
  cy: number,
  r: number,
  near: Point2D
): Point2D | null {
  const ox = line.px - cx;
  const oy = line.py - cy;
  const b = 2 * (ox * line.dx + oy * line.dy);
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - 4 * c;
  if (disc < -0.5) return null;
  const sqrtD = Math.sqrt(Math.max(0, disc));
  const t1 = 0.5 * (-b - sqrtD);
  const t2 = 0.5 * (-b + sqrtD);
  const p1 = { x: line.px + t1 * line.dx, y: line.py + t1 * line.dy };
  const p2 = { x: line.px + t2 * line.dx, y: line.py + t2 * line.dy };
  const d1 = Math.hypot(p1.x - near.x, p1.y - near.y);
  const d2 = Math.hypot(p2.x - near.x, p2.y - near.y);
  const best = d1 <= d2 ? p1 : p2;
  return Math.min(d1, d2) <= 2.0 ? best : null;
}

/**
 * Reconstrói combinações de primitivas (retas + arcos circulares/elípticos) em um contorno fechado,
 * separando cadeias nos cantos verdadeiros e preservando extremos e continuidade G0.
 * Rejeita se qualquer cadeia não atender rigorosamente ao contrato de reta ou arco.
 */
export function fitCompositePrimitive(
  points: Point2D[],
  options?: {
    maxSegments?: number;
  }
): CompositePrimitive | null {
  const maxSegments = options?.maxSegments ?? 16;
  const corners = detectTrueCornerIndices(points, 32);
  if (corners.length < 2 || corners.length > maxSegments) return null;

  const segments: CompositeSegment[] = [];
  const lineModels: Array<FittedLineModel | null> = [];
  let maxErrorPx = 0;
  let weightedErr = 0;
  let totalPts = 0;
  let hasArc = false;

  for (let c = 0; c < corners.length; c++) {
    const startIdx = corners[c];
    const endIdx = corners[(c + 1) % corners.length];
    const chain = sliceClosedChain(points, startIdx, endIdx);
    if (chain.length < 2) return null;

    // 1. Tenta reta preservando os extremos nos cantos (tolerando apenas o chanfro subpixel de 0.5 px no canto)
    const coreChain = chain.length >= 6 ? chain.slice(1, chain.length - 1) : chain;
    const line =
      fitLineSegment(chain, {
        preserveEndpoints: true,
        maxErrorPx: geometricAcceptance.line.maxPx + 0.2,
        meanErrorPx: geometricAcceptance.line.meanPx + 0.1,
      }) ??
      (coreChain.length >= 2
        ? (() => {
            const coreFit = fitLineSegment(coreChain, {
              preserveEndpoints: false,
              maxErrorPx: geometricAcceptance.line.maxPx,
              meanErrorPx: geometricAcceptance.line.meanPx,
            });
            if (!coreFit) return null;
            const first = chain[0];
            const last = chain[chain.length - 1];
            const dx = coreFit.x2 - coreFit.x1;
            const dy = coreFit.y2 - coreFit.y1;
            const len = Math.hypot(dx, dy);
            if (len < 1e-4) return null;
            const ux = dx / len;
            const uy = dy / len;
            const d0 = Math.abs((first.x - coreFit.x1) * -uy + (first.y - coreFit.y1) * ux);
            const d1 = Math.abs((last.x - coreFit.x1) * -uy + (last.y - coreFit.y1) * ux);
            if (d0 > 0.65 || d1 > 0.65) return null;
            return {
              kind: 'line' as const,
              x1: first.x,
              y1: first.y,
              x2: last.x,
              y2: last.y,
              maxErrorPx: Math.max(coreFit.maxErrorPx, d0, d1),
              meanErrorPx: coreFit.meanErrorPx,
            };
          })()
        : null);
    if (line) {
      const m = fitInfiniteLineTLS(coreChain.length >= 2 ? coreChain : chain);
      if (m) {
        const angleDeg = (Math.atan2(m.dy, m.dx) * 180) / Math.PI;
        const mod90 = Math.abs(((angleDeg % 90) + 90) % 90);
        if (Math.min(mod90, 90 - mod90) <= 0.35) {
          if (Math.abs(m.dx) >= Math.abs(m.dy)) {
            m.dx = m.dx >= 0 ? 1 : -1;
            m.dy = 0;
          } else {
            m.dx = 0;
            m.dy = m.dy >= 0 ? 1 : -1;
          }
          m.nx = -m.dy;
          m.ny = m.dx;
        }
      }
      lineModels.push(m);
      segments.push(line);
      if (line.maxErrorPx > maxErrorPx) maxErrorPx = line.maxErrorPx;
      weightedErr += line.meanErrorPx * chain.length;
      totalPts += chain.length;
      continue;
    }

    // 2. Tenta arco circular preservando extremos
    const circArc = fitCircularArcPrimitive(chain, {
      maxErrorPx: geometricAcceptance.arc.maxPx,
      endpointErrorPx: geometricAcceptance.arc.endpointPx + 0.2,
    });
    if (circArc) {
      hasArc = true;
      lineModels.push(null);
      segments.push(circArc);
      if (circArc.maxErrorPx > maxErrorPx) maxErrorPx = circArc.maxErrorPx;
      weightedErr += circArc.meanErrorPx * chain.length;
      totalPts += chain.length;
      continue;
    }

    // 3. Tenta arco elíptico preservando extremos
    const ellipArc = fitEllipticalArcPrimitive(chain);
    if (ellipArc) {
      hasArc = true;
      lineModels.push(null);
      segments.push(ellipArc);
      if (ellipArc.maxErrorPx > maxErrorPx) maxErrorPx = ellipArc.maxErrorPx;
      weightedErr += ellipArc.meanErrorPx * chain.length;
      totalPts += chain.length;
      continue;
    }

    // Qualquer trecho não-primitivo (ex.: curva orgânica com inflexão) causa rejeição imediata
    return null;
  }

  // Se todos os trechos forem retas, deve ser tratado por polygonFitter
  if (!hasArc || segments.length < 2) return null;

  // Refina os vértices nos encontros reta-arco, arco-reta e reta-reta por interseção analítica exata
  for (let i = 0; i < segments.length; i++) {
    const prevIdx = (i - 1 + segments.length) % segments.length;
    const prev = segments[prevIdx];
    const curr = segments[i];
    const rawCorner = points[corners[i]];
    let exactCorner: Point2D | null = null;

    if (prev.kind === 'line' && curr.kind === 'arc' && Math.abs(curr.rx - curr.ry) < 0.05 && lineModels[prevIdx]) {
      exactCorner = intersectLineWithCircleNear(lineModels[prevIdx]!, curr.cx, curr.cy, curr.rx, rawCorner);
    } else if (prev.kind === 'arc' && curr.kind === 'line' && Math.abs(prev.rx - prev.ry) < 0.05 && lineModels[i]) {
      exactCorner = intersectLineWithCircleNear(lineModels[i]!, prev.cx, prev.cy, prev.rx, rawCorner);
    } else if (prev.kind === 'line' && curr.kind === 'line' && lineModels[prevIdx] && lineModels[i]) {
      const inter = intersectLines(lineModels[prevIdx]!, lineModels[i]!);
      if (inter && Math.hypot(inter.x - rawCorner.x, inter.y - rawCorner.y) <= 2.0) {
        exactCorner = inter;
      }
    }

    if (exactCorner) {
      prev.x2 = exactCorner.x;
      prev.y2 = exactCorner.y;
      curr.x1 = exactCorner.x;
      curr.y1 = exactCorner.y;
      if (prev.kind === 'arc') {
        prev.endAngleRad = Math.atan2(exactCorner.y - prev.cy, exactCorner.x - prev.cx);
      }
      if (curr.kind === 'arc') {
        curr.startAngleRad = Math.atan2(exactCorner.y - curr.cy, exactCorner.x - curr.cx);
      }
    }
  }

  // Verifica continuidade G0 entre segmentos adjacentes
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    const b = segments[(i + 1) % segments.length];
    const gap = Math.hypot(a.x2 - b.x1, a.y2 - b.y1);
    if (gap > geometricAcceptance.continuity.g0Px) return null;
  }

  return {
    kind: 'composite',
    closed: true,
    segments,
    maxErrorPx,
    meanErrorPx: weightedErr / Math.max(1, totalPts),
  };
}

export function compositeToSvgPathD(comp: CompositePrimitive): string {
  if (comp.segments.length === 0) return '';
  const first = comp.segments[0];
  const parts = [`M ${fmtNum(first.x1)} ${fmtNum(first.y1)}`];
  for (const seg of comp.segments) {
    if (seg.kind === 'line') {
      parts.push(`L ${fmtNum(seg.x2)} ${fmtNum(seg.y2)}`);
    } else {
      parts.push(arcToSvgCommand(seg));
    }
  }
  if (comp.closed) parts.push('Z');
  return parts.join(' ');
}

export function compositeToSvgElement(
  comp: CompositePrimitive,
  attrs: { fill: string; stroke?: string; strokeWidth?: number }
): string {
  const strokeAttr = attrs.stroke
    ? ` stroke="${attrs.stroke}" stroke-width="${fmtNum(attrs.strokeWidth ?? 1)}"`
    : '';
  return `<path d="${compositeToSvgPathD(comp)}" fill="${attrs.fill}"${strokeAttr}/>`;
}
