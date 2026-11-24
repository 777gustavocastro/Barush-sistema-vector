import { Resvg } from '@resvg/resvg-js';
import type { RawRgbaImage } from '../../types';
import type { Point2D } from '../contract/geometricContract';
import { fitInfiniteLineTLS, intersectLines } from '../primitives/lineFitter';
import { reconstructClosedContourPrimitive } from '../primitives/primitiveReconstructor';
import { signedArea } from '../primitives/subpixelBoundaryExtractor';
import {
  buildCoverageFieldFromImage,
  extractSubpixelLoopsFromField,
} from '../primitives/subpixelBoundaryExtractor';
import { fmtNum } from '../primitives/types';
import { canonicalizeSharedBoundaries } from './sharedBoundary';
import {
  boundaryDistancePx,
  computeSignedDistanceField,
  measureMedialThickness,
  profileFromValues,
} from './signedDistanceField';
import { countOpenCavities, findEnclosedHoles } from './topologyCavities';
import type {
  LoopGeom,
  StructureElement,
  StructureReconstruction,
  ThicknessProfile,
} from './types';

interface RegionDraft {
  id: number;
  hex: string;
  rgb: [number, number, number];
  mask: Uint8Array;
  pixelCount: number;
  outer: LoopGeom;
  holes: LoopGeom[];
  outerPoints: Point2D[];
  holeCount: number;
  openCavityCount: number;
  thickness: ThicknessProfile;
}

