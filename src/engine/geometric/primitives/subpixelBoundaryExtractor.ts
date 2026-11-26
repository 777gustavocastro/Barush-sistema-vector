import type { RawRgbaImage } from '../../types';
import type { Point2D } from '../contract/geometricContract';
import type { SubpixelBoundaryLoop } from './types';

/**
 * Extrai contornos subpixel a partir de um campo escalar contínuo de cobertura (0..1)
 * usando Marching Squares com interpolação linear no cruzamento iso = 0.5.
 * Diferente do caminhamento na grade inteira, cada vértice nasce na posição subpixel real
 * da borda antialiasada.
 */
export function extractSubpixelLoopsFromField(
  field: Float32Array,
  width: number,
  height: number,
  iso = 0.5
): SubpixelBoundaryLoop[] {
  const segments: Array<{ ax: number; ay: number; bx: number; by: number }> = [];

  const interp = (v0: number, v1: number): number => {
    const denom = v1 - v0;
    if (Math.abs(denom) < 1e-6) return 0.5;
    return Math.max(0, Math.min(1, (iso - v0) / denom));
  };

  // Centros de pixel em (x + 0.5, y + 0.5). Cada célula cobre [x+0.5, x+1.5] x [y+0.5, y+1.5].
  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const sample = (sx: number, sy: number) => {
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) return 0;
        const v = field[sy * width + sx];
        return v === iso ? iso + 1e-4 : v;
      };

      const vTL = sample(x, y);
      const vTR = sample(x + 1, y);
      const vBR = sample(x + 1, y + 1);
      const vBL = sample(x, y + 1);

      const c =
        (vTL >= iso ? 8 : 0) |
        (vTR >= iso ? 4 : 0) |
        (vBR >= iso ? 2 : 0) |
        (vBL >= iso ? 1 : 0);
      if (c === 0 || c === 15) continue;

      const x0 = x + 0.5;
      const y0 = y + 0.5;
      const top = { x: x0 + interp(vTL, vTR), y: y0 };
      const right = { x: x0 + 1, y: y0 + interp(vTR, vBR) };
      const bottom = { x: x0 + interp(vBL, vBR), y: y0 + 1 };
      const left = { x: x0, y: y0 + interp(vTL, vBL) };

      const push = (a: Point2D, b: Point2D) => {
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-5) return;
        segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      };

      switch (c) {
        case 1:
          push(left, bottom);
          break;
        case 2:
          push(bottom, right);
          break;
        case 3:
          push(left, right);
          break;
        case 4:
          push(right, top);
          break;
        case 5: {
          const center = 0.25 * (vTL + vTR + vBR + vBL);
          if (center >= iso) {
            push(left, top);
            push(right, bottom);
          } else {
            push(left, bottom);
            push(right, top);
          }
          break;
        }
        case 6:
          push(bottom, top);
          break;
        case 7:
          push(left, top);
          break;
        case 8:
          push(top, left);
          break;
        case 9:
          push(top, bottom);
          break;
        case 10: {
          const center = 0.25 * (vTL + vTR + vBR + vBL);
          if (center >= iso) {
            push(top, right);
            push(bottom, left);
          } else {
            push(top, left);
            push(bottom, right);
          }
          break;
        }
        case 11:
          push(top, right);
          break;
        case 12:
          push(right, left);
          break;
        case 13:
          push(right, bottom);
          break;
        case 14:
          push(bottom, left);
          break;
      }
    }
  }

  return stitchSegmentsToLoops(segments);
}

/**
 * Constrói um campo escalar contínuo de cobertura [0..1] para um objeto sobre um fundo conhecido,
 * preservando a transição antialiasada da imagem original.
 */
export function buildCoverageFieldFromImage(
  image: RawRgbaImage,
  bgRgb: [number, number, number],
  fgRgb: [number, number, number],
  useAlphaOnly = false
): Float32Array {
  const { width, height, data } = image;
  const field = new Float32Array(width * height);
  if (useAlphaOnly) {
    for (let i = 0; i < width * height; i++) {
      field[i] = data[i * 4 + 3] / 255;
    }
    return field;
  }

  const dr = fgRgb[0] - bgRgb[0];
  const dg = fgRgb[1] - bgRgb[1];
  const db = fgRgb[2] - bgRgb[2];
  const denom = dr * dr + dg * dg + db * db;
  if (denom < 1) return field;

  for (let i = 0; i < width * height; i++) {
    const i4 = i * 4;
    const a = data[i4 + 3] / 255;
    if (a <= 0.01) {
      field[i] = 0;
      continue;
    }
    const proj =
      ((data[i4] - bgRgb[0]) * dr +
        (data[i4 + 1] - bgRgb[1]) * dg +
        (data[i4 + 2] - bgRgb[2]) * db) /
      denom;
    field[i] = Math.max(0, Math.min(1, proj * a));
  }
  return field;
}

