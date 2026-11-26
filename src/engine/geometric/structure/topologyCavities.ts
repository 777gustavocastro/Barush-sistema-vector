import type { Point2D } from '../contract/geometricContract';
import { signedArea } from '../primitives/subpixelBoundaryExtractor';

export interface CavityReport {
  holeMask: Uint8Array;
  closedHoles: number;
  openCavities: number;
}

/**
 * Componentes do complemento da máscara que não tocam a borda da imagem são furos fechados.
 * Uma abertura ligada ao exterior permanece no componente externo e não é promovida a furo.
 */
export function findEnclosedHoles(mask: Uint8Array, width: number, height: number): {
  holeMask: Uint8Array;
  closedHoles: number;
} {
  const seen = new Uint8Array(mask.length);
  const holeMask = new Uint8Array(mask.length);
  let closedHoles = 0;

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const component: number[] = [];
    let touchesBorder = false;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      component.push(idx);
      const x = idx % width;
      const y = (idx - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const nIdx = ny * width + nx;
        if (seen[nIdx] || mask[nIdx]) return;
        seen[nIdx] = 1;
        stack.push(nIdx);
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    if (!touchesBorder && component.length >= 4) {
      closedHoles++;
      for (const idx of component) holeMask[idx] = 1;
    }
  }

  return { holeMask, closedHoles };
}

function convexHull(points: Point2D[]): Point2D[] {
  const unique = new Map<string, Point2D>();
  for (const point of points) unique.set(`${point.x.toFixed(2)},${point.y.toFixed(2)}`, point);
  const sorted = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point2D[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersect =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + 1e-12) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Cavidade aberta: região do complemento que está dentro do fecho convexo, não é furo fechado
 * e permanece ligada ao exterior. Um recorte na borda conta; um furo interno não conta.
 */
export function countOpenCavities(
  mask: Uint8Array,
  width: number,
  height: number,
  holeMask: Uint8Array
): number {
  const occupied: Point2D[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) occupied.push({ x, y });
    }
  }
  if (occupied.length < 6) return 0;
  const hull = convexHull(occupied);
  if (hull.length < 3 || Math.abs(signedArea(hull)) < 8) return 0;

  const bay = new Uint8Array(mask.length);
  let bayPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] || holeMask[idx]) continue;
      if (!pointInPolygon({ x: x + 0.5, y: y + 0.5 }, hull)) continue;
      bay[idx] = 1;
      bayPixels++;
    }
  }
  if (bayPixels < 12) return 0;

  const seen = new Uint8Array(mask.length);
  let cavities = 0;
  for (let start = 0; start < bay.length; start++) {
    if (!bay[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let area = 0;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      area++;
      const x = idx % width;
      const y = (idx - x) / width;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const nIdx = ny * width + nx;
        if (!bay[nIdx] || seen[nIdx]) return;
        seen[nIdx] = 1;
        stack.push(nIdx);
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
    if (area >= 12) cavities++;
  }
  return cavities;
}
