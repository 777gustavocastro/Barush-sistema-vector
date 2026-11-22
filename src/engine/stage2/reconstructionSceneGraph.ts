import type { RawRgbaImage } from '../types';
import type { RegionVisualNature } from '../opencv/opencvSegmenter';

export interface BoundingBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SceneRegionNode {
  regionId: number;
  parentObjectId: number;
  svgPathId: string;
  nature: RegionVisualNature;
  pixelCount: number;
  boundingBox: BoundingBox2D;
  fillKind: 'solid' | 'linear' | 'radial' | 'compound' | 'subdivided';
  fillValue: string;
  fillOpacity?: number;
  meanOklab: [number, number, number];
  fitMeanDeltaEOklab: number;
  usesEvenOdd: boolean;
  holeLoopCount: number;
  enclosedByRegionId: number;
  adjacentRegionIds: number[];
}

export interface SceneObjectNode {
  objectId: number;
  svgGroupId: string;
  descriptiveName: string;
  dominantNature: RegionVisualNature;
  boundingBox: BoundingBox2D;
  totalPixelArea: number;
  clipPathId?: string;
  regions: SceneRegionNode[];
}

export interface SceneTopologySummary {
  totalObjects: number;
  totalRegions: number;
  sharedCanonicalBoundaries: number;
  junctionVertices: number;
  clipPathsGenerated: number;
  interiorHolesPreserved: number;
  compoundOrSubdividedGradients: number;
  uncoveredForegroundPixels: number;
}

export interface VectorReconstructionSceneGraph {
  width: number;
  height: number;
  hasUniformOpaqueBackground: boolean;
  backgroundHex: string | null;
  objects: SceneObjectNode[];
  typographyObjectIds: string[];
  topologySummary: SceneTopologySummary;
  svgMarkup: string;
}

export type Stage2DefectCategory =
  | 'color_bleeding'
  | 'boundary_gap'
  | 'missing_hole'
  | 'excess_fragmentation'
  | 'gradient_discontinuity'
  | 'contour_deformation'
  | 'missing_small_detail';

export interface Stage2DetectedDefect {
  defectId: string;
  category: Stage2DefectCategory;
  severity: 'low' | 'medium' | 'high';
  affectedObjectId?: number;
  affectedRegionId?: number;
  boundingBox: BoundingBox2D;
  measuredDeltaEOklab: number;
  description: string;
}

export interface Stage2InspectionReport {
  passed: boolean;
  defects: Stage2DetectedDefect[];
  inspectedRegionCount: number;
}

/**
 * Contrato modular extensível preparado para a Etapa 2 (Detecção Automática de Defeitos,
 * Auto-Correção Localizada de Regiões e Validação Perceptual Iterativa).
 */
export interface Stage2VerificationHook {
  readonly id: string;
  readonly name: string;
  inspectScene(
    scene: VectorReconstructionSceneGraph,
    originalImage: RawRgbaImage,
    renderedCandidate?: RawRgbaImage | null
  ): Promise<Stage2InspectionReport> | Stage2InspectionReport;
  autoRepairScene?(
    scene: VectorReconstructionSceneGraph,
    report: Stage2InspectionReport,
    originalImage: RawRgbaImage
  ): Promise<VectorReconstructionSceneGraph | null> | VectorReconstructionSceneGraph | null;
}

const registeredStage2Hooks: Stage2VerificationHook[] = [];

export function registerStage2VerificationHook(hook: Stage2VerificationHook): void {
  const existingIdx = registeredStage2Hooks.findIndex((h) => h.id === hook.id);
  if (existingIdx >= 0) {
    registeredStage2Hooks[existingIdx] = hook;
  } else {
    registeredStage2Hooks.push(hook);
  }
}

export function getRegisteredStage2Hooks(): ReadonlyArray<Stage2VerificationHook> {
  return registeredStage2Hooks;
}