function fmt(value: number): string {
  return fmtNum(value);
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function estimateBorderBg(image: RawRgbaImage): [number, number, number] {
  const { width, height, data } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const add = (x: number, y: number) => {
    const i4 = (y * width + x) * 4;
    if (data[i4 + 3] < 128) return;
    r += data[i4];
    g += data[i4 + 1];
    b += data[i4 + 2];
    count++;
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }
  if (count === 0) return [255, 255, 255];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function colorDist(data: Uint8Array, index: number, rgb: [number, number, number]): number {
  const i4 = index * 4;
  return Math.hypot(data[i4] - rgb[0], data[i4 + 1] - rgb[1], data[i4 + 2] - rgb[2]);
}

function segmentRegions(image: RawRgbaImage, bg: [number, number, number]): Array<{
  id: number;
  mask: Uint8Array;
  rgb: [number, number, number];
  pixelCount: number;
}> {
  const { width, height, data } = image;
  const core = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] < 128) continue;
    if (colorDist(data, i, bg) > 48) core[i] = 1;
  }

  const labels = new Int32Array(width * height);
  const regions: Array<{ id: number; pixels: number[]; rgb: [number, number, number] }> = [];
  const queue = new Int32Array(width * height);

  for (let start = 0; start < core.length; start++) {
    if (!core[start] || labels[start]) continue;
    const seed: [number, number, number] = [data[start * 4], data[start * 4 + 1], data[start * 4 + 2]];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = regions.length + 1;
    const pixels: number[] = [];
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      rSum += data[idx * 4];
      gSum += data[idx * 4 + 1];
      bSum += data[idx * 4 + 2];
      const x = idx % width;
      const y = (idx - x) / width;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const nIdx = ny * width + nx;
        if (!core[nIdx] || labels[nIdx]) return;
        if (colorDist(data, nIdx, seed) > 42) return;
        labels[nIdx] = regions.length + 1;
        queue[tail++] = nIdx;
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    if (pixels.length < 4) {
      for (const idx of pixels) labels[idx] = 0;
      continue;
    }
    regions.push({
      id: regions.length + 1,
      pixels,
      rgb: [Math.round(rSum / pixels.length), Math.round(gSum / pixels.length), Math.round(bSum / pixels.length)],
    });
  }

  for (let pass = 0; pass < 3; pass++) {
    const assignments: Array<{ idx: number; label: number }> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (labels[idx] || data[idx * 4 + 3] < 128) continue;
        if (colorDist(data, idx, bg) < 22) continue;
        let bestLabel = 0;
        let bestDist = Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const label = labels[ny * width + nx];
            if (!label) continue;
            const region = regions[label - 1];
            if (!region) continue;
            const dist = colorDist(data, idx, region.rgb);
            if (dist < bestDist) {
              bestDist = dist;
              bestLabel = label;
            }
          }
        }
        if (bestLabel && bestDist < colorDist(data, idx, bg) && bestDist < 78) {
          assignments.push({ idx, label: bestLabel });
        }
      }
    }
    for (const assignment of assignments) {
      labels[assignment.idx] = assignment.label;
      regions[assignment.label - 1].pixels.push(assignment.idx);
    }
    if (assignments.length === 0) break;
  }

  const pixelCount = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) pixelCount.set(labels[i], (pixelCount.get(labels[i]) ?? 0) + 1);
  }
  const neighborOf = new Map<number, Map<number, number>>();
  const touch = (a: number, b: number) => {
    if (!a || !b || a === b) return;
    const map = neighborOf.get(a) ?? new Map<number, number>();
    map.set(b, (map.get(b) ?? 0) + 1);
    neighborOf.set(a, map);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const label = labels[y * width + x];
      if (!label) continue;
      if (x + 1 < width) touch(label, labels[y * width + x + 1]);
      if (y + 1 < height) touch(label, labels[(y + 1) * width + x]);
    }
  }
  const mergedInto = new Map<number, number>();
  const resolve = (label: number): number => {
    let current = label;
    while (mergedInto.has(current)) current = mergedInto.get(current)!;
    return current;
  };
  for (const region of regions) {
    if ((pixelCount.get(region.id) ?? 0) > 48) continue;
    const neighbors = neighborOf.get(region.id);
    if (!neighbors) continue;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const neighbor of neighbors.keys()) {
      const host = regions[neighbor - 1];
      if (!host || (pixelCount.get(neighbor) ?? 0) <= (pixelCount.get(region.id) ?? 0)) continue;
      const dist = Math.hypot(host.rgb[0] - region.rgb[0], host.rgb[1] - region.rgb[1], host.rgb[2] - region.rgb[2]);
      if (dist < bestDist) {
        bestDist = dist;
        best = neighbor;
      }
    }
    if (best !== null && bestDist < 90) mergedInto.set(region.id, best);
  }

  return regions
    .filter((region) => !mergedInto.has(region.id))
    .map((region) => {
      const mask = new Uint8Array(width * height);
      let count = 0;
      for (let i = 0; i < labels.length; i++) {
        if (resolve(labels[i]) === region.id) {
          mask[i] = 1;
          count++;
        }
      }
      return { id: region.id, mask, rgb: region.rgb, pixelCount: count };
    })
    .filter((region) => region.pixelCount >= 4);
}

function rdpOpen(points: Point2D[], start: number, end: number, epsilon: number, keep: Set<number>): void {
  if (end - start <= 1) return;
  const a = points[start];
  const b = points[end];
  let best = -1;
  let bestIndex = -1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  for (let i = start + 1; i < end; i++) {
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((points[i].x - a.x) * dx + (points[i].y - a.y) * dy) / len2));
    const dist = Math.hypot(points[i].x - (a.x + t * dx), points[i].y - (a.y + t * dy));
    if (dist > best) {
      best = dist;
      bestIndex = i;
    }
  }
  if (best > epsilon && bestIndex >= 0) {
    keep.add(bestIndex);
    rdpOpen(points, start, bestIndex, epsilon, keep);
    rdpOpen(points, bestIndex, end, epsilon, keep);
  }
}

