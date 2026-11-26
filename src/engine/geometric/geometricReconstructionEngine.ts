import type { DetectedImageCategory, RawRgbaImage } from '../types';
import { inpaintTypographyInkMask } from '../opencv/opencvSegmenter';
import { geometricAcceptance, type Point2D } from './contract/geometricContract';
import { rasterizeSimpleSvgMask } from './primitives/browserSafeMaskRasterizer';
import {
  extractSubpixelLoopsFromField,
  signedArea,
} from './primitives/subpixelBoundaryExtractor';
import { reconstructClosedContourPrimitive } from './primitives/primitiveReconstructor';
import { fmtNum, type GeometricPrimitive } from './primitives/types';
import {
  computeSignedDistanceField,
  measureMedialThickness,
  profileFromValues,
} from './structure/signedDistanceField';
import { findEnclosedHoles } from './structure/topologyCavities';
import { fitOrganicCurve } from './curves/organicFitter';
import {
  classifyAppearance,
  collectSamples,
  type AppearanceModel,
  type HighlightLayer,
} from './appearance/tonalField';

export interface GeometricEngineOptions {
  category?: DetectedImageCategory;
  typographyMask?: Uint8Array;
  typographyDefsXml?: string;
  typographyGroupsXml?: string;
  maxWorkingPixels?: number;
}

export interface GeometricEngineMetrics {
  objectCount: number;
  primitiveCount: number;
  organicCount: number;
  strokeCount: number;
  holeCount: number;
  gradientCount: number;
  maxG1BreakDeg: number;
}

export interface GeometricEngineOutput {
  svg: string;
  skipped: boolean;
  reason?: string;
  metrics: GeometricEngineMetrics;
}

interface SegmentedObject {
  id: number;
  pixels: number[];
  mask: Uint8Array;
  rgb: [number, number, number];
  isShadowLike: boolean;
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function detectBackground(image: RawRgbaImage): {
  transparent: boolean;
  rgb: [number, number, number];
  hex: string;
} {
  const { width, height, data } = image;
  let borderTotal = 0;
  let borderTransparent = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let opaqueCount = 0;

  const visit = (x: number, y: number) => {
    const i4 = (y * width + x) * 4;
    borderTotal++;
    if (data[i4 + 3] < 128) {
      borderTransparent++;
      return;
    }
    r += data[i4];
    g += data[i4 + 1];
    b += data[i4 + 2];
    opaqueCount++;
  };

  for (let x = 0; x < width; x++) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    visit(width - 1, y);
  }

  if (borderTotal > 0 && borderTransparent / borderTotal >= 0.35) {
    return { transparent: true, rgb: [255, 255, 255], hex: '#ffffff' };
  }
  const rgb: [number, number, number] =
    opaqueCount > 0
      ? [Math.round(r / opaqueCount), Math.round(g / opaqueCount), Math.round(b / opaqueCount)]
      : [255, 255, 255];
  return { transparent: false, rgb, hex: rgbToHex(rgb[0], rgb[1], rgb[2]) };
}

function colorDistIdx(data: Uint8Array, i: number, j: number): number {
  const a = i * 4;
  const b = j * 4;
  return Math.hypot(data[a] - data[b], data[a + 1] - data[b + 1], data[a + 2] - data[b + 2]);
}

function colorDistRgb(data: Uint8Array, i: number, rgb: [number, number, number]): number {
  const a = i * 4;
  return Math.hypot(data[a] - rgb[0], data[a + 1] - rgb[1], data[a + 2] - rgb[2]);
}

function interiorMaskOf(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (mask[idx] && mask[idx - 1] && mask[idx + 1] && mask[idx - width] && mask[idx + width]) {
        out[idx] = 1;
        count++;
      }
    }
  }
  return count >= 12 ? out : mask;
}

/**
 * Segmentação tonal-estrutural: mantém rampas contínuas (ouro, prata, degradês) como um único
 * objeto, enquanto separa fronteiras cromáticas nítidas (ex.: contorno preto vs miolo colorido).
 */
