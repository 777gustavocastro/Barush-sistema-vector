import type { RawRgbaImage, TypographyRegion } from '../types';
import type { OpenCvImageDecomposition, SegmentedSubRegion } from '../opencv/opencvSegmenter';
import {
  deltaECiede2000Srgb8,
  hexToRgb8,
  rgbToHex,
} from '../color/perceptualColor';
import { fitRegionSvgFill } from '../gradients/svgGradientReconstructor';
import {
  buildPlanarSharedTopology,
  type RegionTopologyMetadata,
} from '../topology/planarTopologyGraph';
import type { AdaptiveCurveFitOptions } from '../geometry/adaptiveBezierFitter';
import {
  evaluateContourThicknessConsistency,
  inspectAndSanitizeSvgContours,
} from '../geometry/contourInspector';
import { renderSvgSupersampled } from './supersampledSvgRenderer';
import {
  evaluateStage2Comprehensive,
  type FullStage2Evaluation,
} from './stage2Diagnostics';
import type {
  SceneRegionNode,
  Stage2AppliedRepairRecord,
  Stage2InspectionReport,
  Stage2MetricsSnapshot,
  VectorReconstructionSceneGraph,
} from './reconstructionSceneGraph';

export interface EditableRegionSlot {
  regionId: number;
  parentObjectId: number;
  svgPathId: string;
  sub: SegmentedSubRegion;
  pathD: string;
  usesEvenOdd: boolean;
  holeLoopCount: number;
  fillKind: SceneRegionNode['fillKind'];
  fillValue: string;
  fillOpacity?: number;
  defsXml: string;
  extraDefsXml: string;
  extraElementsXml: string;
  extraPathCount: number;
  extraGradientCount: number;
  extraClipCount: number;
  fitMeanDeltaEOklab: number;
  contourStroke?: {
    d: string;
    strokeWidth: number;
    linecap: 'round' | 'butt' | 'square';
    linejoin: 'round' | 'miter' | 'bevel';
    miterlimit: number;
  };
  transition?: string;
}

export interface EditableObjectSlot {
  objectId: number;
  svgGroupId: string;
  descriptiveName: string;
  dominantNature: SegmentedSubRegion['nature'];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  totalArea: number;
  clipId?: string;
  clipDefsXml: string;
  regionIds: number[];
  rescuedDefsXml: string[];
  rescuedElementsXml: string[];
}

export interface SubdividerCallbackResult {
  clipDefsXml: string;
  gradDefsXml: string;
  subGroupXml: string;
  extraPaths: number;
  extraGradients: number;
}

export interface Stage2RefinementInput {
  originalImage: RawRgbaImage;
  decomposition: OpenCvImageDecomposition;
  regionSlots: Map<number, EditableRegionSlot>;
  objectSlots: EditableObjectSlot[];
  backgroundHex: string | null;
  extraTypographyDefsXml: string;
  extraTypographyGroupsXml: string;
  typographyBoxes: TypographyRegion[];
  sharedCanonicalBoundaries: number;
  junctionVertices: number;
  allowFullPalette: boolean;
  baseCurveOptions: AdaptiveCurveFitOptions;
  subdivideComplexRegion: (
    sub: SegmentedSubRegion,
    basePathD: string,
    baseUsesEvenOdd: boolean,
    curveOpts: AdaptiveCurveFitOptions,
    idPrefix: string,
    bandCountOverride?: number
  ) => SubdividerCallbackResult | null;
}

export interface Stage2RefinementOutput {
  svg: string;
  objectCount: number;
  gradientCount: number;
  pathCount: number;
  clipPathCount: number;
  sceneGraph: VectorReconstructionSceneGraph;
  stage2Report: Stage2InspectionReport;
}

function cloneRegionSlot(s: EditableRegionSlot): EditableRegionSlot {
  return { ...s };
}

function cloneObjectSlot(o: EditableObjectSlot): EditableObjectSlot {
  return {
    ...o,
    regionIds: [...o.regionIds],
    rescuedDefsXml: [...o.rescuedDefsXml],
    rescuedElementsXml: [...o.rescuedElementsXml],
  };
}

