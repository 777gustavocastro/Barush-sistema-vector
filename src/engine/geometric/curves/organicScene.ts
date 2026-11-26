import type { RawRgbaImage } from '../../types';
import {
  boundaryError,
  geometricAcceptance,
  type Point2D,
} from '../contract/geometricContract';
import { reconstructClosedContourPrimitive, samplePrimitiveBoundary } from '../primitives/primitiveReconstructor';
import { buildCoverageFieldFromImage, extractSubpixelLoopsFromField } from '../primitives/subpixelBoundaryExtractor';
import { fmtNum } from '../primitives/types';
import { computeSignedDistanceField, measureMedialThickness } from '../structure/signedDistanceField';
import { findEnclosedHoles } from '../structure/topologyCavities';
import { dist, sampleCubic } from './curveFeatures';
import { fitOrganicCurve, sampleOrganic, type OrganicFit } from './organicFitter';

export interface OrganicElement {
  id: number;
  fillHex: string;
  primitive: string | null;
  cubicCount: number;
  lineCount: number;
  cornerCount: number;
  holeCount: number;
  errorMaxPx: number;
  g1BreakDeg: number;
  g2Ratio: number;
  meanBoundarySdfPx: number;
  svg: string;
  path: string;
}

export interface OrganicReconstruction {
  width: number;
  height: number;
  elements: OrganicElement[];
  sharedCurves: number;
  svg: string;
  shapeSvg: string;
}

interface LoopModel {
  samples: Point2D[];
  fit: OrganicFit | null;
  primitivePath: string | null;
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function estimateBg(image: RawRgbaImage): [number, number, number] {
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
  if (!count) return [255, 255, 255];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function segment(image: RawRgbaImage, bg: [number, number, number]) {
  const { width, height, data } = image;
  const labels = new Int32Array(width * height);
  const regions: Array<{ id: number; rgb: [number, number, number]; count: number; r: number; g: number; b: number }> = [];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4 + 3] < 128) continue;
    const dr = data[start * 4] - bg[0];
    const dg = data[start * 4 + 1] - bg[1];
    const db = data[start * 4 + 2] - bg[2];
    if (Math.hypot(dr, dg, db) < 46) continue;
    const seed: [number, number, number] = [data[start * 4], data[start * 4 + 1], data[start * 4 + 2]];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    const id = regions.length + 1;
    labels[start] = id;
    let count = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    while (head < tail) {
      const idx = queue[head++];
      count++;
      r += data[idx * 4];
      g += data[idx * 4 + 1];
      b += data[idx * 4 + 2];
      const x = idx % width;
      const y = (idx - x) / width;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const nIdx = ny * width + nx;
        if (labels[nIdx]) return;
        const nd = Math.hypot(data[nIdx * 4] - seed[0], data[nIdx * 4 + 1] - seed[1], data[nIdx * 4 + 2] - seed[2]);
        if (nd > 44) return;
        if (Math.hypot(data[nIdx * 4] - bg[0], data[nIdx * 4 + 1] - bg[1], data[nIdx * 4 + 2] - bg[2]) < 28) return;
        labels[nIdx] = id;
        queue[tail++] = nIdx;
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    if (count < 24) {
      for (let i = 0; i < labels.length; i++) if (labels[i] === id) labels[i] = 0;
      continue;
    }
    regions.push({
      id,
      count,
      r,
      g,
      b,
      rgb: [Math.round(r / count), Math.round(g / count), Math.round(b / count)],
    });
  }
  return { labels, regions: regions.filter((region) => region.count >= 24) };
}

function loopModel(points: Point2D[], fill: string, thin: boolean): LoopModel {
  const primitive = reconstructClosedContourPrimitive(points, fill);
  const primitivePath = primitive.accepted && primitive.svgElement ? primitive.svgElement : null;
  const limits = thin
    ? { maxPx: 0.28, meanPx: 0.1, hausdorffPx: 0.36 }
    : {
        maxPx: geometricAcceptance.organic.maxPx,
        meanPx: geometricAcceptance.organic.meanPx,
        hausdorffPx: geometricAcceptance.organic.hausdorffPx,
      };
  const fit = fitOrganicCurve(points, { closed: true, limits });
  return {
    samples: primitive.accepted && primitive.primitive ? samplePrimitiveBoundary(primitive.primitive) : sampleOrganic(fit, 1),
    fit,
    primitivePath,
  };
}