function segmentTonalObjects(
  image: RawRgbaImage,
  bg: { transparent: boolean; rgb: [number, number, number] }
): { labels: Int32Array; objects: SegmentedObject[]; abortedTooComplex: boolean } {
  const { width, height, data } = image;
  const n = width * height;
  const fg = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (bg.transparent) {
      if (a >= 24) fg[i] = 1;
    } else {
      if (a < 24) continue;
      const d = colorDistRgb(data, i, bg.rgb);
      if (d > 28 || a < 235) fg[i] = 1;
    }
  }

  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const rawRegions: Array<{ id: number; pixels: number[]; rgb: [number, number, number] }> = [];

  for (let start = 0; start < n; start++) {
    if (!fg[start] || labels[start] !== 0) continue;
    // Evita semear em pixels de antialiasing muito próximos do fundo se houver núcleo mais forte
    if (!bg.transparent && data[start * 4 + 3] > 235 && colorDistRgb(data, start, bg.rgb) < 42) {
      continue;
    }

    const id = rawRegions.length + 1;
    if (id > 360) {
      return { labels, objects: [], abortedTooComplex: true };
    }
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    const pixels: number[] = [];
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;

    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const i4 = idx * 4;
      rSum += data[i4];
      gSum += data[i4 + 1];
      bSum += data[i4 + 2];

      const x = idx % width;
      const y = (idx - x) / width;

      const tryPush = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const nIdx = ny * width + nx;
        if (!fg[nIdx] || labels[nIdx] !== 0) return;
        // Continuidade tonal local: aceita transições suaves de degradê sem cruzar bordas nítidas
        const step = colorDistIdx(data, idx, nIdx);
        if (step > 26) return;
        labels[nIdx] = id;
        queue[tail++] = nIdx;
      };

      tryPush(x - 1, y);
      tryPush(x + 1, y);
      tryPush(x, y - 1);
      tryPush(x, y + 1);
    }

    if (pixels.length < 4) {
      for (const p of pixels) labels[p] = 0;
      continue;
    }

    rawRegions.push({
      id,
      pixels,
      rgb: [
        Math.round(rSum / pixels.length),
        Math.round(gSum / pixels.length),
        Math.round(bSum / pixels.length),
      ],
    });
  }

  // Captura traços finos / regiões translúcidas que ficaram abaixo do limiar de semente
  for (let start = 0; start < n; start++) {
    if (!fg[start] || labels[start] !== 0) continue;
    const id = rawRegions.length + 1;
    if (id > 400) break;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    const pixels: number[] = [];
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const i4 = idx * 4;
      rSum += data[i4];
      gSum += data[i4 + 1];
      bSum += data[i4 + 2];
      const x = idx % width;
      const y = (idx - x) / width;
      const tryPush = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const nIdx = ny * width + nx;
        if (!fg[nIdx] || labels[nIdx] !== 0) return;
        if (colorDistIdx(data, idx, nIdx) > 30) return;
        labels[nIdx] = id;
        queue[tail++] = nIdx;
      };
      tryPush(x - 1, y);
      tryPush(x + 1, y);
      tryPush(x, y - 1);
      tryPush(x, y + 1);
    }
    if (pixels.length < 4) {
      for (const p of pixels) labels[p] = 0;
      continue;
    }
    rawRegions.push({
      id,
      pixels,
      rgb: [
        Math.round(rSum / pixels.length),
        Math.round(gSum / pixels.length),
        Math.round(bSum / pixels.length),
      ],
    });
  }

  // Absorve pequenos fragmentos de antialiasing (<= 40 px) na região vizinha mais próxima em cor
  const sizeById = new Map<number, number>();
  const rgbById = new Map<number, [number, number, number]>();
  for (const r of rawRegions) {
    sizeById.set(r.id, r.pixels.length);
    rgbById.set(r.id, r.rgb);
  }
  const redirect = new Map<number, number>();
  const resolveId = (id: number) => {
    let cur = id;
    while (redirect.has(cur)) cur = redirect.get(cur)!;
    return cur;
  };

  for (const r of rawRegions) {
    if (r.pixels.length > 42) continue;
    const neighborCounts = new Map<number, number>();
    for (const idx of r.pixels) {
      const x = idx % width;
      const y = (idx - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nb = resolveId(labels[ny * width + nx]);
          if (nb !== 0 && nb !== r.id) {
            neighborCounts.set(nb, (neighborCounts.get(nb) ?? 0) + 1);
          }
        }
      }
    }
    let bestNb = 0;
    let bestScore = -1;
    for (const [nb, touches] of neighborCounts) {
      const nbSize = sizeById.get(nb) ?? 0;
      if (nbSize <= r.pixels.length * 2) continue;
      const nbRgb = rgbById.get(nb);
      if (!nbRgb) continue;
      const cDist = Math.hypot(nbRgb[0] - r.rgb[0], nbRgb[1] - r.rgb[1], nbRgb[2] - r.rgb[2]);
      if (cDist > 95) continue;
      const score = touches / (1 + cDist * 0.05);
      if (score > bestScore) {
        bestScore = score;
        bestNb = nb;
      }
    }
    if (bestNb !== 0) {
      redirect.set(r.id, bestNb);
    }
  }

  const finalMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const raw = labels[i];
    if (raw === 0) continue;
    const id = resolveId(raw);
    labels[i] = id;
    const list = finalMap.get(id);
    if (list) list.push(i);
    else finalMap.set(id, [i]);
  }

  const objects: SegmentedObject[] = [];
  for (const [id, pixels] of finalMap) {
    if (pixels.length < 4) continue;
    const mask = new Uint8Array(n);
    for (const p of pixels) mask[p] = 1;
    const inner = interiorMaskOf(mask, width, height);
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    for (const p of pixels) {
      if (!inner[p]) continue;
      const i4 = p * 4;
      rSum += data[i4];
      gSum += data[i4 + 1];
      bSum += data[i4 + 2];
      count++;
    }
    if (count === 0) {
      for (const p of pixels) {
        const i4 = p * 4;
        rSum += data[i4];
        gSum += data[i4 + 1];
        bSum += data[i4 + 2];
      }
      count = pixels.length;
    }
    const rgb: [number, number, number] = [
      Math.round(rSum / count),
      Math.round(gSum / count),
      Math.round(bSum / count),
    ];
    const chroma = Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
    const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const isShadowLike = !bg.transparent && chroma < 12 && lum > 110 && lum < 230;
    objects.push({ id, pixels, mask, rgb, isShadowLike });
  }

  // Ordena: sombras atrás, regiões maiores atrás de detalhes internos menores
  objects.sort((a, b) => {
    if (a.isShadowLike !== b.isShadowLike) return a.isShadowLike ? -1 : 1;
    return b.pixels.length - a.pixels.length;
  });

  return { labels, objects, abortedTooComplex: false };
}