function simplifyClosed(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length < 6) return points;
  let far = 0;
  let farDist = -1;
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  cx /= points.length;
  cy /= points.length;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.hypot(points[i].x - cx, points[i].y - cy);
    if (dist > farDist) {
      farDist = dist;
      far = i;
    }
  }
  const rotated = points.map((_, index) => points[(far + index) % points.length]);
  let split = 0;
  let splitDist = -1;
  for (let i = 1; i < rotated.length; i++) {
    const dist = Math.hypot(rotated[i].x - rotated[0].x, rotated[i].y - rotated[0].y);
    if (dist > splitDist) {
      splitDist = dist;
      split = i;
    }
  }
  const keep = new Set<number>([0, split]);
  rdpOpen(rotated, 0, split, epsilon, keep);
  rdpOpen(rotated, split, rotated.length - 1, epsilon, keep);
  return [...keep].sort((a, b) => a - b).map((index) => rotated[index]);
}

function refinePolygon(corners: Point2D[], source: Point2D[]): Point2D[] | null {
  if (corners.length < 3) return null;
  const nearest = (point: Point2D) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < corners.length; i++) {
      const next = corners[(i + 1) % corners.length];
      const dx = next.x - corners[i].x;
      const dy = next.y - corners[i].y;
      const len2 = dx * dx + dy * dy;
      const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - corners[i].x) * dx + (point.y - corners[i].y) * dy) / len2));
      const dist = Math.hypot(point.x - (corners[i].x + t * dx), point.y - (corners[i].y + t * dy));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };
  const groups = corners.map(() => [] as Point2D[]);
  for (const point of source) groups[nearest(point)].push(point);
  const lines = groups.map((group, index) => {
    const usable = group.length >= 2 ? group : [corners[index], corners[(index + 1) % corners.length]];
    return fitInfiniteLineTLS(usable);
  });
  if (lines.some((line) => !line)) return null;
  const vertices: Point2D[] = [];
  for (let i = 0; i < corners.length; i++) {
    const previous = lines[(i - 1 + lines.length) % lines.length];
    const current = lines[i];
    if (!previous || !current) return null;
    const intersection = intersectLines(previous, current);
    if (!intersection || Math.hypot(intersection.x - corners[i].x, intersection.y - corners[i].y) > 3) {
      return null;
    }
    vertices.push(intersection);
  }
  return vertices;
}

function maybeAxisRect(geom: LoopGeom): LoopGeom {
  if (geom.type !== 'polygon' || geom.points.length < 4) return geom;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of geom.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 0.5 || height < 0.5) return geom;
  const area = Math.abs(signedArea(geom.points));
  if (area / (width * height) < 0.93) return geom;
  for (const point of geom.points) {
    const dx = Math.min(Math.abs(point.x - minX), Math.abs(point.x - maxX));
    const dy = Math.min(Math.abs(point.y - minY), Math.abs(point.y - maxY));
    if (Math.min(dx, dy) > 0.65) return geom;
  }
  return { type: 'rect', x: minX, y: minY, width, height };
}

