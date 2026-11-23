import type { Point2D } from './adaptiveBezierFitter';

export interface SchneiderFitOptions {
  maxErrorPx?: number;
  precision?: number;
}

const KAPPA = 0.5522847498307936;

/**
 * Ajuste de Schneider (Graphics Gems): cúbica por mínimos quadrados com tangentes
 * fixas, reparametrização de Newton e divisão no ponto de maior erro.
 * Uma quadrática entra quando o erro dela cabe na mesma tolerância.
 * Um arco circular vira cúbicas exatas, não uma polilinha.
 */
export function fitSchneiderOpenCurve(points: Point2D[], options: SchneiderFitOptions = {}): string {
  if (points.length < 2) return '';
  const maxError = options.maxErrorPx ?? 0.4;
  const precision = options.precision ?? 3;
  const cmds: string[] = [];
  const n = (v: number) => trimNum(v, precision);
  cmds.push(`M ${n(points[0].x)} ${n(points[0].y)}`);
  fitSpan(points, tangentAt(points, 0, false), tangentAt(points, points.length - 1, true), maxError, 0, cmds, precision);
  return cmds.join(' ');
}

/**
 * Círculo ou elipse fechada, em coordenadas subpixel. Devolve null quando a nuvem
 * não é uma cônica dentro da tolerância — o contorno então segue por Bézier.
 */
export function fitClosedConic(points: Point2D[], precision = 3): string | null {
  const seq = dropRepeatedClose(points);
  if (seq.length < 8) return null;
  let cx = 0;
  let cy = 0;
  for (const p of seq) {
    cx += p.x;
    cy += p.y;
  }
  cx /= seq.length;
  cy /= seq.length;

  let cxx = 0;
  let cxy = 0;
  let cyy = 0;
  for (const p of seq) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  cxx /= seq.length;
  cxy /= seq.length;
  cyy /= seq.length;
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  let rx = 0;
  let ry = 0;
  const local: Point2D[] = [];
  for (const p of seq) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const x = dx * cos + dy * sin;
    const y = -dx * sin + dy * cos;
    local.push({ x, y });
    rx += x * x;
    ry += y * y;
  }
  rx = Math.sqrt((2 * rx) / seq.length);
  ry = Math.sqrt((2 * ry) / seq.length);
  if (rx < 1.4 || ry < 1.4) return null;

  let maxRadial = 0;
  for (const p of local) {
    const nx = p.x / rx;
    const ny = p.y / ry;
    const dev = Math.abs(Math.hypot(nx, ny) - 1);
    if (dev > maxRadial) maxRadial = dev;
  }
  if (maxRadial > 0.06) return null;

  const n = (v: number) => trimNum(v, precision);
  const place = (x: number, y: number) => {
    const wx = cx + x * cos - y * sin;
    const wy = cy + x * sin + y * cos;
    return `${n(wx)} ${n(wy)}`;
  };
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return [
    `M ${place(rx, 0)}`,
    `C ${place(rx, ky)} ${place(kx, ry)} ${place(0, ry)}`,
    `C ${place(-kx, ry)} ${place(-rx, ky)} ${place(-rx, 0)}`,
    `C ${place(-rx, -ky)} ${place(-kx, -ry)} ${place(0, -ry)}`,
    `C ${place(kx, -ry)} ${place(rx, -ky)} ${place(rx, 0)}`,
    'Z',
  ].join(' ');
}

/**
 * Troca um contorno poligonal longo por cúbicas/quadráticas. Um caminho que já
 * tem curvas é mantido. Os subcaminhos e o fechamento permanecem.
 */