function primitiveToSubpath(p: GeometricPrimitive, positive: boolean): string {
  switch (p.kind) {
    case 'circle': {
      const sweep = positive ? 0 : 1;
      return `M ${fmtNum(p.cx - p.r)} ${fmtNum(p.cy)} A ${fmtNum(p.r)} ${fmtNum(p.r)} 0 1 ${sweep} ${fmtNum(p.cx + p.r)} ${fmtNum(p.cy)} A ${fmtNum(p.r)} ${fmtNum(p.r)} 0 1 ${sweep} ${fmtNum(p.cx - p.r)} ${fmtNum(p.cy)} Z`;
    }
    case 'ellipse': {
      const sweep = positive ? 0 : 1;
      return `M ${fmtNum(p.cx - p.rx)} ${fmtNum(p.cy)} A ${fmtNum(p.rx)} ${fmtNum(p.ry)} ${fmtNum(p.rotationDeg)} 1 ${sweep} ${fmtNum(p.cx + p.rx)} ${fmtNum(p.cy)} A ${fmtNum(p.rx)} ${fmtNum(p.ry)} ${fmtNum(p.rotationDeg)} 1 ${sweep} ${fmtNum(p.cx - p.rx)} ${fmtNum(p.cy)} Z`;
    }
    case 'rect': {
      const { x, y, width, height } = p;
      const rx = p.rx ?? 0;
      const ry = p.ry ?? rx;
      if (rx > 0.05) {
        const x1 = x + width;
        const y1 = y + height;
        if (positive) {
          return `M ${fmtNum(x + rx)} ${fmtNum(y)} H ${fmtNum(x1 - rx)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 1 ${fmtNum(x1)} ${fmtNum(y + ry)} V ${fmtNum(y1 - ry)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 1 ${fmtNum(x1 - rx)} ${fmtNum(y1)} H ${fmtNum(x + rx)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 1 ${fmtNum(x)} ${fmtNum(y1 - ry)} V ${fmtNum(y + ry)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 1 ${fmtNum(x + rx)} ${fmtNum(y)} Z`;
        }
        return `M ${fmtNum(x + rx)} ${fmtNum(y)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 0 ${fmtNum(x)} ${fmtNum(y + ry)} V ${fmtNum(y1 - ry)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 0 ${fmtNum(x + rx)} ${fmtNum(y1)} H ${fmtNum(x1 - rx)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 0 ${fmtNum(x1)} ${fmtNum(y1 - ry)} V ${fmtNum(y + ry)} A ${fmtNum(rx)} ${fmtNum(ry)} 0 0 0 ${fmtNum(x1 - rx)} ${fmtNum(y)} Z`;
      }
      return positive
        ? `M ${fmtNum(x)} ${fmtNum(y)} H ${fmtNum(x + width)} V ${fmtNum(y + height)} H ${fmtNum(x)} Z`
        : `M ${fmtNum(x)} ${fmtNum(y)} V ${fmtNum(y + height)} H ${fmtNum(x + width)} V ${fmtNum(y)} Z`;
    }
    case 'polygon': {
      let verts = p.vertices;
      const area = signedArea(verts);
      if ((positive && area < 0) || (!positive && area > 0)) verts = [...verts].reverse();
      return `M ${fmtNum(verts[0].x)} ${fmtNum(verts[0].y)} ${verts.slice(1).map((v) => `L ${fmtNum(v.x)} ${fmtNum(v.y)}`).join(' ')} Z`;
    }
    case 'composite': {
      const segs = p.segments;
      if (segs.length === 0) return '';
      if (positive) {
        const parts = [`M ${fmtNum(segs[0].x1)} ${fmtNum(segs[0].y1)}`];
        for (const s of segs) {
          if (s.kind === 'line') parts.push(`L ${fmtNum(s.x2)} ${fmtNum(s.y2)}`);
          else {
            parts.push(
              `A ${fmtNum(s.rx)} ${fmtNum(s.ry)} ${fmtNum(s.rotationDeg)} ${s.largeArc} ${s.sweep} ${fmtNum(s.x2)} ${fmtNum(s.y2)}`
            );
          }
        }
        return `${parts.join(' ')} Z`;
      }
      const rev = [...segs].reverse();
      const parts = [`M ${fmtNum(rev[0].x2)} ${fmtNum(rev[0].y2)}`];
      for (const s of rev) {
        if (s.kind === 'line') parts.push(`L ${fmtNum(s.x1)} ${fmtNum(s.y1)}`);
        else {
          const sw = s.sweep === 1 ? 0 : 1;
          parts.push(
            `A ${fmtNum(s.rx)} ${fmtNum(s.ry)} ${fmtNum(s.rotationDeg)} ${s.largeArc} ${sw} ${fmtNum(s.x1)} ${fmtNum(s.y1)}`
          );
        }
      }
      return `${parts.join(' ')} Z`;
    }
    default:
      return '';
  }
}

