import {
  geometricAcceptance,
  type Point2D,
} from '../contract/geometricContract';
import { fmtNum, type CirclePrimitive } from './types';

export interface CircleFitRaw {
  cx: number;
  cy: number;
  r: number;
  maxErrorPx: number;
  meanErrorPx: number;
}

/**
 * Ajuste algébrico de Kåsa seguido de refinamento geométrico Gauss-Newton
 * minimizando o resíduo radial verdadeiro r_i = sqrt((x_i-cx)^2+(y_i-cy)^2) - r.
 */
export function fitCircleRaw(points: Point2D[], maxIterations = 25): CircleFitRaw | null {
  const n = points.length;
  if (n < 6) return null;

  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  // Sistema normal de Kåsa em coordenadas centralizadas
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;

  for (const p of points) {
    const u = p.x - mx;
    const v = p.y - my;
    const uu = u * u;
    const vv = v * v;
    suu += uu;
    suv += u * v;
    svv += vv;
    suuu += uu * u;
    svvv += vv * v;
    suvv += u * vv;
    svuu += v * uu;
  }

  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-8) return null;

  const rhs1 = 0.5 * (suuu + suvv);
  const rhs2 = 0.5 * (svvv + svuu);
  const uc = (rhs1 * svv - rhs2 * suv) / det;
  const vc = (suu * rhs2 - suv * rhs1) / det;

  let cx = mx + uc;
  let cy = my + vc;
  let r = Math.sqrt(Math.max(1e-6, uc * uc + vc * vc + (suu + svv) / n));

  // Refinamento geométrico Gauss-Newton amortecido
  for (let iter = 0; iter < maxIterations; iter++) {
    let j00 = 0;
    let j01 = 0;
    let j02 = 0;
    let j11 = 0;
    let j12 = 0;
    let j22 = 0;
    let g0 = 0;
    let g1 = 0;
    let g2 = 0;

    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-8) continue;
      const res = dist - r;
      const jx = -dx / dist;
      const jy = -dy / dist;
      const jr = -1;

      j00 += jx * jx;
      j01 += jx * jy;
      j02 += jx * jr;
      j11 += jy * jy;
      j12 += jy * jr;
      j22 += jr * jr;

      g0 += jx * res;
      g1 += jy * res;
      g2 += jr * res;
    }

    // Amortecimento leve tipo Levenberg-Marquardt
    const lambda = 1e-6;
    const delta = solve3x3(
      j00 + lambda,
      j01,
      j02,
      j01,
      j11 + lambda,
      j12,
      j02,
      j12,
      j22 + lambda,
      -g0,
      -g1,
      -g2
    );
    if (!delta) break;

    cx += delta[0];
    cy += delta[1];
    r += delta[2];
    if (r <= 0.5 || !Number.isFinite(r)) return null;
    if (Math.hypot(delta[0], delta[1], delta[2]) < 1e-7) break;
  }

  let maxErrorPx = 0;
  let sumErrorPx = 0;
  for (const p of points) {
    const d = Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
    if (d > maxErrorPx) maxErrorPx = d;
    sumErrorPx += d;
  }

  return {
    cx,
    cy,
    r,
    maxErrorPx,
    meanErrorPx: sumErrorPx / n,
  };
}

/**
 * Ajusta e valida um círculo fechado contra o contrato da Etapa 1.
 * Verifica cobertura angular completa (~360°) para nunca classificar um arco aberto
 * ou forma orgânica parcial como círculo fechado.
 */
export function fitCirclePrimitive(
  points: Point2D[],
  options?: {
    maxRadiusErrorPx?: number;
    minRadiusPx?: number;
    minAngularCoverageRatio?: number;
  }
): CirclePrimitive | null {
  const minRadiusPx = options?.minRadiusPx ?? 2.5;
  const maxLimit = options?.maxRadiusErrorPx ?? geometricAcceptance.circle.maxRadiusPx;
  const minCoverage = options?.minAngularCoverageRatio ?? 0.92;

  const fit = fitCircleRaw(points);
  if (!fit) return null;
  if (fit.r < minRadiusPx) return null;
  if (fit.maxErrorPx > maxLimit) return null;

  // Verifica cobertura angular em 36 setores de 10°
  const bins = 36;
  const occupied = new Uint8Array(bins);
  for (const p of points) {
    let ang = Math.atan2(p.y - fit.cy, p.x - fit.cx);
    if (ang < 0) ang += Math.PI * 2;
    const idx = Math.min(bins - 1, Math.floor((ang / (Math.PI * 2)) * bins));
    occupied[idx] = 1;
  }
  let filled = 0;
  for (let i = 0; i < bins; i++) filled += occupied[i];
  if (filled / bins < minCoverage) return null;

  return {
    kind: 'circle',
    cx: fit.cx,
    cy: fit.cy,
    r: fit.r,
    maxErrorPx: fit.maxErrorPx,
    meanErrorPx: fit.meanErrorPx,
  };
}

export function circleToSvgElement(
  circle: CirclePrimitive,
  attrs: { fill: string; stroke?: string; strokeWidth?: number }
): string {
  const strokeAttr = attrs.stroke
    ? ` stroke="${attrs.stroke}" stroke-width="${fmtNum(attrs.strokeWidth ?? 1)}"`
    : '';
  return `<circle cx="${fmtNum(circle.cx)}" cy="${fmtNum(circle.cy)}" r="${fmtNum(circle.r)}" fill="${attrs.fill}"${strokeAttr}/>`;
}

export function solve3x3(
  a00: number,
  a01: number,
  a02: number,
  a10: number,
  a11: number,
  a12: number,
  a20: number,
  a21: number,
  a22: number,
  b0: number,
  b1: number,
  b2: number
): [number, number, number] | null {
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-12) return null;

  const x0 =
    (b0 * (a11 * a22 - a12 * a21) -
      a01 * (b1 * a22 - a12 * b2) +
      a02 * (b1 * a21 - a11 * b2)) /
    det;
  const x1 =
    (a00 * (b1 * a22 - a12 * b2) -
      b0 * (a10 * a22 - a12 * a20) +
      a02 * (a10 * b2 - b1 * a20)) /
    det;
  const x2 =
    (a00 * (a11 * b2 - b1 * a21) -
      a01 * (a10 * b2 - b1 * a20) +
      b0 * (a10 * a21 - a11 * a20)) /
    det;
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(x2)) return null;
  return [x0, x1, x2];
}