function loopFromContour(
  points: Point2D[],
  mask: Uint8Array | null,
  width: number,
  height: number
): LoopGeom {
  const fitted = reconstructClosedContourPrimitive(points, '#000000');
  const primitive = fitted.accepted ? fitted.primitive : null;
  if (primitive?.kind === 'circle') {
    return { type: 'circle', cx: primitive.cx, cy: primitive.cy, r: primitive.r };
  }
  if (primitive?.kind === 'rect' && primitive.rx && primitive.rx > 0.05) {
    return {
      type: 'roundrect',
      x: primitive.x,
      y: primitive.y,
      width: primitive.width,
      height: primitive.height,
      rx: primitive.rx,
      ry: primitive.ry ?? primitive.rx,
    };
  }
  if (primitive?.kind === 'rect' && !primitive.rotationDeg) {
    return { type: 'rect', x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height };
  }
  if (primitive?.kind === 'polygon') return maybeAxisRect({ type: 'polygon', points: primitive.vertices });
  if (primitive?.kind === 'composite') {
    return {
      type: 'composite',
      segments: primitive.segments.map((segment) =>
        segment.kind === 'line'
          ? { kind: 'line', x1: segment.x1, y1: segment.y1, x2: segment.x2, y2: segment.y2 }
          : {
              kind: 'arc',
              cx: segment.cx,
              cy: segment.cy,
              rx: segment.rx,
              ry: segment.ry,
              rotationDeg: segment.rotationDeg,
              x1: segment.x1,
              y1: segment.y1,
              x2: segment.x2,
              y2: segment.y2,
              largeArc: segment.largeArc,
              sweep: segment.sweep,
              startAngleRad: segment.startAngleRad,
              endAngleRad: segment.endAngleRad,
            }
      ),
    };
  }
  if (mask) {
    for (const epsilon of [1.2, 0.75, 0.4]) {
      const corners = simplifyClosed(points, epsilon);
      if (corners.length < 3 || corners.length > 32) continue;
      const refined = refinePolygon(corners, points) ?? corners;
      const path = loopToSubpath({ type: 'polygon', points: refined }, true);
      const coverage = coverageOf(mask, renderMask(`<path fill="#000" d="${path}"/>`, width, height));
      if (coverage.iou >= 0.96 && coverage.recall >= 0.85) {
        return maybeAxisRect({ type: 'polygon', points: refined });
      }
    }
  }
  return maybeAxisRect({ type: 'polygon', points: simplifyClosed(points, 0.45) });
}

function loopOutline(geom: LoopGeom): Point2D[] {
  if (geom.type === 'polygon') return geom.points;
  if (geom.type === 'rect' || geom.type === 'roundrect') {
    return [
      { x: geom.x, y: geom.y },
      { x: geom.x + geom.width, y: geom.y },
      { x: geom.x + geom.width, y: geom.y + geom.height },
      { x: geom.x, y: geom.y + geom.height },
    ];
  }
  if (geom.type === 'circle') {
    const points: Point2D[] = [];
    for (let deg = 0; deg < 360; deg += 12) {
      const angle = (deg * Math.PI) / 180;
      points.push({ x: geom.cx + Math.cos(angle) * geom.r, y: geom.cy + Math.sin(angle) * geom.r });
    }
    return points;
  }
  const points: Point2D[] = [];
  for (const segment of geom.segments) points.push({ x: segment.x1, y: segment.y1 });
  return points;
}

function loopArea(geom: LoopGeom): number {
  if (geom.type === 'circle') return Math.PI * geom.r * geom.r;
  if (geom.type === 'rect' || geom.type === 'roundrect') return geom.width * geom.height;
  if (geom.type === 'polygon') return signedArea(geom.points);
  return signedArea(loopOutline(geom));
}