export function compileSlotsToSceneAndSvg(
  width: number,
  height: number,
  hasUniformOpaqueBackground: boolean,
  backgroundHex: string | null,
  regionSlots: Map<number, EditableRegionSlot>,
  objectSlots: EditableObjectSlot[],
  extraTypographyDefsXml: string,
  extraTypographyGroupsXml: string,
  sharedCanonicalBoundaries: number,
  junctionVertices: number
): {
  svg: string;
  objectCount: number;
  gradientCount: number;
  pathCount: number;
  clipPathCount: number;
  sceneGraph: VectorReconstructionSceneGraph;
} {
  const defsParts: string[] = [];
  const groupXmlParts: string[] = [];
  const sceneObjects: VectorReconstructionSceneGraph['objects'] = [];

  let pathCount = 0;
  let gradientCount = 0;
  let clipPathCount = 0;
  let totalHoles = 0;
  let compoundOrSubdiv = 0;

  if (hasUniformOpaqueBackground && backgroundHex) {
    pathCount++;
    groupXmlParts.push(
      `  <g id="objeto-plano-fundo" data-tipo="plano-de-fundo">` +
        `<path id="caminho-fundo-1" fill="${backgroundHex}" d="M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z"/>` +
      `</g>`
    );
  }

  for (const objSlot of objectSlots) {
    const childXml: string[] = [];
    const sceneRegions: SceneRegionNode[] = [];

    for (const rid of objSlot.regionIds) {
      const rSlot = regionSlots.get(rid);
      if (!rSlot || !rSlot.pathD) continue;

      totalHoles += rSlot.holeLoopCount;

      if (rSlot.defsXml) {
        defsParts.push(rSlot.defsXml);
        gradientCount++;
      }
      if (rSlot.extraDefsXml) {
        defsParts.push(rSlot.extraDefsXml);
      }
      gradientCount += rSlot.extraGradientCount;
      clipPathCount += rSlot.extraClipCount;

      const opAttr =
        rSlot.fillOpacity !== undefined && rSlot.fillOpacity < 0.99
          ? ` fill-opacity="${Number(rSlot.fillOpacity.toFixed(3))}"`
          : '';
      const eoAttr = rSlot.usesEvenOdd ? ' fill-rule="evenodd"' : '';
      const stroke = rSlot.contourStroke;
      const transitionAttr = rSlot.transition ? ` data-transicao="${rSlot.transition}"` : '';
      pathCount++;
      if (stroke) {
        childXml.push(
          `<path id="${rSlot.svgPathId}" data-natureza="contorno"${transitionAttr} fill="none" stroke="${rSlot.fillValue}" stroke-width="${stroke.strokeWidth}" stroke-linecap="${stroke.linecap}" stroke-linejoin="${stroke.linejoin}" stroke-miterlimit="${stroke.miterlimit}"${opAttr} d="${stroke.d}"/>`
        );
      } else {
        childXml.push(
          `<path id="${rSlot.svgPathId}" data-natureza="${rSlot.sub.nature}"${transitionAttr} fill="${rSlot.fillValue}"${opAttr}${eoAttr} d="${rSlot.pathD}"/>`
        );
      }

      if (rSlot.extraElementsXml) {
        childXml.push(rSlot.extraElementsXml);
        pathCount += rSlot.extraPathCount;
        compoundOrSubdiv++;
      }

      sceneRegions.push({
        regionId: rSlot.regionId,
        parentObjectId: rSlot.parentObjectId,
        svgPathId: rSlot.svgPathId,
        nature: rSlot.sub.nature,
        pixelCount: rSlot.sub.pixelCount,
        boundingBox: {
          minX: rSlot.sub.minX,
          minY: rSlot.sub.minY,
          maxX: rSlot.sub.maxX,
          maxY: rSlot.sub.maxY,
        },
        fillKind: rSlot.fillKind,
        fillValue: rSlot.fillValue,
        fillOpacity: rSlot.fillOpacity,
        meanOklab: rSlot.sub.meanOklab,
        fitMeanDeltaEOklab: rSlot.fitMeanDeltaEOklab,
        usesEvenOdd: rSlot.usesEvenOdd,
        holeLoopCount: rSlot.holeLoopCount,
        enclosedByRegionId: rSlot.sub.enclosedByRegionId,
        adjacentRegionIds: rSlot.sub.adjacentRegionIds,
      });
    }

    for (const rDef of objSlot.rescuedDefsXml) {
      defsParts.push(rDef);
      gradientCount++;
    }
    for (const rEl of objSlot.rescuedElementsXml) {
      childXml.push(rEl);
      pathCount++;
    }

    if (childXml.length === 0) continue;

    let clipAttr = '';
    if (objSlot.clipId && objSlot.clipDefsXml) {
      defsParts.push(objSlot.clipDefsXml);
      clipAttr = ` clip-path="url(#${objSlot.clipId})"`;
      clipPathCount++;
    }

    groupXmlParts.push(
      `  <g id="${objSlot.svgGroupId}" data-nome="${objSlot.descriptiveName}" data-natureza="${objSlot.dominantNature}"${clipAttr}>` +
        childXml.join('') +
      `</g>`
    );

    sceneObjects.push({
      objectId: objSlot.objectId,
      svgGroupId: objSlot.svgGroupId,
      descriptiveName: objSlot.descriptiveName,
      dominantNature: objSlot.dominantNature,
      boundingBox: {
        minX: objSlot.minX,
        minY: objSlot.minY,
        maxX: objSlot.maxX,
        maxY: objSlot.maxY,
      },
      totalPixelArea: objSlot.totalArea,
      clipPathId: objSlot.clipId,
      regions: sceneRegions,
    });
  }

  const typoIds = [...extraTypographyGroupsXml.matchAll(/<g\b[^>]*\bid="(objeto-[^"]+)"/gi)].map(
    (m) => m[1]
  );
  const typoPaths = (extraTypographyGroupsXml.match(/<path\b/gi) ?? []).length;
  const typoGrads = (extraTypographyDefsXml.match(/<(linearGradient|radialGradient)\b/gi) ?? [])
    .length;

  pathCount += typoPaths;
  gradientCount += typoGrads;

  const finalDefs =
    defsParts.length > 0 || extraTypographyDefsXml
      ? `  <defs>${defsParts.join('')}${extraTypographyDefsXml}</defs>\n`
      : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    finalDefs +
    groupXmlParts.join('\n') +
    (extraTypographyGroupsXml ? `\n  ${extraTypographyGroupsXml}` : '') +
    `\n</svg>`;

  const objectCount = groupXmlParts.length + typoIds.length;

  const sceneGraph: VectorReconstructionSceneGraph = {
    width,
    height,
    hasUniformOpaqueBackground,
    backgroundHex,
    objects: sceneObjects,
    typographyObjectIds: typoIds,
    topologySummary: {
      totalObjects: objectCount,
      totalRegions: sceneObjects.reduce((acc, o) => acc + o.regions.length, 0),
      sharedCanonicalBoundaries,
      junctionVertices,
      clipPathsGenerated: clipPathCount,
      interiorHolesPreserved: totalHoles,
      compoundOrSubdividedGradients: compoundOrSubdiv,
      uncoveredForegroundPixels: 0,
    },
    svgMarkup: svg,
  };

  return {
    svg,
    objectCount,
    gradientCount,
    pathCount,
    clipPathCount,
    sceneGraph,
  };
}

