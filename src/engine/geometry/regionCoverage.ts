import { noteRegionCoverage } from '../audit/pipelineAudit';
import {
  fitAdaptiveBezierChain,
  serializeChainsLoopToPathD,
  type AdaptiveCurveFitOptions,
  type Point2D,
} from './adaptiveBezierFitter';
import type { UniformContourStroke } from './contourStrokeBuilder';

export interface MaskCoverage {
  maskPixels: number;
  coveredPixels: number;
  excessPixels: number;
  recall: number;
  precision: number;
  iou: number;
  missingComponents: number;
}

const RECALL_MIN = 0.96;
const STROKE_RECALL_MIN = 0.87;
const STROKE_PRECISION_MIN = 0.9;
const MISSING_BLOB = 3;

/**
 * Um traço só substitui o preenchimento quando a faixa cobre a máscara
 * e não espalha tinta para fora dela. Caso contrário a região permanece preenchida.
 */
export function strokeCoversMask(coverage: MaskCoverage, strokeWidth: number): boolean {
  if (coverage.maskPixels === 0 || strokeWidth >= 8) return false;
  return coverage.recall >= STROKE_RECALL_MIN && coverage.precision >= STROKE_PRECISION_MIN;
}

export function measureStrokeCoverage(
  labelMap: Int32Array,
  regionId: number,
  width: number,
  height: number,
  stroke: UniformContourStroke
): MaskCoverage {
  const half = stroke.strokeWidth / 2;
  const chains = parsePathChains(stroke.d);
  const segments = chains.flatMap((chain) => segmentsOf(chain));
  return measureDistanceBand(labelMap, regionId, width, height, segments, half);
}

export function measureFillCoverage(
  labelMap: Int32Array,
  regionId: number,
  width: number,
  height: number,
  pathD: string,
  usesEvenOdd: boolean
): MaskCoverage {
  const loops = parsePathChains(pathD).map((chain) => closeLoop(chain));
  return measurePolygon(labelMap, regionId, width, height, loops, usesEvenOdd);
}

export function recoverRegionFillFromMask(input: {
  labelMap: Int32Array;
  regionId: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  curveOptions: AdaptiveCurveFitOptions;
}): { d: string; usesEvenOdd: boolean; holeCount: number; coverage: MaskCoverage } | null {
  const loops = traceMaskLoops(
    input.labelMap,
    input.regionId,
    input.width,
    input.height,
    input.minX,
    input.minY,
    input.maxX,
    input.maxY
  );
  if (loops.length === 0) return null;
  const usesEvenOdd = loops.length > 1;
  const precision = input.curveOptions.precision ?? 3;
  const fitted = loops
    .map((loop) => {
      const closed = loop[0].x === loop[loop.length - 1].x && loop[0].y === loop[loop.length - 1].y
        ? loop
        : [...loop, loop[0]];
      return fitAdaptiveBezierChain(closed, closed, true, input.curveOptions);
    })
    .map((chain) => serializeChainsLoopToPathD([chain], precision))
    .filter(Boolean)
    .join(' ');
  const raw = loops
    .map((loop) => {
      const body = [`M ${fmt(loop[0].x, precision)} ${fmt(loop[0].y, precision)}`];
      for (let i = 1; i < loop.length; i++) body.push(`L ${fmt(loop[i].x, precision)} ${fmt(loop[i].y, precision)}`);
      body.push('Z');
      return body.join(' ');
    })
    .join(' ');
  const fittedCoverage = fitted
    ? measureFillCoverage(input.labelMap, input.regionId, input.width, input.height, fitted, usesEvenOdd)
    : emptyCoverage();
  const rawCoverage = measureFillCoverage(
    input.labelMap,
    input.regionId,
    input.width,
    input.height,
    raw,
    usesEvenOdd
  );
  const fittedOk = fitted && fittedCoverage.recall >= RECALL_MIN && fittedCoverage.missingComponents === 0;
  if (fittedOk && fittedCoverage.excessPixels <= rawCoverage.excessPixels + 2) {
    return {
      d: fitted,
      usesEvenOdd,
      holeCount: Math.max(0, loops.length - 1),
      coverage: fittedCoverage,
    };
  }
  return {
    d: raw,
    usesEvenOdd,
    holeCount: Math.max(0, loops.length - 1),
    coverage: rawCoverage,
  };
}

export function recordCoverage(coverage: MaskCoverage, flags?: { strokeRejected?: boolean; fillRebuilt?: boolean }): void {
  noteRegionCoverage({
    recall: coverage.recall,
    missingComponents: coverage.missingComponents,
    strokeRejected: flags?.strokeRejected,
    fillRebuilt: flags?.fillRebuilt,
  });
}

function emptyCoverage(): MaskCoverage {
  return {
    maskPixels: 0,
    coveredPixels: 0,
    excessPixels: 0,
    recall: 0,
    precision: 1,
    iou: 0,
    missingComponents: 0,
  };
}

