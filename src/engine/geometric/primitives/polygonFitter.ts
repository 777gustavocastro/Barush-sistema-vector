import {
  geometricAcceptance,
  type Point2D,
} from '../contract/geometricContract';
import {
  fitInfiniteLineTLS,
  intersectLines,
  type FittedLineModel,
} from './lineFitter';
import { fmtNum, type PolygonPrimitive, type RectPrimitive } from './types';

function distToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function rdpOpen(points: Point2D[], start: number, end: number, eps: number, keep: Set<number>): void {
  if (end - start <= 1) return;
  const a = points[start];
  const b = points[end];
  let bestDist = -1;
  let bestIdx = -1;
  for (let i = start + 1; i < end; i++) {
    const d = distToSegment(points[i], a, b);
    if (d > bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestDist > eps && bestIdx >= 0) {
    keep.add(bestIdx);
    rdpOpen(points, start, bestIdx, eps, keep);
    rdpOpen(points, bestIdx, end, eps, keep);
  }
}

/**
 * Localiza índices de vértices candidatos em um contorno fechado usando o ponto mais
 * distante do centroide como âncora inicial e divisão recursiva RDP.
 */
function findCornerIndicesClosed(points: Point2D[], epsPx: number): number[] {
  const n = points.length;
  if (n < 4) return [];

  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  // Ponto mais distante do centroide (garante cair em um canto real em polígonos)
  let anchor0 = 0;
  let maxD0 = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(points[i].x - cx, points[i].y - cy);
    if (d > maxD0) {
      maxD0 = d;
      anchor0 = i;
    }
  }

  // Segundo ponto mais distante do primeiro âncora
  let anchor1 = (anchor0 + Math.floor(n / 2)) % n;
  let maxD1 = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(points[i].x - points[anchor0].x, points[i].y - points[anchor0].y);
    if (d > maxD1) {
      maxD1 = d;
      anchor1 = i;
    }
  }

  // Reordena o contorno começando em anchor0
  const rotated: Point2D[] = [];
  for (let i = 0; i < n; i++) rotated.push(points[(anchor0 + i) % n]);
  const splitPos = (anchor1 - anchor0 + n) % n;

  const keep = new Set<number>([0, splitPos]);
  rdpOpen(rotated, 0, splitPos, epsPx, keep);
  rdpOpen(rotated, splitPos, n - 1, epsPx, keep);

  const sortedRot = Array.from(keep).sort((a, b) => a - b);
  return sortedRot.map((idx) => (anchor0 + idx) % n);
}

function sliceClosed(points: Point2D[], startIdx: number, endIdx: number): Point2D[] {
  const n = points.length;
  const out: Point2D[] = [];
  let i = startIdx;
  for (let guard = 0; guard <= n; guard++) {
    out.push(points[i]);
    if (i === endIdx) break;
    i = (i + 1) % n;
  }
  return out;
}

/**
 * Ajusta um polígono exato (arestas por mínimos quadrados ortogonais + vértices por interseção
 * exata das retas adjacentes) preservando cantos reais e concavidades.
 */