function loopToSubpath(geom: LoopGeom, positive: boolean): string {
  if (geom.type === 'circle') {
    const sweep = positive ? 0 : 1;
    const { cx, cy, r } = geom;
    return `M ${fmt(cx - r)} ${fmt(cy)} A ${fmt(r)} ${fmt(r)} 0 1 ${sweep} ${fmt(cx + r)} ${fmt(cy)} A ${fmt(r)} ${fmt(r)} 0 1 ${sweep} ${fmt(cx - r)} ${fmt(cy)} Z`;
  }
  if (geom.type === 'rect' || geom.type === 'roundrect') {
    const { x, y, width, height } = geom;
    const rx = geom.type === 'roundrect' ? geom.rx : 0;
    if (rx > 0.05) {
      const ry = geom.type === 'roundrect' ? geom.ry : rx;
      const sign = positive ? 1 : -1;
      const x0 = x;
      const y0 = y;
      const x1 = x + width;
      const y1 = y + height;
      if (sign > 0) {
        return `M ${fmt(x0 + rx)} ${fmt(y0)} H ${fmt(x1 - rx)} A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x1)} ${fmt(y0 + ry)} V ${fmt(y1 - ry)} A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x1 - rx)} ${fmt(y1)} H ${fmt(x0 + rx)} A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x0)} ${fmt(y1 - ry)} V ${fmt(y0 + ry)} A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x0 + rx)} ${fmt(y0)} Z`;
      }
      return `M ${fmt(x0 + rx)} ${fmt(y0)} A ${fmt(rx)} ${fmt(ry)} 0 0 0 ${fmt(x0)} ${fmt(y0 + ry)} V ${fmt(y1 - ry)} A ${fmt(rx)} ${fmt(ry)} 0 0 0 ${fmt(x0 + rx)} ${fmt(y1)} H ${fmt(x1 - rx)} A ${fmt(rx)} ${fmt(ry)} 0 0 0 ${fmt(x1)} ${fmt(y1 - ry)} V ${fmt(y0 + ry)} A ${fmt(rx)} ${fmt(ry)} 0 0 0 ${fmt(x1 - rx)} ${fmt(y0)} Z`;
    }
    if (positive) return `M ${fmt(x)} ${fmt(y)} H ${fmt(x + width)} V ${fmt(y + height)} H ${fmt(x)} Z`;
    return `M ${fmt(x)} ${fmt(y)} V ${fmt(y + height)} H ${fmt(x + width)} V ${fmt(y)} Z`;
  }
  if (geom.type === 'composite') {
    const segments = geom.segments;
    if (segments.length === 0) return '';
    let d = `M ${fmt(segments[0].x1)} ${fmt(segments[0].y1)}`;
    const ordered = positive ? segments : [...segments].reverse();
    if (!positive) {
      d = `M ${fmt(ordered[0].x2)} ${fmt(ordered[0].y2)}`;
      for (const segment of ordered) {
        if (segment.kind === 'line') d += ` L ${fmt(segment.x1)} ${fmt(segment.y1)}`;
        else {
          const sweep = segment.sweep === 1 ? 0 : 1;
          d += ` A ${fmt(segment.rx)} ${fmt(segment.ry)} ${fmt(segment.rotationDeg)} ${segment.largeArc} ${sweep} ${fmt(segment.x1)} ${fmt(segment.y1)}`;
        }
      }
      return `${d} Z`;
    }
    for (const segment of ordered) {
      if (segment.kind === 'line') d += ` L ${fmt(segment.x2)} ${fmt(segment.y2)}`;
      else {
        d += ` A ${fmt(segment.rx)} ${fmt(segment.ry)} ${fmt(segment.rotationDeg)} ${segment.largeArc} ${segment.sweep} ${fmt(segment.x2)} ${fmt(segment.y2)}`;
      }
    }
    return `${d} Z`;
  }
  let points = geom.points;
  const area = signedArea(points);
  if ((positive && area < 0) || (!positive && area > 0)) points = [...points].reverse();
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${fmt(points[i].x)} ${fmt(points[i].y)}`;
  return `${d} Z`;
}

function renderMask(element: string, width: number, height: number): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${element}</svg>`;
  const pixels = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().pixels;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0;
  return mask;
}

function coverageOf(reference: Uint8Array, candidate: Uint8Array): { iou: number; recall: number } {
  let inter = 0;
  let union = 0;
  let ref = 0;
  for (let i = 0; i < reference.length; i++) {
    if (reference[i]) ref++;
    if (reference[i] || candidate[i]) union++;
    if (reference[i] && candidate[i]) inter++;
  }
  return { iou: union ? inter / union : 1, recall: ref ? inter / ref : 1 };
}

