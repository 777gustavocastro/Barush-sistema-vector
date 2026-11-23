import type { RawRgbaImage } from '../types';
import { computeExactEuclideanDistanceTransform } from '../stage2/stage2Diagnostics';
import { fmtSvgNum, type Point2D } from './adaptiveBezierFitter';

export type ParsedPathCmd =
  | { kind: 'M'; x: number; y: number }
  | { kind: 'L'; x: number; y: number }
  | { kind: 'Q'; x1: number; y1: number; x: number; y: number }
  | { kind: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { kind: 'Z' };

export interface ParsedSubpath {
  start: Point2D;
  commands: Exclude<ParsedPathCmd, { kind: 'M' }>[];
  closed: boolean;
}

export interface ContourIrregularitySummary {
  inspectedPathCount: number;
  duplicatePathsRemoved: number;
  microSegmentsRemoved: number;
  collinearMergedCount: number;
  artificialSpikesTrimmed: number;
  selfIntersectionsRepaired: number;
  unclosedLoopsFixed: number;
  strokesCalibrated: number;
  nonScalingStrokesStripped: number;
}

export interface ContourThicknessSpot {
  x: number;
  y: number;
  origThicknessPx: number;
  vecThicknessPx: number;
  kind: 'too_thin' | 'too_thick';
  regionId?: number;
}

export interface ContourThicknessReport {
  measuredRidgeSamples: number;
  meanOrigThicknessPx: number;
  meanVecThicknessPx: number;
  meanAbsThicknessErrorPx: number;
  thicknessConsistencyPct: number;
  pinchedCount: number;
  bloatedCount: number;
  anomalousSpots: ContourThicknessSpot[];
  /** Correção normal sugerida (em px) por ID de região de contorno fino/médio. */
  regionBiasCorrectionsPx: Map<number, number>;
}

/**
 * Analisa qualquer string `d` de `<path>` SVG (`M/m, L/l, H/h, V/v, Q/q, C/c, S/s, T/t, Z/z`)
 * convertendo comandos relativos e atalhos suaves (`S`, `T`) em segmentos explícitos absolutos.
 */
export function parseSvgPathToSubpaths(
  dAttr: string,
  translateX = 0,
  translateY = 0
): ParsedSubpath[] {
  const tokens = dAttr.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return [];

  const isCmd = (t: string) => /^[a-zA-Z]$/.test(t);
  const subpaths: ParsedSubpath[] = [];
  let current: ParsedSubpath | null = null;

  let i = 0;
  let cmd = '';
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let prevCmd = '';

  const ensureCurrent = (sx: number, sy: number) => {
    if (!current) {
      current = {
        start: { x: sx + translateX, y: sy + translateY },
        commands: [],
        closed: false,
      };
      subpaths.push(current);
    }
  };

  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i++];
    }
    if (!cmd) break;

    switch (cmd) {
      case 'M':
      case 'm': {
        const rel = cmd === 'm';
        let first = true;
        while (i + 1 < tokens.length && !isCmd(tokens[i])) {
          const nx = Number(tokens[i++]);
          const ny = Number(tokens[i++]);
          curX = rel ? curX + nx : nx;
          curY = rel ? curY + ny : ny;
          if (first) {
            startX = curX;
            startY = curY;
            current = {
              start: { x: curX + translateX, y: curY + translateY },
              commands: [],
              closed: false,
            };
            subpaths.push(current);
            first = false;
          } else {
            ensureCurrent(startX, startY);
            current!.commands.push({
              kind: 'L',
              x: curX + translateX,
              y: curY + translateY,
            });
          }
          lastCtrlX = curX;
          lastCtrlY = curY;
          prevCmd = first ? 'M' : 'L';
        }
        break;
      }
      case 'L':
      case 'l': {
        const rel = cmd === 'l';
        while (i + 1 < tokens.length && !isCmd(tokens[i])) {
          const nx = Number(tokens[i++]);
          const ny = Number(tokens[i++]);
          curX = rel ? curX + nx : nx;
          curY = rel ? curY + ny : ny;
          ensureCurrent(curX, curY);
          current!.commands.push({
            kind: 'L',
            x: curX + translateX,
            y: curY + translateY,
          });
          lastCtrlX = curX;
          lastCtrlY = curY;
          prevCmd = 'L';
        }
        break;
      }
      case 'H':
      case 'h': {
        const rel = cmd === 'h';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const nx = Number(tokens[i++]);
          curX = rel ? curX + nx : nx;
          ensureCurrent(curX, curY);
          current!.commands.push({
            kind: 'L',
            x: curX + translateX,
            y: curY + translateY,
          });
          lastCtrlX = curX;
          lastCtrlY = curY;
          prevCmd = 'L';
        }
        break;
      }
      case 'V':
      case 'v': {
        const rel = cmd === 'v';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const ny = Number(tokens[i++]);
          curY = rel ? curY + ny : ny;
          ensureCurrent(curX, curY);
          current!.commands.push({
            kind: 'L',
            x: curX + translateX,
            y: curY + translateY,
          });
          lastCtrlX = curX;
          lastCtrlY = curY;
          prevCmd = 'L';
        }
        break;
      }
      case 'Q':
      case 'q': {
        const rel = cmd === 'q';
        while (i + 3 < tokens.length && !isCmd(tokens[i])) {
          const x1 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y1 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          ensureCurrent(curX, curY);
          current!.commands.push({
            kind: 'Q',
            x1: x1 + translateX,
            y1: y1 + translateY,
            x: x + translateX,
            y: y + translateY,
          });
          lastCtrlX = x1;
          lastCtrlY = y1;
          curX = x;
          curY = y;
          prevCmd = 'Q';
        }
        break;
      }
      case 'T':
      case 't': {
        const rel = cmd === 't';
        while (i + 1 < tokens.length && !isCmd(tokens[i])) {
          const x = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x1 = prevCmd === 'Q' ? 2 * curX - lastCtrlX : curX;
          const y1 = prevCmd === 'Q' ? 2 * curY - lastCtrlY : curY;
          ensureCurrent(curX, curY);
          current!.commands.push({
            kind: 'Q',
            x1: x1 + translateX,
            y1: y1 + translateY,
            x: x + translateX,
            y: y + translateY,
          });
          lastCtrlX = x1;
          lastCtrlY = y1;
          curX = x;
          curY = y;
          prevCmd = 'Q';
        }
        break;
      }
      case 'C':
      case 'c': {
        const rel = cmd === 'c';
        while (i + 5 < tokens.length && !isCmd(tokens[i])) {
          const x1 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y1 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x2 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y2 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          ensureCurrent(curX, curY);
          current!.commands.push({
            kind: 'C',
            x1: x1 + translateX,
            y1: y1 + translateY,
            x2: x2 + translateX,
            y2: y2 + translateY,
            x: x + translateX,
            y: y + translateY,
          });
          lastCtrlX = x2;
          lastCtrlY = y2;
          curX = x;
          curY = y;
          prevCmd = 'C';
        }
        break;
      }
      case 'S':
      case 's': {
        const rel = cmd === 's';
        while (i + 3 < tokens.length && !isCmd(tokens[i])) {
          const x2 = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y2 = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x = rel ? curX + Number(tokens[i++]) : Number(tokens[i++]);
          const y = rel ? curY + Number(tokens[i++]) : Number(tokens[i++]);
          const x1 = prevCmd === 'C' ? 2 * curX - lastCtrlX : curX;
          const y1 = prevCmd === 'C' ? 2 * curY - lastCtrlY : curY;
          ensureCurrent(curX, curY);
          current!.commands.push({
            kind: 'C',
            x1: x1 + translateX,
            y1: y1 + translateY,
            x2: x2 + translateX,
            y2: y2 + translateY,
            x: x + translateX,
            y: y + translateY,
          });
          lastCtrlX = x2;
          lastCtrlY = y2;
          curX = x;
          curY = y;
          prevCmd = 'C';
        }
        break;
      }
      case 'Z':
      case 'z': {
        if (current) {
          current.closed = true;
          current.commands.push({ kind: 'Z' });
        }
        curX = startX;
        curY = startY;
        lastCtrlX = curX;
        lastCtrlY = curY;
        prevCmd = 'Z';
        cmd = '';
        break;
      }
      default: {
        // Caso raro (ex.: 'A'): encerra parsing seguro preservando original
        return [];
      }
    }
  }

  return subpaths;
}