export function fitPolygonPrimitive(
  points: Point2D[],
  options?: {
    maxVertices?: number;
    maxEdgeErrorPx?: number;
    meanEdgeErrorPx?: number;
    cornerTolerancePx?: number;
  }
): PolygonPrimitive | null {
  const n = points.length;
  if (n < 8) return null;

  const maxVertices = options?.maxVertices ?? 24;
  const maxEdgeErr = options?.maxEdgeErrorPx ?? geometricAcceptance.line.maxPx;
  const meanEdgeErr = options?.meanEdgeErrorPx ?? geometricAcceptance.line.meanPx;
  const cornerTol = options?.cornerTolerancePx ?? 0.85;

  // Tenta tolerâncias RDP decrescentes: começa em 1.3 para não quebrar pontas agudas antialiasadas
  // em micro-arestas, mas sempre valida cada aresta com rigor (maxCoreErr <= 0.35 px, meanErr <= 0.12 px)
  // preservando concavidades reais e vértices verdadeiros.
  for (const eps of [1.3, 0.85, 0.55, 0.35]) {
    const cornerIndices = findCornerIndicesClosed(points, eps);
    if (cornerIndices.length < 3 || cornerIndices.length > maxVertices) continue;

    // Extrai as cadeias de cada aresta e ajusta reta TLS no miolo (ignorando 1-2 px de antialiasing no canto)
    const models: FittedLineModel[] = [];
    const edgeSlices: Point2D[][] = [];
    let validModels = true;

    for (let e = 0; e < cornerIndices.length; e++) {
      const a = cornerIndices[e];
      const b = cornerIndices[(e + 1) % cornerIndices.length];
      const slice = sliceClosed(points, a, b);
      if (slice.length < 2) {
        validModels = false;
        break;
      }
      edgeSlices.push(slice);
      const trim = slice.length >= 10 ? 2 : slice.length >= 6 ? 1 : 0;
      const core = trim > 0 ? slice.slice(trim, slice.length - trim) : slice;
      const model = fitInfiniteLineTLS(core);
      if (!model) {
        validModels = false;
        break;
      }
      // Snap suave para eixo horizontal/vertical exato
      const angleDeg = (Math.atan2(model.dy, model.dx) * 180) / Math.PI;
      const mod90 = Math.abs(((angleDeg % 90) + 90) % 90);
      if (Math.min(mod90, 90 - mod90) <= 0.25) {
        if (Math.abs(model.dx) >= Math.abs(model.dy)) {
          model.dx = model.dx >= 0 ? 1 : -1;
          model.dy = 0;
        } else {
          model.dx = 0;
          model.dy = model.dy >= 0 ? 1 : -1;
        }
        model.nx = -model.dy;
        model.ny = model.dx;
      }
      models.push(model);
    }
    if (!validModels) continue;

    // Interseção exata de retas adjacentes para posicionar cada vértice
    const vertices: Point2D[] = [];
    let validVertices = true;
    for (let e = 0; e < models.length; e++) {
      const prevModel = models[(e - 1 + models.length) % models.length];
      const currModel = models[e];
      const cornerPt = points[cornerIndices[e]];
      const inter = intersectLines(prevModel, currModel);
      if (!inter || Math.hypot(inter.x - cornerPt.x, inter.y - cornerPt.y) > 2.5) {
        validVertices = false;
        break;
      }
      vertices.push(inter);
    }
    if (!validVertices) continue;

    // Rejeita "polígonos" que apenas facetam uma curva suave com muitos vértices de ângulo raso
    if (vertices.length > 6) {
      let shallowTurns = 0;
      for (let e = 0; e < vertices.length; e++) {
        const prev = vertices[(e - 1 + vertices.length) % vertices.length];
        const curr = vertices[e];
        const next = vertices[(e + 1) % vertices.length];
        const v1x = curr.x - prev.x;
        const v1y = curr.y - prev.y;
        const v2x = next.x - curr.x;
        const v2y = next.y - curr.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 < 1e-4 || l2 < 1e-4) continue;
        const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
        const turnDeg = (Math.acos(dot) * 180) / Math.PI;
        if (turnDeg < 28) shallowTurns++;
      }
      if (shallowTurns >= 3) continue;
    }

    // Avalia erro real de cada ponto do contorno contra o polígono reconstruído
    let maxCoreErr = 0;
    let maxOverallErr = 0;
    let sumErr = 0;
    let totalPts = 0;

    for (let e = 0; e < edgeSlices.length; e++) {
      const slice = edgeSlices[e];
      const v0 = vertices[e];
      const v1 = vertices[(e + 1) % vertices.length];
      for (let i = 0; i < slice.length; i++) {
        const d = distToSegment(slice[i], v0, v1);
        if (d > maxOverallErr) maxOverallErr = d;
        const nearCorner =
          Math.hypot(slice[i].x - v0.x, slice[i].y - v0.y) <= 2.2 ||
          Math.hypot(slice[i].x - v1.x, slice[i].y - v1.y) <= 2.2;
        if (!nearCorner && d > maxCoreErr) maxCoreErr = d;
        sumErr += d;
        totalPts++;
      }
    }

    const meanErr = sumErr / Math.max(1, totalPts);
    if (maxCoreErr <= maxEdgeErr && maxOverallErr <= cornerTol && meanErr <= meanEdgeErr) {
      return {
        kind: 'polygon',
        vertices,
        closed: true,
        maxErrorPx: maxOverallErr,
        meanErrorPx: meanErr,
      };
    }
  }

  return null;
}

