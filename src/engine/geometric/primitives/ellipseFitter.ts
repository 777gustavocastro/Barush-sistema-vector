import {
  geometricAcceptance,
  type Point2D,
} from '../contract/geometricContract';
import { fmtNum, type EllipsePrimitive } from './types';

/**
 * Distância euclidiana exata de um ponto (x, y) até uma elipse (cx, cy, rx, ry, thetaRad).
 * Usa projeção no referencial local da elipse e 6 passos de Newton no parâmetro angular.
 */
export function pointToEllipseSignedDistance(
  p: Point2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thetaRad: number
): number {
  const cosT = Math.cos(thetaRad);
  const sinT = Math.sin(thetaRad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * cosT + dy * sinT;
  const ly = -dx * sinT + dy * cosT;

  const ax = Math.abs(lx);
  const ay = Math.abs(ly);

  // Chute inicial no primeiro quadrante
  let t = Math.atan2(ay * rx, ax * ry);
  for (let i = 0; i < 6; i++) {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const ex = rx * ct;
    const ey = ry * st;
    const f = (ex - ax) * (-rx * st) + (ey - ay) * (ry * ct);
    const df =
      rx * rx * st * st -
      (ex - ax) * rx * ct +
      ry * ry * ct * ct -
      (ey - ay) * ry * st;
    if (Math.abs(df) < 1e-12) break;
    const step = f / df;
    t = Math.max(0, Math.min(Math.PI * 0.5, t - step));
    if (Math.abs(step) < 1e-9) break;
  }

  const qx = rx * Math.cos(t);
  const qy = ry * Math.sin(t);
  const dist = Math.hypot(ax - qx, ay - qy);
  const norm = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
  return norm >= 1 ? dist : -dist;
}

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const div = M[col][col];
    for (let k = col; k <= n; k++) M[col][k] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k];
    }
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(M[i][n])) return null;
    out[i] = M[i][n];
  }
  return out;
}

/**
 * Estima parâmetros iniciais de elipse via momentos ponderados por comprimento de arco
 * e refina por Levenberg-Marquardt minimizando distâncias euclidianas reais à curva.
 */
export function fitEllipseRaw(
  points: Point2D[],
  maxIterations = 30
): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  thetaRad: number;
  maxErrorPx: number;
  meanErrorPx: number;
} | null {
  const n = points.length;
  if (n < 10) return null;

  // Momentos ponderados por comprimento de arco para invariância à densidade de amostragem
  let wSum = 0;
  let mx = 0;
  let my = 0;
  const weights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const w = 0.5 * (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) + Math.hypot(next.x - points[i].x, next.y - points[i].y));
    weights[i] = Math.max(1e-4, w);
    wSum += weights[i];
    mx += points[i].x * weights[i];
    my += points[i].y * weights[i];
  }
  mx /= wSum;
  my /= wSum;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i].x - mx;
    const dy = points[i].y - my;
    sxx += weights[i] * dx * dx;
    syy += weights[i] * dy * dy;
    sxy += weights[i] * dx * dy;
  }
  sxx /= wSum;
  syy /= wSum;
  sxy /= wSum;

  const trace = sxx + syy;
  const disc = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) + 4 * sxy * sxy));
  const l1 = 0.5 * (trace + disc);
  const l2 = Math.max(1e-4, 0.5 * (trace - disc));
  let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let rx = Math.sqrt(Math.max(1, 2 * l1));
  let ry = Math.sqrt(Math.max(1, 2 * l2));
  let cx = mx;
  let cy = my;

  // Subamostragem uniforme para otimização rápida
  const stride = Math.max(1, Math.floor(n / 180));
  const sample: Point2D[] = [];
  for (let i = 0; i < n; i += stride) sample.push(points[i]);

  let params = [cx, cy, rx, ry, theta];
  const eps = [1e-3, 1e-3, 1e-3, 1e-3, 1e-4];
  let lambda = 1e-2;

  const evalCost = (p: number[]): number => {
    if (p[2] < 1.5 || p[3] < 1.5) return Number.POSITIVE_INFINITY;
    let sum = 0;
    for (const pt of sample) {
      const r = pointToEllipseSignedDistance(pt, p[0], p[1], p[2], p[3], p[4]);
      sum += r * r;
    }
    return sum;
  };

  let currentCost = evalCost(params);

  for (let iter = 0; iter < maxIterations; iter++) {
    const H = Array.from({ length: 5 }, () => new Array<number>(5).fill(0));
    const g = new Array<number>(5).fill(0);

    for (const pt of sample) {
      const r0 = pointToEllipseSignedDistance(pt, params[0], params[1], params[2], params[3], params[4]);
      const J = new Array<number>(5);
      for (let k = 0; k < 5; k++) {
        const saved = params[k];
        params[k] = saved + eps[k];
        const rk = pointToEllipseSignedDistance(pt, params[0], params[1], params[2], params[3], params[4]);
        params[k] = saved;
        J[k] = (rk - r0) / eps[k];
      }
      for (let a = 0; a < 5; a++) {
        g[a] += J[a] * r0;
        for (let b = 0; b < 5; b++) {
          H[a][b] += J[a] * J[b];
        }
      }
    }

    for (let k = 0; k < 5; k++) H[k][k] += lambda * Math.max(1, H[k][k]);
    const step = solveLinearSystem(
      H,
      g.map((v) => -v)
    );
    if (!step) break;

    const cand = params.map((v, k) => v + step[k]);
    const candCost = evalCost(cand);
    if (candCost < currentCost) {
      const relImprove = (currentCost - candCost) / Math.max(1e-9, currentCost);
      params = cand;
      currentCost = candCost;
      lambda = Math.max(1e-6, lambda * 0.3);
      if (relImprove < 1e-7) break;
    } else {
      lambda = Math.min(1e5, lambda * 5);
    }
  }

  [cx, cy, rx, ry, theta] = params;
  // Normaliza para rx >= ry e ângulo em [-90°, 90°)
  if (ry > rx) {
    const tmp = rx;
    rx = ry;
    ry = tmp;
    theta += Math.PI * 0.5;
  }
  while (theta >= Math.PI * 0.5) theta -= Math.PI;
  while (theta < -Math.PI * 0.5) theta += Math.PI;

  // Snap suave para eixo horizontal/vertical quando rotação é desprezível
  if (Math.abs((theta * 180) / Math.PI) < 0.35) {
    theta = 0;
  }

  let maxErrorPx = 0;
  let sumErrorPx = 0;
  for (const pt of points) {
    const d = Math.abs(pointToEllipseSignedDistance(pt, cx, cy, rx, ry, theta));
    if (d > maxErrorPx) maxErrorPx = d;
    sumErrorPx += d;
  }

  return {
    cx,
    cy,
    rx,
    ry,
    thetaRad: theta,
    maxErrorPx,
    meanErrorPx: sumErrorPx / n,
  };
}

