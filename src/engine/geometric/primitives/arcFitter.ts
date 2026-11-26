import {
  geometricAcceptance,
  type Point2D,
} from '../contract/geometricContract';
import { fitCircleRaw } from './circleFitter';
import { fitEllipseRaw } from './ellipseFitter';
import { fmtNum, type ArcPrimitive } from './types';

function unwrapAngles(angles: number[]): number[] {
  const out = [angles[0]];
  for (let i = 1; i < angles.length; i++) {
    let d = angles[i] - angles[i - 1];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    out.push(out[i - 1] + d);
  }
  return out;
}

/**
 * Ajusta um arco circular sobre uma cadeia aberta de pontos, preservando extremos
 * e validando contra o contrato da Etapa 1 (erro máximo, erro de extremo e monotonicidade angular).
 */
export function fitCircularArcPrimitive(
  points: Point2D[],
  options?: {
    maxErrorPx?: number;
    endpointErrorPx?: number;
    minSpanDeg?: number;
    minSagittaPx?: number;
  }
): ArcPrimitive | null {
  if (points.length < 6) return null;
  const maxLimit = options?.maxErrorPx ?? geometricAcceptance.arc.maxPx;
  const endpointLimit = options?.endpointErrorPx ?? geometricAcceptance.arc.endpointPx;
  const minSpanDeg = options?.minSpanDeg ?? 14;
  const minSagittaPx = options?.minSagittaPx ?? 0.6;

  // Exige curvatura real (sagitta > minSagittaPx) para não confundir reta com arco de raio gigante
  const first = points[0];
  const last = points[points.length - 1];
  const chordLen = Math.hypot(last.x - first.x, last.y - first.y);
  let maxSagitta = 0;
  if (chordLen > 1e-4) {
    const ux = (last.x - first.x) / chordLen;
    const uy = (last.y - first.y) / chordLen;
    for (const p of points) {
      const cross = Math.abs((p.x - first.x) * uy - (p.y - first.y) * ux);
      if (cross > maxSagitta) maxSagitta = cross;
    }
    if (maxSagitta < minSagittaPx) return null;
  }

  const fit = fitCircleRaw(points);
  if (!fit) return null;
  if (fit.maxErrorPx > maxLimit) return null;

  const endErr0 = Math.abs(Math.hypot(first.x - fit.cx, first.y - fit.cy) - fit.r);
  const endErr1 = Math.abs(Math.hypot(last.x - fit.cx, last.y - fit.cy) - fit.r);
  if (endErr0 > endpointLimit || endErr1 > endpointLimit) return null;

  const rawAngles = points.map((p) => Math.atan2(p.y - fit.cy, p.x - fit.cx));
  const unwrapped = unwrapAngles(rawAngles);
  const totalDelta = unwrapped[unwrapped.length - 1] - unwrapped[0];
  const absDeltaDeg = (Math.abs(totalDelta) * 180) / Math.PI;
  if (absDeltaDeg < minSpanDeg || absDeltaDeg > 350) return null;

  // Garante progressão angular consistente (rejeita curvas em S ou laços)
  const dir = totalDelta >= 0 ? 1 : -1;
  let backwardSteps = 0;
  for (let i = 1; i < unwrapped.length; i++) {
    const step = (unwrapped[i] - unwrapped[i - 1]) * dir;
    if (step < -0.12) backwardSteps++;
  }
  if (backwardSteps > Math.max(1, Math.floor(points.length * 0.03))) return null;

  const sweep: 0 | 1 = totalDelta >= 0 ? 1 : 0;
  const largeArc: 0 | 1 = Math.abs(totalDelta) > Math.PI ? 1 : 0;

  return {
    kind: 'arc',
    cx: fit.cx,
    cy: fit.cy,
    rx: fit.r,
    ry: fit.r,
    rotationDeg: 0,
    startAngleRad: unwrapped[0],
    endAngleRad: unwrapped[unwrapped.length - 1],
    x1: first.x,
    y1: first.y,
    x2: last.x,
    y2: last.y,
    largeArc,
    sweep,
    maxErrorPx: fit.maxErrorPx,
    meanErrorPx: fit.meanErrorPx,
  };
}

/**
 * Ajusta um arco elíptico quando o arco circular não atende ao limite do contrato.
 */
export function fitEllipticalArcPrimitive(
  points: Point2D[],
  options?: {
    maxErrorPx?: number;
    endpointErrorPx?: number;
    minSpanDeg?: number;
  }
): ArcPrimitive | null {
  if (points.length < 12) return null;
  const maxLimit = options?.maxErrorPx ?? geometricAcceptance.arc.maxPx;
  const minSpanDeg = options?.minSpanDeg ?? 25;

  const fit = fitEllipseRaw(points);
  if (!fit) return null;
  if (fit.maxErrorPx > maxLimit) return null;
  if (Math.abs(fit.rx - fit.ry) < 0.5) return null;

  const cosT = Math.cos(fit.thetaRad);
  const sinT = Math.sin(fit.thetaRad);
  const rawAngles = points.map((p) => {
    const dx = p.x - fit.cx;
    const dy = p.y - fit.cy;
    const lx = (dx * cosT + dy * sinT) / fit.rx;
    const ly = (-dx * sinT + dy * cosT) / fit.ry;
    return Math.atan2(ly, lx);
  });
  const unwrapped = unwrapAngles(rawAngles);
  const totalDelta = unwrapped[unwrapped.length - 1] - unwrapped[0];
  const absDeltaDeg = (Math.abs(totalDelta) * 180) / Math.PI;
  if (absDeltaDeg < minSpanDeg || absDeltaDeg > 350) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const sweep: 0 | 1 = totalDelta >= 0 ? 1 : 0;
  const largeArc: 0 | 1 = Math.abs(totalDelta) > Math.PI ? 1 : 0;

  return {
    kind: 'arc',
    cx: fit.cx,
    cy: fit.cy,
    rx: fit.rx,
    ry: fit.ry,
    rotationDeg: (fit.thetaRad * 180) / Math.PI,
    startAngleRad: unwrapped[0],
    endAngleRad: unwrapped[unwrapped.length - 1],
    x1: first.x,
    y1: first.y,
    x2: last.x,
    y2: last.y,
    largeArc,
    sweep,
    maxErrorPx: fit.maxErrorPx,
    meanErrorPx: fit.meanErrorPx,
  };
}

export function arcToSvgCommand(arc: ArcPrimitive): string {
  return `A ${fmtNum(arc.rx)} ${fmtNum(arc.ry)} ${fmtNum(arc.rotationDeg)} ${arc.largeArc} ${arc.sweep} ${fmtNum(arc.x2)} ${fmtNum(arc.y2)}`;
}

export function arcToSvgElement(
  arc: ArcPrimitive,
  attrs: { stroke: string; strokeWidth?: number; fill?: string }
): string {
  const sw = attrs.strokeWidth ?? 1;
  const fill = attrs.fill ?? 'none';
  return `<path d="M ${fmtNum(arc.x1)} ${fmtNum(arc.y1)} ${arcToSvgCommand(arc)}" fill="${fill}" stroke="${attrs.stroke}" stroke-width="${fmtNum(sw)}" stroke-linecap="butt"/>`;
}