function thicknessOf(outer: LoopGeom, holes: LoopGeom[], mask: Uint8Array, width: number, height: number): ThicknessProfile {
  if (outer.type === 'circle' && holes.length === 1 && holes[0].type === 'circle') {
    const samples: number[] = [];
    for (let deg = 0; deg < 360; deg += 10) {
      const angle = (deg * Math.PI) / 180;
      const ox = outer.cx + Math.cos(angle) * outer.r;
      const oy = outer.cy + Math.sin(angle) * outer.r;
      const ix = holes[0].cx + Math.cos(angle) * holes[0].r;
      const iy = holes[0].cy + Math.sin(angle) * holes[0].r;
      samples.push(Math.hypot(ox - ix, oy - iy));
    }
    return profileFromValues(samples);
  }
  if (outer.type === 'rect' && holes.length === 1 && holes[0].type === 'rect') {
    const hole = holes[0];
    return profileFromValues([
      hole.x - outer.x,
      outer.x + outer.width - (hole.x + hole.width),
      hole.y - outer.y,
      outer.y + outer.height - (hole.y + hole.height),
    ]);
  }
  if ((outer.type === 'rect' || outer.type === 'roundrect') && holes.length === 0) {
    return profileFromValues(new Array(12).fill(Math.min(outer.width, outer.height)));
  }
  if (outer.type === 'polygon' && holes.length === 0 && outer.points.length === 4) {
    const points = outer.points;
    const edge = (index: number) => {
      const a = points[index];
      const b = points[(index + 1) % 4];
      return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
    };
    const edges = [0, 1, 2, 3].map(edge);
    const pairA = (edges[0].len + edges[2].len) / 2;
    const pairB = (edges[1].len + edges[3].len) / 2;
    const sides = pairA >= pairB ? [edges[0], edges[2]] : [edges[1], edges[3]];
    const samples: number[] = [];
    for (let step = 0; step <= 10; step++) {
      const t = step / 10;
      const p = {
        x: sides[0].a.x + (sides[0].b.x - sides[0].a.x) * t,
        y: sides[0].a.y + (sides[0].b.y - sides[0].a.y) * t,
      };
      const q = {
        x: sides[1].b.x + (sides[1].a.x - sides[1].b.x) * t,
        y: sides[1].b.y + (sides[1].a.y - sides[1].b.y) * t,
      };
      samples.push(Math.hypot(p.x - q.x, p.y - q.y));
    }
    return profileFromValues(samples);
  }
  return measureMedialThickness(computeSignedDistanceField(mask, width, height), mask);
}

