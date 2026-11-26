import {
  boundaryError,
  geometricAcceptance,
  type ErrorStats,
  type Point2D,
} from '../contract/geometricContract';
import { fmtNum } from '../primitives/types';
import {
  angleBetween,
  arrivalTangent,
  cubicAt,
  cubicCurvature,
  cubicTangent,
  detectCurveFeatures,
  dist,
  forwardTangent,
  resamplePolyline,
  sampleCubic,
  unit,
  type CubicSpan,
} from './curveFeatures';

export interface OrganicLimits {
  maxPx: number;
  meanPx: number;
  hausdorffPx: number;
}

export interface OrganicFit {
  closed: boolean;
  spans: CubicSpan[];
  straight: boolean[];
  corners: Point2D[];
  inflections: Point2D[];
  error: ErrorStats;
  g1BreakDeg: number;
  g2Ratio: number;
  path: string;
}

const DEFAULT_LIMITS: OrganicLimits = {
  maxPx: geometricAcceptance.organic.maxPx,
  meanPx: geometricAcceptance.organic.meanPx,
  hausdorffPx: geometricAcceptance.organic.hausdorffPx,
};

function chordLengths(points: Point2D[]): number[] {
  const t = [0];
  let total = 0;
  const steps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const step = dist(points[i - 1], points[i]);
    steps.push(step);
    total += step;
  }
  let cursor = 0;
  for (const step of steps) {
    cursor += step;
    t.push(total < 1e-8 ? 0 : cursor / total);
  }
  return t;
}

