import type { Point2D } from '../contract/geometricContract';

export interface CubicSpan {
  p0: Point2D;
  p1: Point2D;
  p2: Point2D;
  p3: Point2D;
}

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function unit(x: number, y: number): Point2D {
  const length = Math.hypot(x, y);
  if (length < 1e-8) return { x: 1, y: 0 };
  return { x: x / length, y: y / length };
}

export function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

export function angleBetween(a: Point2D, b: Point2D): number {
  const denom = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (denom < 1e-8) return 0;
  const value = Math.max(-1, Math.min(1, dot(a, b) / denom));
  return (Math.acos(value) * 180) / Math.PI;
}

export function cubicAt(span: CubicSpan, t: number): Point2D {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * span.p0.x + b1 * span.p1.x + b2 * span.p2.x + b3 * span.p3.x,
    y: b0 * span.p0.y + b1 * span.p1.y + b2 * span.p2.y + b3 * span.p3.y,
  };
}

export function cubicTangent(span: CubicSpan, t: number): Point2D {
  const u = 1 - t;
  const dx =
    3 * u * u * (span.p1.x - span.p0.x) +
    6 * u * t * (span.p2.x - span.p1.x) +
    3 * t * t * (span.p3.x - span.p2.x);
  const dy =
    3 * u * u * (span.p1.y - span.p0.y) +
    6 * u * t * (span.p2.y - span.p1.y) +
    3 * t * t * (span.p3.y - span.p2.y);
  return unit(dx, dy);
}

/** Curvatura com sinal. O sinal acompanha a mudança de direção da tangente. */
export function cubicCurvature(span: CubicSpan, t: number): number {
  const u = 1 - t;
  const dx =
    3 * u * u * (span.p1.x - span.p0.x) +
    6 * u * t * (span.p2.x - span.p1.x) +
    3 * t * t * (span.p3.x - span.p2.x);
  const dy =
    3 * u * u * (span.p1.y - span.p0.y) +
    6 * u * t * (span.p2.y - span.p1.y) +
    3 * t * t * (span.p3.y - span.p2.y);
  const ddx =
    6 * u * (span.p2.x - 2 * span.p1.x + span.p0.x) + 6 * t * (span.p3.x - 2 * span.p2.x + span.p1.x);
  const ddy =
    6 * u * (span.p2.y - 2 * span.p1.y + span.p0.y) + 6 * t * (span.p3.y - 2 * span.p2.y + span.p1.y);
  const speed = Math.hypot(dx, dy);
  if (speed < 1e-8) return 0;
  return (dx * ddy - dy * ddx) / (speed * speed * speed);
}

export function sampleCubic(span: CubicSpan, step = 0.8): Point2D[] {
  const rough = dist(span.p0, span.p1) + dist(span.p1, span.p2) + dist(span.p2, span.p3);
  const count = Math.max(8, Math.ceil(rough / step));
  const points: Point2D[] = [];
  for (let i = 0; i <= count; i++) points.push(cubicAt(span, i / count));
  return points;
}

export function resamplePolyline(points: Point2D[], step: number, closed: boolean): Point2D[] {
  if (points.length === 0) return [];
  const source = closed ? [...points, points[0]] : points;
  const out: Point2D[] = [{ ...source[0] }];
  let carry = 0;
  for (let i = 1; i < source.length; i++) {
    let ax = source[i - 1].x;
    let ay = source[i - 1].y;
    let remain = dist(source[i - 1], source[i]);
    while (carry + remain >= step) {
      const need = step - carry;
      const length = remain || 1;
      ax += ((source[i].x - ax) * need) / length;
      ay += ((source[i].y - ay) * need) / length;
      out.push({ x: ax, y: ay });
      remain -= need;
      carry = 0;
    }
    carry += remain;
  }
  if (!closed && dist(out[out.length - 1], source[source.length - 1]) > step * 0.35) {
    out.push({ ...source[source.length - 1] });
  }
  if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) < step * 0.4) out.pop();
  return out;
}

function cumulative(points: Point2D[], closed: boolean): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  if (closed && points.length > 1) cum.push(cum[cum.length - 1] + dist(points[points.length - 1], points[0]));
  return cum;
}