export function serializeSubpathsToD(subpaths: ParsedSubpath[], precision = 3): string {
  const parts: string[] = [];
  for (const sp of subpaths) {
    if (sp.commands.length === 0) continue;
    parts.push(`M ${fmtSvgNum(sp.start.x, precision)} ${fmtSvgNum(sp.start.y, precision)}`);
    for (const c of sp.commands) {
      if (c.kind === 'L') {
        parts.push(`L ${fmtSvgNum(c.x, precision)} ${fmtSvgNum(c.y, precision)}`);
      } else if (c.kind === 'Q') {
        parts.push(
          `Q ${fmtSvgNum(c.x1, precision)} ${fmtSvgNum(c.y1, precision)} ${fmtSvgNum(c.x, precision)} ${fmtSvgNum(c.y, precision)}`
        );
      } else if (c.kind === 'C') {
        parts.push(
          `C ${fmtSvgNum(c.x1, precision)} ${fmtSvgNum(c.y1, precision)} ${fmtSvgNum(c.x2, precision)} ${fmtSvgNum(c.y2, precision)} ${fmtSvgNum(c.x, precision)} ${fmtSvgNum(c.y, precision)}`
        );
      } else if (c.kind === 'Z') {
        parts.push('Z');
      }
    }
  }
  return parts.join(' ');
}