function reverseSpan(span: OrganicFit['spans'][number]) {
  return { p0: span.p3, p1: span.p2, p2: span.p1, p3: span.p0 };
}

function meanDistance(a: Point2D[], b: Point2D[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  let total = 0;
  for (const point of a) {
    let best = Infinity;
    for (const other of b) best = Math.min(best, dist(point, other));
    total += best;
  }
  return total / a.length;
}

function canonicalizeFits(groups: Array<{ regionId: number; loops: LoopModel[] }>): number {
  const entries: Array<{ regionId: number; loop: LoopModel; span: number }> = [];
  for (const group of groups) {
    for (const loop of group.loops) {
      if (!loop.fit) continue;
      loop.fit.spans.forEach((_, index) => entries.push({ regionId: group.regionId, loop, span: index }));
    }
  }
  let shared = 0;
  const used = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].regionId === entries[j].regionId) continue;
      const key = `${entries[i].regionId}:${entries[i].span}/${entries[j].regionId}:${entries[j].span}`;
      if (used.has(key)) continue;
      const a = entries[i].loop.fit!;
      const b = entries[j].loop.fit!;
      const aSamples = sampleCubic(a.spans[entries[i].span], 1.1);
      const bSamples = sampleCubic(b.spans[entries[j].span], 1.1);
      const forward = meanDistance(aSamples, bSamples);
      const backward = meanDistance(aSamples, [...bSamples].reverse());
      if (Math.min(forward, backward) > 1.05) continue;
      const other = backward < forward ? [...bSamples].reverse() : bSamples;
      const averaged: Point2D[] = aSamples.map((point, index) => {
        const mate = other[Math.round((index / Math.max(1, aSamples.length - 1)) * (other.length - 1))];
        return { x: (point.x + mate.x) / 2, y: (point.y + mate.y) / 2 };
      });
      const canonical = fitOrganicCurve(averaged, { closed: false });
      if (canonical.spans.length !== 1) continue;
      const span = canonical.spans[0];
      a.spans[entries[i].span] = span;
      a.straight[entries[i].span] = canonical.straight[0];
      b.spans[entries[j].span] = backward < forward ? reverseSpan(span) : span;
      b.straight[entries[j].span] = canonical.straight[0];
      used.add(key);
      shared++;
    }
  }
  for (const group of groups) {
    for (const loop of group.loops) {
      if (!loop.fit) continue;
      loop.fit.path = rebuild(loop.fit);
      loop.samples = sampleOrganic(loop.fit, 1);
    }
  }
  return shared;
}

function rebuild(fit: OrganicFit): string {
  if (fit.spans.length === 0) return '';
  const fmt = (value: number) => fmtNum(value);
  let path = `M ${fmt(fit.spans[0].p0.x)} ${fmt(fit.spans[0].p0.y)}`;
  for (let i = 0; i < fit.spans.length; i++) {
    const span = fit.spans[i];
    if (fit.straight[i]) path += ` L ${fmt(span.p3.x)} ${fmt(span.p3.y)}`;
    else path += ` C ${fmt(span.p1.x)} ${fmt(span.p1.y)} ${fmt(span.p2.x)} ${fmt(span.p2.y)} ${fmt(span.p3.x)} ${fmt(span.p3.y)}`;
  }
  if (fit.closed) path += ' Z';
  return path;
}

function elementToSubpath(svg: string): string | null {
  const rect = svg.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
  if (rect) {
    const x = Number(rect[1]);
    const y = Number(rect[2]);
    const width = Number(rect[3]);
    const height = Number(rect[4]);
    return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
  }
  const path = svg.match(/\bd="([^"]+)"/);
  if (path && !/\bC\b/.test(path[1])) return path[1];
  return null;
}