export function refitPolygonalPath(d: string, maxErrorPx = 0.35): string {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)/g);
  if (!tokens) return d;
  const subpaths: Point2D[][] = [];
  const closed: boolean[] = [];
  let cur: Point2D[] | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const read = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M') {
      if (cur && cur.length > 1) {
        subpaths.push(cur);
        closed.push(false);
      }
      cx = read();
      cy = read();
      sx = cx;
      sy = cy;
      cur = [{ x: cx, y: cy }];
    } else if (op === 'L') {
      cx = read();
      cy = read();
      cur?.push({ x: cx, y: cy });
    } else if (op === 'Q') {
      i += 2;
      cx = read();
      cy = read();
      cur?.push({ x: cx, y: cy });
    } else if (op === 'C') {
      i += 4;
      cx = read();
      cy = read();
      cur?.push({ x: cx, y: cy });
    } else if (op === 'Z' || op === 'z') {
      if (cur && (cur[0].x !== sx || cur[0].y !== sy)) cur.push({ x: sx, y: sy });
      if (cur && cur.length > 1) {
        subpaths.push(cur);
        closed.push(true);
      }
      cur = null;
    } else if (op === 'H') {
      cx = read();
      cur?.push({ x: cx, y: cy });
    } else if (op === 'V') {
      cy = read();
      cur?.push({ x: cx, y: cy });
    } else {
      return d;
    }
  }
  if (cur && cur.length > 1) {
    subpaths.push(cur);
    closed.push(false);
  }

  const lineCount = (d.match(/\bL\s/g) ?? []).length;
  const curveCount = (d.match(/\b[CQ]\s/g) ?? []).length;
  if (lineCount < 8 || curveCount > 1) return d;

  const parts: string[] = [];
  for (let s = 0; s < subpaths.length; s++) {
    const pts = subpaths[s];
    const isClosed = closed[s];
    const body = isClosed ? dropRepeatedClose(pts) : pts;
    if (body.length < 4) {
      parts.push(pointsToLines(pts, isClosed));
      continue;
    }
    const fitted = isClosed
      ? fitSchneiderOpenCurve([...body, body[0]], { maxErrorPx }) + ' Z'
      : fitSchneiderOpenCurve(body, { maxErrorPx });
    parts.push(fitted);
  }
  return parts.join(' ');
}

function fitSpan(
  pts: Point2D[],
  tHat1: Point2D,
  tHat2: Point2D,
  maxError: number,
  depth: number,
  out: string[],
  precision: number
): void {
  const n = pts.length;
  const p0 = pts[0];
  const pLast = pts[n - 1];
  const emitLine = () => {
    out.push(`L ${trimNum(pLast.x, precision)} ${trimNum(pLast.y, precision)}`);
  };
  if (n < 3 || Math.hypot(pLast.x - p0.x, pLast.y - p0.y) < 0.35) {
    emitLine();
    return;
  }
  if (maxChordDeviation(pts) <= Math.min(0.32, maxError)) {
    emitLine();
    return;
  }

  const arc = tryCircularArc(pts, Math.max(0.55, maxError * 1.6));
  if (arc) {
    for (const cmd of arc) out.push(cmd);
    return;
  }

  let quadU = chordParams(pts);
  let quad = fitQuadraticLeastSquares(pts, quadU);
  for (let iter = 0; iter < 3 && quad && quad.error > maxError; iter++) {
    quadU = newtonQuadratic(pts, quadU, pts[0], { x: quad.x1, y: quad.y1 }, pts[pts.length - 1]);
    quad = fitQuadraticLeastSquares(pts, quadU);
  }
  if (quad && quad.error <= maxError) {
    out.push(
      `Q ${trimNum(quad.x1, precision)} ${trimNum(quad.y1, precision)} ${trimNum(pLast.x, precision)} ${trimNum(pLast.y, precision)}`
    );
    return;
  }

  let u = chordParams(pts);
  let bez = fitCubicLeastSquares(pts, u, tHat1, tHat2);
  let err = maxCubicError(pts, u, bez);
  if (err.error <= maxError * 4 && err.error > maxError) {
    for (let iter = 0; iter < 4; iter++) {
      u = newtonReparam(pts, u, bez);
      bez = fitCubicLeastSquares(pts, u, tHat1, tHat2);
      err = maxCubicError(pts, u, bez);
      if (err.error <= maxError) break;
    }
  }
  if (err.error <= maxError || depth >= 8 || err.index <= 1 || err.index >= n - 2) {
    const quadAgain = tryQuadraticFromCubic(bez, maxError * 0.5);
    if (quadAgain) {
      out.push(
        `Q ${trimNum(quadAgain.x, precision)} ${trimNum(quadAgain.y, precision)} ${trimNum(pLast.x, precision)} ${trimNum(pLast.y, precision)}`
      );
    } else {
      out.push(
        `C ${trimNum(bez[1].x, precision)} ${trimNum(bez[1].y, precision)} ${trimNum(bez[2].x, precision)} ${trimNum(bez[2].y, precision)} ${trimNum(pLast.x, precision)} ${trimNum(pLast.y, precision)}`
      );
    }
    return;
  }

  const split = err.index;
  const midTan = tangentAt(pts, split, false);
  fitSpan(pts.slice(0, split + 1), tHat1, { x: -midTan.x, y: -midTan.y }, maxError, depth + 1, out, precision);
  fitSpan(pts.slice(split), midTan, tHat2, maxError, depth + 1, out, precision);
}

