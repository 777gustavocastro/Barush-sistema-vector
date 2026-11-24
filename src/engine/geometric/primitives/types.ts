import type { ErrorStats, Point2D } from '../contract/geometricContract';

export interface LinePrimitive {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  maxErrorPx: number;
  meanErrorPx: number;
}

export interface RectPrimitive {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
  rotationDeg?: number;
  maxErrorPx: number;
  meanErrorPx: number;
}

export interface CirclePrimitive {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
  maxErrorPx: number;
  meanErrorPx: number;
}

export interface EllipsePrimitive {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotationDeg: number;
  maxErrorPx: number;
  meanErrorPx: number;
}

export interface ArcPrimitive {
  kind: 'arc';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotationDeg: number;
  startAngleRad: number;
  endAngleRad: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  largeArc: 0 | 1;
  sweep: 0 | 1;
  maxErrorPx: number;
  meanErrorPx: number;
}

export interface PolygonPrimitive {
  kind: 'polygon';
  vertices: Point2D[];
  closed: boolean;
  maxErrorPx: number;
  meanErrorPx: number;
}

export type CompositeSegment = LinePrimitive | ArcPrimitive;

export interface CompositePrimitive {
  kind: 'composite';
  closed: boolean;
  segments: CompositeSegment[];
  maxErrorPx: number;
  meanErrorPx: number;
}

export type GeometricPrimitive =
  | LinePrimitive
  | RectPrimitive
  | CirclePrimitive
  | EllipsePrimitive
  | ArcPrimitive
  | PolygonPrimitive
  | CompositePrimitive;

export interface MaskValidationMetrics {
  iou: number;
  recall: number;
  precision: number;
}

export interface PrimitiveReconstructionResult {
  primitive: GeometricPrimitive | null;
  accepted: boolean;
  reason: string;
  error: ErrorStats;
  maskMetrics?: MaskValidationMetrics;
  svgElement: string | null;
}

export interface SubpixelBoundaryLoop {
  points: Point2D[];
  isHole: boolean;
  areaPx: number;
}

export interface ExtractedRegionBoundary {
  regionId: number;
  fillHex: string;
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  loops: SubpixelBoundaryLoop[];
}

export function fmtNum(value: number, decimals = 3): string {
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
