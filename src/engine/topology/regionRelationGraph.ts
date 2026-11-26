import type { SegmentedSubRegion } from '../opencv/opencvSegmenter';
import type { RegionVectorGeometry } from './planarTopologyGraph';

export type RegionRole =
  | 'background'
  | 'fill'
  | 'contour'
  | 'interior'
  | 'shadow'
  | 'reflection'
  | 'gradient'
  | 'transparency';

export interface RegionRelationNode {
  regionId: number;
  role: RegionRole;
  adjacentRegionIds: number[];
  enclosedByRegionId: number;
  touchesBackground: boolean;
  holeLoopCount: number;
  usesEvenOdd: boolean;
}

function roleOf(sub: SegmentedSubRegion): RegionRole {
  if (sub.isSoftShadow || sub.nature === 'shadow') return 'shadow';
  if (sub.isMetallicOrSpecular || sub.nature === 'reflection_metallic') return 'reflection';
  if (sub.isSemiTransparent || sub.nature === 'translucent') return 'transparency';
  if (sub.nature === 'gradient') return 'gradient';
  const thin =
    sub.pixelCount >= 8 &&
    sub.pixelCount <= 4000 &&
    Math.max(sub.maxX - sub.minX, sub.maxY - sub.minY) /
      Math.max(1, Math.min(sub.maxX - sub.minX, sub.maxY - sub.minY)) >=
      2.4;
  if (thin && sub.enclosedByRegionId === 0) return 'contour';
  if (sub.enclosedByRegionId > 0) return 'interior';
  return 'fill';
}

/**
 * Mapa das regiões já segmentadas e das fronteiras que elas compartilham.
 * O fundo é o nó 0. A geometria de cada fronteira continua única no grafo planar.
 */
export function buildRegionRelationGraph(
  regions: SegmentedSubRegion[],
  geometries: Map<number, RegionVectorGeometry>
): RegionRelationNode[] {
  const nodes: RegionRelationNode[] = [
    {
      regionId: 0,
      role: 'background',
      adjacentRegionIds: [],
      enclosedByRegionId: 0,
      touchesBackground: false,
      holeLoopCount: 0,
      usesEvenOdd: false,
    },
  ];
  const bgNeighbors = new Set<number>();

  for (const sub of regions) {
    const geom = geometries.get(sub.id);
    if (sub.touchesExteriorBg) bgNeighbors.add(sub.id);
    nodes.push({
      regionId: sub.id,
      role: roleOf(sub),
      adjacentRegionIds: [...sub.adjacentRegionIds],
      enclosedByRegionId: sub.enclosedByRegionId,
      touchesBackground: sub.touchesExteriorBg,
      holeLoopCount: geom?.holeLoopCount ?? 0,
      usesEvenOdd: geom?.usesEvenOdd ?? false,
    });
  }

  nodes[0].adjacentRegionIds = [...bgNeighbors];
  return nodes;
}