function buildAppearanceDefs(
  id: string,
  appearance: AppearanceModel,
  highlight: HighlightLayer | null
): { defs: string; fillAttr: string } {
  const parts: string[] = [];
  let fillAttr = appearance.kind === 'solid' ? appearance.color : `url(#${id})`;

  if (appearance.kind === 'linear') {
    const x1 = Number.isFinite(appearance.x1) ? appearance.x1 : 0;
    const y1 = Number.isFinite(appearance.y1) ? appearance.y1 : 0;
    let x2 = Number.isFinite(appearance.x2) ? appearance.x2 : x1 + 1;
    let y2 = Number.isFinite(appearance.y2) ? appearance.y2 : y1;
    if (Math.hypot(x2 - x1, y2 - y1) < 0.5) x2 = x1 + 1;
    const stops = appearance.stops
      .map((s) => `<stop offset="${fmtNum(s.offset * 100)}%" stop-color="${s.color}"/>`)
      .join('');
    parts.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmtNum(x1)}" y1="${fmtNum(y1)}" x2="${fmtNum(x2)}" y2="${fmtNum(y2)}">${stops}</linearGradient>`
    );
  } else if (appearance.kind === 'radial') {
    const cx = Number.isFinite(appearance.cx) ? appearance.cx : 0;
    const cy = Number.isFinite(appearance.cy) ? appearance.cy : 0;
    const r = Number.isFinite(appearance.r) && appearance.r > 0.5 ? appearance.r : 1;
    const stops = appearance.stops
      .map((s) => `<stop offset="${fmtNum(s.offset * 100)}%" stop-color="${s.color}"/>`)
      .join('');
    parts.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmtNum(cx)}" cy="${fmtNum(cy)}" r="${fmtNum(r)}">${stops}</radialGradient>`
    );
  }

  if (highlight && Number.isFinite(highlight.cx) && Number.isFinite(highlight.cy) && Number.isFinite(highlight.r) && highlight.r >= 1) {
    parts.push(
      `<radialGradient id="${id}-brilho" gradientUnits="userSpaceOnUse" cx="${fmtNum(highlight.cx)}" cy="${fmtNum(highlight.cy)}" r="${fmtNum(highlight.r)}"><stop offset="0%" stop-color="#ffffff" stop-opacity="${fmtNum(highlight.opacity)}"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`
    );
  }

  return { defs: parts.join(''), fillAttr };
}

