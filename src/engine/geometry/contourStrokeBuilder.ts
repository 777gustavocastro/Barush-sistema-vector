import { computeExactEuclideanDistanceTransform } from '../stage2/stage2Diagnostics';
import { fitSchneiderOpenCurve } from './schneiderCurveFitter';
import {
  fitAdaptiveBezierChain,
  serializeChainsLoopToPathD,
  type Point2D,
} from './adaptiveBezierFitter';

export interface UniformContourStroke {
  d: string;
  strokeWidth: number;
  linecap: 'round' | 'butt' | 'square';
  linejoin: 'round' | 'miter' | 'bevel';
  miterlimit: number;
}

/**
 * Reconstrói uma faixa de espessura estável como um único traço contínuo.
 * A fronteira não vira vértice: a linha de centro sai do esqueleto topológico
 * (afinamento Zhang-Suen sobre a distância euclidiana) e cada ramo real
 * entra no mesmo caminho, com a mesma espessura.
 * Forma cheia, caligrafia de largura variável e esqueleto fragmentado
 * permanecem preenchimento.
 */
export function buildUniformContourStroke(
  labelMap: Int32Array,
  regionId: number,
  width: number,
  height: number
): UniformContourStroke | null {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (labelMap[row + x] !== regionId) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count < 12 || count > 14000) return null;

  const pad = 2;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  const lw = x1 - x0 + 1;
  const lh = y1 - y0 + 1;
  if (lw < 3 || lh < 3 || lw * lh > 160_000) return null;

  const outside = new Uint8Array(lw * lh);
  const ink = new Uint8Array(lw * lh);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const inside = labelMap[(y0 + y) * width + (x0 + x)] === regionId;
      if (inside) ink[y * lw + x] = 1;
      else outside[y * lw + x] = 1;
    }
  }
  const region = ink.slice();
  const dist = computeExactEuclideanDistanceTransform(outside, lw, lh);

  thinZhangSuen(ink, lw, lh);
  pruneSkeletonSpurs(ink, lw, lh);

  const medial: Point2D[] = [];
  const radii: number[] = [];
  const indexAt = new Int32Array(lw * lh);
  indexAt.fill(-1);
  for (let y = 1; y < lh - 1; y++) {
    for (let x = 1; x < lw - 1; x++) {
      const p = y * lw + x;
      if (!ink[p]) continue;
      const r = dist[p];
      if (r < 0.65 || r > 8.5) continue;
      indexAt[p] = medial.length;
      medial.push({ x: x0 + x + 0.5, y: y0 + y + 0.5 });
      radii.push(r);
    }
  }
  if (medial.length < 6 || medial.length > 1800) return null;

  radii.sort((a, b) => a - b);
  const mid = radii[Math.floor(radii.length / 2)];
  const p10 = radii[Math.floor(radii.length * 0.1)];
  const p90 = radii[Math.floor(radii.length * 0.9)];
  if (mid < 0.7 || mid > 7.5 || p90 > p10 * 1.9) return null;

  const neighbors = medial.map(() => [] as number[]);
  for (let y = 1; y < lh - 1; y++) {
    for (let x = 1; x < lw - 1; x++) {
      const i = indexAt[y * lw + x];
      if (i < 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = indexAt[(y + dy) * lw + (x + dx)];
          if (j > i) {
            neighbors[i].push(j);
            neighbors[j].push(i);
          }
        }
      }
    }
  }

  removeDiagonalChords(neighbors, medial);
  const chains = mergeOpenChains(traceSkeleton(medial, neighbors), 2.05);
  if (chains.length === 0 || chains.length > 6) return null;

  const inRegion = (pt: Point2D) => {
    const x = Math.round(pt.x - x0 - 0.5);
    const y = Math.round(pt.y - y0 - 0.5);
    return x >= 0 && y >= 0 && x < lw && y < lh && region[y * lw + x] === 1;
  };
  let roundEnds = 0;
  for (const chain of chains) {
    if (chain.closed) continue;
    roundEnds += extendFlatEnds(chain.points, inRegion, mid).round;
  }

  const parts: string[] = [];
  let sharpCorner = false;
  let minInterior = 180;
  for (const chain of chains) {
    if (chain.closed) {
      const circle = analyticCirclePath(chain.points);
      if (circle) {
        parts.push(circle);
        continue;
      }
    }
    const turn = sharpestInteriorAngle(chain.points, chain.closed);
    if (turn < minInterior) minInterior = turn;
    if (turn < 112) sharpCorner = true;
    const resampled = resampleChain(chain.points, chain.closed);
    const text = chainToPath(resampled, chain.closed);
    if (!text) continue;
    parts.push(text);
  }
  const d = parts.filter(Boolean).join(' ');
  if (!d || (d.match(/M /g) ?? []).length > 6) return null;

  const widthPx = Math.max(0.8, Math.round(mid * 2 * 100) / 100);
  const linejoin = sharpCorner ? 'miter' : 'round';
  const halfRad = ((Math.max(28, minInterior) * Math.PI) / 180) * 0.5;
  const miterlimit =
    linejoin === 'miter'
      ? Math.min(3.2, Math.max(1.8, Math.round((1 / Math.max(0.28, Math.sin(halfRad)) + 0.1) * 100) / 100))
      : 4;
  return {
    d,
    strokeWidth: widthPx,
    linecap: roundEnds > 0 ? 'round' : 'butt',
    linejoin,
    miterlimit,
  };
}

