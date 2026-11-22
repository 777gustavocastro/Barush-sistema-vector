import type {
  DetectedImageCategory,
  RawRgbaImage,
  TypographyRegion,
  VectorizationParameters,
} from '../types';
import {
  analyzeAndSegmentWithOpenCv,
  type OpenCvImageDecomposition,
  type SegmentedSubRegion,
} from '../opencv/opencvSegmenter';
import { rgbToHex } from '../color/perceptualColor';
import { fitRegionSvgFill, type RegionSvgFillFit } from '../gradients/svgGradientReconstructor';
import {
  buildPlanarSharedTopology,
  type RegionTopologyMetadata,
} from '../topology/planarTopologyGraph';
import type { AdaptiveCurveFitOptions } from '../geometry/adaptiveBezierFitter';
import { buildExactTypographyInkMask } from '../typography/typographyProcessor';
import type {
  SceneRegionNode,
  Stage2InspectionReport,
  VectorReconstructionSceneGraph,
} from '../stage2/reconstructionSceneGraph';
import {
  runStage2IterativeRefinement,
  type EditableObjectSlot,
  type EditableRegionSlot,
} from '../stage2/stage2RefinementEngine';

export interface ObjectVectorReconstructionOutput {
  svg: string;
  objectCount: number;
  gradientCount: number;
  pathCount: number;
  clipPathCount: number;
  sceneGraph: VectorReconstructionSceneGraph;
  stage2Report: Stage2InspectionReport;
}

/**
 * Subdivide de forma limpa e topologicamente contínua uma região com gradiente 2D não-linear
 * complexo ou textura controlada em 4..7 sub-faixas vetoriais confinadas por `<clipPath>`!
 */