function finishCoverage(maskPixels: number, coveredPixels: number, excessPixels: number, missingComponents: number): MaskCoverage {
  const union = maskPixels + excessPixels;
  return {
    maskPixels,
    coveredPixels,
    excessPixels,
    recall: maskPixels > 0 ? coveredPixels / maskPixels : 1,
    precision: coveredPixels + excessPixels > 0 ? coveredPixels / (coveredPixels + excessPixels) : 1,
    iou: union > 0 ? coveredPixels / union : 1,
    missingComponents,
  };
}

function measureDistanceBand(
  labelMap: Int32Array,
  regionId: number,
  width: number,
  height: number,
  segments: Segment[],
  half: number
): MaskCoverage {
  if (segments.length === 0) return emptyCoverage();
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let maskPixels = 0;
  for (let i = 0; i < labelMap.length; i++) {
    if (labelMap[i] !== regionId) continue;
    maskPixels++;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maskPixels === 0) return emptyCoverage();
  const pad = Math.ceil(half) + 1;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  const covered = new Uint8Array(labelMap.length);
  let coveredPixels = 0;
  let excessPixels = 0;
  const limit = half;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = distanceToSegments(x + 0.5, y + 0.5, segments);
      if (dist > limit) continue;
      const idx = y * width + x;
      if (labelMap[idx] === regionId) {
        covered[idx] = 1;
        coveredPixels++;
      } else if (!touchesMask(labelMap, regionId, width, height, x, y)) {
        excessPixels++;
      }
    }
  }
  return finishCoverage(maskPixels, coveredPixels, excessPixels, countMissingBlobs(labelMap, covered, regionId, width, height));
}

function measurePolygon(
  labelMap: Int32Array,
  regionId: number,
  width: number,
  height: number,
  loops: Point2D[][],
  usesEvenOdd: boolean
): MaskCoverage {
  const usable = loops.filter((loop) => loop.length >= 3);
  if (usable.length === 0) return emptyCoverage();
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let maskPixels = 0;
  for (let i = 0; i < labelMap.length; i++) {
    if (labelMap[i] !== regionId) continue;
    maskPixels++;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  for (const loop of usable) {
    for (const p of loop) {
      minX = Math.min(minX, Math.floor(p.x));
      minY = Math.min(minY, Math.floor(p.y));
      maxX = Math.max(maxX, Math.ceil(p.x));
      maxY = Math.max(maxY, Math.ceil(p.y));
    }
  }
  if (maskPixels === 0) return emptyCoverage();
  const x0 = Math.max(0, minX - 2);
  const y0 = Math.max(0, minY - 2);
  const x1 = Math.min(width - 1, maxX + 2);
  const y1 = Math.min(height - 1, maxY + 2);
  const covered = new Uint8Array(labelMap.length);
  let coveredPixels = 0;
  let excessPixels = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!pointInLoops(x + 0.5, y + 0.5, usable, usesEvenOdd)) continue;
      const idx = y * width + x;
      if (labelMap[idx] === regionId) {
        covered[idx] = 1;
        coveredPixels++;
      } else {
        excessPixels++;
      }
    }
  }
  return finishCoverage(maskPixels, coveredPixels, excessPixels, countMissingBlobs(labelMap, covered, regionId, width, height));
}

function touchesMask(
  labelMap: Int32Array,
  regionId: number,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (labelMap[ny * width + nx] === regionId) return true;
    }
  }
  return false;
}

function countMissingBlobs(
  labelMap: Int32Array,
  covered: Uint8Array,
  regionId: number,
  width: number,
  height: number
): number {
  const seen = new Uint8Array(labelMap.length);
  let missing = 0;
  for (let start = 0; start < labelMap.length; start++) {
    if (labelMap[start] !== regionId || covered[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    while (stack.length > 0) {
      const px = stack.pop() as number;
      count++;
      const x = px % width;
      const y = (px - x) / width;
      const next = [
        x > 0 ? px - 1 : -1,
        x + 1 < width ? px + 1 : -1,
        y > 0 ? px - width : -1,
        y + 1 < height ? px + width : -1,
      ];
      for (const n of next) {
        if (n < 0 || seen[n] || covered[n] || labelMap[n] !== regionId) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (count >= MISSING_BLOB) missing++;
  }
  return missing;
}

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function segmentsOf(chain: Point2D[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    if (a.x === b.x && a.y === b.y) continue;
    out.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
  }
  return out;
}

function distanceToSegments(x: number, y: number, segments: Segment[]): number {
  let best = Infinity;
  for (const seg of segments) {
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - seg.x0) * dx + (y - seg.y0) * dy) / len2));
    const px = seg.x0 + dx * t - x;
    const py = seg.y0 + dy * t - y;
    const dist = Math.hypot(px, py);
    if (dist < best) best = dist;
  }
  return best;
}