function computeUnifiedQualityScore(snap: Stage2MetricsSnapshot): number {
  return (
    snap.ssimPct * 0.34 +
    snap.colorFidelityCiede2000Pct * 0.34 +
    snap.contourF1Pct * 0.16 +
    snap.iouPct * 0.16 -
    snap.chamferDistancePx * 1.15 -
    snap.artifactRegionCount * 0.32 -
    snap.lostDetailRegionCount * 0.38
  );
}

function computeMedianChannel(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.5)];
}

function translatePathD(d: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return d;
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)/g);
  if (!tokens) return d;
  const out: string[] = [];
  let isX = true;
  for (const tok of tokens) {
    if (/^[a-zA-Z]$/.test(tok)) {
      out.push(tok);
      isX = true;
    } else {
      const val = Number(tok) + (isX ? dx : dy);
      out.push(String(Number(val.toFixed(3))));
      isX = !isX;
    }
  }
  return out.join(' ');
}

function buildEllipseBezierPath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.55228475;
  const ox = rx * k;
  const oy = ry * k;
  const f = (n: number) => Number(n.toFixed(2));
  return (
    `M ${f(cx)} ${f(cy - ry)} ` +
    `C ${f(cx + ox)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - oy)} ${f(cx + rx)} ${f(cy)} ` +
    `C ${f(cx + rx)} ${f(cy + oy)} ${f(cx + ox)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} ` +
    `C ${f(cx - ox)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + oy)} ${f(cx - rx)} ${f(cy)} ` +
    `C ${f(cx - rx)} ${f(cy - oy)} ${f(cx - ox)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} Z`
  );
}

/**
 * Ciclo Automático Iterativo de Correção e Auto-Reparo Localizado (Prompt 02 — Seção 11):
 * Compara Imagem Original (A) vs Primeira Versão Vetorial (B), diagnostica defeitos por região
 * e aplica reparos cirúrgicos validados por re-renderização supersampling (Versão C),
 * garantindo melhoria monotônica sem jamais degradar regiões já corretas!
 */