/**
 * Classifica um polígono de 4 vértices como retângulo (alinhado aos eixos ou rotacionado)
 * quando todos os 4 ângulos internos são retos (90° ± 0.6°).
 */
export function promotePolygonToRect(poly: PolygonPrimitive): RectPrimitive | null {
  if (!poly.closed || poly.vertices.length !== 4) return null;
  const v = poly.vertices;

  const edges = [0, 1, 2, 3].map((i) => {
    const a = v[i];
    const b = v[(i + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return { dx, dy, len, ux: dx / Math.max(1e-9, len), uy: dy / Math.max(1e-9, len) };
  });

  if (edges.some((e) => e.len < 2)) return null;

  for (let i = 0; i < 4; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % 4];
    const dot = Math.abs(e0.ux * e1.ux + e0.uy * e1.uy);
    const angleFrom90Deg = (Math.asin(Math.min(1, dot)) * 180) / Math.PI;
    if (angleFrom90Deg > 0.8) return null;
  }

  const cx = 0.25 * (v[0].x + v[1].x + v[2].x + v[3].x);
  const cy = 0.25 * (v[0].y + v[1].y + v[2].y + v[3].y);

  // Verifica se é alinhado aos eixos
  const axisAligned = edges.every(
    (e) => Math.abs(e.ux) < 0.01 || Math.abs(e.uy) < 0.01
  );

  if (axisAligned) {
    const xs = v.map((p) => p.x);
    const ys = v.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      kind: 'rect',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      maxErrorPx: poly.maxErrorPx,
      meanErrorPx: poly.meanErrorPx,
    };
  }

  // Retângulo rotacionado
  let angleRad = Math.atan2(edges[0].dy, edges[0].dx);
  let width = 0.5 * (edges[0].len + edges[2].len);
  let height = 0.5 * (edges[1].len + edges[3].len);
  if (height > width) {
    const tmp = width;
    width = height;
    height = tmp;
    angleRad += Math.PI * 0.5;
  }
  while (angleRad >= Math.PI * 0.5) angleRad -= Math.PI;
  while (angleRad < -Math.PI * 0.5) angleRad += Math.PI;

  return {
    kind: 'rect',
    x: cx - width * 0.5,
    y: cy - height * 0.5,
    width,
    height,
    rotationDeg: (angleRad * 180) / Math.PI,
    maxErrorPx: poly.maxErrorPx,
    meanErrorPx: poly.meanErrorPx,
  };
}

/**
 * Detecta um retângulo alinhado aos eixos com cantos arredondados (combinação exata de 4 retas + 4 arcos)
 * otimizando (minX, minY, maxX, maxY, rx) contra a borda subpixel.
 */
