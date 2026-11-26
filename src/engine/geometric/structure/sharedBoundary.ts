import type { Point2D } from '../contract/geometricContract';
import { signedArea } from '../primitives/subpixelBoundaryExtractor';
import type { LoopGeom, SharedEdge } from './types';

interface EditableLoop {
  regionId: number;
  role: 'outer' | 'hole';
  geom: LoopGeom;
  points: Point2D[] | null;
}

function rectPoints(rect: { x: number; y: number; width: number; height: number }): Point2D[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

function asRect(points: Point2D[]): LoopGeom | null {
  if (points.length !== 4) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (const point of points) {
    const onX = Math.abs(point.x - minX) < 0.2 || Math.abs(point.x - maxX) < 0.2;
    const onY = Math.abs(point.y - minY) < 0.2 || Math.abs(point.y - maxY) < 0.2;
    if (!onX || !onY) return null;
  }
  if (maxX - minX < 1 || maxY - minY < 1) return null;
  return { type: 'rect', x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Cada fronteira compartilhada recebe uma única geometria.
 * Os dois lados passam a usar os mesmos extremos, sem recuo artificial.
 */
export function canonicalizeSharedBoundaries(
  entries: Array<{ regionId: number; role: 'outer' | 'hole'; geom: LoopGeom }>
): { geoms: LoopGeom[]; sharedEdges: SharedEdge[] } {
  const loops: EditableLoop[] = entries.map((entry) => ({
    regionId: entry.regionId,
    role: entry.role,
    geom: entry.geom,
    points:
      entry.geom.type === 'rect'
        ? rectPoints(entry.geom)
        : entry.geom.type === 'polygon'
          ? entry.geom.points.map((point) => ({ ...point }))
          : null,
  }));

  const sharedEdges: SharedEdge[] = [];
  const acc = new Map<string, { x: number; y: number; w: number }>();
  const keyOf = (loopIndex: number, vertex: number) => `${loopIndex}:${vertex}`;

  const add = (loopIndex: number, vertex: number, x: number, y: number) => {
    const key = keyOf(loopIndex, vertex);
    const prev = acc.get(key);
    if (prev) {
      prev.x += x;
      prev.y += y;
      prev.w += 1;
    } else {
      acc.set(key, { x, y, w: 1 });
    }
  };

  for (let i = 0; i < loops.length; i++) {
    const a = loops[i].points;
    if (!a || a.length < 2) continue;
    for (let j = i + 1; j < loops.length; j++) {
      if (loops[i].regionId === loops[j].regionId) continue;
      const b = loops[j].points;
      if (!b || b.length < 2) continue;
      for (let ea = 0; ea < a.length; ea++) {
        const a1 = a[ea];
        const a2 = a[(ea + 1) % a.length];
        const adx = a2.x - a1.x;
        const ady = a2.y - a1.y;
        const alen = Math.hypot(adx, ady);
        if (alen < 3) continue;
        const ux = adx / alen;
        const uy = ady / alen;
        const nx = -uy;
        const ny = ux;
        for (let eb = 0; eb < b.length; eb++) {
          const b1 = b[eb];
          const b2 = b[(eb + 1) % b.length];
          const off1 = (b1.x - a1.x) * nx + (b1.y - a1.y) * ny;
          const off2 = (b2.x - a1.x) * nx + (b2.y - a1.y) * ny;
          if (Math.abs(off1) > 1.9 || Math.abs(off2) > 1.9) continue;
          const proj = (point: Point2D) => (point.x - a1.x) * ux + (point.y - a1.y) * uy;
          const bStartT = proj(b1);
          const bEndT = proj(b2);
          const bMin = Math.min(bStartT, bEndT);
          const bMax = Math.max(bStartT, bEndT);
          const overlap = Math.min(alen, bMax) - Math.max(0, bMin);
          const shorter = Math.min(alen, bMax - bMin);
          if (overlap < 4 || overlap / shorter < 0.82) continue;

          const qStart = bStartT <= bEndT ? b1 : b2;
          const qEnd = bStartT <= bEndT ? b2 : b1;
          const c1 = { x: (a1.x + qStart.x) / 2, y: (a1.y + qStart.y) / 2 };
          const c2 = { x: (a2.x + qEnd.x) / 2, y: (a2.y + qEnd.y) / 2 };
          const startIndex = bStartT <= bEndT ? eb : (eb + 1) % b.length;
          const endIndex = bStartT <= bEndT ? (eb + 1) % b.length : eb;
          add(i, ea, c1.x, c1.y);
          add(i, (ea + 1) % a.length, c2.x, c2.y);
          add(j, startIndex, c1.x, c1.y);
          add(j, endIndex, c2.x, c2.y);
          sharedEdges.push({
            regionA: loops[i].regionId,
            regionB: loops[j].regionId,
            x1: c1.x,
            y1: c1.y,
            x2: c2.x,
            y2: c2.y,
          });
        }
      }
    }
  }

  for (const [key, value] of acc) {
    const [loopIndex, vertexIndex] = key.split(':').map(Number);
    const points = loops[loopIndex].points;
    if (!points) continue;
    points[vertexIndex] = { x: value.x / value.w, y: value.y / value.w };
  }

  const geoms = loops.map((loop) => {
    if (!loop.points) return loop.geom;
    if (loop.geom.type === 'circle') return loop.geom;
    const rect = asRect(loop.points);
    if (rect) return rect;
    const cleaned = loop.points.filter((point, index) => {
      const prev = loop.points![(index - 1 + loop.points!.length) % loop.points!.length];
      return Math.hypot(point.x - prev.x, point.y - prev.y) > 0.05;
    });
    if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 1) {
      return { type: 'polygon' as const, points: cleaned };
    }
    return loop.geom;
  });

  return { geoms, sharedEdges };
}