function tryEquivalentStroke(
  region: RegionDraft,
  width: number,
  height: number
): string | null {
  const { outer, holes, hex, mask, thickness } = region;
  if (!thickness.withinContract || thickness.medianPx < 0.75) return null;
  if (outer.type === 'circle' && holes.length === 0) return null;
  if ((outer.type === 'rect' || outer.type === 'roundrect') && holes.length === 0) {
    const shortSide = Math.min(outer.width, outer.height);
    const longSide = Math.max(outer.width, outer.height);
    if (longSide < shortSide * 3) return null;
  }
  if (outer.type === 'polygon' && holes.length === 0) {
    const area = Math.abs(loopArea(outer));
    const outline = loopOutline(outer);
    let perimeter = 0;
    for (let i = 0; i < outline.length; i++) {
      const next = outline[(i + 1) % outline.length];
      perimeter += Math.hypot(next.x - outline[i].x, next.y - outline[i].y);
    }
    const quotient = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 1;
    if (quotient > 0.5) return null;
  }
  if (holes.length > 1) return null;

  const candidates: string[] = [];
  if (outer.type === 'circle' && holes.length === 1 && holes[0].type === 'circle') {
    const hole = holes[0];
    const strokeWidth = outer.r - hole.r;
    const centerShift = Math.hypot(outer.cx - hole.cx, outer.cy - hole.cy);
    if (strokeWidth > 0.8 && centerShift <= 0.6) {
      const cx = (outer.cx + hole.cx) / 2;
      const cy = (outer.cy + hole.cy) / 2;
      const radius = (outer.r + hole.r) / 2;
      candidates.push(
        `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(radius)}" fill="none" stroke="${hex}" stroke-width="${fmt(strokeWidth)}"/>`
      );
    }
  }
  if (outer.type === 'rect' && holes.length === 1 && holes[0].type === 'rect') {
    const hole = holes[0];
    const sides = [
      hole.x - outer.x,
      outer.x + outer.width - (hole.x + hole.width),
      hole.y - outer.y,
      outer.y + outer.height - (hole.y + hole.height),
    ];
    if (Math.min(...sides) > 0.8) {
      const strokeWidth = thickness.medianPx;
      candidates.push(
        `<rect x="${fmt(outer.x + strokeWidth / 2)}" y="${fmt(outer.y + strokeWidth / 2)}" width="${fmt(outer.width - strokeWidth)}" height="${fmt(outer.height - strokeWidth)}" fill="none" stroke="${hex}" stroke-width="${fmt(strokeWidth)}" stroke-linejoin="miter"/>`
      );
    }
  }
  if (outer.type === 'rect' && holes.length === 0) {
    const shortSide = Math.min(outer.width, outer.height);
    const horizontal = outer.width >= outer.height;
    const x1 = horizontal ? outer.x : outer.x + outer.width / 2;
    const x2 = horizontal ? outer.x + outer.width : outer.x + outer.width / 2;
    const y1 = horizontal ? outer.y + outer.height / 2 : outer.y;
    const y2 = horizontal ? outer.y + outer.height / 2 : outer.y + outer.height;
    for (const cap of ['butt', 'round', 'square']) {
      candidates.push(
        `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${hex}" stroke-width="${fmt(shortSide)}" stroke-linecap="${cap}"/>`
      );
    }
  }
  if (outer.type === 'composite' && holes.length === 0) {
    const arcs = outer.segments.filter((segment) => segment.kind === 'arc');
    const lines = outer.segments.filter((segment) => segment.kind === 'line');
    if (arcs.length === 2 && lines.length === 2) {
      const span = (arc: (typeof arcs)[number]) => Math.abs(arc.endAngleRad - arc.startAngleRad);
      const radius = (arcs[0].rx + arcs[1].rx) / 2;
      if (
        Math.abs(arcs[0].rx - arcs[1].rx) <= 0.6 &&
        Math.abs(span(arcs[0]) - Math.PI) < 0.4 &&
        Math.abs(span(arcs[1]) - Math.PI) < 0.4
      ) {
        candidates.push(
          `<line x1="${fmt(arcs[0].cx)}" y1="${fmt(arcs[0].cy)}" x2="${fmt(arcs[1].cx)}" y2="${fmt(arcs[1].cy)}" stroke="${hex}" stroke-width="${fmt(radius * 2)}" stroke-linecap="round"/>`
        );
      }
    }
  }

  let best: string | null = null;
  let bestIou = 0;
  for (const candidate of candidates) {
    const rendered = renderMask(candidate, width, height);
    const coverage = coverageOf(mask, rendered);
    if (coverage.iou >= 0.96 && coverage.recall >= 0.85 && coverage.iou > bestIou) {
      best = candidate;
      bestIou = coverage.iou;
    }
  }
  return best;
}

function emitFill(region: RegionDraft): { svg: string; pathD: string } {
  const parts = [loopToSubpath(region.outer, true), ...region.holes.map((hole) => loopToSubpath(hole, false))];
  const pathD = parts.filter(Boolean).join(' ');
  return {
    pathD,
    svg: `<path fill="${region.hex}" fill-rule="evenodd" d="${pathD}"/>`,
  };
}

function describe(region: RegionDraft, representation: 'fill' | 'stroke'): string {
  const holeText = region.holes.length ? `, ${region.holes.length} furo(s)` : '';
  const cavityText = region.openCavityCount ? `, ${region.openCavityCount} cavidade(s) aberta(s)` : '';
  return `${representation} ${region.outer.type}${holeText}${cavityText}, espessura mediana ${region.thickness.medianPx} px`;
}

/**
 * Reconstrói traços, furos, cavidades e preenchimentos.
 * O SDF mede espessura e distâncias; o SVG sai da geometria das duas bordas
 * ou de um contorno fechado com evenodd. Uma isossuperfície não é o caminho final.
 */