function thinZhangSuen(bin: Uint8Array, w: number, h: number): void {
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : bin[y * w + x];
  let changed = true;
  for (let guard = 0; guard < 40 && changed; guard++) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const kill: number[] = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!bin[i]) continue;
          const n = [
            at(x, y - 1),
            at(x + 1, y - 1),
            at(x + 1, y),
            at(x + 1, y + 1),
            at(x, y + 1),
            at(x - 1, y + 1),
            at(x - 1, y),
            at(x - 1, y - 1),
          ];
          let b = 0;
          let a = 0;
          for (let k = 0; k < 8; k++) {
            b += n[k];
            if (n[k] === 0 && n[(k + 1) % 8] === 1) a++;
          }
          if (b < 2 || b > 6 || a !== 1) continue;
          if (pass === 0) {
            if (n[0] * n[2] * n[4] !== 0) continue;
            if (n[2] * n[4] * n[6] !== 0) continue;
          } else if (n[0] * n[2] * n[6] !== 0 || n[0] * n[4] * n[6] !== 0) {
            continue;
          }
          kill.push(i);
        }
      }
      if (kill.length > 0) changed = true;
      for (const i of kill) bin[i] = 0;
    }
  }
}

function pruneSkeletonSpurs(bin: Uint8Array, w: number, h: number): void {
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : bin[y * w + x];
  const degree = (x: number, y: number) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        n += at(x + dx, y + dy);
      }
    }
    return n;
  };
  for (let pass = 0; pass < 3; pass++) {
    const kill: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!bin[y * w + x] || degree(x, y) !== 1) continue;
        let cx = x;
        let cy = y;
        const trail = [cy * w + cx];
        let hitJunction = false;
        for (let step = 0; step < 3; step++) {
          let nx = -1;
          let ny = -1;
          for (let dy = -1; dy <= 1 && nx < 0; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const qx = cx + dx;
              const qy = cy + dy;
              if (!at(qx, qy) || trail.includes(qy * w + qx)) continue;
              nx = qx;
              ny = qy;
              break;
            }
          }
          if (nx < 0) break;
          const deg = degree(nx, ny);
          if (deg >= 3) {
            hitJunction = true;
            break;
          }
          cx = nx;
          cy = ny;
          trail.push(cy * w + cx);
          if (deg === 1) break;
        }
        if (hitJunction) kill.push(...trail);
      }
    }
    if (kill.length === 0) break;
    for (const i of kill) bin[i] = 0;
  }
}