function segmentsProperlyCross(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D
): boolean {
  const cross = (o: Point2D, p: Point2D, q: Point2D) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}

/**
 * Repara alças cúbicas auto-intersectantes, retrógradas ou exageradas em um segmento `C(P0, P1, P2, P3)`,
 * preservando exatamente as tangentes de entrada e saída nos nós `P0` e `P3`!
 */
function sanitizeCubicSegmentHandles(
  p0: Point2D,
  cmd: Extract<ParsedPathCmd, { kind: 'C' }>
): { repaired: boolean; cmd: Extract<ParsedPathCmd, { kind: 'C' }> } {
  const p3 = { x: cmd.x, y: cmd.y };
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (chord < 1e-4) {
    return { repaired: false, cmd };
  }

  let x1 = cmd.x1;
  let y1 = cmd.y1;
  let x2 = cmd.x2;
  let y2 = cmd.y2;
  let repaired = false;

  const h1 = Math.hypot(x1 - p0.x, y1 - p0.y);
  const h2 = Math.hypot(x2 - p3.x, y2 - p3.y);
  const maxSafeHandle = Math.max(1.5, chord * 0.92);

  if (h1 > maxSafeHandle) {
    const s = maxSafeHandle / h1;
    x1 = p0.x + (x1 - p0.x) * s;
    y1 = p0.y + (y1 - p0.y) * s;
    repaired = true;
  }
  if (h2 > maxSafeHandle) {
    const s = maxSafeHandle / h2;
    x2 = p3.x + (x2 - p3.x) * s;
    y2 = p3.y + (y2 - p3.y) * s;
    repaired = true;
  }

  // Se as alças P0->P1 e P3->P2 se cruzam propriamente no polígono de controle, isso gera laço/cúspide em zoom alto!
  if (segmentsProperlyCross(p0, { x: x1, y: y1 }, p3, { x: x2, y: y2 })) {
    x1 = p0.x + (x1 - p0.x) * 0.55;
    y1 = p0.y + (y1 - p0.y) * 0.55;
    x2 = p3.x + (x2 - p3.x) * 0.55;
    y2 = p3.y + (y2 - p3.y) * 0.55;
    repaired = true;
  }

  return {
    repaired,
    cmd: repaired ? { kind: 'C', x1, y1, x2, y2, x: cmd.x, y: cmd.y } : cmd,
  };
}

function buildReferenceEdgeDistanceTransform(
  referenceImage: RawRgbaImage
): { dt: Float32Array; width: number; height: number } {
  const { width, height, data } = referenceImage;
  const total = width * height;
  const edgeMask = new Uint8Array(total);

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const p = row + x;
      const iL = (p - 1) * 4;
      const iR = (p + 1) * 4;
      const iU = (p - width) * 4;
      const iD = (p + width) * 4;

      let maxDiff = 0;
      for (let c = 0; c < 4; c++) {
        const d = Math.hypot(data[iR + c] - data[iL + c], data[iD + c] - data[iU + c]);
        if (d > maxDiff) maxDiff = d;
      }
      if (maxDiff >= 18) {
        edgeMask[p] = 1;
      }
    }
  }

  return {
    dt: computeExactEuclideanDistanceTransform(edgeMask, width, height),
    width,
    height,
  };
}

function sampleDtBilinear(
  dtInfo: { dt: Float32Array; width: number; height: number } | null,
  x: number,
  y: number
): number {
  if (!dtInfo) return 0;
  const { dt, width, height } = dtInfo;
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return dt[iy * width + ix];
}

/**
 * Calibra adaptativamente os atributos SVG de traçado (`stroke-linejoin`, `stroke-linecap`, `stroke-miterlimit`)
 * segundo a geometria real do caminho, evitando pontas de meia-esquadria (miter spikes) exageradas
 * e proibindo terminantemente `vector-effect="non-scaling-stroke"` nos elementos da arte!
 */