function renderCoverage(svgEl: string, mask: Uint8Array, width: number, height: number): {
  iou: number;
  recall: number;
} {
  const candMask = rasterizeSimpleSvgMask(svgEl, width, height);
  let inter = 0;
  let union = 0;
  let ref = 0;
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i] === 1;
    const b = candMask[i] === 1;
    if (a) ref++;
    if (a || b) union++;
    if (a && b) inter++;
  }
  return { iou: union ? inter / union : 1, recall: ref ? inter / ref : 1 };
}

function tryTrueStroke(
  outer: GeometricPrimitive | null,
  holes: Array<GeometricPrimitive | null>,
  hex: string,
  mask: Uint8Array,
  width: number,
  height: number
): string | null {
  if (!outer || holes.length > 1) return null;

  const candidates: string[] = [];
  if (outer.kind === 'circle' && holes.length === 1 && holes[0]?.kind === 'circle') {
    const h = holes[0];
    const sw = outer.r - h.r;
    if (sw > 0.8 && Math.hypot(outer.cx - h.cx, outer.cy - h.cy) <= 0.6) {
      candidates.push(
        `<circle cx="${fmtNum((outer.cx + h.cx) * 0.5)}" cy="${fmtNum((outer.cy + h.cy) * 0.5)}" r="${fmtNum((outer.r + h.r) * 0.5)}" fill="none" stroke="${hex}" stroke-width="${fmtNum(sw)}"/>`
      );
    }
  } else if (
    outer.kind === 'rect' &&
    !outer.rx &&
    !outer.rotationDeg &&
    holes.length === 1 &&
    holes[0]?.kind === 'rect' &&
    !holes[0].rx &&
    !holes[0].rotationDeg
  ) {
    const h = holes[0];
    const sides = [
      h.x - outer.x,
      outer.x + outer.width - (h.x + h.width),
      h.y - outer.y,
      outer.y + outer.height - (h.y + h.height),
    ];
    const prof = profileFromValues(sides);
    if (prof.withinContract && prof.medianPx >= 0.8) {
      const sw = prof.medianPx;
      candidates.push(
        `<rect x="${fmtNum(outer.x + sw * 0.5)}" y="${fmtNum(outer.y + sw * 0.5)}" width="${fmtNum(outer.width - sw)}" height="${fmtNum(outer.height - sw)}" fill="none" stroke="${hex}" stroke-width="${fmtNum(sw)}" stroke-linejoin="miter"/>`
      );
    }
  } else if (outer.kind === 'rect' && !outer.rx && !outer.rotationDeg && holes.length === 0) {
    const shortSide = Math.min(outer.width, outer.height);
    const longSide = Math.max(outer.width, outer.height);
    if (shortSide >= 0.8 && longSide >= shortSide * 4) {
      const horiz = outer.width >= outer.height;
      const x1 = horiz ? outer.x : outer.x + outer.width * 0.5;
      const x2 = horiz ? outer.x + outer.width : outer.x + outer.width * 0.5;
      const y1 = horiz ? outer.y + outer.height * 0.5 : outer.y;
      const y2 = horiz ? outer.y + outer.height * 0.5 : outer.y + outer.height;
      candidates.push(
        `<line x1="${fmtNum(x1)}" y1="${fmtNum(y1)}" x2="${fmtNum(x2)}" y2="${fmtNum(y2)}" stroke="${hex}" stroke-width="${fmtNum(shortSide)}" stroke-linecap="butt"/>`
      );
    }
  }

  for (const cand of candidates) {
    const cov = renderCoverage(cand, mask, width, height);
    if (cov.iou >= geometricAcceptance.coverage.iouSolid && cov.recall >= geometricAcceptance.coverage.recallDetail) {
      return cand;
    }
  }
  return null;
}