function pointInLoops(x: number, y: number, loops: Point2D[][], usesEvenOdd: boolean): boolean {
  let wind = 0;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const yi = loop[i].y;
      const yj = loop[j].y;
      if (yi > y === yj > y) continue;
      const xInt = loop[i].x + ((y - yi) / (yj - yi)) * (loop[j].x - loop[i].x);
      if (x < xInt) wind += yj > yi ? 1 : -1;
    }
  }
  return usesEvenOdd ? Math.abs(wind) % 2 === 1 : wind !== 0;
}

function closeLoop(chain: Point2D[]): Point2D[] {
  if (chain.length === 0) return chain;
  const a = chain[0];
  const b = chain[chain.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) return chain;
  return [...chain, a];
}

function parsePathChains(d: string): Point2D[][] {
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
      if (chain.length > 0) chains.push(chain);
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
      const rel = op === 'l';
      push((rel ? cx : 0) + num(), (rel ? cy : 0) + num());
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
      flattenCubic(p0, p1, p2, p3, chain);
      cx = p3.x;
      cy = p3.y;
      continue;
    }
    if (op === 'Q' || op === 'q') {
      const rel = op === 'q';
      const p0 = { x: cx, y: cy };
      const p1 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      const p2 = { x: (rel ? cx : 0) + num(), y: (rel ? cy : 0) + num() };
      flattenQuadratic(p0, p1, p2, chain);
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
  if (chain.length > 0) chains.push(chain);
  return chains;
}

function flattenCubic(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, out: Point2D[], depth = 0): void {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const d1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / len;
  const d2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx) / len;
  if (depth >= 8 || (d1 <= 0.2 && d2 <= 0.2)) {
    out.push(p3);
    return;
  }
  const ab = mid(p0, p1);
  const bc = mid(p1, p2);
  const cd = mid(p2, p3);
  const abbc = mid(ab, bc);
  const bccd = mid(bc, cd);
  const midPt = mid(abbc, bccd);
  flattenCubic(p0, ab, abbc, midPt, out, depth + 1);
  flattenCubic(midPt, bccd, cd, p3, out, depth + 1);
}

function flattenQuadratic(p0: Point2D, p1: Point2D, p2: Point2D, out: Point2D[]): void {
  flattenCubic(p0, mid(p0, p1), mid(p1, p2), p2, out);
}

function mid(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function fmt(value: number, precision: number): string {
  return value.toFixed(precision).replace(/\.?0+$/, '');
}

function traceMaskLoops(
  labelMap: Int32Array,
  regionId: number,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Point2D[][] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && labelMap[y * width + x] === regionId;
  const outgoing = new Map<string, Array<[number, number]>>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const key = `${ax},${ay}`;
    const list = outgoing.get(key);
    if (list) list.push([bx, by]);
    else outgoing.set(key, [[bx, by]]);
  };
  const x0 = Math.max(0, minX);
  const y0 = Math.max(0, minY);
  const x1 = Math.min(width - 1, maxX);
  const y1 = Math.min(height - 1, maxY);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x + 1, y, x, y);
      if (!inside(x, y + 1)) add(x, y + 1, x + 1, y + 1);
      if (!inside(x - 1, y)) add(x, y, x, y + 1);
      if (!inside(x + 1, y)) add(x + 1, y + 1, x + 1, y);
    }
  }
  const loops: Point2D[][] = [];
  const keys = [...outgoing.keys()];
  for (const key of keys) {
    while ((outgoing.get(key)?.length ?? 0) > 0) {
      const start = key.split(',').map(Number);
      const loop: Point2D[] = [{ x: start[0], y: start[1] }];
      let px = start[0];
      let py = start[1];
      let cx = start[0];
      let cy = start[1];
      for (let guard = 0; guard < width * height * 4; guard++) {
        const list = outgoing.get(`${cx},${cy}`);
        if (!list || list.length === 0) break;
        let pick = 0;
        if (list.length > 1 && (cx !== px || cy !== py)) {
          const inX = cx - px;
          const inY = cy - py;
          let best = -Infinity;
          for (let n = 0; n < list.length; n++) {
            const outX = list[n][0] - cx;
            const outY = list[n][1] - cy;
            const cross = inX * outY - inY * outX;
            const dot = inX * outX + inY * outY;
            const score = Math.atan2(cross, dot);
            if (score > best) {
              best = score;
              pick = n;
            }
          }
        }
        const next = list.splice(pick, 1)[0];
        if (list.length === 0) outgoing.delete(`${cx},${cy}`);
        px = cx;
        py = cy;
        cx = next[0];
        cy = next[1];
        if (cx === start[0] && cy === start[1]) break;
        loop.push({ x: cx, y: cy });
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}