export function buildClippedSubdivisionForComplexRegion(
  sub: SegmentedSubRegion,
  basePathD: string,
  baseUsesEvenOdd: boolean,
  decomposition: OpenCvImageDecomposition,
  curveOptions: AdaptiveCurveFitOptions,
  idPrefix: string,
  bandCountOverride?: number
): {
  clipDefsXml: string;
  gradDefsXml: string;
  subGroupXml: string;
  extraPaths: number;
  extraGradients: number;
} | null {
  const { width, oklab } = decomposition;
  const substrateImage = sub.isSoftShadow
    ? decomposition.substrateImage
    : decomposition.decontaminatedImage;
  const pad = 2;
  const cx0 = Math.max(0, sub.minX - pad);
  const cy0 = Math.max(0, sub.minY - pad);
  const cw = Math.min(decomposition.width - cx0, sub.maxX - sub.minX + 1 + pad * 2);
  const ch = Math.min(decomposition.height - cy0, sub.maxY - sub.minY + 1 + pad * 2);
  if (cw < 6 || ch < 6 || sub.pixelCount < 115) return null;

  const kBands = bandCountOverride ?? (sub.pixelCount >= 900 ? 6 : 4);

  // Ordena amostra por luminosidade + croma para inicializar sementes bem espaçadas
  const step = Math.max(1, Math.floor(sub.pixelCount / 300));
  const samples: number[] = [];
  for (let i = 0; i < sub.pixelCount; i += step) {
    samples.push(sub.pixels[i]);
  }
  samples.sort((p1, p2) => oklab.L[p1] + oklab.a[p1] * 0.3 - (oklab.L[p2] + oklab.a[p2] * 0.3));

  const cL = new Float32Array(kBands);
  const cA = new Float32Array(kBands);
  const cB = new Float32Array(kBands);
  const cX = new Float32Array(kBands);
  const cY = new Float32Array(kBands);

  for (let k = 0; k < kBands; k++) {
    const sp = samples[Math.min(samples.length - 1, Math.floor(((k + 0.5) / kBands) * samples.length))];
    cL[k] = oklab.L[sp];
    cA[k] = oklab.a[sp];
    cB[k] = oklab.b[sp];
    cX[k] = sp % width;
    cY[k] = Math.floor(sp / width);
  }

  const spatialScale = 12 / Math.max(12, Math.hypot(cw, ch));
  const assignments = new Int32Array(sub.pixelCount);

  for (let iter = 0; iter < 4; iter++) {
    const sumL = new Float64Array(kBands);
    const sumA = new Float64Array(kBands);
    const sumB = new Float64Array(kBands);
    const sumX = new Float64Array(kBands);
    const sumY = new Float64Array(kBands);
    const cnt = new Int32Array(kBands);

    for (let i = 0; i < sub.pixelCount; i++) {
      const px = sub.pixels[i];
      const x = px % width;
      const y = (px - x) / width;
      const Lv = oklab.L[px];
      const av = oklab.a[px];
      const bv = oklab.b[px];

      let bestK = 0;
      let bestDist = Infinity;
      for (let k = 0; k < kBands; k++) {
        const dL = Lv - cL[k];
        const dA = av - cA[k];
        const dB = bv - cB[k];
        const dX = (x - cX[k]) * spatialScale;
        const dY = (y - cY[k]) * spatialScale;
        const d = dL * dL + dA * dA + dB * dB + dX * dX + dY * dY;
        if (d < bestDist) {
          bestDist = d;
          bestK = k;
        }
      }
      assignments[i] = bestK + 1;
      sumL[bestK] += Lv;
      sumA[bestK] += av;
      sumB[bestK] += bv;
      sumX[bestK] += x;
      sumY[bestK] += y;
      cnt[bestK]++;
    }

    for (let k = 0; k < kBands; k++) {
      if (cnt[k] > 0) {
        cL[k] = sumL[k] / cnt[k];
        cA[k] = sumA[k] / cnt[k];
        cB[k] = sumB[k] / cnt[k];
        cX[k] = sumX[k] / cnt[k];
        cY[k] = sumY[k] / cnt[k];
      }
    }
  }

  const localLabels = new Int32Array(cw * ch);
  const bandPixelsGlobal = new Map<number, number[]>();

  for (let i = 0; i < sub.pixelCount; i++) {
    const px = sub.pixels[i];
    const lx = (px % width) - cx0;
    const ly = Math.floor(px / width) - cy0;
    if (lx >= 0 && lx < cw && ly >= 0 && ly < ch) {
      const bId = assignments[i];
      localLabels[ly * cw + lx] = bId;
      let list = bandPixelsGlobal.get(bId);
      if (!list) {
        list = [];
        bandPixelsGlobal.set(bId, list);
      }
      list.push(px);
    }
  }

  if (bandPixelsGlobal.size < 2) return null;

  // Prepara buffers locais para topologia planar das sub-faixas
  const localL = new Float32Array(cw * ch);
  const localA = new Float32Array(cw * ch);
  const localB = new Float32Array(cw * ch);
  const localAlpha = new Float32Array(cw * ch);
  const localChroma = new Float32Array(cw * ch);
  const localRgba = new Uint8Array(cw * ch * 4);

  for (let ly = 0; ly < ch; ly++) {
    const gy = cy0 + ly;
    for (let lx = 0; lx < cw; lx++) {
      const gx = cx0 + lx;
      const gPx = gy * width + gx;
      const lPx = ly * cw + lx;
      localL[lPx] = oklab.L[gPx];
      localA[lPx] = oklab.a[gPx];
      localB[lPx] = oklab.b[gPx];
      localAlpha[lPx] = oklab.alpha[gPx];
      localChroma[lPx] = oklab.chroma[gPx];
      localRgba.set(substrateImage.data.subarray(gPx * 4, gPx * 4 + 4), lPx * 4);
    }
  }

  const bandMeta = new Map<number, RegionTopologyMetadata>();
  for (let k = 1; k <= kBands; k++) {
    bandMeta.set(k, {
      zRank: k,
      isSemiTransparent: false,
      meanOklab: [cL[k - 1], cA[k - 1], cB[k - 1]],
    });
  }

  const localTopo = buildPlanarSharedTopology({
    width: cw,
    height: ch,
    labelMap: localLabels,
    oklab: {
      width: cw,
      height: ch,
      L: localL,
      a: localA,
      b: localB,
      alpha: localAlpha,
      chroma: localChroma,
    },
    alphaBytes: localRgba,
    hasUniformBg: true,
    backgroundOklab: decomposition.backgroundOklab,
    regionMeta: bandMeta,
    curveOptions,
    enablePorterDuffSeamTuck: true,
  });

  const shiftPathD = (d: string, dx: number, dy: number): string => {
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
        out.push(Number(val.toFixed(2)).toString());
        isX = !isX;
      }
    }
    return out.join(' ');
  };

  const gradDefs: string[] = [];
  const subPaths: string[] = [];
  let extraGrads = 0;

  for (let k = 1; k <= kBands; k++) {
    const geom = localTopo.geometriesByRegion.get(k);
    const pxs = bandPixelsGlobal.get(k);
    if (!geom || !pxs || pxs.length < 4) continue;

    let bMinX = width, bMaxX = 0, bMinY = decomposition.height, bMaxY = 0;
    const typed = new Int32Array(pxs.length);
    for (let i = 0; i < pxs.length; i++) {
      const p = pxs[i];
      typed[i] = p;
      const x = p % width;
      const y = (p - x) / width;
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
    }

    const subGradId = `${idPrefix}-faixa-${k}`;
    const bFit = fitRegionSvgFill(
      typed,
      typed.length,
      bMinX,
      bMinY,
      bMaxX,
      bMaxY,
      substrateImage,
      1,
      subGradId,
      decomposition.rgbGradientMap,
      'gradient'
    );

    if (bFit.defsXml) {
      gradDefs.push(bFit.defsXml);
      extraGrads++;
    }

    const shiftedD = shiftPathD(geom.pathD, cx0, cy0);
    const eo = geom.usesEvenOdd ? ' fill-rule="evenodd"' : '';
    subPaths.push(
      `<path id="${idPrefix}-p-${k}" fill="${bFit.fillValue}"${eo} d="${shiftedD}"/>`
    );
  }

  if (subPaths.length < 2) return null;

  const clipId = `clip-${idPrefix}`;
  const clipEo = baseUsesEvenOdd ? ' clip-rule="evenodd"' : '';
  const clipDefsXml = `<clipPath id="${clipId}"><path id="molde-${clipId}"${clipEo} d="${basePathD}"/></clipPath>`;

  return {
    clipDefsXml,
    gradDefsXml: gradDefs.join(''),
    subGroupXml: `<g id="malha-${idPrefix}" clip-path="url(#${clipId})">${subPaths.join('')}</g>`,
    extraPaths: subPaths.length,
    extraGradients: extraGrads,
  };
}

