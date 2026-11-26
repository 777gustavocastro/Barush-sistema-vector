import type { RawRgbaImage } from '../../types';

export interface TonalSample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
  luminance: number;
}

export type AppearanceKind = 'solid' | 'linear' | 'radial';

export interface SolidAppearance {
  kind: 'solid';
  color: string;
  opacity: number;
}

export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

export interface LinearAppearance {
  kind: 'linear';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
  opacity: number;
}

export interface RadialAppearance {
  kind: 'radial';
  cx: number;
  cy: number;
  r: number;
  stops: GradientStop[];
  opacity: number;
}

export type AppearanceModel = SolidAppearance | LinearAppearance | RadialAppearance;

export interface HighlightLayer {
  cx: number;
  cy: number;
  r: number;
  opacity: number;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function collectSamples(image: RawRgbaImage, mask: Uint8Array, stride = 1): TonalSample[] {
  const samples: TonalSample[] = [];
  const { width, data } = image;
  for (let i = 0; i < mask.length; i += stride) {
    if (!mask[i] || data[i * 4 + 3] < 8) continue;
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    samples.push({
      x: i % width,
      y: Math.floor(i / width),
      r,
      g,
      b,
      a: data[i * 4 + 3],
      luminance: luminance(r, g, b),
    });
  }
  return samples;
}

function hex(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function meanColor(samples: TonalSample[]): { r: number; g: number; b: number; a: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const sample of samples) {
    r += sample.r;
    g += sample.g;
    b += sample.b;
    a += sample.a;
  }
  const n = samples.length || 1;
  return { r: r / n, g: g / n, b: b / n, a: a / n };
}

function fitPlane(samples: TonalSample[]): { a: number; b: number; c: number; residual: number } {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sx = 0;
  let sy = 0;
  let sl = 0;
  let sxl = 0;
  let syl = 0;
  const n = samples.length;
  for (const sample of samples) {
    sxx += sample.x * sample.x;
    syy += sample.y * sample.y;
    sxy += sample.x * sample.y;
    sx += sample.x;
    sy += sample.y;
    sl += sample.luminance;
    sxl += sample.x * sample.luminance;
    syl += sample.y * sample.luminance;
  }
  const matrix = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const vector = [sxl, syl, sl];
  const solved = solve3(matrix, vector) ?? [0, 0, sl / n];
  let residual = 0;
  for (const sample of samples) {
    const predicted = solved[0] * sample.x + solved[1] * sample.y + solved[2];
    residual += (sample.luminance - predicted) ** 2;
  }
  return { a: solved[0], b: solved[1], c: solved[2], residual: Math.sqrt(residual / n) };
}

function solve3(matrix: number[][], vector: number[]): number[] | null {
  const m = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-8) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let k = col; k < 4; k++) m[col][k] /= div;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let k = col; k < 4; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

function stopsAlong(samples: TonalSample[], project: (sample: TonalSample) => number): GradientStop[] {
  const projected = samples.map((sample) => ({ sample, t: project(sample) }));
  const min = Math.min(...projected.map((item) => item.t));
  const max = Math.max(...projected.map((item) => item.t));
  const span = max - min || 1;
  const bins = 6;
  const groups: TonalSample[][] = Array.from({ length: bins }, () => []);
  for (const item of projected) {
    const index = Math.min(bins - 1, Math.floor(((item.t - min) / span) * bins));
    groups[index].push(item.sample);
  }
  const stops: GradientStop[] = [];
  groups.forEach((group, index) => {
    if (group.length === 0) return;
    const color = meanColor(group);
    stops.push({ offset: index / (bins - 1), color: hex(color.r, color.g, color.b), opacity: 1 });
  });
  return stops.filter((stop, index) => index === 0 || stop.color !== stops[index - 1].color);
}

/**
 * Classifica a pintura interna de uma silhueta.
 * Uma rampa contínua vira um gradiente editável. Um brilho compacto não muda o tipo da base.
 */