/**
 * Motor unificado do Geometric Reconstruction Engine (Etapas 1–5):
 * - Respeita áreas reservadas à tipografia (não modifica typographyProcessor.ts).
 * - Reconstrói primitivas exatas (Etapa 2), estrutura/furos/traços (Etapa 3),
 *   curvas Bézier orgânicas G1/G2 (Etapa 4) e aparência/gradientes/brilhos (Etapa 5).
 * - Zero raster embutido no SVG.
 */
export function reconstructWithGeometricEngine(
  sourceImage: RawRgbaImage,
  options?: GeometricEngineOptions
): GeometricEngineOutput {
  const emptyMetrics: GeometricEngineMetrics = {
    objectCount: 0,
    primitiveCount: 0,
    organicCount: 0,
    strokeCount: 0,
    holeCount: 0,
    gradientCount: 0,
    maxG1BreakDeg: 0,
  };

  const maxPixels = options?.maxWorkingPixels ?? 1_200_000;
  if (sourceImage.width * sourceImage.height > maxPixels) {
    return {
      svg: '',
      skipped: true,
      reason: `Imagem excede orçamento do motor geométrico (${sourceImage.width}×${sourceImage.height} > ${maxPixels} px).`,
      metrics: emptyMetrics,
    };
  }

  if (options?.category === 'photograph') {
    return {
      svg: '',
      skipped: true,
      reason: 'Categoria fotografia contínua mantida no pipeline anterior (fora do domínio de reconstrução geométrica exata).',
      metrics: emptyMetrics,
    };
  }

  const workingImage =
    options?.typographyMask && options.typographyMask.length === sourceImage.width * sourceImage.height
      ? inpaintTypographyInkMask(sourceImage, options.typographyMask)
      : sourceImage;

  const { width, height } = workingImage;
  const bg = detectBackground(workingImage);
  const seg = segmentTonalObjects(workingImage, bg);

  if (seg.abortedTooComplex || seg.objects.length === 0) {
    return {
      svg: '',
      skipped: true,
      reason: seg.abortedTooComplex
        ? 'Cena com excesso de micro-regiões estocásticas (mantida para candidatos complementares).'
        : 'Nenhuma região vetorial de foreground detectada.',
      metrics: emptyMetrics,
    };
  }

  const defsParts: string[] = [];
  const bodyParts: string[] = [];
  if (!bg.transparent) {
    bodyParts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${bg.hex}"/>`);
  }

  let primitiveCount = 0;
  let organicCount = 0;
  let strokeCount = 0;
  let holeCount = 0;
  let gradientCount = 0;
  let maxG1BreakDeg = 0;
  let objIndex = 0;

  for (const obj of seg.objects) {
    // Recorta para a bounding box do objeto (+2 px de margem) para extração subpixel e SDF rápidos
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (const idx of obj.pixels) {
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const bx0 = Math.max(0, minX - 2);
    const by0 = Math.max(0, minY - 2);
    const bx1 = Math.min(width - 1, maxX + 2);
    const by1 = Math.min(height - 1, maxY + 2);
    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    if (bw < 2 || bh < 2) continue;

    const localField = new Float32Array(bw * bh);
    const drBg = obj.rgb[0] - bg.rgb[0];
    const dgBg = obj.rgb[1] - bg.rgb[1];
    const dbBg = obj.rgb[2] - bg.rgb[2];
    const denomBg = drBg * drBg + dgBg * dgBg + dbBg * dbBg;
    const sampleCov = (fullIdx: number): number => {
      const i4 = fullIdx * 4;
      const a = workingImage.data[i4 + 3] / 255;
      if (bg.transparent) return a;
      if (a <= 0.01 || denomBg < 1) return 0;
      const proj =
        ((workingImage.data[i4] - bg.rgb[0]) * drBg +
          (workingImage.data[i4 + 1] - bg.rgb[1]) * dgBg +
          (workingImage.data[i4 + 2] - bg.rgb[2]) * dbBg) /
        denomBg;
      return Math.max(0, Math.min(1, proj * a));
    };

    const localMask = new Uint8Array(bw * bh);
    for (const idx of obj.pixels) {
      const x = idx % width;
      const y = (idx - x) / width;
      const lx = x - bx0;
      const ly = y - by0;
      localMask[ly * bw + lx] = 1;
      localField[ly * bw + lx] = Math.max(0.55, sampleCov(idx));
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < by0 || ny > by1) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < bx0 || nx > bx1) continue;
          const nIdx = ny * width + nx;
          const nbLabel = seg.labels[nIdx];
          if (nbLabel === 0 || nbLabel === obj.id) {
            const lIdx = (ny - by0) * bw + (nx - bx0);
            localField[lIdx] = Math.max(localField[lIdx], sampleCov(nIdx));
          }
        }
      }
    }

    const extractedRaw = extractSubpixelLoopsFromField(localField, bw, bh, 0.5).sort(
      (a, b) => b.areaPx - a.areaPx
    );
    const extracted = extractedRaw.map((loop) => ({
      ...loop,
      points: loop.points.map((p) => ({ x: p.x + bx0, y: p.y + by0 })),
    }));
    const outerLoop = extracted[0];
    if (!outerLoop || outerLoop.areaPx < 3) continue;

    const enclosedLocal = findEnclosedHoles(localMask, bw, bh);
    const holeLoops = extracted.filter(
      (loop) => loop !== outerLoop && loop.isHole && loop.areaPx >= 4 && loop.areaPx < outerLoop.areaPx * 0.9
    );
    holeCount += Math.max(holeLoops.length, enclosedLocal.closedHoles);

    const innerSamples = collectSamples(
      workingImage,
      interiorMaskOf(obj.mask, width, height),
      Math.max(1, Math.floor(obj.pixels.length / 2200))
    );
    const { appearance, highlight } = classifyAppearance(innerSamples);

    objIndex++;
    const gradId = `geo-ap-${objIndex}`;
    const { defs, fillAttr } = buildAppearanceDefs(gradId, appearance, highlight);
    if (defs) defsParts.push(defs);
    if (appearance.kind !== 'solid') gradientCount++;

    const outerRefMask = new Uint8Array(obj.mask);
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        if (enclosedLocal.holeMask[ly * bw + lx]) {
          outerRefMask[(ly + by0) * width + (lx + bx0)] = 1;
        }
      }
    }

    const outerPrimRes = reconstructClosedContourPrimitive(
      outerLoop.points,
      '#000000',
      holeLoops.length === 0 ? { width, height, referenceMask: outerRefMask } : undefined
    );
    const outerPrim = outerPrimRes.accepted ? outerPrimRes.primitive : null;
    const holePrims = holeLoops.map((h) => {
      const r = reconstructClosedContourPrimitive(h.points, '#000000');
      return r.accepted ? r.primitive : null;
    });

    const opacityAttr = appearance.opacity < 0.985 ? ` opacity="${fmtNum(appearance.opacity)}"` : '';
    let mainElement = '';

    // Traço verdadeiro só quando sólido, constante e geometricamente equivalente
    if (appearance.kind === 'solid' && !highlight && !obj.isShadowLike) {
      const strokeEl = tryTrueStroke(outerPrim, holePrims, appearance.color, obj.mask, width, height);
      if (strokeEl) {
        mainElement = opacityAttr ? strokeEl.replace(/\/>$/, `${opacityAttr}/>`) : strokeEl;
        strokeCount++;
        primitiveCount++;
      }
    }

    if (!mainElement) {
      if (holeLoops.length === 0 && outerPrim && outerPrimRes.svgElement) {
        primitiveCount++;
        const paintedPrim = outerPrimRes.svgElement.replace(/\sfill="[^"]*"/, ` fill="${fillAttr}"`);
        mainElement = opacityAttr
          ? paintedPrim.replace(/\/>$/, `${opacityAttr}/>`)
          : paintedPrim;
      } else {
        const sdf = computeSignedDistanceField(localMask, bw, bh);
        const thickness = measureMedialThickness(sdf, localMask);
        const thin = thickness.medianPx > 0 && thickness.medianPx <= 12;
        const curveLimits = thin
          ? { maxPx: 0.32, meanPx: 0.12, hausdorffPx: 0.42 }
          : {
              maxPx: geometricAcceptance.organic.maxPx,
              meanPx: geometricAcceptance.organic.meanPx,
              hausdorffPx: geometricAcceptance.organic.hausdorffPx,
            };

        const subpaths: string[] = [];
        if (outerPrim) {
          primitiveCount++;
          subpaths.push(primitiveToSubpath(outerPrim, true));
        } else {
          organicCount++;
          const fit = fitOrganicCurve(outerLoop.points, { closed: true, limits: curveLimits });
          maxG1BreakDeg = Math.max(maxG1BreakDeg, fit.g1BreakDeg);
          if (fit.path) subpaths.push(fit.path);
        }

        holeLoops.forEach((hLoop, idx) => {
          const hp = holePrims[idx];
          if (hp) {
            subpaths.push(primitiveToSubpath(hp, false));
          } else {
            const fit = fitOrganicCurve(hLoop.points, { closed: true, limits: curveLimits });
            maxG1BreakDeg = Math.max(maxG1BreakDeg, fit.g1BreakDeg);
            if (fit.path) subpaths.push(fit.path);
          }
        });

        const d = subpaths.filter(Boolean).join(' ');
        if (!d) continue;
        mainElement = `<path d="${d}" fill="${fillAttr}" fill-rule="evenodd"${opacityAttr}/>`;
      }
    }

    let highlightLayer = '';
    if (highlight) {
      highlightLayer = mainElement.replace(/\sfill="[^"]*"/, ` fill="url(#${gradId}-brilho)"`);
    }

    bodyParts.push(`<g id="objeto-${objIndex}">${mainElement}${highlightLayer}</g>`);
  }

  if (options?.typographyDefsXml) defsParts.push(options.typographyDefsXml);
  if (options?.typographyGroupsXml) bodyParts.push(options.typographyGroupsXml);

  const defsXml = defsParts.length > 0 ? `<defs>${defsParts.join('')}</defs>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsXml}${bodyParts.join('')}</svg>`;

  return {
    svg,
    skipped: false,
    metrics: {
      objectCount: objIndex,
      primitiveCount,
      organicCount,
      strokeCount,
      holeCount,
      gradientCount,
      maxG1BreakDeg: Number(maxG1BreakDeg.toFixed(2)),
    },
  };
}

export type { Point2D };
