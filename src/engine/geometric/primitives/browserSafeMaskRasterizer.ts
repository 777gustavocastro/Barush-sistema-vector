import type { Point2D } from '../contract/geometricContract';
import type { GeometricPrimitive } from './types';

function pointInPoly(x: number, y: number, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Avalia se o centro de pixel (px, py) pertence a uma primitiva geométrica preenchida.
 * 100% JS puro (compatível com navegador, Web Worker, Vite e Node, sem dependências nativas).
 */
export function isInsidePrimitive(
  px: number,
  py: number,
  primitive: GeometricPrimitive,
  sampledBoundary: Point2D[]
): boolean {
  switch (primitive.kind) {
    case 'circle': {
      const dx = px - primitive.cx;
      const dy = py - primitive.cy;
      return dx * dx + dy * dy <= primitive.r * primitive.r;
    }
    case 'ellipse': {
      const rad = (primitive.rotationDeg * Math.PI) / 180;
      const cosT = Math.cos(rad);
      const sinT = Math.sin(rad);
      const dx = px - primitive.cx;
      const dy = py - primitive.cy;
      const lx = dx * cosT + dy * sinT;
      const ly = -dx * sinT + dy * cosT;
      return (lx * lx) / (primitive.rx * primitive.rx) + (ly * ly) / (primitive.ry * primitive.ry) <= 1;
    }
    case 'rect': {
      const cx = primitive.x + primitive.width * 0.5;
      const cy = primitive.y + primitive.height * 0.5;
      let lx = px - cx;
      let ly = py - cy;
      if (primitive.rotationDeg && Math.abs(primitive.rotationDeg) > 1e-3) {
        const rad = (primitive.rotationDeg * Math.PI) / 180;
        const cosT = Math.cos(rad);
        const sinT = Math.sin(rad);
        const rx0 = lx * cosT + ly * sinT;
        const ry0 = -lx * sinT + ly * cosT;
        lx = rx0;
        ly = ry0;
      }
      const r = primitive.rx ?? 0;
      if (r <= 0.05) {
        return Math.abs(lx) <= primitive.width * 0.5 && Math.abs(ly) <= primitive.height * 0.5;
      }
      const bx = primitive.width * 0.5 - r;
      const by = primitive.height * 0.5 - r;
      const qx = Math.abs(lx) - bx;
      const qy = Math.abs(ly) - by;
      const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      return sdf <= 0;
    }
    case 'polygon':
      return pointInPoly(px, py, primitive.vertices);
    case 'composite':
      return pointInPoly(px, py, sampledBoundary);
    default:
      return false;
  }
}

/**
 * Rasteriza um elemento SVG simples (<circle>, <rect>, <line>, <path> poligonal) em máscara binária
 * sem depender de @resvg/resvg-js (seguro para bundle Vite no navegador).
 */
export function rasterizeSimpleSvgMask(
  svgElement: string,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const num = (attr: string) => {
    const m = svgElement.match(new RegExp(`\\b${attr}="([^"]+)"`));
    return m ? Number(m[1]) : NaN;
  };
  const isStroke = /\bfill="none"/.test(svgElement) || svgElement.startsWith('<line ');
  const sw = num('stroke-width');
  const halfSw = Number.isFinite(sw) ? sw * 0.5 : 0.5;

  if (svgElement.startsWith('<circle ')) {
    const cx = num('cx');
    const cy = num('cy');
    const r = num('r');
    const rMin = isStroke ? Math.max(0, r - halfSw) : 0;
    const rMax = isStroke ? r + halfSw : r;
    const rMin2 = rMin * rMin;
    const rMax2 = rMax * rMax;
    const x0 = Math.max(0, Math.floor(cx - rMax - 1));
    const x1 = Math.min(width - 1, Math.ceil(cx + rMax + 1));
    const y0 = Math.max(0, Math.floor(cy - rMax - 1));
    const y1 = Math.min(height - 1, Math.ceil(cy + rMax + 1));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 <= rMax2 && (!isStroke || d2 >= rMin2)) mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  if (svgElement.startsWith('<rect ')) {
    const rx0 = num('x');
    const ry0 = num('y');
    const rw = num('width');
    const rh = num('height');
    const outerX0 = isStroke ? rx0 - halfSw : rx0;
    const outerY0 = isStroke ? ry0 - halfSw : ry0;
    const outerX1 = isStroke ? rx0 + rw + halfSw : rx0 + rw;
    const outerY1 = isStroke ? ry0 + rh + halfSw : ry0 + rh;
    const innerX0 = rx0 + halfSw;
    const innerY0 = ry0 + halfSw;
    const innerX1 = rx0 + rw - halfSw;
    const innerY1 = ry0 + rh - halfSw;
    const x0 = Math.max(0, Math.floor(outerX0));
    const x1 = Math.min(width - 1, Math.ceil(outerX1));
    const y0 = Math.max(0, Math.floor(outerY0));
    const y1 = Math.min(height - 1, Math.ceil(outerY1));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      if (py < outerY0 || py > outerY1) continue;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        if (px < outerX0 || px > outerX1) continue;
        if (isStroke && px > innerX0 && px < innerX1 && py > innerY0 && py < innerY1) continue;
        mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  if (svgElement.startsWith('<line ')) {
    const x1 = num('x1');
    const y1 = num('y1');
    const x2 = num('x2');
    const y2 = num('y2');
    const isRound = /stroke-linecap="round"/.test(svgElement);
    const isSquare = /stroke-linecap="square"/.test(svgElement);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const minX = Math.max(0, Math.floor(Math.min(x1, x2) - halfSw - 1));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x1, x2) + halfSw + 1));
    const minY = Math.max(0, Math.floor(Math.min(y1, y2) - halfSw - 1));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y1, y2) + halfSw + 1));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const proj = (px - x1) * ux + (py - y1) * uy;
        const perp = Math.abs(-(px - x1) * uy + (py - y1) * ux);
        if (isRound) {
          const clamped = Math.max(0, Math.min(len, proj));
          if (Math.hypot(px - (x1 + clamped * ux), py - (y1 + clamped * uy)) <= halfSw) {
            mask[y * width + x] = 1;
          }
        } else {
          const ext = isSquare ? halfSw : 0;
          if (proj >= -ext && proj <= len + ext && perp <= halfSw) {
            mask[y * width + x] = 1;
          }
        }
      }
    }
    return mask;
  }

  // Fallback para <path d="M ... L ... Z">
  const dMatch = svgElement.match(/\bd="([^"]+)"/);
  if (dMatch) {
    const nums = dMatch[1].match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    const poly: Point2D[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      poly.push({ x: nums[i], y: nums[i + 1] });
    }
    if (poly.length >= 3) {
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const x0 = Math.max(0, Math.floor(minX));
      const x1 = Math.min(width - 1, Math.ceil(maxX));
      const y0 = Math.max(0, Math.floor(minY));
      const y1 = Math.min(height - 1, Math.ceil(maxY));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (pointInPoly(x + 0.5, y + 0.5, poly)) mask[y * width + x] = 1;
        }
      }
    }
  }
  return mask;
}