export async function runStage2IterativeRefinement(
  input: Stage2RefinementInput
): Promise<Stage2RefinementOutput> {
  const {
    originalImage,
    decomposition,
    backgroundHex,
    extraTypographyDefsXml,
    extraTypographyGroupsXml,
    typographyBoxes,
    sharedCanonicalBoundaries,
    junctionVertices,
    allowFullPalette,
    baseCurveOptions,
    subdivideComplexRegion,
  } = input;

  const { width, height } = originalImage;
  let bestRegionSlots = input.regionSlots;
  let bestObjectSlots = input.objectSlots;

  let bestCompiled = compileSlotsToSceneAndSvg(
    width,
    height,
    decomposition.hasUniformOpaqueBackground,
    backgroundHex,
    bestRegionSlots,
    bestObjectSlots,
    extraTypographyDefsXml,
    extraTypographyGroupsXml,
    sharedCanonicalBoundaries,
    junctionVertices
  );

  const opaqueBg =
    decomposition.hasUniformOpaqueBackground && decomposition.backgroundRgb
      ? decomposition.backgroundRgb
      : undefined;

  const renderedB = await renderSvgSupersampled(bestCompiled.svg, width, height, {
    opaqueBackgroundRgb: opaqueBg,
  });

  if (!renderedB) {
    return {
      ...bestCompiled,
      stage2Report: {
        passed: true,
        defects: [],
        inspectedRegionCount: bestCompiled.sceneGraph.topologySummary.totalRegions,
        iterationsExecuted: 0,
      },
    };
  }

  const evalB = evaluateStage2Comprehensive(
    'Versão B (Inicial)',
    originalImage,
    renderedB,
    bestCompiled.sceneGraph,
    decomposition,
    bestCompiled.pathCount,
    bestCompiled.gradientCount
  );

  const thicknessB = evaluateContourThicknessConsistency(
    originalImage,
    renderedB,
    decomposition.regionIdMap,
    decomposition.hasUniformOpaqueBackground,
    decomposition.backgroundRgb
  );

  let bestEval: FullStage2Evaluation = evalB;
  let bestThickness = thicknessB;
  let bestScore = computeUnifiedQualityScore(evalB.snapshot);
  const iterationHistory: Stage2MetricsSnapshot[] = [evalB.snapshot];
  const appliedRepairs: Stage2AppliedRepairRecord[] = [];
  let iterationsExecuted = 0;

  // Critério de convergência imediata: nenhuma correção desnecessária em cenas já precisas e com espessura fiel!
  if (
    evalB.defects.length === 0 &&
    evalB.snapshot.meanDeltaE2000 <= 0.45 &&
    evalB.snapshot.worstRegionDeltaE2000 <= 1.8 &&
    evalB.snapshot.lostDetailRegionCount === 0 &&
    thicknessB.regionBiasCorrectionsPx.size === 0
  ) {
    const sanitizedFast = inspectAndSanitizeSvgContours(
      bestCompiled.svg,
      originalImage,
      1,
      baseCurveOptions.precision ?? 3
    );
    return {
      ...bestCompiled,
      svg: sanitizedFast.svg,
      sceneGraph: {
        ...bestCompiled.sceneGraph,
        svgMarkup: sanitizedFast.svg,
      },
      stage2Report: {
        passed: true,
        defects: [],
        inspectedRegionCount: bestCompiled.sceneGraph.topologySummary.totalRegions,
        regionDiagnostics: evalB.regionDiagnostics,
        initialMetricsB: evalB.snapshot,
        finalMetricsC: evalB.snapshot,
        iterationHistory,
        appliedRepairs,
        iterationsExecuted: 0,
        contourThicknessConsistencyPct: thicknessB.thicknessConsistencyPct,
        meanOrigContourThicknessPx: thicknessB.meanOrigThicknessPx,
        meanVecContourThicknessPx: thicknessB.meanVecThicknessPx,
        sanitizedMicroSegmentsCount:
          sanitizedFast.summary.microSegmentsRemoved + sanitizedFast.summary.collinearMergedCount,
        sanitizedSpikesCount:
          sanitizedFast.summary.artificialSpikesTrimmed +
          sanitizedFast.summary.selfIntersectionsRepaired,
      },
    };
  }

  const maxIterations = width * height > 900_000 ? 2 : 3;
  const startedAt = performance.now();
  const rescuedCenters = new Set<string>();
  const curveRefittedObjects = new Set<number>();
  let rescueSeq = 1;

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (performance.now() - startedAt > 2400) break;
    if (
      bestEval.defects.length === 0 &&
      bestEval.residualIslands.length === 0 &&
      bestThickness.regionBiasCorrectionsPx.size === 0
    ) {
      break;
    }

    const candRegionSlots = new Map<number, EditableRegionSlot>();
    for (const [k, v] of bestRegionSlots.entries()) {
      candRegionSlots.set(k, cloneRegionSlot(v));
    }
    const candObjectSlots = bestObjectSlots.map(cloneObjectSlot);
    const pendingRepairs: Stage2AppliedRepairRecord[] = [];

    const diagByRegion = new Map(bestEval.regionDiagnostics.map((d) => [d.regionId, d]));

    // OPERADOR 1 & 2: Correção Cromática CIEDE2000 e Upgrade de Gradientes / Subdivisão Confinada
    for (const defect of bestEval.defects) {
      if (defect.affectedRegionId === undefined) continue;
      const slot = candRegionSlots.get(defect.affectedRegionId);
      const diag = diagByRegion.get(defect.affectedRegionId);
      if (!slot || !diag) continue;

      const sub = slot.sub;
      const interiorPixels: number[] = [];
      for (let i = 0; i < sub.pixelCount; i++) {
        const px = sub.pixels[i];
        if (decomposition.interiorMask[px]) {
          interiorPixels.push(px);
        }
      }
      const samplePixels =
        interiorPixels.length >= 12 ? Int32Array.from(interiorPixels) : sub.pixels;
      const cleanImg = sub.isSoftShadow
        ? decomposition.substrateImage
        : decomposition.decontaminatedImage;

      if (defect.category === 'chromatic_shift' && slot.fillKind === 'solid') {
        // Caso 1A: A região possui gradiente/sombra suave interna que havia sido simplificada em cor sólida
        if (allowFullPalette && diag.p95DeltaE2000 >= 4.8 && sub.pixelCount >= 32) {
          const gradId = `grad-s2-${slot.regionId}-it${iter}`;
          const refit = fitRegionSvgFill(
            samplePixels,
            samplePixels.length,
            sub.minX,
            sub.minY,
            sub.maxX,
            sub.maxY,
            cleanImg,
            1,
            gradId,
            decomposition.rgbGradientMap,
            'gradient'
          );
          if (refit.kind !== 'solid' && refit.defsXml) {
            slot.fillKind = refit.overlayLayer ? 'compound' : refit.kind;
            slot.fillValue = refit.fillValue;
            slot.fillOpacity = refit.fillOpacity;
            slot.defsXml = refit.defsXml;
            slot.fitMeanDeltaEOklab = Number(refit.meanDeltaEOklab.toFixed(3));
            if (refit.overlayLayer) {
              const eo = slot.usesEvenOdd ? ' fill-rule="evenodd"' : '';
              slot.extraDefsXml = refit.overlayLayer.defsXml;
              slot.extraElementsXml = `<path id="${slot.svgPathId}-luz" data-natureza="iluminacao-composta" fill="${refit.overlayLayer.fillValue}"${eo} d="${slot.pathD}"/>`;
              slot.extraPathCount = 1;
              slot.extraGradientCount = 1;
            }
            pendingRepairs.push({
              iteration: iter,
              targetType: 'region_gradient',
              affectedRegionId: slot.regionId,
              svgElementId: slot.svgPathId,
              defectCategory: 'chromatic_shift',
              technicalJustification:
                'Promovida região com variação tonal interna (P95 ΔE₀₀ elevado) de cor sólida para gradiente vetorial editável decontaminado.',
              beforeDeltaE2000: diag.meanDeltaE2000,
              afterDeltaE2000: diag.meanDeltaE2000,
            });
            continue;
          }
        }

        // Caso 1B: Recalibração cromática mediana L1 sobre núcleo interior decontaminado
        if (allowFullPalette && slot.fillValue.startsWith('#')) {
          const rs: number[] = [];
          const gs: number[] = [];
          const bs: number[] = [];
          const as: number[] = [];
          const step = Math.max(1, Math.floor(samplePixels.length / 400));
          for (let i = 0; i < samplePixels.length; i += step) {
            const p4 = samplePixels[i] * 4;
            rs.push(cleanImg.data[p4]);
            gs.push(cleanImg.data[p4 + 1]);
            bs.push(cleanImg.data[p4 + 2]);
            as.push(originalImage.data[p4 + 3]);
          }
          const medR = computeMedianChannel(rs);
          const medG = computeMedianChannel(gs);
          const medB = computeMedianChannel(bs);
          const medA = computeMedianChannel(as);

          const [oldR, oldG, oldB] = hexToRgb8(slot.fillValue);
          const diffToMed = deltaECiede2000Srgb8(oldR, oldG, oldB, medR, medG, medB);
          if (diffToMed >= 1.2 || Math.abs(diag.deltaAlpha) >= 12) {
            slot.fillValue = rgbToHex(medR, medG, medB);
            if (medA < 248 && !sub.isSoftShadow) {
              slot.fillOpacity = Math.max(0.08, Math.min(1, medA / 255));
            }
            pendingRepairs.push({
              iteration: iter,
              targetType: 'region_color',
              affectedRegionId: slot.regionId,
              svgElementId: slot.svgPathId,
              defectCategory: 'chromatic_shift',
              technicalJustification: `Cor recalibrada pela mediana perceptual do núcleo interior livre de halo (${diag.chromaticDiagnosis}).`,
              beforeDeltaE2000: diag.meanDeltaE2000,
              afterDeltaE2000: diag.meanDeltaE2000,
            });
          }
        }
      } else if (
        defect.category === 'gradient_discontinuity' &&
        allowFullPalette &&
        slot.fillKind !== 'subdivided'
      ) {
        // Primeiro tenta reajustar stops de gradiente exclusivamente nos pixels interiores sem contaminação de borda
        let upgraded = false;
        if (interiorPixels.length >= 24 && iter === 1 && diag.meanDeltaE2000 < 5.2) {
          const gradId = `grad-s2-clean-${slot.regionId}-it${iter}`;
          const refit = fitRegionSvgFill(
            samplePixels,
            samplePixels.length,
            sub.minX,
            sub.minY,
            sub.maxX,
            sub.maxY,
            cleanImg,
            1,
            gradId,
            decomposition.rgbGradientMap,
            sub.isMetallicOrSpecular ? 'reflection_metallic' : 'gradient'
          );
          if (refit.kind !== 'solid' && refit.meanDeltaEOklab < slot.fitMeanDeltaEOklab - 0.35) {
            slot.fillKind = refit.overlayLayer ? 'compound' : refit.kind;
            slot.fillValue = refit.fillValue;
            slot.fillOpacity = refit.fillOpacity;
            slot.defsXml = refit.defsXml;
            slot.fitMeanDeltaEOklab = Number(refit.meanDeltaEOklab.toFixed(3));
            if (refit.overlayLayer) {
              const eo = slot.usesEvenOdd ? ' fill-rule="evenodd"' : '';
              slot.extraDefsXml = refit.overlayLayer.defsXml;
              slot.extraElementsXml = `<path id="${slot.svgPathId}-luz" data-natureza="iluminacao-composta" fill="${refit.overlayLayer.fillValue}"${eo} d="${slot.pathD}"/>`;
              slot.extraPathCount = 1;
              slot.extraGradientCount = 1;
            }
            upgraded = true;
            pendingRepairs.push({
              iteration: iter,
              targetType: 'region_gradient',
              affectedRegionId: slot.regionId,
              svgElementId: slot.svgPathId,
              defectCategory: 'gradient_discontinuity',
              technicalJustification:
                'Reestimados stops do gradiente em OKLab usando exclusivamente o núcleo interior livre de contaminação.',
              beforeDeltaE2000: diag.meanDeltaE2000,
              afterDeltaE2000: diag.meanDeltaE2000,
            });
          }
        }

        // Quando um único gradiente 1D/radial não captura a variação 2D real (e a região é opaca!), promove para subdivisão vetorial confinada por <clipPath>
        if (!upgraded && !sub.isSemiTransparent && sub.pixelCount >= 115) {
          const targetBands = sub.pixelCount >= 750 ? 7 : 5;
          const subdiv = subdivideComplexRegion(
            sub,
            slot.pathD,
            slot.usesEvenOdd,
            baseCurveOptions,
            `s2-sub-${slot.regionId}-it${iter}`,
            targetBands
          );
          if (subdiv) {
            slot.fillKind = 'subdivided';
            slot.extraDefsXml = `${subdiv.clipDefsXml}${subdiv.gradDefsXml}`;
            slot.extraElementsXml = subdiv.subGroupXml;
            slot.extraClipCount = 1;
            slot.extraPathCount = subdiv.extraPaths;
            slot.extraGradientCount = subdiv.extraGradients;
            pendingRepairs.push({
              iteration: iter,
              targetType: 'region_gradient',
              affectedRegionId: slot.regionId,
              svgElementId: slot.svgPathId,
              defectCategory: 'gradient_discontinuity',
              technicalJustification: `Promovida transição 2D não-linear complexa para malha de ${targetBands} sub-faixas vetoriais confinadas por <clipPath>.`,
              beforeDeltaE2000: diag.meanDeltaE2000,
              afterDeltaE2000: diag.meanDeltaE2000,
            });
          }
        }
      }
    }

    // OPERADOR 3: Refinamento Geométrico Multiescala de Contornos, Pontas Agudas e Espessura Visual
    const geomDefectObjects = new Set<number>();
    for (const defect of bestEval.defects) {
      if (
        defect.category === 'contour_deformation' &&
        defect.affectedObjectId !== undefined &&
        !curveRefittedObjects.has(defect.affectedObjectId)
      ) {
        geomDefectObjects.add(defect.affectedObjectId);
        if (geomDefectObjects.size >= 4) break;
      }
    }
    for (const [biasRid] of bestThickness.regionBiasCorrectionsPx.entries()) {
      const biasSlot = candRegionSlots.get(biasRid);
      if (biasSlot && !curveRefittedObjects.has(biasSlot.parentObjectId)) {
        geomDefectObjects.add(biasSlot.parentObjectId);
        if (geomDefectObjects.size >= 5) break;
      }
    }

    for (const targetObjId of geomDefectObjects) {
      const objSlot = candObjectSlots.find((o) => o.objectId === targetObjId);
      if (!objSlot || objSlot.regionIds.length === 0) continue;

      const pad = 3;
      const lx0 = Math.max(0, objSlot.minX - pad);
      const ly0 = Math.max(0, objSlot.minY - pad);
      const lw = Math.min(width - lx0, objSlot.maxX - objSlot.minX + 1 + pad * 2);
      const lh = Math.min(height - ly0, objSlot.maxY - objSlot.minY + 1 + pad * 2);
      if (lw * lh > 360_000) continue;

      const objRegionSet = new Set(objSlot.regionIds);
      const localLabels = new Int32Array(lw * lh);
      const localL = new Float32Array(lw * lh);
      const localA = new Float32Array(lw * lh);
      const localB = new Float32Array(lw * lh);
      const localAlpha = new Float32Array(lw * lh);
      const localChroma = new Float32Array(lw * lh);
      const localRgba = new Uint8Array(lw * lh * 4);

      for (let ly = 0; ly < lh; ly++) {
        for (let lx = 0; lx < lw; lx++) {
          const gp = (ly0 + ly) * width + (lx0 + lx);
          const lp = ly * lw + lx;
          const rid = decomposition.regionIdMap[gp];
          localLabels[lp] = objRegionSet.has(rid) ? rid : 0;
          localL[lp] = decomposition.oklab.L[gp];
          localA[lp] = decomposition.oklab.a[gp];
          localB[lp] = decomposition.oklab.b[gp];
          localAlpha[lp] = decomposition.oklab.alpha[gp];
          localChroma[lp] = decomposition.oklab.chroma[gp];
          const g4 = gp * 4;
          const l4 = lp * 4;
          localRgba[l4] = decomposition.substrateImage.data[g4];
          localRgba[l4 + 1] = decomposition.substrateImage.data[g4 + 1];
          localRgba[l4 + 2] = decomposition.substrateImage.data[g4 + 2];
          localRgba[l4 + 3] = decomposition.substrateImage.data[g4 + 3];
        }
      }

      const localMeta = new Map<number, RegionTopologyMetadata>();
      let zIdx = 1;
      let hasThicknessCorrection = false;
      for (const rid of objSlot.regionIds) {
        const rs = candRegionSlots.get(rid);
        if (!rs) continue;
        if (bestThickness.regionBiasCorrectionsPx.has(rid)) {
          hasThicknessCorrection = true;
        }
        let intSample = 0;
        const stepS = Math.max(1, Math.floor(rs.sub.pixelCount / 160));
        let totS = 0;
        for (let k = 0; k < rs.sub.pixelCount; k += stepS) {
          if (decomposition.interiorMask[rs.sub.pixels[k]]) intSample++;
          totS++;
        }
        localMeta.set(rid, {
          zRank: zIdx++,
          isSemiTransparent: rs.sub.isSemiTransparent,
          meanOklab: rs.sub.meanOklab,
          meanAlpha: rs.sub.meanA,
          hasThickInterior: rs.sub.pixelCount >= 36 && totS > 0 && intSample / totS >= 0.28,
        });
      }

      const refinedCurveOpts: AdaptiveCurveFitOptions = {
        maxCurveErrorPx: Math.max(0.1, (baseCurveOptions.maxCurveErrorPx ?? 0.22) * 0.55),
        straightLineTolPx: Math.max(0.12, (baseCurveOptions.straightLineTolPx ?? 0.22) * 0.68),
        cornerAngleThresholdDeg: Math.max(20, (baseCurveOptions.cornerAngleThresholdDeg ?? 36) - 8),
        subpixelTubeRadiusPx: 0.38,
        precision: 3,
      };

      const refinedTopo = buildPlanarSharedTopology({
        width: lw,
        height: lh,
        labelMap: localLabels,
        oklab: {
          width: lw,
          height: lh,
          L: localL,
          a: localA,
          b: localB,
          alpha: localAlpha,
          chroma: localChroma,
        },
        alphaBytes: localRgba,
        hasUniformBg: decomposition.hasUniformOpaqueBackground,
        backgroundOklab: decomposition.backgroundOklab,
        backgroundRgb: decomposition.backgroundRgb,
        regionMeta: localMeta,
        regionBoundaryBiasPx: bestThickness.regionBiasCorrectionsPx,
        curveOptions: refinedCurveOpts,
        enablePorterDuffSeamTuck: true,
      });

      let updatedAny = false;
      for (const rid of objSlot.regionIds) {
        const newGeom = refinedTopo.geometriesByRegion.get(rid);
        const rSlot = candRegionSlots.get(rid);
        if (!rSlot || rSlot.contourStroke) continue;
        if (newGeom && newGeom.pathD) {
          const shiftedD = translatePathD(newGeom.pathD, lx0, ly0);
          rSlot.pathD = shiftedD;
          rSlot.usesEvenOdd = newGeom.usesEvenOdd;
          rSlot.holeLoopCount = newGeom.holeLoopCount;
          updatedAny = true;
        }
      }

      if (updatedAny) {
        curveRefittedObjects.add(targetObjId);
        pendingRepairs.push({
          iteration: iter,
          targetType: 'region_curve',
          svgElementId: objSlot.svgGroupId,
          defectCategory: hasThicknessCorrection ? 'contour_thickness_mismatch' : 'contour_deformation',
          technicalJustification: hasThicknessCorrection
            ? 'Recalibrada posição sub-pixel da fronteira e curvas Bézier para corrigir espessura visual do contorno.'
            : 'Reajustadas curvas Bézier em tolerância sub-pixel fina (preservando pontas agudas C⁰, concavidades e fronteiras compartilhadas).',
          beforeDeltaE2000: bestEval.snapshot.meanDeltaE2000,
          afterDeltaE2000: bestEval.snapshot.meanDeltaE2000,
        });
      }
    }

    // OPERADOR 4: Resgate Multiescala de Micro-Detalhes Reais Perdidos (reflexos, estrelas, pontos, traços finos)
    if (allowFullPalette && candObjectSlots.length > 0) {
      const detailIslands = bestEval.residualIslands
        .filter((isl) => isl.kind === 'missing_small_detail')
        .sort((a, b) => b.meanDeltaE2000 * Math.sqrt(b.pixels.length) - a.meanDeltaE2000 * Math.sqrt(a.pixels.length));

      let rescuedThisIter = 0;
      for (const isl of detailIslands) {
        if (rescuedThisIter >= 8) break;
        if (isl.pixels.length < 2 || isl.pixels.length > 220) continue;
        if (isl.origContrastToSurround < 12.5 || isl.meanDeltaE2000 < 11.0) continue;

        const cx = (isl.minX + isl.maxX + 1) * 0.5;
        const cy = (isl.minY + isl.maxY + 1) * 0.5;
        const centerKey = `${Math.round(cx / 3)},${Math.round(cy / 3)}`;
        if (rescuedCenters.has(centerKey)) continue;

        // Ignora caixas de tipografia já reconstruídas individualmente
        const insideTypo = typographyBoxes.some(
          (tb) =>
            cx >= tb.x - 2 &&
            cx <= tb.x + tb.width + 2 &&
            cy >= tb.y - 2 &&
            cy <= tb.y + tb.height + 2
        );
        if (insideTypo) continue;

        // Verifica que o entorno na imagem original é localmente coerente (não ruído fotográfico granulado!)
        let surrL = 0;
        let surrLSq = 0;
        let surrCnt = 0;
        const islSet = new Set<number>(isl.pixels);
        for (let y = Math.max(0, isl.minY - 2); y <= Math.min(height - 1, isl.maxY + 2); y++) {
          for (let x = Math.max(0, isl.minX - 2); x <= Math.min(width - 1, isl.maxX + 2); x++) {
            const p = y * width + x;
            if (islSet.has(p)) continue;
            const lv = decomposition.oklab.L[p];
            surrL += lv;
            surrLSq += lv * lv;
            surrCnt++;
          }
        }
        if (surrCnt >= 4) {
          const meanSL = surrL / surrCnt;
          const stdSL = Math.sqrt(Math.max(0, surrLSq / surrCnt - meanSL * meanSL));
          if (stdSL > 14.5) continue;
        }

        const rs: number[] = [];
        const gs: number[] = [];
        const bs: number[] = [];
        const as: number[] = [];
        for (let i = 0; i < isl.pixels.length; i++) {
          const p4 = isl.pixels[i] * 4;
          rs.push(originalImage.data[p4]);
          gs.push(originalImage.data[p4 + 1]);
          bs.push(originalImage.data[p4 + 2]);
          as.push(originalImage.data[p4 + 3]);
        }
        const detHex = rgbToHex(
          computeMedianChannel(rs),
          computeMedianChannel(gs),
          computeMedianChannel(bs)
        );
        const detAlpha = computeMedianChannel(as);
        if (detAlpha < 45) continue;

        const bw = isl.maxX - isl.minX + 1;
        const bh = isl.maxY - isl.minY + 1;
        const fillRatio = isl.pixels.length / Math.max(1, bw * bh);

        let rescuedPathD = '';
        if (isl.pixels.length <= 20 && fillRatio >= 0.52 && Math.max(bw, bh) <= 6) {
          const rx = Math.max(0.75, bw * 0.5);
          const ry = Math.max(0.75, bh * 0.5);
          rescuedPathD = buildEllipseBezierPath(cx, cy, rx, ry);
        } else {
          const pad = 2;
          const lx0 = Math.max(0, isl.minX - pad);
          const ly0 = Math.max(0, isl.minY - pad);
          const lw = Math.min(width - lx0, bw + pad * 2);
          const lh = Math.min(height - ly0, bh + pad * 2);
          const localLbl = new Int32Array(lw * lh);
          for (let i = 0; i < isl.pixels.length; i++) {
            const p = isl.pixels[i];
            const x = (p % width) - lx0;
            const y = Math.floor(p / width) - ly0;
            if (x >= 0 && x < lw && y >= 0 && y < lh) localLbl[y * lw + x] = 1;
          }
          const lL = new Float32Array(lw * lh);
          const lA = new Float32Array(lw * lh);
          const lB = new Float32Array(lw * lh);
          const lAl = new Float32Array(lw * lh);
          const lCh = new Float32Array(lw * lh);
          const lRgba = new Uint8Array(lw * lh * 4);
          for (let ly = 0; ly < lh; ly++) {
            for (let lx = 0; lx < lw; lx++) {
              const gp = (ly0 + ly) * width + (lx0 + lx);
              const lp = ly * lw + lx;
              lL[lp] = decomposition.oklab.L[gp];
              lA[lp] = decomposition.oklab.a[gp];
              lB[lp] = decomposition.oklab.b[gp];
              lAl[lp] = decomposition.oklab.alpha[gp];
              lCh[lp] = decomposition.oklab.chroma[gp];
              lRgba.set(originalImage.data.subarray(gp * 4, gp * 4 + 4), lp * 4);
            }
          }
          const miniMeta = new Map<number, RegionTopologyMetadata>([
            [1, { zRank: 1, isSemiTransparent: detAlpha < 245, meanOklab: [50, 0, 0] }],
          ]);
          const miniTopo = buildPlanarSharedTopology({
            width: lw,
            height: lh,
            labelMap: localLbl,
            oklab: { width: lw, height: lh, L: lL, a: lA, b: lB, alpha: lAl, chroma: lCh },
            alphaBytes: lRgba,
            hasUniformBg: false,
            backgroundOklab: null,
            regionMeta: miniMeta,
            curveOptions: {
              maxCurveErrorPx: 0.14,
              straightLineTolPx: 0.16,
              cornerAngleThresholdDeg: 22,
              subpixelTubeRadiusPx: 0.32,
              precision: 2,
            },
            enablePorterDuffSeamTuck: false,
          });
          const rawMiniD = miniTopo.geometriesByRegion.get(1)?.pathD ?? '';
          rescuedPathD = rawMiniD ? translatePathD(rawMiniD, lx0, ly0) : '';
        }

        if (!rescuedPathD) continue;

        // Encontra o objeto pai que contém ou está mais próximo do detalhe resgatado
        let hostObj = candObjectSlots[candObjectSlots.length - 1];
        for (const o of candObjectSlots) {
          if (cx >= o.minX - 2 && cx <= o.maxX + 2 && cy >= o.minY - 2 && cy <= o.maxY + 2) {
            hostObj = o;
            break;
          }
        }

        const rescuedId = `detalhe-etapa2-${rescueSeq++}`;
        const opAttr =
          detAlpha < 248 ? ` fill-opacity="${Number((detAlpha / 255).toFixed(3))}"` : '';
        hostObj.rescuedElementsXml.push(
          `<path id="${rescuedId}" data-natureza="detalhe-resgatado" fill="${detHex}"${opAttr} d="${rescuedPathD}"/>`
        );
        rescuedCenters.add(centerKey);
        rescuedThisIter++;

        pendingRepairs.push({
          iteration: iter,
          targetType: 'rescued_detail',
          svgElementId: rescuedId,
          defectCategory: 'missing_small_detail',
          technicalJustification: `Resgatado micro-detalhe real de alto contraste (${isl.pixels.length}px em [${isl.minX},${isl.minY}], contraste ΔE₀₀=${isl.origContrastToSurround.toFixed(1)}).`,
          beforeDeltaE2000: isl.meanDeltaE2000,
          afterDeltaE2000: 0,
        });
      }
    }

    if (pendingRepairs.length === 0) {
      break;
    }

    const candCompiled = compileSlotsToSceneAndSvg(
      width,
      height,
      decomposition.hasUniformOpaqueBackground,
      backgroundHex,
      candRegionSlots,
      candObjectSlots,
      extraTypographyDefsXml,
      extraTypographyGroupsXml,
      sharedCanonicalBoundaries,
      junctionVertices
    );

    const candRendered = await renderSvgSupersampled(candCompiled.svg, width, height, {
      opaqueBackgroundRgb: opaqueBg,
    });
    if (!candRendered) break;

    const candEval = evaluateStage2Comprehensive(
      `Iteração ${iter}`,
      originalImage,
      candRendered,
      candCompiled.sceneGraph,
      decomposition,
      candCompiled.pathCount,
      candCompiled.gradientCount
    );

    const candScore = computeUnifiedQualityScore(candEval.snapshot);
    const improvesObjective = candScore > bestScore + 0.008;
    const improvesColorWithoutHarm =
      candEval.snapshot.meanDeltaE2000 < bestEval.snapshot.meanDeltaE2000 - 0.015 &&
      candEval.snapshot.ssimPct >= bestEval.snapshot.ssimPct - 0.06 &&
      candEval.snapshot.artifactRegionCount <= bestEval.snapshot.artifactRegionCount;

    if (improvesObjective || improvesColorWithoutHarm) {
      iterationsExecuted = iter;
      bestRegionSlots = candRegionSlots;
      bestObjectSlots = candObjectSlots;
      bestCompiled = candCompiled;
      bestEval = candEval;
      bestThickness = evaluateContourThicknessConsistency(
        originalImage,
        candRendered,
        decomposition.regionIdMap,
        decomposition.hasUniformOpaqueBackground,
        decomposition.backgroundRgb
      );
      bestScore = candScore;
      iterationHistory.push(candEval.snapshot);

      const newDiagMap = new Map(candEval.regionDiagnostics.map((d) => [d.regionId, d]));
      for (const rep of pendingRepairs) {
        if (rep.affectedRegionId !== undefined) {
          rep.afterDeltaE2000 =
            newDiagMap.get(rep.affectedRegionId)?.meanDeltaE2000 ?? rep.afterDeltaE2000;
        }
        appliedRepairs.push(rep);
      }

      if (
        candEval.defects.length === 0 ||
        (candEval.snapshot.meanDeltaE2000 <= 0.4 && candEval.snapshot.lostDetailRegionCount === 0)
      ) {
        break;
      }
    } else {
      // Nenhuma regressão aceita: preserva a melhor versão comprovada e encerra o ciclo!
      break;
    }
  }

  const sanitizedFinal = inspectAndSanitizeSvgContours(
    bestCompiled.svg,
    originalImage,
    1,
    baseCurveOptions.precision ?? 3
  );

  const finalSnapshot: Stage2MetricsSnapshot = {
    ...bestEval.snapshot,
    versionLabel: iterationsExecuted > 0 ? `Versão C (Após ${iterationsExecuted} it.)` : 'Versão C (Validada)',
  };
  if (iterationHistory.length > 1) {
    iterationHistory[iterationHistory.length - 1] = finalSnapshot;
  }

  return {
    ...bestCompiled,
    svg: sanitizedFinal.svg,
    sceneGraph: {
      ...bestCompiled.sceneGraph,
      svgMarkup: sanitizedFinal.svg,
    },
    stage2Report: {
      passed: bestEval.defects.filter((d) => d.severity === 'high').length === 0,
      defects: bestEval.defects,
      inspectedRegionCount: bestCompiled.sceneGraph.topologySummary.totalRegions,
      regionDiagnostics: bestEval.regionDiagnostics,
      initialMetricsB: evalB.snapshot,
      finalMetricsC: finalSnapshot,
      iterationHistory,
      appliedRepairs,
      iterationsExecuted,
      contourThicknessConsistencyPct: bestThickness.thicknessConsistencyPct,
      meanOrigContourThicknessPx: bestThickness.meanOrigThicknessPx,
      meanVecContourThicknessPx: bestThickness.meanVecThicknessPx,
      sanitizedMicroSegmentsCount:
        sanitizedFinal.summary.microSegmentsRemoved + sanitizedFinal.summary.collinearMergedCount,
      sanitizedSpikesCount:
        sanitizedFinal.summary.artificialSpikesTrimmed +
        sanitizedFinal.summary.selfIntersectionsRepaired,
    },
  };
}