function fitCubicLeastSquares(
  pts: Point2D[],
  u: Float64Array,
  tHat1: Point2D,
  tHat2: Point2D
): [Point2D, Point2D, Point2D, Point2D] {
  const n = pts.length;
  const p0 = pts[0];
  const p3 = pts[n - 1];
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (n < 3 || chord < 1e-4) {
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
    const t = u[i];
    const mt = 1 - t;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const a1x = tHat1.x * b1;
    const a1y = tHat1.y * b1;
    const a2x = tHat2.x * b2;
    const a2y = tHat2.y * b2;
    c00 += a1x * a1x + a1y * a1y;
    c01 += a1x * a2x + a1y * a2y;
    c11 += a2x * a2x + a2y * a2y;
    const b0 = mt * mt * mt;
    const b3 = t * t * t;
    const tmpX = pts[i].x - (p0.x * (b0 + b1) + p3.x * (b2 + b3));
    const tmpY = pts[i].y - (p0.y * (b0 + b1) + p3.y * (b2 + b3));
    x0 += a1x * tmpX + a1y * tmpY;
    x1 += a2x * tmpX + a2y * tmpY;
  }
  const det = c00 * c11 - c01 * c01;
  let alphaL = Math.abs(det) > 1e-8 ? (x0 * c11 - x1 * c01) / det : chord / 3;
  let alphaR = Math.abs(det) > 1e-8 ? (c00 * x1 - c01 * x0) / det : chord / 3;
  const minA = chord * 0.08;
  const maxA = chord * 0.85;
  if (alphaL < minA) alphaL = chord / 3;
  if (alphaR < minA) alphaR = chord / 3;
  alphaL = Math.min(maxA, alphaL);
  alphaR = Math.min(maxA, alphaR);
  return [
    p0,
    { x: p0.x + tHat1.x * alphaL, y: p0.y + tHat1.y * alphaL },
    { x: p3.x + tHat2.x * alphaR, y: p3.y + tHat2.y * alphaR },
    p3,
  ];
}

function fitQuadraticLeastSquares(
  pts: Point2D[],
  u: Float64Array
): { x1: number; y1: number; error: number } | null {
  const p0 = pts[0];
  const p2 = pts[pts.length - 1];
  let w2 = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const w = 2 * mt * t;
    if (w < 1e-5) continue;
    const targetX = pts[i].x - mt * mt * p0.x - t * t * p2.x;
    const targetY = pts[i].y - mt * mt * p0.y - t * t * p2.y;
    w2 += w * w;
    tx += w * targetX;
    ty += w * targetY;
  }
  if (w2 < 1e-8) return null;
  const x1 = tx / w2;
  const y1 = ty / w2;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = u[i];
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * x1 + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * y1 + t * t * p2.y;
    max = Math.max(max, Math.hypot(x - pts[i].x, y - pts[i].y));
  }
  return { x1, y1, error: max };
}

function tryQuadraticFromCubic(
  bez: [Point2D, Point2D, Point2D, Point2D],
  tol: number
): Point2D | null {
  const [p0, p1, p2, p3] = bez;
  const q1x = (1.5 * p1.x - 0.5 * p0.x + 1.5 * p2.x - 0.5 * p3.x) * 0.5;
  const q1y = (1.5 * p1.y - 0.5 * p0.y + 1.5 * p2.y - 0.5 * p3.y) * 0.5;
  const mismatch = (3 / 16) * Math.hypot(1.5 * p1.x - 0.5 * p0.x - (1.5 * p2.x - 0.5 * p3.x), 1.5 * p1.y - 0.5 * p0.y - (1.5 * p2.y - 0.5 * p3.y));
  if (mismatch > tol) return null;
  return { x: q1x, y: q1y };
}