function pointAtArc(points: Point2D[], cum: number[], distance: number, closed: boolean): Point2D {
  const total = cum[cum.length - 1];
  let target = distance;
  if (closed) target = ((target % total) + total) % total;
  else target = Math.max(0, Math.min(total, target));
  let hi = 1;
  while (hi < cum.length - 1 && cum[hi] < target) hi++;
  const lo = hi - 1;
  const span = cum[hi] - cum[lo] || 1;
  const t = (target - cum[lo]) / span;
  const a = points[lo % points.length];
  const b = points[hi % points.length];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface CurveFeatures {
  corners: number[];
  inflections: number[];
  tangents: Point2D[];
}

/**
 * Cantos são picos de giro concentrados. Uma curva apertada, mas contínua, reparte o giro
 * numa janela maior e não vira âncora. Inflexões marcam troca estável de sinal da curvatura.
 */
export function detectCurveFeatures(points: Point2D[], closed: boolean): CurveFeatures {
  const n = points.length;
  const tangents: Point2D[] = [];
  const cum = cumulative(points, closed);
  const total = cum[closed ? cum.length - 1 : n - 1] || 1;
  const window = Math.min(3.2, total / 12);

  for (let i = 0; i < n; i++) {
    const ahead = pointAtArc(points, cum, cum[i] + window, closed);
    const behind = pointAtArc(points, cum, cum[i] - window, closed);
    tangents.push(unit(ahead.x - behind.x, ahead.y - behind.y));
  }

  const turnAt = (index: number, reach: number) => {
    const ahead = pointAtArc(points, cum, cum[index] + reach, closed);
    const behind = pointAtArc(points, cum, cum[index] - reach, closed);
    const incoming = unit(points[index].x - behind.x, points[index].y - behind.y);
    const outgoing = unit(ahead.x - points[index].x, ahead.y - points[index].y);
    return angleBetween(incoming, outgoing);
  };

  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i < 2 || i > n - 3)) continue;
    const short = turnAt(i, window);
    const long = turnAt(i, Math.min(window * 3.2, total / 6));
    if (short < 46 || short < long * 0.62) continue;
    let localMax = true;
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      const j = closed ? (i + k + n) % n : i + k;
      if (j < 0 || j >= n) continue;
      if (turnAt(j, window) > short + 0.4) localMax = false;
    }
    if (localMax) corners.push(i);
  }

  const filtered: number[] = [];
  for (const index of corners) {
    if (filtered.length === 0 || dist(points[filtered[filtered.length - 1]], points[index]) >= 3.5) {
      filtered.push(index);
    } else if (turnAt(index, window) > turnAt(filtered[filtered.length - 1], window)) {
      filtered[filtered.length - 1] = index;
    }
  }
  if (closed && filtered.length > 1 && dist(points[filtered[0]], points[filtered[filtered.length - 1]]) < 3.5) {
    filtered.pop();
  }

  const curvature: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? (i - 2 + n) % n : Math.max(0, i - 2);
    const next = closed ? (i + 2) % n : Math.min(n - 1, i + 2);
    const ds = Math.max(0.5, dist(points[prev], points[next]));
    const turn = ((Math.atan2(cross(tangents[prev], tangents[next]), dot(tangents[prev], tangents[next])) * 180) / Math.PI);
    curvature.push(turn / ds);
  }

  const inflections: number[] = [];
  for (let i = closed ? 0 : 2; i < (closed ? n : n - 2); i++) {
    const prev = curvature[closed ? (i - 1 + n) % n : i - 1];
    const curr = curvature[i];
    if (prev * curr >= 0 || Math.abs(prev) < 0.35 || Math.abs(curr) < 0.35) continue;
    let before = 0;
    let after = 0;
    for (let k = 1; k <= 6; k++) {
      const ib = closed ? (i - k + n) % n : i - k;
      const ia = closed ? (i + k) % n : i + k;
      if (ib >= 0 && ib < n) before += curvature[ib];
      if (ia >= 0 && ia < n) after += curvature[ia];
    }
    if (Math.abs(before) > 4 && Math.abs(after) > 4 && before * after < 0) inflections.push(i);
  }

  return { corners: filtered, inflections, tangents };
}

export function forwardTangent(points: Point2D[]): Point2D {
  let traveled = 0;
  let index = Math.min(1, points.length - 1);
  for (let i = 1; i < points.length; i++) {
    traveled += dist(points[i - 1], points[i]);
    index = i;
    if (traveled >= 3.2) break;
  }
  return unit(points[index].x - points[0].x, points[index].y - points[0].y);
}

export function arrivalTangent(points: Point2D[]): Point2D {
  let traveled = 0;
  let index = Math.max(0, points.length - 2);
  for (let i = points.length - 1; i > 0; i--) {
    traveled += dist(points[i], points[i - 1]);
    index = i - 1;
    if (traveled >= 3.2) break;
  }
  const last = points[points.length - 1];
  return unit(last.x - points[index].x, last.y - points[index].y);
}