function calibratePathStrokeAttributes(
  rawAttrs: string,
  subpaths: ParsedSubpath[],
  stats: ContourIrregularitySummary
): string {
  let attrs = rawAttrs;

  // Regra estrita da Seção 6: NUNCA permitir vector-effect="non-scaling-stroke" nos contornos da arte!
  if (/\bvector-effect\s*=\s*["']non-scaling-stroke["']/i.test(attrs)) {
    attrs = attrs.replace(/\s*\bvector-effect\s*=\s*["']non-scaling-stroke["']/gi, '');
    stats.nonScalingStrokesStripped++;
  }

  const strokeMatch = attrs.match(/\bstroke\s*=\s*["']([^"']+)["']/i);
  if (!strokeMatch || strokeMatch[1].trim().toLowerCase() === 'none') {
    return attrs;
  }

  const swMatch = attrs.match(/\bstroke-width\s*=\s*["']([^"']+)["']/i);
  const strokeWidth = swMatch ? parseFloat(swMatch[1]) : 1;
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) {
    return attrs;
  }

  // Analisa ângulos internos mínimos e presença de curvas suaves ou extremidades abertas
  let minInteriorAngleDeg = 180;
  let hasCurvedSegments = false;
  let hasOpenSubpath = false;

  for (const sp of subpaths) {
    if (!sp.closed) hasOpenSubpath = true;
    const anchors: Point2D[] = [sp.start];
    for (const c of sp.commands) {
      if (c.kind === 'Z') continue;
      if (c.kind === 'Q' || c.kind === 'C') hasCurvedSegments = true;
      anchors.push({ x: c.x, y: c.y });
    }
    for (let k = 1; k < anchors.length - 1; k++) {
      const pPrev = anchors[k - 1];
      const pCurr = anchors[k];
      const pNext = anchors[k + 1];
      const u1x = pPrev.x - pCurr.x;
      const u1y = pPrev.y - pCurr.y;
      const u2x = pNext.x - pCurr.x;
      const u2y = pNext.y - pCurr.y;
      const l1 = Math.hypot(u1x, u1y);
      const l2 = Math.hypot(u2x, u2y);
      if (l1 > 0.2 && l2 > 0.2) {
        const cosInt = Math.max(-1, Math.min(1, (u1x * u2x + u1y * u2y) / (l1 * l2)));
        const intDeg = (Math.acos(cosInt) * 180) / Math.PI;
        if (intDeg < minInteriorAngleDeg) minInteriorAngleDeg = intDeg;
      }
    }
  }

  let desiredJoin: 'round' | 'miter' | 'bevel';
  let desiredMiterLimit = 3.2;

  if (minInteriorAngleDeg >= 135 || (hasCurvedSegments && minInteriorAngleDeg >= 105)) {
    desiredJoin = 'round';
  } else if (minInteriorAngleDeg < 28) {
    desiredJoin = 'bevel';
  } else {
    desiredJoin = 'miter';
    const halfRad = ((minInteriorAngleDeg * Math.PI) / 180) * 0.5;
    desiredMiterLimit = Number(
      Math.min(4.0, Math.max(2.0, 1 / Math.max(0.25, Math.sin(halfRad)) + 0.15)).toFixed(2)
    );
  }

  if (!/\bstroke-linejoin\s*=/i.test(attrs)) {
    attrs += ` stroke-linejoin="${desiredJoin}"`;
    stats.strokesCalibrated++;
  }
  if (desiredJoin === 'miter') {
    if (/\bstroke-miterlimit\s*=\s*["']([^"']+)["']/i.test(attrs)) {
      const existingMl = parseFloat(
        attrs.match(/\bstroke-miterlimit\s*=\s*["']([^"']+)["']/i)?.[1] ?? '4'
      );
      if (existingMl > 4.5) {
        attrs = attrs.replace(
          /\bstroke-miterlimit\s*=\s*["'][^"']+["']/i,
          `stroke-miterlimit="${desiredMiterLimit}"`
        );
        stats.strokesCalibrated++;
      }
    } else {
      attrs += ` stroke-miterlimit="${desiredMiterLimit}"`;
    }
  }

  if (hasOpenSubpath && !/\bstroke-linecap\s*=/i.test(attrs)) {
    attrs += ` stroke-linecap="${hasCurvedSegments ? 'round' : 'butt'}"`;
    stats.strokesCalibrated++;
  }

  return attrs;
}

/**
 * Inspeção e Saneamento Geométrico Pós-Path (Seções 6, 7 e 8):
 * - Elimina duplicações exatas de caminhos;
 * - Remove micro-segmentos degenerados (`< 0.04px`) e nós colineares redundantes;
 * - Apara picos/agulhas artificiais APENAS quando não apoiados pela borda de referência (`dt > 0.95px`);
 * - Repara alças cúbicas auto-intersectantes;
 * - Corrige fechamento `Z` de contornos preenchidos;
 * - Calibra atributos de `stroke`, `linejoin`, `linecap`, `miterlimit` e remove `non-scaling-stroke`.
 */
export function inspectAndSanitizeSvgContours(
  svgMarkup: string,
  referenceImage?: RawRgbaImage,
  coordScaleToRef = 1,
  precision = 3
): { svg: string; summary: ContourIrregularitySummary } {
  const summary: ContourIrregularitySummary = {
    inspectedPathCount: 0,
    duplicatePathsRemoved: 0,
    microSegmentsRemoved: 0,
    collinearMergedCount: 0,
    artificialSpikesTrimmed: 0,
    selfIntersectionsRepaired: 0,
    unclosedLoopsFixed: 0,
    strokesCalibrated: 0,
    nonScalingStrokesStripped: 0,
  };

  // Remove qualquer vector-effect="non-scaling-stroke" de grupos <g> ou raiz também
  let cleanedSvg = svgMarkup.replace(
    /<g\b([^>]*)>/gi,
    (full, gAttrs: string) => {
      if (/\bvector-effect\s*=\s*["']non-scaling-stroke["']/i.test(gAttrs)) {
        summary.nonScalingStrokesStripped++;
        return `<g${gAttrs.replace(/\s*\bvector-effect\s*=\s*["']non-scaling-stroke["']/gi, '')}>`;
      }
      return full;
    }
  );

  const dtInfo = referenceImage ? buildReferenceEdgeDistanceTransform(referenceImage) : null;
  const seenPathSignatures = new Set<string>();

  // Protege o bloco <defs>...</defs> para não alterar nem deduplicar moldes de <clipPath>
  const defsBlocks: string[] = [];
  const svgWithPlaceholders = cleanedSvg.replace(
    /<defs\b[^>]*>[\s\S]*?<\/defs>/gi,
    (defsMatch) => {
      const cleanDefs = defsMatch.replace(
        /\s*\bvector-effect\s*=\s*["']non-scaling-stroke["']/gi,
        ''
      );
      const token = `__SVG_DEFS_PLACEHOLDER_${defsBlocks.length}__`;
      defsBlocks.push(cleanDefs);
      return token;
    }
  );

  const sanitizedBody = svgWithPlaceholders.replace(
    /<path\b([^>]*?)(\/?>)/gi,
    (fullMatch, rawAttrs: string, closeTok: string) => {
      const dMatch = rawAttrs.match(/\bd\s*=\s*["']([^"']+)["']/i);
      if (!dMatch) return fullMatch;

      summary.inspectedPathCount++;

      let tx = 0;
      let ty = 0;
      const trMatch = rawAttrs.match(
        /\btransform\s*=\s*["']translate\(\s*([-+\d.]+)(?:[\s,]+([-+\d.]+))?\s*\)["']/i
      );
      if (trMatch) {
        tx = Number(trMatch[1]) || 0;
        ty = trMatch[2] !== undefined ? Number(trMatch[2]) || 0 : 0;
      }

      const parsed = parseSvgPathToSubpaths(dMatch[1], tx, ty);
      if (parsed.length === 0) {
        return fullMatch;
      }

      const fillVal = (rawAttrs.match(/\bfill\s*=\s*["']([^"']+)["']/i)?.[1] ?? '#000000').trim();
      const strokeVal = (rawAttrs.match(/\bstroke\s*=\s*["']([^"']+)["']/i)?.[1] ?? 'none').trim();
      const fillOp = (rawAttrs.match(/\bfill-opacity\s*=\s*["']([^"']+)["']/i)?.[1] ?? '1').trim();
      const isFilled = fillVal.toLowerCase() !== 'none';

      const cleanedSubpaths: ParsedSubpath[] = [];

      for (const sp of parsed) {
        const cmds: Exclude<ParsedPathCmd, { kind: 'M' }>[] = [];
        let cur: Point2D = { ...sp.start };
        let hasZ = false;

        for (let idx = 0; idx < sp.commands.length; idx++) {
          const c = sp.commands[idx];
          if (c.kind === 'Z') {
            hasZ = true;
            continue;
          }

          const segLen = Math.hypot(c.x - cur.x, c.y - cur.y);
          // 1) Elimina micro-segmentos degenerados (< 0.04px sem desvio de alça)
          if (segLen < 0.04) {
            const isTinyLoop =
              c.kind === 'C' &&
              (Math.hypot(c.x1 - cur.x, c.y1 - cur.y) > 0.2 ||
                Math.hypot(c.x2 - cur.x, c.y2 - cur.y) > 0.2);
            if (!isTinyLoop) {
              summary.microSegmentsRemoved++;
              continue;
            }
          }

          // 2) Funde segmentos retos colineares consecutivos (`L` + `L` com desvio < 0.02px)
          if (c.kind === 'L' && cmds.length > 0 && cmds[cmds.length - 1].kind === 'L') {
            const prevAnchor =
              cmds.length >= 2
                ? (() => {
                    const prevPrev = cmds[cmds.length - 2];
                    return prevPrev.kind === 'Z' ? sp.start : { x: prevPrev.x, y: prevPrev.y };
                  })()
                : sp.start;
            const totalDx = c.x - prevAnchor.x;
            const totalDy = c.y - prevAnchor.y;
            const totalLen = Math.hypot(totalDx, totalDy);
            if (totalLen > 0.1) {
              const ortho =
                Math.abs((cur.x - prevAnchor.x) * totalDy - (cur.y - prevAnchor.y) * totalDx) /
                totalLen;
              const dot =
                (cur.x - prevAnchor.x) * (c.x - cur.x) + (cur.y - prevAnchor.y) * (c.y - cur.y);
              if (ortho <= 0.022 && dot > 0) {
                cmds[cmds.length - 1] = { kind: 'L', x: c.x, y: c.y };
                cur = { x: c.x, y: c.y };
                summary.collinearMergedCount++;
                continue;
              }
            }
          }

          // 3) Repara auto-interseção de alças cúbicas
          if (c.kind === 'C') {
            const san = sanitizeCubicSegmentHandles(cur, c);
            if (san.repaired) {
              summary.selfIntersectionsRepaired++;
            }
            cmds.push(san.cmd);
            cur = { x: san.cmd.x, y: san.cmd.y };
          } else {
            cmds.push(c);
            cur = { x: c.x, y: c.y };
          }
        }

        // 4) Detecta e apara picos de agulha artificiais (ângulo interno < 26° onde a ponta escapa > 1.05px da borda de referência!)
        if (dtInfo && cmds.length >= 3) {
          let pPrev = sp.start;
          for (let k = 0; k < cmds.length - 1; k++) {
            const cA = cmds[k];
            const cB = cmds[k + 1];
            if (cA.kind === 'L' && cB.kind === 'L') {
              const pTip = { x: cA.x, y: cA.y };
              const pNext = { x: cB.x, y: cB.y };
              const u1x = pPrev.x - pTip.x;
              const u1y = pPrev.y - pTip.y;
              const u2x = pNext.x - pTip.x;
              const u2y = pNext.y - pTip.y;
              const l1 = Math.hypot(u1x, u1y);
              const l2 = Math.hypot(u2x, u2y);
              if (l1 >= 0.8 && l2 >= 0.8) {
                const cosInt = Math.max(-1, Math.min(1, (u1x * u2x + u1y * u2y) / (l1 * l2)));
                const intDeg = (Math.acos(cosInt) * 180) / Math.PI;
                if (intDeg < 26) {
                  const refDist = sampleDtBilinear(
                    dtInfo,
                    pTip.x * coordScaleToRef,
                    pTip.y * coordScaleToRef
                  );
                  const baseMidDist = sampleDtBilinear(
                    dtInfo,
                    ((pPrev.x + pNext.x) * 0.5) * coordScaleToRef,
                    ((pPrev.y + pNext.y) * 0.5) * coordScaleToRef
                  );
                  if (refDist > 1.15 && refDist > baseMidDist + 0.75) {
                    // Retrai a ponta artificial para a posição apoiada sem apagar cantos reais!
                    const retractX = pTip.x * 0.45 + ((pPrev.x + pNext.x) * 0.5) * 0.55;
                    const retractY = pTip.y * 0.45 + ((pPrev.y + pNext.y) * 0.5) * 0.55;
                    cmds[k] = { kind: 'L', x: retractX, y: retractY };
                    summary.artificialSpikesTrimmed++;
                  }
                }
              }
            }
            if (cA.kind !== 'Z') {
              pPrev = { x: cA.x, y: cA.y };
            }
          }
        }

        // 5) Validação de fechamento em caminhos preenchidos
        if (cmds.length > 0) {
          const lastCmd = cmds[cmds.length - 1];
          const endPt = lastCmd.kind === 'Z' ? sp.start : { x: lastCmd.x, y: lastCmd.y };
          const gapToStart = Math.hypot(endPt.x - sp.start.x, endPt.y - sp.start.y);

          if (hasZ || (isFilled && strokeVal.toLowerCase() === 'none' && gapToStart <= 0.35)) {
            if (!hasZ) summary.unclosedLoopsFixed++;
            if (lastCmd.kind === 'L' && gapToStart < 0.03 && cmds.length >= 2) {
              cmds.pop();
            }
            cmds.push({ kind: 'Z' });
            cleanedSubpaths.push({
              start: sp.start,
              commands: cmds,
              closed: true,
            });
          } else {
            cleanedSubpaths.push({
              start: sp.start,
              commands: cmds,
              closed: false,
            });
          }
        }
      }

      if (cleanedSubpaths.length === 0) return '';

      const newD = serializeSubpathsToD(cleanedSubpaths, precision);
      if (!newD) return '';

      const sig = `${fillVal}|${fillOp}|${strokeVal}|${newD}`;
      if (seenPathSignatures.has(sig)) {
        summary.duplicatePathsRemoved++;
        return '';
      }
      seenPathSignatures.add(sig);

      let updatedAttrs = rawAttrs.replace(/\bd\s*=\s*["'][^"']*["']/i, `d="${newD}"`);
      if (trMatch) {
        updatedAttrs = updatedAttrs.replace(
          /\s*\btransform\s*=\s*["']translate\(\s*[-+\d.]+(?:[\s,]+[-+\d.]+)?\s*\)["']/i,
          ''
        );
      }

      updatedAttrs = calibratePathStrokeAttributes(updatedAttrs, cleanedSubpaths, summary);
      return `<path${updatedAttrs}${closeTok}`;
    }
  );

  let finalSvg = sanitizedBody;
  for (let dIdx = 0; dIdx < defsBlocks.length; dIdx++) {
    finalSvg = finalSvg.replace(`__SVG_DEFS_PLACEHOLDER_${dIdx}__`, defsBlocks[dIdx]);
  }

  return { svg: finalSvg, summary };
}

/**
 * Validador de Espessura Visual de Contornos (Seção 9):
 * Mede o raio da crista medial (Transformada de Distância Euclidiana interna) nos contornos/traços
 * da imagem original vs SVG renderizado, identificando estreitamentos, engordamentos/vazamentos
 * e calculando correções sub-pixel exatas por região quando necessário!
 */
export function evaluateContourThicknessConsistency(
  original: RawRgbaImage,
  rendered: RawRgbaImage,
  regionIdMap?: Int32Array,
  hasUniformBg = false,
  bgRgb: [number, number, number] | null = null
): ContourThicknessReport {
  const width = Math.min(original.width, rendered.width);
  const height = Math.min(original.height, rendered.height);
  const total = width * height;

  // Constrói máscara complementar (1 FORA do traço/objeto, 0 DENTRO) para medir distância até a borda!
  const origOutside = new Uint8Array(total);
  const vecOutside = new Uint8Array(total);

  const hasTranspCanvas = !hasUniformBg && original.data[3] < 30;

  const compLum = (buf: Uint8Array, i4: number): number => {
    const a = buf[i4 + 3] / 255;
    const r = buf[i4] * a + 255 * (1 - a);
    const g = buf[i4 + 1] * a + 255 * (1 - a);
    const b = buf[i4 + 2] * a + 255 * (1 - a);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  if (regionIdMap && regionIdMap.length === total) {
    for (let i = 0; i < total; i++) {
      const i4 = i * 4;
      if (hasTranspCanvas) {
        origOutside[i] = original.data[i4 + 3] < 120 ? 1 : 0;
        vecOutside[i] = rendered.data[i4 + 3] < 120 ? 1 : 0;
      } else if (bgRgb) {
        const oa = original.data[i4 + 3] / 255;
        const va = rendered.data[i4 + 3] / 255;
        const or = original.data[i4] * oa + bgRgb[0] * (1 - oa);
        const og = original.data[i4 + 1] * oa + bgRgb[1] * (1 - oa);
        const ob = original.data[i4 + 2] * oa + bgRgb[2] * (1 - oa);
        const vr = rendered.data[i4] * va + bgRgb[0] * (1 - va);
        const vg = rendered.data[i4 + 1] * va + bgRgb[1] * (1 - va);
        const vb = rendered.data[i4 + 2] * va + bgRgb[2] * (1 - va);

        const dO = Math.abs(or - bgRgb[0]) + Math.abs(og - bgRgb[1]) + Math.abs(ob - bgRgb[2]);
        const dV = Math.abs(vr - bgRgb[0]) + Math.abs(vg - bgRgb[1]) + Math.abs(vb - bgRgb[2]);
        origOutside[i] = dO <= 36 ? 1 : 0;
        vecOutside[i] = dV <= 36 ? 1 : 0;
      } else {
        origOutside[i] = compLum(original.data, i4) > 90 ? 1 : 0;
        vecOutside[i] = compLum(rendered.data, i4) > 90 ? 1 : 0;
      }
    }
  } else {
    for (let i = 0; i < total; i++) {
      const i4 = i * 4;
      if (hasTranspCanvas) {
        origOutside[i] = original.data[i4 + 3] < 120 ? 1 : 0;
        vecOutside[i] = rendered.data[i4 + 3] < 120 ? 1 : 0;
      } else {
        origOutside[i] = compLum(original.data, i4) > 128 ? 1 : 0;
        vecOutside[i] = compLum(rendered.data, i4) > 128 ? 1 : 0;
      }
    }
  }

  const edtOrigIn = computeExactEuclideanDistanceTransform(origOutside, width, height);
  const edtVecIn = computeExactEuclideanDistanceTransform(vecOutside, width, height);

  let sampleCount = 0;
  let origSum = 0;
  let vecSum = 0;
  let absErrSum = 0;
  let pinchedCount = 0;
  let bloatedCount = 0;
  const anomalousSpots: ContourThicknessSpot[] = [];
  const regErrSum = new Map<number, { errSum: number; count: number }>();

  // Avalia pontos do eixo medial (crista local de distância `0.8 <= rOrig <= 7.5px`, i.e., espessura `1.6..15px`)
  for (let y = 2; y < height - 2; y++) {
    const row = y * width;
    for (let x = 2; x < width - 2; x++) {
      const p = row + x;
      const rO = edtOrigIn[p];
      if (rO < 0.85 || rO > 7.5) continue;

      // Crista medial verdadeira de traço/contorno (ambos os lados a ±2px descem em direção às bordas, ignorando paredes de formas maciças!)
      const isHorizPeak =
        rO >= edtOrigIn[p - 1] &&
        rO >= edtOrigIn[p + 1] &&
        edtOrigIn[p - 2] < rO - 0.45 &&
        edtOrigIn[p + 2] < rO - 0.45;
      const isVertPeak =
        rO >= edtOrigIn[p - width] &&
        rO >= edtOrigIn[p + width] &&
        edtOrigIn[p - 2 * width] < rO - 0.45 &&
        edtOrigIn[p + 2 * width] < rO - 0.45;
      if (!isHorizPeak && !isVertPeak) continue;

      // Toma o máximo de edtVecIn em vizinhança 3×3 para tolerar sub-pixel shift do eixo central <= 0.6px
      let rV = edtVecIn[p];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cand = edtVecIn[(y + dy) * width + (x + dx)];
          if (cand > rV && cand <= rO * 2.2) {
            rV = cand;
          }
        }
      }
      // Se o ponto está completamente ausente ou deslocado, usa valor direto
      if (edtVecIn[p] === 0 && rV > 0) {
        rV = edtVecIn[p];
      }

      const wOrig = rO * 2;
      const wVec = edtVecIn[p] > 0 ? edtVecIn[p] * 2 : rV * 2;
      const diff = wVec - wOrig;
      const absDiff = Math.abs(diff);

      sampleCount++;
      origSum += wOrig;
      vecSum += wVec;
      absErrSum += absDiff;

      const rid = regionIdMap ? regionIdMap[p] : undefined;
      if (rid && rid > 0) {
        const cur = regErrSum.get(rid) ?? { errSum: 0, count: 0 };
        cur.errSum += diff;
        cur.count++;
        regErrSum.set(rid, cur);
      }

      if (diff <= -Math.max(1.1, wOrig * 0.36)) {
        pinchedCount++;
        if (anomalousSpots.length < 24) {
          anomalousSpots.push({
            x,
            y,
            origThicknessPx: Number(wOrig.toFixed(2)),
            vecThicknessPx: Number(wVec.toFixed(2)),
            kind: 'too_thin',
            regionId: rid,
          });
        }
      } else if (diff >= Math.max(1.2, wOrig * 0.38)) {
        bloatedCount++;
        if (anomalousSpots.length < 24) {
          anomalousSpots.push({
            x,
            y,
            origThicknessPx: Number(wOrig.toFixed(2)),
            vecThicknessPx: Number(wVec.toFixed(2)),
            kind: 'too_thick',
            regionId: rid,
          });
        }
      }
    }
  }

  const regionBiasCorrectionsPx = new Map<number, number>();
  for (const [rid, acc] of regErrSum.entries()) {
    if (acc.count >= 8) {
      const meanWidthDiff = acc.errSum / acc.count; // > 0 significa SVG mais grosso que o original
      if (Math.abs(meanWidthDiff) >= 0.45) {
        // Correção de meia-largura limitada a ±0.26px para estabilidade topológica
        const bias = Math.max(-0.26, Math.min(0.26, -meanWidthDiff * 0.38));
        regionBiasCorrectionsPx.set(rid, Number(bias.toFixed(3)));
      }
    }
  }

  if (sampleCount === 0) {
    return {
      measuredRidgeSamples: 0,
      meanOrigThicknessPx: 0,
      meanVecThicknessPx: 0,
      meanAbsThicknessErrorPx: 0,
      thicknessConsistencyPct: 100,
      pinchedCount: 0,
      bloatedCount: 0,
      anomalousSpots: [],
      regionBiasCorrectionsPx,
    };
  }

  const meanOrig = origSum / sampleCount;
  const meanVec = vecSum / sampleCount;
  const meanAbsErr = absErrSum / sampleCount;
  const relErr = meanAbsErr / Math.max(1.5, meanOrig);
  const consistencyPct = Number(
    Math.max(0, Math.min(100, (1 - relErr * 0.85) * 100)).toFixed(2)
  );

  return {
    measuredRidgeSamples: sampleCount,
    meanOrigThicknessPx: Number(meanOrig.toFixed(2)),
    meanVecThicknessPx: Number(meanVec.toFixed(2)),
    meanAbsThicknessErrorPx: Number(meanAbsErr.toFixed(3)),
    thicknessConsistencyPct: consistencyPct,
    pinchedCount,
    bloatedCount,
    anomalousSpots,
    regionBiasCorrectionsPx,
  };
}