/**
 * Constrói o campo de cobertura para uma região específica de um labelMap usando a cor local
 * da região contra a vizinhança imediata, mantendo precisão subpixel na borda.
 */
export function buildRegionSubpixelField(
  image: RawRgbaImage,
  labelMap: Int32Array,
  regionId: number,
  regionRgb: [number, number, number],
  bgRgb: [number, number, number]
): Float32Array {
  const { width, height, data } = image;
  const field = new Float32Array(width * height);
  const dr = regionRgb[0] - bgRgb[0];
  const dg = regionRgb[1] - bgRgb[1];
  const db = regionRgb[2] - bgRgb[2];
  const denom = dr * dr + dg * dg + db * db;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      const inRegion = labelMap[idx] === regionId;
      let nearBorder = false;
      for (let dy = -1; dy <= 1 && !nearBorder; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          if (inRegion) nearBorder = true;
          continue;
        }
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            if (inRegion) nearBorder = true;
            continue;
          }
          if ((labelMap[ny * width + nx] === regionId) !== inRegion) {
            nearBorder = true;
            break;
          }
        }
      }
      if (!nearBorder) {
        field[idx] = inRegion ? 1 : 0;
        continue;
      }
      if (denom < 25) {
        field[idx] = inRegion ? 1 : 0;
        continue;
      }
      const i4 = idx * 4;
      const a = data[i4 + 3] / 255;
      const proj =
        ((data[i4] - bgRgb[0]) * dr +
          (data[i4 + 1] - bgRgb[1]) * dg +
          (data[i4 + 2] - bgRgb[2]) * db) /
        denom;
      const cov = Math.max(0, Math.min(1, proj * a));
      field[idx] = cov;
    }
  }
  return field;
}

function stitchSegmentsToLoops(
  segments: Array<{ ax: number; ay: number; bx: number; by: number }>
): SubpixelBoundaryLoop[] {
  const keyOf = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const outgoing = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const k = keyOf(segments[i].ax, segments[i].ay);
    const list = outgoing.get(k);
    if (list) list.push(i);
    else outgoing.set(k, [i]);
  }

  const used = new Uint8Array(segments.length);
  const loops: SubpixelBoundaryLoop[] = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    const pts: Point2D[] = [];
    let cur = start;
    const startSeg = segments[start];
    const startKey = keyOf(startSeg.ax, startSeg.ay);
    let closedCleanly = false;

    for (let guard = 0; guard < segments.length + 2; guard++) {
      if (used[cur]) break;
      used[cur] = 1;
      const seg = segments[cur];
      pts.push({ x: seg.ax, y: seg.ay });
      const nextKey = keyOf(seg.bx, seg.by);
      if (nextKey === startKey) {
        closedCleanly = true;
        break;
      }
      const candidates = outgoing.get(nextKey);
      let nextIdx = -1;
      if (candidates) {
        for (const cand of candidates) {
          if (!used[cand]) {
            nextIdx = cand;
            break;
          }
        }
      }
      // Se houve empate de arredondamento na grade de 0.01 px, busca segmento não usado a <= 0.05 px
      if (nextIdx < 0) {
        let bestD = 0.05;
        for (let k = 0; k < segments.length; k++) {
          if (used[k]) continue;
          const d = Math.hypot(segments[k].ax - seg.bx, segments[k].ay - seg.by);
          if (d < bestD) {
            bestD = d;
            nextIdx = k;
          }
        }
      }
      if (nextIdx < 0) {
        if (Math.hypot(seg.bx - startSeg.ax, seg.by - startSeg.ay) <= 1.2) {
          closedCleanly = true;
        }
        break;
      }
      cur = nextIdx;
    }

    if (pts.length >= 3 && closedCleanly) {
      const area = signedArea(pts);
      if (Math.abs(area) >= 1) {
        loops.push({
          points: pts,
          isHole: area < 0,
          areaPx: Math.abs(area),
        });
      }
    }
  }

  loops.sort((a, b) => b.areaPx - a.areaPx);
  return loops;
}

export function signedArea(pts: Point2D[]): number {
  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += (pts[j].x + pts[i].x) * (pts[i].y - pts[j].y);
  }
  return sum * 0.5;
}