function compound(loops: LoopModel[], fill: string): string {
  if (loops.length === 1 && loops[0].primitivePath) return loops[0].primitivePath;
  if (loops.every((loop) => loop.primitivePath)) {
    const parts = loops.map((loop) => elementToSubpath(loop.primitivePath!)).filter((part): part is string => Boolean(part));
    if (parts.length === loops.length) return `<path fill="${fill}" fill-rule="evenodd" d="${parts.join(' ')}"/>`;
  }
  const d = loops
    .map((loop) => loop.fit?.path ?? '')
    .filter(Boolean)
    .join(' ');
  return `<path fill="${fill}" fill-rule="evenodd" d="${d}"/>`;
}

/**
 * Reconstrói a cena usando primitiva quando ela cabe no contrato e Bézier orgânica no restante.
 * Fronteiras vizinhas compatíveis passam a apontar para a mesma cúbica.
 */
export function reconstructOrganic(image: RawRgbaImage): OrganicReconstruction {
  const { width, height } = image;
  const bg = estimateBg(image);
  const segmented = segment(image, bg);
  const groups: Array<{ regionId: number; hex: string; mask: Uint8Array; loops: LoopModel[]; holes: number }> = [];

  for (const region of segmented.regions) {
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < segmented.labels.length; i++) if (segmented.labels[i] === region.id) mask[i] = 1;
    const coverage = buildCoverageFieldFromImage(image, bg, region.rgb);
    const field = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!mask[idx]) continue;
        field[idx] = Math.max(field[idx], coverage[idx]);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nIdx = ny * width + nx;
            if (segmented.labels[nIdx] !== 0 && segmented.labels[nIdx] !== region.id) continue;
            field[nIdx] = Math.max(field[nIdx], coverage[nIdx]);
          }
        }
      }
    }
    const extracted = extractSubpixelLoopsFromField(field, width, height, 0.5).sort((a, b) => b.areaPx - a.areaPx);
    const outer = extracted[0];
    if (!outer || outer.areaPx < 6) continue;
    const hex = rgbToHex(region.rgb);
    const holes = extracted.filter((loop) => loop !== outer && loop.areaPx >= 8 && loop.areaPx < outer.areaPx * 0.8);
    const thickness = measureMedialThickness(computeSignedDistanceField(mask, width, height), mask);
    const thin = thickness.medianPx > 0 && thickness.medianPx <= 14;
    const loops = [outer, ...holes].map((loop) => loopModel(loop.points, hex, thin));
    groups.push({
      regionId: region.id,
      hex,
      mask,
      loops,
      holes: Math.max(holes.length, findEnclosedHoles(mask, width, height).closedHoles),
    });
  }

  const sharedCurves = canonicalizeFits(groups);
  const elements: OrganicElement[] = [];
  const shapes: string[] = [];
  for (const group of groups) {
    const svg = compound(group.loops, group.hex);
    shapes.push(svg);
    const usedPrimitive = group.loops.length === 1 && Boolean(group.loops[0]?.primitivePath);
    const fit = usedPrimitive ? null : group.loops[0]?.fit;
    const sdf = computeSignedDistanceField(group.mask, width, height);
    const samples = group.loops[0]?.samples ?? [];
    let sdfSum = 0;
    for (const point of samples) {
      const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
      const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
      sdfSum += Math.abs(sdf.values[y * width + x]);
    }
    const error = fit ? fit.error.maxPx : boundaryError(samples, [samples]).maxPx;
    elements.push({
      id: group.regionId,
      fillHex: group.hex,
      primitive: group.loops[0]?.primitivePath ? group.loops[0].primitivePath.slice(1, group.loops[0].primitivePath.indexOf(' ')) : null,
      cubicCount: (svg.match(/ C /g) ?? []).length,
      lineCount: (svg.match(/ [LHV] /g) ?? []).length,
      cornerCount: group.loops[0]?.fit?.corners.length ?? 0,
      holeCount: group.holes,
      errorMaxPx: error,
      g1BreakDeg: fit?.g1BreakDeg ?? 0,
      g2Ratio: fit?.g2Ratio ?? 0,
      meanBoundarySdfPx: samples.length ? Number((sdfSum / samples.length).toFixed(3)) : 0,
      svg,
      path: fit?.path ?? '',
    });
  }

  const shapeSvg = shapes.join('');
  const bgHex = rgbToHex(bg);
  return {
    width,
    height,
    elements,
    sharedCurves,
    shapeSvg,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${bgHex}"/>${shapeSvg}</svg>`,
  };
}