function traceSkeleton(
  points: Point2D[],
  neighbors: number[][]
): Array<{ points: Point2D[]; closed: boolean }> {
  const used = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const degree = neighbors.map((n) => n.length);
  const chains: Array<{ points: Point2D[]; closed: boolean }> = [];

  const walk = (start: number, next: number) => {
    const seq = [start];
    let prev = start;
    let cur = next;
    used.add(edgeKey(prev, cur));
    for (let guard = 0; guard < points.length + 2; guard++) {
      seq.push(cur);
      if (cur === start) break;
      if (degree[cur] !== 2 && seq.length > 2) break;
      let best = -1;
      let bestAlign = -Infinity;
      const ix = points[cur].x - points[prev].x;
      const iy = points[cur].y - points[prev].y;
      for (const n of neighbors[cur]) {
        if (n === prev || used.has(edgeKey(cur, n))) continue;
        const align =
          (points[n].x - points[cur].x) * ix + (points[n].y - points[cur].y) * iy;
        if (align > bestAlign) {
          bestAlign = align;
          best = n;
        }
      }
      if (best < 0) break;
      prev = cur;
      cur = best;
      used.add(edgeKey(prev, cur));
    }
    return seq;
  };

  const pushSeq = (seq: number[]) => {
    if (seq.length < 4) return;
    const closed = seq[0] === seq[seq.length - 1];
    chains.push({
      closed,
      points: seq.map((id) => ({ ...points[id] })),
    });
  };

  for (let i = 0; i < points.length; i++) {
    if (degree[i] !== 1) continue;
    for (const n of neighbors[i]) {
      if (used.has(edgeKey(i, n))) continue;
      pushSeq(walk(i, n));
    }
  }
  for (let i = 0; i < points.length; i++) {
    for (const n of neighbors[i]) {
      if (used.has(edgeKey(i, n))) continue;
      pushSeq(walk(i, n));
    }
  }
  return chains;
}

function removeDiagonalChords(neighbors: number[][], points: Point2D[]): void {
  const drop = (a: number, b: number) => {
    neighbors[a] = neighbors[a].filter((n) => n !== b);
    neighbors[b] = neighbors[b].filter((n) => n !== a);
  };
  for (let i = 0; i < points.length; i++) {
    const linked = [...neighbors[i]];
    for (const j of linked) {
      if (j < i || !neighbors[i].includes(j)) continue;
      const dx = Math.abs(points[i].x - points[j].x);
      const dy = Math.abs(points[i].y - points[j].y);
      if (dx < 0.6 || dy < 0.6) continue;
      const bridged = neighbors[i].some((k) => {
        if (k === j) return false;
        const ox = Math.abs(points[i].x - points[k].x);
        const oy = Math.abs(points[i].y - points[k].y);
        if (ox > 0.6 && oy > 0.6) return false;
        return neighbors[k].includes(j);
      });
      if (bridged) drop(i, j);
    }
  }
}

function mergeOpenChains(
  chains: Array<{ points: Point2D[]; closed: boolean }>,
  gap: number
): Array<{ points: Point2D[]; closed: boolean }> {
  const open = chains.filter((c) => !c.closed).map((c) => ({ points: c.points.map((p) => ({ ...p })) }));
  const closed = chains.filter((c) => c.closed);
  let guard = 0;
  while (open.length > 1 && guard++ < 12) {
    let bestI = -1;
    let bestJ = -1;
    let bestD = gap;
    let flipI = false;
    let flipJ = false;
    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const a = open[i].points;
        const b = open[j].points;
        const pairs: Array<[Point2D, Point2D, boolean, boolean]> = [
          [a[a.length - 1], b[0], false, false],
          [a[a.length - 1], b[b.length - 1], false, true],
          [a[0], b[0], true, false],
          [a[0], b[b.length - 1], true, true],
        ];
        for (const [p, q, fi, fj] of pairs) {
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < bestD) {
            bestD = d;
            bestI = i;
            bestJ = j;
            flipI = fi;
            flipJ = fj;
          }
        }
      }
    }
    if (bestI < 0) break;
    const a = open[bestI].points;
    const b = open[bestJ].points;
    if (flipI) a.reverse();
    if (flipJ) b.reverse();
    const joined = a.concat(b);
    const closes =
      Math.hypot(joined[0].x - joined[joined.length - 1].x, joined[0].y - joined[joined.length - 1].y) <= gap;
    open.splice(bestJ, 1);
    open.splice(bestI, 1);
    if (closes) {
      joined.push({ ...joined[0] });
      closed.push({ points: joined, closed: true });
    } else {
      open.push({ points: joined });
    }
  }
  return [...closed, ...open.map((c) => ({ points: c.points, closed: false }))];
}

