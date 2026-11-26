/**
 * Contrato do Geometric Reconstruction Engine.
 * Só mede. Não altera segmentação, curva, seleção nem tipografia.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface ErrorStats {
  maxPx: number;
  meanPx: number;
  hausdorffPx: number;
  samples: number;
}

export interface ContinuityStats {
  g0GapPx: number;
  unintendedG1Breaks: number;
  corners: number;
  maxSmoothTurnDeg: number;
}

export interface PathCensus {
  pathCount: number;
  commandCount: number;
  closedLoops: number;
  openSubpaths: number;
}

export const geometricAcceptance = {
  line: { maxPx: 0.35, meanPx: 0.12, hausdorffPx: 0.4 },
  circle: { maxRadiusPx: 0.45, hausdorffPx: 0.5 },
  ellipse: { maxRadialPx: 0.55, hausdorffPx: 0.6 },
  arc: { maxPx: 0.5, endpointPx: 0.4 },
  organic: { maxPx: 0.75, meanPx: 0.25, hausdorffPx: 0.9 },
  corner: { positionPx: 0.4, angleDeg: 12 },
  continuity: { g0Px: 0.08, unintendedG1Deg: 8 },
  stroke: { thicknessStdRatio: 0.15, thicknessBiasPx: 0.6 },
  hole: { countMustMatch: true },
  coverage: { iouSolid: 0.96, recallDetail: 0.85, hausdorffDetailPx: 1.25 },
  zoom: { rasterEdgePxFrom400: 0.35 },
} as const;

export function flattenPath(d: string, flatness = 0.2): Point2D[][] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const chains: Point2D[][] = [];
  let chain: Point2D[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const push = (x: number, y: number) => {
    chain.push({ x, y });
    cx = x;
    cy = y;
  };
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M' || op === 'm') {
      if (chain.length > 1) chains.push(chain);
      const rel = op === 'm';
      const x = (rel ? cx : 0) + num();
      const y = (rel ? cy : 0) + num();
      chain = [];
      push(x, y);
      sx = x;
      sy = y;
      continue;
    }
    if (op === 'L' || op === 'l') {
      push((op === 'l' ? cx : 0) + num(), (op === 'l' ? cy : 0) + num());
      continue;
    }
    if (op === 'H' || op === 'h') {
      push((op === 'h' ? cx : 0) + num(), cy);
      continue;
    }
    if (op === 'V' || op === 'v') {
      push(cx, (op === 'v' ? cy : 0) + num());
      continue;
    }
    if (op === 'C' || op === 'c') {
      const rel = op === 'c';
      const p0 = { x: cx, y: cy };
      const p1 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      const p2 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      const p3 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      flattenCubic(p0, p1, p2, p3, chain, flatness);
      cx = p3.x;
      cy = p3.y;
      continue;
    }
    if (op === 'Q' || op === 'q') {
      const rel = op === 'q';
      const p0 = { x: cx, y: cy };
      const p1 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      const p2 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      flattenCubic(p0, mid(p0, p1), mid(p1, p2), p2, chain, flatness);
      cx = p2.x;
      cy = p2.y;
      continue;
    }
    if (op === 'Z' || op === 'z') {
      if (chain.length > 0 && (cx !== sx || cy !== sy)) chain.push({ x: sx, y: sy });
      cx = sx;
      cy = sy;
    }
  }
  if (chain.length > 1) chains.push(chain);
  return chains;
}

export function pathCensus(svgOrD: string): PathCensus {
  const paths = svgOrD.includes('<path')
    ? [...svgOrD.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1])
    : [svgOrD];
  let commandCount = 0;
  let closedLoops = 0;
  let openSubpaths = 0;
  for (const d of paths) {
    const commands = d.match(/[MLCQZHV]/gi) ?? [];
    commandCount += commands.length;
    const moves = d.match(/M/gi)?.length ?? 0;
    const closes = d.match(/Z/gi)?.length ?? 0;
    closedLoops += closes;
    openSubpaths += Math.max(0, moves - closes);
  }
  return { pathCount: paths.length, commandCount, closedLoops, openSubpaths };
}

export function continuityOfPath(d: string): ContinuityStats {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let g0GapPx = 0;
  let unintendedG1Breaks = 0;
  let corners = 0;
  let maxSmoothTurnDeg = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  let hasPrev = false;
  let prevIn = { x: 1, y: 0 };
  const num = () => Number(tokens[i++]);
  const turn = (incoming: Point2D, outgoing: Point2D) => {
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    const deg = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
    if (deg >= 50) corners++;
    else if (deg > geometricAcceptance.continuity.unintendedG1Deg) {
      unintendedG1Breaks++;
      if (deg > maxSmoothTurnDeg) maxSmoothTurnDeg = deg;
    }
  };
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M' || op === 'm') {
      hasPrev = false;
      cx = (op === 'm' ? cx : 0) + num();
      cy = (op === 'm' ? cy : 0) + num();
      sx = cx;
      sy = cy;
      continue;
    }
    const start = { x: cx, y: cy };
    let end = start;
    let tanIn = { x: 1, y: 0 };
    let tanOut = { x: 1, y: 0 };
    if (op === 'L' || op === 'l') {
      end = { x: (op === 'l' ? cx : 0) + num(), y: (op === 'l' ? cy : 0) + num() };
      tanIn = unit(end.x - start.x, end.y - start.y);
      tanOut = tanIn;
    } else if (op === 'H' || op === 'h') {
      end = { x: (op === 'h' ? cx : 0) + num(), y: cy };
      tanIn = unit(end.x - start.x, 0);
      tanOut = tanIn;
    } else if (op === 'V' || op === 'v') {
      end = { x: cx, y: (op === 'v' ? cy : 0) + num() };
      tanIn = unit(0, end.y - start.y);
      tanOut = tanIn;
    } else if (op === 'C' || op === 'c') {
      const rel = op === 'c';
      const p1 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      const p2 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      end = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      tanOut = unit(p1.x - start.x, p1.y - start.y);
      tanIn = unit(end.x - p2.x, end.y - p2.y);
    } else if (op === 'Q' || op === 'q') {
      const rel = op === 'q';
      const p1 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      end = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      tanOut = unit(p1.x - start.x, p1.y - start.y);
      tanIn = unit(end.x - p1.x, end.y - p1.y);
    } else if (op === 'Z' || op === 'z') {
      end = { x: sx, y: sy };
      tanIn = unit(end.x - start.x, end.y - start.y);
      tanOut = tanIn;
      g0GapPx = Math.max(g0GapPx, Math.hypot(end.x - start.x, end.y - start.y) > 0 ? 0 : 0);
    } else {
      continue;
    }
    if (hasPrev) turn(prevIn, tanOut);
    prevIn = tanIn;
    hasPrev = true;
    cx = end.x;
    cy = end.y;
  }
  return { g0GapPx, unintendedG1Breaks, corners, maxSmoothTurnDeg: Number(maxSmoothTurnDeg.toFixed(2)) };
}

export function referenceError(reference: Point2D[], reconstructed: Point2D[][]): ErrorStats {
  const forward = directedDistances(reference, reconstructed);
  const maxPx = forward.reduce((acc, value) => Math.max(acc, value), 0);
  const meanPx = forward.length ? forward.reduce((acc, value) => acc + value, 0) / forward.length : 0;
  return { maxPx: round3(maxPx), meanPx: round3(meanPx), hausdorffPx: round3(maxPx), samples: forward.length };
}

export function boundaryError(reference: Point2D[], reconstructed: Point2D[][]): ErrorStats {
  const forward = directedDistances(reference, reconstructed);
  const back = directedDistances(reconstructed.flat(), [reference]);
  const all = forward.concat(back);
  const maxPx = all.reduce((acc, value) => Math.max(acc, value), 0);
  const meanPx = all.length ? all.reduce((acc, value) => acc + value, 0) / all.length : 0;
  const hausdorffPx = Math.max(
    forward.reduce((acc, value) => Math.max(acc, value), 0),
    back.reduce((acc, value) => Math.max(acc, value), 0)
  );
  return {
    maxPx: round3(maxPx),
    meanPx: round3(meanPx),
    hausdorffPx: round3(hausdorffPx),
    samples: all.length,
  };
}

export function sampleLine(x0: number, y0: number, x1: number, y1: number, step = 1): Point2D[] {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const count = Math.max(2, Math.ceil(length / step));
  const points: Point2D[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
  }
  return points;
}

export function sampleCircle(cx: number, cy: number, radius: number, stepDeg = 5): Point2D[] {
  const points: Point2D[] = [];
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const a = (deg * Math.PI) / 180;
    points.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return points;
}

export function sampleEllipse(cx: number, cy: number, rx: number, ry: number, stepDeg = 5): Point2D[] {
  const points: Point2D[] = [];
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const a = (deg * Math.PI) / 180;
    points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return points;
}

export function sampleArc(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
  stepDeg = 4
): Point2D[] {
  const points: Point2D[] = [];
  const span = endDeg - startDeg;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / stepDeg));
  for (let i = 0; i <= steps; i++) {
    const a = ((startDeg + (span * i) / steps) * Math.PI) / 180;
    points.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return points;
}

export function maskIoU(
  width: number,
  height: number,
  reference: (x: number, y: number) => boolean,
  candidate: (x: number, y: number) => boolean
): { iou: number; recall: number; precision: number } {
  let inter = 0;
  let union = 0;
  let ref = 0;
  let cand = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = reference(x, y);
      const b = candidate(x, y);
      if (a) ref++;
      if (b) cand++;
      if (a || b) union++;
      if (a && b) inter++;
    }
  }
  return {
    iou: union ? round3(inter / union) : 1,
    recall: ref ? round3(inter / ref) : 1,
    precision: cand ? round3(inter / cand) : 1,
  };
}

export function meetsLine(stats: ErrorStats): boolean {
  return (
    stats.maxPx <= geometricAcceptance.line.maxPx &&
    stats.meanPx <= geometricAcceptance.line.meanPx &&
    stats.hausdorffPx <= geometricAcceptance.line.hausdorffPx
  );
}

export function meetsCircle(maxRadiusError: number, hausdorffPx: number): boolean {
  return maxRadiusError <= geometricAcceptance.circle.maxRadiusPx && hausdorffPx <= geometricAcceptance.circle.hausdorffPx;
}

function directedDistances(points: Point2D[], chains: Point2D[][]): number[] {
  return points.map((point) => distanceToChains(point, chains));
}

function distanceToChains(point: Point2D, chains: Point2D[][]): number {
  let best = Infinity;
  for (const chain of chains) {
    for (let i = 1; i < chain.length; i++) {
      best = Math.min(best, distanceToSegment(point, chain[i - 1], chain[i]));
    }
  }
  return best;
}

function distanceToSegment(point: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y);
}

function flattenCubic(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  out: Point2D[],
  tol: number,
  depth = 0
): void {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const d1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / len;
  const d2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx) / len;
  if (depth >= 8 || (d1 <= tol && d2 <= tol)) {
    out.push(p3);
    return;
  }
  const ab = mid(p0, p1);
  const bc = mid(p1, p2);
  const cd = mid(p2, p3);
  const abbc = mid(ab, bc);
  const bccd = mid(bc, cd);
  const midPt = mid(abbc, bccd);
  flattenCubic(p0, ab, abbc, midPt, out, tol, depth + 1);
  flattenCubic(midPt, bccd, cd, p3, out, tol, depth + 1);
}

function mid(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function unit(x: number, y: number): Point2D {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
