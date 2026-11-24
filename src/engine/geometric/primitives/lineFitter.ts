import {
  geometricAcceptance,
  type Point2D,
} from '../contract/geometricContract';
import { fmtNum, type LinePrimitive } from './types';

export interface FittedLineModel {
  px: number;
  py: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
}

/**
 * Ajusta uma reta por mínimos quadrados ortogonais (Total Least Squares via PCA 2x2).
 * Retorna o modelo paramétrico normalizado (ponto médio + direção unitária + normal unitária).
 */
export function fitInfiniteLineTLS(points: Point2D[]): FittedLineModel | null {
  const n = points.length;
  if (n < 2) return null;

  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Autovetor associado ao maior autovalor da matriz de covariância 2x2
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(theta);
  let dy = Math.sin(theta);

  // Alinha o sentido do vetor diretor do primeiro ao último ponto da cadeia
  const spanX = points[n - 1].x - points[0].x;
  const spanY = points[n - 1].y - points[0].y;
  if (dx * spanX + dy * spanY < 0) {
    dx = -dx;
    dy = -dy;
  }

  return {
    px: mx,
    py: my,
    dx,
    dy,
    nx: -dy,
    ny: dx,
  };
}

export function pointToInfiniteLineDist(p: Point2D, line: FittedLineModel): number {
  return Math.abs((p.x - line.px) * line.nx + (p.y - line.py) * line.ny);
}

export function intersectLines(a: FittedLineModel, b: FittedLineModel): Point2D | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const rx = b.px - a.px;
  const ry = b.py - a.py;
  const t = (rx * b.dy - ry * b.dx) / det;
  return {
    x: a.px + t * a.dx,
    y: a.py + t * a.dy,
  };
}

/**
 * Ajusta um segmento de reta preservando os extremos projetados (ou âncoras exatas quando fornecidas)
 * e valida contra o contrato geométrico da Etapa 1.
 */
export function fitLineSegment(
  points: Point2D[],
  options?: {
    preserveEndpoints?: boolean;
    maxErrorPx?: number;
    meanErrorPx?: number;
    snapAxisDeg?: number;
  }
): LinePrimitive | null {
  if (points.length < 2) return null;
  const model = fitInfiniteLineTLS(points);
  if (!model) return null;

  // Snap suave para horizontal/vertical exata se o ângulo estiver dentro da tolerância subpixel
  const snapDeg = options?.snapAxisDeg ?? 0.25;
  const angleDeg = (Math.atan2(model.dy, model.dx) * 180) / Math.PI;
  const mod90 = Math.abs(((angleDeg % 90) + 90) % 90);
  if (Math.min(mod90, 90 - mod90) <= snapDeg) {
    if (Math.abs(model.dx) >= Math.abs(model.dy)) {
      model.dx = model.dx >= 0 ? 1 : -1;
      model.dy = 0;
    } else {
      model.dx = 0;
      model.dy = model.dy >= 0 ? 1 : -1;
    }
    model.nx = -model.dy;
    model.ny = model.dx;
  }

  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;

  if (options?.preserveEndpoints) {
    x1 = points[0].x;
    y1 = points[0].y;
    x2 = points[points.length - 1].x;
    y2 = points[points.length - 1].y;
  } else {
    const first = points[0];
    const last = points[points.length - 1];
    const t0 = (first.x - model.px) * model.dx + (first.y - model.py) * model.dy;
    const t1 = (last.x - model.px) * model.dx + (last.y - model.py) * model.dy;
    x1 = model.px + t0 * model.dx;
    y1 = model.py + t0 * model.dy;
    x2 = model.px + t1 * model.dx;
    y2 = model.py + t1 * model.dy;
  }

  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1e-4) return null;

  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  let maxErrorPx = 0;
  let sumErrorPx = 0;
  for (const p of points) {
    const proj = (p.x - x1) * ux + (p.y - y1) * uy;
    const clamped = Math.max(0, Math.min(len, proj));
    const qx = x1 + clamped * ux;
    const qy = y1 + clamped * uy;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d > maxErrorPx) maxErrorPx = d;
    sumErrorPx += d;
  }
  const meanErrorPx = sumErrorPx / points.length;

  const maxLimit = options?.maxErrorPx ?? geometricAcceptance.line.maxPx;
  const meanLimit = options?.meanErrorPx ?? geometricAcceptance.line.meanPx;
  if (maxErrorPx > maxLimit || meanErrorPx > meanLimit) return null;

  return {
    kind: 'line',
    x1,
    y1,
    x2,
    y2,
    maxErrorPx,
    meanErrorPx,
  };
}

export function lineToSvgElement(
  line: LinePrimitive,
  attrs: { stroke: string; strokeWidth?: number }
): string {
  const sw = attrs.strokeWidth ?? 1;
  return `<line x1="${fmtNum(line.x1)}" y1="${fmtNum(line.y1)}" x2="${fmtNum(line.x2)}" y2="${fmtNum(line.y2)}" stroke="${attrs.stroke}" stroke-width="${fmtNum(sw)}" stroke-linecap="butt"/>`;
}