export function classifyAppearance(samples: TonalSample[]): { appearance: AppearanceModel; highlight: HighlightLayer | null } {
  const color = meanColor(samples);
  const opacity = Math.max(0.04, Math.min(1, color.a / 255));
  if (samples.length < 12) {
    return { appearance: { kind: 'solid', color: hex(color.r, color.g, color.b), opacity }, highlight: null };
  }
  let mean = 0;
  for (const sample of samples) mean += sample.luminance;
  mean /= samples.length;
  let variance = 0;
  for (const sample of samples) variance += (sample.luminance - mean) ** 2;
  const std = Math.sqrt(variance / samples.length);
  const plane = fitPlane(samples);
  const highlightSamples =
    plane.residual > 14
      ? samples.filter((sample) => sample.luminance > mean + Math.max(32, std * 1.6))
      : [];
  const highlight =
    highlightSamples.length > 8 && highlightSamples.length < samples.length * 0.2
      ? compactHighlight(highlightSamples)
      : null;
  const base = highlight ? samples.filter((sample) => sample.luminance <= mean + Math.max(28, std * 1.4)) : samples;
  const basePlane = highlight ? fitPlane(base) : plane;
  const baseStd = stdOf(base);

  if (baseStd < 10 && basePlane.residual < 8) {
    const baseColor = meanColor(base);
    return { appearance: { kind: 'solid', color: hex(baseColor.r, baseColor.g, baseColor.b), opacity }, highlight };
  }

  const radial = fitRadial(base);
  if (radial.residual + 2 < basePlane.residual) {
    return {
      appearance: {
        kind: 'radial',
        cx: radial.cx,
        cy: radial.cy,
        r: radial.radius,
        stops: stopsAlong(base, (sample) => Math.hypot(sample.x - radial.cx, sample.y - radial.cy)),
        opacity,
      },
      highlight,
    };
  }

  const direction = Math.hypot(basePlane.a, basePlane.b) || 1;
  let minT = Infinity;
  let maxT = -Infinity;
  let minPoint = base[0];
  let maxPoint = base[0];
  for (const sample of base) {
    const t = sample.x * basePlane.a + sample.y * basePlane.b;
    if (t < minT) {
      minT = t;
      minPoint = sample;
    }
    if (t > maxT) {
      maxT = t;
      maxPoint = sample;
    }
  }
  return {
    appearance: {
      kind: 'linear',
      x1: minPoint.x,
      y1: minPoint.y,
      x2: maxPoint.x,
      y2: maxPoint.y,
      stops: stopsAlong(base, (sample) => (sample.x * basePlane.a + sample.y * basePlane.b) / direction),
      opacity,
    },
    highlight,
  };
}

function stdOf(samples: TonalSample[]): number {
  let mean = 0;
  for (const sample of samples) mean += sample.luminance;
  mean /= samples.length || 1;
  let variance = 0;
  for (const sample of samples) variance += (sample.luminance - mean) ** 2;
  return Math.sqrt(variance / (samples.length || 1));
}

function fitRadial(samples: TonalSample[]): { cx: number; cy: number; radius: number; residual: number } {
  const ranked = [...samples].sort((a, b) => b.luminance - a.luminance);
  const core = ranked.slice(0, Math.max(8, Math.floor(samples.length * 0.12)));
  let cx = 0;
  let cy = 0;
  for (const sample of core) {
    cx += sample.x;
    cy += sample.y;
  }
  cx /= core.length;
  cy /= core.length;
  const distance = samples.map((sample) => Math.hypot(sample.x - cx, sample.y - cy));
  let sxx = 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  for (let i = 0; i < samples.length; i++) {
    sxx += distance[i] * distance[i];
    sx += distance[i];
    sy += samples[i].luminance;
    sxy += distance[i] * samples[i].luminance;
  }
  const n = samples.length;
  const det = sxx * n - sx * sx;
  const slope = det ? (sxy * n - sx * sy) / det : 0;
  const intercept = det ? (sxx * sy - sx * sxy) / det : sy / n;
  let residual = 0;
  for (let i = 0; i < samples.length; i++) residual += (samples[i].luminance - (intercept + slope * distance[i])) ** 2;
  return {
    cx,
    cy,
    radius: Math.max(1, Math.max(...distance)),
    residual: Math.sqrt(residual / n),
  };
}

function compactHighlight(samples: TonalSample[]): HighlightLayer | null {
  let cx = 0;
  let cy = 0;
  for (const sample of samples) {
    cx += sample.x;
    cy += sample.y;
  }
  cx /= samples.length;
  cy /= samples.length;
  let radius = 0;
  for (const sample of samples) radius = Math.max(radius, Math.hypot(sample.x - cx, sample.y - cy));
  const xs = samples.map((sample) => sample.x);
  const ys = samples.map((sample) => sample.y);
  const area = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
  const objectSpan = radius * radius * 4;
  if (area > objectSpan * 1.4) return null;
  return { cx, cy, r: Math.max(2, radius), opacity: 0.72 };
}
