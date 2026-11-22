import type { RawRgbaImage } from '../types';
import type { OpenCvImageDecomposition } from '../opencv/opencvSegmenter';
import {
  deltaECiede2000FromLab,
  srgb8ToCieLab,
} from '../color/perceptualColor';
import type {
  Stage2DetectedDefect,
  Stage2MetricsSnapshot,
  Stage2RegionDiagnostic,
  VectorReconstructionSceneGraph,
} from './reconstructionSceneGraph';

const INF_SQ = 1e12;

/**
 * Transformada de Distância Euclidiana 1D Exata (Envelope Inferior de Parábolas de Felzenszwalb & Huttenlocher) em O(N).
 */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = +Infinity;

  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = +Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

/**
 * Transformada de Distância Euclidiana 2D Exata em O(W·H): retorna distância euclidiana (em pixels)
 * de cada pixel `(x, y)` até o pixel `mask[p] > 0` mais próximo.
 */
export function computeExactEuclideanDistanceTransform(
  binaryEdgeMask: Uint8Array,
  width: number,
  height: number
): Float32Array {
  const total = width * height;
  const dtSq = new Float64Array(total);
  let hasAnyFeature = false;
  for (let i = 0; i < total; i++) {
    if (binaryEdgeMask[i] > 0) {
      dtSq[i] = 0;
      hasAnyFeature = true;
    } else {
      dtSq[i] = INF_SQ;
    }
  }

  const out = new Float32Array(total);
  if (!hasAnyFeature) {
    out.fill(Math.hypot(width, height));
    return out;
  }

  const maxDim = Math.max(width, height);
  const f = new Float64Array(maxDim);
  const d = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  // Passo 1: Colunas (Y)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      f[y] = dtSq[y * width + x];
    }
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) {
      dtSq[y * width + x] = d[y];
    }
  }

  // Passo 2: Linhas (X)
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      f[x] = dtSq[rowOff + x];
    }
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) {
      out[rowOff + x] = Math.sqrt(Math.max(0, d[x]));
    }
  }

  return out;
}

export interface ResidualIslandCandidate {
  pixels: Int32Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  meanDeltaE2000: number;
  maxDeltaE2000: number;
  origContrastToSurround: number;
  vecContrastToSurround: number;
  kind: 'missing_small_detail' | 'ghost_or_halo_artifact' | 'missing_hole';
}

export interface FullStage2Evaluation {
  snapshot: Stage2MetricsSnapshot;
  regionDiagnostics: Stage2RegionDiagnostic[];
  defects: Stage2DetectedDefect[];
  residualIslands: ResidualIslandCandidate[];
  pixelDeltaE2000Map: Float32Array;
}

/**
 * Avaliação Científica Completa (Prompt 02 — Seções 4, 7, 8 e 10):
 * Calcula SSIM, PSNR, CIEDE2000 (global, P95 e por região), Distância de Chamfer,
 * Distância de Hausdorff (máxima e P99), Intersection over Union (IoU),
 * diagnóstico cromático por região e varredura multiescala de detalhes perdidos / fantasmas!
 */