/**
 * Motor Universal de Reconstrução Vetorial Orientada a Objetos e Topologia Planar:
 * - Fronteiras compartilhadas exatas entre elementos vizinhos (zero fendas, zero invasão de cores);
 * - Preservação matemática de buracos/vazios internos (`fill-rule="evenodd"`);
 * - Confinamento estrito por `<clipPath>` da silhueta do objeto quando há múltiplas sub-regiões/sombras/reflexos;
 * - Curvas Bézier adaptativas que preservam pontas agudas (`C⁰`), retas (`L`) e curvas suaves (`Q`/`C`);
 * - Grafo de Cena estruturado (`VectorReconstructionSceneGraph`) pronto para a Etapa 2.
 */
export async function reconstructImageAsEditableObjects(
  image: RawRgbaImage,
  params: VectorizationParameters,
  detectedCategory: DetectedImageCategory,
  extraTypographyDefsXml = '',
  extraTypographyGroupsXml = '',
  typographyBoxes: TypographyRegion[] = []
): Promise<ObjectVectorReconstructionOutput> {
  const { width, height } = image;

  const typographyInkMask =
    typographyBoxes.length > 0 ? buildExactTypographyInkMask(image, typographyBoxes, 1) : undefined;

  const decomposition = await analyzeAndSegmentWithOpenCv(image, {
    category: detectedCategory,
    detailPrecision: params.detailPrecision,
    noiseRemoval: params.noiseRemoval,
    typographyInkMask,
  });

  // Calibra parâmetros geométricos de ajuste de curvas conforme os controles do usuário
  const maxCurveErrorPx = Number(
    Math.max(
      0.16,
      0.2 +
        (params.curveSmoothness / 100) * 0.08 +
        (params.pathSimplification / 100) * 0.85 +
        (Math.max(0, 75 - params.detailPrecision) / 75) * 0.26
    ).toFixed(3)
  );
  const straightLineTolPx = Number(
    Math.max(0.18, 0.24 + (params.pathSimplification / 100) * 0.35).toFixed(3)
  );
  const cornerAngleThresholdDeg = Math.max(
    24,
    Math.min(58, Math.round(52 - (params.contourSensitivity / 100) * 20))
  );
  const coordPrecision = params.pathSimplification >= 70 ? 1 : 2;

  const curveOptions: AdaptiveCurveFitOptions = {
    maxCurveErrorPx,
    straightLineTolPx,
    cornerAngleThresholdDeg,
    subpixelTubeRadiusPx: 0.48,
    precision: coordPrecision,
  };

  // Metadados Z-order globais para todas as sub-regiões
  const regionMeta = new Map<number, RegionTopologyMetadata>();
  let globalZRank = 1;
  for (const obj of decomposition.objects) {
    for (const sub of obj.subRegions) {
      regionMeta.set(sub.id, {
        zRank: globalZRank++,
        isSemiTransparent: sub.isSemiTransparent,
        meanOklab: sub.meanOklab,
      });
    }
  }

  // 1. Constrói Topologia Planar de Fronteiras Compartilhadas para todas as sub-regiões
  const regionTopology = buildPlanarSharedTopology({
    width,
    height,
    labelMap: decomposition.regionIdMap,
    oklab: decomposition.oklab,
    alphaBytes: decomposition.substrateImage.data,
    hasUniformBg: decomposition.hasUniformOpaqueBackground,
    backgroundOklab: decomposition.backgroundOklab,
    regionMeta,
    curveOptions,
    enablePorterDuffSeamTuck: true,
  });

  // 2. Constrói Silhuetas Exteriores Exatas dos Objetos Compostos para confinamento `<clipPath>` anti-vazamento!
  const multiRegionObjectIds = new Set<number>();
  const objectMeta = new Map<number, RegionTopologyMetadata>();
  for (const obj of decomposition.objects) {
    if (obj.subRegions.length >= 2) {
      multiRegionObjectIds.add(obj.objectId);
    }
    objectMeta.set(obj.objectId, {
      zRank: obj.objectId,
      isSemiTransparent: obj.dominantNature === 'translucent' || obj.dominantNature === 'shadow',
      meanOklab: obj.subRegions[0]?.meanOklab ?? [50, 0, 0],
    });
  }

  const objectSilhouetteTopology =
    multiRegionObjectIds.size > 0
      ? buildPlanarSharedTopology({
          width,
          height,
          labelMap: decomposition.objectLabelMap,
          oklab: decomposition.oklab,
          alphaBytes: decomposition.substrateImage.data,
          hasUniformBg: decomposition.hasUniformOpaqueBackground,
          backgroundOklab: decomposition.backgroundOklab,
          regionMeta: objectMeta,
          curveOptions,
          enablePorterDuffSeamTuck: false,
        })
      : null;

  const regionSlots = new Map<number, EditableRegionSlot>();
  const objectSlots: EditableObjectSlot[] = [];
  let pathCounter = 0;

  let backgroundHex: string | null = null;
  if (decomposition.hasUniformOpaqueBackground && decomposition.backgroundRgb) {
    const [br, bg, bb] = decomposition.backgroundRgb;
    backgroundHex = rgbToHex(br, bg, bb);
    pathCounter++;
  }

  for (const obj of decomposition.objects) {
    const objRegionIds: number[] = [];

    for (let sIdx = 0; sIdx < obj.subRegions.length; sIdx++) {
      const sub = obj.subRegions[sIdx];
      const geom = regionTopology.geometriesByRegion.get(sub.id);
      if (!geom || !geom.pathD) continue;

      const gradId = `grad-obj-${obj.objectId}-${sIdx + 1}`;
      const fillSourceImage = sub.isSoftShadow
        ? decomposition.substrateImage
        : decomposition.decontaminatedImage;

      const rawFit = fitRegionSvgFill(
        sub.pixels,
        sub.pixelCount,
        sub.minX,
        sub.minY,
        sub.maxX,
        sub.maxY,
        fillSourceImage,
        1,
        gradId,
        decomposition.rgbGradientMap,
        sub.nature
      );

      let fit: RegionSvgFillFit = rawFit;
      if (params.colorCount <= 16) {
        const levels = Math.max(2, Math.round(params.colorCount));
        const step = 255 / (levels - 1);
        const qr = Math.round(Math.round(sub.meanR / step) * step);
        const qg = Math.round(Math.round(sub.meanG / step) * step);
        const qb = Math.round(Math.round(sub.meanB / step) * step);
        fit = {
          ...rawFit,
          kind: 'solid',
          fillValue: rgbToHex(qr, qg, qb),
          defsXml: '',
          overlayLayer: undefined,
          evalColorAt: () => [qr, qg, qb, 255],
        };
      }

      pathCounter++;
      const mainPathId = `caminho-${pathCounter}`;
      const evenOddAttr = geom.usesEvenOdd ? ' fill-rule="evenodd"' : '';

      let recordedFillKind: SceneRegionNode['fillKind'] = fit.kind;
      let extraDefsXml = '';
      let extraElementsXml = '';
      let extraPathCount = 0;
      let extraGradientCount = 0;
      let extraClipCount = 0;

      if (fit.overlayLayer) {
        pathCounter++;
        recordedFillKind = 'compound';
        extraDefsXml = fit.overlayLayer.defsXml ?? '';
        extraElementsXml = `<path id="caminho-${pathCounter}" data-natureza="iluminacao-composta" fill="${fit.overlayLayer.fillValue}"${evenOddAttr} d="${geom.pathD}"/>`;
        extraPathCount = 1;
        extraGradientCount = fit.overlayLayer.defsXml ? 1 : 0;
      } else if (
        params.colorCount > 16 &&
        !sub.isSemiTransparent &&
        fit.meanDeltaEOklab > 4.4 &&
        sub.pixelCount >= 180 &&
        (sub.nature === 'texture_detail' || sub.nature === 'gradient' || sub.nature === 'reflection_metallic')
      ) {
        const subdiv = buildClippedSubdivisionForComplexRegion(
          sub,
          geom.pathD,
          geom.usesEvenOdd,
          decomposition,
          curveOptions,
          `sub-${obj.objectId}-${sIdx + 1}`
        );
        if (subdiv) {
          extraDefsXml = `${subdiv.clipDefsXml}${subdiv.gradDefsXml}`;
          extraElementsXml = subdiv.subGroupXml;
          extraClipCount = 1;
          extraPathCount = subdiv.extraPaths;
          extraGradientCount = subdiv.extraGradients;
          pathCounter += subdiv.extraPaths;
          recordedFillKind = 'subdivided';
        }
      }

      regionSlots.set(sub.id, {
        regionId: sub.id,
        parentObjectId: obj.objectId,
        svgPathId: mainPathId,
        sub,
        pathD: geom.pathD,
        usesEvenOdd: geom.usesEvenOdd,
        holeLoopCount: geom.holeLoopCount,
        fillKind: recordedFillKind,
        fillValue: fit.fillValue,
        fillOpacity: fit.fillOpacity,
        defsXml: fit.defsXml ?? '',
        extraDefsXml,
        extraElementsXml,
        extraPathCount,
        extraGradientCount,
        extraClipCount,
        fitMeanDeltaEOklab: Number(fit.meanDeltaEOklab.toFixed(3)),
      });
      objRegionIds.push(sub.id);
    }

    if (objRegionIds.length > 0) {
      let objClipId: string | undefined;
      let clipDefsXml = '';

      if (obj.subRegions.length >= 2 && objectSilhouetteTopology) {
        const silGeom = objectSilhouetteTopology.geometriesByRegion.get(obj.objectId);
        if (silGeom && silGeom.pathD) {
          objClipId = `clip-objeto-${obj.objectId}`;
          const clipEo = silGeom.usesEvenOdd ? ' clip-rule="evenodd"' : '';
          clipDefsXml = `<clipPath id="${objClipId}"><path${clipEo} d="${silGeom.pathD}"/></clipPath>`;
        }
      }

      objectSlots.push({
        objectId: obj.objectId,
        svgGroupId: `objeto-${obj.objectId}`,
        descriptiveName: obj.descriptiveName,
        dominantNature: obj.dominantNature,
        minX: obj.minX,
        minY: obj.minY,
        maxX: obj.maxX,
        maxY: obj.maxY,
        totalArea: obj.totalArea,
        clipId: objClipId,
        clipDefsXml,
        regionIds: objRegionIds,
        rescuedDefsXml: [],
        rescuedElementsXml: [],
      });
    }
  }

  // 3. Executa o Ciclo Automático Iterativo de Correção e Validação Supersampling (Etapa 2)!
  const refined = await runStage2IterativeRefinement({
    originalImage: image,
    decomposition,
    regionSlots,
    objectSlots,
    backgroundHex,
    extraTypographyDefsXml,
    extraTypographyGroupsXml,
    typographyBoxes,
    sharedCanonicalBoundaries: regionTopology.sharedCanonicalChainCount,
    junctionVertices: regionTopology.junctionVertexCount,
    allowFullPalette: params.colorCount > 16,
    baseCurveOptions: curveOptions,
    subdivideComplexRegion: (sub, basePathD, baseUsesEvenOdd, cOpts, idPref, bandOverride) =>
      buildClippedSubdivisionForComplexRegion(
        sub,
        basePathD,
        baseUsesEvenOdd,
        decomposition,
        cOpts,
        idPref,
        bandOverride
      ),
  });

  return refined;
}