function newtonQuadratic(pts: Point2D[], u: Float64Array, p0: Point2D, p1: Point2D, p2: Point2D): Float64Array {
  const next = new Float64Array(pts.length);
  next[0] = 0;
  next[pts.length - 1] = 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = Math.max(0.02, Math.min(0.98, u[i]));
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
    const dx1 = 2 * mt * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy1 = 2 * mt * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const dx2 = 2 * (p0.x - 2 * p1.x + p2.x);
    const dy2 = 2 * (p0.y - 2 * p1.y + p2.y);
    const ex = x - pts[i].x;
    const ey = y - pts[i].y;
    const num = ex * dx1 + ey * dy1;
    const den = dx1 * dx1 + dy1 * dy1 + ex * dx2 + ey * dy2;
    if (Math.abs(den) > 1e-8) {
      next[i] = Math.max(next[i - 1] + 1e-4, Math.min(0.999, t - num / den));
    } else {
      next[i] = t;
    }
  }
  return next;
}

function newtonReparam(pts: Point2D[], u: Float64Array, bez: [Point2D, Point2D, Point2D, Point2D]): Float64Array {
  const next = new Float64Array(pts.length);
  next[0] = 0;
  next[pts.length - 1] = 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = u[i];
    const q = cubicAt(bez, t);
    const q1 = cubicDeriv(bez, t);
    const q2 = cubicDeriv2(bez, t);
    const dx = q.x - pts[i].x;
    const dy = q.y - pts[i].y;
    const num = dx * q1.x + dy * q1.y;
    const den = q1.x * q1.x + q1.y * q1.y + dx * q2.x + dy * q2.y;
    if (Math.abs(den) > 1e-8) {
      const cand = t - num / den;
      next[i] = Math.max(next[i - 1] + 1e-4, Math.min(0.999, cand));
    } else {
      next[i] = t;
    }
  }
  return next;
}

function maxCubicError(
  pts: Point2D[],
  u: Float64Array,
  bez: [Point2D, Point2D, Point2D, Point2D]
): { error: number; index: number } {
  let error = 0;
  let index = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = cubicAt(bez, u[i]);
    const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
    if (d >= error) {
      error = d;
      index = i;
    }
  }
  return { error, index };
}

function cubicAt(bez: [Point2D, Point2D, Point2D, Point2D], t: number): Point2D {
  const mt = 1 - t;
  const b0 = mt * mt * mt;
  const b1 = 3 * mt * mt * t;
  const b2 = 3 * mt * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * bez[0].x + b1 * bez[1].x + b2 * bez[2].x + b3 * bez[3].x,
    y: b0 * bez[0].y + b1 * bez[1].y + b2 * bez[2].y + b3 * bez[3].y,
  };
}

function cubicDeriv(bez: [Point2D, Point2D, Point2D, Point2D], t: number): Point2D {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (bez[1].x - bez[0].x) + 6 * mt * t * (bez[2].x - bez[1].x) + 3 * t * t * (bez[3].x - bez[2].x),
    y: 3 * mt * mt * (bez[1].y - bez[0].y) + 6 * mt * t * (bez[2].y - bez[1].y) + 3 * t * t * (bez[3].y - bez[2].y),
  };
}

function cubicDeriv2(bez: [Point2D, Point2D, Point2D, Point2D], t: number): Point2D {
  const mt = 1 - t;
  return {
    x: 6 * mt * (bez[2].x - 2 * bez[1].x + bez[0].x) + 6 * t * (bez[3].x - 2 * bez[2].x + bez[1].x),
    y: 6 * mt * (bez[2].y - 2 * bez[1].y + bez[0].y) + 6 * t * (bez[3].y - 2 * bez[2].y + bez[1].y),
  };
}

function chordParams(pts: Point2D[]): Float64Array {
  const u = new Float64Array(pts.length);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    u[i] = total;
  }
  if (total < 1e-6) return u;
  for (let i = 0; i < u.length; i++) u[i] /= total;
  u[u.length - 1] = 1;
  return u;
}