export function reconstructStructure(image: RawRgbaImage): StructureReconstruction {
  const { width, height } = image;
  const bg = estimateBorderBg(image);
  const bgHex = rgbToHex(bg[0], bg[1], bg[2]);
  const segmented = segmentRegions(image, bg);
  const drafts: RegionDraft[] = [];

  for (const region of segmented) {
    const coverage = buildCoverageFieldFromImage(image, bg, region.rgb);
    const field = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!region.mask[idx]) continue;
        field[idx] = Math.max(field[idx], coverage[idx]);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nIdx = ny * width + nx;
            if (!region.mask[nIdx]) field[nIdx] = Math.max(field[nIdx], coverage[nIdx]);
          }
        }
      }
    }
    const loops = extractSubpixelLoopsFromField(field, width, height, 0.5);
    const outerLoop = loops.find((loop) => !loop.isHole) ?? loops[0];
    if (!outerLoop) continue;
    const holeLoops = loops.filter((loop) => loop !== outerLoop && loop.isHole && loop.areaPx >= 4);
    const cavities = findEnclosedHoles(region.mask, width, height);
    const outerReference = new Uint8Array(region.mask);
    for (let i = 0; i < outerReference.length; i++) {
      if (cavities.holeMask[i]) outerReference[i] = 1;
    }
    const outer = loopFromContour(outerLoop.points, outerReference, width, height);
    const holes = holeLoops.map((loop) => loopFromContour(loop.points, null, width, height));
    const openCavityCount = countOpenCavities(region.mask, width, height, cavities.holeMask);
    drafts.push({
      id: region.id,
      hex: rgbToHex(region.rgb[0], region.rgb[1], region.rgb[2]),
      rgb: region.rgb,
      mask: region.mask,
      pixelCount: region.pixelCount,
      outer,
      holes,
      outerPoints: outerLoop.points,
      holeCount: Math.max(cavities.closedHoles, holes.length),
      openCavityCount,
      thickness: thicknessOf(outer, holes, region.mask, width, height),
    });
  }

  const flat = drafts.flatMap((region) => [
    { regionId: region.id, role: 'outer' as const, geom: region.outer },
    ...region.holes.map((geom) => ({ regionId: region.id, role: 'hole' as const, geom })),
  ]);
  const canonical = canonicalizeSharedBoundaries(flat);
  let cursor = 0;
  for (const region of drafts) {
    region.outer = canonical.geoms[cursor++];
    region.holes = region.holes.map(() => canonical.geoms[cursor++]);
    region.thickness = thicknessOf(region.outer, region.holes, region.mask, width, height);
  }

  const elements: StructureElement[] = [];
  const shapeParts: string[] = [];
  const ordered = [...drafts].sort((a, b) => b.pixelCount - a.pixelCount);
  for (const region of ordered) {
    const stroke = tryEquivalentStroke(region, width, height);
    const fill = emitFill(region);
    const representation = stroke ? 'stroke' : 'fill';
    const svg = stroke ?? fill.svg;
    shapeParts.push(svg);
    const outerArea = Math.abs(loopArea(region.outer));
    elements.push({
      id: region.id,
      fillHex: region.hex,
      pixelCount: region.pixelCount,
      representation,
      holeCount: region.holeCount,
      openCavityCount: region.openCavityCount,
      outerArea,
      holeAreas: region.holes.map((hole) => -Math.abs(loopArea(hole))),
      thickness: region.thickness,
      svg,
      pathD: stroke ? null : fill.pathD,
      summary: describe(region, representation),
    });
  }

  const shapeSvg = shapeParts.join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${bgHex}"/>${shapeSvg}</svg>`;
  return {
    width,
    height,
    bgHex,
    elements,
    sharedEdges: canonical.sharedEdges,
    svg,
    shapeSvg,
  };
}

export function distanceBetweenRegionMasks(
  maskA: Uint8Array,
  maskB: Uint8Array,
  width: number,
  height: number
): number {
  return boundaryDistancePx(maskA, maskB, width, height);
}
