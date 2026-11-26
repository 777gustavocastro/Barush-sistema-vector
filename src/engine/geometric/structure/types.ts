import type { Point2D } from '../contract/geometricContract';

export interface ThicknessProfile {
  samples: number;
  medianPx: number;
  meanPx: number;
  stdPx: number;
  stdRatio: number;
  minPx: number;
  maxPx: number;
  maxBiasPx: number;
  withinContract: boolean;
}

export type LoopGeom =
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'roundrect'; x: number; y: number; width: number; height: number; rx: number; ry: number }
  | { type: 'polygon'; points: Point2D[] }
  | { type: 'composite'; segments: Array<
      | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
      | {
          kind: 'arc';
          cx: number;
          cy: number;
          rx: number;
          ry: number;
          rotationDeg: number;
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          largeArc: 0 | 1;
          sweep: 0 | 1;
          startAngleRad: number;
          endAngleRad: number;
        }
    > };

export interface SharedEdge {
  regionA: number;
  regionB: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StructureElement {
  id: number;
  fillHex: string;
  pixelCount: number;
  representation: 'fill' | 'stroke';
  holeCount: number;
  openCavityCount: number;
  outerArea: number;
  holeAreas: number[];
  thickness: ThicknessProfile;
  svg: string;
  pathD: string | null;
  summary: string;
}

export interface StructureReconstruction {
  width: number;
  height: number;
  bgHex: string;
  elements: StructureElement[];
  sharedEdges: SharedEdge[];
  /** SVG completo, com o retângulo de fundo. */
  svg: string;
  /** Somente as formas, sem pintar o fundo e sem tampar furos. */
  shapeSvg: string;
}