function extendFlatEnds(
  points: Point2D[],
  inRegion: (pt: Point2D) => boolean,
  radius: number
): { flat: number; round: number } {
  const ends = [true, false];
  let flat = 0;
  let round = 0;
  for (const atStart of ends) {
    const tip = atStart ? 0 : points.length - 1;
    const prev = atStart ? Math.min(4, points.length - 1) : Math.max(0, points.length - 1 - 4);
    const dx = points[tip].x - points[prev].x;
    const dy = points[tip].y - points[prev].y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    let cur = points[tip];
    for (let step = 0; step < 6; step++) {
      const nxt = { x: cur.x + tx, y: cur.y + ty };
      if (!inRegion(nxt)) break;
      cur = nxt;
    }
    points[tip] = cur;
    const aheadCorner = (sign: number) => ({
      x: cur.x + tx * (radius * 0.2) - ty * sign * (radius * 0.95),
      y: cur.y + ty * (radius * 0.2) + tx * sign * (radius * 0.95),
    });
    const squareCorner = inRegion(aheadCorner(1)) || inRegion(aheadCorner(-1));
    if (squareCorner) flat++;
    else round++;
  }
  return { flat, round };
}

function resampleChain(points: Point2D[], closed: boolean): Point2D[] {
  const src = closed && points.length > 2 ? points.slice(0, -1) : points;
  if (src.length <= 280) {
    return closed ? [...src, { ...src[0] }] : src.map((p) => ({ ...p }));
  }
  const step = Math.ceil(src.length / 260);
  const out: Point2D[] = [];
  for (let i = 0; i < src.length; i += step) out.push({ ...src[i] });
  if (!closed) {
    const last = src[src.length - 1];
    if (out[out.length - 1].x !== last.x || out[out.length - 1].y !== last.y) out.push({ ...last });
  }
  return closed ? [...out, { ...out[0] }] : out;
}