/**
 * Ajusta e valida uma elipse fechada contra o contrato da Etapa 1.
 * Exige cobertura angular completa (~360°) e rejeita círculos puros (tratados por circleFitter).
 */
export function fitEllipsePrimitive(
  points: Point2D[],
  options?: {
    maxRadialErrorPx?: number;
    minSemiAxisPx?: number;
    minAngularCoverageRatio?: number;
  }
): EllipsePrimitive | null {
  const maxLimit = options?.maxRadialErrorPx ?? geometricAcceptance.ellipse.maxRadialPx;
  const minSemi = options?.minSemiAxisPx ?? 2.5;
  const minCoverage = options?.minAngularCoverageRatio ?? 0.92;

  const fit = fitEllipseRaw(points);
  if (!fit) return null;
  if (fit.rx < minSemi || fit.ry < minSemi) return null;
  if (fit.maxErrorPx > maxLimit) return null;

  const cosT = Math.cos(fit.thetaRad);
  const sinT = Math.sin(fit.thetaRad);
  const bins = 36;
  const occupied = new Uint8Array(bins);
  for (const p of points) {
    const dx = p.x - fit.cx;
    const dy = p.y - fit.cy;
    const lx = (dx * cosT + dy * sinT) / fit.rx;
    const ly = (-dx * sinT + dy * cosT) / fit.ry;
    let ang = Math.atan2(ly, lx);
    if (ang < 0) ang += Math.PI * 2;
    const idx = Math.min(bins - 1, Math.floor((ang / (Math.PI * 2)) * bins));
    occupied[idx] = 1;
  }
  let filled = 0;
  for (let i = 0; i < bins; i++) filled += occupied[i];
  if (filled / bins < minCoverage) return null;

  return {
    kind: 'ellipse',
    cx: fit.cx,
    cy: fit.cy,
    rx: fit.rx,
    ry: fit.ry,
    rotationDeg: (fit.thetaRad * 180) / Math.PI,
    maxErrorPx: fit.maxErrorPx,
    meanErrorPx: fit.meanErrorPx,
  };
}

export function ellipseToSvgElement(
  ellipse: EllipsePrimitive,
  attrs: { fill: string; stroke?: string; strokeWidth?: number }
): string {
  const strokeAttr = attrs.stroke
    ? ` stroke="${attrs.stroke}" stroke-width="${fmtNum(attrs.strokeWidth ?? 1)}"`
    : '';
  const transformAttr =
    Math.abs(ellipse.rotationDeg) > 0.05
      ? ` transform="rotate(${fmtNum(ellipse.rotationDeg)} ${fmtNum(ellipse.cx)} ${fmtNum(ellipse.cy)})"`
      : '';
  return `<ellipse cx="${fmtNum(ellipse.cx)}" cy="${fmtNum(ellipse.cy)}" rx="${fmtNum(ellipse.rx)}" ry="${fmtNum(ellipse.ry)}" fill="${attrs.fill}"${strokeAttr}${transformAttr}/>`;
}