export function organizeVTracerPathsIntoObjects(
  rawVTracerSvg: string,
  viewBoxW: number,
  viewBoxH: number
): string {
  const pathTagRegex = /<path\b([^>]*?)\/?>/gi;
  interface ParsedPathItem {
    rawTag: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    area: number;
    isCanvasBg: boolean;
  }

  const items: ParsedPathItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = pathTagRegex.exec(rawVTracerSvg)) !== null) {
    const attrs = match[1];
    const dMatch = attrs.match(/\bd\s*=\s*["']([^"']+)["']/i);
    if (!dMatch) continue;

    let tx = 0;
    let ty = 0;
    const trMatch = attrs.match(
      /\btransform\s*=\s*["']translate\(\s*([-+\d.]+)[,\s]+([-+\d.]+)\s*\)["']/i
    );
    if (trMatch) {
      tx = Number(trMatch[1]) || 0;
      ty = Number(trMatch[2]) || 0;
    }

    const nums = dMatch[1].match(/[-+]?(?:\d+\.?\d*|\.\d+)/g);
    let minX = tx, maxX = tx, minY = ty, maxY = ty;
    if (nums && nums.length >= 2) {
      const isAllAbsolute = !/[mlhvcsqt]/.test(dMatch[1]);
      if (isAllAbsolute) {
        minX = Infinity;
        maxX = -Infinity;
        minY = Infinity;
        maxY = -Infinity;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const x = Number(nums[i]) + tx;
          const y = Number(nums[i + 1]) + ty;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      } else {
        const x0 = Number(nums[0]) + tx;
        const y0 = Number(nums[1]) + ty;
        minX = x0 - 4;
        maxX = x0 + 4;
        minY = y0 - 4;
        maxY = y0 + 4;
      }
    }

    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const area = bw * bh;
    const isCanvasBg = bw >= viewBoxW * 0.96 && bh >= viewBoxH * 0.96;

    items.push({
      rawTag: `<path${attrs}/>`,
      minX,
      minY,
      maxX,
      maxY,
      area,
      isCanvasBg,
    });
  }

  if (items.length === 0) return rawVTracerSvg;

  const bgItems: ParsedPathItem[] = [];
  let idxCursor = 0;
  while (idxCursor < items.length && items[idxCursor].isCanvasBg) {
    bgItems.push(items[idxCursor]);
    idxCursor++;
  }
  const fgItems = items.slice(idxCursor);

  const n = fgItems.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra < rb) parent[rb] = ra;
      else parent[ra] = rb;
    }
  };

  for (let i = 0; i < n; i++) {
    const a = fgItems[i];
    for (let j = i + 1; j < n; j++) {
      const b = fgItems[j];
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (overlapX > 0 && overlapY > 0) {
        if (a.area < viewBoxW * viewBoxH * 0.5 && b.area < viewBoxW * viewBoxH * 0.5) {
          union(i, j);
        }
      }
    }
  }

  const outGroups: string[] = [];
  let objId = 1;

  if (bgItems.length > 0) {
    outGroups.push(
      `  <g id="objeto-${objId++}" data-tipo="plano-de-fundo">${bgItems
        .map((it) => it.rawTag)
        .join('')}</g>`
    );
  }

  // Preserva Z-order exato agrupando corridas contíguas ou componentes pequenos
  let runRoot = n > 0 ? find(0) : -1;
  let runPaths: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (r !== runRoot && runPaths.length > 0) {
      outGroups.push(`  <g id="objeto-${objId++}">${runPaths.join('')}</g>`);
      runPaths = [];
      runRoot = r;
    }
    runPaths.push(fgItems[i].rawTag);
  }
  if (runPaths.length > 0) {
    outGroups.push(`  <g id="objeto-${objId++}">${runPaths.join('')}</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxW}" height="${viewBoxH}" viewBox="0 0 ${viewBoxW} ${viewBoxH}">\n${outGroups.join(
    '\n'
  )}\n</svg>`;
}