function tangentAt(pts: Point2D[], index: number, towardStart: boolean): Point2D {
  const dir = towardStart ? -1 : 1;
  let vx = 0;
  let vy = 0;
  let acc = 0;
  let k = index;
  for (let step = 0; step < 4; step++) {
    const n = k + dir;
    if (n < 0 || n >= pts.length) break;
    const dx = pts[n].x - pts[k].x;
    const dy = pts[n].y - pts[k].y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      vx += dx / len;
      vy += dy / len;
      acc += len;
    }
    k = n;
    if (acc > 4) break;
  }
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return { x: dir, y: 0 };
  return { x: vx / mag, y: vy / mag };
}

function maxChordDeviation(pts: Point2D[]): number {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    max = Math.max(max, Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len);
  }
  return max;
}

function tryCircularArc(pts: Point2D[], radialTol: number): string[] | null {
  const n = pts.length;
  if (n < 8) return null;
  const p0 = pts[0];
  const pEnd = pts[n - 1];
  const chord = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);
  if (chord < 3) return null;
  const mid = pts[Math.floor(n / 2)];
  const mx = (p0.x + pEnd.x) * 0.5;
  const my = (p0.y + pEnd.y) * 0.5;
  const nx = -(pEnd.y - p0.y) / chord;
  const ny = (pEnd.x - p0.x) / chord;
  const sagitta = (mid.x - mx) * nx + (mid.y - my) * ny;
  if (Math.abs(sagitta) < 0.6) return null;
  const half = chord * 0.5;
  const absS = Math.abs(sagitta);
  const radius = absS * 0.5 + (half * half) / (2 * absS);
  if (radius < 1.5 || radius > 4000) return null;
  const centerOffset = sagitta > 0 ? sagitta - radius : sagitta + radius;
  const cx = mx + nx * centerOffset;
  const cy = my + ny * centerOffset;
  for (let i = 1; i < n - 1; i += Math.max(1, Math.floor(n / 24))) {
    if (Math.abs(Math.hypot(pts[i].x - cx, pts[i].y - cy) - radius) > radialTol) return null;
  }
  const ang0 = Math.atan2(p0.y - cy, p0.x - cx);
  const angMid = Math.atan2(mid.y - cy, mid.x - cx);
  const angEnd = Math.atan2(pEnd.y - cy, pEnd.x - cx);
  const norm = (a: number) => {
    let d = a;
    while (d <= -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    return d;
  };
  const dMid = norm(angMid - ang0);
  if (Math.abs(dMid) < 0.08) return null;
  const sign = dMid > 0 ? 1 : -1;
  let sweep = angEnd - ang0;
  if (sign > 0) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  const absSweep = Math.abs(sweep);
  if (absSweep < (18 * Math.PI) / 180 || absSweep > (330 * Math.PI) / 180) return null;
  const segments = Math.max(1, Math.ceil(absSweep / (Math.PI / 2)));
  const step = sweep / segments;
  const cmds: string[] = [];
  let a0 = ang0;
  for (let s = 0; s < segments; s++) {
    const a1 = a0 + step;
    const alpha = (4 / 3) * Math.tan(step / 4);
    const p1x = cx + radius * Math.cos(a0);
    const p1y = cy + radius * Math.sin(a0);
    const p2x = cx + radius * Math.cos(a1);
    const p2y = cy + radius * Math.sin(a1);
    cmds.push(
      `C ${trimNum(p1x - alpha * radius * Math.sin(a0), 3)} ${trimNum(p1y + alpha * radius * Math.cos(a0), 3)} ${trimNum(p2x + alpha * radius * Math.sin(a1), 3)} ${trimNum(p2y - alpha * radius * Math.cos(a1), 3)} ${trimNum(p2x, 3)} ${trimNum(p2y, 3)}`
    );
    a0 = a1;
  }
  return cmds;
}

function dropRepeatedClose(points: Point2D[]): Point2D[] {
  if (
    points.length > 2 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
  ) {
    return points.slice(0, -1);
  }
  return points;
}

function pointsToLines(pts: Point2D[], isClosed: boolean): string {
  const cmds = [`M ${trimNum(pts[0].x, 3)} ${trimNum(pts[0].y, 3)}`];
  for (let i = 1; i < pts.length; i++) cmds.push(`L ${trimNum(pts[i].x, 3)} ${trimNum(pts[i].y, 3)}`);
  if (isClosed) cmds.push('Z');
  return cmds.join(' ');
}

function trimNum(v: number, precision: number): string {
  const p = 10 ** precision;
  const rounded = Math.round(v * p) / p;
  return String(rounded);
}