function maxDeviationFromChord(points: Point2D[]): number {
  const a = points[0];
  const b = points[points.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let max = 0;
  for (const point of points) {
    const t = len2 < 1e-8 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    max = Math.max(max, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return max;
}

/** Ajusta uma cúbica com tangentes prescritas. As alças negativas indicam que o trecho precisa ser dividido. */
export function fitCubicWithTangents(points: Point2D[], tangentIn: Point2D, tangentOut: Point2D): CubicSpan | null {
  if (points.length < 2) return null;
  const p0 = points[0];
  const p3 = points[points.length - 1];
  const tIn = unit(tangentIn.x, tangentIn.y);
  const tOut = unit(tangentOut.x, tangentOut.y);
  const params = chordLengths(points);
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < points.length; i++) {
    const t = params[i];
    const u = 1 - t;
    const c1 = 3 * u * u * t;
    const c2 = 3 * u * t * t;
    const vx = points[i].x - ((u * u * u + c1) * p0.x + (c2 + t * t * t) * p3.x);
    const vy = points[i].y - ((u * u * u + c1) * p0.y + (c2 + t * t * t) * p3.y);
    const a1x = c1 * tIn.x;
    const a1y = c1 * tIn.y;
    const a2x = c2 * -tOut.x;
    const a2y = c2 * -tOut.y;
    a11 += a1x * a1x + a1y * a1y;
    a12 += a1x * a2x + a1y * a2y;
    a22 += a2x * a2x + a2y * a2y;
    b1 += a1x * vx + a1y * vy;
    b2 += a2x * vx + a2y * vy;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-10) return null;
  const alpha = (b1 * a22 - b2 * a12) / det;
  const beta = (a11 * b2 - a12 * b1) / det;
  const chord = Math.max(1e-4, dist(p0, p3));
  if (alpha < chord * 0.02 || beta < chord * 0.02 || alpha > chord * 1.8 || beta > chord * 1.8) return null;
  return {
    p0,
    p1: { x: p0.x + tIn.x * alpha, y: p0.y + tIn.y * alpha },
    p2: { x: p3.x - tOut.x * beta, y: p3.y - tOut.y * beta },
    p3,
  };
}

function spanError(span: CubicSpan, points: Point2D[]): ErrorStats {
  return boundaryError(points, [sampleCubic(span, 0.7)]);
}

function within(error: ErrorStats, limits: OrganicLimits): boolean {
  return error.maxPx <= limits.maxPx && error.meanPx <= limits.meanPx && error.hausdorffPx <= limits.hausdorffPx;
}

function fitSpan(points: Point2D[], tangentIn: Point2D, tangentOut: Point2D, limits: OrganicLimits, depth: number): CubicSpan[] {
  if (points.length < 2) return [];
  if (
    maxDeviationFromChord(points) <= geometricAcceptance.line.maxPx &&
    angleBetween(tangentIn, tangentOut) <= geometricAcceptance.continuity.unintendedG1Deg
  ) {
    const chord = dist(points[0], points[points.length - 1]) || 1;
    const direction = unit(points[points.length - 1].x - points[0].x, points[points.length - 1].y - points[0].y);
    return [
      {
        p0: points[0],
        p1: { x: points[0].x + direction.x * chord * 0.33, y: points[0].y + direction.y * chord * 0.33 },
        p2: {
          x: points[points.length - 1].x - direction.x * chord * 0.33,
          y: points[points.length - 1].y - direction.y * chord * 0.33,
        },
        p3: points[points.length - 1],
      },
    ];
  }

  const fitted = fitCubicWithTangents(points, tangentIn, tangentOut);
  if (fitted) {
    const error = spanError(fitted, points);
    if (within(error, limits) || depth >= 8 || points.length < 8) return [fitted];
  } else if (depth >= 8 || points.length < 8) {
    const chord = dist(points[0], points[points.length - 1]) || 1;
    const directionIn = unit(tangentIn.x, tangentIn.y);
    const directionOut = unit(tangentOut.x, tangentOut.y);
    return [
      {
        p0: points[0],
        p1: { x: points[0].x + directionIn.x * chord * 0.3, y: points[0].y + directionIn.y * chord * 0.3 },
        p2: {
          x: points[points.length - 1].x - directionOut.x * chord * 0.3,
          y: points[points.length - 1].y - directionOut.y * chord * 0.3,
        },
        p3: points[points.length - 1],
      },
    ];
  }

  let split = Math.floor(points.length / 2);
  let worst = -1;
  if (fitted) {
    for (let i = 2; i < points.length - 2; i++) {
      const samples = sampleCubic(fitted, 0.8);
      let best = Infinity;
      for (let s = 1; s < samples.length; s++) {
        const ax = samples[s - 1].x;
        const ay = samples[s - 1].y;
        const dx = samples[s].x - ax;
        const dy = samples[s].y - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 < 1e-8 ? 0 : Math.max(0, Math.min(1, ((points[i].x - ax) * dx + (points[i].y - ay) * dy) / len2));
        const d = Math.hypot(points[i].x - (ax + t * dx), points[i].y - (ay + t * dy));
        if (d < best) best = d;
      }
      if (best > worst) {
        worst = best;
        split = i;
      }
    }
  }
  const features = detectCurveFeatures(points, false);
  const inflection = features.inflections.find((index) => index > 3 && index < points.length - 4);
  if (inflection) split = inflection;
  split = Math.max(3, Math.min(points.length - 4, split));
  const tangent = arrivalTangent(points.slice(0, split + 1));
  return [
    ...fitSpan(points.slice(0, split + 1), tangentIn, tangent, limits, depth + 1),
    ...fitSpan(points.slice(split), tangent, tangentOut, limits, depth + 1),
  ];
}

function isStraightSpan(span: CubicSpan): boolean {
  return (
    maxDeviationFromChord([span.p0, span.p1, span.p2, span.p3]) <= geometricAcceptance.line.maxPx &&
    maxDeviationFromChord(sampleCubic(span, 1)) <= geometricAcceptance.line.maxPx
  );
}

function alignSmoothJoins(spans: CubicSpan[], straight: boolean[], smoothJoin: boolean[]): void {
  for (let i = 0; i < spans.length; i++) {
    if (!smoothJoin[i]) continue;
    const next = (i + 1) % spans.length;
    const left = straight[i]
      ? unit(spans[i].p3.x - spans[i].p0.x, spans[i].p3.y - spans[i].p0.y)
      : cubicTangent(spans[i], 1);
    const right = straight[next]
      ? unit(spans[next].p3.x - spans[next].p0.x, spans[next].p3.y - spans[next].p0.y)
      : cubicTangent(spans[next], 0);
    if (angleBetween(left, right) <= geometricAcceptance.continuity.unintendedG1Deg) continue;
    const shared = unit(left.x + right.x, left.y + right.y);
    const leftLen = Math.max(0.25, dist(spans[i].p2, spans[i].p3));
    const rightLen = Math.max(0.25, dist(spans[next].p0, spans[next].p1));
    spans[i].p2 = { x: spans[i].p3.x - shared.x * leftLen, y: spans[i].p3.y - shared.y * leftLen };
    spans[next].p1 = { x: spans[next].p0.x + shared.x * rightLen, y: spans[next].p0.y + shared.y * rightLen };
    straight[i] = false;
    straight[next] = false;
  }
}

export function spansToPath(spans: CubicSpan[], straight: boolean[], closed: boolean): string {
  if (spans.length === 0) return '';
  const fmt = (value: number) => fmtNum(value);
  let path = `M ${fmt(spans[0].p0.x)} ${fmt(spans[0].p0.y)}`;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (straight[i]) path += ` L ${fmt(span.p3.x)} ${fmt(span.p3.y)}`;
    else {
      path += ` C ${fmt(span.p1.x)} ${fmt(span.p1.y)} ${fmt(span.p2.x)} ${fmt(span.p2.y)} ${fmt(span.p3.x)} ${fmt(span.p3.y)}`;
    }
  }
  if (closed) path += ' Z';
  return path;
}

function sliceClosed(points: Point2D[], start: number, end: number): Point2D[] {
  const out: Point2D[] = [];
  let index = start;
  for (let guard = 0; guard <= points.length; guard++) {
    out.push(points[index]);
    if (index === end) break;
    index = (index + 1) % points.length;
  }
  return out;
}

/**
 * Reconstrói uma curva orgânica com o menor número de cúbicas que cabe na tolerância.
 * Cantos permanecem âncoras. Trechos retos viram linhas. Junções suaves saem com a mesma tangente.
 */
export function fitOrganicCurve(
  input: Point2D[],
  options?: { closed?: boolean; limits?: OrganicLimits }
): OrganicFit {
  const closed = options?.closed ?? false;
  const limits = options?.limits ?? DEFAULT_LIMITS;
  const source = input.filter((point, index) => index === 0 || dist(point, input[index - 1]) > 1e-4);
  if (closed && source.length > 2 && dist(source[0], source[source.length - 1]) < 0.4) source.pop();
  const points = resamplePolyline(source, 0.7, closed);
  const empty: OrganicFit = {
    closed,
    spans: [],
    straight: [],
    corners: [],
    inflections: [],
    error: { maxPx: 0, meanPx: 0, hausdorffPx: 0, samples: 0 },
    g1BreakDeg: 0,
    g2Ratio: 0,
    path: '',
  };
  if (points.length < 2) return empty;

  const features = detectCurveFeatures(points, closed);
  let working = points;
  let cornerIndexes = features.corners;
  if (closed && cornerIndexes.length === 0 && points.length > 8) {
    let best = 0;
    let bestTurn = -1;
    for (let i = 0; i < points.length; i++) {
      const prev = features.tangents[(i - 2 + points.length) % points.length];
      const next = features.tangents[(i + 2) % points.length];
      const turn = angleBetween(prev, next);
      if (turn > bestTurn) {
        bestTurn = turn;
        best = i;
      }
    }
    working = [...points.slice(best), ...points.slice(0, best)];
    cornerIndexes = [];
  }

  const pieces: Point2D[][] = [];
  if (!closed) {
    const cuts = [0, ...cornerIndexes.filter((index) => index > 0 && index < working.length - 1), working.length - 1];
    const unique = [...new Set(cuts)].sort((a, b) => a - b);
    for (let i = 0; i < unique.length - 1; i++) pieces.push(working.slice(unique[i], unique[i + 1] + 1));
  } else if (cornerIndexes.length === 0) pieces.push(working);
  else {
    for (let i = 0; i < cornerIndexes.length; i++) {
      pieces.push(sliceClosed(working, cornerIndexes[i], cornerIndexes[(i + 1) % cornerIndexes.length]));
    }
  }

  const spans: CubicSpan[] = [];
  const cornerAfter: boolean[] = [];
  for (const piece of pieces) {
    if (piece.length < 2) continue;
    const tangentIn = forwardTangent(piece);
    const tangentOut = cornerIndexes.length === 0 && closed ? tangentIn : arrivalTangent(piece);
    const fitted = mergeInsidePiece(fitSpan(piece, tangentIn, tangentOut, limits, 0), limits);
    spans.push(...fitted);
    for (let i = 0; i < fitted.length; i++) cornerAfter.push(i === fitted.length - 1 && cornerIndexes.length > 0);
  }

  const straight = spans.map(isStraightSpan);
  const smoothLoop = closed && cornerIndexes.length === 0;
  const g1Joins = spans.map((_, index) => {
    if (index === spans.length - 1 && !smoothLoop) return false;
    return !cornerAfter[index];
  });
  alignSmoothJoins(spans, straight, g1Joins);
  const curvePoints = spans.flatMap((span) => sampleCubic(span, 0.8));
  const g2Ratio = tryG2At(spans, straight, g1Joins, points, limits);
  const error = boundaryError(points, [curvePoints]);
  return {
    closed,
    spans,
    straight,
    corners: cornerIndexes.map((index) => working[index]),
    inflections: features.inflections.map((index) => points[index]),
    error,
    g1BreakDeg: Number(maxG1At(spans, straight, g1Joins).toFixed(3)),
    g2Ratio: Number(g2Ratio.toFixed(3)),
    path: spansToPath(spans, straight, closed),
  };
}

function mergeInsidePiece(spans: CubicSpan[], limits: OrganicLimits): CubicSpan[] {
  const merged: CubicSpan[] = [...spans];
  let index = 0;
  while (index < merged.length - 1) {
    const combined = [
      merged[index].p0,
      ...sampleCubic(merged[index], 1.2).slice(1, -1),
      ...sampleCubic(merged[index + 1], 1.2),
    ];
    const trial = fitSpan(combined, cubicTangent(merged[index], 0), cubicTangent(merged[index + 1], 1), limits, 0);
    if (trial.length === 1 && within(spanError(trial[0], combined), limits)) {
      merged.splice(index, 2, trial[0]);
    } else {
      index++;
    }
  }
  return merged;
}

function maxG1At(spans: CubicSpan[], straight: boolean[], smoothJoin: boolean[]): number {
  let worst = 0;
  for (let i = 0; i < spans.length; i++) {
    if (!smoothJoin[i]) continue;
    const next = (i + 1) % spans.length;
    if (next === 0 && !smoothJoin[i]) continue;
    if (i === spans.length - 1 && next === 0 && spans.length === smoothJoin.length) {
      /* a volta do contorno fechado entra quando smoothJoin marca a emenda */
    }
    const left = straight[i]
      ? unit(spans[i].p3.x - spans[i].p0.x, spans[i].p3.y - spans[i].p0.y)
      : cubicTangent(spans[i], 1);
    const right = straight[next]
      ? unit(spans[next].p3.x - spans[next].p0.x, spans[next].p3.y - spans[next].p0.y)
      : cubicTangent(spans[next], 0);
    worst = Math.max(worst, angleBetween(left, right));
  }
  return worst;
}

function tryG2At(
  spans: CubicSpan[],
  straight: boolean[],
  smoothJoin: boolean[],
  points: Point2D[],
  limits: OrganicLimits
): number {
  for (let i = 0; i < spans.length; i++) {
    if (!smoothJoin[i]) continue;
    const next = (i + 1) % spans.length;
    if (straight[i] || straight[next]) continue;
    const kLeft = cubicCurvature(spans[i], 1);
    const kRight = cubicCurvature(spans[next], 0);
    if (kLeft * kRight <= 0) continue;
    const ratio = Math.abs(kLeft - kRight) / Math.max(1e-4, Math.max(Math.abs(kLeft), Math.abs(kRight)));
    if (ratio < 0.22) continue;
    const target = (kLeft + kRight) / 2;
    const previousLeft = { ...spans[i].p2 };
    const previousRight = { ...spans[next].p1 };
    const leftLen = dist(previousLeft, spans[i].p3);
    const rightLen = dist(spans[next].p0, previousRight);
    const leftDir = unit(spans[i].p3.x - previousLeft.x, spans[i].p3.y - previousLeft.y);
    const rightDir = unit(previousRight.x - spans[next].p0.x, previousRight.y - spans[next].p0.y);
    const leftScale = Math.max(0.5, Math.min(1.7, kLeft / target));
    const rightScale = Math.max(0.5, Math.min(1.7, kRight / target));
    spans[i].p2 = { x: spans[i].p3.x - leftDir.x * leftLen * leftScale, y: spans[i].p3.y - leftDir.y * leftLen * leftScale };
    spans[next].p1 = {
      x: spans[next].p0.x + rightDir.x * rightLen * rightScale,
      y: spans[next].p0.y + rightDir.y * rightLen * rightScale,
    };
    const error = boundaryError(points, [spans.flatMap((span) => sampleCubic(span, 1))]);
    if (!within(error, limits)) {
      spans[i].p2 = previousLeft;
      spans[next].p1 = previousRight;
    }
  }
  let worst = 0;
  for (let i = 0; i < spans.length; i++) {
    if (!smoothJoin[i]) continue;
    const next = (i + 1) % spans.length;
    if (straight[i] || straight[next]) continue;
    const kLeft = cubicCurvature(spans[i], 1);
    const kRight = cubicCurvature(spans[next], 0);
    if (kLeft * kRight <= 0) continue;
    worst = Math.max(worst, Math.abs(kLeft - kRight) / Math.max(1e-4, Math.max(Math.abs(kLeft), Math.abs(kRight))));
  }
  return worst;
}

export function sampleOrganic(fit: OrganicFit, step = 0.8): Point2D[] {
  return fit.spans.flatMap((span) => sampleCubic(span, step));
}

export { cubicAt };