function chainToPath(points: Point2D[], closed: boolean): string {
  if (closed) {
    const circle = analyticCirclePath(points);
    if (circle) return circle;
  }
  const repeated =
    points.length > 2 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y;
  const seq = repeated ? points.slice(0, -1) : points;
  if (seq.length < 2) return '';

  const corners: number[] = [];
  if (!closed) corners.push(0);
  for (let i = 0; i < seq.length; i++) {
    if (!closed && (i === 0 || i === seq.length - 1)) continue;
    const prev = pointAlong(seq, i, -1, 3.2, closed);
    const next = pointAlong(seq, i, 1, 3.2, closed);
    if (!prev || !next) continue;
    const curr = seq[i];
    const u1x = prev.x - curr.x;
    const u1y = prev.y - curr.y;
    const u2x = next.x - curr.x;
    const u2y = next.y - curr.y;
    const l1 = Math.hypot(u1x, u1y);
    const l2 = Math.hypot(u2x, u2y);
    if (l1 < 2 || l2 < 2) continue;
    const cos = Math.max(-1, Math.min(1, (u1x * u2x + u1y * u2y) / (l1 * l2)));
    const interior = (Math.acos(cos) * 180) / Math.PI;
    if (interior < 118) {
      const last = corners[corners.length - 1];
      if (last === undefined || Math.hypot(seq[last].x - curr.x, seq[last].y - curr.y) > 2.4) {
        corners.push(i);
      }
    }
  }
  if (!closed) corners.push(seq.length - 1);
  if (closed && corners.length === 0) corners.push(0);
  if (corners.length > 16) return '';

  const fmt = (p: Point2D) => `${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`;
  const sliceSpan = (i0: number, i1: number): Point2D[] => {
    const span: Point2D[] = [];
    if (!closed) {
      for (let k = i0; k <= i1 && k < seq.length; k++) span.push(seq[k]);
      return span;
    }
    let k = i0;
    span.push(seq[k]);
    for (let g = 0; g < seq.length + 2; g++) {
      if (k === i1) break;
      k = (k + 1) % seq.length;
      span.push(seq[k]);
    }
    return span;
  };
  const straightEnough = (span: Point2D[]) => {
    const a = span[0];
    const b = span[span.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let max = 0;
    const crosses: number[] = [];
    const from = span.length > 8 ? 2 : 1;
    const to = span.length > 8 ? span.length - 2 : span.length - 1;
    for (let i = from; i < to; i++) {
      const cross = Math.abs((span[i].x - a.x) * dy - (span[i].y - a.y) * dx) / len;
      crosses.push(cross);
      if (cross > max) max = cross;
    }
    crosses.sort((p, q) => p - q);
    const median = crosses.length ? crosses[Math.floor(crosses.length / 2)] : 0;
    return max <= 0.55 || (max <= 1.35 && median <= 0.7);
  };

  const commands: string[] = [];
  const spanCount = closed ? corners.length : Math.max(0, corners.length - 1);
  for (let s = 0; s < spanCount; s++) {
    const i0 = corners[s];
    const i1 = closed ? corners[(s + 1) % corners.length] : corners[s + 1];
    const span = sliceSpan(i0, i1);
    if (span.length < 2) continue;
    if (straightEnough(span)) {
      if (commands.length === 0) commands.push(`M ${fmt(span[0])}`);
      commands.push(`L ${fmt(span[span.length - 1])}`);
      continue;
    }
    const a = span[0];
    const b = span[span.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let sagitta = 0;
    for (let i = 1; i < span.length - 1; i++) {
      sagitta = Math.max(sagitta, Math.abs((span[i].x - a.x) * dy - (span[i].y - a.y) * dx) / len);
    }
    const text =
      sagitta >= 1.2
        ? fitSchneiderOpenCurve(span, { maxErrorPx: 0.4, precision: 3 })
        : serializeChainsLoopToPathD(
            [
              fitAdaptiveBezierChain(span, span, false, {
                maxCurveErrorPx: 0.42,
                straightLineTolPx: 0.55,
                cornerAngleThresholdDeg: 68,
                subpixelTubeRadiusPx: 0.16,
                precision: 2,
              }),
            ],
            2
          ).replace(/ Z$/, '');
    if (!text) continue;
    if (commands.length === 0) commands.push(text);
    else commands.push(text.replace(/^M\s+[-\d.]+\s+[-\d.]+\s*/, ''));
  }
  if (commands.length === 0) return '';
  if (closed) commands.push('Z');
  return commands.join(' ');
}

function pointAlong(seq: Point2D[], index: number, dir: 1 | -1, minDist: number, closed: boolean): Point2D | null {
  const n = seq.length;
  let acc = 0;
  let k = index;
  for (let step = 0; step < n; step++) {
    const nxt = k + dir;
    if (!closed && (nxt < 0 || nxt >= n)) return null;
    const j = closed ? (nxt + n) % n : nxt;
    acc += Math.hypot(seq[j].x - seq[k].x, seq[j].y - seq[k].y);
    k = j;
    if (acc >= minDist) return seq[k];
  }
  return null;
}

function sharpestInteriorAngle(points: Point2D[], closed: boolean): number {
  let minDeg = 180;
  const repeated =
    points.length > 2 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y;
  const seq = repeated ? points.slice(0, -1) : points;
  const limit = seq.length;
  if (limit < 3) return 180;
  for (let i = 0; i < limit; i++) {
    if (!closed && (i === 0 || i === limit - 1)) continue;
    const prev = pointAlong(seq, i, -1, 3, closed);
    const next = pointAlong(seq, i, 1, 3, closed);
    if (!prev || !next) continue;
    const curr = seq[i];
    const u1x = prev.x - curr.x;
    const u1y = prev.y - curr.y;
    const u2x = next.x - curr.x;
    const u2y = next.y - curr.y;
    const l1 = Math.hypot(u1x, u1y);
    const l2 = Math.hypot(u2x, u2y);
    if (l1 < 2 || l2 < 2) continue;
    const cos = Math.max(-1, Math.min(1, (u1x * u2x + u1y * u2y) / (l1 * l2)));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    if (deg < minDeg) minDeg = deg;
  }
  return minDeg;
}

function analyticCirclePath(points: Point2D[]): string | null {
  const seq =
    points.length > 3 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
      ? points.slice(0, -1)
      : points;
  if (seq.length < 8) return null;
  let cx = 0;
  let cy = 0;
  for (const p of seq) {
    cx += p.x;
    cy += p.y;
  }
  cx /= seq.length;
  cy /= seq.length;
  let radius = 0;
  for (const p of seq) radius += Math.hypot(p.x - cx, p.y - cy);
  radius /= seq.length;
  if (radius < 1.6) return null;
  let maxDev = 0;
  for (const p of seq) {
    const dev = Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius);
    if (dev > maxDev) maxDev = dev;
  }
  if (maxDev > 1.05) return null;
  const k = 0.5522847498 * radius;
  const n = (v: number) => (Math.round(v * 100) / 100).toString();
  const x = cx;
  const y = cy;
  const r = radius;
  return [
    `M ${n(x + r)} ${n(y)}`,
    `C ${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)}`,
    `C ${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)}`,
    `C ${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)}`,
    `C ${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)}`,
    'Z',
  ].join(' ');
}