export function fitRoundedRectPrimitive(points: Point2D[]): RectPrimitive | null {
  if (points.length < 24) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 12 || h < 12) return null;

  // Refina os 4 lados retos com os pontos que ficam no miolo de cada borda
  const topPts = points.filter((p) => Math.abs(p.y - minY) <= 1.2);
  const botPts = points.filter((p) => Math.abs(p.y - maxY) <= 1.2);
  const leftPts = points.filter((p) => Math.abs(p.x - minX) <= 1.2);
  const rightPts = points.filter((p) => Math.abs(p.x - maxX) <= 1.2);
  if (topPts.length < 4 || botPts.length < 4 || leftPts.length < 4 || rightPts.length < 4) {
    return null;
  }

  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const y0 = median(topPts.map((p) => p.y));
  const y1 = median(botPts.map((p) => p.y));
  const x0 = median(leftPts.map((p) => p.x));
  const x1 = median(rightPts.map((p) => p.x));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 10 || height < 10) return null;

  // Estima rx a partir da distância onde os lados retos começam a curvar
  const maxR = Math.min(width, height) * 0.5;
  const sdfRoundedRect = (p: Point2D, r: number): number => {
    const cx = 0.5 * (x0 + x1);
    const cy = 0.5 * (y0 + y1);
    const bx = width * 0.5 - r;
    const by = height * 0.5 - r;
    const qx = Math.abs(p.x - cx) - bx;
    const qy = Math.abs(p.y - cy) - by;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };

  // Busca em grade + refinamento dourado para o raio r
  let bestR = 0;
  let bestErr = Number.POSITIVE_INFINITY;
  const steps = Math.max(20, Math.min(120, Math.round(maxR * 2)));
  for (let i = 1; i <= steps; i++) {
    const r = (i / steps) * maxR;
    let sumSq = 0;
    for (const p of points) {
      const d = sdfRoundedRect(p, r);
      sumSq += d * d;
    }
    if (sumSq < bestErr) {
      bestErr = sumSq;
      bestR = r;
    }
  }

  // Refinamento fino em torno de bestR
  let lo = Math.max(1.5, bestR - maxR / steps);
  let hi = Math.min(maxR, bestR + maxR / steps);
  const phi = 0.61803398875;
  const evalR = (r: number) => {
    let s = 0;
    for (const p of points) {
      const d = sdfRoundedRect(p, r);
      s += d * d;
    }
    return s;
  };
  for (let iter = 0; iter < 20; iter++) {
    const m1 = hi - phi * (hi - lo);
    const m2 = lo + phi * (hi - lo);
    if (evalR(m1) < evalR(m2)) hi = m2;
    else lo = m1;
  }
  const r = 0.5 * (lo + hi);
  if (r < 2.0) return null; // Retângulo reto normal deve ser tratado por polygonFitter

  let maxErrorPx = 0;
  let sumErrorPx = 0;
  for (const p of points) {
    const d = Math.abs(sdfRoundedRect(p, r));
    if (d > maxErrorPx) maxErrorPx = d;
    sumErrorPx += d;
  }
  const meanErrorPx = sumErrorPx / points.length;

  if (maxErrorPx > geometricAcceptance.arc.maxPx || meanErrorPx > 0.2) {
    return null;
  }

  return {
    kind: 'rect',
    x: x0,
    y: y0,
    width,
    height,
    rx: r,
    ry: r,
    maxErrorPx,
    meanErrorPx,
  };
}

export function rectToSvgElement(
  rect: RectPrimitive,
  attrs: { fill: string; stroke?: string; strokeWidth?: number }
): string {
  const rxAttr =
    rect.rx && rect.rx > 0.05
      ? ` rx="${fmtNum(rect.rx)}" ry="${fmtNum(rect.ry ?? rect.rx)}"`
      : '';
  const strokeAttr = attrs.stroke
    ? ` stroke="${attrs.stroke}" stroke-width="${fmtNum(attrs.strokeWidth ?? 1)}"`
    : '';
  const transformAttr =
    rect.rotationDeg && Math.abs(rect.rotationDeg) > 0.05
      ? ` transform="rotate(${fmtNum(rect.rotationDeg)} ${fmtNum(rect.x + rect.width * 0.5)} ${fmtNum(rect.y + rect.height * 0.5)})"`
      : '';
  return `<rect x="${fmtNum(rect.x)}" y="${fmtNum(rect.y)}" width="${fmtNum(rect.width)}" height="${fmtNum(rect.height)}"${rxAttr} fill="${attrs.fill}"${strokeAttr}${transformAttr}/>`;
}

export function polygonToSvgElement(
  poly: PolygonPrimitive,
  attrs: { fill: string; stroke?: string; strokeWidth?: number }
): string {
  if (poly.vertices.length < 2) return '';
  const parts = [`M ${fmtNum(poly.vertices[0].x)} ${fmtNum(poly.vertices[0].y)}`];
  for (let i = 1; i < poly.vertices.length; i++) {
    parts.push(`L ${fmtNum(poly.vertices[i].x)} ${fmtNum(poly.vertices[i].y)}`);
  }
  if (poly.closed) parts.push('Z');
  const strokeAttr = attrs.stroke
    ? ` stroke="${attrs.stroke}" stroke-width="${fmtNum(attrs.strokeWidth ?? 1)}" stroke-linejoin="miter"`
    : '';
  return `<path d="${parts.join(' ')}" fill="${attrs.fill}"${strokeAttr}/>`;
}