export function evaluateStage2Comprehensive(
  versionLabel: string,
  original: RawRgbaImage,
  rendered: RawRgbaImage,
  sceneGraph?: VectorReconstructionSceneGraph,
  decomposition?: OpenCvImageDecomposition,
  pathCount = 0,
  gradientCount = 0
): FullStage2Evaluation {
  const width = Math.min(original.width, rendered.width);
  const height = Math.min(original.height, rendered.height);
  const totalPixels = Math.max(1, width * height);

  const origLum = new Float32Array(totalPixels);
  const vecLum = new Float32Array(totalPixels);
  const pixelDeltaE2000Map = new Float32Array(totalPixels);

  const origLabL = new Float32Array(totalPixels);
  const origLabA = new Float32Array(totalPixels);
  const origLabB = new Float32Array(totalPixels);
  const vecLabL = new Float32Array(totalPixels);
  const vecLabA = new Float32Array(totalPixels);
  const vecLabB = new Float32Array(totalPixels);

  let sqDiffSum = 0;
  let de2000Sum = 0;
  const deHist = new Int32Array(1001); // 0.0 .. 100.0 em passos de 0.1

  const hasUniformBg = decomposition?.hasUniformOpaqueBackground ?? false;
  const bgRgb = decomposition?.backgroundRgb ?? null;

  let fgIntersection = 0;
  let fgUnion = 0;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const px = rowOff + x;
      const i = px * 4;

      const oa = original.data[i + 3] / 255;
      const va = rendered.data[i + 3] / 255;

      // Compõe sobre xadrez neutro (248) para regiões transparentes ao medir luminância/Lab visual
      const baseBgR = bgRgb ? bgRgb[0] : 248;
      const baseBgG = bgRgb ? bgRgb[1] : 248;
      const baseBgB = bgRgb ? bgRgb[2] : 248;

      const or = Math.round(original.data[i] * oa + baseBgR * (1 - oa));
      const og = Math.round(original.data[i + 1] * oa + baseBgG * (1 - oa));
      const ob = Math.round(original.data[i + 2] * oa + baseBgB * (1 - oa));

      const vr = Math.round(rendered.data[i] * va + baseBgR * (1 - va));
      const vg = Math.round(rendered.data[i + 1] * va + baseBgG * (1 - va));
      const vb = Math.round(rendered.data[i + 2] * va + baseBgB * (1 - va));

      const dr = or - vr;
      const dg = og - vg;
      const db = ob - vb;
      const da255 = original.data[i + 3] - rendered.data[i + 3];
      sqDiffSum += dr * dr + dg * dg + db * db + da255 * da255;

      origLum[px] = 0.299 * or + 0.587 * og + 0.114 * ob;
      vecLum[px] = 0.299 * vr + 0.587 * vg + 0.114 * vb;

      const [oL, oA, oB] = srgb8ToCieLab(or, og, ob);
      const [vL, vA, vB] = srgb8ToCieLab(vr, vg, vb);
      origLabL[px] = oL;
      origLabA[px] = oA;
      origLabB[px] = oB;
      vecLabL[px] = vL;
      vecLabA[px] = vA;
      vecLabB[px] = vB;

      const de00 =
        or === vr && og === vg && ob === vb && Math.abs(da255) <= 2
          ? 0
          : deltaECiede2000FromLab(oL, oA, oB, vL, vA, vB) + Math.abs(da255) * 0.06;

      pixelDeltaE2000Map[px] = de00;
      de2000Sum += de00;
      deHist[Math.min(1000, Math.round(de00 * 10))]++;

      // Silhueta contínua (Jaccard subpixel) para IoU (Intersection over Union)
      let oCov = 1;
      let vCov = 1;
      if (!hasUniformBg && original.data[3] < 30) {
        oCov = original.data[i + 3] < 10 ? 0 : original.data[i + 3] / 255;
        vCov = rendered.data[i + 3] < 10 ? 0 : rendered.data[i + 3] / 255;
      } else if (bgRgb) {
        const oL1 =
          Math.abs(original.data[i] - bgRgb[0]) +
          Math.abs(original.data[i + 1] - bgRgb[1]) +
          Math.abs(original.data[i + 2] - bgRgb[2]);
        const vL1 =
          Math.abs(rendered.data[i] - bgRgb[0]) +
          Math.abs(rendered.data[i + 1] - bgRgb[1]) +
          Math.abs(rendered.data[i + 2] - bgRgb[2]);
        oCov = oL1 <= 16 ? 0 : Math.min(1, (oL1 - 16) / 140);
        vCov = vL1 <= 16 ? 0 : Math.min(1, (vL1 - 16) / 140);
      }

      fgIntersection += Math.min(oCov, vCov);
      fgUnion += Math.max(oCov, vCov);
    }
  }

  const mse = sqDiffSum / (totalPixels * 4);
  const psnrDb = mse <= 1e-6 ? 60 : Number(Math.min(60, 10 * Math.log10((255 * 255) / mse)).toFixed(2));
  const meanDeltaE2000 = Number((de2000Sum / totalPixels).toFixed(2));

  let accHist = 0;
  let p95DeltaE2000 = 0;
  const p95Target = Math.floor(totalPixels * 0.95);
  for (let b = 0; b <= 1000; b++) {
    accHist += deHist[b];
    if (accHist >= p95Target) {
      p95DeltaE2000 = Number((b / 10).toFixed(2));
      break;
    }
  }

  const colorFidelityCiede2000Pct = Number(
    Math.max(0, Math.min(100, 100 - meanDeltaE2000 * 2.1)).toFixed(2)
  );
  const iouPct = fgUnion > 0 ? Number(((fgIntersection / fgUnion) * 100).toFixed(2)) : 100;

  // 2. SSIM em janelas 8x8
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const win = 8;
  let ssimSum = 0;
  let ssimWinCount = 0;
  for (let by = 0; by + win <= height; by += win) {
    for (let bx = 0; bx + win <= width; bx += win) {
      let mX = 0;
      let mY = 0;
      for (let dy = 0; dy < win; dy++) {
        const row = (by + dy) * width + bx;
        for (let dx = 0; dx < win; dx++) {
          mX += origLum[row + dx];
          mY += vecLum[row + dx];
        }
      }
      const n = win * win;
      mX /= n;
      mY /= n;
      let vX = 0;
      let vY = 0;
      let cov = 0;
      for (let dy = 0; dy < win; dy++) {
        const row = (by + dy) * width + bx;
        for (let dx = 0; dx < win; dx++) {
          const a = origLum[row + dx] - mX;
          const b = vecLum[row + dx] - mY;
          vX += a * a;
          vY += b * b;
          cov += a * b;
        }
      }
      vX /= n - 1;
      vY /= n - 1;
      cov /= n - 1;
      const ssim = ((2 * mX * mY + c1) * (2 * cov + c2)) / ((mX * mX + mY * mY + c1) * (vX + vY + c2));
      ssimSum += ssim;
      ssimWinCount++;
    }
  }
  const ssimPct =
    ssimWinCount > 0 ? Number((Math.max(0, ssimSum / ssimWinCount) * 100).toFixed(2)) : 100;

  // 3. Bordas Sobel com histerese simétrica (evita artefato de limiar 41.9 vs 42.1 em Hausdorff!)
  const origEdgesStrong = new Uint8Array(totalPixels);
  const origEdgesSupport = new Uint8Array(totalPixels);
  const vecEdgesStrong = new Uint8Array(totalPixels);
  const vecEdgesSupport = new Uint8Array(totalPixels);
  let origEdgeCount = 0;
  let vecEdgeCount = 0;
  let smoothGradPixels = 0;
  let smoothGradConsistent = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const ogx =
        -origLum[idx - width - 1] +
        origLum[idx - width + 1] -
        2 * origLum[idx - 1] +
        2 * origLum[idx + 1] -
        origLum[idx + width - 1] +
        origLum[idx + width + 1];
      const ogy =
        -origLum[idx - width - 1] -
        2 * origLum[idx - width] -
        origLum[idx - width + 1] +
        origLum[idx + width - 1] +
        2 * origLum[idx + width] +
        origLum[idx + width + 1];
      const oChromaGrad =
        2.4 *
        Math.hypot(
          origLabA[idx + 1] - origLabA[idx - 1],
          origLabA[idx + width] - origLabA[idx - width],
          origLabB[idx + 1] - origLabB[idx - 1],
          origLabB[idx + width] - origLabB[idx - width]
        );
      const oMag = Math.max(Math.hypot(ogx, ogy), oChromaGrad);

      const vgx =
        -vecLum[idx - width - 1] +
        vecLum[idx - width + 1] -
        2 * vecLum[idx - 1] +
        2 * vecLum[idx + 1] -
        vecLum[idx + width - 1] +
        vecLum[idx + width + 1];
      const vgy =
        -vecLum[idx - width - 1] -
        2 * vecLum[idx - width] -
        vecLum[idx - width + 1] +
        vecLum[idx + width - 1] +
        2 * vecLum[idx + width] +
        vecLum[idx + width + 1];
      const vChromaGrad =
        2.4 *
        Math.hypot(
          vecLabA[idx + 1] - vecLabA[idx - 1],
          vecLabA[idx + width] - vecLabA[idx - width],
          vecLabB[idx + 1] - vecLabB[idx - 1],
          vecLabB[idx + width] - vecLabB[idx - width]
        );
      const vMag = Math.max(Math.hypot(vgx, vgy), vChromaGrad);

      if (oMag >= 22) origEdgesSupport[idx] = 1;
      if (oMag >= 44) {
        origEdgesStrong[idx] = 1;
        origEdgeCount++;
      }
      if (vMag >= 22) vecEdgesSupport[idx] = 1;
      if (vMag >= 44) {
        vecEdgesStrong[idx] = 1;
        vecEdgeCount++;
      }

      if (oMag >= 4 && oMag < 34) {
        smoothGradPixels++;
        if (vMag < 48 && Math.abs(oMag - vMag) <= 22) {
          smoothGradConsistent++;
        }
      }
    }
  }

  const origEdges = origEdgesStrong;
  const vecEdges = vecEdgesStrong;
  const dtOrig = computeExactEuclideanDistanceTransform(origEdgesSupport, width, height);
  const dtVec = computeExactEuclideanDistanceTransform(vecEdgesSupport, width, height);

  let sumOrigToVec = 0;
  let sumVecToOrig = 0;
  let matchedOrig = 0;
  let matchedVec = 0;
  let maxHausdorff = 0;
  const distBins = new Int32Array(501); // 0.0 .. 50.0px em 0.1px

  for (let px = 0; px < totalPixels; px++) {
    if (origEdges[px]) {
      const d = dtVec[px];
      sumOrigToVec += d;
      if (d <= 1.45) matchedOrig++;
      if (d > maxHausdorff) maxHausdorff = d;
      distBins[Math.min(500, Math.round(d * 10))]++;
    }
    if (vecEdges[px]) {
      const d = dtOrig[px];
      sumVecToOrig += d;
      if (d <= 1.45) matchedVec++;
      if (d > maxHausdorff) maxHausdorff = d;
      distBins[Math.min(500, Math.round(d * 10))]++;
    }
  }

  const chamferDistancePx =
    origEdgeCount > 0 && vecEdgeCount > 0
      ? Number((0.5 * (sumOrigToVec / origEdgeCount + sumVecToOrig / vecEdgeCount)).toFixed(3))
      : origEdgeCount === 0 && vecEdgeCount === 0
        ? 0
        : 4.0;

  let hausdorffP99Px = 0;
  const totalEdgeSamples = origEdgeCount + vecEdgeCount;
  if (totalEdgeSamples > 0) {
    let accD = 0;
    const p99Target = Math.floor(totalEdgeSamples * 0.99);
    for (let b = 0; b <= 500; b++) {
      accD += distBins[b];
      if (accD >= p99Target) {
        hausdorffP99Px = Number((b / 10).toFixed(2));
        break;
      }
    }
  } else {
    maxHausdorff = 0;
  }

  const recall = origEdgeCount > 0 ? matchedOrig / origEdgeCount : 1;
  const precision = vecEdgeCount > 0 ? matchedVec / vecEdgeCount : 1;
  const contourF1Pct =
    recall + precision > 0
      ? Number((((2 * recall * precision) / (recall + precision)) * 100).toFixed(2))
      : 100;

  const gradientContinuityPct =
    smoothGradPixels >= 25
      ? Number(((smoothGradConsistent / smoothGradPixels) * 100).toFixed(2))
      : 100;

  // 4. Diagnóstico Individualizado por Região (sem deixar média global esconder erro local!)
  const regionDiagnostics: Stage2RegionDiagnostic[] = [];
  const defects: Stage2DetectedDefect[] = [];
  let worstRegionDeltaE2000 = 0;

  if (sceneGraph && decomposition) {
    const subById = new Map<number, (typeof decomposition.objects)[number]['subRegions'][number]>();
    for (const obj of decomposition.objects) {
      for (const s of obj.subRegions) {
        subById.set(s.id, s);
      }
    }

    for (const objNode of sceneGraph.objects) {
      for (const regNode of objNode.regions) {
        const sub = subById.get(regNode.regionId);
        if (!sub || sub.pixelCount < 2) continue;

        // Prioriza pixels interiores erodidos para medir cor sem interferência de anti-aliasing da borda
        let useInteriorOnly = false;
        let intCount = 0;
        for (let i = 0; i < sub.pixelCount; i++) {
          if (decomposition.interiorMask[sub.pixels[i]]) intCount++;
        }
        if (intCount >= 8) {
          useInteriorOnly = true;
        }

        let sumDe = 0;
        let sumDL = 0;
        let sumDC = 0;
        let sumDA = 0;
        let cnt = 0;
        const localDeList: number[] = [];
        let perimChamferSum = 0;
        let perimMaxHausdorff = 0;
        let perimCnt = 0;

        for (let i = 0; i < sub.pixelCount; i++) {
          const px = sub.pixels[i];
          const isInt = decomposition.interiorMask[px] === 1;

          if (!isInt) {
            // Amostra desvio geométrico de contorno nos pixels de perímetro da região
            if (origEdges[px] || vecEdges[px]) {
              const gd = origEdges[px] ? dtVec[px] : dtOrig[px];
              perimChamferSum += gd;
              if (gd > perimMaxHausdorff) perimMaxHausdorff = gd;
              perimCnt++;
            }
            if (useInteriorOnly) continue;
          }

          const de = pixelDeltaE2000Map[px];
          sumDe += de;
          localDeList.push(de);

          const dL = vecLabL[px] - origLabL[px];
          const origC = Math.hypot(origLabA[px], origLabB[px]);
          const vecC = Math.hypot(vecLabA[px], vecLabB[px]);
          const dC = vecC - origC;
          const dA = rendered.data[px * 4 + 3] - original.data[px * 4 + 3];

          sumDL += dL;
          sumDC += dC;
          sumDA += dA;
          cnt++;
        }

        if (cnt === 0) continue;
        localDeList.sort((a, b) => a - b);
        const regMeanDe = Number((sumDe / cnt).toFixed(2));
        const regP95De = Number(
          localDeList[Math.min(localDeList.length - 1, Math.floor(localDeList.length * 0.95))].toFixed(2)
        );
        const avgDL = Number((sumDL / cnt).toFixed(2));
        const avgDC = Number((sumDC / cnt).toFixed(2));
        const avgDA = Number((sumDA / cnt).toFixed(2));
        const regChamfer = perimCnt > 0 ? Number((perimChamferSum / perimCnt).toFixed(3)) : 0;
        const regHausdorff = Number(perimMaxHausdorff.toFixed(2));

        if (regMeanDe > worstRegionDeltaE2000) {
          worstRegionDeltaE2000 = regMeanDe;
        }

        let chromaticDiagnosis: Stage2RegionDiagnostic['chromaticDiagnosis'] = 'accurate';
        if (Math.abs(avgDA) >= 12) {
          chromaticDiagnosis = 'opacity_shifted';
        } else if (regMeanDe >= 2.2) {
          if (avgDL >= 2.2) chromaticDiagnosis = 'lighter';
          else if (avgDL <= -2.2) chromaticDiagnosis = 'darker';
          else if (avgDC <= -2.4) chromaticDiagnosis = 'desaturated';
          else if (avgDC >= 2.4) chromaticDiagnosis = 'oversaturated';
          else chromaticDiagnosis = 'hue_shifted';
        }

        regionDiagnostics.push({
          regionId: regNode.regionId,
          parentObjectId: regNode.parentObjectId,
          svgPathId: regNode.svgPathId,
          nature: regNode.nature,
          pixelCount: regNode.pixelCount,
          boundingBox: regNode.boundingBox,
          meanDeltaE2000: regMeanDe,
          p95DeltaE2000: regP95De,
          deltaLightness: avgDL,
          deltaChroma: avgDC,
          deltaAlpha: avgDA,
          contourChamferPx: regChamfer,
          contourHausdorffPx: regHausdorff,
          chromaticDiagnosis,
        });

        // Registra defeitos localizados da região para o Ciclo Automático de Correção (Seção 11)
        if (
          regNode.fillKind === 'solid' &&
          regMeanDe >= 2.2 &&
          regNode.nature !== 'texture_detail'
        ) {
          defects.push({
            defectId: `def-color-reg-${regNode.regionId}`,
            category: 'chromatic_shift',
            severity: regMeanDe >= 5.5 ? 'high' : 'medium',
            affectedObjectId: regNode.parentObjectId,
            affectedRegionId: regNode.regionId,
            boundingBox: regNode.boundingBox,
            pixelArea: regNode.pixelCount,
            measuredDeltaE2000: regMeanDe,
            probableCause:
              regP95De >= regMeanDe * 1.9 && regP95De >= 4.5
                ? 'Variação interna de gradiente/sombra modelada como cor sólida uniforme'
                : `Desvio cromático (${chromaticDiagnosis}: ΔL*=${avgDL}, ΔC*=${avgDC}, Δα=${avgDA}) por contaminação de borda ou média simples`,
            description: `Região ${regNode.svgPathId} apresenta ΔE₀₀=${regMeanDe} (P95=${regP95De}).`,
          });
        } else if (
          regNode.fillKind !== 'subdivided' &&
          (regMeanDe >= 3.4 || regP95De >= 6.8) &&
          regNode.pixelCount >= 70
        ) {
          defects.push({
            defectId: `def-grad-reg-${regNode.regionId}`,
            category: 'gradient_discontinuity',
            severity: regMeanDe >= 6.0 ? 'high' : 'medium',
            affectedObjectId: regNode.parentObjectId,
            affectedRegionId: regNode.regionId,
            boundingBox: regNode.boundingBox,
            pixelArea: regNode.pixelCount,
            measuredDeltaE2000: regMeanDe,
            probableCause:
              'Gradiente 2D não-linear, reflexo especular localizado ou perda de stops intermediários',
            description: `Transição de gradiente em ${regNode.svgPathId} com erro residual ΔE₀₀=${regMeanDe} (P95=${regP95De}).`,
          });
        }

        if (regHausdorff >= 1.75 && regChamfer >= 0.55 && regNode.pixelCount >= 20) {
          defects.push({
            defectId: `def-geom-reg-${regNode.regionId}`,
            category: 'contour_deformation',
            severity: regHausdorff >= 2.8 ? 'high' : 'medium',
            affectedObjectId: regNode.parentObjectId,
            affectedRegionId: regNode.regionId,
            boundingBox: regNode.boundingBox,
            pixelArea: regNode.pixelCount,
            measuredDeltaE2000: regMeanDe,
            measuredGeometricDeviationPx: regHausdorff,
            probableCause:
              'Simplificação excessiva de curva Bézier ou arredondamento de ponta aguda/concavidade',
            description: `Contorno de ${regNode.svgPathId} com Hausdorff=${regHausdorff}px (Chamfer=${regChamfer}px).`,
          });
        }
      }
    }
  }

  // 5. Varredura Multiescala de Ilhas Residuais (Detalhes Perdidos, Furos Fechados e Artefatos/Fantasmas)
  const visitedErr = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const residualIslands: ResidualIslandCandidate[] = [];
  let artifactRegionCount = 0;
  let lostDetailRegionCount = 0;

  for (let startPx = 0; startPx < totalPixels; startPx++) {
    if (visitedErr[startPx] || pixelDeltaE2000Map[startPx] < 8.5) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = startPx;
    visitedErr[startPx] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let deSum = 0;
    let maxDe = 0;
    let spuriousVecEdgeCount = 0;
    let missingOrigEdgeCount = 0;

    while (head < tail) {
      const px = queue[head++];
      const x = px % width;
      const y = (px - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const de = pixelDeltaE2000Map[px];
      deSum += de;
      if (de > maxDe) maxDe = de;

      if (vecEdges[px] && dtOrig[px] > 1.8) spuriousVecEdgeCount++;
      if (origEdges[px] && dtVec[px] > 1.8) missingOrigEdgeCount++;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (!visitedErr[np] && pixelDeltaE2000Map[np] >= 7.5) {
            visitedErr[np] = 1;
            queue[tail++] = np;
          }
        }
      }
    }

    // Avalia ilhas compactas de erro localizado (>= 2 pixels até 900 pixels)
    if (tail < 2 || tail > 900) continue;

    // Mede o contraste da ilha na imagem ORIGINAL vs seu anel externo de 2px (para distinguir detalhe real perdido de fantasma!)
    const islandSet = new Set<number>();
    let oLSum = 0;
    let oASum = 0;
    let oBSum = 0;
    let vLSum = 0;
    let vASum = 0;
    let vBSum = 0;
    let origTranspCnt = 0;
    let vecOpaqueCnt = 0;
    let dtVecSum = 0;

    for (let i = 0; i < tail; i++) {
      const p = queue[i];
      islandSet.add(p);
      oLSum += origLabL[p];
      oASum += origLabA[p];
      oBSum += origLabB[p];
      vLSum += vecLabL[p];
      vASum += vecLabA[p];
      vBSum += vecLabB[p];
      dtVecSum += dtVec[p];
      if (original.data[p * 4 + 3] < 45) origTranspCnt++;
      if (rendered.data[p * 4 + 3] > 200) vecOpaqueCnt++;
    }
    const meanDtVec = dtVecSum / tail;

    let ringOL = 0;
    let ringOA = 0;
    let ringOB = 0;
    let ringVL = 0;
    let ringVA = 0;
    let ringVB = 0;
    let ringCnt = 0;

    for (let y = Math.max(0, minY - 2); y <= Math.min(height - 1, maxY + 2); y++) {
      for (let x = Math.max(0, minX - 2); x <= Math.min(width - 1, maxX + 2); x++) {
        const p = y * width + x;
        if (islandSet.has(p)) continue;
        ringOL += origLabL[p];
        ringOA += origLabA[p];
        ringOB += origLabB[p];
        ringVL += vecLabL[p];
        ringVA += vecLabA[p];
        ringVB += vecLabB[p];
        ringCnt++;
      }
    }

    if (ringCnt === 0) continue;

    const meanOL = oLSum / tail;
    const meanOA = oASum / tail;
    const meanOB = oBSum / tail;
    const meanVL = vLSum / tail;
    const meanVA = vASum / tail;
    const meanVB = vBSum / tail;

    const origContrastToSurround = deltaECiede2000FromLab(
      meanOL,
      meanOA,
      meanOB,
      ringOL / ringCnt,
      ringOA / ringCnt,
      ringOB / ringCnt
    );
    const vecContrastToSurround = deltaECiede2000FromLab(
      meanVL,
      meanVA,
      meanVB,
      ringVL / ringCnt,
      ringVA / ringCnt,
      ringVB / ringCnt
    );

    const meanDe = Number((deSum / tail).toFixed(2));
    const typedPixels = queue.slice(0, tail);

    if (origTranspCnt >= tail * 0.7 && vecOpaqueCnt >= tail * 0.7) {
      lostDetailRegionCount++;
      residualIslands.push({
        pixels: typedPixels,
        minX,
        minY,
        maxX,
        maxY,
        meanDeltaE2000: meanDe,
        maxDeltaE2000: Number(maxDe.toFixed(2)),
        origContrastToSurround,
        vecContrastToSurround,
        kind: 'missing_hole',
      });
      defects.push({
        defectId: `def-hole-${minX}-${minY}`,
        category: 'missing_hole',
        severity: 'high',
        boundingBox: { minX, minY, maxX, maxY },
        pixelArea: tail,
        measuredDeltaE2000: meanDe,
        probableCause: 'Abertura/furo interno transparente preenchido indevidamente pela região pai',
        description: `Furo/abertura interna (${tail}px em [${minX},${minY}]) foi fechado.`,
      });
    } else if (
      meanDtVec >= 1.45 &&
      origContrastToSurround >= 11.0 &&
      vecContrastToSurround < origContrastToSurround * 0.42 &&
      meanDe >= 10.5
    ) {
      // Na imagem original havia um detalhe nítido (reflexo, ponto, linha, estrela) que desapareceu no SVG!
      lostDetailRegionCount++;
      residualIslands.push({
        pixels: typedPixels,
        minX,
        minY,
        maxX,
        maxY,
        meanDeltaE2000: meanDe,
        maxDeltaE2000: Number(maxDe.toFixed(2)),
        origContrastToSurround,
        vecContrastToSurround,
        kind: 'missing_small_detail',
      });
      defects.push({
        defectId: `def-detail-${minX}-${minY}`,
        category: 'missing_small_detail',
        severity: tail >= 6 || meanDe >= 18 ? 'high' : 'medium',
        boundingBox: { minX, minY, maxX, maxY },
        pixelArea: tail,
        measuredDeltaE2000: meanDe,
        probableCause:
          missingOrigEdgeCount > 0
            ? 'Micro-detalhe, reflexo ou traço fino absorvido durante segmentação/simplificação'
            : 'Elemento interno de alto contraste omitido',
        description: `Detalhe real de ${tail}px em [${minX},${minY}] perdido (ΔE₀₀=${meanDe}).`,
      });
    } else if (
      spuriousVecEdgeCount >= 2 &&
      vecContrastToSurround >= origContrastToSurround + 6.5 &&
      meanDe >= 9.0
    ) {
      // No SVG apareceu uma borda/mancha/fantasma que NÃO existia na região suave original!
      artifactRegionCount++;
      residualIslands.push({
        pixels: typedPixels,
        minX,
        minY,
        maxX,
        maxY,
        meanDeltaE2000: meanDe,
        maxDeltaE2000: Number(maxDe.toFixed(2)),
        origContrastToSurround,
        vecContrastToSurround,
        kind: 'ghost_or_halo_artifact',
      });
      defects.push({
        defectId: `def-ghost-${minX}-${minY}`,
        category: 'ghost_or_halo_artifact',
        severity: meanDe >= 15 ? 'high' : 'medium',
        boundingBox: { minX, minY, maxX, maxY },
        pixelArea: tail,
        measuredDeltaE2000: meanDe,
        probableCause: 'Halo residual de antialiasing, contorno duplicado ou transição abrupta artificial',
        description: `Artefato/fantasma localizado (${tail}px em [${minX},${minY}], ΔE₀₀=${meanDe}).`,
      });
    }
  }

  const snapshot: Stage2MetricsSnapshot = {
    versionLabel,
    ssimPct,
    psnrDb,
    meanDeltaE2000,
    p95DeltaE2000,
    colorFidelityCiede2000Pct,
    chamferDistancePx,
    hausdorffDistancePx: Number(maxHausdorff.toFixed(2)),
    hausdorffP99Px,
    iouPct,
    contourF1Pct,
    gradientContinuityPct,
    artifactRegionCount,
    lostDetailRegionCount,
    worstRegionDeltaE2000,
    pathCount,
    gradientCount,
  };

  return {
    snapshot,
    regionDiagnostics,
    defects,
    residualIslands,
    pixelDeltaE2000Map,
  };
}
